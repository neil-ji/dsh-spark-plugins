/**
 * dock 模块子页「标题层级 + 卡片分割」走查（零 dsh）：CDP 驱动 headless Edge，
 * 把每个模块子页里真实渲染出来的标题/标签量出来，供「重构插件 UI：Card 合理分割、
 * 无语义重复的 Title/Label」这类工作做机器判据。
 *
 *   node dev-harness/preview/title-audit.mjs                 # 五个模块全跑
 *   node dev-harness/preview/title-audit.mjs --module 记忆    # 只跑一个
 *   node dev-harness/preview/title-audit.mjs --json          # 只输出 JSON（供 diff）
 *
 * 输出三块：
 *   1. outline   可见标题（h1-h5）与卡片容器，按 y 排序 —— 看清「谁是谁的孩子」；
 *   2. hidden    display:none 的标题/简介（compat 层压掉的那些，本身就是重复证据）；
 *   3. dup       同一段文本在**同一子页不同语义位**出现多次（标题×标题、标题×标签）。
 *
 * 环境：EDGE_PATH 覆盖浏览器路径；PREVIEW_URL 覆盖预览地址。
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.CDP_PORT ?? (9700 + (process.pid % 200)))
const URL_BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5180/'
const OUT = fileURLToPath(new URL('../../.dev/title-audit/', import.meta.url))
const PROFILE_DIR = OUT + 'profile-' + process.pid
mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf('--' + name)
  return index === -1 ? fallback : argv[index + 1]
}
const JSON_ONLY = argv.includes('--json')
/** 只对第一个走查目标 dump 逐层结构（标签 + 前 3 个类 + 前 90 字），用于核对真实 DOM。 */
const DUMP = argv.includes('--html')
const MODULES = (arg('module', '火花,记忆,财务,GitHub,npm')).split(',').map((s) => s.trim()).filter(Boolean)
/**
 * 每个模块要逐页走查的**内层页签**。默认只走当前页 → 漏掉「火花/涌现提议」「记忆/进化」
 * 这类关键页，而「进化页是标准模板」恰恰要靠它来量。用前缀匹配（`进化` 命中「进化」）。
 */
const moduleTabs = (() => {
  const raw = arg('tabs', '火花:火花流,涌现提议,脚本目录;记忆:总览,记忆,待办,进化;财务:总览,连接,供应商,高级')
  const map = {}
  for (const entry of raw.split(';')) {
    const [name, list] = entry.split(':')
    if (name === undefined || list === undefined) continue
    map[name.trim()] = [null, ...list.split(',').map((s) => s.trim()).filter(Boolean)]
  }
  return map
})()

if (!existsSync(EDGE)) {
  console.error('找不到浏览器：' + EDGE + '（用 EDGE_PATH 指定 msedge/chrome 路径）')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 真实 DOM 逐层结构（标签 + 前 3 个类 + 该节点自身的文本），用于核对语义位判定。 */
const DUMP_PROBE = `(() => {
  const body = document.querySelector('.dock-body')
  if (body === null) return '(no dock-body)'
  const out = []
  const walk = (el, depth) => {
    const cls = typeof el.className === 'string' ? el.className.split(/\\s+/).filter(Boolean).slice(0, 3).join('.') : ''
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 90)
    out.push('  '.repeat(depth) + el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (own ? '  «' + own + '»' : ''))
    for (const kid of el.children) walk(kid, depth + 1)
  }
  walk(body, 0)
  return out.join('\\n')
})()`

/**
 * 页面内量测：把 dock 面板子页的标题/标签/卡片铺平，标出可见性与语义位。
 * `role` 用于区分「这是不是重复」——页级标题、卡片标题、字段标签、计量标签
 * 在语义上处于不同位；同一位重复不算问题，跨位重复才是。
 */
const PROBE = `(() => {
  const panel = document.querySelector('.dock-panel')
  if (panel === null) return { error: 'dock-panel missing' }
  const body = panel.querySelector('.dock-body')
  const scope = body ?? panel
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const cls = (el) => (typeof el.className === 'string' ? el.className.split(/\\s+/).filter(Boolean) : [])
  const txt = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  /**
   * 语义位（用真实 DOM 位置判，不靠命名猜）：
   *   card-head  卡片容器**头部条**里的标题 —— 卡片自己的名字，一个容器只该有一个；
   *   card-chip  卡片头部的计数/状态芯片（右端）；
   *   block-head 卡片**内部**的分组小标题（如进化页的「LLM 复核 / 动作」）；
   *   field      表单字段标签（label）；
   *   meta       行内元信息/提示。
   * 判据：沿祖先找到最近的卡片容器；标题若在该容器内**第一个**标题位 → card-head。
   */
  // 卡片容器：显式类（dock/hippomemo）∪ 任何 <section> 且类名里带 card
  // （ui-kit Card 在嵌页面里是 css-modules hash 前缀 + 稳定后缀 _card，且每个包前缀不同）。
  const isCard = (el) => el.tagName.toLowerCase() === 'section' && /(^|_)card($|-|_)/i.test(typeof el.className === 'string' ? el.className : '')
  const EXPLICIT = '.dock-card, .hippomemo-section-card, .hippomemo-brain-panel, .hippomemo-memory-panel, .hippomemo-pref-zone, .hippomemo-usage, .hippomemo-quadrant, .hippomemo-chart-card'
  const CARDS = [...scope.querySelectorAll(EXPLICIT + ', section')].filter((el) => el.matches(EXPLICIT) || isCard(el))
  const CARD_SEL = EXPLICIT
  const roleOf = (el) => {
    if (el.tagName.toLowerCase() === 'label') return 'field'
    if (el.matches(CARD_SEL) || isCard(el)) return 'card'
    const owner = CARDS.filter((card) => card !== el && card.contains(el)).pop()
    if (owner === undefined) return 'meta'
    const head = owner.firstElementChild
    if (head !== null && head.contains(el)) return 'card-head'
    return 'block-head'
  }
  const items = []
  for (const el of scope.querySelectorAll('h1, h2, h3, h4, h5, h6, .hippomemo-title, .hippomemo-intro, .hippomemo-panel-title, .hippomemo-panel-count, .hippomemo-block-title, .dock-lab, .dock-hint, .dock-prop-type, .dock-hline b, [class*="cardTitle"], [class*="sectionTitle"], [class*="title"], [class*="Title"]')) {
    const t = txt(el)
    if (t.length === 0) continue
    // 最近的**祖先**卡片容器（CARDS 是文档序，最后一个包含它的就是最近的）。
    const owner = CARDS.filter((card) => card !== el && card.contains(el)).pop()
    items.push({
      tag: el.tagName.toLowerCase(),
      cls: cls(el).slice(0, 3).join('.'),
      role: roleOf(el),
      // 所属卡片在 CARDS 里的下标：用于判「同一张卡里卡头与卡内小标题撞名」。
      card: owner === undefined ? -1 : CARDS.indexOf(owner),      text: t.slice(0, 40),
      visible: vis(el),
      rect: rect(el),
    })
  }
  // 卡片级分割：卡片容器的 y/高（含 ui-kit Card 的 <section>）
  const cards = []
  for (const el of CARDS) {
    if (!vis(el)) continue
    const r = rect(el)
    cards.push({ cls: cls(el).slice(0, 2).join('.'), rect: r, first: txt(el).slice(0, 30) })
  }
  /**
   * 违规判定（「Card 合理分割 + 无语义重复 Title/Label」的机器判据）：
   *   V1 卡头撞模块名   子页内某张卡 / 某个分组小标题，文本 == dock 模块头标题（如「记忆 HippoMemo」）
   *                     —— 模块头已经说了这一页是什么，卡里再写一遍是同一个名字挂两层；
   *   V2 跨层重复       同一文本既是某张卡的**卡头**、又是一处**卡内小标题**（进化页旧形制
   *                     的「LLM 复核 / 动作」），或卡头与卡内的字段/元信息同名；
   *   V3 卡头互撞       同一子页里两张不同的卡，卡头文本完全相同。
   */
  const paneTitle = (() => {
    const el = document.querySelector('.dock-head .name')
    return el === null ? '' : txt(el)
  })()
  const visible = items.filter((it) => it.visible)
  const violations = []
  for (const it of visible) {
    if (it.role === 'card-head' && it.text === paneTitle) {
      violations.push({ rule: 'V1', text: it.text, at: it.tag + (it.cls ? '.' + it.cls : '') + '@' + it.rect.y, why: '与 dock 模块头同名' })
    }
  }
  const heads = visible.filter((it) => it.role === 'card-head')
  for (const [i, a] of heads.entries()) {
    for (const b of heads.slice(i + 1)) {
      if (a.text === b.text) violations.push({ rule: 'V3', text: a.text, at: '两张卡头 @' + a.rect.y + ' / @' + b.rect.y, why: '同页两张卡同名' })
    }
  }
  const byText = new Map()
  for (const it of visible) {
    const list = byText.get(it.text) ?? []
    list.push(it)
    byText.set(it.text, list)
  }
  for (const [text, list] of byText) {
    const roles = new Set(list.map((it) => it.role))
    if (roles.has('card-head') && (roles.has('block-head') || roles.has('field'))) {
      violations.push({
        rule: 'V2',
        text,
        at: list.map((it) => it.role + '@' + it.rect.y).join(' / '),
        why: '卡头与卡内小标题/字段同名',
      })
    }
    // V2b：卡头里的元信息（计数/时间）与**同一张卡**内的小标题撞名 —— 卡头在宣告
    // 「这一组是什么」，卡内又写了一遍（旧进化页的「LLM 复核 / 动作」）。
    const headMeta = list.filter((it) => it.card >= 0 && it.role === 'card-head' && (it.tag === 'span' || it.tag === 'div'))
    const innerBlocks = list.filter((it) => it.role === 'block-head')
    for (const meta of headMeta) {
      for (const block of innerBlocks) {
        if (meta.card === block.card) {
          violations.push({
            rule: 'V2b',
            text,
            at: '卡头元信息@' + meta.rect.y + ' / 卡内小标题@' + block.rect.y,
            why: '同一张卡里卡头元信息与卡内小标题同名',
          })
        }
      }
    }
  }
  // 跨语义位重复（信息性：不算违规，留给人工看）
  const dup = []
  for (const [text, list] of byText) {
    const shapes = new Set(list.map((it) => it.tag + '|' + it.cls + '|' + it.role))
    if (shapes.size > 1) dup.push({ text, count: list.length, at: list.map((it) => it.tag + (it.cls ? '.' + it.cls : '') + '@' + it.rect.y) })
  }
  return {
    scope: cls(scope).slice(0, 2).join('.') || scope.tagName.toLowerCase(),
    paneTitle,
    visible: visible.sort((a, b) => a.rect.y - b.rect.y),
    hidden: items.filter((it) => !it.visible),
    cards: cards.sort((a, b) => a.rect.y - b.rect.y),
    dup,
    violations,
  }
})()`

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  // 每次运行独立 profile：复用同一目录会让新实例把命令交给已在跑的浏览器，CDP 目标拿不到。
  '--user-data-dir=' + PROFILE_DIR, '--window-size=1600,1200', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })

const killEdge = () => {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(edge.pid), '/T', '/F'], { stdio: 'ignore' })
    else edge.kill('SIGKILL')
  } catch { /* already gone */ }
}

/**
 * 收尾：headless Edge 会 fork 出一堆渲染/crashpad 子进程，`taskkill /T` 实测会漏
 * （跑几轮能堆到上百个）。先让 CDP `Browser.close`（最干净），再按**本脚本自己的
 * 输出目录**兜底清一遍 —— 只认 `.dev/title-audit/`，绝不动用户自己的浏览器实例
 * （`.dev/real-host-profile` 那个是别的工具的）。
 *
 * 注意四条实测踩过的坑（每一条都让清扫静默失效过）：
 *  ① `-Filter "Name = 'msedge.exe'"` 里的双引号会被 spawn 的 Windows 参数解析吃掉，
 *     PowerShell 收到裸的 `-Filter Name = 'msedge.exe'` → 参数错误 → 返回空；
 *  ② 同理 `-like "*$env:X*"` / `-match $env:X` 也别扭：前者被吃掉引号后语法错，
 *     后者会把路径当正则，`\\` 反而多转义一层导致匹配不到 —— 最终用
 *     `.Contains($env:X)`（纯子串判定，零转义、零引号）；
 *  ③ `Get-Process` 在这个环境下 `CommandLine` 全为空（21 个进程 0 个可读），匹配恒失败；
 *     `Get-CimInstance Win32_Process` 才读得到命令行；
 *  ④ 杀进程必须用 **spawnSync** —— 脚本在 finally 之后立刻 `process.exit`，
 *     异步 spawn 的 taskkill 还没执行就被一起带走（实测 matched=16、杀掉 0 个）。
 * 结论：**表达式里一个引号都不要留**，可变部分全走环境变量。
 */
const sweepProfile = () => {
  if (process.platform !== 'win32') return
  const ps = 'Get-CimInstance Win32_Process -Filter $env:AUDIT_FILTER | Where-Object { $_.CommandLine.Contains($env:AUDIT_PROFILE) } | ForEach-Object { $_.ProcessId }'
  try {
    const raw = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AUDIT_FILTER: "Name = 'msedge.exe'",
        AUDIT_PROFILE: OUT.replace(/[\\/]+$/, ''),
      },
    })
    for (const line of raw.split('\n')) {
      const pid = Number(line.trim())
      if (Number.isInteger(pid) && pid > 0) {
        // 必须 spawnSync：脚本在 finally 之后立刻 process.exit，异步 spawn 出来的
        // taskkill 还没执行就被一起带走了（实测 matched=16、杀掉 0 个）。
        try { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* gone */ }
      }
    }
  } catch { /* 清理失败不影响结论 */ }
}

const shutdown = async (send) => {
  try { await send('Browser.close') } catch { /* target already gone */ }
  await sleep(600)
  killEdge()
  await sleep(800)
  sweepProfile()
}

const report = {}
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

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: URL_BASE })
  await sleep(2200)

  // dock 画布 + 暗色 + 中文，面板开着
  await evalJs(`localStorage.setItem('dsh.preview:ui', JSON.stringify({ pane: 'dock', lang: 'zh', theme: 'dark', scenario: 'ok' }))`)
  await send('Page.navigate', { url: URL_BASE })
  await sleep(2800)
  await evalJs(`document.querySelector('.dock-ball') && document.querySelector('.dock-ball').click()`)
  await sleep(900)

  for (const module of MODULES) {
    // 先等内嵌页把数据流跑完：hippomemo 拉数期间会渲染 loading（内层页签还不在），
    // 直接点会点空。这几个模块都是 2~3 个请求，2.4s 足够。
    await sleep(2400)
    let dumped = null
    const clicked = await evalJs(`(() => {
      const tab = [...document.querySelectorAll('.dock-tab')].find((el) => el.getAttribute('aria-label') === ${JSON.stringify(module)})
      if (tab) tab.click()
      return tab !== undefined
    })()`)
    await sleep(1500)
    if (clicked !== true) { report[module] = { error: '模块未找到' }; continue }
    const tabs = (moduleTabs[module] ?? [null])
    for (const inner of tabs) {
      let tag = module
      if (inner !== null) {
        const ok = await evalJs(`(() => {
          const el = [...document.querySelectorAll('.dock-body [role="tab"], .dock-body button')]
            .find((n) => (n.textContent || '').trim().startsWith(${JSON.stringify(inner)}))
          if (el) el.click()
          return el !== undefined
        })()`)
        await sleep(1200)
        if (ok !== true) { report[module + '/' + inner] = { error: '内层页签未找到' }; continue }
        tag = module + '/' + inner
      }
      report[tag] = await evalJs(PROBE)
      // 默认 dump 第一个内层页签（跳过模块首屏），这样 `--tabs "记忆:进化"` 能直接看进化页。
      if (DUMP && dumped === null && (inner !== null || arg('module', null) === null)) {
        dumped = tag
        report.__dump = { tag, tree: await evalJs(DUMP_PROBE) }
      }
    }
  }
  ws.close()
} finally {
  // send 在 try 作用域里；收尾自己起一条 CDP 连接（浏览器还活着时能拿到 Browser.close）。
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    const ws2 = new WebSocket(list.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws2.onopen = res; ws2.onerror = rej })
    let n = 0
    const pendingClose = new Map()
    ws2.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pendingClose.has(msg.id)) { pendingClose.get(msg.id)(msg); pendingClose.delete(msg.id) }
    }
    const send2 = (method) => new Promise((res) => {
      const mid = ++n
      pendingClose.set(mid, res)
      ws2.send(JSON.stringify({ id: mid, method, params: {} }))
    })
    await shutdown(send2)
  } catch {
    killEdge()
  }
}

writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 2))

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2))
} else {
  if (report.__dump !== undefined) {
    console.log('\n════════ ' + report.__dump.tag + ' 真实 DOM ════════\n' + report.__dump.tree)
  }
  let bad = 0
  for (const [module, data] of Object.entries(report)) {
    if (module.startsWith('__')) continue
    console.log('\n════════ ' + module + ' ════════')
    if (data?.error !== undefined) { console.log('  ' + data.error); continue }
    console.log('  scope: ' + data.scope + '   模块头: «' + data.paneTitle + '»')
    console.log('  ── 卡片分割（' + data.cards.length + '）──')
    for (const card of data.cards) {
      console.log(`    y=${String(card.rect.y).padStart(4)} h=${String(card.rect.h).padStart(3)}  ${card.cls || '(无类)'}  «${card.first}»`)
    }
    console.log('  ── 可见标题/标签（' + data.visible.length + '）──')
    for (const it of data.visible) {
      console.log(`    y=${String(it.rect.y).padStart(4)}  ${it.tag}${it.cls ? '.' + it.cls : ''}  [${it.role}]  ${it.text}`)
    }
    if (data.hidden.length > 0) {
      console.log('  ── display:none 的标题（' + data.hidden.length + '）──')
      for (const it of data.hidden) console.log(`    ${it.tag}${it.cls ? '.' + it.cls : ''}  ${it.text}`)
    }
    if (data.dup.length > 0) {
      console.log('  ── 跨语义位重复文本（' + data.dup.length + '，信息性）──')
      for (const d of data.dup) console.log(`    «${d.text}» ×${d.count}  @ ${d.at.join('  ')}`)
    }
    const v = data.violations ?? []
    bad += v.length
    console.log(v.length === 0 ? '  ── 违规：无 ──' : '  ── 违规（' + v.length + '）──')
    for (const item of v) console.log(`    ${item.rule}  «${item.text}»  ${item.at}  — ${item.why}`)
  }
  console.log('\n报告：' + OUT + 'report.json' + (bad === 0 ? '  全部通过' : '  ' + bad + ' 处违规'))
  process.exit(bad === 0 ? 0 : 1)
}
