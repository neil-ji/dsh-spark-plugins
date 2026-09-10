import type { ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './EmptyState.module.css'

export interface EmptyStateProps {
  /** 主文案（必给：如「暂无记忆」）。 */
  message: ReactNode
  /** 副文案/下一步提示（11px 更弱一级）。 */
  hint?: ReactNode
  /** 可选图标（建议 dsh-ui-kit IconXxx size 14）。 */
  icon?: ReactNode
  className?: string
}

/**
 * 插件面板统一空态：居中 icon + 主文案 + 可选提示。
 * 替代 .spark-empty / .dock-empty / .hippomemo-quadrant-empty 各自写法。
 */
export function EmptyState({ message, hint, icon, className }: EmptyStateProps) {
  return (
    <div className={cx(css.empty, className)} role="status">
      {icon != null && <span className={css.icon}>{icon}</span>}
      <p className={css.msg}>{message}</p>
      {hint != null && <p className={css.hint}>{hint}</p>}
    </div>
  )
}
