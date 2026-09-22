/**
 * Plugin-owned HTTP API under /sparks/* and /proposals/*.（脚本的 /scripts 已随脚本沉淀库迁出，见 docs/SCRIPT-LIBRARY-SPEC.md）
 *
 * 2026-09（ADR-001）：**事件不再走 HTTP**。原先这里注册三条 SSE 端点
 * （`/sparks|/proposals|/scripts/events`），与 hippomemo 那条各自实现一遍流式与
 * 载荷；现在统一由 `spark.events()`（typert stream，单一 mux 载波、逐项 schema
 * 校验、可取消）下发，见 `events.ts`。本文件只剩「请求-响应」型 JSON API。
 *
 * 2026-09-21：注册入口按**服务归属**拆分 —— 同前缀重复注册会被平台 webserver
 * 硬失败（`webserver: duplicate prefix route "/x"`），而这类抛错若落在某个 init()
 * 的 try 里，会在后续步骤之前**静默中断**（实测踩过，见 AGENTS §4）。
 * 现况：/sparks + /proposals 归 SparkService（本文件），/scripts 已随脚本沉淀库
 * 迁到独立插件 `dsh-script`（docs/SCRIPT-LIBRARY-SPEC.md）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SparkView, ProposalView } from 'dsh-spark-wire'
import type { SparkService, SparkNotFoundError } from './spark-service.ts'
import type { EmergeService } from './emerge-service.ts'

const PREFIX_SPARKS = '/sparks'
const PREFIX_PROPOSALS = '/proposals'
const MAX_BODY_BYTES = 256 * 1024

interface Envelope {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string }
}

/** /sparks + /proposals —— 由 SparkService 注册（唯一注册者）。 */
export function registerSparkHttpRoutes(ctx: Context, service: SparkService): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX_SPARKS,
    handler: (req, res) => { void handleSparks(ctx, req, res, service) },
  }), 'spark.httpRoutes')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX_PROPOSALS,
    handler: (req, res) => { void handleProposals(ctx, req, res, service) },
  }), 'proposals.httpRoutes')
}

async function handleSparks(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  service: SparkService,
): Promise<void> {
  try {
    if (isTrustedBrowserRequest(req) === false) {
      send(res, 403, errorEnvelope('FORBIDDEN', 'cross-origin request rejected'))
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    const sub = url.pathname.slice(PREFIX_SPARKS.length)

    if (req.method === 'GET' && sub === '') {
      const list = await service.list(queryFromUrl(url))
      send(res, 200, okEnvelope(list))
      return
    }
    // 必须排在「按 id 取」之前：否则 /stats 会被当成一个火花 id。
    if (req.method === 'GET' && sub === '/stats') {
      send(res, 200, okEnvelope(await service.stats(await pendingProposalCount(ctx))))
      return
    }
    // 必须排在「按 id 取」之前（同 /stats 的理由）。
    if (req.method === 'GET' && sub === '/graph') {
      const query: Record<string, unknown> = {}
      const limit = url.searchParams.get('limit')
      if (limit !== null) query.limit = Number(limit)
      const tagMinShared = url.searchParams.get('tagMinShared')
      if (tagMinShared !== null) query.tagMinShared = Number(tagMinShared)
      send(res, 200, okEnvelope(await service.graph(await listProposals(ctx), query)))
      return
    }
    // 只读检索（v2 P13）：必须排在「按 id 取」之前，否则 /search 会被当成一个 id。
    if (req.method === 'GET' && sub === '/search') {
      const q = url.searchParams.get('q') ?? ''
      const limitStr = url.searchParams.get('limit')
      const limit = limitStr === null ? 5 : Math.max(1, Math.min(50, Number(limitStr) || 5))
      send(res, 200, okEnvelope(await service.search(q, limit)))
      return
    }
    if (req.method === 'GET' && sub.startsWith('/')) {
      const id = decodeURIComponent(sub.slice(1))
      const record = await service.get(id as Parameters<typeof service.get>[0])
      send(res, record === null ? 404 : 200, okEnvelope(record))
      return
    }
    // 衍生（v2 §5）：写在库里的动作，走 POST。必须排在 /:id 之前。
    if (req.method === 'POST' && sub === '/derive') {
      const body = await readJsonBody(req).catch(() => ({}))
      send(res, 200, okEnvelope(await ctx.derive.run(body)))
      return
    }
    if (req.method === 'POST' && sub === '') {
      const body = await readJsonBody(req)
      const record = await service.capture(body)
      send(res, 200, okEnvelope(record))
      return
    }
    if (req.method === 'POST' && /\/reactivate$/.test(sub)) {
      const id = decodeURIComponent(sub.slice(1, -'/reactivate'.length))
      const record = await service.reactivate(id as Parameters<typeof service.reactivate>[0])
      send(res, record === null ? 404 : 200, okEnvelope(record))
      return
    }
    if (req.method === 'POST' && /\/restore$/.test(sub)) {
      const id = decodeURIComponent(sub.slice(1, -'/restore'.length))
      const record = await service.restore(id as Parameters<typeof service.restore>[0])
      send(res, record === null ? 404 : 200, okEnvelope(record))
      return
    }
    if (req.method === 'PATCH' && sub.startsWith('/')) {
      const id = decodeURIComponent(sub.slice(1))
      const body = await readJsonBody(req)
      const record = await service.patch(id as Parameters<typeof service.patch>[0], body)
      send(res, record === null ? 404 : 200, okEnvelope(record))
      return
    }
    if (req.method === 'POST' && /\/purge$/.test(sub)) {
      // 物理删除（不可恢复）：UI「丢弃」的落点，二次确认在客户端。
      const id = decodeURIComponent(sub.slice(1, -'/purge'.length))
      const removed = await service.purge(id as Parameters<typeof service.purge>[0])
      send(res, removed ? 200 : 404, okEnvelope({ removed }))
      return
    }
    if (req.method === 'DELETE' && sub.startsWith('/')) {
      const id = decodeURIComponent(sub.slice(1))
      const removed = await service.remove(id as Parameters<typeof service.remove>[0])
      send(res, removed ? 200 : 404, okEnvelope({ removed }))
      return
    }
    send(res, 404, errorEnvelope('NOT_FOUND', 'unknown spark endpoint'))
  } catch (error) {
    send(res, 400, errorEnvelope('BAD_REQUEST', error instanceof Error ? error.message : String(error)))
  }
}

async function handleProposals(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  _service: SparkService,
): Promise<void> {
  try {
    if (isTrustedBrowserRequest(req) === false) {
      send(res, 403, errorEnvelope('FORBIDDEN', 'cross-origin request rejected'))
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    const sub = url.pathname.slice(PREFIX_PROPOSALS.length)
    const emerge = ctx.emerge as EmergeService

    if (req.method === 'GET' && sub === '') {
      const status = url.searchParams.get('status') ?? undefined
      const type = url.searchParams.get('type') ?? undefined
      const limitStr = url.searchParams.get('limit')
      const limit = limitStr !== null ? Number(limitStr) : 100
      const all = await emerge.list()
      let filtered = all
      if (status === 'pending' || status === 'accepted' || status === 'dismissed') {
        filtered = filtered.filter(p => p.status === status)
      }
      if (type === 'link' || type === 'cluster' || type === 'prune') {
        filtered = filtered.filter(p => p.type === type)
      }
      filtered = filtered.slice(0, Number.isFinite(limit) ? limit : 100)
      send(res, 200, okEnvelope(filtered))
      return
    }

    if (req.method === 'POST' && sub === '/reflect') {
      const body = await readJsonBody(req).catch(() => ({}))
      const result = await emerge.reflect(body)
      send(res, 200, okEnvelope(result))
      return
    }

    if (req.method === 'POST' && /\/resolve$/.test(sub)) {
      const id = decodeURIComponent(sub.slice(1, -'/resolve'.length))
      const body = await readJsonBody(req)
      const status = (body as { status?: string }).status
      if (status !== 'accepted' && status !== 'dismissed') {
        send(res, 400, errorEnvelope('BAD_REQUEST', 'status must be accepted or dismissed'))
        return
      }
      const updated = await emerge.resolve(id, status)
      send(res, updated === null ? 404 : 200, okEnvelope(updated))
      return
    }

    send(res, 404, errorEnvelope('NOT_FOUND', 'unknown proposals endpoint'))
  } catch (error) {
    send(res, 400, errorEnvelope('BAD_REQUEST', error instanceof Error ? error.message : String(error)))
  }
}

const SPARK_STATUSES = ['active', 'archived'] as const

function queryFromUrl(url: URL): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  const status = url.searchParams.get('status')
  if (status !== null && (SPARK_STATUSES as readonly string[]).includes(status)) query.status = status
  const scope = url.searchParams.get('scope')
  if (scope === 'session' || scope === 'project' || scope === 'global') query.scope = scope
  if (url.searchParams.get('includeDeleted') === 'true') query.includeDeleted = true
  const limit = url.searchParams.get('limit')
  if (limit !== null) query.limit = Number(limit)
  return query
}

/** 全部提议（图谱的关联边来源）；emerge 不可用时按空表处理。 */
async function listProposals(ctx: Context): Promise<readonly ProposalView[]> {
  try {
    const emerge = ctx.emerge as EmergeService | undefined
    if (emerge === undefined) return []
    return await emerge.list()
  } catch {
    return []
  }
}

/** 待决提议数；emerge 服务不可用时按 0 处理（统计端点不该因为它的缺失而 500）。 */
async function pendingProposalCount(ctx: Context): Promise<number> {
  try {
    const emerge = ctx.emerge as EmergeService | undefined
    if (emerge === undefined) return 0
    const all = await emerge.list()
    return all.filter(p => p.status === 'pending').length
  } catch {
    return 0
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] ?? ''
    if (contentType.includes('application/json') === false) {
      reject(new Error('Content-Type must be application/json'))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function isTrustedBrowserRequest(req: IncomingMessage): boolean {
  const method = req.method ?? 'GET'
  if (method === 'GET' || method === 'HEAD') return true
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string') return true
  const host = req.headers.host
  if (typeof host !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function okEnvelope(value: unknown): Envelope {
  return { ok: true, value }
}

function errorEnvelope(code: string, message: string): Envelope {
  return { ok: false, error: { code, message } }
}

function send(res: ServerResponse, status: number, body: Envelope): void {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function errorStatusFor(error: unknown): number {
  if (error instanceof Object && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (code === 'SPARK_NOT_FOUND') return 404
    if (code === 'SPARK_STORE_CONFLICT') return 409
  }
  return 400
}

/** Reserved types for future phases. */
type _Reserved = SparkView | ProposalView | SparkNotFoundError
