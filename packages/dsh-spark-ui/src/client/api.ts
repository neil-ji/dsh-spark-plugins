/**
 * Tiny fetch wrapper for the plugin-owned /sparks, /proposals, and /scripts API.
 */
import type { SparkView, SparkCapture, SparkCrystallize, ProposalView, ProposalStatus, ProposalType, ScriptView, ScriptCapture, ScriptStep } from 'dsh-spark-wire'

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
    const message = body.error?.message ?? 'sparks request failed'
    const code = body.error?.code ?? 'BAD_REQUEST'
    const err = new Error(message) as Error & { code?: string; httpStatus?: number }
    err.code = code
    err.httpStatus = response.status
    throw err
  }
  return body.value as T
}

export interface CrystallizeResult {
  spark: SparkView
  record: { id: string; kind: 'insight' | 'decision' | 'fact' | 'preference' | 'constraint' }
}

export interface ReflectResult {
  newProposals: ProposalView[]
  candidatesGenerated: number
  skippedDuplicate: number
}

export interface ScriptInvokeResult {
  script: ScriptView
  successRate: number
}

export interface SparksApi {
  list(query?: { status?: 'active' | 'archived'; scope?: 'session' | 'project' | 'global'; limit?: number }): Promise<SparkView[]>
  get(id: string): Promise<SparkView | null>
  capture(input: SparkCapture): Promise<SparkView>
  archive(id: string): Promise<SparkView>
  delete(id: string): Promise<void>
  crystallize(id: string, opts?: Partial<SparkCrystallize>): Promise<CrystallizeResult>
  listProposals(query?: { status?: ProposalStatus; type?: ProposalType; limit?: number }): Promise<ProposalView[]>
  resolveProposal(id: string, status: 'accepted' | 'dismissed'): Promise<ProposalView>
  reflect(opts?: { candidateLimit?: number; linkThreshold?: number; clusterMinSharedTags?: number; pruneStaleDays?: number }): Promise<ReflectResult>
  subscribe(onChange: () => void): () => void
  subscribeProposals(onChange: () => void): () => void
  listScripts(query?: { scope?: 'session' | 'project' | 'global'; q?: string; limit?: number }): Promise<ScriptView[]>
  getScript(id: string): Promise<ScriptView | null>
  createScript(input: ScriptCapture): Promise<ScriptView>
  invokeScript(id: string): Promise<ScriptInvokeResult>
  recordScriptResult(id: string, success: boolean): Promise<ScriptView>
  deleteScript(id: string): Promise<void>
  subscribeScripts(onChange: () => void): () => void
}

export function createSparksApi(): SparksApi {
  return {
    async list(query = {}) {
      const params = new URLSearchParams()
      if (query.status !== undefined) params.set('status', query.status)
      if (query.scope !== undefined) params.set('scope', query.scope)
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      const qs = params.toString()
      return request<SparkView[]>('/sparks' + (qs.length > 0 ? '?' + qs : ''))
    },
    async get(id) {
      try {
        return await request<SparkView | null>('/sparks/' + encodeURIComponent(id))
      } catch (error) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'NOT_FOUND') return null
        throw error
      }
    },
    async capture(input) {
      return await request<SparkView>('/sparks', { method: 'POST', body: JSON.stringify(input) })
    },
    async archive(id) {
      return await request<SparkView>('/sparks/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) })
    },
    async delete(id) {
      await request<{ removed: boolean }>('/sparks/' + encodeURIComponent(id), { method: 'DELETE' })
    },
    async crystallize(id, opts = {}) {
      return await request<CrystallizeResult>('/sparks/' + encodeURIComponent(id) + '/crystallize', { method: 'POST', body: JSON.stringify(opts) })
    },
    async listProposals(query = {}) {
      const params = new URLSearchParams()
      if (query.status !== undefined) params.set('status', query.status)
      if (query.type !== undefined) params.set('type', query.type)
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      const qs = params.toString()
      return request<ProposalView[]>('/proposals' + (qs.length > 0 ? '?' + qs : ''))
    },
    async resolveProposal(id, status) {
      return await request<ProposalView>('/proposals/' + encodeURIComponent(id) + '/resolve', { method: 'POST', body: JSON.stringify({ status }) })
    },
    async reflect(opts = {}) {
      return await request<ReflectResult>('/proposals/reflect', { method: 'POST', body: JSON.stringify(opts) })
    },
    async listScripts(query = {}) {
      const params = new URLSearchParams()
      if (query.scope !== undefined) params.set('scope', query.scope)
      if (query.q !== undefined && query.q.length > 0) params.set('q', query.q)
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      const qs = params.toString()
      return request<ScriptView[]>('/scripts' + (qs.length > 0 ? '?' + qs : ''))
    },
    async getScript(id) {
      try {
        return await request<ScriptView | null>('/scripts/' + encodeURIComponent(id))
      } catch (error) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'NOT_FOUND') return null
        throw error
      }
    },
    async createScript(input) {
      return await request<ScriptView>('/scripts', { method: 'POST', body: JSON.stringify(input) })
    },
    async invokeScript(id) {
      return await request<ScriptInvokeResult>('/scripts/' + encodeURIComponent(id) + '/invoke', { method: 'POST' })
    },
    async recordScriptResult(id, success) {
      return await request<ScriptView>('/scripts/' + encodeURIComponent(id) + '/result', { method: 'POST', body: JSON.stringify({ success }) })
    },
    async deleteScript(id) {
      await request<{ removed: boolean }>('/scripts/' + encodeURIComponent(id), { method: 'DELETE' })
    },
    subscribe(onChange) {
      let stopped = false
      let es: EventSource | null = null
      const connect = (): void => {
        if (stopped) return
        es = new EventSource('/sparks/events')
        es.onmessage = () => { onChange() }
        es.onerror = () => { if (es !== null) es.close(); if (!stopped) setTimeout(connect, 2000) }
      }
      connect()
      return () => { stopped = true; if (es !== null) es.close() }
    },
    subscribeProposals(onChange) {
      let stopped = false
      let es: EventSource | null = null
      const connect = (): void => {
        if (stopped) return
        es = new EventSource('/proposals/events')
        es.onmessage = () => { onChange() }
        es.onerror = () => { if (es !== null) es.close(); if (!stopped) setTimeout(connect, 2000) }
      }
      connect()
      return () => { stopped = true; if (es !== null) es.close() }
    },
    subscribeScripts(onChange) {
      let stopped = false
      let es: EventSource | null = null
      const connect = (): void => {
        if (stopped) return
        es = new EventSource('/scripts/events')
        es.onmessage = () => { onChange() }
        es.onerror = () => { if (es !== null) es.close(); if (!stopped) setTimeout(connect, 2000) }
      }
      connect()
      return () => { stopped = true; if (es !== null) es.close() }
    },
  }
}
