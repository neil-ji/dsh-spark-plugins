/**
 * Spark Dock overlay: floating ball + unified plugin panel.
 *
 * Phase 1 shell port of docs/spark-dock-preview (js/dock.js, 截图验证过的逻辑)：
 *  - 球：px 坐标 + 拖拽阈值 + 四角吸附 + 双击复位 + localStorage 持久化
 *  - 面板：随球反向弹出 + 视口夹取 + 夹取后若压住球则把球提到面板之上
 *  - shell.overlay 是 click-through 层，本组件根节点自带 pointer-events: auto
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { DOCK_MODULES } from './modules.tsx'
import { FairyFace, useFairy } from './fairy/FairyFace.tsx'

const M = 16
const BALL = 48
const GAP = 12
const POS_KEY = 'dsh.spark-dock:pos'
const OPEN_KEY = 'dsh.spark-dock:open'
const ACTIVE_KEY = 'dsh.spark-dock:active'

interface Pt { x: number; y: number }

function defaultPos(): Pt {
  return { x: window.innerWidth - BALL - M, y: window.innerHeight - BALL - M }
}

function clampToView(p: Pt): Pt {
  return {
    x: Math.max(M, Math.min(window.innerWidth - BALL - M, p.x)),
    y: Math.max(M, Math.min(window.innerHeight - BALL - M, p.y)),
  }
}

function loadPos(): Pt {
  try {
    const raw = localStorage.getItem(POS_KEY)
    const p = raw ? (JSON.parse(raw) as Pt) : null
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return clampToView(p)
  } catch { /* ignore */ }
  return defaultPos()
}

export function DockOverlay(): JSX.Element {
  const ballRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const posRef = useRef<Pt>(loadPos())
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1')
  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem(ACTIVE_KEY)
    return DOCK_MODULES.some((m) => m.id === saved) ? saved! : DOCK_MODULES[0].id
  })
  const activeModule = DOCK_MODULES.find((m) => m.id === activeId) ?? DOCK_MODULES[0]
  const [paneId, setPaneId] = useState(activeModule.panes[0].id)
  // 切模块时子页回落到第一个
  useEffect(() => { setPaneId(activeModule.panes[0].id) }, [activeModule])
  const activePane = activeModule.panes.find((p) => p.id === paneId) ?? activeModule.panes[0]
  const { mood, bubble } = useFairy()

  const selectModule = useCallback((id: string) => {
    setActiveId(id)
    localStorage.setItem(ACTIVE_KEY, id)
  }, [])

  const layoutBall = useCallback(() => {
    const ball = ballRef.current
    if (!ball) return
    ball.style.left = posRef.current.x + 'px'
    ball.style.top = posRef.current.y + 'px'
  }, [])

  const layoutPanel = useCallback((panelOpen: boolean) => {
    const panel = panelRef.current
    const ball = ballRef.current
    if (!panel || !ball) return
    if (!panelOpen) return
    const vw = window.innerWidth
    const vh = window.innerHeight

    panel.style.bottom = ''
    panel.style.right = ''
    panel.style.width = ''
    panel.style.height = ''
    const w = panel.offsetWidth
    const h = panel.offsetHeight
    const br = ball.getBoundingClientRect()
    const spaceL = br.left
    const spaceR = vw - br.right
    const spaceU = br.top
    const spaceD = vh - br.bottom
    const openRight = spaceR >= spaceL
    const openUp = spaceU >= spaceD

    let x = openRight ? br.right + GAP : br.left - GAP - w
    let y = openUp ? br.top - GAP - h : br.bottom + GAP
    x = Math.max(M, Math.min(vw - w - M, x))
    y = Math.max(M, Math.min(vh - h - M, y))

    // 夹取后若面板仍压住球，把球提到面板之上，保证「点球收起」始终可达
    const overlap = x < br.right + 4 && x + w > br.left - 4 && y < br.bottom + 4 && y + h > br.top - 4
    ball.style.zIndex = overlap ? '9200' : '9000'

    panel.style.left = x + 'px'
    panel.style.top = y + 'px'
    panel.style.transformOrigin = `${openRight ? 'left' : 'right'} ${openUp ? 'bottom' : 'top'}`
  }, [])

  // 开合状态持久化 + 面板定位
  useEffect(() => {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
    layoutPanel(open)
  }, [open, layoutPanel])

  // 初始定位 + resize（resize 时把球夹回视口）
  useEffect(() => {
    layoutBall()
    const onResize = () => {
      posRef.current = clampToView(posRef.current)
      layoutBall()
      layoutPanel(open)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [layoutBall, layoutPanel, open])

  // 拖拽（阈值 4px；拖拽中收面板；结束吸附最近角）
  useEffect(() => {
    const ball = ballRef.current
    if (!ball) return
    let drag: { sx: number; sy: number; x0: number; y0: number; moved: boolean } | null = null
    let suppressClick = false

    const onDown = (e: PointerEvent) => {
      drag = { sx: e.clientX, sy: e.clientY, x0: posRef.current.x, y0: posRef.current.y, moved: false }
      ball.classList.add('dragging')
      try { ball.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const dx = e.clientX - drag.sx
      const dy = e.clientY - drag.sy
      if (!drag.moved && Math.hypot(dx, dy) < 4) return
      drag.moved = true
      setOpen((o) => (o ? false : o))
      posRef.current = { x: drag.x0 + dx, y: drag.y0 + dy }
      layoutBall()
    }
    const onUp = () => {
      if (!drag) return
      const wasDrag = drag.moved
      drag = null
      ball.classList.remove('dragging')
      if (!wasDrag) return
      suppressClick = true
      setTimeout(() => { suppressClick = false }, 0)
      const cx = posRef.current.x + BALL / 2
      const cy = posRef.current.y + BALL / 2
      const corners: Pt[] = [
        { x: M, y: M },
        { x: window.innerWidth - BALL - M, y: M },
        { x: M, y: window.innerHeight - BALL - M },
        { x: window.innerWidth - BALL - M, y: window.innerHeight - BALL - M },
      ]
      let best = corners[0]
      let bd = Infinity
      for (const c of corners) {
        const d = Math.hypot(c.x + BALL / 2 - cx, c.y + BALL / 2 - cy)
        if (d < bd) { bd = d; best = c }
      }
      posRef.current = best
      ball.style.transition = 'left 240ms cubic-bezier(.2,.8,.2,1), top 240ms cubic-bezier(.2,.8,.2,1)'
      layoutBall()
      setTimeout(() => { ball.style.transition = '' }, 250)
      try { localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)) } catch { /* ignore */ }
      if (open) { setOpen(false); layoutPanel(false) }
    }
    const onClick = (e: ReactMouseEvent | MouseEvent) => {
      if (suppressClick) { suppressClick = false; e.preventDefault(); return }
      setOpen((o) => !o)
    }

    ball.addEventListener('pointerdown', onDown)
    ball.addEventListener('pointermove', onMove)
    ball.addEventListener('pointerup', onUp)
    ball.addEventListener('pointercancel', onUp)
    ball.addEventListener('click', onClick as (e: MouseEvent) => void)
    return () => {
      ball.removeEventListener('pointerdown', onDown)
      ball.removeEventListener('pointermove', onMove)
      ball.removeEventListener('pointerup', onUp)
      ball.removeEventListener('pointercancel', onUp)
      ball.removeEventListener('click', onClick as (e: MouseEvent) => void)
    }
  }, [layoutBall, layoutPanel, open])

  // Esc 收起
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // 气泡定位：球上方居中，贴顶时翻到下方，左右夹取（demo positionBubble 移植）
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = bubbleRef.current
    const ball = ballRef.current
    if (el === null || ball === null) return
    const br = ball.getBoundingClientRect()
    const bw = el.offsetWidth
    const bh = el.offsetHeight
    const m = 12
    let y = br.top - bh - 12
    if (y < m) y = br.bottom + 12
    let x = br.left + br.width / 2 - bw / 2
    x = Math.max(m, Math.min(window.innerWidth - bw - m, x))
    el.style.left = x + 'px'
    el.style.top = y + 'px'
  }, [bubble])

  return (
    <div data-plugin="dsh-spark-dock">
      <button
        ref={ballRef}
        type="button"
        className="dock-ball"
        aria-label="打开 Spark Dock"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <FairyFace mood={mood} />
        <span className="dock-badge" aria-hidden="true">4</span>
      </button>
      {bubble !== null && (
        <div ref={bubbleRef} className={'dock-bubble' + (mood !== null ? ' mood-' + mood : '')}>
          {bubble.text}
          <span className="src">— {bubble.src}</span>
        </div>
      )}
      <div
        ref={panelRef}
        className={open ? 'dock-panel open' : 'dock-panel'}
        role="dialog"
        aria-label="Spark Dock"
        style={{ '--accent': activeModule.accent } as React.CSSProperties}
      >
        <div className="dock-titlebar">
          <div className="titles">
            <div className="name">{activeModule.name}</div>
            <div className="sub">{activeModule.sub}</div>
          </div>
          <div className="spacer" />
          <button
            type="button"
            className="dock-iconbtn"
            aria-label="收起面板"
            onClick={() => setOpen(false)}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <nav className="dock-nav" aria-label="插件模块">
          {DOCK_MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === activeModule.id}
              className={m.id === activeModule.id ? 'dock-tab active' : 'dock-tab'}
              style={{ '--accent': m.accent } as React.CSSProperties}
              onClick={() => selectModule(m.id)}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </nav>
        <div className="dock-body">
          {activeModule.panes.length > 1 && (
            <div className="subtabbar" role="tablist" aria-label={`${activeModule.name} 子页`}>
              {activeModule.panes.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={p.id === activePane.id}
                  className={p.id === activePane.id ? 'subtab on' : 'subtab'}
                  onClick={() => setPaneId(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {activePane.render()}
        </div>
      </div>
    </div>
  )
}
