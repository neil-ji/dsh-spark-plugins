import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './SettingsCard.module.css'

export interface SettingsCardProps {
  /** 卡头标题 */
  title: ReactNode
  description?: ReactNode
  /** 卡头左上的模块图标字符/节点 */
  icon?: ReactNode
  /** 卡头右侧徽标（如 Pill） */
  badge?: ReactNode
  /** 模块 accent 色（如 var(--spk-acc-finance)） */
  accentColor?: string
  className?: string
  children?: ReactNode
}

/** Spark UI Kit 设置卡 — dock .card + 图标方 + badge 卡头 */
export function SettingsCard({ title, description, icon, badge, accentColor, className, children }: SettingsCardProps) {
  return (
    <section className={cx(css.card, className)} style={{ '--acc': accentColor ?? 'var(--spk-brand)' } as CSSProperties}>
      <header className={css.head}>
        {icon && <span className={css.icon} aria-hidden="true">{icon}</span>}
        <div className={css.titles}>
          <h4 className={css.title}>{title}</h4>
          {description && <p className={css.desc}>{description}</p>}
        </div>
        {badge}
      </header>
      {children && <div className={css.body}>{children}</div>}
    </section>
  )
}

export interface StatProps {
  label: ReactNode
  value: ReactNode
  /** 正向数值着 success 色 */
  positive?: boolean
  className?: string
}

/** 卡体统计小卡（dock .stat） */
export function Stat({ label, value, positive, className }: StatProps) {
  return (
    <div className={cx(css.stat, className)}>
      <span className={css.statLabel}>{label}</span>
      <strong className={cx(css.statValue, positive && css.pos)}>{value}</strong>
    </div>
  )
}

/** Stat 三列容器 */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(css.statGrid, className)}>{children}</div>
}
