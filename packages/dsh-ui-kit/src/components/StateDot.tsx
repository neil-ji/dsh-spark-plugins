import type { CSSProperties } from 'react'
import { cx } from '../cx.js'
import css from './StateDot.module.css'

export type DotStatus = 'neutral' | 'live' | 'idle' | 'error'

export interface StateDotProps {
  status?: DotStatus
  /** 无障碍名；提供时渲染为 img role */
  label?: string
  /** 像素直径（默认 9） */
  size?: number | undefined
  className?: string
}

/** Spark UI Kit 状态点 — dock .sdot（live 绿 / idle 黄 / error 红） */
export function StateDot({ status = 'neutral', label, size, className }: StateDotProps) {
  const style = size === undefined ? undefined : ({ width: size, height: size } as CSSProperties)
  const dot = <span className={cx(css.dot, css[status], className)} style={style} />
  if (!label) return dot
  return (
    <span role="img" aria-label={label} className={css.sr}>
      {dot}
    </span>
  )
}
