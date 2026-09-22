/**
 * SparkService: host-side orchestration over a SparkStorage backend.
 *
 * The service is the single source of truth for sparks on the host plane.
 * It validates input with the wire schemas, persists via the storage backend,
 * and emits a `sparks/changed` cordis event after every mutation.
 *
 * 2026-09-21（v2 设计 P10/P11）：状态回退为 `status: 'active' | 'archived'` +
 * 墓碑；spark → memory 的全部直连删除（解耦是纯减法，INV-F1：本插件永不写
 * dsh-hippomemo；融合交给 Agent 自己调 memory_remember）。
 * **所有原地更新必须走 `storage.update()`**（读改写在同一临界区）。
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
  type SparkView,
  type SparkCapture,
  type SparkPatch,
  type SparkListQuery,
  type SparkStats,
  type SparkId,
  type SparkGraph,
  type SparkGraphQuery,
  type ProposalView,
} from 'dsh-spark-wire'
import { sparkGraphQuerySchema } from 'dsh-spark-wire'
import { buildSparkGraph } from './graph.ts'
import { selectRelevant } from './relevance.ts'
import { JsonlSparkStorage } from './storage.ts'
import { SparkMetaStore, defaultMetaPath, type SparkMeta } from './meta-store.ts'
import { ensureJsonlPath } from './jsonl-path.ts'
import { registerSparkHttpRoutes } from './http.ts'
import type { SparkChangedEvent, SparkRecordId, SparkStorage } from './types.ts'
import { applyRecall, deriveTitle, orderForPanel, resolveProvenance } from './types.ts'

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

export class SparkService extends Service {
  static inject = ['webServer'] as const

  private readonly filePath: string
  private readonly maxRecords: number
  private readonly tombstoneRetentionMs: number
  private readonly metaStore: SparkMetaStore
  private storage: SparkStorage
  private httpRegistered = false
  /** 初始化（含幂等格式迁移）是否已完成；未完成前拒绝读，避免把老形状当新形状用。 */
  private ready: Promise<void>

  constructor(ctx: Context, config: SparkConfig = {}) {
    super(ctx, 'spark')
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
    // 只注册自己那份前缀（/sparks + /proposals）；重复注册会被平台 webserver
    // 硬失败（见 http.ts 顶部注释）。/scripts 已迁到 dsh-script。
    registerSparkHttpRoutes(ctx, this)
    this.httpRegistered = true
  }

  /** Capture a new spark. 新捕获的火花一律是 `active`。 */
  async capture(input: unknown, now: number = Date.now()): Promise<SparkView> {
    await this.whenReady()
    const parsed: SparkCapture = sparkCaptureSchema.parse(input)
    const record: SparkView = sparkViewSchema.parse({
      id: makeId(),
      title: deriveTitle(parsed.title),
      content: parsed.content,
      scope: parsed.scope,
      workspacePath: parsed.workspacePath,
      status: 'active',
      tags: parsed.tags,
      ...resolveProvenance(
        parsed,
        parsed.derivedFrom?.length
          ? (await this.storage.readAll()).filter(r => (parsed.derivedFrom ?? []).includes(r.id))
          : [],
      ),
      sourceSessionId: parsed.sourceSessionId,
      sourceAgentId: parsed.sourceAgentId,
      sourceTurn: parsed.sourceTurn,
      createdAt: now,
      updatedAt: now,
      stateChangedAt: now,
      deletedAt: null,
    })
    await this.storage.append(record)
    await this.enforceLimit()
    this.ctx.emit('sparks/changed', { operation: 'capture', id: record.id, record, at: now })
    return record
  }

  /**
   * 关联图谱：火花间的标签亲和 + 涌现提议关联 + 火花→记忆的结晶谱系。
   *
   * 计算全在 `graph.ts` 的纯函数里（口径单源，可以脱离 cordis 单测）；
   * 本方法只负责取数据：火花读自己的存储，提议由调用方从 emerge 服务取
   * （服务间不互相属性访问 —— 见 AGENTS §2.5 的 inject 规则）。
   */
  async graph(proposals: readonly ProposalView[] = [], input: unknown = {}): Promise<SparkGraph> {
    await this.whenReady()
    const query: SparkGraphQuery = sparkGraphQuerySchema.parse(input)
    const all = await this.storage.readAll()
    return buildSparkGraph(all, proposals, { limit: query.limit, tagMinShared: query.tagMinShared })
  }

  /** 列表默认隐藏墓碑；`includeDeleted: true` 时为"最近删除"视图。 */
  async list(input: unknown = {}): Promise<SparkView[]> {
    await this.whenReady()
    const query: SparkListQuery = sparkListQuerySchema.parse(input)
    const all = await this.storage.readAll()
    let filtered = query.includeDeleted ? all : all.filter(r => r.deletedAt === null)
    if (query.status !== undefined) filtered = filtered.filter(r => r.status === query.status)
    if (query.scope !== undefined) filtered = filtered.filter(r => r.scope === query.scope)
    // 面板默认排序：lastRecalledAt 倒序（空值退化 createdAt）—— v2 §6，口径在 types.ts。
    return orderForPanel(filtered).slice(0, query.limit)
  }

  /**
   * 语义检索（v2 §4.4，P13）：按 token Jaccard 召回相关火花。
   *
   * 只搜 active（archived 是用户主动收起、墓碑是判过死刑的）——「主动性要求可查询」，
   * 而查询的默认面应当与注入面一致。排序口径在 `relevance.ts`（纯函数，唯一计算者）。
   */
  async search(query: string, limit: number = 5): Promise<SparkView[]> {
    await this.whenReady()
    const all = await this.storage.readAll()
    const pool = all.filter(r => r.deletedAt === null && r.status === 'active')
    return selectRelevant(pool, query, { limit, minScore: 0 }).map(entry => entry.spark)
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
    const merged = await this.storage.patch(id, patch, now)
    if (merged === null) return null
    const operation = patch.status !== undefined && patch.status !== current.status ? 'state' : 'patch'
    this.ctx.emit('sparks/changed', { operation, id, record: merged, at: now })
    return merged
  }

  /** 归档：收起来但仍保留在库里（≠ 删除）。 */
  async archive(id: SparkId, now: number = Date.now()): Promise<SparkView | null> {
    return this.patch(id, { status: 'archived' }, now)
  }

  /**
   * 重新激活（v2 §4.5 P14）：把 archived 拉回 active，**并记一次召回**。
   *
   * 「被重新激活」本身就是一次真实的召回事件（人想起了它），所以计数与状态在同一
   * 次读-改-写里落盘；对已经是 active 的记录调用也计数（用户又想起了它一次）。
   */
  async reactivate(id: SparkId, now: number = Date.now()): Promise<SparkView | null> {
    await this.whenReady()
    const current = await this.get(id)
    if (current === null || current.deletedAt !== null) return null
    const stateChanged = current.status !== 'active'
    const next = await this.storage.update(id, record => ({
      ...applyRecall(record, now),
      ...(stateChanged ? { status: 'active' as const, stateChangedAt: now } : {}),
    }))
    if (next === null) return null
    this.ctx.emit('sparks/changed', { operation: stateChanged ? 'state' : 'patch', id, record: next, at: now })
    return next
  }

  /**
   * 批量记召回（注入命中时调用，v2 §4.5）：被注入即算「被想起」，召回 ≠ 采纳。
   * 逐条原子更新；单条失败只记日志，不让一次召回拖垮整个首步注入。
   */
  async markRecalled(ids: readonly SparkId[], now: number = Date.now()): Promise<void> {
    await this.whenReady()
    for (const id of ids) {
      try {
        const next = await this.storage.update(id, record => applyRecall(record, now))
        if (next !== null) this.ctx.emit('sparks/changed', { operation: 'patch', id, record: next, at: now })
      } catch (error) {
        this.ctx.logger?.warn?.('spark: markRecalled failed for ' + id + ': ' + String(error))
      }
    }
  }

  /**
   * 物理删除（不可恢复）。UI 的「丢弃」走这条：用户裁决「不要给出选择题 ——
   * 归档(逻辑删)与丢弃(物理删)并存心智负担重」，只保留丢弃一个破坏性动作，
   * 且语义就是真删（区别于 `remove` 的墓碑：后者可由 `restore` 复原）。
   * 二次确认在 UI 层（Modal）完成，宿主这里只负责执行。
   */
  async purge(id: SparkId): Promise<boolean> {
    await this.whenReady()
    const purged = await this.storage.purge(id)
    if (!purged) return false
    this.ctx.emit('sparks/changed', { operation: 'delete', id, record: null, at: Date.now() })
    return true
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
   * 统计。`GET /sparks/stats`、首步注入、模块 header 计数共用。
   * @param pendingProposals - 待决提议数；由调用方从 emerge 服务取（本服务不认识它）。
   */
  async stats(pendingProposals: number = 0): Promise<SparkStats> {
    await this.whenReady()
    const all = await this.storage.readAll()
    const live = all.filter(r => r.deletedAt === null)
    const count = (state: SparkView['status']): number => live.filter(r => r.status === state).length
    const active = live.filter(r => r.status === 'active')
    return {
      total: live.length,
      active: count('active'),
      archived: count('archived'),
      deleted: all.length - live.length,
      oldestActiveAt: active.length === 0 ? null : Math.min(...active.map(r => r.createdAt)),
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
    const rank = (r: SparkView): number => (r.status === 'archived' ? 1 : 0)
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
