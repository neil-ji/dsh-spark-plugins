import { useId, useState, type ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './Disclosure.module.css'

export interface DisclosureProps {
  name: ReactNode
  description?: ReactNode
  /** 折叠体内容 */
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onToggle?: (open: boolean) => void
  className?: string
}

/** Spark UI Kit 折叠头 — dock 面板头形制，grid-rows 高度动画 + aria-expanded */
export function Disclosure({ name, description, children, defaultOpen = false, open, onToggle, className }: DisclosureProps) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen)
  const isOpen = open ?? innerOpen
  const panelId = useId()

  const toggle = () => {
    const next = !isOpen
    if (open === undefined) setInnerOpen(next)
    onToggle?.(next)
  }

  return (
    <div className={cx(css.disclosure, className)} aria-expanded={isOpen}>
      <button type="button" className={css.head} aria-expanded={isOpen} aria-controls={panelId} onClick={toggle}>
        <svg className={css.chev} viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
        <span className={css.titles}>
          <span className={css.name}>{name}</span>
          {description && <span className={css.desc}>{description}</span>}
        </span>
      </button>
      <div id={panelId} className={css.panel}>
        <div className={css.panelInner}>
          <div className={css.body}>{children}</div>
        </div>
      </div>
    </div>
  )
}
