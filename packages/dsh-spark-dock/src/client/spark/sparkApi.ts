/**
 * Minimal sparks API subset for the dock (fetch wrapper over the spark host's
 * `/sparks` `/proposals` routes；脚本 API 随脚本沉淀库迁到 `dsh-script-client`）。
 *
 * 2026-09-21（v2 P11）：状态回退为 `status: 'active' | 'archived'`；
 * 列表按 `status` 过滤，新增 `/sparks/stats`（计数）与 `/sparks/:id/restore`（从墓碑恢复）。
 */
import type { SparkView, SparkCapture, SparkStatus, SparkStats, SparkGraph, ProposalView, ProposalStatus } from 'dsh-spark-wire'

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
  status?: SparkStatus
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
  setStatus(id: string, status: SparkStatus): Promise<SparkView>
  archive(id: string): Promise<SparkView>
  /** 丢弃＝物理删除（不可恢复）；二次确认由 UI 的 Modal 负责。 */
  drop(id: string): Promise<{ removed: boolean }>
  restore(id: string): Promise<SparkView>
  listProposals(query?: { status?: ProposalStatus; limit?: number }): Promise<ProposalView[]>
  resolveProposal(id: string, status: 'accepted' | 'dismissed'): Promise<ProposalView>
  reflect(): Promise<unknown>
}

function enc(id: string): string {
  return encodeURIComponent(id)
}

export function createDockSparksApi(): DockSparksApi {
  return {
    async list(query = {}) {
      const params = new URLSearchParams()
      if (query.status !== undefined) params.set('status', query.status)
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
    async setStatus(id, status) {
      return request<SparkView>('/sparks/' + enc(id), {
        method: 'PATCH', body: JSON.stringify({ status }),
      })
    },
    async archive(id) {
      return request<SparkView>('/sparks/' + enc(id), {
        method: 'PATCH', body: JSON.stringify({ status: 'archived' }),
      })
    },
    async drop(id) {
      // 物理删除端点（宿主 storage.purge）：不再是 inboxState='dropped' 的逻辑删除。
      return request<{ removed: boolean }>('/sparks/' + enc(id) + '/purge', { method: 'POST', body: '{}' })
    },
    async restore(id) {
      return request<SparkView>('/sparks/' + enc(id) + '/restore', { method: 'POST', body: '{}' })
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
  }
}
