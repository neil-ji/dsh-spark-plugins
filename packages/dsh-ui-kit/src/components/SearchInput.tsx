import { forwardRef, type InputHTMLAttributes } from 'react'
import { cx } from '../cx.js'
import css from './SearchInput.module.css'

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 无障碍名（sr-only label 文本） */
  label: string
  /** 提供时在非空文本右侧渲染清除按钮（旧 API 兼容） */
  onClear?: () => void
  /** 清除按钮的无障碍名（配 onClear 使用） */
  clearLabel?: string
}

/** Spark UI Kit 搜索输入 — 前置放大镜图标 + 胶囊 field */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { label, className, onClear, clearLabel = '清除', ...rest },
  ref,
) {
  const value = rest.value
  const hasValue = value !== undefined && value !== null && String(value).length > 0
  const customClear = onClear !== undefined && hasValue
  return (
    <span className={cx(css.wrap, customClear && css.hasClear, className)}>
      <svg className={css.icon} viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </svg>
      <input ref={ref} type="search" aria-label={label} className={css.input} {...rest} />
      {customClear ? (
        <button type="button" className={css.clear} aria-label={clearLabel} onClick={onClear}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      ) : null}
    </span>
  )
})
