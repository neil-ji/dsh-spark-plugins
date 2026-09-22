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
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { cssModulesPlugin } from './bundler.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const PORT = Number(process.env.PREVIEW_VERIFY_PORT ?? 5199)

/** 预览/冒烟唯一允许的 react 大版本（与仓库根 devDependencies 对齐）。 */
const EXPECTED_REACT = '18'

const ALIASES = {
  'dsh-ui-kit': 'packages/dsh-ui-kit/dist/index.js',
  'dsh-spark-plugin-kit/client': 'packages/dsh-plugin-kit/lib/client/index.js',
  'dsh-spark-wire': 'packages/dsh-spark-wire/src/index.ts',
  'dsh-script-wire': 'packages/dsh-script-wire/src/index.ts',
  'dsh-script-client/client': 'packages/dsh-script-client/src/client/index.ts',
  'dsh-spark-dock/DockOverlay': 'packages/dsh-spark-dock/src/client/DockOverlay.tsx',
  'dsh-spark-dock/style': 'packages/dsh-spark-dock/src/client/style.ts',
  // W4：Node 冒烟也跑真 client 入口的 apply（配 inject 门），这样
  // 「忘了声明 inject / 注册不上槽位」在无浏览器的情况下也能被抓到。
  'dsh-spark-dock/client': 'packages/dsh-spark-dock/src/client/index.ts',
  'dsh-connector-github-ui/client': 'packages/dsh-github-ui/src/client/index.ts',
  'dsh-spark-finance-client/client': 'packages/dsh-finance-client/src/client/index.ts',
  'dsh-hippomemo/client': 'packages/dsh-hippomemo/src/client/index.ts',
  'dsh-connector-wire': 'packages/dsh-github-wire/src/index.ts',
  'dsh-connector-npm-wire': 'packages/dsh-npm-wire/src/index.ts',
  'dsh-spark-finance-wire': 'packages/dsh-finance-wire/src/index.ts',
  'dsh-connector-npm-ui/client': 'packages/dsh-npm-ui/src/client/index.ts',
  // 组件级画布 / 冒烟吃 `*/embed`，P4 之后它只是源码 barrel（无构建产物）。
  'dsh-connector-npm-ui/embed': 'packages/dsh-npm-ui/src/client/embed.ts',
  'dsh-connector-github-ui/embed': 'packages/dsh-github-ui/src/client/embed.ts',
  'dsh-spark-finance-client/embed': 'packages/dsh-finance-client/src/client/embed.ts',
  'dsh-hippomemo/embed': 'packages/dsh-hippomemo/src/client/embed.ts',
}

/**
 * React 必须是**仓库根这一份**。
 *
 * 各包自己的 `node_modules` 里可能装着另一个大版本（实测
 * `packages/dsh-hippomemo/node_modules/react` = 19.2.8，根 = 18.3.1），
 * 而 esbuild 默认按**导入文件所在包**解析依赖 —— 于是 Node 冒烟里出现
 * 「React 19 的 jsx-runtime 造元素 + React 18 的 renderToString 渲染」，
 * `useState` 读到 null dispatcher，hippomemo 面板整块渲染不出来（不是它的 bug，
 * 是预览打包把两份 react 装进了同一个进程）。这里把 react / react-dom
 * 的入口显式钉到根，两个口径共用同一份。
 */
const REACT_PACKAGES = ['react', 'react-dom']
const rootRequire = createRequire(join(REPO_ROOT, 'package.json'))

/** 解析根 `node_modules` 里的包入口（优先子路径，退回包主入口）。 */
function resolveRootReact(request) {
  try {
    return rootRequire.resolve(request)
  } catch {
    const [name] = request.split('/')
    return rootRequire.resolve(name)
  }
}

const aliasPlugin = {
  name: 'workspace-alias',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      const direct = ALIASES[args.path]
      if (direct !== undefined) return { path: join(REPO_ROOT, direct) }
      for (const name of REACT_PACKAGES) {
        if (args.path === name || args.path.startsWith(name + '/')) {
          return { path: resolveRootReact(args.path) }
        }
      }
      return null
    })
  },
}

const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

/**
 * 防回归：预览只允许一份 react。
 *
 * 2026-09-17 实测：`packages/dsh-hippomemo/node_modules/react` 被装成 19.2.8，
 * esbuild 按导入文件所在包解析 → 同一个 Node 进程里 React 19 的 jsx-runtime 造元素、
 * React 18 的 renderToString 渲染，`useState` 读到 null dispatcher，
 * hippomemo 面板整块渲染不出来。这里把「根 react 的版本」变成一条显式断言，
 * 免得下次某个包改依赖后又静默分叉。
 */
function checkReactVersion() {
  try {
    const entry = rootRequire.resolve('react/package.json')
    const version = String(JSON.parse(readFileSync(entry, 'utf8')).version)
    check(
      'smoke: 预览只用根 react 一份（版本 ' + EXPECTED_REACT + '.x）',
      version.startsWith(EXPECTED_REACT + '.'),
      '根 react 版本 = ' + version,
    )
  } catch (error) {
    check('smoke: 根 react 可解析', false, String(error))
  }
}

async function runSmoke() {
  checkReactVersion()
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
      // 组件级画布与冒烟都改吃 src/client/embed.ts 源码 barrel（P4 删掉了 embed.cjs），
      // 所以 Node 侧也要内联 CSS Modules —— 与 server.mjs 共用同一个插件。
      plugins: [aliasPlugin, cssModulesPlugin('preview-verify', REPO_ROOT)],
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
    const hasFinance = code.includes('FinancePanel') || code.includes('FinancePanelController')
    check('server: 产物含 finance 面板', hasFinance, hasFinance ? '' : '未找到 FinancePanel 标识')
    // SPEC §10 回归线：额度触达与窗口归因必须真进产物（不是只存在于源码）。
    const hasQuotaWindow = code.includes('finance-quota-window') && code.includes('QuotaWindowCard')
    check('server: 产物含额度窗口归因卡（SPEC §10）', hasQuotaWindow, hasQuotaWindow ? '' : '未找到 finance-quota-window / QuotaWindowCard')
    // SPEC §10.5 修订（2026-09-21）：额度触达明细仍在详情弹窗（`finance-quota-hits-`），
// 但表内 pill 与 `quotaAttemptsNote`（「N 次断供 · M 次失败尝试」）已随布局修复退役
// —— 摘要行改用 pill 原先的三态文案。所以这里只钉"明细列表进了产物"。
    const hasQuotaHits = code.includes('finance-quota-hits-')
    check('server: 产物含额度触达明细（SPEC §10.5）', hasQuotaHits, hasQuotaHits ? '' : '未找到 finance-quota-hits-')
    // 错峰卡改为 100% 堆叠条（2026-09-20）：产物必须带 StackedBar 的 testid 与类名。
    const hasStacked = code.includes('stacked-slice-') && code.includes('stackedTrack')
    check('server: 产物含错峰 100% 堆叠条', hasStacked, hasStacked ? '' : '未找到 stacked-slice- / stackedTrack')
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
    const search = await (await fetch('http://127.0.0.1:' + PORT + '/sparks/search?q=' + encodeURIComponent('预览数据源') + '&limit=5')).json()
    check('spark: /sparks/search 返回相关火花（真引擎 selectRelevant）', search.ok === true && Array.isArray(search.value), JSON.stringify(search).slice(0, 160))
    const searchMiss = await (await fetch('http://127.0.0.1:' + PORT + '/sparks/search?q=zzzznomatchzzz')).json()
    check('spark: /sparks/search 无匹配返回空数组（不是全量兜底）', searchMiss.ok === true && Array.isArray(searchMiss.value) && searchMiss.value.length === 0, JSON.stringify(searchMiss).slice(0, 160))
    const proposals = await (await fetch('http://127.0.0.1:' + PORT + '/proposals?status=pending')).json()
    check('spark: /proposals 形状完整', proposals.ok === true && Array.isArray(proposals.value) && typeof proposals.value[0]?.confidence === 'number', JSON.stringify(proposals).slice(0, 160))
    /* 脚本沉淀库：读模型（不含 steps）+ 治理面（真引擎算的建议）—— Spec §6.5 / A8 */
    const scripts = await (await fetch('http://127.0.0.1:' + PORT + '/scripts?limit=50')).json()
    check(
      'script: /scripts 是读模型（带 stepCount + 宿主算的 successRate，且**不含 steps**）',
      scripts.ok === true
        && Array.isArray(scripts.value)
        && scripts.value.length >= 5
        && typeof scripts.value[0]?.stepCount === 'number'
        && typeof scripts.value[0]?.successRate === 'number'
        && scripts.value[0]?.steps === undefined,
      JSON.stringify(scripts).slice(0, 200),
    )
    check(
      'script: 读模型的 successRate 与计数自洽（1/6 ≈ 0.167，不是 UI 现算的）',
      scripts.value.some((item) => item.id === 'scr-retire-me' && Math.abs(item.successRate - 1 / 6) < 1e-9),
      JSON.stringify(scripts.value.map((item) => [item.id, item.successRate])).slice(0, 200),
    )

    /* 检索（Spec §5.4/A9）：q 的匹配与排序**必须与宿主同源**（预览直接 import 真 `matchScore`），
       所以这里断的是"searchTerms 真的能搜到"这件事本身，而不是预览自己的一套近似。 */
    const byEnglishTerm = await (await fetch('http://127.0.0.1:' + PORT + '/scripts?q=' + encodeURIComponent('smoke test'))).json()
    check(
      'script: 英文同义词（searchTerms）能搜到（F1 的死字段修复）',
      byEnglishTerm.ok === true && byEnglishTerm.value?.length === 1 && byEnglishTerm.value[0]?.id === 'scr-preview-verify',
      JSON.stringify(byEnglishTerm.value?.map((item) => item.id)),
    )
    // 中文检索词只出现在 searchTerms 里（名字/描述都不含），命中即证明索引面真的接上了。
    const byChineseTerm = await (await fetch('http://127.0.0.1:' + PORT + '/scripts?q=' + encodeURIComponent('旧构建诀窍'))).json()
    check(
      'script: 中文检索词也能搜到（双语同义词的意义所在）',
      byChineseTerm.ok === true && byChineseTerm.value?.length === 1 && byChineseTerm.value[0]?.id === 'scr-retire-me',
      JSON.stringify(byChineseTerm.value?.map((item) => item.id)),
    )
    // 同一条查询里：`scr-preview-verify` 命中 name(4)+searchTerms(2)=6，
    // 而「跑预览自检」那对只在 name 上命中(4)—— 加权让前者排在前面（字段权重真的生效）。
    const weighted = await (await fetch('http://127.0.0.1:' + PORT + '/scripts?q=' + encodeURIComponent('预览自检'))).json()
    check(
      'script: 检索词加权生效（name+searchTerms 命中排在仅 name 命中之前）',
      weighted.ok === true
        && weighted.value?.length >= 2
        && weighted.value[0]?.id === 'scr-preview-verify'
        && weighted.value.some((item) => item.id === 'scr-dup-keep'),
      JSON.stringify(weighted.value?.map((item) => item.id)),
    )
    const noMatch = await (await fetch('http://127.0.0.1:' + PORT + '/scripts?q=' + encodeURIComponent('绝不可能出现的词'))).json()
    check('script: 无匹配返回空数组（不是全量兜底）', noMatch.ok === true && noMatch.value?.length === 0, JSON.stringify(noMatch.value))

    const auditBefore = await (await fetch('http://127.0.0.1:' + PORT + '/scripts/audit')).json()
    const kinds = (auditBefore.value?.advices ?? []).map((advice) => advice.kind)
    check(
      'script: 只读审计不结算（archived 0 且过期条目还没被归档）',
      auditBefore.ok === true && auditBefore.value?.archived === 0
        && (auditBefore.value?.stats?.byStatus?.archived ?? 0) === 1,
      JSON.stringify(auditBefore.value?.stats?.byStatus),
    )
    check(
      'script: 四类治理建议都由真引擎算出（退役 / 僵尸 / 降级 / 合并）',
      ['retire', 'zombie', 'downgrade-scope', 'merge-duplicate'].every((kind) => kinds.includes(kind)),
      JSON.stringify(kinds),
    )
    check(
      'script: 建议只带病据数字、不带句子（宿主不下发用户可见文案）',
      (auditBefore.value?.advices ?? []).every((advice) => advice.detail === undefined
        && typeof advice.evidence?.invocationCount === 'number'
        && typeof advice.evidence?.workspaces === 'number'),
      JSON.stringify(auditBefore.value?.advices?.[0]).slice(0, 200),
    )
    check(
      'script: 合并建议指向留存者（较新的那条被建议并掉）',
      (auditBefore.value?.advices ?? []).some((advice) => advice.id === 'merge-duplicate:scr-dup-lose->scr-dup-keep'),
      JSON.stringify((auditBefore.value?.advices ?? []).map((advice) => advice.id)),
    )
    check(
      'script: 审计统计含分档与验收占比（口径在宿主，UI 不重算）',
      auditBefore.value?.stats?.rateBuckets?.high >= 1
        && auditBefore.value?.stats?.rateBuckets?.low >= 1
        && auditBefore.value?.stats?.rateBuckets?.untested >= 1
        && typeof auditBefore.value?.stats?.acceptance?.ratio === 'number',
      JSON.stringify(auditBefore.value?.stats).slice(0, 240),
    )

    const swept = await (await fetch('http://127.0.0.1:' + PORT + '/scripts/sweep', { method: 'POST' })).json()
    check(
      'script: POST /scripts/sweep 结算过期条目（唯一自动动作）',
      swept.ok === true && swept.value?.archived === 1
        && (swept.value?.stats?.byStatus?.archived ?? 0) === 2,
      JSON.stringify(swept.value?.stats?.byStatus),
    )
    const sweptAgain = await (await fetch('http://127.0.0.1:' + PORT + '/scripts/sweep', { method: 'POST' })).json()
    check('script: 重复结算幂等（第二次 0）', sweptAgain.value?.archived === 0, JSON.stringify(sweptAgain.value?.archived))

    const detail = await (await fetch('http://127.0.0.1:' + PORT + '/scripts/scr-preview-verify')).json()
    check(
      'script: GET /scripts/:id 给全文步骤（人面看步骤的通道，不计量）',
      detail.ok === true && Array.isArray(detail.value?.steps) && detail.value.steps.length === 3,
      JSON.stringify(detail).slice(0, 160),
    )

    const merged = await (await fetch('http://127.0.0.1:' + PORT + '/scripts/scr-dup-lose/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'superseded', supersededBy: 'scr-dup-keep' }),
    })).json()
    check(
      'script: 合并动作走 /status + supersededBy（取代链不能断）',
      merged.ok === true && merged.value?.status === 'superseded' && merged.value?.supersededBy === 'scr-dup-keep',
      JSON.stringify(merged).slice(0, 160),
    )
    const brokenChain = await fetch('http://127.0.0.1:' + PORT + '/scripts/scr-dup-keep/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'superseded' }),
    })
    check('script: 不带 supersededBy 的取代被拒（400）', brokenChain.status === 400, 'status=' + String(brokenChain.status))

    const downgraded = await (await fetch('http://127.0.0.1:' + PORT + '/scripts/scr-global-one-ws/scope', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'workspace' }),
    })).json()
    check(
      'script: 降级动作走 /scope（global → workspace）',
      downgraded.ok === true && downgraded.value?.scope === 'workspace',
      JSON.stringify(downgraded).slice(0, 160),
    )

    const purgedActive = await fetch('http://127.0.0.1:' + PORT + '/scripts/scr-sandbox-up', { method: 'DELETE' })
    check('script: 未归档条目禁止物理删除（409）', purgedActive.status === 409, 'status=' + String(purgedActive.status))
    const purged = await (await fetch('http://127.0.0.1:' + PORT + '/scripts/scr-archived', { method: 'DELETE' })).json()
    check('script: 已归档条目可物理删除', purged.ok === true && purged.value?.removed === true, JSON.stringify(purged).slice(0, 160))
    const captured = await (await fetch('http://127.0.0.1:' + PORT + '/sparks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'verify 捕获', content: '来自 preview:verify', scope: 'project', tags: ['verify'], sourceSessionId: 'spark-dock' }),
    })).json()
    check('spark: 捕获写入生效', captured.ok === true && captured.value?.title === 'verify 捕获', JSON.stringify(captured).slice(0, 160))

    // W4 保真（F14）：真宿主的 capture schema 要求 sourceSessionId；预览此前给默认值，
    // 「客户端漏传必填字段」这类回归到真宿主才 400。现在预览同样拒绝。
    const rejected = await fetch('http://127.0.0.1:' + PORT + '/sparks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '缺必填', content: '没有 sourceSessionId' }),
    })
    const rejectedBody = await rejected.json()
    check(
      'spark: 漏传 sourceSessionId 返回 400 BAD_REQUEST（与真宿主同）',
      rejected.status === 400 && rejectedBody.ok === false && rejectedBody.error?.code === 'BAD_REQUEST' && String(rejectedBody.error?.message).includes('sourceSessionId'),
      'status=' + rejected.status + ' ' + JSON.stringify(rejectedBody).slice(0, 160),
    )

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
