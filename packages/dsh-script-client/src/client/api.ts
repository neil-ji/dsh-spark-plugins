/**
 * 脚本沉淀库的 HTTP 子集（宿主 `dsh-script` 的 `/scripts` 前缀）。
 *
 * 事件推送不走这里：变更经 `script/events`（typert stream）下发，见 ScriptsPane 的
 * `useFrames`。本文件只有请求-响应端点。
 *
 * 注意 `/scripts` 返回的是**读模型**（`ScriptSummary`，不含 steps，成功率由宿主算好）——
 * 要看全文步骤用 `get(id)`；要结算过期用 `audit()`（Spec §6.5 / D7）。
 */
import type { ScriptAdvice, ScriptAudit, ScriptScope, ScriptStatus, ScriptSummary, ScriptView } from 'dsh-script-wire'

interface Envelope { ok: boolean; value?: unknown; error?: { code: string; message: string } }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...(init ?? {}),
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await response.json()) as Envelope
  if (response.ok === false || body.ok === false) {
    throw new Error(body.error?.message ?? 'script request failed')
  }
  return body.value as T
}

const enc = (id: string): string => encodeURIComponent(id)

export interface ScriptsApi {
  /**
   * 读模型列表（含宿主算好的 `successRate`，不含 steps）。
   * @param limit - 最多几条。
   * @param q - 检索词：**匹配由宿主算**（`matchScore`，Spec §5.4）——
   *   客户端不许自己过滤，否则就有了第二套检索口径（INV-7 / D10 的同一条理由）。
   */
  list(limit?: number, q?: string): Promise<ScriptSummary[]>
  /** 一条脚本的全文（含 steps）；**不计量**（Spec D9）。 */
  get(id: string): Promise<ScriptView>
  /** 审计 + 结算过期：打开治理面时调一次（唯一自动动作，Spec D7）。 */
  audit(): Promise<ScriptAudit>
  invoke(id: string): Promise<{ script: ScriptView; successRate: number }>
  recordResult(id: string, success: boolean): Promise<ScriptView>
  setStatus(id: string, status: ScriptStatus, supersededBy?: string | null): Promise<ScriptView>
  setScope(id: string, scope: ScriptScope): Promise<ScriptView>
  remove(id: string): Promise<{ removed: boolean }>
}

export const scriptApi: ScriptsApi = {
  async list(limit = 100, q = '') {
    const query = new URLSearchParams({ limit: String(limit) })
    if (q.trim().length > 0) query.set('q', q.trim())
    return request<ScriptSummary[]>('/scripts?' + query.toString())
  },
  async get(id) {
    return request<ScriptView>('/scripts/' + enc(id))
  },
  async audit() {
    // POST /sweep：结算过期后返回审计负载（GET /audit 为只读同形）。
    return request<ScriptAudit>('/scripts/sweep', { method: 'POST', body: '{}' })
  },
  async invoke(id) {
    return request<{ script: ScriptView; successRate: number }>('/scripts/' + enc(id) + '/invoke', { method: 'POST', body: '{}' })
  },
  async recordResult(id, success) {
    return request<ScriptView>('/scripts/' + enc(id) + '/result', { method: 'POST', body: JSON.stringify({ success }) })
  },
  async setStatus(id, status, supersededBy = null) {
    return request<ScriptView>('/scripts/' + enc(id) + '/status', { method: 'POST', body: JSON.stringify({ status, supersededBy }) })
  },
  async setScope(id, scope) {
    return request<ScriptView>('/scripts/' + enc(id) + '/scope', { method: 'POST', body: JSON.stringify({ scope }) })
  },
  async remove(id) {
    return request<{ removed: boolean }>('/scripts/' + enc(id), { method: 'DELETE' })
  },
}

export type { ScriptAdvice }
