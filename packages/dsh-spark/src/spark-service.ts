/**
 * SparkService: host-side orchestration over a SparkStorage backend.
 *
 * The service is the single source of truth for sparks on the host plane.
 * It validates input with the wire schemas, persists via the storage backend,
 * and emits a `sparks/changed` cordis event after every mutation.
 *
 * 2026-09-14（设计 §4.1/§7）：收件箱状态由 `status: active|archived` 改为显式的
 * `inboxState: pending|crystallized|dropped|archived`，并新增墓碑软删除。
 * **所有原地更新必须走 `storage.update()`**（读改写在同一临界区）；本文件此前
 * 的 `crystallize` 自己 readAll + writeAll，是实测丢数据的直接缺口。
 */
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
  type SparkStats,
  type SparkId,
} from 'dsh-spark-wire'
import { JsonlSparkStorage } from './storage.ts'
import { SparkMetaStore, defaultMetaPath, type SparkMeta } from './meta-store.ts'
import { ensureJsonlPath } from './jsonl-path.ts'
import type { ScriptService } from './script-service.ts'
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
  /** 墓碑保留天数；超过后由压实物理清除。默认 30 天。 */
  tombstoneRetentionDays?: number
  /** 调度元数据 sidecar 路径（B/D 档的落点）；默认与 sparks.jsonl 同目录。 */
  metaPath?: string
}

const DEFAULT_MAX_RECORDS = 5000
const DEFAULT_TOMBSTONE_RETENTION_DAYS = 30
const DAY_MS = 86_400_000

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
  private readonly tombstoneRetentionMs: number
  private readonly metaStore: SparkMetaStore
  private storage: SparkStorage
  private httpRegistered = false
  private readonly scriptService: ScriptService | undefined
  /** 初始化（含幂等格式迁移）是否已完成；未完成前拒绝读，避免把老形状当新形状用。 */
  private ready: Promise<void>

  constructor(ctx: Context, config: SparkConfig = {}, scriptService?: ScriptService) {
    super(ctx, 'spark')
    this.scriptService = scriptService
    this.filePath = config.filePath ?? defaultFilePath()
    this.maxRecords = config.maxRecords ?? DEFAULT_MAX_RECORDS
    this.tombstoneRetentionMs = (config.tombstoneRetentionDays ?? DEFAULT_TOMBSTONE_RETENTION_DAYS) * DAY_MS
    this.storage = new JsonlSparkStorage(this.filePath)
    this.metaStore = new SparkMetaStore(config.metaPath ?? defaultMetaPath(this.filePath))
    this.ready = this.init(ctx)
  }

  private async init(ctx: Context): Promise<void> {
    try {
      await ensureJsonlPath(this.filePath)
      // 幂等迁移：老文件（v1，无版本头）在这里升级到 inboxState/stateChangedAt/deletedAt。
      const version = await this.storage.ensureVersion()
      if (version > 1) ctx.logger?.info?.('spark: store migrated to format v' + String(version))
      await this.enforceLimit()
      this.ensureRegistered(ctx)
    } catch (error) {
      ctx.logger?.error?.('spark: init failed: ' + String(error))
    }
  }

  /** 等待初始化（含迁移）完成。测试与 HTTP 路由在首次读之前调用。 */
  async whenReady(): Promise<void> {
    await this.ready
  }

  private ensureRegistered(ctx: Context): void {
    if (this.httpRegistered) return
    registerSparkHttpRoutes(ctx, this, this.scriptService)
    this.httpRegistered = true
  }

  /** Capture a new spark. 新捕获的火花一律是 `pending`（收件箱）。 */
  async capture(input: unknown, now: number = Date.now()): Promise<SparkView> {
    await this.whenReady()
    const parsed: SparkCapture = sparkCaptureSchema.parse(input)
    const record: SparkView = sparkViewSchema.parse({
      id: makeId(),
      title: deriveTitle(parsed.title),
      content: parsed.content,
      scope: parsed.scope,
      workspacePath: parsed.workspacePath,
      inboxState: 'pending',
      tags: parsed.tags,
      sourceSessionId: parsed.sourceSessionId,
      sourceAgentId: parsed.sourceAgentId,
      sourceTurn: parsed.sourceTurn,
      createdAt: now,
      updatedAt: now,
      stateChangedAt: now,
      deletedAt: null,
      crystallized: null,
    })
    await this.storage.append(record)
    await this.enforceLimit()
    this.ctx.emit('sparks/changed', { operation: 'capture', id: record.id, record, at: now })
    return record
  }

  /** 列表默认隐藏墓碑；`includeDeleted: true` 时为"最近删除"视图。 */
  async list(input: unknown = {}): Promise<SparkView[]> {
    await this.whenReady()
    const query: SparkListQuery = sparkListQuerySchema.parse(input)
    const all = await this.storage.readAll()
    let filtered = query.includeDeleted ? all : all.filter(r => r.deletedAt === null)
    if (query.inboxState !== undefined) filtered = filtered.filter(r => r.inboxState === query.inboxState)
    if (query.scope !== undefined) filtered = filtered.filter(r => r.scope === query.scope)
    filtered.sort((a, b) => b.createdAt - a.createdAt)
    return filtered.slice(0, query.limit)
  }

  async get(id: SparkId): Promise<SparkView | null> {
    await this.whenReady()
    const all = await this.storage.readAll()
    return all.find(r => r.id === id) ?? null
  }

  async patch(id: SparkId, input: unknown, now: number = Date.now()): Promise<SparkView | null> {
    await this.whenReady()
    const patch: SparkPatch = sparkPatchSchema.parse(input)
    const current = await this.get(id)
    if (current === null) return null
    if (patch.inboxState === 'crystallized' && current.crystallized === null) {
      throw new SparkStateError('crystallized is only reachable through spark_crystallize (it carries the hippo link)')
    }
    const merged = await this.storage.patch(id, patch, now)
    if (merged === null) return null
    const operation = patch.inboxState !== undefined && patch.inboxState !== current.inboxState
      ? (patch.inboxState === 'crystallized' ? 'crystallize' : 'state')
      : 'patch'
    this.ctx.emit('sparks/changed', { operation, id, record: merged, at: now })
    return merged
  }

  /** 归档：收起来但仍保留在库里（≠ dropped）。 */
  async archive(id: SparkId, now: number = Date.now()): Promise<SparkView | null> {
    return this.patch(id, { inboxState: 'archived' }, now)
  }

  /** 丢弃：判定为无价值。与归档分开，收件箱的清理率统计才不会失真。 */
  async drop(id: SparkId, now: number = Date.now()): Promise<SparkView | null> {
    return this.patch(id, { inboxState: 'dropped' }, now)
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
    await this.whenReady()
    const opts: SparkCrystallize = sparkCrystallizeSchema.parse(input)
    const spark = await this.get(id)
    if (spark === null || spark.deletedAt !== null) {
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
    // 读-改-写必须在 storage 的同一临界区内完成（旧实现自己 readAll + writeAll，
    // 与并发 capture 交错时会用陈旧快照覆盖整个文件 —— 实测丢过 2 条）。
    const next = await this.storage.update(id, current => ({
      ...current,
      crystallized,
      inboxState: 'crystallized',
      stateChangedAt: now,
      updatedAt: now,
    }))
    if (next === null) throw new SparkNotFoundError(id)
    this.ctx.emit('sparks/changed', { operation: 'crystallize', id, record: next, at: now })
    return { spark: next, record: { id: record.id, kind: opts.kind } }
  }

  /** 软删除（墓碑）。可被 `restore` 复原，也可在"最近删除"里看到。 */
  async remove(id: SparkId, now: number = Date.now()): Promise<boolean> {
    await this.whenReady()
    const removed = await this.storage.remove(id, now)
    if (!removed) return false
    this.ctx.emit('sparks/changed', { operation: 'delete', id, record: null, at: now })
    return true
  }

  /** 从墓碑恢复。 */
  async restore(id: SparkId, now: number = Date.now()): Promise<SparkView | null> {
    await this.whenReady()
    const current = await this.get(id)
    if (current === null) return null
    if (current.deletedAt === null) return current
    const next = await this.storage.update(id, record => ({ ...record, deletedAt: null, updatedAt: now }))
    if (next === null) return null
    this.ctx.emit('sparks/changed', { operation: 'restore', id, record: next, at: now })
    return next
  }

  /**
   * 收件箱统计（设计 §4.2）。`GET /sparks/stats`、首步注入、模块 header 计数共用。
   * @param pendingProposals - 待决提议数；由调用方从 emerge 服务取（本服务不认识它）。
   */
  async stats(pendingProposals: number = 0): Promise<SparkStats> {
    await this.whenReady()
    const all = await this.storage.readAll()
    const live = all.filter(r => r.deletedAt === null)
    const count = (state: SparkView['inboxState']): number => live.filter(r => r.inboxState === state).length
    const pending = live.filter(r => r.inboxState === 'pending')
    return {
      total: live.length,
      pending: count('pending'),
      crystallized: count('crystallized'),
      dropped: count('dropped'),
      archived: count('archived'),
      deleted: all.length - live.length,
      oldestPendingAt: pending.length === 0 ? null : Math.min(...pending.map(r => r.createdAt)),
      pendingProposals,
    }
  }

  /**
   * 自 `ts` 以来新增或变更的**活跃**火花数（B 档脏标记）。`ts === null` 时返回全部 ——
   * 也就是"从未跑过涌现"的情况，首次会话就会触发一次挖掘。
   */
  async countChangedSince(ts: number | null): Promise<number> {
    await this.whenReady()
    const all = await this.storage.readAll()
    const live = all.filter(r => r.deletedAt === null)
    if (ts === null) return live.length
    return live.filter(r => r.createdAt > ts || r.updatedAt > ts).length
  }

  /** 读调度元数据（lastReflectAt / 命令失败聚合）。损坏或缺失都降级成空值。 */
  async readMeta(): Promise<SparkMeta> {
    return this.metaStore.read()
  }

  /** 读-改-写调度元数据（同一临界区内，mutate 返回 null 表示不改）。 */
  async updateMeta(mutate: (meta: SparkMeta) => SparkMeta | null): Promise<SparkMeta> {
    return this.metaStore.update(mutate)
  }

  /** Test-only: swap the storage backend. */
  setStorageForTest(storage: SparkStorage): void {
    this.storage = storage
    this.ready = Promise.resolve()
  }

  /**
   * 压实：① 物理清除过期墓碑；② 超过上限时淘汰最老的已归档记录。
   * 墓碑有保留期，所以"删除"不会立刻把数据变成不可恢复。
   */
  private async enforceLimit(): Promise<void> {
    await this.storage.purgeTombstones(this.tombstoneRetentionMs)
    const all = await this.storage.readAll()
    if (all.length <= this.maxRecords) return
    const rank = (r: SparkView): number => (r.inboxState === 'archived' || r.inboxState === 'dropped' ? 1 : 0)
    const ordered = [...all].sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      return b.createdAt - a.createdAt
    })
    const keep = new Set(ordered.slice(0, this.maxRecords).map(r => r.id))
    for (const record of all) {
      if (!keep.has(record.id)) await this.storage.purge(record.id)
    }
  }
}

/** Domain error: spark id is unknown. */
export class SparkNotFoundError extends Error {
  readonly code = 'SPARK_NOT_FOUND'
  constructor(public readonly sparkId: SparkId) {
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

/** Domain error: the requested inbox-state transition is not allowed through this path. */
export class SparkStateError extends Error {
  readonly code = 'SPARK_STATE_INVALID'
  constructor(message: string) {
    super(message)
  }
}
