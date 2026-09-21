/**
 * 脚本沉淀库的 HTTP 子集（宿主 `dsh-script` 的 `/scripts` 前缀）。
 *
 * 事件推送不走这里：变更经 `script/events`（typert stream）下发，见 ScriptsPane 的
 * `useFrames`。本文件只有请求-响应端点。
 */
import type { ScriptView } from 'dsh-script-wire'

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
  list(limit?: number): Promise<ScriptView[]>
  invoke(id: string): Promise<{ script: ScriptView; successRate: number }>
  recordResult(id: string, success: boolean): Promise<ScriptView>
  setStatus(id: string, status: 'active' | 'archived'): Promise<ScriptView>
}

export const scriptApi: ScriptsApi = {
  async list(limit = 100) {
    return request<ScriptView[]>('/scripts?limit=' + String(limit))
  },
  async invoke(id) {
    return request<{ script: ScriptView; successRate: number }>('/scripts/' + enc(id) + '/invoke', { method: 'POST', body: '{}' })
  },
  async recordResult(id, success) {
    return request<ScriptView>('/scripts/' + enc(id) + '/result', { method: 'POST', body: JSON.stringify({ success }) })
  },
  async setStatus(id, status) {
    return request<ScriptView>('/scripts/' + enc(id) + '/status', { method: 'POST', body: JSON.stringify({ status }) })
  },
}
