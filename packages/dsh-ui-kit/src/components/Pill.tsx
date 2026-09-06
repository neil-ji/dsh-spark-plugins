import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './Pill.module.css'

export type PillTone = 'neutral' | 'brand' | 'success' | 'warn' | 'error'

export interface PillProps {
  tone?: PillTone
  /** 直接指定模块 accent 色（如 var(--spk-acc-github)），优先级高于 tone */
  accentColor?: string
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
export function Pill({ tone = 'neutral', accentColor, className, children }: PillProps) {
  const style = accentColor ? ({ '--pill-acc': accentColor } as CSSProperties) : undefined
  return (
    <span className={cx(css.pill, accentColor ? css.tint : toneClass[tone], className)} style={style}>
      {children}
    </span>
  )
}
