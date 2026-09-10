import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from '../cx.js'
import css from './Input.module.css'

interface FieldShellProps {
  label?: string
  help?: string
  error?: string
  optionalMarker?: boolean
  idFor: string
  /**
   * 调用方传入的类名同时落在**外层 .field 包装**和内部控件上。
   *
   * 必须落在包装上：包装才是 flex 行的子项，`flex: 1` / `min-width` / `width`
   * 这类布局意图只有作用在它身上才生效。历史实现只把类名给 `<input>`，于是
   * `className={styles.grow}` 完全失效 —— 输入框被钉在固有宽度（约 170px）上，
   * 既不撑满行也不参与收缩，行内出现大片空隙；窄容器下控件的 min-width 还会
   * 溢出包装，压到相邻按钮上（GitHub/npm 令牌行「重叠」）。
   *
   * 也必须保留在控件上：`:disabled` 外观（.providerPriceInput:disabled）和
   * 后代选择器（.rateField.invalid .rateInput）都按类名命中 `<input>` 本身。
   * 两份落点对当前所有调用点都是幂等的（布局属性在块级包装内对 input 无副作用，
   * 文字类属性两者取同值）。
   */
  className?: string
}

function FieldShell({ label, help, error, optionalMarker, idFor, className, children }: FieldShellProps & { children: React.ReactNode }) {
  return (
    <div className={cx(css.field, className, error && css.fieldError)}>
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
    <FieldShell label={label} help={help} error={error} optionalMarker={optionalMarker} idFor={idFor} className={className}>
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
    <FieldShell label={label} help={help} error={error} optionalMarker={optionalMarker} idFor={idFor} className={className}>
      <textarea ref={ref} id={idFor} rows={rows} className={cx(css.input, css.textarea, className)} {...rest} />
    </FieldShell>
  )
})
