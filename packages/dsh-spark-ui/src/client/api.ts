/**
 * Tiny fetch wrapper for the plugin-owned /sparks API.
 */
import type { SparkView, SparkCapture } from 'dsh-spark-wire'

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
    throw new Error(message)
  }
  return body.value as T
}

export interface SparksApi {
  list(query?: { status?: 'active' | 'archived'; scope?: 'session' | 'project' | 'global'; limit?: number }): Promise<SparkView[]>
  get(id: string): Promise<SparkView | null>
  capture(input: SparkCapture): Promise<SparkView>
  archive(id: string): Promise<SparkView>
  delete(id: string): Promise<void>
  subscribe(onChange: () => void): () => void
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
        if (error instanceof Error && /NOT_FOUND/.test(error.message)) return null
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
    subscribe(onChange) {
      // SSE listener; auto-reconnect on close.
      let stopped = false
      let es: EventSource | null = null
      const connect = (): void => {
        if (stopped) return
        es = new EventSource('/sparks/events')
        es.onmessage = () => { onChange() }
        es.onerror = () => {
          if (es !== null) es.close()
          if (!stopped) setTimeout(connect, 2000)
        }
      }
      connect()
      return () => {
        stopped = true
        if (es !== null) es.close()
      }
    },
  }
}
