import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'sm'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** true 时显示 spinner 并阻止点击 */
  loading?: boolean
  /** 可选前导图标（渲染在 children 之前；图标按钮可只传 icon） */
  icon?: ReactNode
}

/** Spark UI Kit 按钮 — 32px 实心（radius 10，与输入类同标度） */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, icon, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(css.btn, css[variant], size === 'sm' && css.sm, loading && css.loading, className)}
      {...rest}
    >
      {loading && <span className={css.spinner} aria-hidden="true" />}
      {icon}
      {children}
    </button>
  )
})
