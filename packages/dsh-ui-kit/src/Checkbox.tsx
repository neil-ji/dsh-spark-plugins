// Checkbox: token-styled checkbox atom with a self-drawn 16px box (native
// input visually hidden; focus ring on the box). Label optional for icon-free rows.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './Checkbox.module.css'

/**
 * Render a labelled checkbox.
 * @param props.checked - controlled checked state.
 * @param props.onChange - called with the next value on toggle.
 * @param props.disabled - disabled (no toggle, dimmed).
 * @param props.label - optional text shown next to the box.
 * @returns a label-wrapped checkbox row.
 */
export function Checkbox({ checked, onChange, disabled, label, className }: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean | undefined
  label?: ReactNode
  className?: string | undefined
}) {
  return (
    <label className={clsx(css.row, disabled && css.disabled, className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => { onChange(event.currentTarget.checked) }}
      />
      <span className={css.box} aria-hidden="true">
        {checked ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2.5 6.2 5 8.7l4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      {label != null ? <span className={css.label}>{label}</span> : null}
    </label>
  )
}
