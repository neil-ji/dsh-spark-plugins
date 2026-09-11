/**
 * 播报总线（评审 F7 / ADR-004）的回归测试。
 *
 * 不变量：
 *  - 发布即扇出（多消费者互不牵连，一个抛错不吞掉别人的播报）；
 *  - 去重纪律（同一文案 4s 内不重复；不同文案照常通过；窗口过后同一文案可再播）；
 *  - 退订即断（悬浮球卸载后不再收到播报）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANNOUNCE_DEDUPE_MS,
  announcementListenerCount,
  onAnnouncement,
  publishAnnouncement,
  resetAnnouncements,
} from '../src/client/announcements.ts'

const happy = { mood: 'happy' as const, text: '捕获了新火花', src: '火花 Spark · capture' }

afterEach(() => {
  resetAnnouncements()
  vi.useRealTimers()
})

describe('播报总线', () => {
  it('发布即扇出给所有订阅者', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = onAnnouncement(first)
    const offSecond = onAnnouncement(second)
    expect(announcementListenerCount()).toBe(2)
    publishAnnouncement(happy)
    expect(first).toHaveBeenCalledWith(happy)
    expect(second).toHaveBeenCalledWith(happy)
    offFirst()
    offSecond()
    expect(announcementListenerCount()).toBe(0)
  })

  it('退订后不再收到播报', () => {
    const listener = vi.fn()
    const off = onAnnouncement(listener)
    publishAnnouncement(happy)
    off()
    publishAnnouncement({ ...happy, text: '另一条' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('同一文案在去重窗口内只播一次', () => {
    const listener = vi.fn()
    onAnnouncement(listener)
    publishAnnouncement(happy)
    publishAnnouncement(happy)
    publishAnnouncement({ ...happy })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('不同文案不受去重影响', () => {
    const listener = vi.fn()
    onAnnouncement(listener)
    publishAnnouncement(happy)
    publishAnnouncement({ ...happy, text: '火花结晶成功', mood: 'cheer' })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('窗口过后同一文案可以再播', () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    onAnnouncement(listener)
    publishAnnouncement(happy)
    vi.advanceTimersByTime(ANNOUNCE_DEDUPE_MS + 100)
    publishAnnouncement(happy)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('一个消费者抛错不吞掉其它消费者的播报', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = vi.fn(() => { throw new Error('broken bubble') })
    const healthy = vi.fn()
    onAnnouncement(broken)
    onAnnouncement(healthy)
    publishAnnouncement(happy)
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('resetAnnouncements 清空订阅者与去重状态', () => {
    const listener = vi.fn()
    onAnnouncement(listener)
    publishAnnouncement(happy)
    resetAnnouncements()
    expect(announcementListenerCount()).toBe(0)
    const after = vi.fn()
    onAnnouncement(after)
    publishAnnouncement(happy)
    expect(after).toHaveBeenCalledTimes(1)
  })
})
