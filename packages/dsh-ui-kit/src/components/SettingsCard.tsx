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
  /** 模块 accent 色的**文字态**（如 var(--spk-acc-finance-fg)，默认 --spk-brand-fg）——
   *  用于卡头图标方块的淡底 + 同色图标，必须是白底 ≥4.5:1 的那一档。 */
  accentColor?: string
  className?: string
  children?: ReactNode
}

/** Spark UI Kit 设置卡 — dock .card + 图标方 + badge 卡头 */
export function SettingsCard({ title, description, icon, badge, accentColor, className, children }: SettingsCardProps) {
  return (
    <section className={cx(css.card, className)} style={{ '--acc': accentColor ?? 'var(--spk-brand-fg)' } as CSSProperties}>
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
  /**
   * 数值下方的**小字说明**（`--spk-text-xs` / `--spk-label-3`）。
   *
   * 2026-09-21 新增（用户裁决）：当一个指标需要一句与其数值直接相关的话
   * （如「比订阅估价多花 0.47」）时，把它渲染在**数值正下方**，而不是另起一行
   * 脱离指标区的正文 —— 后者在指标卡下方"格格不入"，且读者要自己把句子和
   * 上面哪个数字对上。说明只在**真能算出来时**才传（null/undefined 即不渲染）。
   */
  description?: ReactNode
  /** 正向数值着 success 色 */
  positive?: boolean
  className?: string
}

/** 卡体统计小卡（dock .stat） */
export function Stat({ label, value, description, positive, className }: StatProps) {
  return (
    <div className={cx(css.stat, className)}>
      <span className={css.statLabel}>{label}</span>
      <strong className={cx(css.statValue, positive && css.pos)}>{value}</strong>
      {description ? <span className={css.statDesc}>{description}</span> : null}
    </div>
  )
}

/** Stat 三列容器 */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(css.statGrid, className)}>{children}</div>
}
