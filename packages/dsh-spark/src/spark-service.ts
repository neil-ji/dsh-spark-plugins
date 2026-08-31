/**
 * SparkService: host-side orchestration over a SparkStorage backend.
 *
 * The service is the single source of truth for sparks on the host plane.
 * It validates input with the wire schemas, persists via the storage backend,
 * and emits a `sparks/changed` cordis event after every mutation so future
 * subsystems (HTTP SSE in Phase 4, DMN emergence engine in Phase 4) can hook in
 * without coupling to the storage layer.
 *
 * Phase 2 adds `crystallize`: a one-way bridge from spark to HippoMemo
 * MemoryRecord. The bridge is structurally typed (no hard import of
 * dsh-hippomemo) so the spark plugin stays a peer of hippomemo, not a
 * transitive dependency. If ctx.memory is absent, crystallize throws
 * SPARK_HIPPO_UNAVAILABLE — sparks still capture/list/archive/delete fine
 * without hippomemo installed.
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
  sparkCrystallizeSchema,
  type SparkView,
  type SparkCapture,
  type SparkPatch,
  type SparkListQuery,
  type SparkCrystallize,
  type SparkCrystallized,
  type SparkId,
} from 'dsh-spark-wire'
import { JsonlSparkStorage } from './storage.ts'
import { registerSparkHttpRoutes } from './http.ts'
import type { SparkChangedEvent, SparkRecordId, SparkStorage, HippoPutInput } from './types.ts'
import { buildHippoInputFromSpark, deriveTitle } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    spark: SparkService
  }
  interface Events {
    'sparks/changed'(change: SparkChangedEvent): void
  }
}

export interface SparkConfig {
  filePath?: string
  maxRecords?: number
}

const DEFAULT_MAX_RECORDS = 5000

function defaultFilePath(): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'sparks.jsonl')
}

function makeId(): SparkRecordId {
  return randomUUID() as SparkRecordId
}

/** Minimal structural type for the HippoMemo service we bridge into. */
interface HippoService {
  put(input: HippoPutInput): Promise<{ id: string }>
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

  /** Capture a new spark. */
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
      crystallized: null,
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

  /**
   * Crystallize a spark into a HippoMemo memory record.
   * Idempotent: a second call returns the existing hippoId without creating a
   * duplicate. Requires dsh-hippomemo to be loaded (ctx.memory present).
   */
  async crystallize(id: SparkId, input: unknown = {}, now: number = Date.now()): Promise<{
    spark: SparkView
    record: { id: string; kind: SparkCrystallized['kind'] }
  }> {
    const opts: SparkCrystallize = sparkCrystallizeSchema.parse(input)
    const spark = await this.get(id)
    if (spark === null) {
      throw new SparkNotFoundError(id)
    }
    if (spark.crystallized !== null) {
      const existing = spark.crystallized
      return { spark, record: { id: existing.hippoId, kind: existing.kind } }
    }
    const memory = (this.ctx as unknown as { memory?: HippoService }).memory
    if (memory === undefined) {
      throw new SparkHippoUnavailableError('spark_crystallize requires HippoMemo (dsh-hippomemo) to be loaded')
    }
    const hippoInput = buildHippoInputFromSpark(spark, opts)
    const record = await memory.put(hippoInput)
    const crystallized: SparkCrystallized = { hippoId: record.id, kind: opts.kind, at: now }
    // Replace the record with crystallized set; bump updatedAt.
    const all = await this.storage.readAll()
    const idx = all.findIndex(r => r.id === id)
    if (idx < 0) throw new SparkNotFoundError(id)
    const current = all[idx]!
    const next: SparkView = { ...current, crystallized, updatedAt: now }
    all[idx] = next
    await this.storage.writeAll(all)
    this.ctx.emit('sparks/changed', { operation: 'crystallize', id, record: next, at: now })
    return { spark: next, record: { id: record.id, kind: opts.kind } }
  }

  /** Test-only: swap the storage backend. */
  setStorageForTest(storage: SparkStorage): void {
    this.storage = storage
  }

  /** Trim oldest archived records when over the cap. */
  private async enforceLimit(): Promise<void> {
    const all = await this.storage.readAll()
    if (all.length <= this.maxRecords) return
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

/** Domain error: spark id is unknown. */
export class SparkNotFoundError extends Error {
  readonly code = 'SPARK_NOT_FOUND'
  constructor(public readonly sparkId: string) {
    super('spark not found: ' + sparkId)
  }
}

/** Domain error: HippoMemo (dsh-hippomemo) is not loaded. */
export class SparkHippoUnavailableError extends Error {
  readonly code = 'SPARK_HIPPO_UNAVAILABLE'
  constructor(message: string) {
    super(message)
  }
}
