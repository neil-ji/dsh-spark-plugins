#!/usr/bin/env node
/**
 * 启动冒烟（boot smoke）——回答三个问题，且**必须从零起一个实例**来回答：
 *
 *   1. `dsh` 能不能正常启动、**不抛异常**（捕获 stdout/stderr + 探针里的服务/条目面）；
 *   2. 页面能不能打开（无头浏览器导航到带 token 的 URL）；
 *   3. 页面会不会崩（无未捕获异常 / 控制台 error；dock 每个模块点开都有内容，
 *      不出现「装配失败 / 未加载 / React error」）。
 *
 * 为什么需要它：`scripts/install-profile.mjs` 只**打印**过 `启动验证: dsh …` 这行命令，
 * 从不真的启动；`dev-up` 的就绪判定也只有「URL + /__dev/probe 有响应」。于是"装成功、
 * 启动也成功、但功能静默失效"这一类问题（init 里 await 自己的 ready 导致自锁、
 * 纯 UI 插件缺 loader 行导致 client 半边从不加载）只能靠人手工发现 —— 本脚本把它们
 * 变成机械断言（2026-09-21 两次实测踩到）。
 *
 * 用法：
 *   node dev-harness/boot-check.mjs                 # 默认 --port 0（让 OS 挑空闲端口）+ 沙箱 home
 *   node dev-harness/boot-check.mjs --port 4999
 *   node dev-harness/boot-check.mjs --keep          # 失败时保留实例便于排查
 *   node dev-harness/boot-check.mjs --home ~/.dsh --profile web --no-probe
 *                                                   # 装 3080/真 home 前的预检：真 home 没有
 *                                                   # /__dev/probe（那是沙箱 home 补丁层），
 *                                                   # 故用 --no-probe 走降级模式
 *   EDGE_PATH=/path/to/chrome node dev-harness/boot-check.mjs   # 没装浏览器时的可用性降级
 *
 * 退出码：0 = 全绿；1 = 启动/探针/页面任一条断言失败（会回放日志尾部）。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, SANDBOX_WORKSPACE, fetchJson, log, waitForHttp } from '../scripts/dev-shared.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf('--' + name)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}
const PORT = Number(argOf('port', '0'))
const PROFILE = String(argOf('profile', 'devweb'))
/** DSH_HOME：默认沙箱；`--home ~/.dsh` 用于真 home 预检。 */
const HOME_DIR = String(argOf('home', join(ROOT, '.dev', 'home')))
/** 真 home 没有 /__dev/probe（沙箱 home 补丁层才有）→ 降级：跳过探针类断言。 */
const NO_PROBE = argv.includes('--no-probe')
const KEEP = argv.includes('--keep')
const NO_PAGE = argv.includes('--no-page')
const BOOT_TIMEOUT_MS = Number(argOf('timeout', '90000'))
const CDP_PORT = Number(argOf('cdp-port', '9239'))

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail === '' ? '' : '   ' + String(detail).slice(0, 240)))
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ── 平台侧：本次装进 profile 的插件清单（registry 的插件 + 其 dsh.client 声明） ── */

const registry = JSON.parse(readFileSync(join(ROOT, 'plugin-registry.json'), 'utf8'))
const profileRoot = join(HOME_DIR, 'profiles', PROFILE)
const installed = []
for (const [name, rel] of Object.entries(registry.plugins ?? {})) {
  const manifestPath = join(profileRoot, 'node_modules', name, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  installed.push({ name, rel, hasClient: manifest.dsh?.client !== undefined, hasBundle: manifest.dsh?.bundle !== undefined })
}
const clientPlugins = installed.filter((entry) => entry.hasClient).map((entry) => entry.name)

/**
 * 期望的 loader 条目：**从所有会被加载的 patch 文件里推导**，而不是猜哪个包该有行。
 * `- id: X` 紧跟 `name: Y` 才是 loader 行（finance 这类「bundle 包里装别的包」因此天然正确）。
 */
function expectedRows() {
  const profileManifest = JSON.parse(readFileSync(join(profileRoot, 'package.json'), 'utf8'))
  const bundles = profileManifest.dsh?.profile?.bundles ?? []
  const patchFiles = [
    join(ROOT, '.dev', 'home', 'cordis.patch.yml'),
    ...bundles.map((name) => join(profileRoot, 'node_modules', name, 'cordis.patch.yml')),
  ]
  const rows = new Set()
  for (const file of patchFiles) {
    if (!existsSync(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    let expectName = false
    for (const line of lines) {
      if (/^\s*-\s*id:\s*\S+/.test(line)) { expectName = true; continue }
      if (!expectName) continue
      const match = /^\s*name:\s*'?([^'\s#]+)'?/.exec(line)
      if (match !== null) { rows.add(match[1]); expectName = false; continue }
      if (/^\s*-\s*id:/.test(line)) continue
      if (/^\s*\S/.test(line) && !/^\s*(name|id|config|disabled):/.test(line)) expectName = false
    }
  }
  return [...rows]
}

/* ── 起实例（端口默认 0：让 OS 挑，避免撞上常驻 3080 / dogfood 3999 / 逃生 3998） ── */

let child = null
let hostPort = null
let ws = null
let browser = null
const output = []
const killHost = () => {
  // `spawnDsh` 走 shell：记录的 pid 常常是 shell，真宿主是它的子进程 —— 必须按**端口**找真 pid
  // （2026-09-21 实测：kill 记录的 pid 只杀掉 shell，宿主变孤儿继续占着端口）。
  if (hostPort !== null) {
    try {
      const pids = execFileSync('lsof', ['-nP', `-iTCP:${String(hostPort)}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim()
      for (const pid of pids.split('\n').filter(Boolean)) {
        try { process.kill(Number(pid), 'SIGKILL') } catch { /* 已退出 */ }
      }
    } catch { /* lsof 不可用或没有监听 */ }
  }
  if (typeof child?.pid === 'number' && child.pid > 0) {
    try { process.kill(child.pid, 'SIGKILL') } catch { /* 已经退出 */ }
  }
}

const url = await (async () => {
  log.step(`启动冒烟：dsh --profile ${PROFILE} --port ${String(PORT)} --no-open（DSH_HOME=${HOME_DIR}）`)
  const command = ['dsh', '--profile', PROFILE, '--port', String(PORT), '--no-open'].join(' ')
  child = spawn(command, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: SANDBOX_WORKSPACE,
    env: { ...process.env, DSH_HOME: HOME_DIR },
  })
  const collect = (chunk) => { output.push(chunk.toString()) }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  let found
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const match = /(http:\/\/127\.0\.0\.1:(\d+)\/\?token=[\w-]+)/.exec(output.join(''))
    if (match !== null) { found = match[1]; hostPort = Number(match[2]); break }
    if (child.exitCode !== null && child.exitCode !== undefined) break
    await sleep(400)
  }
  return found
})()

let failed = false
try {
  check('dsh 进程启动并打印带 token 的 URL', url !== undefined, url === undefined ? output.join('').split('\n').slice(-8).join(' | ') : `port=${String(hostPort)}`)
  if (url === undefined) throw new Error('宿主未在超时内打印 URL')

  const base = `http://127.0.0.1:${String(hostPort)}`
  const waitMs = Math.max(5_000, BOOT_TIMEOUT_MS - 20_000)
  let probe = null
  if (NO_PROBE) {
    log.warn('--no-probe：真 home 没有 /__dev/probe，跳过探针类断言（只验启动日志 + 页面）')
    // 退而求其次：确认 HTTP 已经能服务**带 token 的首页**。注意裸 `/` 会 401
    // （`dsh web authentication required`）—— 那是鉴权行为，不是没起来。
    const homeOk = await waitForHttp(url, { timeoutMs: waitMs }).then(() => true, () => false)
    check('宿主 HTTP 已就绪（带 token 的首页有响应）', homeOk)
    if (!homeOk) throw new Error('宿主未在超时内就绪')
  } else {
    const probeOk = await waitForHttp(`${base}/__dev/probe`, { timeoutMs: waitMs }).then(() => true, () => false)
    check('诊断探针就绪（/__dev/probe）', probeOk)
    if (!probeOk) throw new Error('探针未就绪')
    probe = await fetchJson(`${base}/__dev/probe`)
  }

  /* ① 启动不抛异常：日志 + 条目面 + 服务面 */

  const logText = output.join('')
  const fatalPatterns = [
    [/\bSyntaxError\b/, 'SyntaxError'],
    [/Dynamic require of/, 'Dynamic require（ESM 裸 require）'],
    [/duplicate (prefix )?route/, 'duplicate route'],
    [/\binit failed\b/, 'init failed'],
    [/UnhandledPromiseRejection|unhandledRejection/, '未处理的 Promise 拒绝'],
    [/Cannot find (module|package)/, 'Cannot find module'],
    [/cannot get property .* without inject/, 'without inject'],
    [/APPLY_FAILED|apply failed/, 'apply failed'],
  ]
  const hits = fatalPatterns.filter(([pattern]) => pattern.test(logText)).map(([, label]) => label)
  check('启动日志无致命异常（SyntaxError / require / duplicate route / init failed / unhandled rejection）', hits.length === 0, hits.join('、'))

  if (probe === null) {
    log.info('（--no-probe：loader 行 / 服务 / clientGraph 三条断言跳过，靠页面断言兜底）')
  } else {
  const entries = Array.isArray(probe.entries) ? probe.entries : []
  const entryNames = new Set(entries.map((entry) => String(entry.name)))
  const wantRows = expectedRows()
  const missingEntries = wantRows.filter((name) => !entryNames.has(name))
  check('patch 里声明的每个 loader 行都真的加载了', missingEntries.length === 0, missingEntries.join('、') || `${String(wantRows.length)} 行`)

  const failedEntries = entries.filter((entry) => entry.disabled !== true && entry.fiberState !== undefined && entry.fiberState !== 2)
  check('无处于失败态的插件条目（fiberState 均为已激活）', failedEntries.length === 0, JSON.stringify(failedEntries).slice(0, 200))

  const services = probe.services ?? {}
  const downServices = Object.entries(services).filter(([, up]) => up !== true).map(([name]) => name)
  check('探针报告的服务全部在线（含本次新装插件的服务）', downServices.length === 0, downServices.join('、'))

  /* ② 客户端半边真的进了模块表（纯 UI 插件缺 loader 行的静默失效就在这里现形） */

  const graphIds = (probe.clientGraph?.entries ?? []).map((entry) => String(entry.id))
  const missingClients = clientPlugins.filter((name) => !graphIds.includes(name))
  check('声明 dsh.client 的插件都进了 clientGraph', missingClients.length === 0, missingClients.join('、') || `${String(clientPlugins.length)} 个`)
  }

  if (NO_PAGE) {
    log.warn('--no-page：跳过页面断言')
  } else {
    /* ③ 页面能打开、不崩：无头浏览器导航 + 逐模块点开 */

    const browserPath = resolveBrowser()
    if (browserPath === undefined) {
      check('找到可用浏览器（EDGE_PATH 或系统 Chrome/Edge/Chromium）', false, '未找到；可用 EDGE_PATH=/path/to/chrome 指定')
    } else {
      browser = spawn(browserPath, [
        '--headless=new', '--disable-gpu', `--remote-debugging-port=${String(CDP_PORT)}`,
        '--user-data-dir=' + join(ROOT, '.dev', 'boot-check-profile'),
        '--window-size=1440,900', '--no-first-run', 'about:blank',
      ], { stdio: 'ignore' })

      let target = null
      for (let i = 0; i < 40; i += 1) {
        await sleep(500)
        try {
          const list = await (await fetch(`http://127.0.0.1:${String(CDP_PORT)}/json`)).json()
          target = list.find((entry) => entry.type === 'page')
          if (target !== undefined) break
        } catch { /* 等浏览器起来 */ }
      }
      if (target === undefined) {
        check('无头浏览器可用（CDP page target）', false)
      } else {
        ws = new WebSocket(target.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
        let id = 0
        const pending = new Map()
        const consoleErrors = []
        const exceptions = []
        ws.onmessage = (event) => {
          const message = JSON.parse(event.data)
          if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return }
          const text = JSON.stringify(message.params ?? {})
          if (text.includes('chrome-extension://')) return
          if (message.method === 'Runtime.exceptionThrown') exceptions.push(String(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? '').slice(0, 200))
          if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
            consoleErrors.push((message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 200))
          }
        }
        const send = (method, params = {}) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })) })
        const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.result?.value

        await send('Page.enable')
        await send('Runtime.enable')
        await send('Page.navigate', { url })
        await sleep(6000)

        const tabs = await evalJs("Array.from(document.querySelectorAll('.dock-tab')).map((b) => b.getAttribute('aria-label'))")
        // 精确的模块清单/标签由 real-host-check 断言（它按已知 label 逐个点）；这里只保证
        // 「页面开了、壳渲染出多个模块」，剩下的重量在下面的逐模块点击里。
        check('页面打开且 dock 模块栏渲染出多个 tab（≥3）', Array.isArray(tabs) && tabs.length >= 3, JSON.stringify(tabs))
        check('页面无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | '))
        check('页面控制台无 error', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

        if (Array.isArray(tabs)) {
          const broken = []
          for (let index = 0; index < tabs.length; index += 1) {
            await evalJs(`document.querySelectorAll('.dock-tab')[${String(index)}].click()`)
            await sleep(700)
            const state = await evalJs(`(() => {
              const head = document.querySelector('.dock-head .name')?.textContent ?? ''
              const body = (document.querySelector('.dock-body')?.textContent ?? '').replace(/\\s+/g, ' ')
              return { head: head.trim(), len: body.length, crashed: /装配失败|未加载|Application error|Something went wrong|Minified React error/i.test(body) }
            })()`)
            if (state === null || state === undefined || state.len <= 30 || state.crashed === true || state.head.length === 0) broken.push(`${String(tabs[index])}=${JSON.stringify(state)}`)
          }
          check('每个模块点开都渲染出内容且不崩', broken.length === 0, broken.slice(0, 2).join(' | '))
        }
        if (NO_PROBE && Array.isArray(tabs)) {
          // 没有 clientGraph 可读时，用模块标签兜底：我们的 locale 字典里 zh=脚本 / en=Scripts。
          const hasScriptModule = tabs.some((label) => String(label).startsWith('脚本') || String(label).startsWith('Scripts'))
          check('dock 里出现本次新装的「脚本」模块（自注册生效）', hasScriptModule, JSON.stringify(tabs))
        }
        if (exceptions.length > 0) failed = true
      }
    }
  }
} catch (error) {
  check('冒烟执行完毕', false, String(error))
} finally {
  failed = failed || checks.some((entry) => !entry.ok)
  if (ws !== null) { try { ws.close() } catch { /* 已关闭 */ } }
  if (browser !== null && KEEP !== true) { try { browser.kill() } catch { /* 已退出 */ } }
  if (KEEP !== true) killHost()
  const passed = checks.filter((entry) => entry.ok).length
  console.log(`\n启动冒烟：${String(passed)}/${String(checks.length)} 项通过`)
  if (failed) {
    console.log('\n--- 宿主日志尾部 ---')
    console.log(output.join('').split('\n').slice(-25).join('\n'))
  }
  if (KEEP && failed) log.warn(`--keep：实例保留在 ${url ?? '(未拿到 URL)'}`)
  process.exitCode = failed ? 1 : 0
}

/** 浏览器解析：EDGE_PATH > 各平台常见位置 > PATH 里的命令名（与 real-host-check 同口径）。 */
function resolveBrowser() {
  const env = process.env
  if (typeof env['EDGE_PATH'] === 'string' && env['EDGE_PATH'] !== '') return env['EDGE_PATH']
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.startsWith('/')) {
      if (existsSync(candidate)) return candidate
      continue
    }
    return candidate
  }
  for (const command of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome', 'msedge']) {
    try {
      execFileSync('which', [command], { stdio: 'ignore' })
      return command
    } catch { /* 继续找 */ }
  }
  return undefined
}
