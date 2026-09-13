/**
 * 财务面板走查（真宿主 / 预览画布共用）：CDP 驱动 headless Edge，把四个决策视图逐个
 * 点开、抓 pane 文本与整屏截图，并采集控制台条目。
 *
 * 用法：
 *   pnpm sandbox:up                       # 真宿主（先 pnpm sandbox:install）
 *   node dev-harness/finance-panel-shots.mjs --url "<pnpm sandbox:up 打印的带 token 地址>"
 *   node dev-harness/finance-panel-shots.mjs --url http://127.0.0.1:5180/     # 预览画布
 *
 * 参数：--url 目标地址（缺省读 .dev/state.json 的 url）；--out 产物目录（缺省 .dev/finance-shots/run）；
 *       --profile 浏览器 profile（缺省 <out>/profile）。
 * 产物：<out>/<视图名>.png ×4 + <out>/report.json（pane 文本、每个页签的 testid/文本、控制台条目）。
 *
 * 两个实测坑（写在这里免得再踩）：
 *   1. `.dev/state.json` 的 url/token 可能是**过期**的（宿主重启后 token 会变），拿它打开会得到
 *      「dsh web authentication required」。用 `pnpm sandbox:up` 当次打印的地址最稳。
 *   2. 首启「添加一个 API Key」弹窗会 mask 掉合成点击 —— 脚本会先 DOM click「稍后配置」。
 *
 * 退出码：0 = 四个视图页签都点得开且产出了报告；1 = 中途失败（报告仍会尽量落盘）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.CDP_PORT ?? 9231)
const argv = process.argv.slice(2)
const argOf = (name, fallback) => { const i = argv.indexOf('--' + name); return i === -1 ? fallback : argv[i + 1] }
const ROOT = fileURLToPath(new URL('../', import.meta.url))

function defaultUrl() {
  const stateFile = ROOT + '.dev/state.json'
  if (!existsSync(stateFile)) return 'http://127.0.0.1:3997/'
  try { return JSON.parse(readFileSync(stateFile, 'utf8')).url } catch { return 'http://127.0.0.1:3997/' }
}

const URL_TARGET = argOf('url', defaultUrl())
const OUT = ROOT + argOf('out', '.dev/finance-shots/run')
const PROFILE = argOf('profile', OUT + '/profile')
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!existsSync(EDGE)) { console.error('找不到浏览器：' + EDGE + '（用 EDGE_PATH 指定）'); process.exit(1) }
console.error('[shots] target ' + URL_TARGET)
console.error('[shots] out    ' + OUT)

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + PROFILE, '--window-size=1440,1000', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })

let ws = null
const consoleEntries = []
let report = null
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
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleEntries.push({ type: msg.params.type, text: (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ') })
    }
    if (msg.method === 'Log.entryAdded') consoleEntries.push({ type: msg.params.entry.level, text: msg.params.entry.text })
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: URL_TARGET })
  // 冷 profile 首载要下载/编译 5 个 client bundle（预览画布是 15MB dev bundle），
  // 固定 sleep 不够 —— 轮询到「球或面板出现」为止，最多 3 分钟。
  let ready = null
  for (let i = 0; i < 180; i += 1) {
    await sleep(1000)
    ready = await evalJs(`(() => ({
      href: location.href,
      title: document.title,
      ball: document.querySelectorAll('.dock-ball').length,
      panel: document.querySelectorAll('[data-testid="finance-panel"]').length,
      body: (document.body?.textContent ?? '').length,
      text: (document.body?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 160),
    }))()`)
    if ((ready?.ball ?? 0) > 0 || (ready?.panel ?? 0) > 0) break
  }
  console.error('[shots] ready ' + JSON.stringify(ready))

  // 真宿主：先开悬浮球再点「财务」tab；预览画布：面板已经在页面上。
  const hasPanel = ready?.panel ?? await evalJs(`document.querySelectorAll('[data-testid="finance-panel"]').length`)
  let panelText = null
  const mode = hasPanel === 0 ? 'real-host' : 'preview'
  if (mode === 'real-host') {
    // 首启「添加 API Key」弹窗会 mask 掉合成点击 —— 先关掉它（DOM click 有效）。
    await evalJs(`(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
      const later = buttons.find((b) => /稍后|跳过|Later|Skip/.test(b.textContent ?? ''))
      if (later) { later.click(); return true }
      return false
    })()`)
    await sleep(800)
    await evalJs(`document.querySelectorAll('.dock-ball')[0]?.click()`)
    await sleep(1500)
    const clicked = await evalJs(`(() => {
      const tab = Array.from(document.querySelectorAll('.dock-tab'))
        .find((b) => (b.getAttribute('aria-label') ?? '').includes('财务'))
      if (!tab) return false
      tab.click()
      return true
    })()`)
    await sleep(1500)
    if (!clicked) {
      report = {
        mode, url: URL_TARGET, error: '财务 tab 未找到',
        diag: await evalJs(`(() => ({
          ball: document.querySelectorAll('.dock-ball').length,
          tabs: Array.from(document.querySelectorAll('.dock-tab')).map((b) => b.getAttribute('aria-label')),
          body: (document.body.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 200),
        }))()`),
        console: consoleEntries,
      }
      writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 2))
      throw new Error('财务 tab 未找到')
    }
  }

  panelText = await evalJs(`(() => {
    const el = document.querySelector('[data-testid="finance-panel"], .dock-panel, .dock-body')
    return el ? (el.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 500) : null
  })()`)

  const views = ['本月值不值', '该用谁', '怎么调度更省', '项目账']
  report = { mode, url: URL_TARGET, panelText, views: [], shots: [] }
  for (const label of views) {
    const clicked = await evalJs(`(() => {
      const root = document.querySelector('[data-testid="finance-panel"]') ?? document.querySelector('.dock-panel') ?? document.body
      const button = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === ${JSON.stringify(label)})
      if (!button) return false
      button.click()
      return true
    })()`)
    await sleep(700)
    const viewText = await evalJs(`(() => {
      const view = document.querySelector('[data-testid^="finance-view-"], [data-testid="finance-empty"]')
      return view ? { testid: view.getAttribute('data-testid'), text: (view.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 700) } : null
    })()`)
    report.views.push({ label, clicked, view: viewText })

    // 悬浮球面板是 fixed 覆盖层：clip 到元素矩形会截到背景页，所以直接截整个视口。
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = OUT + '/' + label + '.png'
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    report.shots.push(file)
  }

  report.console = consoleEntries
  writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 2))
  const failed = report.views.filter((entry) => entry.clicked !== true)
  console.log(`[shots] ${report.views.length - failed.length}/${report.views.length} 个视图页签点开成功 · 控制台 ${consoleEntries.filter((e) => e.type === 'error').length} 条 error`)
  if (failed.length > 0) throw new Error('有视图页签点不开：' + failed.map((entry) => entry.label).join('、'))
} finally {
  try { ws?.close() } catch { /* ignore */ }
  edge.kill()
}
