/**
 * Plugin-owned HTTP API under /hippomemo/*.
 *
 * A third-party bundle does not edit the official api-remotes assembly, so the
 * settings page talks to this same-origin route instead of ctx.remote.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { MemoryService } from './memory-service.ts'
import type {
  CitationListQuery, MemoryListQuery, MemoryPatchInput, MemoryPutInput, PreferenceListQuery,
} from './types.ts'

const PREFIX = '/hippomemo'
const MAX_BODY_BYTES = 256 * 1024

interface Envelope {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string }
}

export function registerHippomemoHttpRoutes(ctx: Context, service: MemoryService): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => { void handle(req, res, service) },
  }), 'hippomemo.httpRoutes')
}

async function handle(req: IncomingMessage, res: ServerResponse, service: MemoryService): Promise<void> {
  try {
    if (isTrustedBrowserRequest(req) === false) {
      send(res, 403, errorEnvelope('FORBIDDEN', 'cross-origin request rejected'))
      return
    }

    const url = new URL(req.url ?? '/', 'http://x')
    const sub = url.pathname.slice(PREFIX.length)

    if (req.method === 'GET' && sub === '/events') {
      handleEvents(req, res, service)
      return
    }

    if (req.method === 'GET' && sub === '/stats') {
      send(res, 200, okEnvelope(service.stats()))
      return
    }

    // v3 UI: preference zone (live, read-only). The query mirrors the
    // PreferenceListQuery shape; empty values are treated as undefined.
    if (req.method === 'GET' && sub === '/preferences') {
      const query = preferenceQueryFromUrl(url)
      send(res, 200, okEnvelope(service.preferences(query)))
      return
    }

    // v3 UI: live candidate list (F11 dry-run semantics over the active set).
    if (req.method === 'GET' && sub === '/candidates') {
      send(res, 200, okEnvelope(service.candidates()))
      return
    }

    // v3 UI: brain-strip narration row (F10-light fallback).
    if (req.method === 'GET' && sub === '/narrative') {
      send(res, 200, okEnvelope(service.recallNarrative()))
      return
    }

    if (req.method === 'GET' && sub === '/usage') {
      send(res, 200, okEnvelope(service.usage()))
      return
    }

    if (req.method === 'GET' && sub === '/citations') {
      send(res, 200, okEnvelope(service.citations(citationQueryFromUrl(url))))
      return
    }

    if (req.method === 'GET' && sub === '/tags') {
      send(res, 200, okEnvelope(service.tags()))
      return
    }

    if (req.method === 'GET' && sub === '/records') {
      send(res, 200, okEnvelope(service.list(listQueryFromUrl(url))))
      return
    }

    if (req.method === 'GET' && sub.startsWith('/records/')) {
      const id = decodeURIComponent(sub.slice('/records/'.length))
      const record = service.get(id)
      send(res, record === undefined ? 404 : 200, okEnvelope(record ?? null))
      return
    }

    if (req.method === 'POST' && sub === '/records') {
      const body = await readJsonBody(req)
      send(res, 200, okEnvelope(await service.put(body as MemoryPutInput)))
      return
    }

    if (req.method === 'PATCH' && sub.startsWith('/records/')) {
      const id = decodeURIComponent(sub.slice('/records/'.length))
      const body = await readJsonBody(req)
      send(res, 200, okEnvelope(await service.update(id, body as MemoryPatchInput)))
      return
    }

    if (req.method === 'DELETE' && sub.startsWith('/records/')) {
      const id = decodeURIComponent(sub.slice('/records/'.length))
      send(res, 200, okEnvelope(await service.delete(id)))
      return
    }

    send(res, 404, errorEnvelope('NOT_FOUND', 'unknown hippomemo endpoint'))
  } catch (error) {
    send(res, 400, errorEnvelope('BAD_REQUEST', error instanceof Error ? error.message : String(error)))
  }
}

function handleEvents(req: IncomingMessage, res: ServerResponse, service: MemoryService): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
  })
  res.write(': connected\n\n')
  const unsubscribe = service.subscribe((change) => {
    res.write('data: ' + JSON.stringify(change) + '\n\n')
  })
  req.on('close', () => { unsubscribe() })
}

function listQueryFromUrl(url: URL): MemoryListQuery {
  const query: MemoryListQuery = {}
  const q = url.searchParams.get('q')
  if (q !== null && q.length > 0) query.q = q
  const kind = url.searchParams.get('kind')
  if (kind !== null) query.kind = kind as MemoryListQuery['kind']
  const scope = url.searchParams.get('scope')
  if (scope !== null) query.scope = scope as MemoryListQuery['scope']
  const status = url.searchParams.get('status')
  if (status !== null) query.status = status as MemoryListQuery['status']
  const tag = url.searchParams.get('tag')
  if (tag !== null && tag.length > 0) query.tag = tag
  const modelId = url.searchParams.get('modelId')
  if (modelId !== null && modelId.length > 0) query.modelId = modelId
  const workspacePath = url.searchParams.get('workspacePath')
  if (workspacePath !== null && workspacePath.length > 0) query.workspacePath = workspacePath
  const sort = url.searchParams.get('sort')
  if (sort !== null) query.sort = sort as MemoryListQuery['sort']
  const order = url.searchParams.get('order')
  if (order !== null) query.order = order as MemoryListQuery['order']
  const limit = url.searchParams.get('limit')
  if (limit !== null) query.limit = Number(limit)
  const cursor = url.searchParams.get('cursor')
  if (cursor !== null) query.cursor = Number(cursor)
  return query
}

function preferenceQueryFromUrl(url: URL): PreferenceListQuery {
  const query: PreferenceListQuery = {}
  const floor = url.searchParams.get('decayFloor')
  if (floor !== null) {
    const parsed = Number(floor)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) query.decayFloor = parsed
  }
  const source = url.searchParams.get('source')
  if (source === 'auto' || source === 'manual') query.source = source
  return query
}

function citationQueryFromUrl(url: URL): CitationListQuery {
  const query: CitationListQuery = {}
  const memoryId = url.searchParams.get('memoryId')
  if (memoryId !== null && memoryId.length > 0) query.memoryId = memoryId
  const kind = url.searchParams.get('kind')
  if (kind === 'id-ref' || kind === 'title-ref' || kind === 'link') query.kind = kind
  const limit = url.searchParams.get('limit')
  if (limit !== null) query.limit = Number(limit)
  const cursor = url.searchParams.get('cursor')
  if (cursor !== null) query.cursor = Number(cursor)
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
