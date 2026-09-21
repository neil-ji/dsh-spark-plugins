/**
 * 插件自有 HTTP JSON API（`/scripts/*`）—— 人面（dock pane）与脚本治理面的落点。
 *
 * 事件推送**不走 HTTP**：`scripts/changed` 由 `script/events`（typert stream）下发，
 * 见 `events.ts`。本文件只有请求-响应型端点。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ScriptService } from './script-service.ts'

const PREFIX = '/scripts'
const MAX_BODY_BYTES = 256 * 1024

interface Envelope {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string }
}

/** 注册 `/scripts` 前缀（**同一前缀只能有一个注册者**，AGENTS §4）。 */
export function registerScriptHttpRoutes(ctx: Context, service: ScriptService): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => { void handle(req, res, service) },
  }), 'script.httpRoutes')
}

async function handle(req: IncomingMessage, res: ServerResponse, service: ScriptService): Promise<void> {
  try {
    if (isTrustedBrowserRequest(req) === false) {
      send(res, 403, errorEnvelope('FORBIDDEN', 'cross-origin request rejected'))
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    const sub = url.pathname.slice(PREFIX.length)

    if (req.method === 'GET' && sub === '') {
      // 人面看**读模型**（Spec §6.5 / D10）：不含 steps，且 successRate 由宿主算好下发。
      send(res, 200, okEnvelope(await service.listSummaries(listQuery(url))))
      return
    }

    if (req.method === 'POST' && sub === '') {
      const body = await readJsonBody(req)
      const result = await service.save(body, { updatedBy: 'human' })
      if (result.kind === 'invalid') {
        send(res, 400, errorEnvelope('SCRIPT_INVALID', result.problems.join('; ')))
        return
      }
      if (result.kind === 'duplicate') {
        send(res, 200, okEnvelope({ duplicateOf: result.existing.id, record: result.existing }))
        return
      }
      send(res, 200, okEnvelope(result.record))
      return
    }

    /* 治理面（Spec §6.5）：GET 只读、POST 结算 —— 打开治理面用 POST（唯一自动动作，D7）。 */
    if (sub === '/audit' && req.method === 'GET') {
      send(res, 200, okEnvelope(await service.audit(Date.now(), { settle: false })))
      return
    }
    if (sub === '/sweep' && req.method === 'POST') {
      send(res, 200, okEnvelope(await service.audit(Date.now(), { settle: true })))
      return
    }

    if (req.method === 'POST' && /\/invoke$/.test(sub)) {
      const id = decodeURIComponent(sub.slice(1, -'/invoke'.length))
      try {
        // 人面调用不带工作区：`invokedWorkspaces` 是 agent 侧的执行证据（Spec D9）。
        send(res, 200, okEnvelope(await service.invoke(id)))
      } catch (error) {
        send(res, 404, errorEnvelope('SCRIPT_NOT_FOUND', error instanceof Error ? error.message : String(error)))
      }
      return
    }

    if (req.method === 'POST' && /\/result$/.test(sub)) {
      const id = decodeURIComponent(sub.slice(1, -'/result'.length))
      const body = await readJsonBody(req)
      const updated = await service.recordResult(id, (body as { success?: boolean }).success === true)
      send(res, updated === null ? 404 : 200, okEnvelope(updated))
      return
    }

    if (req.method === 'POST' && /\/status$/.test(sub)) {
      const id = decodeURIComponent(sub.slice(1, -'/status'.length))
      const body = await readJsonBody(req) as { status?: string; supersededBy?: string | null }
      const status = body.status
      if (status !== 'active' && status !== 'archived' && status !== 'superseded' && status !== 'candidate') {
        send(res, 400, errorEnvelope('BAD_REQUEST', 'status must be active | archived | superseded | candidate'))
        return
      }
      const supersededBy = typeof body.supersededBy === 'string' && body.supersededBy.length > 0 ? body.supersededBy : null
      // `superseded` 必须带取代者（Spec INV-11 的取代链不能断）—— service 侧抛，这里翻成 400。
      let updated
      try {
        updated = await service.setStatus(id, status, Date.now(), supersededBy)
      } catch (error) {
        send(res, 400, errorEnvelope('BAD_REQUEST', error instanceof Error ? error.message : String(error)))
        return
      }
      send(res, updated === null ? 404 : 200, okEnvelope(updated))
      return
    }

    if (req.method === 'POST' && /\/scope$/.test(sub)) {
      const id = decodeURIComponent(sub.slice(1, -'/scope'.length))
      const body = await readJsonBody(req)
      const scope = (body as { scope?: string }).scope
      if (scope !== 'global' && scope !== 'workspace' && scope !== 'project') {
        send(res, 400, errorEnvelope('BAD_REQUEST', 'scope must be global | workspace | project'))
        return
      }
      const updated = await service.setScope(id, scope)
      send(res, updated === null ? 404 : 200, okEnvelope(updated))
      return
    }

    if (req.method === 'GET' && sub.startsWith('/')) {
      const record = await service.get(decodeURIComponent(sub.slice(1)))
      send(res, record === null ? 404 : 200, okEnvelope(record))
      return
    }

    if (req.method === 'DELETE' && sub.startsWith('/')) {
      // 只有已归档条目可物理删除（Spec INV-11）。
      const removed = await service.remove(decodeURIComponent(sub.slice(1)))
      send(res, removed ? 200 : 409, okEnvelope({ removed }))
      return
    }

    send(res, 404, errorEnvelope('NOT_FOUND', 'unknown scripts endpoint'))
  } catch (error) {
    send(res, 400, errorEnvelope('BAD_REQUEST', error instanceof Error ? error.message : String(error)))
  }
}

/** 查询串 → 列表过滤条件（未知值直接丢弃，由 service 的宽松解析兜底）。 */
function listQuery(url: URL): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  const q = url.searchParams.get('q')
  if (q !== null && q.length > 0) query.q = q
  const tag = url.searchParams.get('tag')
  if (tag !== null && tag.length > 0) query.tag = tag
  const scope = url.searchParams.get('scope')
  if (scope === 'global' || scope === 'workspace' || scope === 'project') query.scope = scope
  const status = url.searchParams.get('status')
  if (status === 'active' || status === 'archived' || status === 'superseded' || status === 'candidate') query.status = status
  const limit = url.searchParams.get('limit')
  if (limit !== null && Number.isFinite(Number(limit))) query.limit = Number(limit)
  return query
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

/** 与 spark/finance 同一口径：GET/HEAD 放行，写操作要求同源。 */
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
