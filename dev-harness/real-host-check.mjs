/**
 * 真宿主事件通道验收（沙箱实例，非 mock）。
 *
 * 为什么需要它：dev-harness 预览把「物理载波」换成了 mock（`mock/streams.ts`），
 * 只能证明插件侧代码与扇出/引用计数；**平台侧 typert stream 是否真的在跑**
 * 必须在真宿主上验。P1 之后产品里已经没有任何 spark SSE 端点，所以：
 *
 *   「真宿主里悬浮球气泡能弹出来」 == 「spark.events() 这条 mux stream 端到端可用」
 *
 * 用法：
 *   node dev-harness/real-host-check.mjs                     # 读 .dev/state.json 的 url
 *   node dev-harness/real-host-check.mjs --url http://127.0.0.1:3997/?token=...
 * 前置：`pnpm sandbox:install` + `pnpm sandbox:up --detach`（或任何已装 dock 的真宿主）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.CDP_PORT ?? 9225)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const argv = process.argv.slice(2)
const urlArgIndex = argv.indexOf('--url')
const URL_TARGET = urlArgIndex >= 0
  ? argv[urlArgIndex + 1]
  : JSON.parse(readFileSync(ROOT + '.dev/state.json', 'utf8')).url

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!existsSync(EDGE)) {
  console.error('找不到浏览器：' + EDGE)
  process.exit(1)
}

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + ROOT + '.dev/real-host-profile', '--window-size=1440,900', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail === '' ? '' : '   ' + detail))
}

try {
  let target = null
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      target = list.find((entry) => entry.type === 'page')
      if (target) break
    } catch { /* retry */ }
  }
  if (!target) throw new Error('no CDP page target')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  // 控制台/异常采集：事件通道挂掉时，成因几乎总能在这里看到
  const console_ = []
  const rawSend = ws.send.bind(ws)
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ')
      // 浏览器自带扩展（chrome-extension:// 里的报错）与我们无关，不进诊断面，
      // 否则「控制台 0 条」这个信号会被噪声污染。
      if (!text.includes('chrome-extension://') && !text.includes('moz-extension://')) {
        console_.push(message.params.type + ': ' + text)
      }
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = String(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? '')
      if (!detail.includes('chrome-extension://') && !detail.includes('moz-extension://')) {
        console_.push('exception: ' + detail)
      }
    }
  }
  void rawSend
  const evalJs = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails))
    return result.result?.result?.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: URL_TARGET })
  await sleep(6000)

  const ready = await evalJs(`(() => ({
    title: document.title,
    ball: document.querySelectorAll('.dock-ball').length,
    panel: document.querySelectorAll('.dock-panel').length,
    body: document.body.textContent.length,
  }))()`)
  check('真宿主首屏渲染', ready.body > 0, JSON.stringify(ready))
  check('dock 悬浮球挂载（client bundle 由 profile 加载）', ready.ball === 1, 'ball=' + ready.ball)

  if (ready.ball === 1) {
    // 1) 事件通道：捕获一条 → 只有 mux stream 还在（产品已无 SSE 端点）才能弹气泡
    //    注意：真宿主的 capture schema 要求 sourceSessionId（预览 fixture 会给默认值，
    //    所以这是 harness 比产品**更宽松**的一处保真缺口）。
    const fired = await evalJs(`fetch('/sparks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '真宿主验收 ' + Date.now().toString(36),
        content: 'real host stream probe',
        scope: 'project',
        tags: ['probe'],
        sourceSessionId: 'real-host-check',
        sourceAgentId: null,
        sourceTurn: null,
      }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: (await r.text()).slice(0, 200) }))`)
    check('POST /sparks 被真宿主接受', fired.ok === true, JSON.stringify(fired))

    await sleep(1500)
    const bubble = await evalJs(`(() => {
      const el = document.querySelector('.dock-bubble')
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { text: el.textContent, role: el.getAttribute('role'), live: el.getAttribute('aria-live'), w: Math.round(r.width), h: Math.round(r.height) }
    })()`)
    check('气泡经 mux stream 到达（产品已无 SSE）', bubble !== null, JSON.stringify(bubble))
    if (bubble !== null) {
      check('气泡文案与 a11y', bubble.text.includes('捕获了新火花') && bubble.role === 'status' && bubble.live === 'polite', JSON.stringify(bubble))
    }

    // 2) 反向证明：SSE 端点确实不存在了（404 / 非 event-stream）
    const sse = await evalJs(`fetch('/sparks/events').then(async (r) => ({ status: r.status, type: r.headers.get('content-type') })).catch((e) => ({ error: String(e) }))`)
    check('旧 SSE 端点已移除（/sparks/events）', sse.status === 404 || sse.type === null || !String(sse.type).includes('event-stream'), JSON.stringify(sse))

    // 3) 面板扇出：同一条流喂给第二个消费者（显式切回「火花」，不依赖上次遗留的 active 模块）
    await evalJs(`localStorage.removeItem('dsh.spark-dock:active')`)
    await evalJs(`document.querySelector('.dock-ball').click()`)
    await sleep(800)
    await evalJs(`(() => { const tabs = Array.from(document.querySelectorAll('.dock-tab')); const spark = tabs.find((b) => b.getAttribute('aria-label') === '火花'); if (spark) spark.click() })()`)
    await sleep(1000)
    const pane = await evalJs(`(() => {
      const body = document.querySelector('.dock-body')
      return {
        rows: document.querySelectorAll('.dock-row').length,
        hasBall: document.querySelectorAll('.dock-ball').length,
        head: document.querySelector('.dock-head .name')?.textContent ?? null,
        text: (body?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 300),
      }
    })()`)
    check('面板打开且列出火花行', pane.rows > 0, JSON.stringify(pane))

    // 4) 记忆模块：hippomemo 事件通道（同一条 mux 载波、另一条 stream 方法）
    const memoryTitle = '真宿主记忆验收 ' + Date.now().toString(36)
    const tabs = await evalJs(`Array.from(document.querySelectorAll('.dock-tab')).map((b) => b.getAttribute('aria-label'))`)
    const memoryIndex = Array.isArray(tabs) ? tabs.indexOf('记忆') : -1
    check('模块栏含「记忆」', memoryIndex >= 0, JSON.stringify(tabs))
    if (memoryIndex >= 0) {
      await evalJs(`document.querySelectorAll('.dock-tab')[${memoryIndex}].click()`)
      await sleep(1500)
      const put = await evalJs(`fetch('/hippomemo/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'fact', title: ${JSON.stringify(memoryTitle)}, content: 'real host hippomemo stream probe', tags: ['probe'], scope: 'project' }),
      }).then(async (r) => ({ ok: r.ok, status: r.status, body: (await r.text()).slice(0, 160) }))`)
      check('POST /hippomemo/records 被真宿主接受', put.ok === true, JSON.stringify(put))
      await sleep(2500)
      const memoryText = await evalJs(`(document.querySelector('.dock-body')?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 600)`)
      // 旁白/最近活动里的标题会被截断成「真宿主记忆验收 mtvi…」，所以断言前缀。
      check('记忆列表出现新条目（hippomemo stream 送达）', String(memoryText).includes('真宿主记忆验收'), String(memoryText).slice(0, 260))
      // 上面那条文字断言会被「旁白/最近活动」里的同一标题**误判为通过**，所以再加一条
      // 只认事件通道本身的硬断言：客户端不得报通道不可用（否则订阅根本没建立）。
      const channelWarnings = console_.filter((line) => /事件通道不可用|mount 失败|already mounted|missed the module table/.test(line))
      check('hippomemo 事件通道无告警（订阅真的建立了）', channelWarnings.length === 0, JSON.stringify(channelWarnings.slice(0, 2)))
    }

    // 5) ADR-003：npm 模块由插件自注册（dock 不再静态 import 它）——
    //    真宿主里必须出现 npm tab，且点开后渲染的是插件自己的 NpmSection。
    const npmIndex = Array.isArray(tabs) ? tabs.indexOf('npm') : -1
    check('模块栏含自注册的 npm 模块（ADR-003）', npmIndex >= 0, JSON.stringify(tabs))
    if (npmIndex >= 0) {
      await evalJs(`document.querySelectorAll('.dock-tab')[${npmIndex}].click()`)
      await sleep(1500)
      const npmPane = await evalJs(`(() => {
        const head = document.querySelector('.dock-head .name')?.textContent ?? ''
        const body = (document.querySelector('.dock-body')?.textContent ?? '').replace(/\\s+/g, ' ')
        return { head, len: body.length, sample: body.slice(0, 240), failed: body.includes('装配失败') }
      })()`)
      check('npm 模块标题行走子槽 header 位', String(npmPane.head).includes('npm'), JSON.stringify(npmPane.head))
      check('npm 内容走子槽 pane 位且未失败', npmPane.len > 40 && npmPane.failed !== true, JSON.stringify(npmPane).slice(0, 300))
    }

    // 4) 诊断：控制台里与事件通道/remote 相关的线索
    const interesting = console_.filter((line) => /spark|dock|remote|stream|mux|event|Error|error|warn/.test(line))
    console.log('\n--- 控制台（过滤后 ' + interesting.length + '/' + console_.length + ' 条）---')
    for (const line of interesting.slice(0, 20)) console.log('    ' + line.slice(0, 300))
  }

  // 无论球有没有挂上，都把控制台线索打出来（挂载失败时这里才是答案）
  const allInteresting = console_.filter((line) => /spark|dock|remote|stream|mux|event|Error|error|warn/.test(line))
  console.log('\n--- 控制台（过滤后 ' + allInteresting.length + '/' + console_.length + ' 条）---')
  for (const line of allInteresting.slice(0, 24)) console.log('    ' + line.slice(0, 300))
} finally {
  edge.kill()
}

const failed = checks.filter((item) => !item.ok).length
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' 项通过')
process.exit(failed === 0 ? 0 : 1)
