import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../cx.js'
import css from './Toast.module.css'

export type ToastTone = 'neutral' | 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  tone: ToastTone
  /** 纯文本或受限 React 节点；加粗首词可用 <strong> */
  message: React.ReactNode
}

type Listener = (toasts: ToastItem[]) => void

const TONE_ACC: Record<ToastTone, string> = {
  neutral: 'var(--spk-brand)',
  success: 'var(--spk-success)',
  error: 'var(--spk-error)',
  info: 'var(--spk-info)',
}

let toasts: ToastItem[] = []
let seq = 0
const listeners = new Set<Listener>()

function emit() {
  for (const fn of listeners) fn(toasts)
}

function push(tone: ToastTone, message: ToastItem['message'], ttl = 3600) {
  const item: ToastItem = { id: ++seq, tone, message }
  toasts = [...toasts, item]
  emit()
  setTimeout(() => dismiss(item.id), ttl)
  return item.id
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export const toast = {
  success: (message: ToastItem['message']) => push('success', message),
  error: (message: ToastItem['message']) => push('error', message),
  info: (message: ToastItem['message']) => push('info', message),
  neutral: (message: ToastItem['message']) => push('neutral', message),
  dismiss,
}

export interface ToasterProps {
  /** 单条停留毫秒（push 里的默认值，供全局调整参考） */
  className?: string
}

/**
 * Spark UI Kit 吐司容器 — 右下角堆叠，platform 底 + accent 左边线。
 * 在应用根部渲染一次，之后用 `toast.success(...)` 等命令式触发。
 */
export function Toaster({ className }: ToasterProps) {
  const [items, setItems] = useState<ToastItem[]>(toasts)

  useEffect(() => {
    const fn: Listener = (next) => setItems([...next])
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  return createPortal(
    <div className={cx(css.region, className)} aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={css.toast} style={{ '--toast-acc': TONE_ACC[t.tone] } as React.CSSProperties}>
          {t.message}
        </div>
      ))}
    </div>,
    document.body,
  )
}
