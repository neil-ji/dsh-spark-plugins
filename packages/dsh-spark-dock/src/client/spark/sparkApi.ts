/**
 * Minimal sparks API subset for the dock (fetch wrapper mirrors
 * dsh-spark-ui/src/client/api.ts; keep in sync or converge into a shared
 * client package later — dock intentionally does NOT import dsh-spark-ui/client
 * because its index has settings-section registration side effects).
 */
import type { SparkView, SparkCapture, ProposalView, ProposalStatus, ScriptView } from 'dsh-spark-wire'

interface Envelope { ok: boolean; value?: unknown; error?: { code: string; message: string } }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...(init ?? {}),
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await response.json()) as Envelope
  if (response.ok === false || body.ok === false) {
    throw new Error(body.error?.message ?? 'sparks request failed')
  }
  return body.value as T
}

const SOURCE = 'spark-dock'

export interface DockSparksApi {
  list(query?: { status?: 'active' | 'archived'; limit?: number }): Promise<SparkView[]>
  capture(input: { title: string; content: string; scope: 'project' | 'global'; tags: string[] }): Promise<SparkView>
  archive(id: string): Promise<SparkView>
  crystallize(id: string): Promise<unknown>
  listProposals(query?: { status?: ProposalStatus; limit?: number }): Promise<ProposalView[]>
  resolveProposal(id: string, status: 'accepted' | 'dismissed'): Promise<ProposalView>
  reflect(): Promise<unknown>
  listScripts(limit?: number): Promise<ScriptView[]>
  invokeScript(id: string): Promise<unknown>
}

export function createDockSparksApi(): DockSparksApi {
  return {
    async list(query = {}) {
      const params = new URLSearchParams()
      if (query.status !== undefined) params.set('status', query.status)
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      const qs = params.toString()
      return request<SparkView[]>('/sparks' + (qs.length > 0 ? '?' + qs : ''))
    },
    async capture(input) {
      const body: SparkCapture = {
        title: input.title, content: input.content, scope: input.scope, tags: input.tags,
        workspacePath: null, sourceSessionId: SOURCE, sourceAgentId: null, sourceTurn: null,
      }
      return request<SparkView>('/sparks', { method: 'POST', body: JSON.stringify(body) })
    },
    async archive(id) {
      return request<SparkView>(`/sparks/${encodeURIComponent(id)}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'archived' }),
      })
    },
    async crystallize(id) {
      return request(`/sparks/${encodeURIComponent(id)}/crystallize`, { method: 'POST', body: '{}' })
    },
    async listProposals(query = {}) {
      const params = new URLSearchParams()
      if (query.status !== undefined) params.set('status', query.status)
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      const qs = params.toString()
      return request<ProposalView[]>('/proposals' + (qs.length > 0 ? '?' + qs : ''))
    },
    async resolveProposal(id, status) {
      return request<ProposalView>(`/proposals/${encodeURIComponent(id)}/resolve`, {
        method: 'POST', body: JSON.stringify({ status }),
      })
    },
    async reflect() {
      return request('/proposals/reflect', { method: 'POST', body: '{}' })
    },
    async listScripts(limit = 50) {
      return request<ScriptView[]>('/scripts?limit=' + String(limit))
    },
    async invokeScript(id) {
      return request(`/scripts/${encodeURIComponent(id)}/invoke`, { method: 'POST', body: '{}' })
    },
  }
}
