import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './ListRow.module.css'

export interface ListRowProps {
  title: ReactNode
  meta?: ReactNode
  /** 右侧独立区（button 外渲染，避免 button-in-button） */
  trailing?: ReactNode
  /** 模块 accent 色（如 var(--spk-acc-finance)） */
  accentColor?: string
  archived?: boolean
  onClick?: () => void
  className?: string
}

/** Spark UI Kit 列表行 — dock .row：整行可点 + 独立 trailing */
export function ListRow({ title, meta, trailing, accentColor, archived, onClick, className }: ListRowProps) {
  const style = accentColor ? ({ '--row-acc': accentColor } as CSSProperties) : undefined
  return (
    <div className={css.rowWrap} style={style}>
      <button
        type="button"
        onClick={onClick}
        aria-label={typeof title === 'string' ? title : undefined}
        className={cx(css.row, archived && css.archived, className)}
      >
        <span className={css.main}>
          <span className={css.title}>{title}</span>
          {meta && <span className={css.meta}>{meta}</span>}
        </span>
      </button>
      {trailing && <div className={css.trailing}>{trailing}</div>}
    </div>
  )
}
