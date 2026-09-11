/**
 * Fairy face: the ball's expressive SVG (ahoge spark + eyes + mouth + blush),
 * driven by real plugin events via the kit announcement bus. Restraint: moods
 * fire only on real events, auto-relax to idle; no idle animation loops beyond
 * a slow bob.
 *
 * 2026-09 静默形态：DockOverlay 以 BALL_FACE_ENABLED=false 调用本 hook，
 * 球内不再渲染 FairyFace；订阅由 BALL_BUBBLE_ENABLED 决定（气泡要听播报）。
 * 组件与规则全部保留，恢复角色层只需把开关置回 true。
 *
 * F7：这里只消费播报，不含任何插件文案；事件订阅与文案翻译在各自的模块里
 * （spark → `spark/SparkDockModule.tsx` 的 `startSparkAnnouncements`）。
 */
import { useEffect, useState } from 'react'
import { onFairyAnnouncement, type FairyMood } from './fairyEvents.ts'

export function useFairy(enabled = true): { mood: FairyMood | null; bubble: { text: string; src: string } | null } {
  const [mood, setMood] = useState<FairyMood | null>(null)
  const [bubble, setBubble] = useState<{ text: string; src: string } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let moodTimer = 0
    let bubbleTimer = 0
    const off = onFairyAnnouncement((a) => {
      setMood(a.mood)
      setBubble({ text: a.text, src: a.src })
      window.clearTimeout(moodTimer)
      moodTimer = window.setTimeout(() => setMood(null), 2600)
      window.clearTimeout(bubbleTimer)
      bubbleTimer = window.setTimeout(() => setBubble(null), 4200)
    })
    return () => {
      off()
      window.clearTimeout(moodTimer)
      window.clearTimeout(bubbleTimer)
    }
  }, [enabled])

  return { mood, bubble }
}

export function FairyFace({ mood }: { mood: FairyMood | null }): JSX.Element {
  const happyEyes = mood === 'happy' || mood === 'cheer'
  return (
    <svg viewBox="0 0 48 48" className={'fairy-face' + (mood !== null ? ' mood-' + mood : '')} aria-hidden="true">
      {/* 呆毛：品牌 4 芒火花 */}
      <path className="ahoge" d="M24 0.8c.4 2.7 2.2 4.5 4.9 4.9-2.7.4-4.5 2.2-4.9 4.9-.4-2.7-2.2-4.5-4.9-4.9 2.7-.4 4.5-2.2 4.9-4.9z" style={{ fill: 'var(--spk-acc-spark, #d97706)' }} />
      {/* 腮红 */}
      <ellipse className="blush" cx="11" cy="28.5" rx="3.4" ry="1.9" style={{ fill: 'var(--spk-acc-spark, #d97706)' }} />
      <ellipse className="blush" cx="37" cy="28.5" rx="3.4" ry="1.9" style={{ fill: 'var(--spk-acc-spark, #d97706)' }} />
      {/* 眼睛：普通 / 开心弧 */}
      <g className="eyes-normal">
        <ellipse cx="16.5" cy="23" rx="2.8" ry="4.3" fill="currentColor" />
        <ellipse cx="31.5" cy="23" rx="2.8" ry="4.3" fill="currentColor" />
      </g>
      <g className="eyes-happy">
        <path d="M12.6 24 Q16.5 19.6 20.4 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M27.6 24 Q31.5 19.6 35.4 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      </g>
      {/* 嘴：微笑 / 张嘴 / 委屈 */}
      <path className="mouth-smile" d="M19.6 30.6 Q24 34.4 28.4 30.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <ellipse className="mouth-open" cx="24" cy="31.8" rx="2.7" ry="3.3" fill="currentColor" />
      <path className="mouth-frown" d="M19.8 33.4 Q24 29.8 28.2 33.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* 思考泡 */}
      <g className="acc-think" style={{ fill: 'var(--spk-acc-spark, #d97706)' }}>
        <circle cx="37" cy="14" r="1.7" /><circle cx="41" cy="9.5" r="2.3" /><circle cx="45" cy="4.5" r="1.4" />
      </g>
    </svg>
  )
}
