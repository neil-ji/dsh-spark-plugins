/**
 * Fairy event layer: subscribes to the real plugin event streams via the
 * shared registry and translates them into ball moods + bubble announcements.
 *
 * Restraint rules (carried over from the preview decision):
 *  - event-driven only, no polling;
 *  - a 4s dedupe window keeps SSE bursts from machine-gunning the bubble.
 *
 * Connection discipline: all streams go through the shared refcounted
 * registry in reflect-adjacent `streams.ts` — Chrome caps ~6 connections
 * per host, and three always-on EventSources per tab starve every fetch
 * (list requests hang at "加载中"). Only the sparks stream stays resident
 * (fairy + sparks pane share it); the other streams live only while their
 * pane is mounted.
 */
import { subscribeStream } from '../streams.ts'

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

function announce(a: FairyAnnouncement): void {
  const now = Date.now()
  if (now - lastAt < 4000 && a.text === lastText) return
  lastAt = now
  lastText = a.text
  for (const l of listeners) l(a)
}

let resident = false

/** Fairy's resident subscription: exactly ONE stream stays open for the dock. */
export function startFairyEvents(): () => void {
  if (!resident) {
    resident = true
    subscribeStream('/sparks/events', (op) => {
      if (op === 'capture') announce({ mood: 'happy', text: '捕获了新火花 ✦', src: 'Sparks' })
      else if (op === 'crystallize') announce({ mood: 'cheer', text: '火花结晶成功 ✦', src: 'Sparks · crystallize' })
    })
  }
  return () => { /* resident stream lives for the dock's lifetime */ }
}
// 注意：proposals 的 reflect/resolve 与 hippomemo 的 put 播报在连接收敛时被
// 有意裁掉（sparks/changed 只发 capture/update/delete/crystallize，把
// reflect/resolve 挂在这里是死分支）。若要恢复，需在对应 pane 打开期间
// 临时接管 announce（其 SSE 只在 pane 挂载时存在，见 streams.ts），
// 而不是另开常驻流。

export function onFairyAnnouncement(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
