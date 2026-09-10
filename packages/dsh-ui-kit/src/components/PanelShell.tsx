import type { ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './PanelShell.module.css'

export interface PanelShellProps {
  title: ReactNode
  /** 标题右侧的动作区（按钮/徽标），窄屏自动换行。 */
  actions?: ReactNode
  /** 标题下方的说明文字（12px 次级色）。 */
  subtitle?: ReactNode
  children?: ReactNode
  className?: string
}

/**
 * 插件面板骨架：统一页头（18px 标题 + 可选副标题 + 右侧动作区）+ 内容列。
 * 所有插件面板的顶层容器统一用它，替代各自的 .spark-section /
 * .hippomemo-section / styles.section 页头写法。
 */
export function PanelShell({ title, actions, subtitle, children, className }: PanelShellProps) {
  return (
    <div className={cx(css.shell, className)}>
      <header className={css.head}>
        <div className={css.titles}>
          <h2 className={css.title}>{title}</h2>
          {subtitle != null && <p className={css.subtitle}>{subtitle}</p>}
        </div>
        {actions != null && <div className={css.actions}>{actions}</div>}
      </header>
      {children}
    </div>
  )
}
