/**
 * SparkService: host-side orchestration over a SparkStorage backend.
 *
 * The service is the single source of truth for sparks on the host plane.
 * It validates input with the wire schemas, persists via the storage backend,
 * and emits a `sparks/changed` cordis event after every mutation so future
 * subsystems (HTTP SSE in Phase 4, DMN emergence engine in Phase 4) can hook in
 * without coupling to the storage layer.
 */
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  sparkCaptureSchema,
  sparkListQuerySchema,
  sparkPatchSchema,
  sparkViewSchema,
  type SparkView,
  type SparkCapture,
  type SparkPatch,
  type SparkListQuery,
  type SparkId,
} from 'dsh-spark-wire'
import { JsonlSparkStorage } from './storage.ts'
import { registerSparkHttpRoutes } from './http.ts'
import type { SparkChangedEvent, SparkRecordId, SparkStorage } from './types.ts'
import { deriveTitle } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    spark: SparkService
  }
  interface Events {
    'sparks/changed'(change: SparkChangedEvent): void
  }
}

export interface SparkConfig {
  /** Override the JSONL file path. Defaults to $DSH_HOME/storages/sparks.jsonl. */
  filePath?: string
  /** Maximum sparks kept in storage. Older archived sparks are pruned past this. */
  maxRecords?: number
}

const DEFAULT_MAX_RECORDS = 5000

function defaultFilePath(): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'sparks.jsonl')
}

function makeId(): SparkRecordId {
  // Phase 1: use randomUUID; Phase 2+ may swap in ULID for time-orderable ids.
  return randomUUID() as SparkRecordId
}

export class SparkService extends Service {
  static inject = ['webServer'] as const

  private readonly filePath: string
  private readonly maxRecords: number
  private storage: SparkStorage
  private httpRegistered = false

  constructor(ctx: Context, config: SparkConfig = {}) {
    super(ctx, 'spark')
    this.filePath = config.filePath ?? defaultFilePath()
    this.maxRecords = config.maxRecords ?? DEFAULT_MAX_RECORDS
    this.storage = new JsonlSparkStorage(this.filePath)
    this.ensureDir()
      .then(() => this.ensureRegistered(ctx))
      .catch(error => {
        ctx.logger?.error?.('spark: init failed: ' + String(error))
      })
  }

  private async ensureDir(): Promise<void> {
    const dir = this.filePath.replace(/[/][^/]+$/, '')
    await fs.mkdir(dir, { recursive: true })
  }

  private ensureRegistered(ctx: Context): void {
    if (this.httpRegistered) return
    registerSparkHttpRoutes(ctx, this)
    this.httpRegistered = true
  }

  /** Capture a new spark. Validates input with the wire schema. */
  async capture(input: unknown, now: number = Date.now()): Promise<SparkView> {
    const parsed: SparkCapture = sparkCaptureSchema.parse(input)
    const record: SparkView = sparkViewSchema.parse({
      id: makeId(),
      title: deriveTitle(parsed.title),
      content: parsed.content,
      scope: parsed.scope,
      workspacePath: parsed.workspacePath,
      status: 'active',
      tags: parsed.tags,
      sourceSessionId: parsed.sourceSessionId,
      sourceAgentId: parsed.sourceAgentId,
      sourceTurn: parsed.sourceTurn,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    })
    await this.storage.append(record)
    await this.enforceLimit()
    this.ctx.emit('sparks/changed', { operation: 'capture', id: record.id, record, at: now })
    return record
  }

  async list(input: unknown = {}): Promise<SparkView[]> {
    const query: SparkListQuery = sparkListQuerySchema.parse(input)
    const all = await this.storage.readAll()
    let filtered = all
    if (query.status !== undefined) filtered = filtered.filter(r => r.status === query.status)
    if (query.scope !== undefined) filtered = filtered.filter(r => r.scope === query.scope)
    filtered.sort((a, b) => b.createdAt - a.createdAt)
    return filtered.slice(0, query.limit)
  }

  async get(id: SparkId): Promise<SparkView | null> {
    const all = await this.storage.readAll()
    return all.find(r => r.id === id) ?? null
  }

  async patch(id: SparkId, input: unknown, now: number = Date.now()): Promise<SparkView | null> {
    const patch: SparkPatch = sparkPatchSchema.parse(input)
    const merged = await this.storage.patch(id, patch, now)
    if (merged === null) return null
    const operation = patch.status === 'archived' ? 'archive' : 'patch'
    this.ctx.emit('sparks/changed', { operation, id, record: merged, at: now })
    return merged
  }

  async remove(id: SparkId, now: number = Date.now()): Promise<boolean> {
    const removed = await this.storage.remove(id)
    if (!removed) return false
    this.ctx.emit('sparks/changed', { operation: 'delete', id, record: null, at: now })
    return true
  }

  /** Test-only: swap the storage backend. */
  setStorageForTest(storage: SparkStorage): void {
    this.storage = storage
  }

  /** Trim oldest archived records when over the cap. */
  private async enforceLimit(): Promise<void> {
    const all = await this.storage.readAll()
    if (all.length <= this.maxRecords) return
    // Keep newest maxRecords overall (active first, then by createdAt desc).
    const ordered = [...all].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1
      return b.createdAt - a.createdAt
    })
    const keep = new Set(ordered.slice(0, this.maxRecords).map(r => r.id))
    for (const record of all) {
      if (!keep.has(record.id)) await this.storage.remove(record.id)
    }
  }
}
