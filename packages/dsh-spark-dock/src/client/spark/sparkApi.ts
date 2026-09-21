/**
 * Minimal sparks API subset for the dock (fetch wrapper over the spark host's
 * `/sparks` `/proposals` `/scripts` routes).
 *
 * 2026-09-14：收件箱化 —— 列表按 `inboxState` 过滤（取代旧的 status=active|archived），
 * 新增 `/sparks/stats`（计数）与 `/sparks/:id/restore`（从墓碑恢复）。
 */
import type { SparkView, SparkCapture, SparkInboxState, SparkStats, SparkGraph, ProposalView, ProposalStatus } from 'dsh-spark-wire'
import type { ScriptView } from 'dsh-script-wire'

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

export interface SparkListQuery {
  inboxState?: SparkInboxState
  includeDeleted?: boolean
  limit?: number
}

/** 面板各 pane 共用的单例：图 pane 拆到独立文件后不再靠「同文件 const」共享。 */
export const api: DockSparksApi = createDockSparksApi()

export interface DockSparksApi {
  list(query?: SparkListQuery): Promise<SparkView[]>
  stats(): Promise<SparkStats>
  /** 关联图谱（节点/边口径全在宿主，客户端只渲染）。 */
  graph(limit?: number): Promise<SparkGraph>
  capture(input: { title: string; content: string; scope: 'project' | 'global'; tags: string[] }): Promise<SparkView>
  setInboxState(id: string, inboxState: SparkInboxState): Promise<SparkView>
  archive(id: string): Promise<SparkView>
  /** 丢弃＝物理删除（不可恢复）；二次确认由 UI 的 Modal 负责。 */
  drop(id: string): Promise<{ removed: boolean }>
  restore(id: string): Promise<SparkView>
  crystallize(id: string): Promise<unknown>
  listProposals(query?: { status?: ProposalStatus; limit?: number }): Promise<ProposalView[]>
  resolveProposal(id: string, status: 'accepted' | 'dismissed'): Promise<ProposalView>
  reflect(): Promise<unknown>
  listScripts(limit?: number): Promise<ScriptView[]>
  invokeScript(id: string): Promise<unknown>
}

/** `inboxState: 'crystallized'` 只能通过 crystallize 端点到达（它带 hippo 链接），API 层不再暴露。 */
function enc(id: string): string {
  return encodeURIComponent(id)
}

export function createDockSparksApi(): DockSparksApi {
  return {
    async list(query = {}) {
      const params = new URLSearchParams()
      if (query.inboxState !== undefined) params.set('inboxState', query.inboxState)
      if (query.includeDeleted === true) params.set('includeDeleted', 'true')
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      const qs = params.toString()
      return request<SparkView[]>('/sparks' + (qs.length > 0 ? '?' + qs : ''))
    },
    async graph(limit) {
      const qs = limit === undefined ? '' : '?limit=' + String(limit)
      return request<SparkGraph>('/sparks/graph' + qs)
    },
    async stats() {
      return request<SparkStats>('/sparks/stats')
    },
    async capture(input) {
      const body: SparkCapture = {
        title: input.title, content: input.content, scope: input.scope, tags: input.tags,
        workspacePath: null, sourceSessionId: SOURCE, sourceAgentId: null, sourceTurn: null,
      }
      return request<SparkView>('/sparks', { method: 'POST', body: JSON.stringify(body) })
    },
    async setInboxState(id, inboxState) {
      return request<SparkView>('/sparks/' + enc(id), {
        method: 'PATCH', body: JSON.stringify({ inboxState }),
      })
    },
    async archive(id) {
      return request<SparkView>('/sparks/' + enc(id), {
        method: 'PATCH', body: JSON.stringify({ inboxState: 'archived' }),
      })
    },
    async drop(id) {
      // 物理删除端点（宿主 storage.purge）：不再是 inboxState='dropped' 的逻辑删除。
      return request<{ removed: boolean }>('/sparks/' + enc(id) + '/purge', { method: 'POST', body: '{}' })
    },
    async restore(id) {
      return request<SparkView>('/sparks/' + enc(id) + '/restore', { method: 'POST', body: '{}' })
    },
    async crystallize(id) {
      return request('/sparks/' + enc(id) + '/crystallize', { method: 'POST', body: '{}' })
    },
    async listProposals(query = {}) {
      const params = new URLSearchParams()
      if (query.status !== undefined) params.set('status', query.status)
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      const qs = params.toString()
      return request<ProposalView[]>('/proposals' + (qs.length > 0 ? '?' + qs : ''))
    },
    async resolveProposal(id, status) {
      return request<ProposalView>('/proposals/' + enc(id) + '/resolve', {
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
      return request('/scripts/' + enc(id) + '/invoke', { method: 'POST', body: '{}' })
    },
  }
}
