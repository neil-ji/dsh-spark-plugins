import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './SegmentedControl.module.css'

export interface SegmentedOption<V extends string = string> {
  value: V
  label: ReactNode
}

export interface SegmentedControlProps<V extends string = string> {
  options: readonly SegmentedOption<V>[]
  value: V
  onChange: (value: V) => void
  ariaLabel?: string
  disabled?: boolean | undefined
  className?: string
}

/** Spark UI Kit 分段控制 — dock .seg：layer-2 槽 + platform 滑块 + 白字选中 */
export function SegmentedControl<V extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
  className,
}: SegmentedControlProps<V>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const sync = () => {
      const el = root.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth })
    }
    sync()
    // 字体加载后宽度可能变化，校准一次
    document.fonts?.ready.then(sync).catch(() => {})
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [value, options])

  return (
    <div ref={rootRef} role="tablist" aria-label={ariaLabel} className={cx(css.seg, className)}>
      {thumb && <span className={css.thumb} style={{ left: thumb.left, width: thumb.width }} aria-hidden="true" />}
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          disabled={disabled}
          className={cx(css.tab, disabled && css.disabledTab)}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
