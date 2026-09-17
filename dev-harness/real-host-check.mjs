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
        && typeof statsValue.pending === 'number' && typeof statsValue.dropped === 'number'
        && typeof statsValue.deleted === 'number' && typeof statsValue.pendingProposals === 'number',
      JSON.stringify(statsProbe).slice(0, 220),
    )
    // 断言放在**面板文本**上而不是某个 CSS 选择器上：行内的「结晶/归档/丢弃」动作钮
    // 与筛选胶囊同类名，按类名取会取错（第一版就是这么误判的）。
    const inboxText = String(pane.text ?? '')
    check(
      '收件箱四个筛选位可见（待处理/已沉淀/已归档/已丢弃）',
      ['待处理', '已沉淀', '已归档', '已丢弃'].every((label) => inboxText.includes(label)),
      inboxText.slice(0, 160),
    )
    // 破坏性变更的可观测证据：旧 `status` 参数被忽略（返回全量），新 `inboxState` 才过滤。
    // 注意**不要**断言 archived 子集为 0：验收轮自己会归档火花，沙箱数据是可变的
    // （acc-20260917 的 QA 轮归档了 1 条，这条断言当轮就翻红 —— 断言要表达不变量，不是数据巧合）。
    const legacyFilter = await evalJs(`Promise.all([
      fetch('/sparks?status=archived&limit=200').then((r) => r.json()),
      fetch('/sparks?inboxState=archived&limit=200').then((r) => r.json()),
      fetch('/sparks?limit=200').then((r) => r.json()),
    ]).then(([legacy, modern, all]) => ({
      legacy: legacy.value?.length ?? -1,
      modern: modern.value?.length ?? -1,
      all: all.value?.length ?? -1,
    }))`)
    check(
      '旧 status 查询参数已失效（status= 被忽略返回全量，只有 inboxState= 会过滤）',
      legacyFilter?.legacy === legacyFilter?.all && legacyFilter?.modern >= 0 && legacyFilter?.modern < legacyFilter?.all,
      JSON.stringify(legacyFilter),
    )

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
    const expectedTabs = ['火花', '记忆', '财务', 'GitHub', 'npm']
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
    capture !== null && capture.disabled === true && capture.hint.includes('输入内容后可捕获'),
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

  // 6h) PCQA-017 剩余：记忆模块的卡片题走自有类名 .hippomemo-panel-title（(0,2,0) 压过 dock 的
  //     .dock-embed :is(h3)），所以必须在它自己那套样式里也钉在 --spk-text-title。
  const memIndex = await evalJs(`(() => Array.from(document.querySelectorAll('.dock-tab')).findIndex((b) => (b.getAttribute('aria-label') ?? '').startsWith('记忆')))()`)
  if (memIndex >= 0) {
    await evalJs(`(() => { const p = document.querySelector('.dock-panel'); if (!p.classList.contains('open')) document.querySelector('.dock-ball').click() })()`)
    await sleep(700)
    await evalJs('document.querySelectorAll(\'.dock-tab\')[' + memIndex + '].click()')
    await sleep(1300)
    const memTitle = await evalJs(`(() => {
      const h3 = document.querySelector('.dock-embed h3.hippomemo-panel-title')
      if (!h3) return null
      const cs = getComputedStyle(h3)
      return { text: (h3.textContent ?? '').trim().slice(0, 12), font: cs.fontSize, weight: cs.fontWeight, color: cs.color }
    })()`)
    check(
      'PCQA-017 记忆模块卡片题 14px（自有类名不再压过规范档）',
      memTitle !== null && memTitle.font === '14px' && memTitle.weight === '600',
      JSON.stringify(memTitle),
    )
  } else {
    check('PCQA-017 记忆模块可定位（前置条件）', false, '未找到记忆 tab')
  }

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
