import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
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
    /** 焦点归还点：anchor 不是 portal，就在它子树里找第一个可聚焦元素（PCQA-005 的口径）。 */
    const restoreFocus = () => {
      anchorRef.current
        ?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        ?.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      // Esc 只关最内层浮层，并把焦点还给触发钮。
      // **在捕获阶段接手**：document 的捕获监听先于面板/宿主那批冒泡监听执行，
      // stopPropagation 让事件根本到不了它们 —— 不依赖「谁的监听器先注册」，
      // 也不依赖浮层的 opacity/动画是否已经跑完（无头/后台页面可能停帧，
      // acc-20260917-2210 的 R-02 就是踩了这两点）。
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onClose()
        restoreFocus()
        return
      }
      // 方向键导航（UI-UX-SPEC §3.3 Menu「方向键导航」）：焦点在触发钮上时按 ArrowDown 也能进菜单。
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
      const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
      if (items.length === 0) return
      e.preventDefault()
      const at = items.findIndex((el) => el === document.activeElement)
      const next = e.key === 'Home' ? 0
        : e.key === 'End' ? items.length - 1
          : e.key === 'ArrowDown' ? (at + 1 + items.length) % items.length
            : (at - 1 + items.length) % items.length
      items[next]?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])

  // data-spk-layer = 浮层标记：面板级 Esc / 外点处理据此判断「里面还有一层开着」，
  // 也是验收侧稳定的断言钩子（不依赖 CSS-module 哈希类名）。
  const list = open && pos && (
    <div
      ref={listRef}
      role="listbox"
      data-spk-layer="menu"
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

  // aria-haspopup / aria-expanded 由 Menu 注入（调用方只管可访问名）：
  // 否则每个消费者各写一遍，漏写就退化成「读屏不知道这是可展开控件」（PCQA-006）。
  const trigger = isValidElement(anchor)
    ? cloneElement(anchor as ReactElement<Record<string, unknown>>, {
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
    })
    : anchor

  return (
    <span ref={anchorRef} className={css.anchorWrap}>
      {trigger}
      {!list ? null : portal ? createPortal(list, document.body) : list}
    </span>
  )
}
