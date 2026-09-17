import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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
  /** 面板页签形态：占满整行、各 tab 等宽（dock subtabbar 观感）。 */
  fullWidth?: boolean | undefined
  className?: string
}

/** Spark UI Kit 分段控制 — dock .seg：layer-2 槽 + platform 滑块 + 白字选中 */
export function SegmentedControl<V extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
  fullWidth,
  className,
}: SegmentedControlProps<V>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
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

  /**
   * 方向键 / Home / End 在页签间移动（ARIA tabs 模式，UI-UX-SPEC §5「SegmentedControl 方向键切换」）。
   * 采用「自动激活」：焦点与选中态一起走，键盘用户按一次键就完成切换（与鼠标点击等价）。
   * Tab 序列只保留选中项（roving tabindex），所以这里必须自己把焦点带过去。
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled === true) return
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const jump = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : -1
    if (step === 0 && jump < 0) return
    e.preventDefault()
    const current = options.findIndex((opt) => opt.value === value)
    const next = jump >= 0 ? jump : (Math.max(current, 0) + step + options.length) % options.length
    const opt = options[next]
    if (opt === undefined) return
    onChange(opt.value)
    // 同步把焦点带过去：所有页签节点此刻都在 DOM 里，focus() 立即生效；
    // **不用 rAF** —— 焦点不该依赖动画帧时钟（无头/后台页面可能不产帧，R-01 就是这么来的）。
    // 重渲染随后把 tabindex 归位（选中项 0、其余 -1），焦点与选中项始终是同一个。
    tabRefs.current[next]?.focus()
  }

  return (
    <div
      ref={rootRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cx(css.seg, fullWidth && css.segFull, className)}
      onKeyDown={onKeyDown}
    >
      {thumb && <span className={css.thumb} style={{ left: thumb.left, width: thumb.width }} aria-hidden="true" />}
      {options.map((opt, i) => (
        <button
          key={opt.value}
          ref={(el) => { tabRefs.current[i] = el }}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          tabIndex={opt.value === value ? 0 : -1}
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
