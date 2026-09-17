import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../cx.js'
import { Button } from './Button.js'
import css from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  /** 底部操作区（一般为 Button 组合）；与 closeLabel 互斥优先 */
  footer?: ReactNode
  /** 提供时在底部渲染一个 ghost 取消按钮（旧 API 兼容） */
  closeLabel?: string
  /**
   * 关闭钮的可访问名。
   *
   * ui-kit 不能依赖插件 locale（角色规范：零 workspace 依赖），所以这里保留中文缺省值、
   * 由使用方传本地化文案（dock 的丢弃确认等）；未传时缺省值仍是 '关闭'。
   */
  closeAriaLabel?: string
  /** dialog 面板类名（限高/皮肤） */
  className?: string
  /** 内容区类名（布局/内滚） */
  contentClassName?: string
}

/** Spark UI Kit 模态 — dock .dock-panel 形制：platform 底 / 20px 圆角 / 弹簧缩放入场 / 焦点陷阱 */
export function Modal({ open, onClose, title, children, footer, closeLabel, closeAriaLabel = '关闭', className, contentClassName }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    lastFocus.current = document.activeElement as HTMLElement | null
    const first = dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      // 捕获阶段接手 Esc：弹窗是最内层，面板/宿主那一层不该同时收到（同 Menu 的说明）
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); return }
      if (e.key === 'Tab' && dialogRef.current) {
        const list = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => el.offsetParent !== null)
        if (!list.length) return
        const firstEl = list[0]
        const lastEl = list[list.length - 1]
        if (e.shiftKey && document.activeElement === firstEl) { lastEl.focus(); e.preventDefault() }
        else if (!e.shiftKey && document.activeElement === lastEl) { firstEl.focus(); e.preventDefault() }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      lastFocus.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className={css.root}>
      <div className={css.backdrop} onClick={onClose} aria-hidden="true" />
      {/* data-spk-layer：内层浮层标记 —— 面板级 Esc 据此让路（只关最内层，见 DockOverlay 的
          hasOpenFloatingLayer 与验收 PCQA-005）。 */}
      <div ref={dialogRef} role="dialog" aria-modal="true" data-spk-layer="modal" className={cx(css.modal, className)}>
        <header className={css.head}>
          <h4 className={css.title}>{title}</h4>
          <button type="button" className={css.close} aria-label={closeAriaLabel} onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>
        <div className={cx(css.body, contentClassName)}>{children}</div>
        {(footer ?? (closeLabel ? <Button variant="ghost" onClick={onClose}>{closeLabel}</Button> : null)) && (
          <footer className={css.foot}>{footer ?? <Button variant="ghost" onClick={onClose}>{closeLabel}</Button>}</footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
