import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cx } from '../cx.js'
import css from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'sm'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** true 时显示 spinner 并阻止点击 */
  loading?: boolean
}

/** Spark UI Kit 按钮 — 32px 胶囊实心，dock 形制 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, ...rest },
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
      {children}
    </button>
  )
})
