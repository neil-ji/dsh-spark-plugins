import { forwardRef, type InputHTMLAttributes } from 'react'
import { cx } from '../cx.js'
import css from './SearchInput.module.css'

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 无障碍名（sr-only label 文本） */
  label: string
}

/** Spark UI Kit 搜索输入 — 前置放大镜图标 + 胶囊 field */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { label, className, ...rest },
  ref,
) {
  return (
    <span className={cx(css.wrap, className)}>
      <svg className={css.icon} viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </svg>
      <input ref={ref} type="search" aria-label={label} className={css.input} {...rest} />
    </span>
  )
})
