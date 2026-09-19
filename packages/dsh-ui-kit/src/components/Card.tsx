import type { ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './Card.module.css'

export interface CardProps {
  /** 可选卡片头（14px/600）；有 actions 时构成头行两端布局。 */
  title?: ReactNode
  /** 头部右侧插槽（按钮/徽标），仅在提供 title 时渲染。 */
  actions?: ReactNode
  children: ReactNode
  /** brand：边框着品牌色（结晶/高亮等强调场景）。 */
  tone?: 'default' | 'brand'
  /**
   * surface（默认）：页面级卡面；inset：**嵌套在外层 Card 内的子卡**——
   * 背景回落一层、边框更弱，与外层形成层级差（项目详情等「卡中卡」场景）。
   */
  variant?: 'surface' | 'inset'
  className?: string
}

/**
 * 插件面板统一卡片 surface（火花基线）：radius 12、padding 12 14、
 * layer-2 背景、l1 边框。替代 .spark-card / .dock-card / 各面板自绘卡片。
 */
export function Card({ title, actions, children, tone = 'default', variant = 'surface', className }: CardProps) {
  return (
    <section className={cx(css.card, variant === 'inset' && css.inset, tone === 'brand' && css.brand, className)}>
      {(title != null || actions != null) && (
        <div className={css.head}>
          {title != null && <h3 className={css.title}>{title}</h3>}
          {actions != null && <div className={css.actions}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
