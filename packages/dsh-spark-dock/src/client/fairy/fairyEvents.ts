/**
 * Fairy event layer: subscribes to the real plugin event streams
 * (/sparks/events, /proposals/events, /hippomemo/events) and translates
 * them into ball moods + bubble announcements.
 *
 * Restraint rules (carried over from the preview decision):
 *  - event-driven only, no polling;
 *  - a 4s dedupe window keeps SSE bursts from machine-gunning the bubble.
 */
export type FairyMood = 'happy' | 'alert' | 'think' | 'sad' | 'cheer'

export interface FairyAnnouncement {
  mood: FairyMood
  text: string
  src: string
}

type Listener = (a: FairyAnnouncement) => void

const listeners = new Set<Listener>()
let lastAt = 0
let lastText = ''
let sources: EventSource[] = []

function announce(a: FairyAnnouncement): void {
  const now = Date.now()
  if (now - lastAt < 4000 && a.text === lastText) return
  lastAt = now
  lastText = a.text
  for (const l of listeners) l(a)
}

function listen(url: string, map: (data: string) => FairyAnnouncement | null): void {
  const es = new EventSource(url)
  es.onmessage = (ev) => {
    let operation = ''
    try {
      const parsed = JSON.parse(ev.data) as { operation?: string }
      operation = parsed.operation ?? ''
    } catch { /* keepalive frames */ }
    const a = map(operation)
    if (a !== null) announce(a)
  }
  sources.push(es)
}

/** Subscribe to real event streams; returns a disposer. */
export function startFairyEvents(): () => void {
  listen('/sparks/events', (op) => {
    if (op === 'capture') return { mood: 'happy', text: '捕获了新火花 ✦', src: 'Sparks' }
    if (op === 'crystallize') return { mood: 'cheer', text: '火花结晶成功 ✦', src: 'Sparks · crystallize' }
    return null
  })
  listen('/proposals/events', (op) =>
    op === 'reflect' || op === 'resolve'
      ? { mood: 'think', text: '涌现提议有更新', src: 'Sparks · emerge' }
      : null)
  listen('/hippomemo/events', (op) =>
    op === 'put'
      ? { mood: 'alert', text: '新增了一条记忆', src: 'HippoMemo' }
      : null)
  return () => {
    for (const es of sources) es.close()
    sources = []
  }
}

export function onFairyAnnouncement(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
