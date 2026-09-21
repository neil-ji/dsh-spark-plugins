/**
 * ScriptService（`ctx.script`）—— 脚本沉淀库的宿主服务。
 *
 * 只做五件事：**写（含质量校验与判重）/ 读（含读模型）/ 计量 / 状态 / 治理**。目录注入、
 * HTTP、工具、事件流都是它的消费者，口径（成功率、可见性、审计统计）只在叶子模块里算
 * 一次（Spec INV-7），服务负责把结论发出去。
 *
 * 分层（避免循环依赖）：`dedupe.ts` / `metrics.ts`（纯叶子）← `governance.ts`（纯）← 本服务
 * ← `http.ts` / `tool.ts` / `injection.ts`。
 *
 * 规范源：`docs/SCRIPT-LIBRARY-SPEC.md`。
 */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  scriptAuditSchema,
  scriptSaveInputSchema,
  scriptViewSchema,
  type ScriptAdvice,
  type ScriptAudit,
  type ScriptAuditStats,
  type ScriptAuthor,
  type ScriptListQuery,
  type ScriptSaveInput,
  type ScriptScope,
  type ScriptStatus,
  type ScriptStep,
  type ScriptSummary,
  type ScriptView,
} from 'dsh-script-wire'
import { JsonlScriptStorage, defaultScriptsFilePath, legacyScriptsFilePath, migrateLegacyScriptStore } from './script-storage.ts'
import { ensureJsonlPath } from './jsonl-path.ts'
import { isVisible } from './scope.ts'
import { registerScriptHttpRoutes } from './http.ts'
import { seedDefaultScripts } from './seed-scripts.ts'
import { findDuplicate } from './dedupe.ts'
import { successRate, toSummary } from './metrics.ts'
import { auditStats, expiredIds, governanceAdvices, invokedWorkspacesPatch } from './governance.ts'

/** 判重原语从 `dedupe.ts` 再导出：调用方（含测试）的 import 面保持稳定。 */
export { findDuplicate, jaccard, normalizeName, stepsFingerprint } from './dedupe.ts'
/** 计量口径从 `metrics.ts` 再导出（单源在那里，服务只是公开别名）。 */
export { successRate } from './metrics.ts'

export interface ScriptConfig {
  /** 存储文件；默认 `$DSH_HOME/storages/script/scripts.jsonl`。 */
  filePath?: string
  /** 是否在存储为空时写入开箱即用种子（默认 true）。 */
  seed?: boolean
}

/** 写入时的会话上下文（由工具/HTTP 传入；种子为 undefined）。 */
export interface ScriptWriteContext {
  sessionId?: string | null
  agentId?: string | null
  turn?: number | null
  updatedBy?: ScriptAuthor
  workspacePath?: string | null
}

/** 质量校验：拒绝"处理一下"这类不可执行的步骤（Spec §3.2 第 1 条）。 */
const VAGUE_PATTERN = /^(处理|优化|调整|完善|跟进|handle|fix|improve|optimize|do)\b/i
const MIN_INSTRUCTION_CHARS = 8

/**
 * 校验步骤可执行性（纯函数）。
 * @param steps - 待校验步骤。
 * @returns 违规说明列表（空数组 = 通过）。
 */
export function validateSteps(steps: readonly ScriptStep[]): string[] {
  const problems: string[] = []
  steps.forEach((step, index) => {
    const payload = step.payload.trim()
    if (step.kind === 'instruction') {
      if (payload.length < MIN_INSTRUCTION_CHARS) problems.push(`step ${String(index + 1)}: instruction 太短（<${String(MIN_INSTRUCTION_CHARS)} 字）`)
      else if (VAGUE_PATTERN.test(payload)) problems.push(`step ${String(index + 1)}: instruction 是空话（"${payload}"），写清具体动作`)
    }
    if (/\s{2,}/.test(payload)) problems.push(`step ${String(index + 1)}: payload 含连续空白`)
  })
  return problems
}

/* ─────────────────── 治理规则（纯函数，Spec INV-11 / §6.2） ─────────────────── */

/** 物理删除只允许已归档条目（Spec INV-11：其余状态只能迁移，不能消失）。 */
export function canPurge(record: Pick<ScriptView, 'status'>): boolean {
  return record.status === 'archived'
}

/** 状态迁移的补丁（`superseded` 必须带上取代者 id，否则取代链断掉）。 */
export function statusPatch(
  status: ScriptStatus,
  supersededBy: string | null,
): Partial<ScriptView> {
  if (status === 'superseded' && supersededBy === null) {
    throw new Error('script: superseded 必须带 supersededBy（取代链不能断）')
  }
  return status === 'superseded' ? { status, supersededBy } : { status }
}

/** 调用计量补丁（Spec INV-8）。 */
export function invokePatch(record: Pick<ScriptView, 'invocationCount'>, now: number): Partial<ScriptView> {
  return { invocationCount: record.invocationCount + 1, lastInvokedAt: now }
}

/** 结果计量补丁（成功/失败各加一）。 */
export function resultPatch(record: Pick<ScriptView, 'successCount' | 'failureCount'>, success: boolean): Partial<ScriptView> {
  return success ? { successCount: record.successCount + 1 } : { failureCount: record.failureCount + 1 }
}

/**
 * 取代链上的新记录修订号（Spec §6.2：修订产生新记录时 `revision + 1`）。
 * 被取代者不存在时按首版处理。
 */
export function revisionFor(predecessor: Pick<ScriptView, 'revision'> | null): number {
  return predecessor === null ? 1 : predecessor.revision + 1
}

export class ScriptService extends Service {
  static inject = ['webServer'] as const

  private readonly filePath: string
  private readonly storage: JsonlScriptStorage<ScriptView>
  private readonly seedEnabled: boolean
  private httpRegistered = false
  /** 初始化（迁移 + 目录 + 种子 + 路由）完成前不读，避免把半迁移状态当成品。 */
  private readonly ready: Promise<void>

  constructor(ctx: Context, config: ScriptConfig = {}) {
    super(ctx, 'script')
    this.filePath = config.filePath ?? defaultScriptsFilePath()
    this.seedEnabled = config.seed ?? true
    this.storage = new JsonlScriptStorage<ScriptView>(this.filePath)
    this.ready = this.init(ctx)
    // **种子必须在 ready 之后**：seedDefaultScripts 走公开的 list()/save()，而它们
    // 都以 `await whenReady()` 开头。若把种子放进 init()，就是 init 等种子、种子等 init
    // 的自锁 —— ready 永不 resolve，于是 init 里排在种子**之后**的 HTTP 注册永远不执行
    // （表现为 /scripts 404、服务在宿主里"看不见"，且没有任何报错）。
    void this.ready.then(() => this.bootstrap(ctx)).catch(error => {
      ctx.logger?.warn?.('script: bootstrap skipped: ' + String(error))
    })
  }

  /** 等待初始化完成（HTTP 路由与测试在首次读之前调用）。 */
  async whenReady(): Promise<void> {
    await this.ready
  }

  private async init(ctx: Context): Promise<void> {
    try {
      await ensureJsonlPath(this.filePath)
      const migration = await migrateLegacyScriptStore<ScriptView>({
        newPath: this.filePath,
        legacyPath: legacyScriptsFilePath(),
        parse: value => scriptViewSchema.parse(value),
      })
      if (migration !== undefined) {
        ctx.logger?.info?.('script: migrated ' + String(migration.migrated) + ' legacy record(s) from storages/sparks')
        for (const record of await this.storage.readAll()) {
          this.ctx.emit('scripts/changed', { at: Date.now(), operation: 'save', id: record.id })
        }
      }
      // HTTP 注册排在种子之前（种子在 ready 之后跑）：路由要在服务 ready 时就已经可用。
      this.ensureRegistered(ctx)
    } catch (error) {
      ctx.logger?.error?.('script: init failed: ' + String(error))
    }
  }

  /**
   * ready 之后的一次性工作：种子 + 过期结算（Spec D7：结算是**惰性扫描**，不引定时器）。
   * 两次都走公开方法，所以只能在 ready 之后跑（见构造函数的自锁说明）。
   */
  private async bootstrap(ctx: Context): Promise<void> {
    if (this.seedEnabled) {
      const created = await seedDefaultScripts(this)
      if (created > 0) ctx.logger?.info?.('script: seeded ' + String(created) + ' default script(s)')
    }
    const archived = await this.sweepExpired()
    if (archived > 0) ctx.logger?.info?.('script: expired ' + String(archived) + ' script(s)')
  }

  private ensureRegistered(ctx: Context): void {
    if (this.httpRegistered) return
    registerScriptHttpRoutes(ctx, this)
    this.httpRegistered = true
  }

  /* ─────────────────────────── 写 ─────────────────────────── */

  /**
   * 沉淀一条脚本（含校验与判重）。
   * @returns `created`（新建）或 `duplicate`（命中既有条目，返回其 id）。
   */
  async save(
    input: unknown,
    write: ScriptWriteContext = {},
    now: number = Date.now(),
  ): Promise<{ kind: 'created'; record: ScriptView } | { kind: 'duplicate'; existing: ScriptView } | { kind: 'invalid'; problems: string[] }> {
    await this.whenReady()
    const parsed: ScriptSaveInput = scriptSaveInputSchema.parse(input)
    const problems = validateSteps(parsed.steps)
    if (problems.length > 0) return { kind: 'invalid', problems }
    const all = await this.storage.readAll()
    const existing = findDuplicate(parsed, all)
    if (existing !== undefined) return { kind: 'duplicate', existing }
    const predecessor = parsed.supersedes === null ? null : all.find(record => record.id === parsed.supersedes) ?? null
    const updatedBy: ScriptAuthor = write.updatedBy ?? 'agent'
    const record: ScriptView = scriptViewSchema.parse({
      id: randomUUID(),
      name: parsed.name,
      description: parsed.description,
      steps: parsed.steps,
      triggers: parsed.triggers,
      tags: parsed.tags,
      ...(parsed.searchTerms !== undefined ? { searchTerms: parsed.searchTerms } : {}),
      scope: parsed.scope,
      workspacePath: write.workspacePath ?? parsed.workspacePath,
      status: 'active',
      revision: revisionFor(predecessor),
      supersedes: parsed.supersedes,
      supersededBy: null,
      updatedBy,
      sourceSessionId: parsed.sourceSessionId ?? write.sessionId ?? null,
      sourceAgentId: parsed.sourceAgentId ?? write.agentId ?? null,
      sourceTurn: parsed.sourceTurn ?? write.turn ?? null,
      invocationCount: 0,
      successCount: 0,
      failureCount: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: parsed.expiresAt,
      lastInvokedAt: null,
    })
    await this.storage.append(record)
    if (record.supersedes !== null) {
      await this.setStatus(record.supersedes, 'superseded', now, record.id)
    }
    this.ctx.emit('scripts/changed', { at: now, operation: 'save', id: record.id })
    return { kind: 'created', record }
  }

  /** 状态迁移（归档 / 取代 / 候选）；可逆，不删数据（Spec INV-11）。 */
  async setStatus(id: string, status: ScriptStatus, now: number = Date.now(), supersededBy: string | null = null): Promise<ScriptView | null> {
    const updated = await this.storage.patch(id, statusPatch(status, supersededBy), now)
    if (updated !== null) this.ctx.emit('scripts/changed', { at: now, operation: 'status', id })
    return updated
  }

  /**
   * 改作用域（治理面「降为工作区」建议的落点，Spec §6.2）。
   * 只动 `scope`：`workspacePath` 保持写入时的值，降级后自然就按它精确匹配。
   */
  async setScope(id: string, scope: ScriptScope, now: number = Date.now()): Promise<ScriptView | null> {
    const updated = await this.storage.patch(id, { scope }, now)
    if (updated !== null) this.ctx.emit('scripts/changed', { at: now, operation: 'status', id })
    return updated
  }

  /** 物理删除：只允许已归档条目（Spec INV-11）。 */
  async remove(id: string, now: number = Date.now()): Promise<boolean> {
    const current = await this.storage.get(id)
    if (current === null || !canPurge(current)) return false
    const removed = await this.storage.remove(id)
    if (removed) this.ctx.emit('scripts/changed', { at: now, operation: 'delete', id })
    return removed
  }

  /* ─────────────────────────── 治理 ─────────────────────────── */

  /**
   * 过期结算：把 `expiresAt` 已到的 `active` 条目归档（Spec §6.2 的**唯一自动动作**）。
   *
   * D7：这是**惰性扫描**（bootstrap 一次 + 人面 `POST /scripts/sweep`），不是定时器 ——
   * 过期条目本来就被 `isVisible` 挡在可见面外，扫描只是让 `status` 与审计面诚实。
   * INV-13：只挑 `active`，所以重复调用第二次返回 0、不产生任何写入。
   * @returns 本次归档的条数。
   */
  async sweepExpired(now: number = Date.now()): Promise<number> {
    await this.whenReady()
    const ids = expiredIds(await this.storage.readAll(), now)
    for (const id of ids) {
      const updated = await this.storage.patch(id, statusPatch('archived', null), now)
      if (updated !== null) this.ctx.emit('scripts/changed', { at: now, operation: 'expire', id })
    }
    return ids.length
  }

  /**
   * 审计负载（Spec §6.5）。`settle: true` 会先结算过期 —— 人面打开治理面时用它，
   * 于是"打开即结算"而不是"后台跑定时器"（D7）。
   */
  async audit(now: number = Date.now(), options: { settle?: boolean } = {}): Promise<ScriptAudit> {
    await this.whenReady()
    const archived = options.settle === true ? await this.sweepExpired(now) : 0
    const all = await this.storage.readAll()
    return scriptAuditSchema.parse({
      settledAt: now,
      archived,
      stats: auditStats(all, now),
      advices: governanceAdvices(all, now),
    })
  }

  /** 只读审计（不结算）—— 供测试与只读消费者用。 */
  async readAudit(now: number = Date.now()): Promise<ScriptAudit> {
    return this.audit(now, { settle: false })
  }

  /** 待裁决建议（只读纯函数的结果，不写库，INV-14）。 */
  async advices(now: number = Date.now()): Promise<ScriptAdvice[]> {
    await this.whenReady()
    return governanceAdvices(await this.storage.readAll(), now)
  }

  /** 审计统计（只读纯函数的结果，不写库）。 */
  async stats(now: number = Date.now()): Promise<ScriptAuditStats> {
    await this.whenReady()
    return auditStats(await this.storage.readAll(), now)
  }

  /* ─────────────────────────── 读 ─────────────────────────── */

  /** 全量列表（工具面用：带全文 steps 与 searchTerms）。 */
  async list(query: unknown = {}): Promise<ScriptView[]> {
    await this.whenReady()
    const parsed = this.parseListQuery(query)
    const all = await this.storage.readAll()
    return this.applyQuery(all, parsed)
  }

  /**
   * 紧凑读模型列表（HTTP `/scripts` 与目录注入用）：**不含 steps**，且带宿主算好的
   * `successRate`（Spec §6.5 / D10）—— 人面拿不到原文，也就没有重算口径的机会。
   */
  async listSummaries(query: unknown = {}): Promise<ScriptSummary[]> {
    return (await this.list(query)).map(record => toSummary(record))
  }

  private parseListQuery(query: unknown): ScriptListQuery {
    if (typeof query !== 'object' || query === null || Object.keys(query).length === 0) {
      return { limit: 100 }
    }
    // 宽松入口：未知键不致命（HTTP 查询串与工具参数形态不同）。
    const raw = query as Record<string, unknown>
    const next: Record<string, unknown> = {}
    if (typeof raw['q'] === 'string') next['q'] = raw['q']
    if (typeof raw['tag'] === 'string') next['tag'] = raw['tag']
    if (raw['scope'] === 'global' || raw['scope'] === 'workspace' || raw['scope'] === 'project') next['scope'] = raw['scope']
    if (raw['status'] === 'active' || raw['status'] === 'archived' || raw['status'] === 'superseded' || raw['status'] === 'candidate') next['status'] = raw['status']
    if (typeof raw['limit'] === 'number' && Number.isInteger(raw['limit'])) next['limit'] = raw['limit']
    return { limit: 100, ...next } as ScriptListQuery
  }

  private applyQuery(all: ScriptView[], query: ScriptListQuery): ScriptView[] {
    let filtered = all
    if (query.status !== undefined) filtered = filtered.filter(record => record.status === query.status)
    if (query.scope !== undefined) filtered = filtered.filter(record => record.scope === query.scope)
    if (query.tag !== undefined) filtered = filtered.filter(record => record.tags.includes(query.tag as string))
    const needle = query.q?.trim().toLowerCase()
    if (needle !== undefined && needle.length > 0) {
      filtered = filtered.filter(record =>
        record.name.toLowerCase().includes(needle)
        || record.description.toLowerCase().includes(needle)
        || record.tags.some(tag => tag.toLowerCase().includes(needle))
        || record.triggers.some(trigger => trigger.toLowerCase().includes(needle)))
    }
    filtered = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt)
    return filtered.slice(0, query.limit)
  }

  /** 当前工作区可见的紧凑视图（目录注入用，Spec §5.4）。 */
  async listVisible(cwd: string | undefined, now: number = Date.now()): Promise<ScriptSummary[]> {
    const all = await this.listSummaries({ limit: 500 })
    return all.filter(record => isVisible(record, cwd, now))
  }

  /** 当前工作区可见的完整记录（主动建议需要 triggers 与全文展示）。 */
  async listVisibleRecords(cwd: string | undefined, now: number = Date.now()): Promise<ScriptView[]> {
    const all = await this.list({ limit: 500 })
    return all.filter(record => isVisible(record, cwd, now))
  }

  async get(id: string): Promise<ScriptView | null> {
    await this.whenReady()
    return this.storage.get(id)
  }

  /* ─────────────────────────── 计量 ─────────────────────────── */

  /** 成功率口径的公开别名（Spec INV-7）：定义在 `metrics.ts`，全仓仅此一处。 */
  static successRate(record: Pick<ScriptView, 'successCount' | 'invocationCount'>): number {
    return successRate(record)
  }

  /**
   * 调用：返回步骤 + 调用前的成功率，并记一次调用（Spec INV-8）。
   * @param workspacePath - 调用方工作区（agent 的 session cwd）；给了就记进
   *   `invokedWorkspaces` 作为降级作用域的病据（D9：只有 agent 侧调用才有工作区信息）。
   */
  async invoke(id: string, now: number = Date.now(), workspacePath?: string | null): Promise<{ script: ScriptView; successRate: number }> {
    await this.whenReady()
    const current = await this.storage.get(id)
    if (current === null) throw new Error('script not found: ' + id)
    const evidence = invokedWorkspacesPatch(current.invokedWorkspaces, workspacePath)
    const updated = await this.storage.patch(id, {
      ...invokePatch(current, now),
      ...(evidence === undefined ? {} : { invokedWorkspaces: evidence }),
    }, now)
    if (updated === null) throw new Error('script disappeared mid-invoke: ' + id)
    this.ctx.emit('scripts/changed', { at: now, operation: 'invoke', id })
    return { script: updated, successRate: ScriptService.successRate(updated) }
  }

  /** 记结果（成功/失败各加一）。 */
  async recordResult(id: string, success: boolean, now: number = Date.now()): Promise<ScriptView | null> {
    await this.whenReady()
    const current = await this.storage.get(id)
    if (current === null) return null
    const updated = await this.storage.patch(id, resultPatch(current, success), now)
    if (updated !== null) this.ctx.emit('scripts/changed', { at: now, operation: 'result', id })
    return updated
  }
}
