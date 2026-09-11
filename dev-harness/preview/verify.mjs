/**
 * 零 dsh 预览自检：`pnpm preview:verify`
 *
 * 三步：
 *   1. Node 侧冒烟（tests/smoke.tsx）：真 embed 产物 + 假宿主，跑数据流 + 无 DOM 渲染；
 *   2. 起一个临时端口的预览服务器，校验 /、/preview.js、/tokens.css、/__preview/probe；
 *   3. 校验 /hippomemo/* fixture（真 fetch 路径的数据源）。
 *
 * 全部不需要 dsh、不需要浏览器、不写 profile。退出码非 0 表示有失败项。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const PORT = Number(process.env.PREVIEW_VERIFY_PORT ?? 5199)

const ALIASES = {
  'dsh-ui-kit': 'packages/dsh-ui-kit/dist/index.js',
  'dsh-spark-plugin-kit/client': 'packages/dsh-plugin-kit/lib/client/index.js',
  'dsh-spark-wire': 'packages/dsh-spark-wire/src/index.ts',
  'dsh-spark-dock/DockOverlay': 'packages/dsh-spark-dock/src/client/DockOverlay.tsx',
  'dsh-spark-dock/style': 'packages/dsh-spark-dock/src/client/style.ts',
  // ADR-003：docker 里的 npm 走真插件路径（自己的 client apply 自注册 dock 模块）；
  // 组件级单渲染画布与 Node 冒烟仍用 embed 产物（迁移完成后一起删）。
  'dsh-connector-npm-ui/client': 'packages/dsh-npm-ui/src/client/index.ts',
  'dsh-connector-npm-ui/embed': 'packages/dsh-npm-ui/lib/embed.cjs',
  'dsh-connector-github-ui/embed': 'packages/dsh-github-ui/lib/embed.cjs',
  'dsh-spark-finance-client/embed': 'packages/dsh-finance-client/lib/embed.cjs',
  'dsh-hippomemo/embed': 'packages/dsh-hippomemo/lib/embed.cjs',
}

const aliasPlugin = {
  name: 'workspace-alias',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      const target = ALIASES[args.path]
      return target === undefined ? null : { path: join(REPO_ROOT, target) }
    })
  },
}

const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

async function runSmoke() {
  const dir = await mkdtemp(join(tmpdir(), 'preview-verify-'))
  const outfile = join(dir, 'smoke.mjs')
  try {
    const result = await esbuild.build({
      entryPoints: [join(HERE, 'tests', 'smoke.tsx')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      jsx: 'automatic',
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': JSON.stringify('test') },
      // react-dom/server 的 CJS 分支会 require('stream') 等内建模块；ESM 产物里
      // 需要一个真 require 才能解析，否则 esbuild 的 __require 会抛
      // "Dynamic require of \"stream\" is not supported"。
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      plugins: [aliasPlugin],
    })
    if (result.errors.length > 0) {
      check('smoke: esbuild 打包', false, result.errors.map((error) => error.text).join('; '))
      return
    }
    const module = await import(pathToFileURL(outfile).href)
    const report = await module.run()
    for (const item of report.checks) checks.push(item)
  } catch (error) {
    check('smoke: 执行', false, String(error?.stack ?? error))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return null
}

async function runServerChecks() {
  const child = spawn(process.execPath, [join(HERE, 'server.mjs'), '--port', String(PORT), '--no-watch'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.on('data', (chunk) => { log += chunk })
  try {
    const probe = await waitForServer('http://127.0.0.1:' + PORT + '/__preview/probe')
    check('server: /__preview/probe 可用', probe !== null && probe.ok === true, probe === null ? log.slice(-400) : JSON.stringify(probe.errors))
    if (probe === null) return

    const bundle = await fetch('http://127.0.0.1:' + PORT + '/preview.js')
    const code = await bundle.text()
    check('server: /preview.js 200', bundle.ok, bundle.ok ? '' : 'status ' + bundle.status)
    const hasGithubCss = code.includes('dsh-connector-github-ui/src/client/GithubSection.module.css')
    check('server: 产物含插件 CSS（CSS Modules 已内联）', hasGithubCss, hasGithubCss ? '' : '未找到 github CSS tag')
    const hasFinance = code.includes('FinanceCard') || code.includes('financeCard')
    check('server: 产物含 finance 组件', hasFinance, hasFinance ? '' : '未找到 FinanceCard 标识')
    const bareRequire = code.match(/require\("(?!react)/)
    check('server: 产物不含裸 require 外链', bareRequire === null, bareRequire === null ? '' : '未内联：' + bareRequire[0])
    const hasShell = code.includes('pv-shell') && code.includes('零 dsh')
    check('server: 产物含预览壳', hasShell, hasShell ? '' : '未找到壳标记 pv-shell')
    const hasHippoApi = code.includes('/hippomemo/records')
    check('server: 产物含 hippomemo 真 fetch 路径', hasHippoApi, hasHippoApi ? '' : '未找到 /hippomemo/records')

    const tokens = await fetch('http://127.0.0.1:' + PORT + '/tokens.css')
    const tokensCss = await tokens.text()
    check('server: /tokens.css 提供 --spk-*', tokens.ok && tokensCss.includes('--spk-brand'), tokensCss.includes('--spk-brand') ? '' : '缺少 --spk-brand')
    check('server: /tokens.css 桥接 --dsw-*', tokensCss.includes('--dsw-alias-bg-base'), tokensCss.includes('--dsw-alias-bg-base') ? '' : '缺少 dsw 桥接')

    const page = await fetch('http://127.0.0.1:' + PORT + '/')
    const html = await page.text()
    const pageOk = page.ok && html.includes('id="root"') && html.includes('/tokens.css')
    check('server: 首页挂载点 + 令牌', pageOk, pageOk ? '' : 'status ' + page.status)

    /* hippomemo fixture（真 fetch 路径） */
    const records = await (await fetch('http://127.0.0.1:' + PORT + '/hippomemo/records?limit=50')).json()
    check('hippomemo: records 返回 ok 信封', records.ok === true && Array.isArray(records.value?.items), JSON.stringify(records).slice(0, 160))
    check('hippomemo: 有记忆条目', (records.value?.items?.length ?? 0) >= 5, 'items=' + (records.value?.items?.length ?? 0))
    const stats = await (await fetch('http://127.0.0.1:' + PORT + '/hippomemo/stats')).json()
    check('hippomemo: stats 形状完整', stats.ok === true && typeof stats.value?.total === 'number' && typeof stats.value?.byKind === 'object', JSON.stringify(stats).slice(0, 160))
    const candidates = await (await fetch('http://127.0.0.1:' + PORT + '/hippomemo/candidates')).json()
    check('hippomemo: candidates 含四类计数', candidates.ok === true && typeof candidates.value?.byKind === 'object', JSON.stringify(candidates).slice(0, 160))

    /* spark fixture（dock 的火花流 / 提议 / 脚本子页） */
    const sparks = await (await fetch('http://127.0.0.1:' + PORT + '/sparks?status=active&limit=50')).json()
    check('spark: /sparks 返回 ok 信封', sparks.ok === true && Array.isArray(sparks.value), JSON.stringify(sparks).slice(0, 160))
    check('spark: 有活跃火花', (sparks.value?.length ?? 0) >= 2, 'items=' + (sparks.value?.length ?? 0))
    const proposals = await (await fetch('http://127.0.0.1:' + PORT + '/proposals?status=pending')).json()
    check('spark: /proposals 形状完整', proposals.ok === true && Array.isArray(proposals.value) && typeof proposals.value[0]?.confidence === 'number', JSON.stringify(proposals).slice(0, 160))
    const scripts = await (await fetch('http://127.0.0.1:' + PORT + '/scripts?limit=50')).json()
    check('spark: /scripts 形状完整', scripts.ok === true && Array.isArray(scripts.value) && Array.isArray(scripts.value[0]?.steps), JSON.stringify(scripts).slice(0, 160))
    const captured = await (await fetch('http://127.0.0.1:' + PORT + '/sparks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'verify 捕获', content: '来自 preview:verify', scope: 'project', tags: ['verify'], sourceSessionId: 'spark-dock' }),
    })).json()
    check('spark: 捕获写入生效', captured.ok === true && captured.value?.title === 'verify 捕获', JSON.stringify(captured).slice(0, 160))

    const switched = await fetch('http://127.0.0.1:' + PORT + '/__preview/scenario', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'empty' }),
    })
    check('server: 场景切换接口可用', switched.ok, switched.ok ? '' : 'status ' + switched.status)
    const emptyRecords = await (await fetch('http://127.0.0.1:' + PORT + '/hippomemo/records')).json()
    check('hippomemo: empty 场景清空数据', (emptyRecords.value?.items?.length ?? -1) === 0, JSON.stringify(emptyRecords).slice(0, 160))
    await fetch('http://127.0.0.1:' + PORT + '/__preview/scenario', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'error' }),
    })
    const failed = await (await fetch('http://127.0.0.1:' + PORT + '/hippomemo/records')).json()
    check('hippomemo: error 场景返回失败信封', failed.ok === false && typeof failed.error?.message === 'string', JSON.stringify(failed).slice(0, 160))
  } finally {
    child.kill()
  }
}

await runSmoke()
await runServerChecks()

const width = Math.max(...checks.map((item) => item.name.length))
let failed = 0
for (const item of checks) {
  if (!item.ok) failed += 1
  console.log((item.ok ? '  ok   ' : '  FAIL ') + item.name.padEnd(width) + (item.detail === '' ? '' : '   ' + item.detail))
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' 项通过' + (failed === 0 ? '' : '，' + failed + ' 项失败'))
process.exit(failed === 0 ? 0 : 1)
