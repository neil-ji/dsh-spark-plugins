/**
 * 悬浮球视觉走查（线 1，零 dsh）：CDP 驱动 headless Edge，抓「球特写 + 整页」，
 * 并把**计算样式度量**落盘（.dev/ball-review/<label>-metrics.json），供断言使用。
 *
 *   node dev-harness/preview/ball-shots.mjs after      # 先跑 pnpm preview（5180）
 *
 * 度量里都是产品不变量，可直接当回归基线：
 *   runningAnimations  球子树内运行中的动画/Hover 过渡数（静默形态必须为 0）
 *   fairyFaces/bubbles 角色层元素数（静默形态必须为 0）
 *   box                球的盒子尺寸（hover/展开都不得变化 —— 无缩放）
 *   transition         all 0s（球不参与任何 CSS 过渡）
 *   border/bgColor/…   描边与球面的实际取值（对照 token）
 *   focusVisible       :focus-visible 是否命中（CDP 强制伪类，等价键盘聚焦）
 *
 * 环境：EDGE_PATH 覆盖浏览器路径；PREVIEW_URL 覆盖预览地址。
 * 截图落盘在 .dev/ball-review/（gitignore），配色结论可用 png-analyze.mjs 复核。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.CDP_PORT ?? 9224)
const URL_BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5180/'
const LABEL = process.argv[2] ?? 'shot'
const OUT = fileURLToPath(new URL('../../.dev/ball-review/', import.meta.url))
mkdirSync(OUT, { recursive: true })

if (!existsSync(EDGE)) {
  console.error('找不到浏览器：' + EDGE + '（用 EDGE_PATH 指定 msedge/chrome 路径）')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + OUT + 'profile-' + LABEL, '--window-size=1440,900', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })

const metrics = {}

try {
  let target = null
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      target = list.find((t) => t.type === 'page')
      if (target) break
    } catch { /* retry */ }
  }
  if (!target) throw new Error('no CDP page target')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
    return r.result?.result?.value
  }
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(OUT + LABEL + '-' + name + '.png', Buffer.from(r.result.data, 'base64'))
  }
  /** 球特写：量出球盒子，按 clip 放大截（pad/scale 固定，便于 png-analyze 反推半径）。 */
  const closeup = async (name, pad = 22, scale = 5) => {
    const rect = await evalJs(`(() => { const b = document.querySelector('.dock-ball'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
    if (rect === null) { console.log('  ! no ball for ' + name); return }
    const clip = {
      x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad),
      width: rect.w + pad * 2, height: rect.h + pad * 2, scale,
    }
    const r = await send('Page.captureScreenshot', { format: 'png', clip })
    writeFileSync(OUT + LABEL + '-' + name + '.png', Buffer.from(r.result.data, 'base64'))
  }
  const probe = async (tag) => {
    metrics[tag] = await evalJs(`(() => {
      const ball = document.querySelector('.dock-ball')
      if (!ball) return { error: 'no .dock-ball' }
      const cs = getComputedStyle(ball)
      const r = ball.getBoundingClientRect()
      const el = ball.querySelector('svg')
      const anims = (document.getAnimations ? document.getAnimations() : []).filter((a) => {
        const t = a.effect && a.effect.target
        return t === ball || (t && t.closest && t.closest('.dock-ball'))
      }).map((a) => a.animationName || 'transition')
      return {
        className: ball.className,
        expanded: ball.getAttribute('aria-expanded'),
        box: [Math.round(r.width), Math.round(r.height)],
        mark: el === null ? null : { cls: el.getAttribute('class'), w: Math.round(el.getBoundingClientRect().width) },
        fairyFaces: document.querySelectorAll('.fairy-face').length,
        bubbles: document.querySelectorAll('.dock-bubble').length,
        runningAnimations: anims,
        transition: cs.transitionProperty + ' ' + cs.transitionDuration,
        animationName: cs.animationName,
        border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        bgColor: cs.backgroundColor,
        backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
        outline: cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor + ' offset ' + cs.outlineOffset,
        focusVisible: ball.matches(':focus-visible'),
        shadow: cs.boxShadow,
        color: cs.color,
      }
    })()`)
    console.log(tag + ': ' + JSON.stringify(metrics[tag]))
  }
  const setUi = async (theme) => {
    await evalJs(`localStorage.setItem('dsh.preview:ui', JSON.stringify({ pane:'dock', lang:'zh', theme:'${theme}', scenario:'ok' }))`)
    await send('Page.navigate', { url: URL_BASE })
    await sleep(3200)
  }
  const center = async () => evalJs(`(() => { const r = document.querySelector('.dock-ball').getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) } })()`)

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: URL_BASE })
  await sleep(3000)

  // ── 暗色：静止 / hover / 展开 ──
  await setUi('dark')
  await probe('dark-rest')
  await closeup('dark-rest')
  await shot('dark-full')
  const c = await center()
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, buttons: 0 })
  await sleep(500)
  await probe('dark-hover')
  await closeup('dark-hover')
  await evalJs(`document.querySelector('.dock-ball').click()`)
  await sleep(700)
  await probe('dark-open')
  await closeup('dark-open')
  await shot('dark-open-full')
  await evalJs(`document.querySelector('.dock-ball').click()`)
  await sleep(500)

  // ── 亮色：静止 / hover ──
  await setUi('light')
  await probe('light-rest')
  await closeup('light-rest')
  await shot('light-full')
  const c2 = await center()
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c2.x, y: c2.y, buttons: 0 })
  await sleep(500)
  await probe('light-hover')
  await closeup('light-hover')

  // ── 焦点态：CDP 强制 :focus-visible（等价键盘聚焦，且不依赖 headless 的焦点模拟）──
  await send('DOM.enable')
  await send('CSS.enable')
  const ballNodeId = async () => {
    const doc = await send('DOM.getDocument')
    const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '.dock-ball' })
    return node.result.nodeId
  }
  const forceFocus = async () => send('CSS.forcePseudoState', { nodeId: await ballNodeId(), forcedPseudoClasses: ['focus-visible'] })
  const clearForce = async () => send('CSS.forcePseudoState', { nodeId: await ballNodeId(), forcedPseudoClasses: [] })

  await forceFocus()
  await sleep(300)
  await probe('light-focus')
  await closeup('light-focus')
  await clearForce()

  // setUi 会整页重载，节点 id 必须重新取
  await setUi('dark')
  await forceFocus()
  await sleep(300)
  await probe('dark-focus')
  await closeup('dark-focus')
  await clearForce()

  // ── 真键盘 Tab 可达性（focus emulation 打开后键盘导航才生效）──
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Page.bringToFront')
  let reached = false
  for (let i = 0; i < 14; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, code: 'Tab', key: 'Tab', text: '\t' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, code: 'Tab', key: 'Tab' })
    await sleep(120)
    const focused = await evalJs(`(() => { const a = document.activeElement; return a ? { cls: String(a.className), vis: a.matches(':focus-visible') } : null })()`)
    if (focused && focused.cls.includes('dock-ball')) { reached = true; console.log('tab-reachable: ' + JSON.stringify(focused)); break }
  }
  metrics['tab-reachable'] = { reached }
  if (!reached) console.log('! 键盘 Tab 未到达悬浮球（headless 焦点模拟限制，非产品问题）')

  // ── 播报气泡：真事件驱动（POST /sparks → fixture 广播 sparks/changed → 气泡）──
  //    验证三件事：出现（文本 + role=status）、定位（球旁且不压球）、自动消失（4.2s）。
  const bubbleProbe = async () => evalJs(`(() => {
    const el = document.querySelector('.dock-bubble')
    if (el === null) return null
    const r = el.getBoundingClientRect()
    const b = document.querySelector('.dock-ball').getBoundingClientRect()
    const overlap = r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top
    const cs = getComputedStyle(el)
    // 未定位时的 shrink-to-fit：静态位置若贴视口右侧，会把可读宽度压成几十像素
    const keepL = el.style.left; const keepT = el.style.top
    el.style.left = ''; el.style.top = ''
    const unpositioned = [el.offsetWidth, el.offsetHeight]
    el.style.left = keepL; el.style.top = keepT
    const vw = window.innerWidth; const vh = window.innerHeight
    return {
      text: el.textContent, role: el.getAttribute('role'), live: el.getAttribute('aria-live'),
      pos: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      unpositioned,
      gapAboveBall: Math.round(b.top - r.bottom), overlapsBall: overlap,
      insideViewport: r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh,
      viewport: [vw, vh], ball: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) },
      bg: cs.backgroundColor, borderLeft: cs.borderLeftWidth + ' ' + cs.borderLeftColor,
      transition: cs.transitionProperty + ' ' + cs.transitionDuration, animation: cs.animationName,
    }
  })()`)
  const fired = await evalJs(`fetch('/sparks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '气泡走查', content: 'ball-shots', scope: 'project', tags: ['probe'] }) }).then(r => r.ok)`)
  await sleep(600)
  metrics['bubble-shown'] = await bubbleProbe()
  console.log('bubble-shown: ' + JSON.stringify(metrics['bubble-shown']))
  await shot('bubble-full')
  await closeup('bubble', 22, 3)
  await sleep(4200)
  metrics['bubble-auto-hidden'] = await bubbleProbe()
  console.log('bubble-auto-hidden: ' + JSON.stringify(metrics['bubble-auto-hidden']))
  metrics['bubble-fired'] = { fired }

  // 亮色气泡（整页重载会重置模块级去重窗口，故可再发一次同样的文本）
  await setUi('light')
  await evalJs(`fetch('/sparks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '气泡走查 · 亮色', content: 'ball-shots', scope: 'project', tags: ['probe'] }) }).then(r => r.ok)`)
  await sleep(600)
  metrics['bubble-shown-light'] = await bubbleProbe()
  console.log('bubble-shown-light: ' + JSON.stringify(metrics['bubble-shown-light']))
  await closeup('bubble-light', 22, 3)

  // ── 统一事件流：同一条逻辑流的第二个消费者（面板）也要收到帧 ──
  //    面板与气泡共用 `spark/events`（kit 订阅运行时按 name 做引用计数 + 本地扇出）。
  await setUi('dark')
  await evalJs(`document.querySelector('.dock-ball').click()`)
  await sleep(800)
  const marker = '走查-扇出-' + Date.now().toString(36)
  await evalJs(`fetch('/sparks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: ${JSON.stringify(marker)}, content: 'pane fan-out probe', scope: 'project', tags: ['probe'] }) }).then(r => r.ok)`)
  await sleep(1200)
  metrics['pane-fanout'] = await evalJs(`(() => {
    const body = document.querySelector('.dock-body')
    return {
      listed: body !== null && body.textContent.includes(${JSON.stringify(marker)}),
      rows: document.querySelectorAll('.dock-row').length,
    }
  })()`)
  console.log('pane-fanout: ' + JSON.stringify(metrics['pane-fanout']))
  await shot('pane-fanout')

  writeFileSync(OUT + LABEL + '-metrics.json', JSON.stringify(metrics, null, 2))
  ws.close()
} finally {
  edge.kill()
}
console.log('saved to ' + OUT)
