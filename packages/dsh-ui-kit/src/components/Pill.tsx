import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './Pill.module.css'

export type PillTone = 'neutral' | 'brand' | 'success' | 'warn' | 'error'

/**
 * Pill 的属性面。
 *
 * 关键是 `HTMLAttributes<HTMLSpanElement>` 这一层 —— **必须有**：
 * 2026-09-21 实测发现本组件原先只解构固定几个 prop、**不透传其余属性**，于是调用方
 * 传的 `data-testid` / `aria-label` 被静默丢弃（RealHostCheck 与 preview 按这些选择器
 * 断言，等于断言在验一个不存在的节点）。finance 的额度触达 pill 就带着 SPEC §10.5
 * 要求的 `aria-label` + `data-testid` 传进来，实际 DOM 里两个都没有。
 *
 * 透传后 `onClick` 分支仍渲染 `<button>`（事件处理器与 button 的属性同名同形，安全）；
 * 若非可点分支收到 button 专属属性（如 `type`），React 会原样透传给 `<span>` —— 属调用方
 * 误用，不在本组件兜底。
 */
export interface PillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone?: PillTone
  /** 模块 accent 色的**文字态**（如 var(--spk-acc-github-fg)），优先级高于 tone。
   *  传实色档（var(--spk-acc-github)）会在亮色主题的白底上掉到 1.9-4.4:1。 */
  accentColor?: string
  /** 提供 onClick 时渲染为可点按钮（过滤/切换 chip） */
  onClick?: () => void
  /** 可点态高亮（配 onClick 使用） */
  active?: boolean
  /** hover 提示（原生 title） */
  title?: string
  className?: string
  children: ReactNode
}

const toneClass: Record<PillTone, string> = {
  neutral: css.neutral,
  brand: css.brand,
  success: css.success,
  warn: css.warn,
  error: css.error,
}

/** Spark UI Kit 标识胶囊 — dock .pill / .pill.tint 形制 */
export function Pill({
  tone = 'neutral', accentColor, onClick, active = false, title, className, children, ...rest
}: PillProps) {
  const style = accentColor ? ({ '--pill-acc': accentColor } as CSSProperties) : undefined
  const cls = cx(css.pill, accentColor ? css.tint : toneClass[tone], onClick && css.clickable, active && css.active, className)
  if (!onClick) {
    return <span className={cls} style={style} title={title} {...rest}>{children}</span>
  }
  return (
    <button type="button" className={cls} style={style} onClick={onClick} title={title} aria-pressed={active} {...rest}>
      {children}
    </button>
  )
}
