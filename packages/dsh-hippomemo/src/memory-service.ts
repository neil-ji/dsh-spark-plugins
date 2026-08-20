/**
 * HippoMemo host service: durable storage-domain persistence plus the shared
 * in-memory MemoryCore used by tools, recall, HTTP, and SSE.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { hippomemoDomainSpec } from './spec.ts'
import { MemoryCore, normalizeRecord } from './memory-core.ts'
import type {
  CitationInput, CitationListQuery, CitationListResult, CitationRecord,
  HippomemoChanged, MemoryId, MemoryListQuery, MemoryListResult, MemoryPatchInput,
  MemoryPutInput, MemoryRecord, MemorySearchResult, MemoryStats, MemoryUsageStats,
} from './types.ts'
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
  maxMemories?: number
  defaultRecallLimit?: number
  maxRecallChars?: number
}

interface ResolvedConfig {
  maxMemories: number
  defaultRecallLimit: number
  maxRecallChars: number
}

/** 本插件拥有的设置命名空间（设置 → 插件 → 插件配置页可编辑）。 */
export const HIPPOMEMO_SETTINGS_NAMESPACE = settingsNamespace('hippomemo')

const DEFAULT_CONFIG: ResolvedConfig = {
  maxMemories: 10_000,
  defaultRecallLimit: 5,
  maxRecallChars: 8_000,
}

function resolveConfig(config: HippomemoConfig = {}): ResolvedConfig {
  const next = { ...DEFAULT_CONFIG, ...config }
  for (const key of Object.keys(next) as (keyof ResolvedConfig)[]) {
    if (Number.isSafeInteger(next[key]) === false || next[key] <= 0) {
      throw new TypeError('hippomemo: ' + key + ' must be a positive safe integer')
    }
  }
  return next
}

export class MemoryService extends Service {
  static inject = ['storageDomain', 'webServer']

  static Config = z.object({
    maxMemories: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxMemories),
    defaultRecallLimit: z.number().step(1).min(1).default(DEFAULT_CONFIG.defaultRecallLimit),
    maxRecallChars: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxRecallChars),
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
    installSettingsSection(ctx, HIPPOMEMO_SETTINGS_NAMESPACE, MemoryService.Config, config, {
      setSource: source => { this.configSource = () => resolveConfig(source()) },
      onChange: () => {},
    })
  }

  /** 当前生效配置（设置命名空间解析结果：默认值 → 组合层 → 用户层）。 */
  private currentConfig(): ResolvedConfig {
    return this.configSource()
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
      this.persistChanged(this.core.markRecalled(result.items.map(hit => hit.record.id)))
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

export default MemoryService
