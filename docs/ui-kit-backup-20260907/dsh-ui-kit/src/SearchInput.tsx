// SearchInput: search field with leading icon and a clear button (appears
// while the value is non-empty). Composed over the Input chrome.

import clsx from 'clsx'
import css from './SearchInput.module.css'
import { IconSearchOutline16, IconCloseOutline16 } from './icons/index.tsx'

/**
 * Render a search input with icon + clear affordance.
 * @param props.value - controlled text.
 * @param props.onChange - text change.
 * @param props.placeholder - input placeholder.
 * @param props.onClear - clear action (button shown while value is non-empty).
 * @param props.clearLabel - accessible label for the clear button.
 */
export function SearchInput({ value, onChange, placeholder, onClear, clearLabel = 'clear', className }: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  onClear: () => void
  clearLabel?: string
  className?: string | undefined
}) {
  return (
    <span className={clsx(css.wrap, className)}>
      <span className={css.icon} aria-hidden="true"><IconSearchOutline16 /></span>
      <input
        className={css.input}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => { onChange(event.currentTarget.value) }}
      />
      {value !== '' ? (
        <button type="button" className={css.clear} aria-label={clearLabel} onClick={onClear}>
          <IconCloseOutline16 />
        </button>
      ) : null}
    </span>
  )
}
