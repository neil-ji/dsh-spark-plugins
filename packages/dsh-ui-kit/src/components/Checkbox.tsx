import { useId, type ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './Checkbox.module.css'

export interface CheckboxProps {
  checked?: boolean | undefined
  defaultChecked?: boolean | undefined
  onChange?: ((checked: boolean) => void) | undefined
  label: ReactNode
  disabled?: boolean | undefined
}

/** Spark UI Kit 复选框 — 原生 input + accent-color（dock .check 形制） */
export function Checkbox({ checked, defaultChecked, onChange, label, disabled }: CheckboxProps) {
  const id = useId()
  return (
    <label className={cx(css.check, disabled && css.disabled)} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}
