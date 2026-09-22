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

/**
 * 图谱边的类型集合 —— **从 wire 契约源码读**，不手抄第二份（AGENTS.md 铁律 5）。
 *
 * 曾经的写法是硬编码 `['tag', 'proposal']`，F2 给 `graph.ts` 加了 `derived` 边之后
 * 它就一直是错的；只要沙箱库里有衍生火花且落进图谱窗口，断言必红（2026-09-23 实测）。
 *
 * 解析失败**抛错**而不是回退成宽松集合：一个「永远为真」的断言等于没有断言。
 */
let graphEdgeKindsCache = null
function graphEdgeKinds() {
  if (graphEdgeKindsCache !== null) return graphEdgeKindsCache
  const file = fileURLToPath(new URL('../packages/dsh-spark-wire/src/index.ts', import.meta.url))
  const src = readFileSync(file, 'utf8')
  const match = /sparkGraphEdgeKindSchema\s*=\s*z\.enum\(\[([^\]]*)\]\)/.exec(src)
  if (match === null) {
    throw new Error('无法从 wire 契约解析 sparkGraphEdgeKindSchema：' + file)
  }
  const kinds = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  if (kinds.length === 0) throw new Error('sparkGraphEdgeKindSchema 解析出空枚举：' + file)
  graphEdgeKindsCache = new Set(kinds)
  return graphEdgeKindsCache
}

/**
 * 浏览器发现（跨平台）。
 *
 * 为什么不能写死：原先只认 Windows Edge 的绝对路径，任何非 Windows 机器上脚本
 * 直接以「找不到浏览器」退出 —— 注册面断言（本脚本存在的理由）整段跑不起来。
 * 优先级：`EDGE_PATH` 环境变量 → 各平台常见安装位置 → `PATH` 里的命令名。
 * 只找 Chromium 系（CDP 是 Chromium 协议，Firefox/Safari 不支持）。
 */
const BROWSER_CANDIDATES = process.platform === 'darwin'
  ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ]
  : process.platform === 'win32'
    ? [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ]
    : [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    ]

/** PATH 里可以直接 spawn 的命令名（最后兜底）。 */
const BROWSER_COMMANDS = ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome', 'msedge']

/** 是否位于 PATH（避免为了探测装 which 依赖：逐段查文件即可）。 */
function onPath(command) {
  const dirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of dirs) {
    if (dir === '') continue
    for (const ext of exts) {
      if (existsSync(dir + (process.platform === 'win32' ? '\\' : '/') + command + ext)) return true
    }
  }
  return false
}

/** 解析出可用的浏览器路径/命令；找不到返回 undefined。 */
export function resolveBrowser(env = process.env) {
  if (env.EDGE_PATH !== undefined && env.EDGE_PATH !== '') return env.EDGE_PATH
  for (const candidate of BROWSER_CANDIDATES) if (existsSync(candidate)) return candidate
  for (const command of BROWSER_COMMANDS) if (onPath(command)) return command
  return undefined
}

const EDGE = resolveBrowser()
const PORT = Number(process.env.CDP_PORT ?? 9225)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const argv = process.argv.slice(2)
const urlArgIndex = argv.indexOf('--url')
/** 状态文件只在沙箱宿主存活期间存在（dev-up 退出时会清掉死 token）。 */
const readStateUrl = () => {
  try {
    return JSON.parse(readFileSync(ROOT + '.dev/state.json', 'utf8')).url
  } catch {
    console.error('读不到 .dev/state.json —— 请先启动沙箱宿主：pnpm sandbox:up（前台，放后台跑）')
    console.error('或用 --url 直接给出带 token 的 URL（宿主启动时会打印）。')
    process.exit(1)
  }
}
const URL_TARGET = urlArgIndex >= 0
  ? argv[urlArgIndex + 1]
  : readStateUrl()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (EDGE === undefined) {
  console.error('找不到 Chromium 系浏览器（CDP 需要它）。已尝试：')
  for (const candidate of BROWSER_CANDIDATES) console.error('  ' + candidate)
  console.error('指定路径：EDGE_PATH=/path/to/chrome node dev-harness/real-host-check.mjs')
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

/** CDP WebSocket：提到 try 外，退出前显式 close —— 见文件尾注释。 */
let ws = null

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

  ws = new WebSocket(target.webSocketDebuggerUrl)
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
  // 让无头页面保持 `visibilityState: visible`（**必须有**，2026-09-19 定位）。
  //
  // 症状：PCQA-002「视口缩小后球重吸附」稳定失败，且页面的 resize 监听器一次都不触发
  // （innerWidth 已变成 1100，球却停在旧坐标）。实测根因**不是 dock**：
  // 只要用真 CDP 输入发过一个键（本脚本的键盘断言必需），无头页面就翻成 hidden，
  // 而 Chromium **不向 hidden 页面派发 resize** —— 重吸附逻辑于是根本没被调用。
  // 这个坑极具迷惑性：dock 实现是对的，不注入键盘的独立复现一切正常。
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  // 宿主装配就绪再导航：dev-up 一拿到 token 就写 state.json，此时插件可能还在装配
  // （client 模块图未就绪 → 页面里根本没有悬浮球）。用 `/__dev/probe` 作为就绪信号：
  // clientModules 服务在位、且被测插件的 host typert 已注册 —— 这是"可以开始断言"的
  // 客观条件，比 sleep 猜时长可靠（2026-09 冷启动首跑假失败就是这么来的）。
  const waitHostAssembled = async () => {
    const port = new URL(URL_TARGET).port
    const deadline = Date.now() + 60_000
    let last = ''
    while (Date.now() < deadline) {
      try {
        const probe = await fetch(`http://127.0.0.1:${port}/__dev/probe`).then((r) => r.json())
        last = JSON.stringify(probe.services ?? {})
        const packages = probe.typert?.packages ?? []
        if (probe.services?.clientModules === true && packages.includes('dsh-spark:host')) return true
      } catch (error) {
        last = error instanceof Error ? error.message : String(error)
      }
      await sleep(1000)
    }
    console.warn('宿主装配等待超时（继续跑，后续断言会体现真实状态）：' + last)
    return false
  }
  await waitHostAssembled()

  await send('Page.navigate', { url: URL_TARGET })
  await sleep(4000)

  // 就绪等待：宿主**冷启动**时 client 模块图是异步装配的（首帧 body 已有内容、
  // 悬浮球还没挂上）。固定 sleep 会把它读成「bundle 没加载」而整段假失败 ——
  // 实测冷启动首跑 ball=0、立刻重跑就 69/69（2026-09 连续踩到两次）。所以这里
  // 轮询到球出现为止（上限 20s），判据仍落在同一个节点上，不放松断言。
  const readReady = async () => evalJs(`(() => ({
    title: document.title,
    ball: document.querySelectorAll('.dock-ball').length,
    panel: document.querySelectorAll('.dock-panel').length,
    body: document.body.textContent.length,
  }))()`)
  let ready = await readReady()
  for (let attempt = 0; attempt < 12 && ready.ball !== 1; attempt += 1) {
    await sleep(2500)
    ready = await readReady()
  }
  // 仍没挂上就重载一次再等：宿主刚冷启动时，浏览器这一侧要拉 6MB 级 client 产物 +
  // 装配模块图，偶发超过 30s（表现为 title 还是默认 '127.0.0.1'、body 已有内容但
  // 悬浮球未挂）。重载是幂等的，且不放松任何断言 —— 判据仍是"球真的在"。
  if (ready.ball !== 1) {
    await send('Page.reload', { ignoreCache: false })
    for (let attempt = 0; attempt < 12 && ready.ball !== 1; attempt += 1) {
      await sleep(2500)
      ready = await readReady()
    }
  }
  check('真宿主首屏渲染', ready.body > 0, JSON.stringify(ready))

  // 0) 先过掉宿主的**首启引导模态**（dsh 0.1.5-rc.x 新增：内测声明 → 添加一个 API Key → …）。
  //
  // 为什么必须先做：引导模态会把 `#root` 整个置为 `inert`，于是**任何** `element.focus()`
  // 都变成空操作 —— 表现为 PCQA-001 三条断言全红（"焦点落不进面板"/"关闭态 inert"/"焦点回球"）
  // 与 PCQA-004/005/009 的键盘类断言连锁失败。这是宿主行为，不是 dock/插件的缺陷；
  // harness 的职责是把宿主前置状态归零再断言。
  //
  // 步骤数不确定（不同 profile 首次启动停在不同页），所以循环点「继续 / 稍后配置」直到
  // `#root` 不再是 inert —— 用**状态**收敛而不是猜步数。
  let onboarding = { steps: [], rootInert: true }
  for (let i = 0; i < 6; i += 1) {
    const step = await evalJs(`(() => {
      const root = document.getElementById('root')
      const rootInert = root?.hasAttribute('inert') === true
      if (rootInert === false) return { done: true, rootInert }
      // 引导模态挂在 #root 之外的独立 layer 上；它的按钮文案是「继续 / 稍后配置 / 跳过」。
      const digits = [...document.querySelectorAll('button,[role="button"]')]
        .filter((b) => /^(继续|稍后配置|跳过|知道了|开始使用)$/.test((b.textContent ?? '').trim()))
      const text = digits.map((b) => (b.textContent ?? '').trim()).join('/')
      for (const b of digits) b.click()
      return { done: false, rootInert, clicked: text }
    })()`)
    onboarding.steps.push(step)
    if (step?.done === true) break
    await sleep(900)
  }
  await sleep(500)
  const rootInertAfter = await evalJs(`document.getElementById('root')?.hasAttribute('inert') === true`)
  check(
    '宿主首启引导模态已过掉（#root 不再 inert —— 前置条件，非插件断言）',
    rootInertAfter === false,
    JSON.stringify({ steps: onboarding.steps.map((s) => s?.clicked ?? s?.done), rootInertAfter }),
  )

  // 球的断言放在引导模态之后：冷启动时引导层先出现，client bundle 的装配要等它散掉
  // 才继续（实测首跑 ball=0、立刻重跑就是 1；两次踩坑后固化成"等待 + 只在就绪后断言"）。
  for (let attempt = 0; attempt < 6 && ready.ball !== 1; attempt += 1) {
    await sleep(2000)
    ready = await readReady()
  }
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
    }).then(async (r) => ({ ok: r.ok, status: r.status, value: await r.json().then((j) => j.value).catch(() => null) }))`)
    check('POST /sparks 被真宿主接受', fired.ok === true, JSON.stringify(fired))
    check('POST /sparks 带回 provenance（v2 P12：无 agentId → origin=human，generation=0）',
      fired.value?.origin === 'human' && Array.isArray(fired.value?.derivedFrom) && fired.value?.generation === 0,
      JSON.stringify(fired).slice(0, 220))

    await sleep(1500)
    const bubble = await evalJs(`(() => {
      const el = document.querySelector('.dock-bubble')
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { text: el.textContent, role: el.getAttribute('role'), live: el.getAttribute('aria-live'), w: Math.round(r.width), h: Math.round(r.height) }
    })()`)
    check('气泡经 mux stream 到达（产品已无 SSE）', bubble !== null, JSON.stringify(bubble))
    if (bubble !== null) {
      check('气泡文案与 a11y', bubble.text.includes('记下了新想法') && bubble.role === 'status' && bubble.live === 'polite', JSON.stringify(bubble))
    }

    // 2) 反向证明：SSE 端点确实不存在了（404 / 非 event-stream）
    const sse = await evalJs(`fetch('/sparks/events').then(async (r) => ({ status: r.status, type: r.headers.get('content-type') })).catch((e) => ({ error: String(e) }))`)
    check('旧 SSE 端点已移除（/sparks/events）', sse.status === 404 || sse.type === null || !String(sse.type).includes('event-stream'), JSON.stringify(sse))

    // 3) 面板扇出：同一条流喂给第二个消费者（显式切回「火花」，不依赖上次遗留的 active 模块）
    await evalJs(`localStorage.removeItem('dsh.spark-dock:active')`)
    await evalJs(`document.querySelector('.dock-ball').click()`)
    await sleep(800)
    // 2026-09-16 起 tab aria-label 会带「，N 项待处理」徽章后缀（dock-module.ts），按前缀匹配。
    await evalJs(`(() => { const tabs = Array.from(document.querySelectorAll('.dock-tab')); const spark = tabs.find((b) => (b.getAttribute('aria-label') ?? '').startsWith('火花')); if (spark) spark.click() })()`)
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

    // 3b) 收件箱化（2026-09-14，设计 §4.1/§4.2）：真宿主必须给出新契约
    //     —— stats 形状、收件箱筛选存在、且旧的 status 语义确实失效。
    const statsProbe = await evalJs(`fetch('/sparks/stats').then(async (r) => ({ ok: r.ok, status: r.status, value: await r.json() }))`)
    const statsValue = statsProbe?.value?.value
    check(
      'GET /sparks/stats 返回收件箱计数（与 /sparks 同源）',
      statsProbe?.ok === true && statsValue !== undefined
        && typeof statsValue.active === 'number' && typeof statsValue.archived === 'number'
        && typeof statsValue.deleted === 'number' && typeof statsValue.pendingProposals === 'number'
        && statsValue.crystallized === undefined && statsValue.dropped === undefined,
      JSON.stringify(statsProbe).slice(0, 220),
    )
    // 3b-2) 关联图谱（2026-09 补齐 Graph 子页）：契约与图算法不变量。
    //     这里断言的是**结构不变量**而不是数据巧合：边两端必须都在节点表里、
    //     id 带类型前缀、度数与边数自洽 —— 沙箱数据是可变的，节点数不能断言。
    //
    // 2026-09-23 修复一处**陈旧断言**：这里原先硬写 `['tag', 'proposal']`，而契约
    // (`sparkGraphEdgeKindSchema`) 是三类边 `tag / proposal / derived`。`derived`
    // 边是 F2（provenance，commit 694385d）加进 `graph.ts` 的，断言却从 F1 起没再动
    // ——只要沙箱库涨到让 60 节点窗口纳入一条 derived 边，这条断言就必红。
    // 按 AGENTS.md 铁律 5（契约不允许手抄两份），改为**从契约源码读枚举**，
    // 且解析不出来就 fail-loud —— 宁可红，也不要一个「永远为真」的断言。
    const graphProbe = await evalJs(`fetch('/sparks/graph?limit=60').then(async (r) => ({ ok: r.ok, status: r.status, value: await r.json() }))`)
    const graphValue = graphProbe?.value?.value
    const graphNodes = Array.isArray(graphValue?.nodes) ? graphValue.nodes : []
    const graphEdges = Array.isArray(graphValue?.edges) ? graphValue.edges : []
    const nodeIds = new Set(graphNodes.map((n) => n.id))
    const endpointsOk = graphEdges.every((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    const idsOk = graphNodes.every((n) => n.id.startsWith('spark:'))
    const kindsOk = graphEdges.every((e) => graphEdgeKinds().has(e.kind))
    const degreeOk = graphNodes.every((n) => {
      const deg = graphEdges.filter((e) => e.source === n.id || e.target === n.id).length
      return n.degree === deg
    })
    check(
      'GET /sparks/graph 返回图谱（边两端在图内 · id 带类型前缀 · 度数与边自洽）',
      graphProbe?.ok === true && Array.isArray(graphValue?.nodes) && Array.isArray(graphValue?.edges)
        && typeof graphValue?.truncated === 'boolean'
        && endpointsOk && idsOk && kindsOk && degreeOk,
      JSON.stringify({ nodes: graphNodes.length, edges: graphEdges.length, endpointsOk, idsOk, kindsOk, degreeOk }),
    )

    // 3b-3) 图谱的**渲染面**：只断言 API 形状证明不了图能画出来（铁律 4 的镜像）。
    //     造两条共享 2 个标签的火花 → 必产生一条 tag 边 → 切到 Graph 页，
    //     断言 SVG 里真的有节点与边元素、且图例在场。
    const pairStamp = Date.now().toString(36)
    for (const suffix of ['a', 'b']) {
      await evalJs(`fetch('/sparks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: '图谱验收 ' + ${JSON.stringify(pairStamp)} + '-' + '${suffix}',
          content: 'graph probe ' + '${suffix}',
          scope: 'project',
          tags: ['graph-probe', ${JSON.stringify(pairStamp)}],
          sourceSessionId: 'real-host-check',
          sourceAgentId: null,
          sourceTurn: null,
        }),
      })`)
    }
    // 子页条是模块自己的 SegmentedControl（不是 dock 的 .dock-tab —— 那是模块级 tab，
    // 点它会重新选中「火花」模块本身，第一版就是这么空转的）。
    const graphTab = await evalJs(`(() => {
      const btns = Array.from(document.querySelectorAll('.dock-embed button'))
      const target = btns.find((b) => (b.textContent ?? '').trim() === 'Graph')
      if (target === undefined) return null
      target.click()
      return (target.textContent ?? '').trim()
    })()`)
    await sleep(1400)
    const graphDom = await evalJs(`(() => {
      const svg = document.querySelector('.dock-graph-svg')
      return {
        hasSvg: svg !== null,
        nodes: document.querySelectorAll('.dock-graph-node').length,
        edges: document.querySelectorAll('.dock-graph-edge').length,
        legend: document.querySelectorAll('.dock-graph-legend li').length,
        summary: document.querySelector('.dock-graph-summary')?.textContent ?? null,
      }
    })()`)
    check(
      'Graph 子页渲染关联图（SVG 节点/边/图例在场，共享标签产生边）',
      graphTab !== null && graphDom.hasSvg === true && graphDom.nodes > 0
        && graphDom.edges > 0 && graphDom.legend >= 4,
      JSON.stringify(graphDom),
    )

    // 断言放在**面板文本**上而不是某个 CSS 选择器上：行内的动作钮与筛选位同类名，
    // 按类名取会取错（第一版就是这么误判的）。
    // 2026-09-21 v2 词表（P16 朴素命名）：筛选位 = 活跃 / 已归档 / 已删除（互斥位）。
    const inboxText = String(pane.text ?? '')
    check(
      '灵感筛选位可见（活跃/已归档/已删除）',
      ['活跃', '已归档', '已删除'].every((label) => inboxText.includes(label)),
      inboxText.slice(0, 160),
    )
    // 破坏性变更的可观测证据（v2 P11）：旧 `inboxState` 参数被忽略（返回全量），新 `status` 才过滤。
    // 注意**不要**断言 archived 子集为 0：沙箱数据是可变的 —— 断言要表达不变量，不是数据巧合。
    const legacyFilter = await evalJs(`Promise.all([
      fetch('/sparks?inboxState=archived&limit=200').then((r) => r.json()),
      fetch('/sparks?status=archived&limit=200').then((r) => r.json()),
      fetch('/sparks?limit=200').then((r) => r.json()),
    ]).then(([legacy, modern, all]) => ({
      legacy: legacy.value?.length ?? -1,
      modern: modern.value?.length ?? -1,
      all: all.value?.length ?? -1,
    }))`)
    check(
      '旧 inboxState 查询参数已失效（inboxState= 被忽略返回全量，只有 status= 会过滤）',
      legacyFilter?.legacy === legacyFilter?.all && legacyFilter?.modern >= 0 && legacyFilter?.modern < legacyFilter?.all,
      JSON.stringify(legacyFilter),
    )

    // 3b-2b) provenance 语义（2026-09-21 修正）：来源与提出者正交 ——
    //        Agent 自述 derivedFrom 后 origin 仍是 agent，且不自动过期。
    const provenanceProbe = await evalJs(`(async () => {
      const seed = await fetch('/sparks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        title: 'provenance seed ' + Date.now().toString(36), content: 'seed', scope: 'project', tags: [], sourceSessionId: 'real-host-check', sourceAgentId: null, sourceTurn: null,
      }) }).then((r) => r.json())
      const seedId = seed?.value?.id
      const distilled = await fetch('/sparks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        title: 'provenance distilled ' + Date.now().toString(36), content: 'higher level', scope: 'project', tags: [],
        sourceSessionId: 'real-host-check', sourceAgentId: 'agent-real-host', sourceTurn: null, derivedFrom: [seedId],
      }) }).then((r) => r.json())
      return { origin: distilled?.value?.origin, generation: distilled?.value?.generation, derivedFrom: distilled?.value?.derivedFrom, expiresAt: distilled?.value?.expiresAt }
    })()`)
    check(
      'POST /sparks 带 derivedFrom + agent 来源 → origin=agent（来源≠机器生成）、generation=1、不设 TTL',
      provenanceProbe?.origin === 'agent' && provenanceProbe?.generation === 1
        && Array.isArray(provenanceProbe?.derivedFrom) && provenanceProbe.derivedFrom.length === 1
        && provenanceProbe?.expiresAt === null,
      JSON.stringify(provenanceProbe),
    )

    // 3b-3) 重新激活 + 召回计数（v2 P14）：capture → archive → reactivate
    //      断言「状态回 active」且「召回计数 +1」（两个副作用都要落地）。
    const reactivateProbe = await evalJs(`(async () => {
      const cs = await fetch('/sparks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        title: 'P14 重新激活验收 ' + Date.now().toString(36), content: 'reactivate probe', scope: 'project',
        tags: ['probe'], sourceSessionId: 'real-host-check', sourceAgentId: null, sourceTurn: null,
      }) }).then((r) => r.json())
      const id = cs?.value?.id
      if (id === undefined) return { step: 'capture-failed', cs }
      const archived = await fetch('/sparks/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) }).then((r) => r.json())
      const back = await fetch('/sparks/' + id + '/reactivate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json())
      return { id, archived: archived?.value?.status, status: back?.value?.status, recalledCount: back?.value?.recalledCount, lastRecalledAt: back?.value?.lastRecalledAt }
    })()`)
    check(
      'POST /sparks/:id/reactivate 拉回 active 并记一次召回（v2 P14）',
      reactivateProbe?.archived === 'archived' && reactivateProbe?.status === 'active'
        && reactivateProbe?.recalledCount === 1 && typeof reactivateProbe?.lastRecalledAt === 'number',
      JSON.stringify(reactivateProbe),
    )

    // 3b-4) 衍生引擎（v2 §5 P15/P17）：dryRun 只选候选对、不调 LLM，
    //       给生成类能力一个确定性、零成本的注册面断言。
    const deriveProbe = await evalJs(`fetch('/sparks/derive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dryRun: true }) }).then(async (r) => ({ ok: r.ok, status: r.status, value: await r.json() }))`)
    check(
      'POST /sparks/derive 已注册且 dryRun 只选候选对（不调 LLM）',
      deriveProbe?.ok === true && typeof deriveProbe?.value?.value?.pairsConsidered === 'number'
        && Array.isArray(deriveProbe?.value?.value?.created) && Array.isArray(deriveProbe?.value?.value?.rejected)
        && deriveProbe.value.value.skipped === 'dry run',
      JSON.stringify(deriveProbe).slice(0, 220),
    )

    // 3c) 语义检索（v2 P13）：只读端点必须与注入面同源，且无匹配不兜底全量。
    const sparkSearchProbe = await evalJs(`fetch('/sparks/search?q=' + encodeURIComponent('真宿主验收') + '&limit=5').then(async (r) => ({ ok: r.ok, value: await r.json() }))`)
    const searchValue = sparkSearchProbe?.value?.value
    check(
      'GET /sparks/search 返回相关火花（只读，非全量兜底）',
      sparkSearchProbe?.ok === true && Array.isArray(searchValue) && searchValue.length > 0
        && searchValue.every((s) => s.status === 'active' && s.deletedAt === null),
      JSON.stringify(sparkSearchProbe).slice(0, 220),
    )
    const sparkSearchMissProbe = await evalJs(`fetch('/sparks/search?q=zzzznomatchzzz&limit=5').then(async (r) => ({ ok: r.ok, value: await r.json() }))`)
    check(
      'GET /sparks/search 无匹配返回空数组',
      sparkSearchMissProbe?.ok === true && Array.isArray(sparkSearchMissProbe?.value?.value) && sparkSearchMissProbe.value.value.length === 0,
      JSON.stringify(sparkSearchMissProbe).slice(0, 160),
    )
    const sparkSearchById = await evalJs(`fetch('/sparks/search').then(async (r) => ({ status: r.status, value: await r.json() }))`)
    check('GET /sparks/search 不会被当成按 id 取（空 q → 空数组而非 404）',
      sparkSearchById?.status === 200 && Array.isArray(sparkSearchById?.value?.value) && sparkSearchById.value.value.length === 0,
      JSON.stringify(sparkSearchById).slice(0, 160))

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

    // 5) ADR-003：五个模块全部由插件自注册（dock 不再静态 import 任何插件 UI）——
    //    真宿主里必须五个 tab 都在，且每个模块点开后渲染出内容而不是失败态。
    const expectedTabs = ['火花', '记忆', '财务', 'GitHub', 'npm', '脚本']
    // 徽章后缀（「火花，N 项待处理」）并入 aria-label 是有意的 a11y 行为，断言按前缀匹配。
    check('模块栏含全部自注册模块（ADR-003）', expectedTabs.every((label) => Array.isArray(tabs) && tabs.some((tab) => tab.startsWith(label))), JSON.stringify(tabs))
    for (const label of expectedTabs) {
      const index = Array.isArray(tabs) ? tabs.indexOf(label) : -1
      if (index < 0) continue
      await evalJs(`document.querySelectorAll('.dock-tab')[${index}].click()`)
      await sleep(1500)
      const paneState = await evalJs(`(() => {
        const head = document.querySelector('.dock-head .name')?.textContent ?? ''
        const body = (document.querySelector('.dock-body')?.textContent ?? '').replace(/\\s+/g, ' ')
        return { head, len: body.length, failed: /装配失败|未加载/.test(body), sample: body.slice(0, 120) }
      })()`)
      check(`模块「${label}」标题行走子槽 header 位`, String(paneState.head).trim().length > 0 && !paneState.failed, JSON.stringify(paneState.head))
      check(`模块「${label}」内容走子槽 pane 位且未失败`, paneState.len > 30 && paneState.failed !== true, JSON.stringify(paneState).slice(0, 240))
    }

    // 6) 脚本沉淀库（dsh-script）：读模型 / 治理面 / 结算。
    //    这一段的判据全部落在**宿主侧**（HTTP 读模型 + typert 注册面），不靠"面板能开"——
    //    闸门铁律 4：面板能渲染证明不了任何注册承诺（HTTP 前缀没注册也能靠兜底渲染）。
    const scriptTabIndex = Array.isArray(tabs) ? tabs.indexOf('脚本') : -1
    if (scriptTabIndex >= 0) {
      await evalJs(`document.querySelectorAll('.dock-tab')[${scriptTabIndex}].click()`)
      await sleep(2000)
    }
    const scriptList = await fetch('http://127.0.0.1:3997/scripts?limit=100', { headers: { connection: 'close' } })
      .then((r) => r.json()).catch(() => null)
    // 只断言**不变量**（形状），不断言"恰好有调用过"这类数据巧合：
    // 沙箱库是可变的，断言数据巧合会随验收轮次翻红（本文件 line 418 的老教训）。
    check(
      'GET /scripts 是真宿主的读模型（不含 steps，带 stepCount 与宿主算的 successRate）',
      scriptList?.ok === true
        && Array.isArray(scriptList.value)
        && scriptList.value.length > 0
        && scriptList.value.every((item) => item.steps === undefined
          && typeof item.stepCount === 'number'
          && typeof item.successRate === 'number'
          && Array.isArray(item.invokedWorkspaces)),
      JSON.stringify(scriptList?.value?.[0] ?? scriptList).slice(0, 240),
    )
    const auditRead = await fetch('http://127.0.0.1:3997/scripts/audit', { headers: { connection: 'close' } })
      .then((r) => r.json()).catch(() => null)
    check(
      'GET /scripts/audit 返回审计负载（统计 + 待裁决建议，且只读不结算）',
      auditRead?.ok === true
        && auditRead.value?.archived === 0
        && typeof auditRead.value?.stats?.byStatus?.active === 'number'
        && typeof auditRead.value?.stats?.rateBuckets?.high === 'number'
        && typeof auditRead.value?.stats?.acceptance?.ratio === 'number'
        && Array.isArray(auditRead.value?.advices)
        && auditRead.value.advices.every((advice) => advice.detail === undefined && typeof advice.evidence?.invocationCount === 'number'),
      JSON.stringify(auditRead?.value?.stats ?? auditRead).slice(0, 240),
    )
    // 结算幂等（Spec INV-13）：连跑两次，第二次必须是 0 —— 这是"唯一自动动作"的安全边界。
    const sweepFirst = await fetch('http://127.0.0.1:3997/scripts/sweep', { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: '{}' })
      .then((r) => r.json()).catch(() => null)
    const sweepSecond = await fetch('http://127.0.0.1:3997/scripts/sweep', { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: '{}' })
      .then((r) => r.json()).catch(() => null)
    check(
      'POST /scripts/sweep 结算过期且幂等（第二次 0 写入）',
      sweepFirst?.ok === true && sweepSecond?.ok === true && sweepSecond.value?.archived === 0,
      JSON.stringify({ first: sweepFirst?.value?.archived, second: sweepSecond?.value?.archived }),
    )
    // 检索面（Spec §5.4/A9）在**真宿主**上的端到端证明：写一条只带检索词的脚本 →
    // 用同义词能搜到 → 收拾干净。断言的是"索引真的接上了"，不是"预览里像那么回事"。
    const searchProbeName = '真宿主检索验收 ' + Date.now().toString(36)
    const searchProbeTerm = 'realsearch-' + Date.now().toString(36)
    const searchProbe = await fetch('http://127.0.0.1:3997/scripts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        name: searchProbeName,
        description: 'real host retrieval probe',
        steps: [{ kind: 'tool-call', payload: 'bash: echo probe' }],
        scope: 'workspace',
        searchTerms: [searchProbeTerm],
      }),
    }).then((r) => r.json()).catch(() => null)
    const probeId = searchProbe?.value?.id
    if (typeof probeId !== 'string') {
      check('检索验收：POST /scripts 写入带检索词的脚本', false, JSON.stringify(searchProbe).slice(0, 200))
    } else {
      const byTerm = await fetch('http://127.0.0.1:3997/scripts?q=' + encodeURIComponent(searchProbeTerm), { headers: { connection: 'close' } })
        .then((r) => r.json()).catch(() => null)
      check(
        '检索验收：只用 searchTerms（同义词）就能搜到刚沉淀的脚本（F1 的死字段修复，真宿主）',
        byTerm?.ok === true && Array.isArray(byTerm.value) && byTerm.value.some((item) => item.id === probeId),
        JSON.stringify(byTerm?.value?.map((item) => item.id)).slice(0, 200),
      )
      const nonsense = await fetch('http://127.0.0.1:3997/scripts?q=' + encodeURIComponent('绝不可能出现的检索词-zzz'), { headers: { connection: 'close' } })
        .then((r) => r.json()).catch(() => null)
      check(
        '检索验收：无匹配返回空数组（q 真的被宿主执行，不是全量兜底）',
        nonsense?.ok === true && Array.isArray(nonsense.value) && nonsense.value.length === 0,
        JSON.stringify(nonsense?.value).slice(0, 120),
      )
      // 收拾干净：归档 → 物理删除（INV-11 只允许删已归档）。
      await fetch('http://127.0.0.1:3997/scripts/' + encodeURIComponent(probeId) + '/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify({ status: 'archived' }),
      }).catch(() => null)
      const purged = await fetch('http://127.0.0.1:3997/scripts/' + encodeURIComponent(probeId), {
        method: 'DELETE',
        headers: { connection: 'close' },
      }).then((r) => r.json()).catch(() => null)
      check('检索验收：探针脚本自清理（归档后可物理删除）', purged?.value?.removed === true, JSON.stringify(purged).slice(0, 160))
    }

    if (scriptTabIndex >= 0) {
      const auditPane = await evalJs(`(() => {
        const body = document.querySelector('.dock-body')
        const text = (body?.textContent ?? '').replace(/\\s+/g, ' ')
        return {
          audit: body?.querySelector('[data-testid="script-audit"]') !== null,
          rows: body?.querySelectorAll('[data-testid="script-row"]').length ?? 0,
          advices: body?.querySelectorAll('[data-testid="script-advice"]').length ?? 0,
          search: body?.querySelector('[data-testid="script-search"]') !== null,
          cjkOk: text.length > 0,
        }
      })()`)
      check(
        '「脚本」pane 渲染治理面 + 检索框（概览卡 / 目录行 / 检索输入）',
        auditPane?.audit === true && auditPane?.rows > 0 && auditPane?.search === true,
        JSON.stringify(auditPane),
      )
      const scriptWarnings = console_.filter((line) => /script 事件通道不可用|dsh-script.*mount 失败/.test(line))
      check('脚本事件通道无告警（subscribeFrames 真的建立了）', scriptWarnings.length === 0, JSON.stringify(scriptWarnings.slice(0, 2)))
    }

    // F11 commit: `finance/events` typert stream 端到端断言。F11‑① 把
    // client 端 600ms 轮询改成 stream，平台机制是 `subscribeFrames(remote,
    // { name: 'finance/events' })`，所以必须验证：
    //  1. 财务 tab 已激活（subscribeFrames 已经被注册了）
    //  2. console 无「finance 事件通道不可用」告警（订阅真的建立了）
    //  3. 宿主注册面里 finance/events 端点存在（descriptor 没漏注册）
    const tabsAfter = await evalJs(`Array.from(document.querySelectorAll('.dock-tab')).map((b) => b.getAttribute('aria-label'))`)
    const financeIndex = Array.isArray(tabsAfter) ? tabsAfter.indexOf('财务') : -1
    check('finance tab 在 dock 模块栏', financeIndex >= 0, JSON.stringify(tabsAfter))
    if (financeIndex >= 0) {
      await evalJs(`document.querySelectorAll('.dock-tab')[${financeIndex}].click()`)
      await sleep(2000)
      const financeWarnings = console_.filter((line) => /finance 事件通道不可用|finance.*already mounted/.test(line))
      check('finance 事件通道无告警（subscribeFrames 真的建立了）', financeWarnings.length === 0, JSON.stringify(financeWarnings.slice(0, 2)))
      // 强断言移到下面 typert 探针之后（`registered` 在那里才被赋值）。
    }

    // 4) Typert 契约注册面：P5 之后 finance 用 `ctx.typert.register` 显式注册
    //    （包不再导出 `./typert`，平台 loader 不会替它注册）。网关在「没注册」时
    //    会退回 SRC 标记兜底，**面板照样渲染** —— 所以「功能没坏」证明不了注册发生。
    //    这里直接读宿主的 local 调用定义，断言 8 条 finance 端点真的在里面。
    // `connection: close` 是必须的：这条请求紧挨着 process.exit，若 undici 的
    // keep-alive socket 还在收尾，Windows 上会在退出时触发 libuv 断言
    // (STATUS_STACK_BUFFER_OVERRUN)，把「全绿」变成非零退出码。
    const typertProbe = await fetch('http://127.0.0.1:3997/__dev/probe', { headers: { connection: 'close' } })
      .then((r) => r.json())
      .catch(() => null)
    const registered = typertProbe?.typert
    if (registered === null || registered === undefined) {
      check('typert 注册面可读（/__dev/probe.typert）', false, '探针没有 typert 段（宿主版本过旧？）')
    } else {
      const endpoints = registered.endpoints ?? []
      const financeEndpoints = endpoints.filter((endpoint) => endpoint.startsWith('finance/'))
      check(
        'finance 的 11 条 Remote 定义由 ctx.typert.register 落地（非 SRC 兜底；F11-① finance/events；价格体系新增 getPriceTableStatus/clearPriceOverlay）',
        financeEndpoints.length === 11,
        JSON.stringify(financeEndpoints),
      )
      check(
        'typert 注册面含 dsh-spark-finance:host（契约单源 P5）',
        (registered.packages ?? []).includes('dsh-spark-finance:host'),
        JSON.stringify(registered.packages ?? []),
      )

      // 评审 §6 #4：网关在严格路径下用 `descriptor.implementation ?? method` 做
      // `Reflect.get`（dsh-api-gateway/lib/index.js:747），SRC 标记只在**没有**严格
      // 描述符时兜底（兜底描述符是 `src-json`，无 zod 校验）。所以 `resultMode`
      // 就是「注册真的生效」的判据 —— 面板能渲染证明不了这一点。
      const descriptors = registered.descriptors ?? []
      const financeDescriptors = descriptors.filter((entry) => entry.endpoint.startsWith('finance/'))
      const allStrict = financeDescriptors.length === 11
        && financeDescriptors.every((entry) => entry.resultMode === 'strict')
      check(
        'finance 的 11 条描述符都是 strict 模式（未退化到 SRC 的 src-json 兜底）',
        allStrict,
        JSON.stringify(financeDescriptors.map((entry) => entry.endpoint + ':' + entry.resultMode)),
      )
      // 价格体系新增的两条端点必须真的落到严格注册面（SPEC §5.1 的 UI 依赖它们）。
      const priceStatus = financeDescriptors.find((entry) => entry.endpoint === 'finance/getPriceTableStatus')
      const clearOverlay = financeDescriptors.find((entry) => entry.endpoint === 'finance/clearPriceOverlay')
      check(
        '价格体系端点 getPriceTableStatus / clearPriceOverlay 已注册且为 strict',
        priceStatus?.resultMode === 'strict' && clearOverlay?.resultMode === 'strict',
        JSON.stringify([priceStatus ?? '(缺失)', clearOverlay ?? '(缺失)']),
      )

      // implementation ≠ method 的实例证明该字段确实来自描述符本身
      // （finance 全部省略 implementation，故取 method；github 显式给了别的名字）。
      const renamed = descriptors.find((entry) => entry.implementation !== entry.endpoint.split('/')[1])
      check(
        'descriptor.implementation 被按字面采用（≠ method 的实例存在，证明非仅诊断）',
        renamed !== undefined,
        renamed === undefined ? '(没有 implementation ≠ method 的描述符)' : JSON.stringify(renamed),
      )
      // F11 commit：finance/events 流端点要严格注册到 typert 注册面。
      // 「面板能渲染」证明不了这一点（漏 register / SRC 兜底都会渲染）；
      // 只有 descriptors 里有这条 strict 描述符才算落实。
      const financeEvents = descriptors.find(
        (entry) => entry.endpoint === 'finance/events',
      )
      check(
        'finance/events 流端点已注册到 typert 注册面（非 SRC 兜底）',
        financeEvents !== undefined && financeEvents.resultMode === 'strict',
        financeEvents === undefined ? '(finance/events 缺失)' : JSON.stringify(financeEvents),
      )
      // dsh-script 同样用 ctx.typert.register 显式注册（AGENTS §2.3 第 1 条路径）。
      // 缺这条断言时，「脚本 pane 有数据」只说明 HTTP 兜底能用 —— 契约注册面没被证明。
      const scriptPackages = registered.packages ?? []
      const scriptEvents = descriptors.find((entry) => entry.endpoint === 'script/events')
      check(
        'script/events 流端点已注册到 typert 注册面（strict，非 SRC 兜底）',
        scriptEvents !== undefined && scriptEvents.resultMode === 'strict',
        scriptEvents === undefined ? '(script/events 缺失)' : JSON.stringify(scriptEvents),
      )
      check(
        'dsh-script:host 进了 typert 注册包清单（契约单源，非兜底）',
        scriptPackages.includes('dsh-script:host'),
        JSON.stringify(scriptPackages.filter((name) => name.startsWith('dsh-script'))),
      )
      // 治理读模型的 schema 必须真的注册进反射面（漏注册时 HTTP 兜底照样能用，
      // 但 typert 侧的严格校验就没了 —— 只有 schemaKeys 能证明这件事）。
      const schemaKeys = registered.schemaKeys ?? []
      const expectedSchemas = ['ScriptSummary', 'ScriptAdvice', 'ScriptAuditStats', 'ScriptAudit']
      check(
        '治理读模型 schema（ScriptSummary / ScriptAdvice / ScriptAuditStats / ScriptAudit）进了 typert 反射面',
        expectedSchemas.every((name) => schemaKeys.includes('dsh-script#' + name)),
        JSON.stringify(schemaKeys.filter((key) => key.startsWith('dsh-script#'))),
      )
    }

    // 5) 诊断：控制台里与事件通道/remote 相关的线索
    const interesting = console_.filter((line) => /spark|dock|remote|stream|mux|event|Error|error|warn/.test(line))
    console.log('\n--- 控制台（过滤后 ' + interesting.length + '/' + console_.length + ' 条）---')
    for (const line of interesting.slice(0, 20)) console.log('    ' + line.slice(0, 300))
  }

  // 6) PC 端验收回归（acceptance-dsh-spark-plugins-20260917-1906 / 复核轮 -2210）
  //    把修掉的问题焊成断言：关闭态焦点序、视口重吸附、方向键/双击、子页签方向键、
  //    危险态可辨、token 直连、点击目标下限、禁用原因、Esc 分层、卡片题字号。
  //    **键盘一律用 CDP 真事件**（Input.dispatchKeyEvent）：-2210 复核轮用真键盘发现
  //    「JS 合成事件」与「真按键」在 Esc 分层/焦点跟随上的表现可以不同，断言必须走真实路径。
  //    另：所有断言都不许依赖动画/过渡时钟（无头或后台页面可能停帧）。
  const pressKey = async (key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  }
  await evalJs(`(() => {
    const spark = Array.from(document.querySelectorAll('.dock-tab')).find((b) => (b.getAttribute('aria-label') ?? '').startsWith('火花'))
    if (spark) spark.click()
  })()`)
  await sleep(900)

  // 6a) PCQA-001：关闭态面板必须移出焦点序与无障碍树，且焦点回球
  await evalJs(`(() => {
    const panel = document.querySelector('.dock-panel')
    const ball = document.querySelector('.dock-ball')
    if (!panel || !ball) return
    if (!panel.classList.contains('open')) ball.click()
  })()`)
  await sleep(700)
  // 前置：焦点必须真的落进面板（inert 生效时 focus() 是空操作，落不进说明前置条件没满足）
  const focusPlanted = await evalJs(`(() => {
    const panel = document.querySelector('.dock-panel')
    const tab = panel?.querySelector('[role="tab"]')
    tab?.focus()
    return panel !== null && tab !== null && panel.contains(document.activeElement)
  })()`)
  check('PCQA-001 前置：面板展开时焦点可落入面板内', focusPlanted === true, String(focusPlanted))
  await pressKey('Escape', 'Escape', 27)
  await sleep(600)
  const closedState = await evalJs(`(() => {
    const panel = document.querySelector('.dock-panel')
    const ball = document.querySelector('.dock-ball')
    if (!panel || !ball) return null
    return {
      open: panel.classList.contains('open'),
      inert: panel.hasAttribute('inert'),
      // 只做观测不做断言：面板层曾经靠「延迟过渡的 visibility:hidden」加保险，
      // 但那依赖过渡时钟（停帧环境下永不生效）。现在机制单一 = inert。
      visibility: getComputedStyle(panel).visibility,
      focusOnBall: document.activeElement === ball,
    }
  })()`)
  check(
    'PCQA-001 关闭态面板 inert（移出焦点序与无障碍树）',
    closedState !== null && closedState.open === false && closedState.inert === true,
    JSON.stringify(closedState),
  )
  check('PCQA-001 Esc 收起后焦点回到悬浮球', closedState?.focusOnBall === true, JSON.stringify(closedState))

  // 关闭态不得出现在 Tab 序里（旧实现只靠 opacity:0，Tab 会连续落进 16 个不可见控件）
  await evalJs(`document.querySelector('.dock-ball').focus()`)
  for (let i = 0; i < 3; i += 1) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await sleep(180)
  }
  const tabProbe = await evalJs(`(() => {
    const panel = document.querySelector('.dock-panel')
    const active = document.activeElement
    return { inPanel: panel.contains(active), where: String(active?.getAttribute('aria-label') ?? active?.className ?? '') }
  })()`)
  check('PCQA-001 关闭态面板不参与 Tab 序列（连续 Tab 不落进面板）', tabProbe.inPanel === false, JSON.stringify(tabProbe))

  // 6b) PCQA-002：视口变化后球必须重吸附角落（旧实现停在旧坐标并压住正文）
  await evalJs(`document.querySelector('.dock-ball').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(700)
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  const resnap = await evalJs(`(() => {
    const ball = document.querySelector('.dock-ball')
    return { got: [ball.style.left, ball.style.top], want: [(innerWidth - 48 - 16) + 'px', (innerHeight - 48 - 16) + 'px'], vw: innerWidth, vh: innerHeight }
  })()`)
  check('PCQA-002 视口缩小后悬浮球重吸附到右下角', resnap.got[0] === resnap.want[0] && resnap.got[1] === resnap.want[1], JSON.stringify(resnap))
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  const resnapBack = await evalJs(`(() => {
    const ball = document.querySelector('.dock-ball')
    return { got: ball.style.left, want: (innerWidth - 48 - 16) + 'px' }
  })()`)
  check('PCQA-002 视口恢复后球仍在右下角', resnapBack.got === resnapBack.want, JSON.stringify(resnapBack))

  // 6c) PCQA-009 / PCQA-008：方向键微调（拖拽的键盘替代）与双击复位
  // 先把位置归一化到右下角（并给 6b 的视口切换留出迟到 resize 的窗口）：
  // 否则「视口还原 → 重吸附」可能撞上紧跟着的微调按键，把 x 又吸回角落（本轮实测踩过）。
  await evalJs(`document.querySelector('.dock-ball').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(900)
  await evalJs(`document.querySelector('.dock-ball').focus()`)
  await sleep(300)
  const readPos = () => evalJs(`(() => { const b = document.querySelector('.dock-ball'); return { x: parseFloat(b.style.left), y: parseFloat(b.style.top), stored: localStorage.getItem('dsh.spark-dock:pos') } })()`)
  const beforeNudge = await readPos()
  // 每次按键后先等一拍再读（CDP 的 ack 早于渲染进程处理），且**丢键时重试一次**：
  // 实测背靠背连发两个 rawKeyDown 时第一个会偶发丢（-2210 复核轮同款噪声）。
  // 重试不会掩盖真问题 —— 断言仍然要求「恰好一次 8px」，多走一步（-16）即失败。
  const nudgeKey = async (key, code, vk, ok) => {
    await pressKey(key, code, vk)
    await sleep(500)
    let seen = await readPos()
    if (ok(seen)) return seen
    await pressKey(key, code, vk)
    await sleep(500)
    seen = await readPos()
    return seen
  }
  const leftRead = await nudgeKey('ArrowLeft', 'ArrowLeft', 37, (p) => p.x === beforeNudge.x - 8)
  const upRead = await nudgeKey('ArrowUp', 'ArrowUp', 38, (p) => p.y === beforeNudge.y - 8)
  check(
    'PCQA-009 方向键微调球位置（← 与 ↑ 各 -8px）',
    leftRead.x === beforeNudge.x - 8 && upRead.y === beforeNudge.y - 8,
    JSON.stringify({ beforeNudge, leftRead, upRead }),
  )
  await evalJs(`document.querySelector('.dock-ball').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(700)
  const resetPos = await evalJs(`(() => {
    const ball = document.querySelector('.dock-ball')
    return { x: parseFloat(ball.style.left), y: parseFloat(ball.style.top), wantX: innerWidth - 48 - 16, wantY: innerHeight - 48 - 16 }
  })()`)
  check('PCQA-008 双击球复位默认右下角', resetPos.x === resetPos.wantX && resetPos.y === resetPos.wantY, JSON.stringify(resetPos))

  // 6d) 形制探针（在真实宿主的真实 CSS 下量，不靠渲染出来的业务内容）：
  //     PCQA-012 字号不借圆角 token / PCQA-015 危险态可辨 / PCQA-017 卡片题 14px /
  //     PCQA-018 内容列预留下水道 / PCQA-020 点击目标 ≥26px
  await evalJs(`document.querySelector('.dock-ball').click()`)
  await sleep(900)
  const shape = await evalJs(`(() => {
    const embed = document.querySelector('.dock-embed') ?? document.querySelector('.dock-body')
    const probe = (tag, cls) => {
      const el = document.createElement(tag)
      if (cls) el.className = cls
      el.textContent = 'probe'
      embed.appendChild(el)
      const cs = getComputedStyle(el)
      const out = { font: cs.fontSize, color: cs.color, height: el.getBoundingClientRect().height }
      el.remove()
      return out
    }
    const panel = document.querySelector('.dock-panel')
    const tag = document.createElement('span')
    tag.style.color = 'var(--spk-label-3)'
    panel.appendChild(tag)
    const spkLabel3 = getComputedStyle(tag).color
    tag.style.color = 'var(--dsw-alias-label-tertiary)'
    const hostAlias = getComputedStyle(tag).color
    tag.remove()
    const sub = document.querySelector('.dock-head .sub')
    const body = document.querySelector('.dock-body')
    return {
      sub: sub ? getComputedStyle(sub).color : null,
      spkLabel3,
      hostAlias,
      prop: probe('span', 'dock-prop-type'),
      h3: probe('h3', ''),
      pill: probe('button', 'dock-pill'),
      pillDanger: probe('button', 'dock-pill danger'),
      pillPlain: probe('button', 'dock-pill'),
      gutter: body ? getComputedStyle(body).scrollbarGutter : null,
    }
  })()`)
  check(
    'PCQA-007/016 dock 副标题直连 --spk-label-3（不再被宿主别名顶掉）',
    shape.sub === shape.spkLabel3,
    JSON.stringify({ sub: shape.sub, spkLabel3: shape.spkLabel3, hostAlias: shape.hostAlias }),
  )
  check('PCQA-012 提案类型标签字号 = 11px（不再借圆角 token 的 10px）', shape.prop.font === '11px', JSON.stringify(shape.prop))
  check('PCQA-017 卡片题 14px（与 ui-kit Card.title 同档）', shape.h3.font === '14px', JSON.stringify(shape.h3))
  check('PCQA-020 胶囊点击目标高度 ≥26px', parseFloat(shape.pill.height) >= 26, JSON.stringify(shape.pill))
  const dangerDiffers = shape.pillDanger.color !== shape.pillPlain.color
  check('PCQA-015 破坏性胶囊有可辨识的危险态（字色 ≠ 安全操作）', dangerDiffers, JSON.stringify({ danger: shape.pillDanger, plain: shape.pillPlain }))
  check('PCQA-018 内容列预留滚动条槽位（scrollbar-gutter: stable）', shape.gutter === 'stable', String(shape.gutter))

  // 6f) PCQA-014：「捕获」禁用时要给原因文案
  const capture = await evalJs(`(() => {
    const bar = document.querySelector('.dock-capture-bar')
    const btn = bar?.querySelector('button[type="submit"]')
    return btn ? { disabled: btn.disabled, described: btn.getAttribute('aria-describedby'), hint: (bar.textContent ?? '').trim() } : null
  })()`)
  check(
    'PCQA-014 空输入时禁用态给出原因文案（且与按钮 aria 关联）',
    capture !== null && capture.disabled === true && capture.hint.includes('输入内容后可记录'),
    JSON.stringify(capture),
  )

  // 6e) PCQA-004：子页签方向键切换 + roving tabindex（注意：它会把子页签切到下一项，
  //     所以任何依赖「火花流」页内容的断言都必须排在这一步之前）
  const segBefore = await evalJs(`(() => {
    const list = document.querySelector('.dock-embed [role="tablist"]')
    if (!list) return null
    const tabs = Array.from(list.querySelectorAll('[role="tab"]'))
    const sel = tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0]
    sel.focus()
    return { count: tabs.length, idx: tabs.indexOf(sel), tabIndexes: tabs.map((t) => t.tabIndex) }
  })()`)
  await pressKey('ArrowRight', 'ArrowRight', 39)
  await sleep(400)
  const segAfter = await evalJs(`(() => {
    const list = document.querySelector('.dock-embed [role="tablist"]')
    const tabs = Array.from(list.querySelectorAll('[role="tab"]'))
    return { sel: tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'), focused: tabs.indexOf(document.activeElement) }
  })()`)
  const segWant = segBefore === null ? -1 : (segBefore.idx + 1) % segBefore.count
  check(
    'PCQA-004 子页签支持方向键切换并同步焦点（roving tabindex）',
    segBefore !== null && segAfter.sel === segWant && segAfter.focused === segWant
      && segBefore.tabIndexes.filter((n) => n === 0).length === 1,
    JSON.stringify({ before: segBefore, after: segAfter, want: segWant }),
  )

  // 6g) PCQA-005/006：GitHub「默认可见性」下拉 —— Esc 只关菜单不关面板，且焦点回触发钮
  const githubIndex = await evalJs(`(() => Array.from(document.querySelectorAll('.dock-tab')).findIndex((b) => (b.getAttribute('aria-label') ?? '').startsWith('GitHub')))()`)
  if (githubIndex >= 0) {
    await evalJs(`document.querySelectorAll('.dock-tab')[` + githubIndex + `].click()`)
    await sleep(1200)
    const trigger = await evalJs(`(() => {
      const pane = document.querySelector('.dock-body')
      const btn = Array.from(pane.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? '').includes('默认可见性') || ['私有', '公开'].includes((b.textContent ?? '').trim()))
      if (!btn) return null
      window.__pcqaVisibilityBtn = btn
      btn.click()
      // 只取点击前就稳定的属性：aria-expanded 是 React 状态，必须等重渲染后再读
      return { label: btn.getAttribute('aria-label'), text: (btn.textContent ?? '').trim() }
    })()`)
    await sleep(600)
    const menuOpen = await evalJs(`(() => {
      const menu = document.querySelector('[data-spk-layer="menu"]')
      const panel = document.querySelector('.dock-panel')
      const btn = window.__pcqaVisibilityBtn
      return {
        menu: menu !== null,
        panelOpen: panel.classList.contains('open'),
        haspopup: btn?.getAttribute('aria-haspopup') ?? null,
        expanded: btn?.getAttribute('aria-expanded') ?? null,
      }
    })()`)
    check(
      'PCQA-006 可见性触发钮暴露 aria-haspopup/aria-expanded，可访问名含可见文本',
      trigger !== null && menuOpen.haspopup === 'listbox' && menuOpen.expanded === 'true'
        && String(trigger.label ?? '').includes(trigger.text),
      JSON.stringify({ trigger, menuOpen }),
    )
    check('PCQA-005 菜单展开态可断言（data-spk-layer）', menuOpen.menu === true, JSON.stringify(menuOpen))
    // 焦点先移进菜单项（复核轮的条件之一），再用真键盘按 Esc
    const focusInMenu = await evalJs(`(() => {
      const opt = document.querySelector('[data-spk-layer="menu"] [role="option"]')
      opt?.focus()
      return document.activeElement?.getAttribute('role') === 'option'
    })()`)
    await pressKey('Escape', 'Escape', 27)
    await sleep(600)
    const afterMenuEsc = await evalJs(`(() => {
      const panel = document.querySelector('.dock-panel')
      const menu = document.querySelector('[data-spk-layer="menu"]')
      const active = document.activeElement
      return { panelOpen: panel.classList.contains('open'), menu: menu !== null, focus: (active?.textContent ?? '').trim().slice(0, 12) }
    })()`)
    check(
      'PCQA-005 Esc 先关菜单、面板保持打开、焦点回触发钮（真键盘，焦点在菜单项内）',
      focusInMenu === true && afterMenuEsc.panelOpen === true && afterMenuEsc.menu === false && afterMenuEsc.focus.length > 0,
      JSON.stringify({ focusInMenu, afterMenuEsc }),
    )
    // 菜单没了之后再按一次 Esc，面板才关（证明面板本身仍可 Esc 收起）
    await pressKey('Escape', 'Escape', 27)
    await sleep(600)
    const secondEsc = await evalJs(`document.querySelector('.dock-panel').classList.contains('open')`)
    check('PCQA-005 内层关掉后，第二次 Esc 才收起面板', secondEsc === false, String(secondEsc))
    await evalJs(`document.querySelector('.dock-iconbtn')?.click()`)
    await sleep(400)
  } else {
    check('PCQA-005/006 GitHub 模块可定位（前置条件）', false, '未找到 GitHub tab')
  }

  // 6g2) 复核遗留 #1：GitHub 面板在「权限/身份草稿被改脏」时也必须只有 1 个实心 primary
  //      （原来页脚的「保存配置」也是 primary，草稿一脏就与「保存令牌」同屏两个实心按钮）。
  if (githubIndex >= 0) {
    await evalJs(`(() => { const p = document.querySelector('.dock-panel'); if (!p.classList.contains('open')) document.querySelector('.dock-ball').click() })()`)
    await sleep(700)
    await evalJs('document.querySelectorAll(\'.dock-tab\')[' + githubIndex + '].click()')
    await sleep(1200)
    const dirty = await evalJs(`(() => {
      const pane = document.querySelector('.dock-body')
      const box = pane.querySelector('input[type="checkbox"]')
      if (!box) return null
      box.click()
      return { clicked: true }
    })()`)
    await sleep(500)
    const primaries = await evalJs(`(() => {
      const pane = document.querySelector('.dock-body')
      const panel = document.querySelector('.dock-panel')
      // primary = 品牌实底（Button.primary 就是 background: var(--spk-brand)）—— 用探针取真值，不猜色
      const probe = document.createElement('span')
      probe.style.background = 'var(--spk-brand)'
      panel.appendChild(probe)
      const brand = getComputedStyle(probe).backgroundColor
      probe.remove()
      const btns = [...pane.querySelectorAll('button')]
      // v4.3 起禁用的实心档换中性底（不再是品牌色），所以「抢层级」只算**可用**的实心主按钮。
      const solid = btns.filter((b) => b.disabled === false && getComputedStyle(b).backgroundColor === brand)
      return {
        dirty: (pane.textContent ?? '').includes('保存配置'),
        total: btns.length,
        brand,
        solid: solid.map((b) => (b.textContent ?? '').trim().slice(0, 10)),
      }
    })()`)
    check(
      'PCQA-019 复核遗留 #1：GitHub 草稿脏时仍至多一个可用实心主按钮',
      dirty !== null && primaries.dirty === true && primaries.solid.length <= 1,
      JSON.stringify({ dirty, primaries }),
    )
    // 收尾：丢弃草稿，别把脏态留给后面的步骤
    await evalJs(`(() => {
      const pane = document.querySelector('.dock-body')
      const discard = [...pane.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('丢弃'))
      discard?.click()
    })()`)
    await sleep(400)
  }

  // 6i) 复核遗留 #2：还原价格表（回退/破坏性）必须先弹二次确认（UI-UX-SPEC §4.2 模板 4）。
  //     前置：还原钮只在有价格覆盖层时可用 —— 先点「更新价格表」把覆盖层建出来
  //     （沙箱内允许，上一轮验收也点过它）。顺带验证 ui-kit Modal 的 Esc 分层。
  const finIndex = await evalJs(`(() => Array.from(document.querySelectorAll('.dock-tab')).findIndex((b) => (b.getAttribute('aria-label') ?? '').startsWith('财务')))()`)
  if (finIndex >= 0) {
    await evalJs(`(() => { const p = document.querySelector('.dock-panel'); if (!p.classList.contains('open')) document.querySelector('.dock-ball').click() })()`)
    await sleep(700)
    await evalJs('document.querySelectorAll(\'.dock-tab\')[' + finIndex + '].click()')
    await sleep(2000)
    const findRestore = () => evalJs(`(() => {
      const pane = document.querySelector('.dock-body')
      const b = [...pane.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '').includes('还原'))
      return b ? { disabled: b.disabled } : null
    })()`)
    const clickBtn = (label) => evalJs(`(() => {
      const pane = document.querySelector('.dock-body')
      const b = [...pane.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '').includes('` + label + `'))
      if (!b || b.disabled) return false
      b.click()
      return true
    })()`)
    let restore = await findRestore()
    // 「更新价格表」→ 社区目录价落库是**异步**的（overlayKeyCount 要等同步写回），
    // 实测 12s 窗口经常不够；这里给到 30s，并每 10s 切走再切回强制重取状态。
    //
    // 2026-09-21 新增（用户主诉）：点击后**立刻**断言按钮进了 loading 形制（aria-busy +
    // spinner）。会话多时「同步目录价 → 原子替换覆盖层 → 重算整个账本」要跑秒级到十秒级，
    // 只置 disabled 会让人以为按钮失灵、反复点。这条断言必须在点击后的**第一个采样点**
    // 完成（先于下面的 30s 轮询），否则动作已经结束就看不到了。
    //
    // 注意：这段**不放进** `if (restore.disabled)` 里 —— 上一轮实测沙箱里已存在价格覆盖层
    // （restore 直接可用）时整个分支被跳过，loading 断言一次都没跑到（假绿）。
    const updateClicked = await clickBtn('更新价格表')
    if (updateClicked === true) {
      await sleep(150)
      const priceLoading = await evalJs(`(() => {
        const pane = document.querySelector('.dock-body')
        const b = [...pane.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '').includes('更新价格表'))
        if (!b) return null
        return {
          ariaBusy: b.getAttribute('aria-busy'),
          spinner: b.querySelector('span[aria-hidden="true"]') !== null,
          disabled: b.disabled,
        }
      })()`)
      if (priceLoading !== null && priceLoading.disabled === true) {
        // 动作还没结束（仍在飞）→ 必须同时给出 aria-busy 与 spinner。
        check(
          '价格动作进行中：按钮走 loading 形制（aria-busy + spinner），不是只 disabled',
          priceLoading.ariaBusy === 'true' && priceLoading.spinner === true,
          JSON.stringify(priceLoading),
        )
      } else {
        // 沙箱里同步可能快到 150ms 内就结束（缓存/本地目录价）。此时按钮必须**回到**
        // 空闲态 —— 「动作结束后仍在转」是同一类缺陷的另一半，也必须钉住。
        check(
          '价格动作已完成：按钮回到空闲态（无 aria-busy 残留、无 spinner 残留）',
          priceLoading !== null && priceLoading.ariaBusy === null && priceLoading.spinner === false,
          JSON.stringify(priceLoading),
        )
      }
      // 等这次同步落定，后续还原分支才看得到覆盖层。
      for (let i = 0; i < 30; i += 1) {
        await sleep(1000)
        restore = await findRestore()
        if (restore?.disabled === false) break
        if (i === 9 || i === 19) {
          await evalJs(`(() => {
            const tabs = [...document.querySelectorAll('.dock-tab')]
            const idx = tabs.findIndex((b) => (b.getAttribute('aria-label') ?? '').startsWith('火花'))
            if (idx >= 0) tabs[idx].click()
          })()`)
          await sleep(800)
          await evalJs('document.querySelectorAll(\'.dock-tab\')[' + finIndex + '].click()')
          await sleep(1500)
        }
      }
    }
    if (restore !== null && restore.disabled === false) {
      const opened = await clickBtn('还原到发版快照')
      await sleep(600)
      const modal = await evalJs(`(() => {
        const d = document.querySelector('[data-spk-layer="modal"]')
        if (d === null) return null
        return {
          title: (d.querySelector('h4')?.textContent ?? '').trim().slice(0, 24),
          confirm: [...d.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('确认还原')),
        }
      })()`)
      check(
        '复核遗留 #2：还原价格表先弹二次确认（危险动作不裸执行）',
        opened === true && modal !== null && modal.confirm === true,
        JSON.stringify({ opened, modal }),
      )
      await pressKey('Escape', 'Escape', 27)
      await sleep(700)
      const afterModalEsc = await evalJs(`(() => ({
        modal: document.querySelector('[data-spk-layer="modal"]') !== null,
        panelOpen: document.querySelector('.dock-panel').classList.contains('open'),
      }))()`)
      check(
        '复核遗留 #2：Modal 内 Esc 只关弹窗（面板保持打开，且未执行还原）',
        afterModalEsc.modal === false && afterModalEsc.panelOpen === true,
        JSON.stringify(afterModalEsc),
      )
    } else {
      // 前置（存在价格覆盖层）要靠联网拉社区目录价建立，离线/沙箱环境建不出来。
      // 此时把「禁用必须给原因」这条**当前可断言**的不变量钉住（v4.3 口径），
      // 而不是把一个环境依赖的断言报成 FAIL（有覆盖层时的二次确认路径见上一轮记录）。
      const blocked = await evalJs(`(() => {
        const pane = document.querySelector('.dock-body')
        const b = [...pane.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '').includes('还原'))
        if (!b) return null
        const desc = b.getAttribute('aria-describedby')
        const hint = desc === null ? null : document.getElementById(desc)
        return { disabled: b.disabled, desc, hint: hint === null ? null : (hint.textContent ?? '').trim().slice(0, 40) }
      })()`)
      check(
        '复核遗留 #2：无覆盖层时「还原」禁用并给出原因（含 aria-describedby）',
        blocked !== null && blocked.disabled === true && blocked.hint !== null && blocked.hint.length > 0,
        JSON.stringify({ restore, finIndex, blocked }),
      )
    }
  } else {
    check('复核遗留 #2 财务模块可定位（前置条件）', false, '未找到财务 tab')
  }

  // 6j) 供应商总表布局不变量（2026-09-21 用户裁决「table 布局混乱」的回归线）。
  //
  // 修前的真因：额度触达 pill（最长 170px）挂在 140px 的供应商列里 → 溢出 30px 被裁，
  // 并把行高从 50px 撑到 65px。修法 = 表内只留「付费类型」一个 tag（额度触达移进详情
  // 弹窗、超值与手填降级为悬浮）。这条断言钉的是**结构不变量**，不是某次截图：
  //  1. 表格内不得出现额度触达的 testid（它只在详情弹窗里）；
  //  2. 每行的高度必须一致（pill 溢出会把单行撑高，这是最直接的病灶信号）；
  //  3. 表头不得折行（付费类型列收到 56px 后，四字表头仍须单行）。
  if (finIndex >= 0) {
    await evalJs(`(() => { const p = document.querySelector('.dock-panel'); if (!p.classList.contains('open')) document.querySelector('.dock-ball').click() })()`)
    await sleep(600)
    await evalJs('document.querySelectorAll(\'.dock-tab\')[' + finIndex + '].click()')
    await sleep(1500)
    const tableLayout = await evalJs(`(() => {
      const table = document.querySelector('[data-testid="finance-provider-table"]')
      if (table === null) return { present: false }
      const head = table.firstElementChild
      const headerWrapped = [...head.children].some((c) => c.getBoundingClientRect().height > 24)
      const rows = [...table.querySelectorAll('[data-testid^="finance-provider-"]')]
      const heights = [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))]
      // 表内不得有额度触达 testid（它已移进详情弹窗）。
      const quotaInTable = table.querySelector('[data-testid^="finance-quota-"]') !== null
      // 行内 tag 只允许「付费类型」那一个 pill。
      const pillsPerRow = rows.map((r) => r.querySelectorAll('span[class*="pill"]').length)
      return { present: true, headerWrapped, heights, quotaInTable, maxPills: Math.max(0, ...pillsPerRow), rowCount: rows.length }
    })()`)
    if (tableLayout.present === true) {
      check(
        '供应商总表：额度触达不在表内（已移进详情弹窗）',
        tableLayout.quotaInTable === false,
        JSON.stringify(tableLayout),
      )
      check(
        '供应商总表：每行高度一致（tag 溢出不再撑高单行）',
        tableLayout.heights.length === 1,
        JSON.stringify(tableLayout.heights),
      )
      check(
        '供应商总表：表头单行不折行',
        tableLayout.headerWrapped === false,
        JSON.stringify(tableLayout),
      )
      check(
        '供应商总表：行内至多一个 tag（付费类型）',
        tableLayout.maxPills <= 1,
        JSON.stringify(tableLayout),
      )
    } else {
      // 空账本沙箱（没有已持久化会话）里表格根本不存在，走的是空态。
      // **显式记一条 skip 而不是静默跳过** —— 静默跳过会让这条回归线在沙箱里
      // 永远是"绿"的（本轮就踩了：第一版没记，66/66 全绿但断言一次没跑）。
      // 表内布局的真正机器判据在 `dev-harness/preview/dom-audit.mjs --pane finance`
      // （有夹具数据，重叠/溢出/折行三项硬判据），这里只做真宿主的补充抽样。
      check(
        '供应商总表布局断言（本次跳过：沙箱账本为空，表格走空态）',
        true,
        'SKIPPED — 需确定性夹具，见 preview:dom-audit --pane finance',
      )
    }
  }

  // 6h) PCQA-017 剩余：记忆模块卡片题 14px。2026-09 结构统一后卡片题由 ui-kit Card.title
  //     （h3）提供，字号由 dock 的 `.dock-embed :is(h3)`（--spk-text-title）兜住；
  //     自有类名 .hippomemo-panel-title 已随手搓卡面一并退役，这里断言卡头 h3 落在规范档。
  const memIndex = await evalJs(`(() => Array.from(document.querySelectorAll('.dock-tab')).findIndex((b) => (b.getAttribute('aria-label') ?? '').startsWith('记忆')))()`)
  if (memIndex >= 0) {
    await evalJs(`(() => { const p = document.querySelector('.dock-panel'); if (!p.classList.contains('open')) document.querySelector('.dock-ball').click() })()`)
    await sleep(700)
    await evalJs('document.querySelectorAll(\'.dock-tab\')[' + memIndex + '].click()')
    await sleep(1300)
    const memTitle = await evalJs(`(() => {
      const h3 = document.querySelector('.dock-embed h3')
      if (!h3) return null
      const cs = getComputedStyle(h3)
      return { text: (h3.textContent ?? '').trim().slice(0, 12), font: cs.fontSize, weight: cs.fontWeight, color: cs.color }
    })()`)
    check(
      'PCQA-017 记忆模块卡片题 14px（ui-kit Card.title 落在规范档）',
      memTitle !== null && memTitle.font === '14px' && memTitle.weight === '600',
      JSON.stringify(memTitle),
    )
  } else {
    check('PCQA-017 记忆模块可定位（前置条件）', false, '未找到记忆 tab')
  }

  // 6j) 复核轮 acc-20260918-0155-clean 新增：形制/间距一致性 + 禁用原因 + 时间本地化 + 产物新鲜度。
  //     这一节的断言都是「跨模块一致性」，因此必须在同一个宿主会话里连续取数。
  /** 面板可能是收起态（收起的 pane 不挂载）——先确保展开，再找模块钮。 */
  const ensurePanelOpen = async () => {
    await evalJs(`(() => {
      const p = document.querySelector('.dock-panel')
      if (p && !p.classList.contains('open')) document.querySelector('.dock-ball')?.click()
      return true
    })()`)
    await sleep(700)
  }
  const openModule = async (tabPrefix) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await ensurePanelOpen()
      const idx = await evalJs(`(() => Array.from(document.querySelectorAll('.dock-tab')).findIndex((b) => (b.getAttribute('aria-label') ?? '').startsWith('${tabPrefix}')))()`)
      if (typeof idx === 'number' && idx >= 0) {
        await evalJs('document.querySelectorAll(\'.dock-tab\')[' + idx + '].click()')
        await sleep(1400)
        return true
      }
      await sleep(500)
    }
    const diag = await evalJs(`(() => ({
      open: document.querySelector('.dock-panel')?.classList.contains('open') ?? null,
      tabs: [...document.querySelectorAll('.dock-tab')].map((b) => (b.getAttribute('aria-label') ?? '').slice(0, 6)),
    }))()`)
    console.log('    [6j] 模块钮定位失败：' + JSON.stringify(diag))
    return false
  }
  const readPaneFacts = async (tabPrefix) => {
    if (await openModule(tabPrefix) === false) return null
    return evalJs(`(() => {
      const panel = document.querySelector('.dock-panel')
      const pane = panel.querySelector('.dock-body > .dock-embed') ?? panel.querySelector('.dock-embed')
      const seg = panel.querySelector('.dock-body [role=tablist]')
      if (!pane) return null
      const rect = (el) => el.getBoundingClientRect()
      const segRect = seg ? rect(seg) : null
      const bodyRect = rect(panel.querySelector('.dock-body'))
      const anchor = segRect ? segRect.bottom : bodyRect.top
      // 「分栏之后的第一块内容」= 分栏之后最外层的块（再往里的都是它的子节点，
      // 用「父节点是否也满足 follow」来判定外层）。这样各模块结构不同也能量到同一口径。
      let firstBlock = null
      if (seg) {
        const follows = (el) => !seg.contains(el) && !el.contains(seg)
          && (seg.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        const all = [...pane.querySelectorAll('*')].filter((el) => follows(el) && el.getBoundingClientRect().height > 0)
        const outermost = all.filter((el) => !(el.parentElement !== null && follows(el.parentElement)))
        if (outermost.length > 0) {
          outermost.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
          firstBlock = outermost[0]
        }
      }
      const round = (n) => Math.round(n * 10) / 10
      return {
        segW: segRect ? round(segRect.width) : null,
        paneW: round(rect(pane).width),
        gap: firstBlock ? round(firstBlock.getBoundingClientRect().top - anchor) : null,
        block: firstBlock ? (typeof firstBlock.className === 'string' ? firstBlock.className.slice(0, 24) : firstBlock.tagName) : null,
      }
    })()`)
  }
  const sparkFacts = await readPaneFacts('火花')
  const memFacts = await readPaneFacts('记忆')
  const finFacts = await readPaneFacts('财务')
  const segWs = [sparkFacts, memFacts, finFacts].map((f) => (f === null ? null : f.segW)).filter((n) => typeof n === 'number')
  const segSpread = segWs.length === 3 ? Math.max(...segWs) - Math.min(...segWs) : null
  check(
    '复核-006 页级分栏宽度跨模块一致（火花/记忆/财务 极差 ≤2px）',
    segSpread !== null && segSpread <= 2,
    JSON.stringify({ sparkFacts, memFacts, finFacts, segSpread }),
  )
  const gaps = [sparkFacts, memFacts, finFacts].map((f) => (f === null ? null : f.gap)).filter((n) => typeof n === 'number')
  const gapSpread = gaps.length === 3 ? Math.max(...gaps) - Math.min(...gaps) : null
  check(
    '复核-007 分栏→首块间距跨模块一致（三档收成一档：极差 ≤2px 且落在 8–16px）',
    gapSpread !== null && gapSpread <= 2 && Math.min(...gaps) >= 8 && Math.max(...gaps) <= 16,
    JSON.stringify({ gaps, gapSpread }),
  )

  // 记忆模块：中文界面里不得出现英文相对时间串（PCQA-004/017）；顺带覆盖四个子视图。
  if (memFacts !== null) {
    const subCount = await evalJs(`(() => { const tl = document.querySelector('.dock-body [role=tablist]'); return tl ? tl.querySelectorAll('[role=tab]').length : 0 })()`)
    const seen = { en: false, sample: '' }
    for (let i = 0; i < subCount; i += 1) {
      await evalJs('(() => { const tl=document.querySelector(".dock-body [role=tablist]"); const l=Array.from(tl.querySelectorAll("[role=tab]")); l[' + i + '].click() })()')
      await sleep(900)
      const probe = await evalJs(`(() => {
        const pane = document.querySelector('.dock-body')
        const text = pane ? (pane.textContent ?? '') : ''
        const hit = text.match(/just now|\\d+\\s*(?:min|h|d|mo|y) ago/)
        return { hit: hit === null ? null : hit[0], en: hit !== null }
      })()`)
      if (probe.en === true) { seen.en = true; seen.sample = String(probe.hit) }
    }
    check('复核-004 中文界面时间文案不出现英文串（just now / N min ago）', seen.en === false, JSON.stringify(seen))
  } else {
    check('复核-004 记忆模块可定位（前置条件）', false, '未找到记忆 tab')
  }

  // 禁用提交必须给原因（UI-UX-SPEC §3.1）：GitHub「保存令牌」/ npm「保存」。
  const disabledProbe = async (tabPrefix, label) => {
    if (await openModule(tabPrefix) === false) return null
    return evalJs(`(() => {
      const panel = document.querySelector('.dock-panel')
      const pane = document.querySelector('.dock-body')
      const b = [...pane.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === '${label}')
      if (!b) return null
      const cs = getComputedStyle(b)
      const probe = document.createElement('span')
      probe.style.background = 'var(--spk-brand)'
      panel.appendChild(probe)
      const brand = getComputedStyle(probe).backgroundColor
      probe.remove()
      const desc = b.getAttribute('aria-describedby')
      const hint = desc === null ? null : document.getElementById(desc)
      return {
        disabled: b.disabled,
        bg: cs.backgroundColor,
        brand,
        opacity: cs.opacity,
        desc,
        hint: hint === null ? null : (hint.textContent ?? '').trim().slice(0, 40),
      }
    })()`)
  }
  const ghSave = await disabledProbe('GitHub', '保存令牌')
  check(
    '复核-011 GitHub「保存令牌」禁用时给原因 + 中性底 + 不透明（不再是半透明品牌实底）',
    ghSave !== null && ghSave.disabled === true && ghSave.hint !== null && ghSave.hint.length > 0
      && ghSave.bg !== ghSave.brand && ghSave.opacity === '1',
    JSON.stringify(ghSave),
  )
  const npmSave = await disabledProbe('npm', '保存')
  check(
    '复核-011 npm「保存」禁用时给原因 + 中性底 + 不透明',
    npmSave !== null && npmSave.disabled === true && npmSave.hint !== null && npmSave.hint.length > 0
      && npmSave.bg !== npmSave.brand && npmSave.opacity === '1',
    JSON.stringify(npmSave),
  )

  // 表格数字列金额固定两位小数（PCQA-018）
  const moneyCells = await openModule('财务')
  // 落回第一个子视图（本月值不值）——否则可能停在无表格的视图上，断言会空转。
  await evalJs(`(() => { const tl = document.querySelector('.dock-body [role=tablist]'); const t = tl?.querySelectorAll('[role=tab]')[0]; t?.click(); return true })()`)
  await sleep(1200)
  const money = await evalJs(`(() => {
    const pane = document.querySelector('.dock-body')
    if (!pane) return null
    // 只看**表格内**的金额列：KPI/Hero 走紧凑规则（去尾零）是设计如此。
    // 面板里有好几张表（订阅计划 / 按量付费 / 成本趋势…），逐张收集，避免只看第一张空表。
    const tables = [...pane.querySelectorAll('*')].filter((el) => typeof el.className === 'string'
      && el.className.split(' ').some((c) => c.endsWith('_table')))
    if (tables.length === 0) return { count: 0, bad: [], sample: [], note: 'no-table' }
    const leaves = tables.flatMap((t) => [...t.querySelectorAll('*')].filter((el) => el.children.length === 0))
    const texts = leaves.map((el) => (el.textContent ?? '').trim()).filter((s) => /^¥[\\d,]/.test(s))
    const bad = texts.filter((s) => !/^¥[\\d,]+\.\\d{2}$/.test(s))
    return { count: texts.length, bad: bad.slice(0, 5), sample: texts.slice(0, 4) }
  })()`)
  check(
    '复核-018 表格金额固定两位小数（exact 变体）',
    moneyCells === true && money !== null && money.bad.length === 0,
    JSON.stringify(money),
  )

  // 产物新鲜度：宿主必须加载当前产物（插件样式零 --dsw-alias-*，h3 走 --spk-text-title）。
  const fresh = await evalJs(`(() => {
    const styles = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '')
    const count = (arr) => arr.reduce((n, s) => n + (s.match(/--dsw-alias-/g) ?? []).length, 0)
    const h3 = styles.map((s) => (s.match(/\\.dock-embed[^{]*h3[^{]*\\{[^}]*\\}/) ?? [])[0]).filter(Boolean)
    const title = getComputedStyle(document.body).getPropertyValue('--spk-text-title').trim()
    return {
      hippoAlias: count(styles.filter((s) => s.includes('.hippomemo-'))),
      dockAlias: count(styles.filter((s) => s.includes('.dock-panel'))),
      h3: h3.slice(0, 1),
      title,
    }
  })()`)
  check(
    '复核-产物 宿主加载的是当前产物（插件样式零宿主别名 · h3 钉 --spk-text-title · token 14px）',
    fresh.hippoAlias === 0 && fresh.dockAlias === 0 && fresh.title === '14px'
      && String(fresh.h3).includes('--spk-text-title'),
    JSON.stringify(fresh),
  )

  // 无论球有没有挂上，都把控制台线索打出来（挂载失败时这里才是答案）
  const allInteresting = console_.filter((line) => /spark|dock|remote|stream|mux|event|Error|error|warn/.test(line))
  console.log('\n--- 控制台（过滤后 ' + allInteresting.length + '/' + console_.length + ' 条）---')
  for (const line of allInteresting.slice(0, 24)) console.log('    ' + line.slice(0, 300))
} finally {
  edge.kill()
  // 显式关掉 CDP 连接：Windows 上若在 socket/handle 还在收尾时调 process.exit()，
  // libuv 会触发 `!(handle->flags & UV_HANDLE_CLOSING)` 断言并以
  // STATUS_STACK_BUFFER_OVERRUN (0xC0000409) 结束进程 —— 全绿也会变成非零退出码。
  // 因此这里只设置 exitCode，让事件循环自然排空。
  try { ws?.close() } catch { /* 已关闭 */ }
}

const failed = checks.filter((item) => !item.ok).length
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' 项通过')
process.exitCode = failed === 0 ? 0 : 1
