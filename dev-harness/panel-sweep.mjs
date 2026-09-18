/**
 * 面板全量走查（真宿主 / 预览画布共用）：CDP 驱动 headless Edge，把指挥舱里**所有模块**逐个点开、
 * 自动发现子视图，逐个截图并抓 pane 文本与控制台条目。
 *
 * 与 finance-panel-shots.mjs 的分工：那个只走财务的四个决策视图（财务专项）；这个走
 * 「全部模块 × 全部子视图」，产出 PC-QA 视觉评审要用的证据集（28 张面板图 + report.json）。
 *
 * 用法：
 *   pnpm sandbox:up                       # 真宿主（先 pnpm sandbox:install）
 *   pnpm shots:panels                     # 缺省读 .dev/state.json 的 url
 *   node dev-harness/panel-sweep.mjs --url "<pnpm sandbox:up 当次打印的带 token 地址>"
 *   node dev-harness/panel-sweep.mjs --url http://127.0.0.1:5180/ --out .dev/panel-sweep/preview
 *
 * 参数：--url 目标地址（缺省读 .dev/state.json，再退到 http://127.0.0.1:3997/）；
 *       --out 产物目录（缺省 .dev/panel-sweep/run）；--profile 浏览器 profile（缺省 <out>/profile）。
 * 环境：EDGE_PATH 覆盖浏览器可执行文件；CDP_PORT 覆盖调试端口（缺省 9236，避开财务走查的 9231）。
 * 产物：<out>/<模块>__<子视图>.png、<out>/<模块>__home.png、<out>/report.json
 *       （模块清单 + 每个视图的 pane 文本 + 控制台条目按视图归属 + 点不到的子视图清单 misses）。
 *
 * 三个实测坑（写在这里免得再踩）：
 *   1. .dev/state.json 的 url/token 可能是**过期**的（宿主重启后 token 会变），拿它打开会得到
 *      「dsh web authentication required」。用 pnpm sandbox:up 当次打印的地址最稳。
 *   2. 子视图靠**启发式**发现：.dock-embed 内有文本、长度 ≤12、未 aria-hidden 的按钮都算候选。
 *      形如「动作」的标签（归档 / 丢弃 / 删除 / 还原 / 保存 / 测试 / 刷新 / 结晶 …，见 ACTION_LABEL_RE；
 *      裸动作词一律用 ^ 锚定，免得「海马体最近结晶 57」这种视图标签被误伤）
 *      **不点**，记进 report.json 的 skipped；点了但没命中的记进 misses。真正的子视图都会进证据集，
 *      但仍可能漏 —— 数量别当断言（断言归 dev-harness/real-host-check.mjs）。
 *   3. 首启的「添加一个 API Key」弹窗会 mask 掉合成点击 —— 本脚本先 DOM click「稍后配置」再走。
 *
 * 退出码：0 = 每个模块页签都点得开且 report.json 落盘；1 = 中途失败（报告仍会尽量落盘）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.CDP_PORT ?? 9236)
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const argv = process.argv.slice(2)
const argOf = (name, fallback) => { const i = argv.indexOf('--' + name); return i === -1 ? fallback : argv[i + 1] }

/** .dev/state.json 的 url 可能过期；拿不到就退到沙箱默认端口。 */
function defaultUrl() {
  const stateFile = ROOT + '.dev/state.json'
  if (!existsSync(stateFile)) return 'http://127.0.0.1:3997/'
  try { return JSON.parse(readFileSync(stateFile, 'utf8')).url } catch { return 'http://127.0.0.1:3997/' }
}

const outArg = argOf('out', '.dev/panel-sweep/run')
const URL_TARGET = argOf('url', defaultUrl())
const OUT = /^[A-Za-z]:[\\/]|^\//.test(outArg) ? outArg : ROOT + outArg
const PROFILE = argOf('profile', OUT + '/profile')
/** 单个模块最多点开的子视图数，防止启发式误判导致跑飞。 */
const MAX_SUBS_PER_TAB = 16
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const safeName = (text) => (text || 'view').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 60)

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--window-size=1440,1000', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })

let ws
let failed = false
let currentView = 'boot'
const consoleEntries = []
const views = []
const tabs = []
const misses = []
/**
 * 标签形如「动作」而不是「视图」的按钮：**不点**。点了会改沙箱数据（归档 / 丢弃 / 结晶 / 注入）、
 * 弹确认框（还原 / 删除），或把后续 hit-test 挡在模态层后面。被跳过的记进 report.json 的 skipped。
 */
const ACTION_LABEL_RE = /^删除|^归档|^丢弃|^结晶|^注入|^合并|还原|清空|重置|注销|退出|保存|测试|刷新|重试|更新|捕获|关闭/
const skipped = []

try {
  let target = null
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()
      target = list.find((e) => e.type === 'page')
      if (target) break
    } catch {}
  }
  if (!target) throw new Error('no CDP target on port ' + PORT)

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleEntries.push({
        view: currentView,
        type: m.params.type,
        text: (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '),
      })
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
    return r.result && r.result.result ? r.result.result.value : null
  }
  const shot = async (name) => {
    const clip = await evalJs("(function(){ const p = document.querySelector('.dock-panel'); const rect = p && p.getBoundingClientRect(); if (!rect || rect.width < 50) return null; return { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height, scale: 2 } })()")
    if (!clip) { console.error('[sweep] shot miss: ' + name); return false }
    const r = await send('Page.captureScreenshot', { format: 'png', clip })
    if (!r.result || !r.result.data) { console.error('[sweep] shot empty: ' + name); return false }
    writeFileSync(OUT + '/' + name + '.png', Buffer.from(r.result.data, 'base64'))
    return true
  }
  const paneText = () => evalJs("(document.querySelector('.dock-embed') || document.querySelector('.dock-panel') || {}).textContent ? ((document.querySelector('.dock-embed') || document.querySelector('.dock-panel')).textContent || '').replace(/\\s+/g, ' ').slice(0, 6000) : ''")
  const clickTabAt = (index) => evalJs('(() => { const list = Array.from(document.querySelectorAll(".dock-tab")); const t = list[' + index + ']; if (!t) return false; t.click(); return true })()')
  /**
   * 按标签现测坐标再点。两处实测教训（首版漏点一半子视图）：
   *   1. 坐标必须**现测**——切回模块页签会让面板重排，提前缓存的 {x,y} 失效；
   *   2. 先 scrollIntoView 再测，且必须用 behavior:"instant"——平滑滚动下测到的是动画中间态，
   *      折叠线以下的按钮会 100% 漏点（实测 12/32 漏点都是这个原因）。
   */
  const clickSub = (label) => evalJs('(() => { const root = document.querySelector(".dock-embed") || document.querySelector(".dock-panel"); if (!root) return false; const want = ' + JSON.stringify(label) + '; const txt = (b) => (b.textContent || "").trim(); const hits = Array.from(root.querySelectorAll("button")).filter((b) => { if (b.matches(".dock-tab") || b.closest(".dock-tab")) return false; if (b.offsetParent === null) return false; const t = txt(b); return t === want || (want.length >= 3 && t.slice(0, 3) === want.slice(0, 3)) }); hits.sort((a, c) => (txt(a) === want ? 0 : 1) - (txt(c) === want ? 0 : 1)); for (const b of hits) { if (b.scrollIntoView) b.scrollIntoView({ block: "center", behavior: "instant" }); const r = b.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue; const cx = r.x + r.width / 2, cy = r.y + r.height / 2; const hit = document.elementFromPoint(cx, cy); if (!hit || !b.contains(hit)) continue; b.click(); return true } return false })()')
  /** 截图前把面板滚回顶部：clickSub 可能刚把某个按钮滚到视口中间。 */
  const scrollPanelTop = () => evalJs("(() => { for (const el of document.querySelectorAll('.dock-body, .dock-embed, .dock-panel')) el.scrollTop = 0; return true })()")
  /**
   * 关掉子视图可能弹出的菜单 / 弹窗，免得挡住下一个子视图的 hit-test。
   * **必须有弹层才按**：dock 自己把 Esc 绑成「收起面板」，无条件按会把整轮走查打断
   * （实测：第一个子视图之后全部漏点，views 从 24 掉到 6）。
   */
  const closeLayer = async () => {
    const hasLayer = await evalJs("(() => document.querySelector('[data-spk-layer]') !== null)()")
    if (hasLayer !== true) return
    const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
    await sleep(400)
  }
  /**
   * 回到模块的**基线视图**（分段条的第一个 role=tab）。
   * 模块会记住上次的子视图，而「筛选胶囊 / 脑区图例」这类控件只存在于基线视图 ——
   * 不先回基线就点它们，会 100% 漏点（实测：火花的 5 个筛选胶囊 + 记忆的 3 个图例项）。
   * 没有分段条的模块（GitHub / npm）返回 false，保持原状。
   */
  const resetToBaseView = () => evalJs("(() => { const list = document.querySelector('.dock-embed [role=tablist]'); if (!list) return false; const t = list.querySelector('[role=tab]'); if (!t) return false; t.click(); return true })()")
  /** 面板若被收起就再点开（Esc / 误点都可能收起它），否则后面所有 hit-test 都够不着。 */
  const ensurePanelOpen = async () => {
    const isOpen = () => evalJs("(() => { const p = document.querySelector('.dock-panel'); return p !== null && p.classList.contains('open') })()")
    if (await isOpen() === true) return true
    await evalJs("(() => { const b = document.querySelector('.dock-ball'); if (!b) return false; b.click(); return true })()")
    await sleep(1500)
    return await isOpen() === true
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: URL_TARGET })

  let ready = null
  for (let i = 0; i < 180; i += 1) {
    await sleep(1000)
    ready = await evalJs('(() => ({ ball: document.querySelectorAll(".dock-ball").length }))()')
    if (ready && ready.ball > 0) break
  }
  if (!ready || ready.ball === 0) throw new Error('dock ball never appeared (' + URL_TARGET + ') —— token 可能过期，见文件头坑 1')
  console.error('[sweep] ball ready')

  // 坑 3：首启引导弹窗会挡住合成点击。
  await evalJs("(() => { const b = Array.from(document.querySelectorAll('button, [role=button]')).find((x) => /稍后|跳过|Later|Skip/.test(x.textContent || '')); if (b) b.click(); return true })()")
  await sleep(800)
  await evalJs("(() => { const b = document.querySelectorAll('.dock-ball')[0]; if (!b) return false; b.click(); return true })()")
  await sleep(2500)

  const tabList = await evalJs("Array.from(document.querySelectorAll('.dock-tab')).map((t, i) => ({ i: i, label: ((t.getAttribute('aria-label') || t.textContent || '').trim()) }))")
  if (!tabList || tabList.length === 0) throw new Error('no .dock-tab found —— 面板没展开？')
  tabs.push(...tabList)
  console.error('[sweep] modules: ' + JSON.stringify(tabList.map((t) => t.label)))

  for (const tab of tabList) {
    await ensurePanelOpen()
    if (!(await clickTabAt(tab.i))) { failed = true; console.error('[sweep] tab miss: ' + tab.label); continue }
    await sleep(2500)
    currentView = tab.label
    const before = await paneText()
    await shot(safeName(tab.label) + '__home')
    views.push({ view: tab.label + '__home', tab: tab.label, sub: null, text: before })

    // 只收标签：坐标会随「点完子视图再切回模块页签」的重排失效，点击前必须现测（见 clickSub）。
    // 候选只按「存在 + 有文本」收（不要求在视口内）：视口外的子视图也应进证据集，
    // 能不能点到交给 clickSub 现场判定，点不到就记进 misses。
    const candidates = await evalJs("(() => { const root = document.querySelector('.dock-embed') || document.querySelector('.dock-panel'); if (!root) return []; const counts = new Map(); for (const b of root.querySelectorAll('button')) { if (b.matches('.dock-tab') || b.closest('.dock-tab')) continue; if (b.offsetParent === null) continue; if (b.closest('[aria-hidden=\"true\"]')) continue; const t = (b.textContent || '').trim(); if (!t || t.length > 12) continue; counts.set(t, (counts.get(t) || 0) + 1) } return Array.from(counts.entries()).map((e) => ({ label: e[0], count: e[1] })) })()") || []
    // 规则 A：同名按钮出现多次 = **行内重复动作**（每行一个「归档 / 丢弃 / 结晶」），不点也不重复截图；
    // 规则 B：单个的破坏性/动作钮按 ACTION_LABEL_RE 跳过。两条都记进 report.json 的 skipped。
    const subs = candidates.filter((c) => {
      if (c.count > 1) { skipped.push(tab.label + ' / ' + c.label + '（行内重复 ×' + c.count + '）'); return false }
      if (!ACTION_LABEL_RE.test(c.label)) return true
      skipped.push(tab.label + ' / ' + c.label)
      return false
    }).map((c) => c.label)
    console.error('[sweep] ' + tab.label + ' subs: ' + JSON.stringify(subs) + (candidates.length === subs.length ? '' : ' (skipped ' + (candidates.length - subs.length) + ' 个)'))

    for (const label of subs.slice(0, MAX_SUBS_PER_TAB)) {
      // 每次点击前先回基线视图：模块会记住上次的子视图，而基线视图才有的控件（筛选胶囊 / 图例项）
      // 不在基线视图里根本点不到（见 resetToBaseView 注释）。
      await resetToBaseView()
      await sleep(900)
      if (!(await clickSub(label))) { misses.push(tab.label + ' / ' + label); console.error('[sweep] sub miss: ' + tab.label + '/' + label); continue }
      await sleep(1800)
      currentView = tab.label + '/' + label
      await scrollPanelTop()
      await sleep(300)
      await shot(safeName(tab.label + '__' + label))
      views.push({ view: tab.label + '__' + label, tab: tab.label, sub: label, text: await paneText() })
      // 先关掉子视图可能弹出的菜单/弹窗，再切回模块页签复位
      // （避免上一个子视图的状态串到下一个；tab 切换本身也会触发模块重挂载）
      await closeLayer()
      await clickTabAt(tab.i)
      await sleep(1500)
    }
  }
  console.error('[sweep] done: modules=' + tabList.length + ' views=' + views.length + ' console=' + consoleEntries.length)
} catch (error) {
  failed = true
  console.error('[sweep] FAILED: ' + (error instanceof Error ? error.message : String(error)))
} finally {
  try { ws.close() } catch {}
  try { edge.kill() } catch {}
  writeFileSync(OUT + '/report.json', JSON.stringify({ url: URL_TARGET, generatedAt: new Date().toISOString(), modules: tabs, views, console: consoleEntries, misses, skipped }, null, 2))
  console.error('[sweep] report -> ' + OUT + '/report.json')
  // 不调 process.exit()：Windows 上 CDP/undici 收尾时调它会让 libuv 断言（0xC0000409），
  // 把本该全绿的一次走查变成非零退出（AGENTS §4）。置 exitCode 让进程自然排空即可。
  process.exitCode = failed ? 1 : 0
}
