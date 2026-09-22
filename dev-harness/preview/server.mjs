/**
 * 零 dsh 组件预览服务器（LOCAL-DEV-HARNESS 线 1 的最小落地版）。
 *
 * 目标：**机器上不需要任何 dsh 安装、不写任何 profile**，只靠本仓库的
 * node_modules + 各包已构建的 `lib/embed.cjs` 产物，就能在浏览器里看真插件 UI。
 *
 * 组成：
 *   1. esbuild 把 src/main.tsx 打成单文件 ESM（react 从仓库根 node_modules 内联）；
 *   2. 静态服务 index.html / preview.css / dsh-ui-kit 的 tokens.css；
 *   3. 假宿主 API：/hippomemo/* 返回 fixture（真 fetch 路径，无需改插件代码）；
 *   4. /__preview/probe 机器可读状态 + /__preview/events SSE 自动刷新。
 *
 * 用法：
 *   node dev-harness/preview/server.mjs [--port 5180] [--source] [--no-watch] [--open]
 *   --source  从 packages/*​/src/client/embed.ts 打包（免构建，日常改码最快）
 *   默认      从 packages/*​/lib/embed.cjs 打包（真产物，验收口径）
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { cssModulesPlugin } from './bundler.mjs'
import { createHippoStore } from './fixtures/hippomemo.mjs'
import { createSparkStore } from './fixtures/sparks.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')

const argv = process.argv.slice(2)
const has = (name) => argv.includes('--' + name)
const value = (name, fallback) => {
  const index = argv.indexOf('--' + name)
  if (index === -1) return fallback
  const next = argv[index + 1]
  return next === undefined || next.startsWith('--') ? true : next
}

const PORT = Number(value('port', 5180))
const HOST = String(value('host', '127.0.0.1'))
const MODE = has('source') ? 'source' : 'bundle'
const WATCH = !has('no-watch')
const OPEN = has('open')

/** dock 的源码模块：dock 没有 ./embed 入口（它的产物是 ModuleLoader 包装的
 *  client.js），预览直接吃它的源码组件 + 复刻 client 入口的装配。 */
const DOCK_MODULES = {
  'dsh-spark-dock/DockOverlay': 'packages/dsh-spark-dock/src/client/DockOverlay.tsx',
  'dsh-spark-dock/style': 'packages/dsh-spark-dock/src/client/style.ts',
  // 事件契约（帧 schema + typert 描述符）：dock 与 mock 都要它，源码口径直接吃 src。
  'dsh-spark-wire': 'packages/dsh-spark-wire/src/index.ts',
  'dsh-script-wire': 'packages/dsh-script-wire/src/index.ts',
  // 财务 remote 契约（P5 单源）：host 注册与 client $mount 共用同一份描述符 +
  // Zod 边界 schema，两种口径都吃源码（wire 是主源码，无构建期生成物）。
  'dsh-spark-finance-wire': 'packages/dsh-finance-wire/src/index.ts',
}

/** 组件级画布用的 `…/embed` 源码 barrel（P4：不再是构建产物，两种口径同一份）。 */
const EMBED_BARRELS = {
  'dsh-connector-github-ui/embed': 'packages/dsh-github-ui/src/client/embed.ts',
  'dsh-connector-npm-ui/embed': 'packages/dsh-npm-ui/src/client/embed.ts',
  'dsh-spark-finance-client/embed': 'packages/dsh-finance-client/src/client/embed.ts',
  'dsh-hippomemo/embed': 'packages/dsh-hippomemo/src/client/embed.ts',
}

/** 真产物口径：插件自带的 embed 库入口（自包含，只有 react 是外部依赖）。 */
const BUNDLE_ALIASES = {
  ...DOCK_MODULES,
  'dsh-spark-plugin-kit/client': 'packages/dsh-plugin-kit/lib/client/index.js',
  'dsh-ui-kit': 'packages/dsh-ui-kit/dist/index.js',
  // ADR-003：dock 与六个模块都由各自的 client 入口注册 —— 真产物口径吃
  // lib/client.js（带 ModuleLoader 壳，由 clientBundleShim 在预览里剥壳）。
  'dsh-spark-dock/client': 'packages/dsh-spark-dock/lib/client.js',
  'dsh-connector-github-ui/client': 'packages/dsh-github-ui/lib/client.js',
  'dsh-connector-npm-ui/client': 'packages/dsh-npm-ui/lib/client.js',
  'dsh-spark-finance-client/client': 'packages/dsh-finance-client/lib/client.js',
  'dsh-hippomemo/client': 'packages/dsh-hippomemo/lib/client.js',
  'dsh-script-client/client': 'packages/dsh-script-client/lib/client.js',
  // 组件级画布（非 Dock 画布）吃的 `…/embed`：P4 之后它只是**源码 barrel**
  // （产品里不存在 embed 产物），两种口径都指向同一个 src 文件。
  ...EMBED_BARRELS,
}

/** 源码口径：直接吃 src/client/embed.ts，改码免构建。 */
const SOURCE_ALIASES = {
  ...DOCK_MODULES,
  'dsh-spark-plugin-kit/client': 'packages/dsh-plugin-kit/src/client/index.ts',
  // ui-kit 的 src/styles/tokens.mjs 是构建期生成的，源码口径仍指向 dist。
  'dsh-ui-kit': 'packages/dsh-ui-kit/dist/index.js',
  // 源码口径下 client 入口直接吃 src（无需 ModuleLoader 壳）。
  'dsh-spark-dock/client': 'packages/dsh-spark-dock/src/client/index.ts',
  'dsh-connector-npm-ui/client': 'packages/dsh-npm-ui/src/client/index.ts',
  'dsh-connector-github-ui/client': 'packages/dsh-github-ui/src/client/index.ts',
  'dsh-spark-finance-client/client': 'packages/dsh-finance-client/src/client/index.ts',
  'dsh-hippomemo/client': 'packages/dsh-hippomemo/src/client/index.ts',
  'dsh-script-client/client': 'packages/dsh-script-client/src/client/index.ts',
  ...EMBED_BARRELS,
}

const PACKAGE_NAME = 'preview'

// CSS Modules 内联插件与 verify.mjs 的 Node 冒烟共用（见 bundler.mjs）。

/**
 * 需要「剥 ModuleLoader 壳」的入口（ADR-003）：插件 client 半边在真宿主里由
 * client-modules 加载，产物形如 `window.__ModuleLoader__.load({ id, factory })`。
 * 预览没有 loader，所以在虚拟模块里执行产物文本、接住 load 调用、用 react 真模块
 * 喂 factory，再把 exports 转成 ESM 再导出 —— 这样预览吃到的就是**真产物**。
 * dock 也走同一条路径（它自己的 client 入口在预览里被真 apply）。
 */
const MODULE_LOADER_ENTRIES = new Set([
  'dsh-spark-dock/client',
  'dsh-script-client/client',
  'dsh-connector-github-ui/client',
  'dsh-connector-npm-ui/client',
  'dsh-spark-finance-client/client',
  'dsh-hippomemo/client',
])

const clientBundleShim = () => ({
  name: 'client-bundle-shim',
  setup(build) {
    build.onLoad({ filter: /.*/, namespace: 'client-bundle' }, (args) => {
      const text = readFileSync(args.path, 'utf8')
      return {
        loader: 'js',
        contents: [
          "import * as __react from 'react'",
          "import * as __jsx from 'react/jsx-runtime'",
          'const __entries = []',
          'const __global = globalThis',
          '__global.window = __global.window ?? __global',
          '__global.window.__ModuleLoader__ = { load: (entry) => { __entries.push(entry) } }',
          'const __table = { react: __react, "react/jsx-runtime": __jsx }',
          '(0, eval)(' + JSON.stringify(text) + ')',
          'const __entry = __entries[0]',
          'if (__entry === undefined) throw new Error("client bundle did not register with __ModuleLoader__")',
          'const __exports = __entry.factory((id) => __table[id])',
          'export const apply = __exports.apply',
          'export const inject = __exports.inject',
        ].join('\n'),
      }
    })
  },
})

/**
 * react 必须只用仓库根那一份。
 *
 * 各包自己的 node_modules 可能装着另一个大版本（实测
 * `packages/dsh-hippomemo/node_modules/react` = 19.2.8，根 = 18.3.1），
 * esbuild 默认按**导入文件所在包**解析依赖 —— 源码口径（--source）下组件级画布会拿到
 * React 19 的 jsx-runtime，而壳/产物口径是 React 18，同一个页面两份 react
 * （Node 冒烟里的表现是 `useState` 读到 null dispatcher）。
 * 与 verify.mjs 同一份处置：显式钉到根。
 */
const REACT_PACKAGES = ['react', 'react-dom']
const rootRequire = createRequire(join(REPO_ROOT, 'package.json'))
function resolveRootReact(request) {
  try {
    return rootRequire.resolve(request)
  } catch {
    return rootRequire.resolve(request.split('/')[0])
  }
}

/** 把仓库内工作区包名指到真实文件（根 node_modules 不 link 工作区包）。 */
const aliasPlugin = (map) => ({
  name: 'workspace-alias',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      for (const name of REACT_PACKAGES) {
        if (args.path === name || args.path.startsWith(name + '/')) {
          return { path: resolveRootReact(args.path) }
        }
      }
      const target = map[args.path]
      if (target === undefined) return null
      if (MODULE_LOADER_ENTRIES.has(args.path)) {
        return { path: join(REPO_ROOT, target), namespace: 'client-bundle' }
      }
      return { path: join(REPO_ROOT, target) }
    })
  },
})

const bundleState = { code: null, errors: [], version: 0, builtAt: 0 }
const clients = new Set()

function notify() {
  for (const res of clients) {
    try { res.write('data: ' + bundleState.version + '\n\n') } catch { clients.delete(res) }
  }
}

const capturePlugin = () => ({
  name: 'capture-output',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        bundleState.errors = result.errors.map((error) => ({
          text: error.text,
          location: error.location === null || error.location === undefined ? null : {
            file: relative(REPO_ROOT, error.location.file).replace(/\\/g, '/'),
            line: error.location.line,
            column: error.location.column,
          },
        }))
        notify()
        return
      }
      const file = result.outputFiles.find((output) => output.path.endsWith('.js')) ?? result.outputFiles[0]
      if (file === undefined) return
      bundleState.code = file.text
      bundleState.errors = []
      bundleState.version += 1
      bundleState.builtAt = Date.now()
      notify()
    })
  },
})

const buildOptions = {
  entryPoints: [join(HERE, 'src', 'main.tsx')],
  // context API 下 write:false 会把产物标成 <stdout>，显式给 outfile 便于取回。
  outfile: 'preview.js',
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: 'inline',
  // esbuild 默认把非 ASCII 转义成 \uXXXX（体积更大、调试更难读）；预览页是 UTF-8，直接原样输出。
  charset: 'utf8',
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"development"' },
  // react 单例：工作区各包经 pnpm 各自解析 react（root 18.x / ui-kit 18.2 …），
  // 多副本会以 "Cannot read properties of null (reading 'useState')" 的形式爆掉。
  // 全部钉到仓库根的 react，保证 dispatcher 只有一份。
  alias: {
    react: join(REPO_ROOT, 'node_modules', 'react'),
    'react-dom': join(REPO_ROOT, 'node_modules', 'react-dom'),
  },
  plugins: [
    aliasPlugin(MODE === 'source' ? SOURCE_ALIASES : BUNDLE_ALIASES),
    clientBundleShim(),
    // ADR-003 之后组件级画布吃 src/client/embed.ts 源码 barrel（不再有 embed.cjs
    // 预构建产物），两种口径都要内联 CSS Modules。
    cssModulesPlugin(PACKAGE_NAME, REPO_ROOT),
    capturePlugin(),
  ],
}

const context = await esbuild.context(buildOptions)
if (WATCH) await context.watch()
else await context.rebuild()

if (bundleState.errors.length > 0) {
  console.error('[preview] 首次构建失败：')
  for (const error of bundleState.errors) console.error('  ' + error.text)
  process.exitCode = 1
}

const hippo = createHippoStore()
const spark = createSparkStore()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

const json = (res, status, value) => send(res, status, JSON.stringify(value, null, 1), MIME['.json'])

async function serveFile(res, path, fallbackType) {
  try {
    const body = await readFile(path)
    send(res, 200, body, MIME[extname(path)] ?? fallbackType ?? 'application/octet-stream')
    return true
  } catch {
    return false
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/** 同源校验：只接受本机预览页发起的 POST。 */
function assertSameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') throw new Error('cross-site request rejected')
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin === 'string' && typeof host === 'string'
    && origin !== 'http://' + host && origin !== 'https://' + host) {
    throw new Error('origin mismatch: ' + origin)
  }
}

/**
 * hippomemo 侧的假载波（同样 harness 专属）：产品宿主自 2026-09（ADR-001）起不再暴露
 * `/hippomemo/events`，记忆变更统一走 `ctx.remote.hippomemo.events()`。
 * 这里扮演物理载波，`src/mock/streams.ts` 把帧按产品契约喂给插件代码。
 */
const hippoStreamClients = new Set()

function subscribeHippoStream(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
  res.write(': connected\n\n')
  hippoStreamClients.add(res)
  const timer = setInterval(() => { try { res.write(': keepalive\n\n') } catch { /* closed */ } }, 15_000)
  req.on('close', () => { clearInterval(timer); hippoStreamClients.delete(res) })
}

function broadcastHippo(change) {
  const frame = 'data: ' + JSON.stringify(change) + '\n\n'
  for (const res of hippoStreamClients) {
    try { res.write(frame) } catch { hippoStreamClients.delete(res) }
  }
}

// F11 commit: `/finance/events` SSE 通道对应客户端
// `ctx.remote.finance.events()` 的物理载波。预览里没有真实 backfill，
// 连接建立后立即推一条 `phase: 'done'` 的 progress 帧，模拟"首次打开
// 且没有历史 session"的最简路径；产品契约要求客户端拿到 ready 基线帧
// 之后能继续读到 progress 帧，所以即便空跑也要按格式 emit。
const financeStreamClients = new Set()

function subscribeFinanceStream(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
  res.write(': connected\n\n')
  financeStreamClients.add(res)
  // 即时推一条 done 帧（无需 keepalive：客户端 ready 基线之后立刻收到）
  const startedAt = Date.now()
  try {
    res.write('data: ' + JSON.stringify({
      kind: 'progress',
      payload: { phase: 'done', scanned: 0, total: 0, rescanned: 0, startedAt },
      at: Date.now(),
    }) + '\n\n')
  } catch { /* closed before flush */ }
  req.on('close', () => { financeStreamClients.delete(res) })
}

async function handleHippomemo(req, res, url) {
  const path = url.pathname
  const method = req.method ?? 'GET'
  const body = method === 'POST' || method === 'PATCH' ? JSON.parse((await readBody(req)) || '{}') : {}

  /** 真宿主信封：{ok:true,value} 或 {ok:false,error}（error 场景必须原样透出）。 */
  const envelope = (value) => {
    if (value !== null && typeof value === 'object' && value.ok === false && value.error !== undefined) {
      return json(res, 200, value)
    }
    return json(res, 200, { ok: true, value })
  }

  if (path === '/hippomemo/events') {
    return subscribeHippoStream(req, res)
  }
  if (path === '/finance/events') {
    return subscribeFinanceStream(req, res)
  }
  if (path === '/hippomemo/records' && method === 'GET') return envelope(hippo.list(url.searchParams))
  if (path === '/hippomemo/records' && method === 'POST') {
    const result = hippo.create(body)
    broadcastHippo({ operation: 'put', id: result?.id ?? result?.value?.id ?? 'unknown' })
    return envelope(result)
  }
  if (path.startsWith('/hippomemo/records/')) {
    const id = decodeURIComponent(path.slice('/hippomemo/records/'.length))
    if (method === 'GET') return envelope(hippo.get(id))
    if (method === 'PATCH') {
      const result = hippo.update(id, body)
      broadcastHippo({ operation: 'put', id })
      return envelope(result)
    }
    if (method === 'DELETE') {
      const result = hippo.remove(id)
      broadcastHippo({ operation: 'deleted', id })
      return envelope(result)
    }
  }
  if (path === '/hippomemo/stats') return envelope(hippo.stats())
  if (path === '/hippomemo/tags') return envelope(hippo.tags())
  if (path === '/hippomemo/usage') return envelope(hippo.usage())
  if (path === '/hippomemo/citations') return envelope(hippo.citations(url.searchParams))
  if (path === '/hippomemo/preferences') return envelope(hippo.preferences(url.searchParams))
  if (path === '/hippomemo/candidates') return envelope(hippo.candidates())
  if (path === '/hippomemo/narrative') return envelope(hippo.narrative())
  if (path === '/hippomemo/evolve/last') return envelope(hippo.evolveLast())
  if (path === '/hippomemo/evolve' && method === 'POST') return envelope(hippo.evolve(body.dryRun !== false))
  return json(res, 404, { ok: false, error: { code: 'not-found', message: path } })
}

/**
 * spark 侧三条 SSE 流的订阅者表（sparks / proposals / scripts）。
 *
 * **这些端点是 harness 专属的「假载波」**：产品宿主自 2026-09（ADR-001）起不再暴露
 * `/sparks|/proposals|/scripts/events`，领域事件统一走 `spark.events()`（typert stream
 * 跑在 remote mux 上）。预览没有 dsh 进程，于是由这里扮演物理载波：
 * `src/mock/streams.ts` 把这些帧按产品契约（ready 基线 + 变更帧）喂给插件代码，
 * 插件侧看到的仍是 `ctx.remote.spark.events()`。
 */
const sparkStreamClients = new Map()

function subscribeSparkStream(path, req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
  res.write(': connected\n\n')
  let set = sparkStreamClients.get(path)
  if (set === undefined) { set = new Set(); sparkStreamClients.set(path, set) }
  set.add(res)
  const timer = setInterval(() => { try { res.write(': keepalive\n\n') } catch { /* closed */ } }, 15_000)
  req.on('close', () => { clearInterval(timer); set.delete(res) })
}

function broadcastSpark(path, change) {
  const set = sparkStreamClients.get(path)
  if (set === undefined) return
  const frame = 'data: ' + JSON.stringify(change) + '\n\n'
  for (const res of set) {
    try { res.write(frame) } catch { set.delete(res) }
  }
}

/**
 * 与真宿主同形的状态码映射：契约校验失败 = 400（`http.ts` 的 BAD_REQUEST），
 * 找不到 = 404，其余业务错误沿用 200 + 失败信封（预览的既有口径）。
 */
const statusFor = (error) => {
  const code = error?.code
  if (code === 'BAD_REQUEST') return 400
  if (code === 'not-found' || code === 'NOT_FOUND') return 404
  return 200
}

/** spark 侧：dock 的火花流 / 涌现提议 / 脚本目录（同样是真 fetch 路径）。 */
async function handleSpark(req, res, url) {
  const path = url.pathname
  const method = req.method ?? 'GET'
  const body = method === 'POST' || method === 'PATCH' ? JSON.parse((await readBody(req)) || '{}') : {}

  if (path === '/sparks/events' || path === '/proposals/events' || path === '/scripts/events') {
    return subscribeSparkStream(path, req, res)
  }
  if (path === '/sparks' && method === 'GET') return json(res, 200, spark.list(url.searchParams))
  // 必须排在 /sparks/:id 之前：否则 /stats 会被当成一个火花 id（与真宿主 http.ts 同序）。
  if (path === '/sparks/stats' && method === 'GET') return json(res, 200, spark.stats())
  // 只读检索（v2 P13）：同样必须排在 /sparks/:id 之前。
  if (path === '/sparks/search' && method === 'GET') return json(res, 200, spark.search(url.searchParams))
  if (path === '/sparks/derive' && method === 'POST') return json(res, 200, spark.derive(body))
  if (path === '/sparks' && method === 'POST') {
    const result = spark.capture(body)
    if (result.ok === true) broadcastSpark('/sparks/events', { operation: 'capture', id: result.value.id, record: result.value, at: Date.now() })
    return json(res, result.ok === true ? 200 : statusFor(result.error), result)
  }
  if (path.startsWith('/sparks/')) {
    const rest = path.slice('/sparks/'.length)
    if (rest.endsWith('/reactivate') && method === 'POST') {
      const id = decodeURIComponent(rest.slice(0, -'/reactivate'.length))
      const result = spark.reactivate(id)
      if (result.ok === true) broadcastSpark('/sparks/events', { operation: 'state', id, record: result.value, at: Date.now() })
      return json(res, result.ok === true ? 200 : statusFor(result.error), result)
    }
    if (rest.endsWith('/restore') && method === 'POST') {
      const id = decodeURIComponent(rest.slice(0, -'/restore'.length))
      const result = spark.restore(id)
      if (result.ok === true) broadcastSpark('/sparks/events', { operation: 'restore', id, record: result.value, at: Date.now() })
      return json(res, result.ok === true ? 200 : statusFor(result.error), result)
    }
    if (method === 'PATCH') {
      const id = decodeURIComponent(rest)
      const result = spark.patch(id, body)
      if (result.ok === true) {
        broadcastSpark('/sparks/events', { operation: 'state', id, record: result.value, at: Date.now() })
      }
      return json(res, result.ok === true ? 200 : statusFor(result.error), result)
    }
    if (method === 'DELETE') {
      const id = decodeURIComponent(rest)
      const result = spark.remove(id)
      if (result.ok === true) broadcastSpark('/sparks/events', { operation: 'delete', id, record: null, at: Date.now() })
      return json(res, result.ok === true ? 200 : statusFor(result.error), result)
    }
  }
  if (path === '/proposals' && method === 'GET') return json(res, 200, spark.proposals(url.searchParams))
  if (path === '/proposals/reflect' && method === 'POST') {
    const result = spark.reflect()
    if (result.ok === true) broadcastSpark('/proposals/events', { at: Date.now(), newProposals: [], resolvedProposal: null })
    return json(res, 200, result)
  }
  if (path.startsWith('/proposals/') && path.endsWith('/resolve') && method === 'POST') {
    const result = spark.resolveProposal(decodeURIComponent(path.slice('/proposals/'.length, -'/resolve'.length)), body.status)
    if (result.ok === true) broadcastSpark('/proposals/events', { at: Date.now(), newProposals: [], resolvedProposal: result.value })
    return json(res, 200, result)
  }
  /* 脚本沉淀库：读模型 / 审计（治理面）/ 动作端点，与真宿主 `dsh-script` 的 HTTP 面同形。 */
  if (path === '/scripts' && method === 'GET') return json(res, 200, spark.scripts(url.searchParams))
  if (path === '/scripts/audit' && method === 'GET') return json(res, 200, spark.scriptAudit(false))
  if (path === '/scripts/sweep' && method === 'POST') {
    const result = spark.scriptAudit(true)
    if (result.ok === true && result.value.archived > 0) {
      broadcastSpark('/scripts/events', { at: Date.now(), operation: 'expire', id: null })
    }
    return json(res, 200, result)
  }
  const scriptAction = /^\/scripts\/([^/]+)\/(invoke|status|scope)$/.exec(path)
  if (scriptAction !== null && method === 'POST') {
    const id = decodeURIComponent(scriptAction[1])
    const action = scriptAction[2]
    const result = action === 'invoke' ? spark.invokeScript(id)
      : action === 'status' ? spark.setScriptStatus(id, body.status, body.supersededBy ?? null)
        : spark.setScriptScope(id, body.scope)
    const operation = action === 'invoke' ? 'invoke' : action === 'status' ? 'status' : 'status'
    if (result.ok === true) broadcastSpark('/scripts/events', { at: Date.now(), operation, id })
    return json(res, result.ok === true ? 200 : result.error.code === 'not-found' ? 404 : 400, result)
  }
  if (path.startsWith('/scripts/') && method === 'GET') {
    const result = spark.scriptDetail(decodeURIComponent(path.slice('/scripts/'.length)))
    return json(res, result.ok === true ? 200 : 404, result)
  }
  if (path.startsWith('/scripts/') && method === 'DELETE') {
    const result = spark.removeScript(decodeURIComponent(path.slice('/scripts/'.length)))
    return json(res, result.ok === true ? 200 : 409, result)
  }
  return json(res, 404, { ok: false, error: { code: 'not-found', message: path } })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://' + (req.headers.host ?? HOST + ':' + PORT))
  const path = url.pathname

  try {
    if (path.startsWith('/hippomemo/')) return await handleHippomemo(req, res, url)
    if (path.startsWith('/sparks') || path.startsWith('/proposals') || path.startsWith('/scripts')) {
      return await handleSpark(req, res, url)
    }

    if (path === '/__preview/probe') {
      return json(res, 200, {
        ok: bundleState.errors.length === 0,
        mode: MODE,
        watch: WATCH,
        port: PORT,
        buildVersion: bundleState.version,
        builtAt: bundleState.builtAt,
        errors: bundleState.errors,
        scenario: hippo.scenario,
        plugins: [
          { id: 'dock', entry: 'dsh-spark-dock/src/client/DockOverlay.tsx', api: '模拟 dsh web 外壳 + 真悬浮球/面板' },
          { id: 'github', entry: 'dsh-connector-github-ui/embed', api: 'mock remote.github + remote.credentials' },
          { id: 'npm', entry: 'dsh-connector-npm-ui/embed', api: 'mock remote.npm + remote.credentials' },
          { id: 'finance', entry: 'dsh-spark-finance-client/embed', api: 'mock remote.finance + settingsScope(finance)' },
          { id: 'hippomemo', entry: 'dsh-hippomemo/embed', api: 'HTTP /hippomemo/* fixture' },
          { id: 'ui-kit', entry: 'dsh-ui-kit', api: 'none (pure components)' },
        ],
      })
    }

    if (path === '/__preview/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write('retry: 300\n\n')
      res.write('data: ' + bundleState.version + '\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }

    if (path === '/__preview/scenario' && req.method === 'POST') {
      assertSameOrigin(req)
      const payload = JSON.parse((await readBody(req)) || '{}')
      hippo.setScenario(payload.scenario ?? 'ok')
      spark.setScenario(payload.scenario ?? 'ok')
      return json(res, 200, { ok: true, scenario: hippo.scenario })
    }

    if (path === '/__preview/rebuild' && req.method === 'POST') {
      assertSameOrigin(req)
      await context.rebuild()
      return json(res, 200, { ok: bundleState.errors.length === 0, version: bundleState.version, errors: bundleState.errors })
    }

    if (path === '/' || path === '/index.html') {
      if (await serveFile(res, join(HERE, 'index.html'))) return
    }
    if (path === '/preview.css') {
      if (await serveFile(res, join(HERE, 'src', 'preview.css'))) return
    }
    if (path === '/tokens.css') {
      const tokenPath = MODE === 'source'
        ? join(REPO_ROOT, 'packages', 'dsh-ui-kit', 'src', 'styles', 'tokens.css')
        : join(REPO_ROOT, 'packages', 'dsh-ui-kit', 'dist', 'styles', 'tokens.css')
      const source = MODE === 'source'
        ? ['base.css', 'spark-tokens.css', 'dsw-bridge.css']
        : null
      if (source === null) {
        if (await serveFile(res, tokenPath, MIME['.css'])) return
      } else {
        const parts = []
        for (const name of source) parts.push(await readFile(join(REPO_ROOT, 'packages', 'dsh-ui-kit', 'src', 'styles', name), 'utf8'))
        return send(res, 200, parts.join('\n'), MIME['.css'])
      }
    }
    if (path === '/preview.js') {
      if (bundleState.code === null) return send(res, 503, '// preview bundle unavailable', MIME['.js'])
      return send(res, 200, bundleState.code, MIME['.js'])
    }

    return json(res, 404, { ok: false, error: { code: 'not-found', message: path } })
  } catch (error) {
    return json(res, 500, { ok: false, error: { code: 'preview', message: String(error?.message ?? error) } })
  }
})

server.listen(PORT, HOST, () => {
  const url = 'http://' + HOST + ':' + PORT + '/'
  console.log('[preview] 零 dsh 组件预览已启动')
  console.log('  地址      ' + url)
  console.log('  模式      ' + MODE + (MODE === 'source' ? '（插件 client 入口源码）' : '（lib/client.js 真产物 + 组件级画布源码 barrel）'))
  console.log('  监听      ' + (WATCH ? '开（改码自动重建 + 页面自动刷新）' : '关'))
  console.log('  探针      ' + url + '__preview/probe')
  if (bundleState.errors.length > 0) console.log('  构建错误  ' + bundleState.errors.length + ' 条，见探针')
  if (OPEN) {
    try {
      const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
      spawn(command, args, { stdio: 'ignore', detached: true }).unref()
    } catch { /* 打不开就手动点链接 */ }
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { void context.dispose().then(() => server.close(() => process.exit(0))) })
}
