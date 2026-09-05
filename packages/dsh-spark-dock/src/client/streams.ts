/**
 * Shared refcounted EventSource registry.
 *
 * Chrome caps ~6 concurrent HTTP/1.1 connections per host; N panes each
 * opening their own SSE starves every fetch on the tab. This registry keeps
 * ONE EventSource per URL while at least one consumer holds it.
 */

type OpHandler = (operation: string) => void

interface StreamState {
  es: EventSource | null
  refcount: number
  handlers: Set<OpHandler>
}

const streams = new Map<string, StreamState>()

function open(url: string, state: StreamState): void {
  state.es = new EventSource(url)
  state.es.onmessage = (ev) => {
    let operation = ''
    try {
      const parsed = JSON.parse(ev.data) as { operation?: string }
      operation = parsed.operation ?? ''
    } catch { /* keepalive frames */ }
    for (const h of state.handlers) h(operation)
  }
}

export function subscribeStream(url: string, handler: OpHandler): () => void {
  let state = streams.get(url)
  if (state === undefined) {
    state = { es: null, refcount: 0, handlers: new Set() }
    streams.set(url, state)
  }
  state.refcount += 1
  state.handlers.add(handler)
  if (state.es === null) open(url, state)
  return () => {
    state.handlers.delete(handler)
    state.refcount -= 1
    if (state.refcount <= 0 && state.es !== null) {
      state.es.close()
      state.es = null
    }
  }
}
