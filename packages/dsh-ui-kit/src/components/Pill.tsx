import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './Pill.module.css'

export type PillTone = 'neutral' | 'brand' | 'success' | 'warn' | 'error'

export interface PillProps {
  tone?: PillTone
  /** 直接指定模块 accent 色（如 var(--spk-acc-github)），优先级高于 tone */
  accentColor?: string
  /** 提供 onClick 时渲染为可点按钮（过滤/切换 chip） */
  onClick?: () => void
  /** 可点态高亮（配 onClick 使用） */
  active?: boolean
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
export function Pill({ tone = 'neutral', accentColor, onClick, active = false, className, children }: PillProps) {
  const style = accentColor ? ({ '--pill-acc': accentColor } as CSSProperties) : undefined
  const cls = cx(css.pill, accentColor ? css.tint : toneClass[tone], onClick && css.clickable, active && css.active, className)
  if (!onClick) {
    return <span className={cls} style={style}>{children}</span>
  }
  return (
    <button type="button" className={cls} style={style} onClick={onClick} aria-pressed={active}>
      {children}
    </button>
  )
}
