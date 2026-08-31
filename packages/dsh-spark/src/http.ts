/**
 * Plugin-owned HTTP API under /sparks/*.
 *
 * A third-party bundle does not edit the official api-remotes assembly, so the
 * settings page talks to this same-origin route instead of ctx.remote. Mirrors
 * dsh-hippomemo's envelope shape (`{ ok, value?, error? }`).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SparkView } from 'dsh-spark-wire'
import type { SparkService } from './spark-service.ts'

const PREFIX = '/sparks'
const MAX_BODY_BYTES = 256 * 1024

interface Envelope {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string }
}

export function registerSparkHttpRoutes(ctx: Context, service: SparkService): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => { void handle(ctx, req, res, service) },
  }), 'spark.httpRoutes')
}

async function handle(
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
    const sub = url.pathname.slice(PREFIX.length)

    if (req.method === 'GET' && sub === '/events') {
      handleEvents(ctx, req, res)
      return
    }

    if (req.method === 'GET' && sub === '/') {
      const list = await service.list(queryFromUrl(url))
      send(res, 200, okEnvelope(list))
      return
    }

    if (req.method === 'GET' && sub.startsWith('/')) {
      const id = decodeURIComponent(sub.slice(1))
      const record = await service.get(id as Parameters<typeof service.get>[0])
      send(res, record === null ? 404 : 200, okEnvelope(record))
      return
    }

    if (req.method === 'POST' && sub === '/') {
      const body = await readJsonBody(req)
      const record = await service.capture(body)
      send(res, 200, okEnvelope(record))
      return
    }

    if (req.method === 'PATCH' && sub.startsWith('/')) {
      const id = decodeURIComponent(sub.slice(1))
      const body = await readJsonBody(req)
      const record = await service.patch(id as Parameters<typeof service.patch>[0], body)
      send(res, record === null ? 404 : 200, okEnvelope(record))
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

function handleEvents(ctx: Context, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
  })
  res.write(': connected\n\n')
  const dispose = ctx.on('sparks/changed', (change) => {
    res.write('data: ' + JSON.stringify(change) + '\n\n')
  })
  req.on('close', () => { dispose() })
}

function queryFromUrl(url: URL): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  const status = url.searchParams.get('status')
  if (status === 'active' || status === 'archived') query.status = status
  const scope = url.searchParams.get('scope')
  if (scope === 'session' || scope === 'project' || scope === 'global') query.scope = scope
  const limit = url.searchParams.get('limit')
  if (limit !== null) query.limit = Number(limit)
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

/**
 * Suppress the unused-import warning on SparkView; reserved for Phase 2 when
 * the SSE payload may include a richer record type after crystallize lands.
 */
type _Reserved = SparkView
