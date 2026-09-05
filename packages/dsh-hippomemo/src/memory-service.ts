/**
 * HippoMemo host service: durable storage-domain persistence plus the shared
 * in-memory MemoryCore used by tools, recall, HTTP, and SSE.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { hippomemoDomainSpec } from './spec.ts'
import { MemoryCore, normalizeRecord } from './memory-core.ts'
import type {
  CitationInput, CitationListQuery, CitationListResult, CitationRecord,
  HippomemoChanged, MemoryId, MemoryListQuery, MemoryListResult, MemoryPatchInput,
  MemoryPutInput, MemoryRecord, MemorySearchResult, MemoryStats, MemoryUsageStats,
  PendingCandidate, PendingCandidateListResult, PreferenceListQuery, PreferenceListResult,
  PreferenceRecord, RecallNarrative,
} from './types.ts'
import { derivePendingCandidates } from './memory-evolve.ts'
import { recencyDecay } from './relevance.ts'
import { registerHippomemoHttpRoutes } from './http.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }

  interface Events {
    'hippomemo/changed'(change: HippomemoChanged): void
  }
}

export interface HippomemoConfig {
  // schemastery's ObjectS treats every field as `T | null | undefined`, so consumers
  // may pass `null` (or omit) and the runtime defaults fill in.
  maxMemories?: number | null
  defaultRecallLimit?: number | null
  maxRecallChars?: number | null
  /** Phase 3: recall injection mode. 'firehose' (default) injects every match; 'cognitive' scores by token relevance and suppresses below threshold. */
  recallMode?: string | null
  /** Phase 3: cognitive-mode relevance threshold (0..1). 0 disables suppression, 1 requires exact match. Default 0.1. */
  cognitiveRelevanceThreshold?: number | null
  /** Phase 3: cognitive-mode candidate multiplier. Search fetches `recallLimit * multiplier` candidates, scores, then takes top `recallLimit`. Default 4. */
  cognitiveRecallMultiplier?: number | null
}

interface ResolvedConfig {
  maxMemories: number
  defaultRecallLimit: number
  maxRecallChars: number
  recallMode: 'firehose' | 'cognitive'
  cognitiveRelevanceThreshold: number
  cognitiveRecallMultiplier: number
}

/** 本插件拥有的设置命名空间（设置 → 插件 → 插件配置页可编辑）。 */
export const HIPPOMEMO_SETTINGS_NAMESPACE = 'hippomemo' as SettingsNamespace

const DEFAULT_CONFIG: ResolvedConfig = {
  maxMemories: 10_000,
  defaultRecallLimit: 5,
  maxRecallChars: 8_000,
  recallMode: 'firehose',
  cognitiveRelevanceThreshold: 0.1,
  cognitiveRecallMultiplier: 4,
}

function resolveConfig(config: HippomemoConfig = {}): ResolvedConfig {
  const recallMode = (config.recallMode ?? 'firehose') as 'firehose' | 'cognitive'
  if (recallMode !== 'firehose' && recallMode !== 'cognitive') {
    throw new TypeError('hippomemo: recallMode must be firehose or cognitive')
  }
  const threshold = config.cognitiveRelevanceThreshold ?? 0.1
  if (Number.isFinite(threshold) === false || threshold < 0 || threshold > 1) {
    throw new TypeError('hippomemo: cognitiveRelevanceThreshold must be in [0, 1]')
  }
  const multiplier = config.cognitiveRecallMultiplier ?? 4
  if (Number.isSafeInteger(multiplier) === false || multiplier < 1) {
    throw new TypeError('hippomemo: cognitiveRecallMultiplier must be a positive safe integer')
  }
  const next: ResolvedConfig = {
    maxMemories: config.maxMemories ?? DEFAULT_CONFIG.maxMemories,
    defaultRecallLimit: config.defaultRecallLimit ?? DEFAULT_CONFIG.defaultRecallLimit,
    maxRecallChars: config.maxRecallChars ?? DEFAULT_CONFIG.maxRecallChars,
    recallMode,
    cognitiveRelevanceThreshold: threshold,
    cognitiveRecallMultiplier: multiplier,
  }
  for (const key of ['maxMemories', 'defaultRecallLimit', 'maxRecallChars', 'cognitiveRecallMultiplier'] as const) {
    if (Number.isSafeInteger(next[key]) === false || next[key] <= 0) {
      throw new TypeError('hippomemo: ' + key + ' must be a positive safe integer')
    }
  }
  return next
}

export class MemoryService extends Service {
  static inject = ['storageDomain', 'webServer']

  static Config: z<HippomemoConfig> = z.object({
    maxMemories: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxMemories),
    defaultRecallLimit: z.number().step(1).min(1).default(DEFAULT_CONFIG.defaultRecallLimit),
    maxRecallChars: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxRecallChars),
    recallMode: z.string().default('firehose'),
    cognitiveRelevanceThreshold: z.number().min(0).max(1).default(DEFAULT_CONFIG.cognitiveRelevanceThreshold),
    cognitiveRecallMultiplier: z.number().step(1).min(1).default(DEFAULT_CONFIG.cognitiveRecallMultiplier),
  })

  private configSource: () => ResolvedConfig
  private readonly core: MemoryCore
  private table?: KvTable<MemoryId, MemoryRecord>
  private citationTable?: KvTable<MemoryId, CitationRecord>
  private readonly citationLog: CitationRecord[] = []
  private readonly listeners = new Set<(change: HippomemoChanged) => void>()

  constructor(ctx: Context, config: HippomemoConfig = {}) {
    super(ctx, 'memory')
    this.configSource = () => resolveConfig(config)
    this.core = new MemoryCore(this.configSource)
    // 注册 hippomemo 设置命名空间：配置文件作为 base 层，用户层覆盖后
    // configSource 返回解析后的当前配置，限制项热更新立即生效。
    ctx.inject(['settings'], (sctx) => {
      sctx.settings.installSection(ctx, HIPPOMEMO_SETTINGS_NAMESPACE, MemoryService.Config, config, {
        setSource: source => { this.configSource = () => resolveConfig(source()) },
        onChange: () => {},
      })
    })
  }

  /** 当前生效配置（设置命名空间解析结果：默认值 → 组合层 → 用户层）。 */
  private currentConfig(): ResolvedConfig {
    return this.configSource()
  }

  /**
   * Phase 3: expose the resolved recall config to peer services (notably
   * hippomemo-context). Read-only, returns a frozen snapshot so callers
   * cannot mutate the live source.
   */
  getRecallConfig(): Readonly<Pick<ResolvedConfig, 'recallMode' | 'cognitiveRelevanceThreshold' | 'cognitiveRecallMultiplier' | 'defaultRecallLimit' | 'maxRecallChars'>> {
    const c = this.currentConfig()
    return Object.freeze({
      recallMode: c.recallMode,
      cognitiveRelevanceThreshold: c.cognitiveRelevanceThreshold,
      cognitiveRecallMultiplier: c.cognitiveRecallMultiplier,
      defaultRecallLimit: c.defaultRecallLimit,
      maxRecallChars: c.maxRecallChars,
    })
  }

  protected async [Service.init](): Promise<void> {
    const domain: Domain<typeof hippomemoDomainSpec> = await this.ctx.storageDomain.open(hippomemoDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'hippomemo.domainClose')
    this.table = domain.table('memories')
    this.core.load(this.table.entries())
    this.citationTable = domain.table('citations')
    this.citationLog.length = 0
    for (const [, citation] of this.citationTable.entries()) this.citationLog.push(citation)
    registerHippomemoHttpRoutes(this.ctx, this)
  }

  get(id: MemoryId): MemoryRecord | undefined {
    return this.core.get(id)
  }

  list(query: MemoryListQuery = {}): MemoryListResult {
    return this.core.list(query)
  }

  search(query: MemoryListQuery = {}): MemorySearchResult {
    const result = this.core.search(query)
    if (result.items.length > 0) {
      this.persistChanged(this.core.markRecalled(result.items.map(hit => hit.record.id), undefined, query.workspacePath))
    }
    return result
  }

  async put(input: MemoryPutInput): Promise<MemoryRecord> {
    const previous = input.id === undefined ? undefined : this.core.get(input.id)
    const { record } = normalizeRecord(input, previous)
    const config = this.currentConfig()
    if (previous === undefined && this.core.size >= config.maxMemories) {
      throw new Error('hippomemo: maxMemories (' + String(config.maxMemories) + ') reached')
    }
    await this.requireTable().put(record.id, record)
    this.core.commit(record)
    this.citeLinks(record)
    this.emit({ operation: 'put', id: record.id })
    return record
  }

  async update(id: MemoryId, patch: MemoryPatchInput): Promise<MemoryRecord> {
    const previous = this.core.get(id)
    if (previous === undefined) throw new Error('hippomemo: unknown memory "' + id + '"')
    const { record } = normalizeRecord({
      ...previous,
      ...patch,
      title: patch.title ?? previous.title,
      content: patch.content ?? previous.content,
    }, previous)
    await this.requireTable().put(record.id, record)
    this.core.commit(record)
    this.citeLinks(record)
    this.emit({ operation: 'put', id: record.id })
    return record
  }

  async delete(id: MemoryId): Promise<boolean> {
    if (this.core.get(id) === undefined) return false
    await this.requireTable().delete(id)
    const existed = this.core.delete(id)
    if (existed) this.emit({ operation: 'deleted', id })
    return existed
  }

  /**
   * Record one reference to a memory: bumps the citation counters on the record
   * and appends a row to the citations log. No-op when the memory does not exist.
   */
  async cite(input: CitationInput): Promise<CitationRecord | undefined> {
    const record = this.core.get(input.memoryId)
    if (record === undefined) return undefined
    const citation: CitationRecord = {
      id: this.newId(),
      memoryId: input.memoryId,
      sessionId: input.sessionId,
      kind: input.kind,
      ts: Date.now(),
      ...(input.snippet !== undefined && input.snippet.trim().length > 0 ? { snippet: input.snippet.trim().slice(0, 400) } : {}),
    }
    await this.requireCitationTable().put(citation.id, citation)
    this.citationLog.push(citation)
    const changed = this.core.markCited(input.memoryId, citation.ts)
    if (changed !== undefined) await this.requireTable().put(changed.id, changed)
    return citation
  }

  citations(query: CitationListQuery = {}): CitationListResult {
    const limit = query.limit ?? 50
    const cursor = query.cursor ?? 0
    const filtered = this.citationLog
      .filter(citation => query.memoryId === undefined || citation.memoryId === query.memoryId)
      .filter(citation => query.kind === undefined || citation.kind === query.kind)
      .sort((left, right) => right.ts - left.ts)
    const items = filtered.slice(cursor, cursor + limit)
    const nextCursor = cursor + items.length < filtered.length ? cursor + items.length : undefined
    return { items, total: filtered.length, ...(nextCursor === undefined ? {} : { nextCursor }) }
  }

  usage(): MemoryUsageStats {
    return this.core.usage()
  }

  stats(): MemoryStats {
    return this.core.stats()
  }

  tags(): { tag: string; count: number }[] {
    return this.core.allTags()
  }

  /**
   * v3 UI: list preference-kind memories with derived auto/manual source and
   * decay counters. Powers the dedicated "preference zone" panel. The result
   * is stable-sorted by importance desc + updatedAt desc.
   */
  preferences(query: PreferenceListQuery = {}): PreferenceListResult {
    const now = Date.now()
    const list = this.core.list({
      kind: 'preference',
      status: 'active',
      limit: 200,
      sort: 'importance',
      order: 'desc',
    })
    const items: PreferenceRecord[] = []
    for (const record of list.items) {
      const source: PreferenceRecord['source'] = detectPreferenceSource(record)
      const decay = computePreferenceDecay(record, now)
      if (query.decayFloor !== undefined && (decay === null || decay > query.decayFloor)) {
        continue
      }
      if (query.source !== undefined && source !== query.source) {
        continue
      }
      items.push({
        id: record.id,
        title: record.title,
        content: record.content,
        tags: record.tags,
        source,
        hitCount: record.recallCount,
        lastSurfacedAt: record.lastRecalledAt,
        decayPercent: decay,
        // Author-set global preferences are durable until the user revises them;
        // everything else keeps the current 30-day half-life behaviour.
        confirmed: record.scope === 'global' && record.globalProven === true,
        status: record.status,
        updatedAt: record.updatedAt,
      })
    }
    return { items, total: items.length }
  }

  /**
   * v3 UI: live, read-only candidate list computed from the deterministic sweep.
   * Mirrors the F11 design spec: derived from planEvolution() on every call,
   * classified into one of four user-facing quadrants. No writes; resolution
   * stays on the existing PATCH /records/:id path.
   */
  candidates(): PendingCandidateListResult {
    const listed = this.core.list({ status: 'active', limit: 1000 })
    const derived = derivePendingCandidates(listed.items, { now: Date.now() })
    return {
      items: derived.items,
      byKind: derived.byKind,
      total: derived.items.length,
    }
  }

  /**
   * v3 UI: synthesise one brain-strip narration row from existing data. Until
   * the F10 recall-event table lands, this is the cheapest truthful proxy:
   * - if there is a fresh citation, talk about the agent using a memory;
   * - else if the latest preference was just saved, talk about it;
   * - else summarise the most-recently-updated active memory.
   * The `ts` is set to the underlying event time so the UI can retrigger the
   * pulse animation only when something genuinely new happens.
   */
  recallNarrative(): RecallNarrative {
    const usage = this.core.usage()
    const lastCitation = this.citationLog.length > 0
      ? this.citationLog.slice().sort((left, right) => right.ts - left.ts)[0]
      : undefined
    if (lastCitation !== undefined) {
      const cited = this.core.get(lastCitation.memoryId)
      if (cited !== undefined) {
        const snippet = lastCitation.snippet !== undefined && lastCitation.snippet.length > 0
          ? '“' + lastCitation.snippet.slice(0, 60) + '…”'
          : '「' + cited.title.slice(0, 28) + '…」'
        return {
          text: '前额叶命中 1 条 · ' + snippet + ' · 这条记忆刚刚被引用。',
          region: 'pfc',
          ts: lastCitation.ts,
          ...(snippet !== '' ? { snippet: lastCitation.snippet ?? '' } : {}),
        }
      }
    }
    const recentPreferences = this.core.list({ kind: 'preference', status: 'active', limit: 1, sort: 'updatedAt', order: 'desc' })
    if (recentPreferences.items.length > 0) {
      const preference = recentPreferences.items[0]!
      return {
        text: '杏仁核识别到 1 条偏好 · 命中率 ' + String(preference.recallCount) + '×。',
        region: 'amy',
        ts: preference.updatedAt,
      }
    }
    const recent = this.core.list({ status: 'active', limit: 1, sort: 'updatedAt', order: 'desc' })
    if (recent.items.length > 0) {
      const memory = recent.items[0]!
      return {
        text: '记忆库已更新：最近写入「' + memory.title.slice(0, 24) + '…」 · 共 ' + String(usage.total) + ' 条。',
        region: 'cortex',
        ts: memory.updatedAt,
      }
    }
    return {
      text: '还没有沉淀的记忆。先建一条试试，或让 AI 自动写入。',
      region: 'cortex',
      ts: Date.now(),
    }
  }

  subscribe(listener: (change: HippomemoChanged) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Fire-and-forget persistence of counter bumps (search hits); failures only downgrade analytics. */
  private persistChanged(records: MemoryRecord[]): void {
    for (const record of records) {
      this.requireTable().put(record.id, record).catch(error => {
        this.ctx.logger.warn('hippomemo: recall counter persist failed: ' + String(error))
      })
    }
  }

  /** Record a hard 'link' citation for every existing memory referenced by this record. */
  private citeLinks(record: MemoryRecord): void {
    const references = [...(record.relatedIds ?? []), ...(record.supersedes === undefined || record.supersedes === null ? [] : [record.supersedes])]
    const seen = new Set<MemoryId>()
    for (const reference of references) {
      if (reference === record.id || seen.has(reference)) continue
      seen.add(reference)
      if (this.core.get(reference) === undefined) continue
      void this.cite({ memoryId: reference, sessionId: record.sourceSessionId, kind: 'link' }).catch(error => {
        this.ctx.logger.warn('hippomemo: link citation failed: ' + String(error))
      })
    }
  }

  private newId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    return 'cit-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
  }

  private requireTable(): KvTable<MemoryId, MemoryRecord> {
    if (this.table === undefined) throw new Error('hippomemo: domain is not open')
    return this.table
  }

  private requireCitationTable(): KvTable<MemoryId, CitationRecord> {
    if (this.citationTable === undefined) throw new Error('hippomemo: domain is not open')
    return this.citationTable
  }

  private emit(change: HippomemoChanged): void {
    for (const listener of this.listeners) {
      try { listener(change) } catch (error) { this.ctx.logger.warn('hippomemo: change listener failed: ' + String(error)) }
    }
    try {
      this.ctx.emit('hippomemo/changed', change)
    } catch (error) {
      this.ctx.logger.warn('hippomemo: cordis change listener failed: ' + String(error))
    }
  }
}

// ---- preference-zone helpers (pure) ----

const PREFERENCE_HALF_LIFE_DAYS = 30
const PREFERENCE_DECAY_FLOOR = 40

/**
 * Heuristic for "is this preference user-declared or auto-mined": if the
 * record carries an explicit `updatedBy: 'human'` author tag it is always
 * manual; otherwise we treat an agent-written record that survived at least
 * one recall as 'auto' (spark's valence miner is the producer). Defaults to
 * 'manual' when uncertain so the UI never over-claims an automatic origin.
 */
function detectPreferenceSource(record: MemoryRecord): PreferenceRecord['source'] {
  if (record.updatedBy === 'human') return 'manual'
  if (record.updatedBy === 'agent') return 'auto'
  // 'system' defaults: sourceSparkId present → auto crystallised from a spark
  return record.sourceSparkId !== undefined && record.sourceSparkId !== null && record.sourceSparkId.length > 0
    ? 'auto'
    : 'manual'
}

/**
 * Compute a 0..100 decay percent for the preference zone. Mirrors the
 * existing recencyDecay curve but maps to a percentage and returns null when
 * the preference is either freshly written or global-confirmed (no decay).
 */
function computePreferenceDecay(record: MemoryRecord, now: number): number | null {
  if (record.scope === 'global' && record.globalProven === true) return null
  const anchor = record.lastRecalledAt ?? record.updatedAt
  const ageDays = Math.max(0, (now - anchor) / 86_400_000)
  if (ageDays <= 0) return null
  const raw = Math.pow(0.5, ageDays / PREFERENCE_HALF_LIFE_DAYS)
  // recencyDecay is clamped to [floor, 1] — express the *lost* fraction so
  // the UI can label "衰减中 60%" when raw dropped 0.40 below 1.0.
  const decay = Math.max(PREFERENCE_DECAY_FLOOR / 100, raw)
  const lost = Math.max(0, Math.min(100, Math.round((1 - decay) * 100)))
  return lost === 0 ? null : lost
}

export { detectPreferenceSource, computePreferenceDecay }

export default MemoryService
