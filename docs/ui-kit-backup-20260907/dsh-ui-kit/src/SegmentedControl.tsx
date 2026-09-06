// SegmentedControl: single-select pill segment row (view switchers,
// layout pickers). Controlled `value`; selected segment uses the label
// primary fill family like a primary chip.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './SegmentedControl.module.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

/**
 * Render a single-select segmented control.
 * @param props.options - value/label pairs in display order.
 * @param props.value - the selected value.
 * @param props.onChange - called with the newly selected value.
 * @param props.ariaLabel - accessible name for the group.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, className, disabled }: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (next: T) => void
  ariaLabel?: string
  className?: string | undefined
  disabled?: boolean
}) {
  return (
    <div className={clsx(css.group, className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={clsx(css.seg, option.value === value && css.on)}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => { onChange(option.value) }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
