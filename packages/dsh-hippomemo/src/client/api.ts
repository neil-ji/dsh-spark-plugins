/** Tiny fetch wrapper for the plugin-owned /hippomemo API. */

import { subscribeFrames, type StreamRemote } from 'dsh-spark-plugin-kit/client'
import type { HippomemoStreamFrame } from '../wire.ts'
import type {
  CitationListQuery, CitationListResult, EvolveReport, MemoryListQuery, MemoryListResult,
  MemoryPatchInput, MemoryPutInput, MemoryRecord, MemoryStats, MemoryUsageStats,
  PendingCandidateListResult, PreferenceListQuery, PreferenceListResult, RecallNarrative,
} from '../types.ts'

/**
 * 记忆事件流客户端面（结构镜像；契约在 `../wire.ts`）。
 *
 * 平台规则（真宿主实测）：`remote.hippomemo` **不能写进 inject**（它是本包 `$mount`
 * 之后才提供的服务，注入会死锁），只能 `ctx.reflect.get('remote.hippomemo')`；
 * `$stream` 在 `ctx.remote` 上。所以通道由 embedder 组装一次后注入本模块。
 */
export interface HippomemoEventsFace {
  events(signal?: AbortSignal): AsyncIterable<HippomemoStreamFrame>
}

export interface HippomemoEventChannel {
  readonly remote: StreamRemote
  readonly events: HippomemoEventsFace
}

/** 逻辑流名（与宿主方法同名，同时是 kit 订阅运行时的复用键）。 */
export const HIPPOMEMO_EVENTS_STREAM = 'hippomemo/events'

let channel: HippomemoEventChannel | null = null

/**
 * 注入事件通道（由 client apply / dock embed 在 `$mount` 之后调用）。
 * @param next - 组装好的通道；null 表示不可用（降级为不订阅）。
 */
export function setHippomemoEventChannel(next: HippomemoEventChannel | null): void {
  channel = next
}

/**
 * 组装通道（`$mount` 之后调用）。
 * @param remote - `ctx.remote`（提供 `$stream`）。
 * @param reflect - `ctx.reflect`（取回动态命名空间）。
 */
export function hippomemoChannelOf(
  remote: StreamRemote,
  reflect: { get(id: string): unknown },
): HippomemoEventChannel | null {
  const namespace = reflect.get('remote.hippomemo') as HippomemoEventsFace | undefined
  if (namespace === undefined || namespace === null || typeof namespace.events !== 'function') return null
  return { remote, events: namespace }
}

interface Envelope {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...(init ?? {}),
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = (await response.json()) as Envelope
  if (response.ok === false || body.ok === false) {
    const message = body.error?.message ?? 'hippomemo request failed'
    throw new Error(message)
  }
  return body.value as T
}

function queryString(query: MemoryListQuery = {}): string {
  const params = new URLSearchParams()
  if (query.q !== undefined) params.set('q', query.q)
  if (query.kind !== undefined) params.set('kind', query.kind)
  if (query.scope !== undefined) params.set('scope', query.scope)
  if (query.status !== undefined) params.set('status', query.status)
  if (query.tag !== undefined) params.set('tag', query.tag)
  if (query.modelId !== undefined) params.set('modelId', query.modelId)
  if (query.workspacePath !== undefined) params.set('workspacePath', query.workspacePath)
  if (query.sort !== undefined) params.set('sort', query.sort)
  if (query.order !== undefined) params.set('order', query.order)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', String(query.cursor))
  const value = params.toString()
  return value.length > 0 ? '?' + value : ''
}

export interface MemoryTagCount {
  tag: string
  count: number
}

function citationQueryString(query: CitationListQuery = {}): string {
  const params = new URLSearchParams()
  if (query.memoryId !== undefined) params.set('memoryId', query.memoryId)
  if (query.kind !== undefined) params.set('kind', query.kind)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', String(query.cursor))
  const value = params.toString()
  return value.length > 0 ? '?' + value : ''
}

function preferenceQueryString(query: PreferenceListQuery = {}): string {
  const params = new URLSearchParams()
  if (query.decayFloor !== undefined) params.set('decayFloor', String(query.decayFloor))
  if (query.source !== undefined) params.set('source', query.source)
  const value = params.toString()
  return value.length > 0 ? '?' + value : ''
}

export interface HippomemoApi {
  list(query?: MemoryListQuery): Promise<MemoryListResult>
  get(id: string): Promise<MemoryRecord | null>
  create(input: MemoryPutInput): Promise<MemoryRecord>
  update(id: string, patch: MemoryPatchInput): Promise<MemoryRecord>
  remove(id: string): Promise<boolean>
  stats(): Promise<MemoryStats>
  tags(): Promise<MemoryTagCount[]>
  usage(): Promise<MemoryUsageStats>
  citations(query?: CitationListQuery): Promise<CitationListResult>
  evolveLast(): Promise<EvolveReport | null>
  evolveRun(dryRun: boolean): Promise<EvolveReport>
  /** v3 UI: live preference zone (kind=preference with derived source + decay). */
  preferences(query?: PreferenceListQuery): Promise<PreferenceListResult>
  /** v3 UI: live pending candidates (F11 dry-run over the active set). */
  candidates(): Promise<PendingCandidateListResult>
  /** v3 UI: brain-strip narration row (F10-light fallback). */
  narrative(): Promise<RecallNarrative>
  events(onChange: (event: { operation: string; id: string }) => void): () => void
}

export function createHippomemoApi(): HippomemoApi {
  return {
    list: query => request<MemoryListResult>('/hippomemo/records' + queryString(query)),
    get: id => request<MemoryRecord | null>('/hippomemo/records/' + encodeURIComponent(id)),
    create: input => request<MemoryRecord>('/hippomemo/records', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    update: (id, patch) => request<MemoryRecord>('/hippomemo/records/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
    remove: id => request<boolean>('/hippomemo/records/' + encodeURIComponent(id), { method: 'DELETE' }),
    stats: () => request<MemoryStats>('/hippomemo/stats'),
    tags: () => request<MemoryTagCount[]>('/hippomemo/tags'),
    usage: () => request<MemoryUsageStats>('/hippomemo/usage'),
    citations: query => request<CitationListResult>('/hippomemo/citations' + citationQueryString(query)),
    evolveLast: () => request<EvolveReport | null>('/hippomemo/evolve/last'),
    evolveRun: dryRun => request<EvolveReport>('/hippomemo/evolve', {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),
    preferences: query => request<PreferenceListResult>('/hippomemo/preferences' + preferenceQueryString(query)),
    candidates: () => request<PendingCandidateListResult>('/hippomemo/candidates'),
    narrative: () => request<RecallNarrative>('/hippomemo/narrative'),
    events: (onChange) => {
      // 统一事件通道（ADR-001）：不再 new EventSource，改走 kit 的引用计数订阅。
      // 同一 name 只有一条逻辑流，所以 MemorySection 的两处订阅点自动收敛为一条连接；
      // `ready` 基线帧也会回调（世代之间的窗口不回放，消费者据此重取）。
      if (channel === null) {
        console.warn('[dsh-hippomemo] 事件通道不可用，记忆面板将失去实时刷新')
        return () => {}
      }
      const active = channel
      return subscribeFrames<HippomemoStreamFrame>(active.remote, {
        name: HIPPOMEMO_EVENTS_STREAM,
        open: (signal) => active.events.events(signal),
        kinds: ['memory'],
        onFrame: (frame) => { if (frame.kind === 'memory') onChange({ operation: frame.payload.operation, id: frame.payload.id }) },
        onReady: () => { onChange({ operation: 'put', id: '' }) },
      })
    },
  }
}