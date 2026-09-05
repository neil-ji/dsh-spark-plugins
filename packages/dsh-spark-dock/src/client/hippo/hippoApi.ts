/**
 * Minimal hippomemo API subset for the dock (wrapper mirrors
 * dsh-hippomemo/src/client/api.ts; dock does not import dsh-hippomemo/client
 * because its index carries settings-registration side effects).
 */
interface Envelope { ok: boolean; value?: unknown; error?: { code: string; message: string } }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...(init ?? {}),
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await response.json()) as Envelope
  if (response.ok === false || body.ok === false) {
    throw new Error(body.error?.message ?? 'hippomemo request failed')
  }
  return body.value as T
}

export interface MemoryStats {
  total: number
  active: number
  archived: number
  superseded: number
  candidate: number
}

export interface MemoryRow {
  id: string
  kind: string
  title: string
  scope: string
  status: string
  importance: number
  updatedAt: number
}

export interface MemoryListResult { items: MemoryRow[] }

export interface PendingCandidate {
  id: string
  kind: string
  title: string
  reason: string
  memoryKind: string
  suggestedAction: string
}

export interface PendingCandidateListResult {
  items: PendingCandidate[]
  byKind: Record<string, number>
  total: number
}

export interface RecallNarrative {
  text: string
  region: 'pfc' | 'amy' | 'hippo' | 'cortex'
  ts: number
  snippet?: string | undefined
}

export interface PreferenceRow {
  id: string
  title: string
  source: 'auto' | 'manual'
  hitCount: number
}

export interface PreferenceListResult { items: PreferenceRow[]; total: number }

export interface EvolveReport { actions?: unknown[] }

export interface DockHippomemoApi {
  stats(): Promise<MemoryStats>
  list(query?: { q?: string; limit?: number }): Promise<MemoryListResult>
  candidates(): Promise<PendingCandidateListResult>
  narrative(): Promise<RecallNarrative>
  preferences(): Promise<PreferenceListResult>
  evolveRun(dryRun: boolean): Promise<EvolveReport>
  events(onChange: () => void): () => void
}

export function createDockHippomemoApi(): DockHippomemoApi {
  return {
    stats: () => request<MemoryStats>('/hippomemo/stats'),
    list: (query = {}) => {
      const params = new URLSearchParams()
      if (query.q !== undefined) params.set('q', query.q)
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      const qs = params.toString()
      return request<MemoryListResult>('/hippomemo/records' + (qs.length > 0 ? '?' + qs : ''))
    },
    candidates: () => request<PendingCandidateListResult>('/hippomemo/candidates'),
    narrative: () => request<RecallNarrative>('/hippomemo/narrative'),
    preferences: () => request<PreferenceListResult>('/hippomemo/preferences'),
    evolveRun: (dryRun) => request<EvolveReport>('/hippomemo/evolve', {
      method: 'POST', body: JSON.stringify({ dryRun }),
    }),
    events: (onChange) => {
      const source = new EventSource('/hippomemo/events')
      source.onmessage = onChange
      return () => { source.close() }
    },
  }
}
