/**
 * 播报总线（评审 F7 / ADR-004）：**模块自己的事件 → 纯文本 + 情绪 → 悬浮球气泡**。
 *
 * 为什么在 kit 而不是在壳里：文案与情绪的策略属于**模块自己**（模块最懂自己事件的
 * 语义），壳只负责呈现。此前这套映射写在 dock 的 `fairyEvents.ts` 里（字符串匹配
 * spark 的业务事件）—— 新增一个插件的播报要改 dock 源码，与「新增插件零改 dock」
 * （ADR-003）自相矛盾。
 *
 * 去重纪律也放在总线上（ADR-004 要求「去重/节流/播报队列策略上收 kit」）：
 * `ANNOUNCE_DEDUPE_MS` 内**同一文案**不重复播报，避免事件风暴把气泡打成连击。
 * 文案纪律（MASTER §5.5）：纯文本、无 emoji、无装饰字符；气泡本身零动画。
 */
import { messageOf } from './remote-result.ts'

/** 情绪档：驱动球的表情层（`prefers-reduced-motion` 与静默形态下只被丢弃）。 */
export type AnnounceMood = 'happy' | 'alert' | 'think' | 'sad' | 'cheer'

/** 一条播报：正文 + 来源行 + 情绪。 */
export interface Announcement {
  mood: AnnounceMood
  text: string
  src: string
}

/** 同一文案的去重窗口（毫秒）。 */
export const ANNOUNCE_DEDUPE_MS = 4000

type Listener = (announcement: Announcement) => void

const listeners = new Set<Listener>()
let lastAt = 0
let lastText = ''

/**
 * 发布一条播报。模块在自己的事件订阅里调用（例如收到 `spark/capture` 帧时）。
 * @param announcement - 纯文本 + 情绪 + 来源行。
 */
export function publishAnnouncement(announcement: Announcement): void {
  const now = Date.now()
  if (now - lastAt < ANNOUNCE_DEDUPE_MS && announcement.text === lastText) return
  lastAt = now
  lastText = announcement.text
  // 订阅者互不牵连：一个消费者抛错不能吞掉其它消费者的播报。
  for (const listener of [...listeners]) {
    try {
      listener(announcement)
    } catch (error) {
      console.warn('[dsh-spark-plugin-kit] 播报订阅者抛错：', messageOf(error))
    }
  }
}

/**
 * 订阅播报（悬浮球气泡 / 表情层）。
 * @param listener - 收到播报时调用。
 * @returns disposer。
 */
export function onAnnouncement(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 当前订阅者数量（诊断用）。 */
export function announcementListenerCount(): number {
  return listeners.size
}

/**
 * 清空订阅者与去重窗口。
 * 测试与预览重挂时需要它 —— 总线是模块级单例，跨用例会带着上一条文案的去重状态。
 */
export function resetAnnouncements(): void {
  listeners.clear()
  lastAt = 0
  lastText = ''
}
