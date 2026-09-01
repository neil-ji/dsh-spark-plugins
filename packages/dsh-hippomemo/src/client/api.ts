/** Tiny fetch wrapper for the plugin-owned /hippomemo API. */

import type {
  CitationListQuery, CitationListResult, EvolveReport, MemoryListQuery, MemoryListResult,
  MemoryPatchInput, MemoryPutInput, MemoryRecord, MemoryStats, MemoryUsageStats,
  PendingCandidateListResult, PreferenceListQuery, PreferenceListResult, RecallNarrative,
} from '../types.ts'

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
      const source = new EventSource('/hippomemo/events')
      source.onmessage = (event) => {
        try { onChange(JSON.parse(event.data)) } catch { /* ignore malformed keepalive frames */ }
      }
      return () => { source.close() }
    },
  }
}