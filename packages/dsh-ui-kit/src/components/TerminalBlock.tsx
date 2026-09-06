import type { ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './TerminalBlock.module.css'

export type TerminalTone = 'text' | 'cmd' | 'prompt' | 'ok' | 'dim' | 'error'

export interface TerminalLine {
  tone?: TerminalTone
  text: ReactNode
}

export interface TerminalBlockProps {
  title?: string
  lines: TerminalLine[]
  /** 行尾闪烁光标 */
  cursor?: boolean
  className?: string
}

const toneClass: Record<TerminalTone, string> = {
  text: css.text,
  cmd: css.cmd,
  prompt: css.prompt,
  ok: css.ok,
  dim: css.dim,
  error: css.error,
}

/** Spark UI Kit 终端块 — 深底代码块 + 品牌提示符 */
export function TerminalBlock({ title, lines, cursor = false, className }: TerminalBlockProps) {
  return (
    <div role="log" aria-label={title ?? '终端输出'} className={cx(css.terminal, className)}>
      <div className={css.bar} aria-hidden="true">
        <span /><span /><span />
        {title && <em>{title}</em>}
      </div>
      <pre className={css.pre}>
        <code>
          {lines.map((line, i) => (
            <span key={i} className={toneClass[line.tone ?? 'text']}>
              {line.text}
              {'\n'}
            </span>
          ))}
          {cursor && <span className={css.cursor} aria-hidden="true">▊</span>}
        </code>
      </pre>
    </div>
  )
}
