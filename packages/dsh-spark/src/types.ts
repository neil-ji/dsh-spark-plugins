/**
 * dsh-spark host-side types.
 *
 * Wire-facing schemas live in dsh-spark-wire so the client bundle can use
 * them too. **事件载荷也属于 wire**（ADR-002）：`SparkChangedEvent` 由
 * `dsh-spark-wire` 的 zod schema 定义并在此转出，不再在本模块另立一份
 * 声明 —— 之前的版本在这里写着 "never cross the wire"，而它实际就是
 * SSE 的载荷格式，客户端只能手抄一遍且没有校验。
 */
import { sparkViewSchema } from 'dsh-spark-wire'
import type { SparkScope, SparkStatus, SparkOrigin, SparkView, SparkCapture, SparkPatch, SparkId, SparkStats } from 'dsh-spark-wire'

export type { SparkScope, SparkStatus, SparkOrigin, SparkView, SparkCapture, SparkPatch, SparkId, SparkStats }
/** 火花变更事件（= `sparks/changed` 载荷，契约在 wire 包）。 */
export type { SparkChangedEvent } from 'dsh-spark-wire'

/** Strongly-typed id branded at construction time. */
export type SparkRecordId = SparkId

/** Storage backend interface. */
export interface SparkStorage {
  append(record: SparkView): Promise<void>
  readAll(): Promise<SparkView[]>
  /** 幂等格式迁移：读到老版本就按新形状重写一次，返回迁移后的版本号。 */
  ensureVersion(): Promise<number>
  /** Apply a user-facing patch (title/content/tags/scope/inboxState). */
  patch(id: SparkRecordId, patch: SparkPatch, now: number): Promise<SparkView | null>
  /**
   * 原子读-改-写。**唯一**允许的原地更新入口 —— 服务层不得自己 readAll + writeAll
   * （那样读改写不在同一临界区，实测丢过数据）。
   */
  update(id: SparkRecordId, mutate: (current: SparkView) => SparkView): Promise<SparkView | null>
  /** Replace the entire store. System use only (迁移). */
  writeAll(records: SparkView[]): Promise<void>
  /** 软删除（墓碑）：写 deletedAt，可由 restore 复原。 */
  remove(id: SparkRecordId, now?: number): Promise<boolean>
  /** 物理删除（压实专用，不可恢复）。 */
  purge(id: SparkRecordId): Promise<boolean>
  /** 物理清除过期墓碑。 */
  purgeTombstones(olderThanMs: number, now?: number): Promise<number>
}

/** Derive a short title from content when the caller did not supply one. */
export function deriveTitle(content: string, max: number = 60): string {
  const trimmed = content.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return '(empty)'
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + '…'
}

/**
 * 记一次召回（纯函数，v2 §4.5 P14）。
 *
 * **不动 `updatedAt`**：召回不是用户编辑，bump 时间戳会让「长期未触碰」的 prune
 * 判定与惰性涌现的脏标记把召回误当成改动（一处时间戳三种语义 = 必然漂移）。
 */
export function applyRecall(record: SparkView, now: number): SparkView {
  return { ...record, recalledCount: (record.recalledCount ?? 0) + 1, lastRecalledAt: now }
}

/**
 * 是否该被过期清理（纯函数，v2 §5.2）：仅 **derived + 到期 + 零召回 + 仍活跃** 的
 * 记录转墓碑（可恢复）。被重新激活或召回过的衍生火花不再过期 —— 那说明它有用。
 */
export function isExpiredDerived(record: SparkView, now: number): boolean {
  return record.origin === 'derived'
    && record.expiresAt !== null
    && record.expiresAt <= now
    && record.recalledCount === 0
    && record.lastRecalledAt === null
    && record.deletedAt === null
    && record.status === 'active'
}

/**
 * 面板排序（纯函数，v2 §6）：`lastRecalledAt` 倒序，空值退化到 `createdAt`。
 *
 * 刻意**不引入"火旺程度 / tier"**——排序需要的是时间戳，不是等级（原则 2 + 8）。
 * 判据确定（同输入同输出），否则面板顺序会随读取顺序抖动。
 */
export function orderForPanel(sparks: readonly SparkView[]): SparkView[] {
  const anchor = (spark: SparkView): number => spark.lastRecalledAt ?? spark.createdAt
  return [...sparks].sort((a, b) => {
    if (b.recalledCount !== a.recalledCount) return b.recalledCount - a.recalledCount
    if (anchor(b) !== anchor(a)) return anchor(b) - anchor(a)
    return a.id.localeCompare(b.id)
  })
}

export interface NewSparkInput {
  id: SparkId
  parsed: SparkCapture
  /** 已解析出的父火花（`derivedFrom` 为空时传 `[]`）。 */
  parents: readonly ProvenanceParent[]
  now: number
  /** 衍生火花存活时长（仅 origin='derived' 用）。 */
  ttlMs: number
}

/**
 * 组装一条新火花记录（纯函数，schema 校验在内）—— **记录组装的唯一入口**。
 *
 * 为什么单独成函数：早先这段是 `capture()` 里的对象字面量，写成
 * `...derivedExpiry(resolveProvenance(...))` 只铺出了 `expiresAt`，
 * origin/derivedFrom/generation 被**静默丢掉**；它逃过了单测（未知父仍会抛错），
 * 最终由真宿主的 provenance 断言抓出来。组装逻辑可单测，就不再靠"看着对"。
 */
export function newSparkView(input: NewSparkInput): SparkView {
  const parsed = input.parsed
  const provenance = resolveProvenance(parsed, input.parents)
  return sparkViewSchema.parse({
    id: input.id,
    title: deriveTitle(parsed.title),
    content: parsed.content,
    scope: parsed.scope,
    workspacePath: parsed.workspacePath,
    status: 'active',
    tags: parsed.tags,
    ...provenance,
    expiresAt: provenance.origin === 'derived' ? input.now + input.ttlMs : null,
    sourceSessionId: parsed.sourceSessionId,
    sourceAgentId: parsed.sourceAgentId,
    sourceTurn: parsed.sourceTurn,
    createdAt: input.now,
    updatedAt: input.now,
    stateChangedAt: input.now,
    deletedAt: null,
  })
}

/** `resolveProvenance` 的父火花最小面（只需 origin + generation）。 */
export interface ProvenanceParent {
  origin: SparkOrigin
  generation: number
}

/** provenance 不变式被破坏（未知父 / 滚雪球）时抛出；HTTP 侧落 400。 */
export class SparkProvenanceError extends Error {
  readonly code = 'SPARK_PROVENANCE_INVALID'
  constructor(message: string) {
    super(message)
  }
}

/** 衍生代数硬上限（v2 设计 §5.3：generation ≤ 2，防语义塌缩）。 */
export const SPARK_MAX_GENERATION = 2

/**
 * 计算 provenance 三元组（纯函数，v2 P12）。不变式由这里集中保证：
 *
 *  - `generation > 0 ⟺ origin === 'derived'`；
 *  - `generation = max(父 generation) + 1`，超过硬上限即拒绝（不滚雪球）；
 *  - `origin='derived'` 的火花不作父本（防近亲繁殖的第一道闸）；
 *  - 非 derived 时 origin = 显式声明 ?? (sourceAgentId 非 null → agent，否则 human)。
 *
 * @throws SparkProvenanceError 未知父 / 父是 derived / 超过 generation 上限。
 */
/**
 * 计算 provenance 三元组（纯函数，v2 P12 + 2026-09-21 语义修正）。
 *
 * **两个维度正交**（这是修正后的口径）：
 *  - `origin` 回答"**谁判断的**"：`human`（人写的）/ `agent`（Agent 判断后写的）/
 *    `derived`（**机器自动生成**：derive 引擎产出的重组物）；
 *  - `derivedFrom` 回答"**据什么来的**"：任何提出者都可以自述来源，它不改变 origin。
 *
 * **反自噬闸只作用于 `origin='derived'`**（机器自动生成那条会滚雪球的路径）：
 *  - `derived` 记录必须带 `derivedFrom`，且 `generation ≤ 2`、父辈不得是 `derived`；
 *  - **人 / Agent 的判断产物不受这些限制**：判断不该被防滚雪的规则挡住，也可以拿
 *    早期衍生物当父本。它们的 `generation` 按父辈计算但**夹到 schema 上限**（那个
 *    字段的语义是"机器滚了几代"，不是"判断的深度"）。
 *
 * 缺省 origin：无 `derivedFrom` 时按 `sourceAgentId` 判（有 → agent，无 → human）；
 * 带 `derivedFrom` 而调用方没显式声明时默认 `agent`（自述来源是 Agent 的行为）。
 *
 * @throws SparkProvenanceError 未知父 / （仅 derived）父是 derived / 超过 generation 上限。
 */
export function resolveProvenance(
  input: { origin?: SparkOrigin | undefined; sourceAgentId: string | null; derivedFrom?: readonly SparkId[] | undefined },
  parents: readonly ProvenanceParent[],
): Pick<SparkView, 'origin' | 'derivedFrom' | 'generation'> {
  const derivedFrom = input.derivedFrom ?? []
  if (derivedFrom.length === 0) {
    return {
      origin: input.origin ?? (input.sourceAgentId !== null ? 'agent' : 'human'),
      derivedFrom: [],
      generation: 0,
    }
  }
  if (parents.length !== derivedFrom.length) {
    throw new SparkProvenanceError('derivedFrom contains unknown spark ids')
  }
  const origin = input.origin ?? 'agent'
  const rawGeneration = Math.max(0, ...parents.map(p => p.generation)) + 1
  if (origin !== 'derived') {
    // 人 / Agent 的判断产物：来源是自述，不做反自噬硬闸（D3）。
    return {
      origin,
      derivedFrom: [...derivedFrom],
      generation: Math.min(SPARK_MAX_GENERATION, rawGeneration),
    }
  }
  if (parents.some(p => p.origin === 'derived')) {
    throw new SparkProvenanceError('a derived spark cannot be a parent (anti-autophagy)')
  }
  if (rawGeneration > SPARK_MAX_GENERATION) {
    throw new SparkProvenanceError('generation cap exceeded (' + SPARK_MAX_GENERATION + ')')
  }
  return { origin: 'derived', derivedFrom: [...derivedFrom], generation: rawGeneration }
}
