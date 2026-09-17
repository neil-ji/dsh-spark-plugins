/**
 * Spark Dock overlay: floating ball + unified plugin panel.
 *
 * Phase 1 shell port of docs/spark-dock-preview (js/dock.js, 截图验证过的逻辑)：
 *  - 球：px 坐标 + 拖拽阈值 + 四角吸附 + 双击复位 + localStorage 持久化
 *  - 面板：随球反向弹出 + 视口夹取 + 夹取后若压住球则把球提到面板之上
 *  - shell.overlay 是 click-through 层，本组件根节点自带 pointer-events: auto
 *
 * 2026-09-16 徽章：球右上叠 `pending + pendingProposals` 红点。仅在
 * channel 可用时订阅 `spark/events` 帧，事件驱动刷新而非轮询
 * （AGENTS.md §1.3 禁轮询）；首帧前先拉一次 `/sparks/stats` 给到非零初值。
 *
 * 2026-09-17 PC 端验收修复（acc-20260917-1906）：
 *  - PCQA-001 关闭态面板 `inert` + CSS `visibility:hidden`，双保险移出 Tab 序与无障碍树；
 *    收起时若焦点仍在面板内，把焦点还给球（spark-dock-design §3）。
 *  - PCQA-002 视口变化后按「最近角重吸附」而不是只夹回视口（球必须常驻角落，不压正文）。
 *  - PCQA-005 面板内还有浮层（`[data-spk-layer]` / listbox / menu）开着时，Esc 让给内层。
 *  - PCQA-008 双击球复位默认右下角（此前只有注释承诺）。PCQA-009 方向键微调（拖拽的键盘替代）。
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { IconSparkles } from 'dsh-ui-kit'
import { useFrames, type DockModuleOwnerProps } from 'dsh-spark-plugin-kit/client'
import { SPARK_EVENTS_STREAM } from './spark/remote.ts'
import type { SparkEventChannel } from './spark/remote.ts'
import { useFairy } from './fairy/FairyFace.tsx'

/**
 * 平台下发的子槽渲染面。dock 在 `shell.overlay` 的 register 里声明了
 * `children: { 'spark.dock.module': ... }`，平台据此把 renderSlot 作为组件 props
 * 交给本组件；预览 harness 由假宿主等价注入。
 */
export type DockRenderSlot = (
  key: 'spark.dock.module',
  owner: DockModuleOwnerProps,
  opts?: { only?: string; fallback?: ReactNode },
) => ReactNode

export interface DockOverlayProps {
  channel?: SparkEventChannel | null
  /** 见 {@link DockRenderSlot}；ADR-003 起 dock 的所有模块都从它来。 */
  renderSlot?: DockRenderSlot
}

const M = 16
const BALL = 48
const GAP = 12
const POS_KEY = 'dsh.spark-dock:pos'
const OPEN_KEY = 'dsh.spark-dock:open'
const ACTIVE_KEY = 'dsh.spark-dock:active'

/**
 * 球的两层能力开关（2026-09「静默形态」）—— 拆开是为了让「发言」可以独立于「表情」存在：
 *
 *  - BALL_FACE_ENABLED：表情 / 情绪染光 / 球体动画（呆毛、浮动、缩放、呼吸、播报时的弹跳）。
 *    关闭时球内渲染静态品牌标识（ui-kit IconSparkles），不带 mood class。
 *  - BALL_BUBBLE_ENABLED：事件播报气泡 —— 真实事件文本（无 emoji / 无动画，出现与消失都是
 *    瞬时的），定位在球旁并自动避让视口。它不属于「表情/动画」，因此默认保留。
 *
 * 两者的共同依赖是 Fairy 事件订阅（`useFairy`），任一开启即订阅；都关掉就不再开 SSE。
 * 恢复整套角色层：两个都置 true（球的 mood 染光档与 fairy CSS 全部保留）。
 * 见 design-system/spark-dock/MASTER.md §4.1。显式标注 boolean，避免字面量收窄。
 */
const BALL_FACE_ENABLED: boolean = false
const BALL_BUBBLE_ENABLED: boolean = true

interface Pt { x: number; y: number }

/**
 * 位置记忆。`snapped` = 当前坐标是「角落吸附」的结果（首次加载 / 拖拽松手 / 双击复位）。
 * 方向键微调会把它置 false —— 用户手动挪到的位置不该在视口变化时被重新吸走。
 */
interface StoredPos extends Pt { snapped?: boolean }

/** 方向键微调步长（按住 Shift 走大步）。 */
const NUDGE = 8

function defaultPos(): Pt {
  return { x: window.innerWidth - BALL - M, y: window.innerHeight - BALL - M }
}

function clampToView(p: Pt): Pt {
  return {
    x: Math.max(M, Math.min(window.innerWidth - BALL - M, p.x)),
    y: Math.max(M, Math.min(window.innerHeight - BALL - M, p.y)),
  }
}

/** 视口四角（各留 M 安全距）——拖拽吸附与 resize 重吸附共用同一份角落定义。 */
function corners(): Pt[] {
  return [
    { x: M, y: M },
    { x: window.innerWidth - BALL - M, y: M },
    { x: M, y: window.innerHeight - BALL - M },
    { x: window.innerWidth - BALL - M, y: window.innerHeight - BALL - M },
  ]
}

/** 按球心距离吸到最近的角（PCQA-002：视口变大/变小后球回到角落而不是停在旧坐标）。 */
function snapToNearestCorner(p: Pt): Pt {
  const cx = p.x + BALL / 2
  const cy = p.y + BALL / 2
  let best = corners()[0] ?? defaultPos()
  let bd = Infinity
  for (const c of corners()) {
    const d = Math.hypot(c.x + BALL / 2 - cx, c.y + BALL / 2 - cy)
    if (d < bd) { bd = d; best = c }
  }
  return best
}

function loadPos(): StoredPos {
  try {
    const raw = localStorage.getItem(POS_KEY)
    const p = raw ? (JSON.parse(raw) as StoredPos) : null
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { ...clampToView(p), snapped: p.snapped !== false }
  } catch { /* ignore */ }
  return { ...defaultPos(), snapped: true }
}

/**
 * Spark Dock overlay 组件。`channel` 由插槽 inject 面下发（平台把 inject 结果合成组件 props），
 * 供模块子页与播报层订阅统一事件流 —— 取代此前「dock apply 里设模块级单例」的做法。
 */
export function DockOverlay({ channel = null, renderSlot }: DockOverlayProps): JSX.Element {
  const ballRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // 位置只读一次 localStorage（惰性初值），并记住它是不是「角落吸附」态：
  // 只有吸附态在视口变化时重新吸附，方向键微调过的自由位置只做夹取（PCQA-002 / 009）。
  const [initialPos] = useState<StoredPos>(loadPos)
  const posRef = useRef<Pt>(initialPos)
  const snappedRef = useRef<boolean>(initialPos.snapped !== false)
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1')
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_KEY) ?? 'spark')
  // 订阅只需一层开着；mood 只服务球的表情层，气泡只取文本（互不牵连）。
  // F7：这里只消费 kit 的播报总线，事件订阅与文案翻译在各自的模块里。
  const fairy = useFairy(BALL_FACE_ENABLED || BALL_BUBBLE_ENABLED)
  const mood = BALL_FACE_ENABLED ? fairy.mood : null
  const bubble = BALL_BUBBLE_ENABLED ? fairy.bubble : null

  const selectModule = useCallback((id: string) => {
    setActiveId(id)
    localStorage.setItem(ACTIVE_KEY, id)
  }, [])

  // 浮球徽章（2026-09-16）：挂在 stats.pending + stats.pendingProposals 上。
  // channel 不可用时不订阅（mount 失败/被卸载），徽章为 0，绝不阻塞浮球渲染。
  // 拉取走 `/sparks/stats`（与 SparksPane 同源；events stream 只做 reload 触发器）。
  const [ballBadge, setBallBadge] = useState(0)
  const reloadBallBadge = useCallback((): void => {
    fetch('/sparks/stats', { headers: { accept: 'application/json' } })
      .then((res) => res.ok ? res.json() as Promise<{ ok: boolean; value?: { pending?: number; pendingProposals?: number } }> : null)
      .then((body) => {
        if (body === null || body.ok !== true || body.value === undefined) return
        const v = body.value
        const total = (typeof v.pending === 'number' ? v.pending : 0)
          + (typeof v.pendingProposals === 'number' ? v.pendingProposals : 0)
        setBallBadge(total)
      })
      .catch(() => { /* 接口暂未注册视为 0 */ })
  }, [])
  // 初始拉取 + 频道帧到达时再拉（事件驱动，不轮询）
  useEffect(() => { reloadBallBadge() }, [reloadBallBadge])
  // channel 不可用时 remote 为 null，kit 的 useFrames 会走 noop 分支，
  // 因此这条 hook 必须无条件调用（hook 规则）。
  const remote = channel?.remote ?? null
  useFrames({
    remote,
    name: SPARK_EVENTS_STREAM,
    // 类型上 `open` 不能为 null；不可用时给一个永不结束的 AsyncIterable，
    // 让 stream 永远不开（remote 为 null 时 effect 提前 return，永远不调 open）。
    open: remote !== null && channel !== null
      ? (signal) => channel.events.events(signal)
      : async function* noop(): AsyncIterable<never> { /* never yields */ if (false as boolean) yield '' as never },
    kinds: ['spark', 'proposal', 'ready'],
    onFrame: () => reloadBallBadge(),
    onReady: () => reloadBallBadge(),
  })

  /**
   * 渲染子槽里的自注册模块。`only` 让它只渲染当前激活那一条；`fallback` 覆盖
   * 「记着这个 id、但对应插件没加载」的情形（例如插件被卸载后 localStorage 残留）。
   */
  const slotNode = useCallback((variant: DockModuleOwnerProps['variant']): ReactNode => {
    if (renderSlot === undefined) return null
    return renderSlot(
      'spark.dock.module',
      { variant, activeId, onSelect: selectModule },
      {
        only: activeId,
        fallback: <div className="dock-empty">模块 {activeId} 未加载：对应插件的 client 半边未激活。</div>,
      },
    )
  }, [renderSlot, activeId, selectModule])

  // rail 纵向方向键导航（roving tabindex：只有激活 tab 在 Tab 序列里）。
  // 按 DOM 顺序走：模块全部来自子槽，dock 侧没有可查询的模块表。
  const railRef = useRef<HTMLDivElement | null>(null)
  const onRailKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const tabs = [...(railRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
    if (tabs.length === 0) return
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
    const step = e.key === 'ArrowDown' ? 1 : -1
    const next = tabs[((current < 0 ? 0 : current) + step + tabs.length) % tabs.length]
    const id = next.dataset.moduleId
    if (id !== undefined) selectModule(id)
    requestAnimationFrame(() => {
      railRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
    })
  }, [selectModule])

  const layoutBall = useCallback(() => {
    const ball = ballRef.current
    if (!ball) return
    ball.style.left = posRef.current.x + 'px'
    ball.style.top = posRef.current.y + 'px'
  }, [])

  /** 位置持久化（含 snapped 标记，见 StoredPos）。 */
  const persistPos = useCallback(() => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({
        x: posRef.current.x, y: posRef.current.y, snapped: snappedRef.current,
      }))
    } catch { /* ignore */ }
  }, [])

  /** 带过渡地落到新位置（拖拽松手 / 双击复位共用）。 */
  const settleTo = useCallback((next: Pt, snapped: boolean) => {
    const ball = ballRef.current
    snappedRef.current = snapped
    posRef.current = next
    if (ball) {
      ball.style.transition = 'left 240ms cubic-bezier(.2,.8,.2,1), top 240ms cubic-bezier(.2,.8,.2,1)'
      layoutBall()
      setTimeout(() => { ball.style.transition = '' }, 250)
    }
    persistPos()
  }, [layoutBall, persistPos])

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

  /**
   * 方向键微调球位置（拖拽的键盘替代，WCAG 2.2 AA dragging-alternative / PCQA-009）。
   * Shift 走大步（24px）。微调后标记为「自由位置」：视口变化时只夹取，不再吸回角落。
   */
  const onBallKeyDown = useCallback((e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? NUDGE * 3 : NUDGE
    let dx = 0
    let dy = 0
    if (e.key === 'ArrowLeft') dx = -step
    else if (e.key === 'ArrowRight') dx = step
    else if (e.key === 'ArrowUp') dy = -step
    else if (e.key === 'ArrowDown') dy = step
    else return
    e.preventDefault()
    snappedRef.current = false
    posRef.current = clampToView({ x: posRef.current.x + dx, y: posRef.current.y + dy })
    layoutBall()
    persistPos()
    if (open) layoutPanel(true)
  }, [layoutBall, layoutPanel, open, persistPos])

  // 开合状态持久化 + 面板定位（宽模块切换会改面板宽度，需重定位）
  useEffect(() => {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
    layoutPanel(open)
  }, [open, activeId, layoutPanel])

  // 初始定位 + resize。
  // resize：吸附态重吸附到最近角（球必须常驻角落、不压正文），自由位置只夹回视口（PCQA-002）。
  useEffect(() => {
    layoutBall()
    const onResize = () => {
      posRef.current = snappedRef.current
        ? snapToNearestCorner(posRef.current)
        : clampToView(posRef.current)
      layoutBall()
      persistPos()
      layoutPanel(open)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [layoutBall, layoutPanel, open, persistPos])

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
      // 松手吸附最近角，并把位置标记为「吸附态」（resize 时跟着角落走）
      settleTo(snapToNearestCorner(posRef.current), true)
      if (open) { setOpen(false); layoutPanel(false) }
    }
    // 双击复位默认右下角（PCQA-008）。两次 click 会各自 toggle 一次开合，净效果不变，
    // 这里只负责把球送回右下角并重新吸附。
    const onDblClick = () => {
      settleTo(defaultPos(), true)
      layoutPanel(open)
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
    ball.addEventListener('dblclick', onDblClick)
    return () => {
      ball.removeEventListener('pointerdown', onDown)
      ball.removeEventListener('pointermove', onMove)
      ball.removeEventListener('pointerup', onUp)
      ball.removeEventListener('pointercancel', onUp)
      ball.removeEventListener('click', onClick as (e: MouseEvent) => void)
      ball.removeEventListener('dblclick', onDblClick)
    }
  }, [layoutBall, layoutPanel, open, settleTo])

  // 关闭态：面板移出 Tab 序与无障碍树（inert），CSS 再补一层 visibility:hidden；
  // 收起时若焦点还在面板里，按 spark-dock-design §3 把焦点还给球（PCQA-001）。
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (open) { panel.removeAttribute('inert'); return }
    panel.setAttribute('inert', '')
    const active = document.activeElement
    if (active instanceof HTMLElement && panel.contains(active)) ballRef.current?.focus()
  }, [open])

  /**
   * 面板内还有浮层（下拉菜单 / 弹窗）开着时，Esc 归内层：面板保持打开（PCQA-005）。
   *
   * 两道保险，都不依赖时序与动画帧：
   *  1. 主机制在浮层那侧 —— ui-kit Menu/Modal 在**捕获阶段**处理 Esc 并 stopPropagation，
   *     本函数根本收不到那次按键（见 Menu.tsx 的说明）；
   *  2. 这里做兜底：只要浮层节点还在 DOM 里就算「开着」。**不再探测计算样式**
   *     （曾经要求 opacity !== '0'，而浮层入场动画在停帧环境里可能停在 opacity:0，
   *     于是兜底失效、Esc 把整个面板关掉 —— acc-20260917-2210 的 R-02）。
   */
  const hasOpenFloatingLayer = (): boolean => document.querySelector(
    '[data-spk-layer], [role="listbox"], [role="menu"], [role="dialog"][aria-modal="true"]',
  ) !== null

  // Esc 收起（焦点归还由上面的关闭态 effect 统一处理）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (hasOpenFloatingLayer()) return
      setOpen(false)
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
        className={'dock-ball' + (mood !== null ? ' mood-' + mood : '') + (ballBadge > 0 ? ' has-badge' : '')}
        aria-label={ballBadge > 0
          ? '打开 Spark Dock，' + String(ballBadge) + ' 项待处理'
          : '打开 Spark Dock'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onKeyDown={onBallKeyDown}
        title={ballBadge > 0
          ? '打开 Spark Dock · ' + String(ballBadge) + ' 项待处理'
          : '打开 Spark Dock'}
      >
        {/* 静默形态的品牌标识（ui-kit 图标层，尺寸由 .dock-ball svg 接管）；
            BALL_FACE_ENABLED 恢复后这里换回 <FairyFace mood={mood} />。 */}
        <IconSparkles size={14} />
        {/* 2026-09-16 待处理徽章：counts 是 pending + pendingProposals 之和（>0 才渲染）。
            球右上角，红底白字，沿用既有 `.dock-badge` 样式表；99+ 截断避免溢出。 */}
        {ballBadge > 0 && (
          <span
            className="dock-badge"
            role="status"
            aria-hidden={false}
            data-count={String(ballBadge)}
          >
            {ballBadge > 99 ? '99+' : String(ballBadge)}
          </span>
        )}
      </button>
      {/* 播报气泡：真实事件文本，惰性状态（MASTER §5.8 → role=status + aria-live），
          出现/消失瞬时无动画；mood 只在表情层开启时参与（仅换描边色）。 */}
      {bubble !== null && (
        <div
          ref={bubbleRef}
          className={'dock-bubble' + (mood !== null ? ' mood-' + mood : '')}
          role="status"
          aria-live="polite"
        >
          {bubble.text}
          <span className="src">— {bubble.src}</span>
        </div>
      )}
      <div
        ref={panelRef}
        className={open ? 'dock-panel open' : 'dock-panel'}
        role="dialog"
        aria-label="Spark Dock"
        style={{
          // 模块自己的东西（图标/强调色/标题/子页）全在模块条目里；面板级 accent
          // 只作缺省值（模块头/标签各自带自己的 accent）。
          '--accent': 'var(--spk-brand, #3d5af0)',
          '--accent-fg': 'var(--spk-on-brand, #ffffff)',
          // 面板宽度固定，切换模块不改变尺寸（内容区自适应）
          '--dock-panel-w': '616px',
        } as React.CSSProperties}
      >
        {/* 左：图标模块栏；右：主列（模块头 / 内容）。两处都由子槽条目渲染（ADR-003）。 */}
        <div ref={railRef} className="dock-rail" role="tablist" aria-label="插件模块" aria-orientation="vertical" onKeyDown={onRailKeyDown}>
          {renderSlot !== undefined
            ? renderSlot(
              'spark.dock.module',
              { variant: 'rail', activeId, onSelect: selectModule },
              { fallback: <div className="dock-empty dock-rail-empty">没有已加载的插件模块</div> },
            )
            : null}
        </div>
        <div className="dock-main">
          <div className="dock-head">
            <div className="titles">{slotNode('header')}</div>
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
          <div className="dock-body">
          {slotNode('pane')}
          </div>
        </div>
      </div>
    </div>
  )
}
