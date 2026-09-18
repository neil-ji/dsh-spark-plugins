import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './CellText.module.css'

export interface CellTextProps {
  /** 全文（也用作悬浮 title）。多行文本直接传整段。 */
  text: ReactNode
  /** 截断行数，默认 2（UI-UX-SPEC §3.5）。 */
  lines?: 1 | 2 | 3
  className?: string
}

/**
 * Spark UI Kit 表格文本列单元格（UI-UX-SPEC §3.5）：
 * 文本允许换行、最多 `lines`（默认 2）行截断，悬浮显示全文（原生 title）。
 * `title` 只在字符串文本上生效；传 ReactNode 时请自行包一层带 title 的元素。
 */
export function CellText({ text, lines = 2, className }: CellTextProps) {
  return (
    <span
      className={cx(css.cellText, className)}
      style={{ '--cell-lines': String(lines) } as CSSProperties}
      title={typeof text === 'string' ? text : undefined}
    >
      {text}
    </span>
  )
}
