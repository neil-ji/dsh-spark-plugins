/**
 * ScriptService（`ctx.script`）—— 脚本沉淀库的宿主服务。
 *
 * 只做四件事：**写（含质量校验与判重）/ 读 / 计量 / 状态**。目录注入、HTTP、工具、
 * 事件流都是它的消费者，口径（成功率、可见性）只在服务里算一次（Spec INV-7）。
 *
 * 规范源：`docs/SCRIPT-LIBRARY-SPEC.md`。
 */
import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  scriptSaveInputSchema,
  scriptSummarySchema,
  scriptViewSchema,
  type ScriptAuthor,
  type ScriptListQuery,
  type ScriptSaveInput,
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

/** 名称归一化（判重用）。 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replaceAll(/\s+/g, ' ').trim()
}

/** 步骤归一化文本的指纹（判重用）。 */
export function stepsFingerprint(steps: readonly ScriptStep[]): string {
  const canonical = steps.map(step => `${step.kind}:${step.payload.trim()}`).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

/** 触发词集合的 Jaccard 相似度（判重用）。 */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a.map(value => value.toLowerCase()))
  const right = new Set(b.map(value => value.toLowerCase()))
  if (left.size === 0 && right.size === 0) return 1
  let shared = 0
  for (const value of left) if (right.has(value)) shared += 1
  const union = left.size + right.size - shared
  return union === 0 ? 0 : shared / union
}

/**
 * 判重（Spec §3.2 第 2 条）：同名，或（triggers Jaccard ≥ 0.8 且步骤指纹相同）。
 * @returns 命中的既有条目，未命中为 undefined。
 */
export function findDuplicate(candidate: Pick<ScriptSaveInput, 'name' | 'steps' | 'triggers'>, existing: readonly ScriptView[]): ScriptView | undefined {
  const name = normalizeName(candidate.name)
  const fingerprint = stepsFingerprint(candidate.steps)
  return existing.find(record =>
    record.status !== 'archived'
    && (normalizeName(record.name) === name
      || (stepsFingerprint(record.steps) === fingerprint && jaccard(record.triggers, candidate.triggers ?? []) >= 0.8)))
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
    void this.ready.then(() => this.seed(ctx)).catch(error => {
      ctx.logger?.warn?.('script: seed skipped: ' + String(error))
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

  /** 空库则写入种子（只在 ready 之后跑，见构造函数的自锁说明）。 */
  private async seed(ctx: Context): Promise<void> {
    if (!this.seedEnabled) return
    const created = await seedDefaultScripts(this)
    if (created > 0) ctx.logger?.info?.('script: seeded ' + String(created) + ' default script(s)')
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

  /** 物理删除：只允许已归档条目（Spec INV-11）。 */
  async remove(id: string, now: number = Date.now()): Promise<boolean> {
    const current = await this.storage.get(id)
    if (current === null || !canPurge(current)) return false
    const removed = await this.storage.remove(id)
    if (removed) this.ctx.emit('scripts/changed', { at: now, operation: 'delete', id })
    return removed
  }

  /* ─────────────────────────── 读 ─────────────────────────── */

  /** 全量列表（治理面用；不按工作区过滤，只看显式过滤条件）。 */
  async list(query: unknown = {}): Promise<ScriptView[]> {
    await this.whenReady()
    const parsed = this.parseListQuery(query)
    const all = await this.storage.readAll()
    return this.applyQuery(all, parsed)
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

  /** 当前工作区可见的紧凑视图（目录注入 / 主动建议用，Spec §5.4）。 */
  async listVisible(cwd: string | undefined, now: number = Date.now()): Promise<ScriptSummary[]> {
    const all = await this.list({ limit: 500 })
    return all
      .filter(record => isVisible(record, cwd, now))
      // zod 默认剥离未知键：steps/searchTerms 不会进摘要视图。
      .map(record => scriptSummarySchema.parse({ ...record, stepCount: record.steps.length }))
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

  /** 成功率口径单源（Spec INV-7）：未调用过记 0。 */
  static successRate(record: Pick<ScriptView, 'successCount' | 'invocationCount'>): number {
    return record.invocationCount === 0 ? 0 : record.successCount / record.invocationCount
  }

  /** 调用：返回步骤 + 调用前的成功率，并记一次调用（Spec INV-8）。 */
  async invoke(id: string, now: number = Date.now()): Promise<{ script: ScriptView; successRate: number }> {
    await this.whenReady()
    const current = await this.storage.get(id)
    if (current === null) throw new Error('script not found: ' + id)
    const updated = await this.storage.patch(id, invokePatch(current, now), now)
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
