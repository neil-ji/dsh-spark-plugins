import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../cx.js'
import css from './Menu.module.css'

export interface MenuItem {
  id: string
  label: ReactNode
}

export interface MenuProps {
  open: boolean
  onClose: () => void
  /** 锚点元素（触发按钮），菜单相对其定位 */
  anchor: ReactNode
  items: MenuItem[]
  selectedId?: string
  onSelect: (id: string) => void
  /** 弹出方向：bottom 向下展开（默认），top 向上展开 */
  side?: 'bottom' | 'top'
  /** 通过 portal 渲染到 body（默认 true） */
  portal?: boolean
  className?: string
}

/** Spark UI Kit 下拉菜单 — 锚点定位 + 选中高亮 + Esc/外点关闭 */
export function Menu({ open, onClose, anchor, items, selectedId, onSelect, side = 'bottom', portal = true, className }: MenuProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number; flip: boolean } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const el = anchorRef.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const rect = el.getBoundingClientRect()
    const flip = side === 'top'
    // top 侧通过 translateY(-100%) 以菜单自身高度向上展开（无需预测量高）
    setPos(flip
      ? { top: rect.top - 6, left: rect.left, minWidth: rect.width, flip }
      : { top: rect.bottom + 6, left: rect.left, minWidth: rect.width, flip })
  }, [open, side])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (anchorRef.current?.contains(target) || listRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const list = open && pos && (
    <div
      ref={listRef}
      role="listbox"
      className={cx(css.menu, className)}
      style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth, transform: pos.flip ? 'translateY(-100%)' : undefined }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={item.id === selectedId}
          className={cx(css.item, item.id === selectedId && css.selected)}
          onClick={() => { onSelect(item.id); onClose() }}
        >
          {item.label}
          {item.id === selectedId && (
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m3.5 8.5 3 3 6-7" />
            </svg>
          )}
        </button>
      ))}
    </div>
  )

  return (
    <span ref={anchorRef} className={css.anchorWrap}>
      {anchor}
      {!list ? null : portal ? createPortal(list, document.body) : list}
    </span>
  )
}
