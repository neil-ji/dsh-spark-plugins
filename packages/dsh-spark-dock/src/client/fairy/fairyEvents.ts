/**
 * Fairy event layer: turns the spark domain's unified event stream into ball
 * moods + bubble announcements.
 *
 * 2026-09（ADR-001/002）：不再自己订阅 HTTP SSE，也不再用无类型字符串匹配 ——
 * 帧来自 `spark.events()`（typert stream，单一 mux 载波），类型与 zod 校验由
 * `dsh-spark-wire` 的 `SparkStreamFrame` 提供（`kind` 即主题）。
 * 文案/情绪策略仍留在 dock 侧（模块自己拥有呈现），但**契约不再是影子副本**。
 *
 * Restraint rules (carried over from the preview decision):
 *  - event-driven only, no polling;
 *  - a 4s dedupe window keeps bursts from machine-gunning the bubble.
 *
 * 文案纪律：纯文本（无 emoji / 无装饰字符 —— MASTER §5.5 禁用字符图标；
 * 气泡本身零动画，出现/消失瞬时）。表情层关闭时 mood 只被丢弃，不影响气泡。
 *
 * 注：proposals / hippomemo / github / npm 的播报仍是**未实现**（此前把
 * reflect/resolve 分支判定为死代码后裁掉）；统一通道就位后新增播报只需在这里
 * 多处理一个 kind，不再需要新开连接。
 */
import type { SparkChangedEvent, SparkStreamFrame } from 'dsh-spark-wire'
import { subscribeFrames } from 'dsh-spark-plugin-kit/client'
import { SPARK_EVENTS_STREAM, type SparkEventChannel } from '../spark/remote.ts'

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

/**
 * 把一帧 spark 变更翻译成播报（纯文本 + 情绪）。
 * @param payload - `sparks/changed` 的载荷（wire 契约）。
 */
function announceSparkChange(payload: SparkChangedEvent): void {
  if (payload.operation === 'capture') announce({ mood: 'happy', text: '捕获了新火花', src: 'Sparks' })
  else if (payload.operation === 'crystallize') announce({ mood: 'cheer', text: '火花结晶成功', src: 'Sparks · crystallize' })
}

/**
 * 订阅统一事件流。
 *
 * 这里**故意不做「只订阅一次」的闩锁**：闩锁 + effect 重跑（channel 身份变化）会
 * 出现「先退订、再拒绝重订」的悬空状态 —— 悬浮球从此收不到任何事件（预览走查抓到）。
 * 生命周期交给 kit 的引用计数：同名的逻辑流只开一条，最后一个订阅者离开才关闭，
 * 所以「挂载即订阅、卸载即退订」既正确又不产生连接抖动。表情层与气泡共用本函数，
 * 两者都开着时也只订阅一次（同名扇出）。
 * @param channel - dock 组装好的 spark 事件通道（`$stream` + 命名空间）。
 * @returns disposer。
 */
export function startFairyEvents(channel: SparkEventChannel): () => void {
  return subscribeFrames<SparkStreamFrame>(channel.remote, {
    name: SPARK_EVENTS_STREAM,
    open: (signal) => channel.events.events(signal),
    kinds: ['spark'],
    onFrame: (frame) => { if (frame.kind === 'spark') announceSparkChange(frame.payload) },
  })
}

export function onFairyAnnouncement(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
