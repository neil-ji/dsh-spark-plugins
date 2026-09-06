// SettingsCardHeader: the disclosure header of a settings-plugin card
// (设置 → 插件 → 插件配置页). Name + description on the left, an optional
// trailing badge (e.g. 未保存) and a rotating chevron on the right. Unlike
// DisclosureRow (compact flow rows whose title/description classes are
// css-module-hashed and therefore not themable from plugin CSS), this header
// owns its chrome so plugin CSS can tune name/description weight via the
// className props.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from './icons/index.tsx'
import css from './SettingsCardHeader.module.css'

export interface SettingsCardHeaderProps {
  title: string
  description?: string | undefined
  open: boolean
  onToggle: () => void
  /** Optional badge pinned to the right (e.g. pending/unsaved). */
  trailing?: ReactNode | undefined
  /** Accessible expand label (aria-label when closed). */
  expandLabel: string
  /** Accessible collapse label (aria-label when open). */
  collapseLabel: string
  className?: string | undefined
  nameClassName?: string | undefined
  descriptionClassName?: string | undefined
}

export function SettingsCardHeader({ title, description, open, onToggle, trailing, expandLabel, collapseLabel, className, nameClassName, descriptionClassName }: SettingsCardHeaderProps) {
  return (
    <button
      type="button"
      className={clsx(css.header, className)}
      aria-expanded={open}
      aria-label={(open ? collapseLabel : expandLabel) + ': ' + title}
      onClick={onToggle}
    >
      <span className={css.headText}>
        <span className={clsx(css.name, nameClassName)}>{title}</span>
        {description != null && description !== '' ? <span className={clsx(css.description, descriptionClassName)}>{description}</span> : null}
      </span>
      {trailing != null ? <span className={css.trailing}>{trailing}</span> : null}
      <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
    </button>
  )
}
