/**
 * dev-control —— 沙箱专用的控制平面插件（永不随包发布）。
 *
 * 只做三件事，供线 1/线 2 共用同一份「场景注册表」：
 *   1. GET  /__dev/            浏览器控制面板（触发按钮 + 实时状态）
 *   2. GET  /__dev/probe       机器可读诊断（隔离证明、条目状态、HMR 事件）
 *   3. POST /__dev/scenario/<id>  执行 dev-harness/scenarios 里注册的场景
 *
 * 安全边界：只应被 .dev/home 的 home 补丁挂载（`pnpm sandbox:init` 生成），
 * 绑定 127.0.0.1；POST 必须是同源 + application/json，避免被跨站页面当表单打。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const PANEL_FILE = join(HERE, 'panel.html')

export const name = 'dev-control'
export const inject = ['webServer']

const MAX_EVENTS = 200

function ring() {
  const items = []
  return {
    push(item) {
      items.push(item)
      if (items.length > MAX_EVENTS) items.shift()
    },
    list() {
      return [...items]
    },
  }
}

function json(res, status, value) {
  const body = JSON.stringify(value, null, 1)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 同源 + JSON 内容类型校验（跨站表单无法带 application/json）。 */
function assertSameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') throw new Error('cross-site request rejected')
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin === 'string' && typeof host === 'string' && origin !== `http://${host}` && origin !== `https://${host}`) {
    throw new Error(`origin mismatch: ${origin}`)
  }
}

export function apply(ctx) {
  const events = { hmrChange: ring(), hmrReload: ring(), graph: ring(), rebuilt: ring() }
  const root = ctx.root ?? ctx

  ctx.effect(() => root.on('hmr/change', (url) => events.hmrChange.push({ at: Date.now(), url })))
  ctx.effect(() => root.on('hmr/reload', () => events.hmrReload.push({ at: Date.now() })))
  ctx.inject(['clientModules'], (clientCtx) => {
    clientCtx.effect(() => clientCtx.clientModules.onGraphChanged(() => {
      events.graph.push({ at: Date.now(), rev: clientCtx.clientModules.graph()?.rev })
    }))
    clientCtx.effect(() => clientCtx.clientModules.onRebuilt((id, rev) => {
      events.rebuilt.push({ at: Date.now(), id, rev })
    }))
  })

  const entries = () => {
    try {
      return [...root.loader.entries()].map((entry) => ({
        id: entry.options.id,
        name: entry.options.name,
        disabled: entry.disabled === true,
        fiberState: entry.fiber === undefined ? null : entry.fiber.state,
      }))
    } catch (error) {
      return [{ error: String(error) }]
    }
  }

  const services = () => {
    const names = ['hmr', 'timer', 'webServer', 'clientModules', 'loader', 'tools', 'spark', 'hippomemo', 'github', 'npm', 'finance']
    return Object.fromEntries(names.map((service) => [service, root.get(service) !== undefined]))
  }

  const clientGraph = () => {
    const modules = root.get('clientModules')
    if (modules === undefined) return null
    const graph = modules.graph()
    return {
      rev: graph?.rev,
      entries: (graph?.entries ?? []).map((entry) => ({ id: entry.id, rev: entry.rev, url: entry.url })),
    }
  }

  const probe = () => ({
    at: Date.now(),
    home: process.env['DSH_HOME'] ?? null,
    cwd: process.cwd(),
    repoRoot: REPO_ROOT,
    services: services(),
    entries: entries(),
    clientGraph: clientGraph(),
    events: {
      hmrChange: events.hmrChange.list().slice(-20),
      hmrReload: events.hmrReload.list().slice(-20),
      graph: events.graph.list().slice(-20),
      rebuilt: events.rebuilt.list().slice(-20),
    },
  })

  const scenarios = []
  const loadScenarios = async () => {
    if (scenarios.length > 0) return scenarios
    const module = await import(new URL('../scenarios/index.mjs', import.meta.url).href)
    for (const scenario of module.scenarios) scenarios.push(scenario)
    return scenarios
  }
  const host = { ctx, root, entries, probe, repoRoot: REPO_ROOT, home: process.env['DSH_HOME'] ?? null }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/__dev/',
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end()
        return
      }
      try {
        html(res, readFileSync(PANEL_FILE, 'utf8'))
      } catch (error) {
        json(res, 500, { ok: false, error: String(error) })
      }
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/__dev/probe',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405).end()
        return
      }
      json(res, 200, probe())
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/__dev/scenarios',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405).end()
        return
      }
      const list = await loadScenarios()
      json(res, 200, {
        scenarios: list.map(({ id, title, kind, description, params }) => ({ id, title, kind, description, params: params ?? [] })),
      })
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/__dev/scenario',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      try {
        assertSameOrigin(req)
        const contentType = String(req.headers['content-type'] ?? '')
        if (!contentType.startsWith('application/json')) throw new Error('content-type must be application/json')
        const id = new URL(req.url ?? '/', 'http://x').pathname.slice('/__dev/scenario/'.length)
        const list = await loadScenarios()
        const scenario = list.find((candidate) => candidate.id === id)
        if (scenario === undefined) throw new Error(`unknown scenario ${JSON.stringify(id)}`)
        const raw = await readBody(req)
        const args = raw.trim() === '' ? {} : JSON.parse(raw)
        const startedAt = Date.now()
        const result = await scenario.run(host, args)
        json(res, 200, { ok: true, id, ms: Date.now() - startedAt, result: result ?? null })
      } catch (error) {
        json(res, 400, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }))

  ctx.logger?.warn?.('[dev-control] mounted — 沙箱专用控制平面（/__dev/），不要装进正式 profile')
}
