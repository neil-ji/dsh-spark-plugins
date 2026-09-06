import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from '../cx.js'
import css from './Input.module.css'

interface FieldShellProps {
  label?: string
  help?: string
  error?: string
  optionalMarker?: boolean
  idFor: string
}

function FieldShell({ label, help, error, optionalMarker, idFor, children }: FieldShellProps & { children: React.ReactNode }) {
  return (
    <div className={cx(css.field, error && css.fieldError)}>
      {label && (
        <label className={css.label} htmlFor={idFor}>
          {label}
          {optionalMarker ? null : <span className={css.req} aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className={css.error} role="alert">⚠ {error}</p>
      ) : help ? (
        <p className={css.help}>{help}</p>
      ) : null}
    </div>
  )
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id?: string
  label?: string
  help?: string
  error?: string
  /** 有 label 时默认渲染红色 * 前缀；纯可选字段传 true 关掉 */
  optionalMarker?: boolean
}

/** Spark UI Kit 单行输入 — layer-2 实心底 + 品牌描边聚焦 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, help, error, optionalMarker, className, id, ...rest },
  ref,
) {
  const autoId = useId()
  const idFor = id ?? autoId
  return (
    <FieldShell label={label} help={help} error={error} optionalMarker={optionalMarker} idFor={idFor}>
      <input
        ref={ref}
        id={idFor}
        className={cx(css.input, className)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </FieldShell>
  )
})

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  id?: string
  label?: string
  help?: string
  error?: string
  optionalMarker?: boolean
}

/** Spark UI Kit 多行输入 — 同 Input 形制 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, help, error, optionalMarker, className, id, rows = 3, ...rest },
  ref,
) {
  const autoId = useId()
  const idFor = id ?? autoId
  return (
    <FieldShell label={label} help={help} error={error} optionalMarker={optionalMarker} idFor={idFor}>
      <textarea ref={ref} id={idFor} rows={rows} className={cx(css.input, css.textarea, className)} {...rest} />
    </FieldShell>
  )
})
