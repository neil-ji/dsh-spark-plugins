/**
 * Pure in-memory domain for HippoMemo. No Cordis or storage imports so the
 * whole model is unit-testable with node:test.
 */
import type {
  MemoryAuthor, MemoryId, MemoryKind, MemoryListQuery, MemoryListResult,
  MemoryPatchInput, MemoryPutInput, MemoryRecord, MemoryScope, MemorySearchHit,
  MemorySearchResult, MemorySortKey, MemorySortOrder, MemoryStats, MemoryStatus,
  MemoryUsageItem, MemoryUsageStats,
} from './types.ts'

export interface MemoryCoreConfig {
  maxMemories: number
  defaultRecallLimit: number
  maxRecallChars: number
}

export interface MemoryCoreDeps {
  now?: () => number
  newId?: () => string
}

const KIND_KEYS: MemoryKind[] = ['insight', 'decision', 'fact', 'preference', 'constraint']

function defaultNow(): number {
  return Date.now()
}

function defaultNewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'mem-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
}

/** Tokenize Latin words plus CJK unigrams and bigrams for small exact/partial search. */
export function tokenize(value: string): string[] {
  return [...new Set(tokenStream(value))]
}

/** Ordered, possibly-repeating token stream (used for tf/BM25 accounting). */
function tokenStream(value: string): string[] {
  const lower = value.toLocaleLowerCase()
  const out: string[] = []
  const latin = lower.match(/[a-z0-9_]+/g) ?? []
  out.push(...latin)
  const cjkRuns = lower.match(/\p{Script=Han}+/gu) ?? []
  for (const run of cjkRuns) {
    const chars = [...run]
    // CJK bigrams carry the recall signal; single characters are too noisy for
    // matching (an unrelated query and memory routinely share one hanzi, e.g.
    // 本/量/回/否), which produced the false-positive recalls. Keep the unigram
    // only for an isolated one-character run so single-character searches still work.
    if (chars.length === 1) {
      out.push(chars[0])
    } else {
      for (let index = 0; index < chars.length - 1; index += 1) out.push(chars[index] + chars[index + 1])
    }
  }
  return out
}

/** Function-word tokens that carry no recall signal; excluded from the index and from queries. */
const STOP_TOKENS = new Set<string>([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its', 'as', 'with', 'by', 'from', 'we', 'you', 'they', 'he', 'she', 'i',
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没', '看', '好', '自', '己', '这', '那', '之', '与', '及', '等', '为', '或', '对', '其', '可', '以', '们', '而', '且', '被', '把', '让', '从', '向', '于', '但', '又', '再', '只', '还', '否', '因', '所',
  '我们', '你们', '他们', '这个', '那个', '什么', '怎么', '为什么', '是否', '可以', '因为', '所以', '但是',
])

function isStopToken(token: string): boolean {
  return STOP_TOKENS.has(token)
}

const BM25_K1 = 1.2
const BM25_B = 0.75
const W_TITLE = 8
const W_TAG = 6
const W_CONTENT = 2

interface FieldFreq { title: number; content: number; tag: number }
interface FieldLength { title: number; content: number; tag: number }

/** idf(t) = ln(1 + (N - df + 0.5) / (df + 0.5)), clamped positive. */
function idfScore(docCount: number, docFreq: number): number {
  return Math.log(1 + (docCount - docFreq + 0.5) / (docFreq + 0.5))
}

/** BM25 term-frequency saturation with document-length normalization per field. */
function bm25Field(freq: number, length: number, avgLength: number): number {
  if (freq <= 0) return 0
  if (avgLength <= 0) return freq
  const denominator = freq + BM25_K1 * (1 - BM25_B + BM25_B * (length / avgLength))
  return (freq * (BM25_K1 + 1)) / denominator
}

/** Recency/importance ranking tiebreak; never gates recall on its own. */
function rankScore(record: MemoryRecord, now: number): number {
  const ageDays = Math.max(0, (now - record.updatedAt) / 86_400_000)
  return record.importance * 2 + Math.max(0, 2 - ageDays)
}

export function splitTags(value: string): string[] {
  return [...new Set(value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0))].slice(0, 32)
}

/** Fill usage counters on records that predate the analytics fields (or are otherwise partial). */
function completeRecord(record: MemoryRecord): MemoryRecord {
  if (record.searchTerms === undefined) record.searchTerms = []
  if (record.recallCount === undefined) record.recallCount = 0
  if (record.lastRecalledAt === undefined) record.lastRecalledAt = null
  if (record.citationCount === undefined) record.citationCount = 0
  if (record.lastCitedAt === undefined) record.lastCitedAt = null
  if (record.globalProven === undefined) record.globalProven = false
  return record
}

/**
 * Anti-pollution gate for automatic recall injection.
 *
 * A memory may be auto-injected into a workspace only when it is a *proven*
 * global (`scope === 'global'` and `globalProven`), or it is bound to that
 * exact workspace (`workspacePath === cwd`). A memory declared `global` but
 * not yet proven degrades to workspace-bound here, so a mislabeled or stale
 * global can never be injected into an unrelated workspace — it only
 * under-recalls, which is the harmless direction.
 *
 * Explicit searches (memory_search) intentionally keep the lenient behavior;
 * this gate targets the automatic <system-reminder> recall injection.
 */
export function isMemoryAutoInjectable(record: MemoryRecord, workspacePath?: string): boolean {
  if (record.scope === 'global' && record.globalProven === true) return true
  return workspacePath !== undefined && record.workspacePath === workspacePath
}

/** Filter search hits down to the ones that may be auto-injected in `workspacePath`. */
export function filterAutoInjection(items: MemorySearchHit[], workspacePath?: string): MemorySearchHit[] {
  return items.filter(hit => isMemoryAutoInjectable(hit.record, workspacePath))
}


function clampImportance(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function sortByUpdated(left: MemoryRecord, right: MemoryRecord): number {
  return right.updatedAt - left.updatedAt
}

function compareByKey(left: MemoryRecord, right: MemoryRecord, key: MemorySortKey): number {
  if (key === 'title') return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
  return (left[key] as number) - (right[key] as number)
}

/** Stable sort by key, then updatedAt desc as a deterministic tiebreak. */
export function sortRecords(records: MemoryRecord[], key: MemorySortKey = 'updatedAt', order: MemorySortOrder = 'desc'): MemoryRecord[] {
  const direction = order === 'asc' ? 1 : -1
  const sorted = [...records]
  sorted.sort((left, right) => {
    const byKey = compareByKey(left, right, key) * direction
    if (byKey !== 0) return byKey
    const byUpdated = sortByUpdated(left, right)
    if (key !== 'updatedAt' && byUpdated !== 0) return byUpdated
    return left.id.localeCompare(right.id)
  })
  return sorted
}

export interface NormalizeResult {
  record: MemoryRecord
  revisionBumped: boolean
}

/** Create or revise one record from untrusted input. */
export function normalizeRecord(input: MemoryPutInput, previous?: MemoryRecord, deps: MemoryCoreDeps = {}): NormalizeResult {
  const title = input.title.trim()
  if (title.length === 0) throw new TypeError('hippomemo: title must be non-empty')
  const content = input.content.trim()
  if (content.length === 0) throw new TypeError('hippomemo: content must be non-empty')

  const now = (deps.now ?? defaultNow)()
  const id = input.id ?? previous?.id ?? (deps.newId ?? defaultNewId)()
  const revision = previous === undefined ? 1 : previous.revision + 1

  const record: MemoryRecord = {
    id,
    kind: input.kind ?? previous?.kind ?? 'insight',
    title,
    content,
    tags: splitTags((input.tags ?? (previous !== undefined && Array.isArray(previous.tags) ? previous.tags : [])).join(',')),
    // Default to workspace (bound to the source) rather than global, so an
    // omitted scope never accidentally becomes an over-broad global. The
    // auto-injection gate treats an unproven global as workspace-bound anyway;
    // this keeps the stored label honest for explicit scope filters.
    scope: input.scope ?? previous?.scope ?? 'workspace',
    workspacePath: input.workspacePath === undefined ? previous?.workspacePath ?? null : input.workspacePath,
    globalProven: input.globalProven ?? previous?.globalProven ?? false,
    importance: clampImportance(input.importance ?? previous?.importance ?? 0.5),
    status: input.status ?? previous?.status ?? 'active',
    sourceSessionId: input.sourceSessionId ?? previous?.sourceSessionId ?? 'user',
    ...(input.sourceAgentId !== undefined || previous?.sourceAgentId !== undefined ? { sourceAgentId: input.sourceAgentId ?? previous?.sourceAgentId } : {}),
    ...(input.sourceTurn !== undefined || previous?.sourceTurn !== undefined ? { sourceTurn: input.sourceTurn ?? previous?.sourceTurn } : {}),
    revision,
    updatedBy: input.updatedBy ?? previous?.updatedBy ?? 'system',
    supersedes: input.supersedes === undefined ? previous?.supersedes ?? null : input.supersedes,
    supersededBy: input.supersededBy === undefined ? previous?.supersededBy ?? null : input.supersededBy,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    expiresAt: input.expiresAt === undefined ? previous?.expiresAt ?? null : input.expiresAt,
    relatedIds: [...new Set(input.relatedIds ?? previous?.relatedIds ?? [])].slice(0, 16),
    searchTerms: [...new Set(input.searchTerms ?? previous?.searchTerms ?? [])].slice(0, 32),
    recallCount: input.recallCount ?? previous?.recallCount ?? 0,
    lastRecalledAt: input.lastRecalledAt === undefined ? (previous?.lastRecalledAt ?? null) : input.lastRecalledAt,
    citationCount: input.citationCount ?? previous?.citationCount ?? 0,
    lastCitedAt: input.lastCitedAt === undefined ? (previous?.lastCitedAt ?? null) : input.lastCitedAt,
  }

  return { record, revisionBumped: previous !== undefined }
}

export class MemoryCore {
  private readonly records = new Map<MemoryId, MemoryRecord>()
  private readonly index = new Map<string, Map<MemoryId, FieldFreq>>()
  private readonly recordTokens = new Map<MemoryId, Set<string>>()
  private readonly fieldLengths = new Map<MemoryId, FieldLength>()
  private readonly totalFieldLengths: FieldLength = { title: 0, content: 0, tag: 0 }
  private readonly configSource: () => MemoryCoreConfig
  private readonly deps: Required<MemoryCoreDeps>

  /**
   * @param configSource - 读取当前配置的 thunk（设置命名空间热更新时返回新值；
   *   构造器接收 thunk 而非快照，限制项在每次操作时实时生效）。
   */
  constructor(configSource: () => MemoryCoreConfig, deps: MemoryCoreDeps = {}) {
    this.configSource = configSource
    this.deps = { now: deps.now ?? defaultNow, newId: deps.newId ?? defaultNewId }
  }

  get size(): number {
    return this.records.size
  }

  load(records: Iterable<MemoryRecord | readonly [MemoryId, MemoryRecord]>): void {
    this.records.clear()
    this.index.clear()
    this.recordTokens.clear()
    this.fieldLengths.clear()
    this.totalFieldLengths.title = 0
    this.totalFieldLengths.content = 0
    this.totalFieldLengths.tag = 0
    for (const item of records) {
      const record = completeRecord(Array.isArray(item) ? item[1] : item)
      this.records.set(record.id, record)
      this.indexRecord(record)
    }
  }

  entries(): IterableIterator<[MemoryId, MemoryRecord]> {
    return this.records.entries()
  }

  get(id: MemoryId): MemoryRecord | undefined {
    return this.records.get(id)
  }

  list(query: MemoryListQuery = {}): MemoryListResult {
    const limit = query.limit ?? 50
    const cursor = query.cursor ?? 0
    const filtered = sortRecords(this.filter(query), query.sort, query.order)
    const total = filtered.length
    const items = filtered.slice(cursor, cursor + limit)
    const nextCursor = cursor + items.length < total ? cursor + items.length : undefined
    return { items, total, ...(nextCursor === undefined ? {} : { nextCursor }) }
  }

  /** All distinct tags with usage counts, most-used first (name tiebreak). */
  allTags(): { tag: string; count: number }[] {
    const counts = new Map<string, number>()
    for (const record of this.records.values()) {
      if (Array.isArray(record.tags) === false) continue
      for (const tag of record.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
  }

  search(query: MemoryListQuery = {}): MemorySearchResult {
    const q = query.q?.trim().toLocaleLowerCase() ?? ''
    const limit = query.limit ?? this.configSource().defaultRecallLimit
    const qTokens = q.length === 0 ? [] : tokenStream(q).filter(token => isStopToken(token) === false)
    const filtered = this.filter(query)
    const docCount = this.records.size

    type Hit = { record: MemoryRecord; score: number; reasons: string[] }
    let hits: Hit[]

    if (qTokens.length === 0) {
      // No informative query: rank the scope by recency/importance only.
      hits = filtered.map(record => ({ record, score: rankScore(record, this.deps.now()), reasons: ['recency'] }))
    } else {
      const avgLength: FieldLength = docCount === 0
        ? { title: 0, content: 0, tag: 0 }
        : {
            title: this.totalFieldLengths.title / docCount,
            content: this.totalFieldLengths.content / docCount,
            tag: this.totalFieldLengths.tag / docCount,
          }
      const inScope = new Set(filtered.map(record => record.id))
      const matched = new Map<MemoryId, { score: number; reasons: Set<string>; tokens: Set<string> }>()
      for (const token of qTokens) {
        const postings = this.index.get(token)
        if (postings === undefined) continue
        const idf = idfScore(docCount, postings.size)
        for (const [id, freq] of postings) {
          if (inScope.has(id) === false) continue
          const record = this.records.get(id)
          if (record === undefined) continue
          const lengths = this.fieldLengths.get(id)
          if (lengths === undefined) continue
          const contribution = idf * (
            W_TITLE * bm25Field(freq.title, lengths.title, avgLength.title)
            + W_TAG * bm25Field(freq.tag, lengths.tag, avgLength.tag)
            + W_CONTENT * bm25Field(freq.content, lengths.content, avgLength.content)
          )
          if (contribution <= 0) continue
          let acc = matched.get(id)
          if (acc === undefined) {
            acc = { score: 0, reasons: new Set(), tokens: new Set() }
            matched.set(id, acc)
          }
          acc.tokens.add(token)
          acc.score += contribution
          if (freq.title > 0) acc.reasons.add('title')
          if (freq.tag > 0) acc.reasons.add('tag')
          if (freq.content > 0) acc.reasons.add('content')
        }
      }
      hits = [...matched.entries()]
        .filter(([id, acc]) => {
          // Global memories are eligible in every workspace, so they must carry
          // a stronger signal than a single accidental shared token (e.g. a common
          // latin word in prose). Title and tag/searchTerms hits are deliberate
          // index terms, so they count as strong signals on their own.
          const record = this.records.get(id)
          if (record === undefined || record.scope !== 'global') return true
          if (acc.tokens.size >= 2 || acc.reasons.has('title') || acc.reasons.has('tag')) return true
          return false
        })
        .map(([id, acc]) => ({
          record: this.records.get(id)!,
          score: acc.score,
          reasons: [...acc.reasons],
        }))
    }

    hits.sort((left, right) => right.score - left.score
      || rankScore(right.record, this.deps.now()) - rankScore(left.record, this.deps.now())
      || sortByUpdated(left.record, right.record))

    const budget = this.configSource().maxRecallChars
    let used = 0
    const items: MemorySearchHit[] = []
    for (const hit of hits) {
      if (items.length >= limit) break
      const size = hit.record.title.length + hit.record.content.length
      if (used + size > budget && items.length > 0) break
      items.push({ record: hit.record, matchedReason: hit.reasons })
      used += size
    }
    return { items, total: items.length }
  }

  put(input: MemoryPutInput): MemoryRecord {
    const previous = input.id === undefined ? undefined : this.records.get(input.id)
    const { record } = normalizeRecord(input, previous, this.deps)
    const config = this.configSource()
    if (previous === undefined && this.records.size >= config.maxMemories) {
      throw new Error('hippomemo: maxMemories (' + String(config.maxMemories) + ') reached')
    }
    this.commit(record)
    return record
  }

  /** Commit an already-persisted record into the in-memory index. */
  commit(record: MemoryRecord): void {
    this.records.set(record.id, record)
    this.indexRecord(record)
  }

  update(id: MemoryId, patch: MemoryPatchInput): MemoryRecord {
    const previous = this.records.get(id)
    if (previous === undefined) throw new Error('hippomemo: unknown memory "' + id + '"')
    const { record } = normalizeRecord({
      ...previous,
      ...patch,
      title: patch.title ?? previous.title,
      content: patch.content ?? previous.content,
    }, previous, this.deps)
    this.records.set(record.id, record)
    this.indexRecord(record)
    return record
  }

  delete(id: MemoryId): boolean {
    const existed = this.records.has(id)
    if (existed === false) return false
    this.records.delete(id)
    this.removeFromIndex(id)
    return true
  }

  /** Bump exposure counters for recalled ids; returns the mutated records (persistence is the caller's job). */
  markRecalled(ids: Iterable<MemoryId>, at: number = this.deps.now()): MemoryRecord[] {
    const changed: MemoryRecord[] = []
    for (const id of ids) {
      const record = this.records.get(id)
      if (record === undefined) continue
      record.recallCount = (record.recallCount ?? 0) + 1
      record.lastRecalledAt = at
      changed.push(record)
    }
    return changed
  }

  /** Bump citation counters for one memory; returns the record when it exists. */
  markCited(id: MemoryId, at: number = this.deps.now()): MemoryRecord | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    record.citationCount = (record.citationCount ?? 0) + 1
    record.lastCitedAt = at
    return record
  }

  /** Analytics over exposure vs reference, with a configurable staleness window in days. */
  usage(stalenessDays = 30): MemoryUsageStats {
    const now = this.deps.now()
    const staleCutoff = now - stalenessDays * 86_400_000
    const all = [...this.records.values()]
    const active = all.filter(record => record.status === 'active')
    const recalled = all.filter(record => (record.recallCount ?? 0) > 0)
    const cited = all.filter(record => (record.citationCount ?? 0) > 0)
    const neverRecalled = all.filter(record => (record.recallCount ?? 0) === 0)
    const stale = active.filter(record => {
      const last = record.lastRecalledAt
      return last === null || last === undefined || last < staleCutoff
    })
    const item = (record: MemoryRecord, count: number, lastAt: number | null): MemoryUsageItem => ({
      id: record.id,
      title: record.title,
      count,
      lastAt,
    })
    const topBy = (records: MemoryRecord[], key: 'recallCount' | 'citationCount', lastKey: 'lastRecalledAt' | 'lastCitedAt'): MemoryUsageItem[] =>
      [...records]
        .sort((left, right) => (right[key] ?? 0) - (left[key] ?? 0))
        .slice(0, 5)
        .map(record => item(record, record[key] ?? 0, record[lastKey] ?? null))
    const total = all.length
    return {
      total,
      active: active.length,
      recalled: recalled.length,
      cited: cited.length,
      neverRecalled: neverRecalled.length,
      staleCount: stale.length,
      recallRate: total === 0 ? 0 : recalled.length / total,
      citationRate: total === 0 ? 0 : cited.length / total,
      conversionRate: recalled.length === 0 ? 0 : cited.length / recalled.length,
      topRecalled: topBy(recalled, 'recallCount', 'lastRecalledAt'),
      topCited: topBy(cited, 'citationCount', 'lastCitedAt'),
      stale: [...stale].sort(sortByUpdated).slice(0, 5).map(record => item(record, record.recallCount ?? 0, record.lastRecalledAt ?? null)),
    }
  }

  stats(): MemoryStats {
    const byKind: Record<MemoryKind, number> = { insight: 0, decision: 0, fact: 0, preference: 0, constraint: 0 }
    let active = 0
    let archived = 0
    let superseded = 0
    let candidate = 0
    for (const record of this.records.values()) {
      byKind[record.kind] += 1
      if (record.status === 'active') active += 1
      else if (record.status === 'archived') archived += 1
      else if (record.status === 'superseded') superseded += 1
      else if (record.status === 'candidate') candidate += 1
    }
    return { total: this.records.size, active, archived, superseded, candidate, byKind }
  }

  private filter(query: MemoryListQuery): MemoryRecord[] {
    let records = [...this.records.values()]
    if (query.kind !== undefined) records = records.filter(record => record.kind === query.kind)
    if (query.status !== undefined) records = records.filter(record => record.status === query.status)
    const tag = query.tag
    if (tag !== undefined) records = records.filter(record => record.tags.includes(tag))
    if (query.scope === 'current') {
      records = records.filter(record =>
        record.scope === 'global' || (query.workspacePath !== undefined && record.workspacePath === query.workspacePath))
    } else if (query.scope !== undefined) {
      records = records.filter(record => record.scope === query.scope)
    } else if (query.workspacePath !== undefined) {
      records = records.filter(record => record.scope === 'global' || record.workspacePath === query.workspacePath)
    }
    return records
  }


  private indexRecord(record: MemoryRecord): void {
    this.removeFromIndex(record.id)
    const freq = new Map<string, FieldFreq>()
    const tokens = new Set<string>()
    const lengths: FieldLength = { title: 0, content: 0, tag: 0 }
    const accumulate = (value: string, field: 'title' | 'content' | 'tag'): void => {
      for (const token of tokenStream(value)) {
        if (isStopToken(token)) continue
        lengths[field] += 1
        tokens.add(token)
        let f = freq.get(token)
        if (f === undefined) {
          f = { title: 0, content: 0, tag: 0 }
          freq.set(token, f)
        }
        f[field] += 1
      }
    }
    accumulate(record.title, 'title')
    accumulate(record.content, 'content')
    const tags = Array.isArray(record.tags) ? record.tags : []
    for (const tag of tags) accumulate(tag, 'tag')
    const searchTerms = Array.isArray(record.searchTerms) ? record.searchTerms : []
    for (const term of searchTerms) accumulate(term, 'tag')

    this.fieldLengths.set(record.id, lengths)
    this.totalFieldLengths.title += lengths.title
    this.totalFieldLengths.content += lengths.content
    this.totalFieldLengths.tag += lengths.tag
    this.recordTokens.set(record.id, tokens)
    for (const [token, f] of freq) {
      let postings = this.index.get(token)
      if (postings === undefined) {
        postings = new Map()
        this.index.set(token, postings)
      }
      postings.set(record.id, f)
    }
  }

  private removeFromIndex(id: MemoryId): void {
    const tokens = this.recordTokens.get(id)
    if (tokens !== undefined) {
      for (const token of tokens) {
        const postings = this.index.get(token)
        if (postings === undefined) continue
        postings.delete(id)
        if (postings.size === 0) this.index.delete(token)
      }
      this.recordTokens.delete(id)
    }
    const lengths = this.fieldLengths.get(id)
    if (lengths !== undefined) {
      this.totalFieldLengths.title -= lengths.title
      this.totalFieldLengths.content -= lengths.content
      this.totalFieldLengths.tag -= lengths.tag
      this.fieldLengths.delete(id)
    }
  }
}
