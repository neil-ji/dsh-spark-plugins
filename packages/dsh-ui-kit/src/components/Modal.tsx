import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../cx.js'
import css from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  /** 底部操作区（一般为 Button 组合） */
  footer?: ReactNode
  className?: string
}

/** Spark UI Kit 模态 — dock .dock-panel 形制：platform 底 / 20px 圆角 / 弹簧缩放入场 / 焦点陷阱 */
export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    lastFocus.current = document.activeElement as HTMLElement | null
    const first = dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
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
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      lastFocus.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className={cx(css.root, className)}>
      <div className={css.backdrop} onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" className={css.modal}>
        <header className={css.head}>
          <h4 className={css.title}>{title}</h4>
          <button type="button" className={css.close} aria-label="关闭" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>
        <div className={css.body}>{children}</div>
        {footer && <footer className={css.foot}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
