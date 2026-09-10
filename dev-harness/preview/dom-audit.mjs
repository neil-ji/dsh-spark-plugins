/**
 * 插件面板布局走查（零 dsh）：CDP 驱动 headless Edge，量出真实渲染盒模型，
 * 断言三类**产品不变量**，供「挤成一团 / 换行 / 元素重叠」这类回归做机器判据。
 *
 *   node dev-harness/preview/dom-audit.mjs            # 全部画布，暗色，zh
 *   node dev-harness/preview/dom-audit.mjs --pane finance
 *
 * 判据（每个画布各自跑）：
 *   1. overlap   同一行内可见盒子的两两重叠面积（>0 即失败；排除嵌套祖先/后代）；
 *   2. overflow  元素 scrollWidth 超出 clientWidth 的横向溢出（被裁切 = 挤成一团）；
 *   3. wrap      行内 flex 子项被折到第二行（offsetTop 不一致）—— 只对声明不换行的行报。
 *
 * 环境：EDGE_PATH 覆盖浏览器路径；PREVIEW_URL 覆盖预览地址。
 * 退出码非 0 表示有失败项。
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.CDP_PORT ?? (9300 + (process.pid % 400)))
const URL_BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5180/'
const OUT = fileURLToPath(new URL('../../.dev/dom-audit/', import.meta.url))
const PROFILE_DIR = OUT + 'profile-' + process.pid
mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf('--' + name)
  return index === -1 ? fallback : argv[index + 1]
}
const ONLY = arg('pane', null)
/** dock 画布要切到的模块（按 aria-label 命中，如 GitHub / npm / 财务）。 */
const DOCK_MODULE = arg('module', null)
/** 逗号分隔的 CSS 选择器：额外把命中元素的盒子打出来（定位具体重叠）。 */
const RECTS = arg('rects', null)
/** 视口宽度（默认 1600）。窄视口会触发 dock 面板的 max-width 收缩 —— 重叠就出现在那里。 */
const WIDTH = Number(arg('width', 1600))

if (!existsSync(EDGE)) {
  console.error('找不到浏览器：' + EDGE + '（用 EDGE_PATH 指定 msedge/chrome 路径）')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 画布内量测脚本（在页面里跑）。返回 { canvas, overlaps, overflows, wraps }。
 * 只关心「同一行内并排的可见盒子」，并把祖先/后代对排除掉（那是合法嵌套，不是重叠）。
 */
const PROBE = `(() => {
  const canvas = document.querySelector('.pv-frame, .dock-panel') || document.body
  const root = canvas
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
  const inter = (a, b) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    return w > 0 && h > 0 ? w * h : 0
  }
  const isVisible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const label = (el) => {
    const cls = typeof el.className === 'string' ? el.className.split(/\\s+/).filter(Boolean).slice(0, 3).join('.') : ''
    const text = (el.textContent || '').trim().slice(0, 18)
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (text ? ' [' + text + ']' : '')
  }
  // 参与重叠检测的「叶子盒子」：可见、且内部没有更小的同族盒子（叶子 = 没有可见元素子节点）
  const all = [...root.querySelectorAll('*')].filter(isVisible)
  const leaves = all.filter((el) => ![...el.children].some(isVisible))

  // 刻意重叠的装饰层：SegmentedControl 的滑块本来就压在激活页签下面；SVG 图元互相
  // 拼接也是正常绘制。两者都不是布局事故，排除掉以降低噪声。
  const decorative = (el) => Boolean(el.closest('.V-e0Qq_seg')) || el.ownerSVGElement !== null || el.tagName.toLowerCase() === 'svg'

  const overlaps = []
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i]; const b = leaves[j]
      if (a.contains(b) || b.contains(a)) continue
      if (decorative(a) || decorative(b)) continue
      const area = inter(rect(a), rect(b))
      if (area <= 0) continue
      // 忽略不足 4px² 的亚像素贴边
      if (area < 4) continue
      overlaps.push({ a: label(a), b: label(b), area: Math.round(area) })
    }
  }

  const overflows = []
  for (const el of all) {
    if (decorative(el)) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
    const dx = el.scrollWidth - el.clientWidth
    if (dx > 1) overflows.push({ el: label(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, dx })
  }

  // 折行检测：nowrap 的**横向** flex 行里，子项被分到不同「视觉行」（纵向区间不相交）。
  // 纵向 flex 列本来就是一行一项，不算折行；也不能用 top 相等来判断，
  // 因为 align-items:center 下不同高度的子项 top 本来就不同。
  const wraps = []
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (cs.display !== 'flex' || cs.flexWrap !== 'nowrap') continue
    if (cs.flexDirection !== 'row' && cs.flexDirection !== 'row-reverse') continue
    const kids = [...el.children].filter(isVisible)
    if (kids.length < 2) continue
    const ranges = kids.map((k) => { const r = k.getBoundingClientRect(); return { k, top: r.top, bottom: r.bottom } })
    const lines = []
    for (const range of ranges) {
      const line = lines.find((l) => Math.min(l.bottom, range.bottom) - Math.max(l.top, range.top) > 0.5)
      if (line === undefined) lines.push({ top: range.top, bottom: range.bottom, kids: [range.k] })
      else { line.top = Math.min(line.top, range.top); line.bottom = Math.max(line.bottom, range.bottom); line.kids.push(range.k) }
    }
    if (lines.length > 1) wraps.push({ row: label(el), lines: lines.length, kids: kids.map(label) })
  }

  // 面板级边距节奏：卡片之间的垂直 gap
  const cards = [...root.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el)
    return cs.borderTopWidth !== '0px' && cs.borderTopStyle === 'solid' && cs.borderRadius !== '0px' && el.getBoundingClientRect().width > 120
  }).map((el) => ({ el: label(el), top: Math.round(el.getBoundingClientRect().top) }))

  return {
    canvas: { w: Math.round(root.getBoundingClientRect().width), h: Math.round(root.getBoundingClientRect().height) },
    overlaps: overlaps.slice(0, 40),
    overflows: overflows.slice(0, 40),
    wraps: wraps.slice(0, 40),
    cards,
  }
})()`

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  // 每次运行独立 profile：复用同一目录会让新实例把命令交给已在跑的浏览器，
  // CDP 目标就再也拿不到了（表现为脚本静默挂死）。
  '--user-data-dir=' + PROFILE_DIR, '--window-size=1600,1200', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })

/** 杀掉整棵 Edge 进程树（headless Edge 会 fork 出多个渲染进程）。 */
const killEdge = () => {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(edge.pid), '/T', '/F'], { stdio: 'ignore' })
    else edge.kill('SIGKILL')
  } catch { /* already gone */ }
}

/**
 * 收尾：按**本脚本自己的输出目录**（`.dev/dom-audit/profile-<pid>`）兜底清掉剩下的
 * Edge 进程。`taskkill /T` 实测会漏子进程（跑几轮能堆到上百个），所以这里用
 * `Get-Process` 读命令行再逐个杀；只认本目录，不动用户自己的浏览器实例。
 *
 * 注意四条实测踩过的坑（每一条都让清扫静默失效过）：
 *  ① `-Filter "Name = 'msedge.exe'"` 里的双引号会被 spawn 的 Windows 参数解析吃掉，
 *     PowerShell 收到裸的 `-Filter Name = 'msedge.exe'` → 参数错误 → 返回空；
 *  ② 同理 `-like "*$env:X*"` / `-match $env:X` 也别扭：前者被吃掉引号后语法错，
 *     后者会把路径当正则，`\\` 反而多转义一层导致匹配不到 —— 最终用
 *     `.Contains($env:X)`（纯子串判定，零转义、零引号）；
 *  ③ `Get-Process` 在这个环境下 `CommandLine` 全为空（21 个进程 0 个可读），匹配恒失败；
 *     `Get-CimInstance Win32_Process` 才读得到命令行；
 *  ④ 杀进程必须用 **spawnSync** —— 脚本在 finally 之后立刻 `process.exit(0)`，
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
        // 必须 spawnSync：脚本在 finally 之后立刻 process.exit(0)，
        // 异步 spawn 出来的 taskkill 还没执行就被一起带走了（实测 matched=16、杀掉 0 个）。
        try { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* gone */ }
      }
    }
  } catch { /* 清理失败不影响结论 */ }
}

const results = {}
let failures = 0
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
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1200, deviceScaleFactor: 1, mobile: false })

  // localStorage 需要文档来源：先落到预览源，再写偏好、再重载。
  await send('Page.navigate', { url: URL_BASE })
  await sleep(2000)

  const basePanes = ONLY === null ? ['dock', 'github', 'npm', 'finance'] : [ONLY]
  // dock 画布按模块逐个量（面板 616px 宽，窄容器下的布局事故都在这里）
  const dockModules = (DOCK_MODULE === null ? '火花,记忆,财务,GitHub,npm' : DOCK_MODULE).split(',').map((s) => s.trim()).filter(Boolean)
  const tasks = []
  for (const pane of basePanes) {
    if (pane === 'dock') for (const module of dockModules) tasks.push({ pane, module })
    else tasks.push({ pane, module: null })
  }

  for (const task of tasks) {
    const { pane, module } = task
    await evalJs(`localStorage.setItem('dsh.preview:ui', JSON.stringify({ pane: ${JSON.stringify(pane)}, lang: 'zh', theme: 'dark', scenario: 'ok' }))`)
    await send('Page.navigate', { url: URL_BASE })
    await sleep(2600)
    let tag = pane
    if (pane === 'dock') {
      await evalJs(`document.querySelector('.dock-ball') && document.querySelector('.dock-ball').click()`)
      await sleep(900)
      if (module !== null) {
        const clicked = await evalJs(`(() => {
          const tab = [...document.querySelectorAll('.dock-tab')].find((el) => el.getAttribute('aria-label') === ${JSON.stringify(module)})
          if (tab) tab.click()
          return tab !== undefined
        })()`)
        await sleep(900)
        tag = 'dock/' + module + (clicked === true ? '' : ' !未找到模块')
      }
    }
    // finance 高级页签：财务布局问题都在这里
    if (pane === 'finance' || (pane === 'dock' && module === '财务')) {
      await evalJs(`(() => {
        const tabs = [...document.querySelectorAll('[role="tab"], button')]
        const tab = tabs.find((el) => (el.textContent || '').trim() === '高级')
        if (tab) tab.click()
        return tab !== undefined
      })()`)
      await sleep(700)
    }
    const report = await evalJs(PROBE)
    results[tag] = report
    const bad = (report?.overlaps?.length ?? 0) + (report?.overflows?.length ?? 0) + (report?.wraps?.length ?? 0)
    if (bad > 0) failures += 1
    console.log(`\n■ ${tag}  canvas ${report?.canvas?.w}×${report?.canvas?.h}  重叠 ${report?.overlaps?.length ?? 0} · 溢出 ${report?.overflows?.length ?? 0} · 折行 ${report?.wraps?.length ?? 0}`)
    for (const item of report?.overlaps ?? []) console.log(`    overlap  ${item.a}  ×  ${item.b}  (${item.area}px²)`)
    for (const item of report?.overflows ?? []) console.log(`    overflow ${item.el}  ${item.scrollWidth}>${item.clientWidth} (+${item.dx})`)
    for (const item of report?.wraps ?? []) console.log(`    wrap     ${item.row}  lines=${item.lines}  [${item.kids.join(' | ')}]`)
    console.log('    cards: ' + (report?.cards ?? []).map((c) => c.el + '@' + c.top).join('  '))

    if (RECTS !== null) {
      const dump = await evalJs(`(() => {
        const out = []
        for (const sel of ${JSON.stringify(RECTS.split(',').map((s) => s.trim()))}) {
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect()
            out.push({ sel, tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className : '', text: (el.textContent || '').trim().slice(0, 14),
              x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) })
          }
        }
        return out
      })()`)
      console.log('    rects:')
      for (const item of dump ?? []) console.log(`      ${item.sel}  ${item.tag}.${item.cls} [${item.text}]  x=${item.x} y=${item.y} w=${item.w} h=${item.h}`)
    }
  }
  ws.close()
} finally {
  killEdge()
  await sleep(800)
  sweepProfile()
}

const { writeFileSync } = await import('node:fs')
writeFileSync(OUT + 'report.json', JSON.stringify(results, null, 2))
console.log('\n报告：' + OUT + 'report.json  ' + (failures === 0 ? '全部通过' : failures + ' 个画布有问题'))
process.exit(0)
