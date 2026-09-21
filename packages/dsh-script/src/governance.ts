/**
 * 治理引擎（Spec §6.2–§6.5）—— 纯函数叶子模块：无 I/O、无 ctx、不写库。
 *
 * 两条不变量靠这个模块的**形状**守住，而不是靠自觉：
 *   - INV-14（建议不定罪）：这里只返回数据，没有任何 patch/append/emit —— 「建议」与
 *     「动作」在类型上就是分开的，动作只能由人面显式发 HTTP 请求触发；
 *   - INV-13（结算幂等）：`expiredIds` 只看 `status === 'active'` 的过期条目，所以第二次
 *     结算必然是空集。
 *
 * 阈值是规范的一部分（Spec §6.2 表），改口径 = 改 Spec 再改这里，禁止散落到 UI。
 */
import type { ScriptAdvice, ScriptAdviceKind, ScriptAuditStats, ScriptView } from 'dsh-script-wire'
import { findDuplicate } from './dedupe.ts'
import { rateBucket, successRate, type ScriptRateBucket } from './metrics.ts'

/** 退役候选：调用够多（有统计意义）且成功率低。 */
export const RETIRE_MIN_INVOCATIONS = 5
export const RETIRE_MAX_SUCCESS_RATE = 0.5

/** 僵尸：活跃、从未被调用、且这么久没被碰过。 */
export const ZOMBIE_IDLE_DAYS = 30

export const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 已退场的状态：退役 / 僵尸 / 合并三类建议都不看它们（已经出库了，再建议是噪音）。 */
export function isRetired(record: Pick<ScriptView, 'status'>): boolean {
  return record.status === 'archived' || record.status === 'superseded'
}

/**
 * 需要结算（自动归档）的过期条目 id（Spec §6.2「过期」行 / INV-13）。
 * 只看 `active`：所以重复结算第二次必然是空集。
 */
export function expiredIds(records: readonly ScriptView[], now: number): string[] {
  return records
    .filter(record => record.status === 'active' && record.expiresAt !== null && record.expiresAt <= now)
    .map(record => record.id)
}

/** 僵尸判定（Spec §6.2）。 */
export function isZombie(record: Pick<ScriptView, 'status' | 'invocationCount' | 'updatedAt'>, now: number): boolean {
  return record.status === 'active'
    && record.invocationCount === 0
    && record.updatedAt < now - ZOMBIE_IDLE_DAYS * MS_PER_DAY
}

/** 末步是不是"验收"步骤（Spec §6.3）。 */
export function hasAcceptanceStep(record: Pick<ScriptView, 'steps'>): boolean {
  const last = record.steps.at(-1)
  return last !== undefined && last.kind === 'instruction' && /^验收[:：]/.test(last.payload.trim())
}

/**
 * 调用证据补丁（Spec §6.2「降级作用域」的病据来源）。
 * @returns 新数组（去重、封顶 32）；工作区未知时返回 `undefined`（不写字段）。
 */
export function invokedWorkspacesPatch(
  current: readonly string[],
  workspacePath: string | null | undefined,
): string[] | undefined {
  if (workspacePath === null || workspacePath === undefined || workspacePath.length === 0) return undefined
  if (current.includes(workspacePath)) return undefined
  return [...current, workspacePath].slice(0, 32)
}

/** 建议 id（稳定，供 UI key 与去重）。 */
export function adviceId(kind: ScriptAdviceKind, scriptId: string, targetId: string | null = null): string {
  return targetId === null ? `${kind}:${scriptId}` : `${kind}:${scriptId}->${targetId}`
}

/** 建议排序权重（Spec §6.2 表顺序 = 处置紧迫度）。 */
const KIND_RANK: Record<ScriptAdviceKind, number> = {
  retire: 0,
  zombie: 1,
  'downgrade-scope': 2,
  'merge-duplicate': 3,
}

/**
 * 回溯判重（Spec §6.2「去重合并」）：全库两两比对，对**较新**的一条提建议、
 * 保留**较早**的为留存者。用与写入时判重同一套规则（`dedupe.ts`）。
 * 已被判为重复者的条目不再作为留存者（避免链条 A←B←C）。
 */
export function duplicatePairs(records: readonly ScriptView[]): { scriptId: string; targetId: string }[] {
  const ordered = [...records].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const consumed = new Set<string>()
  const pairs: { scriptId: string; targetId: string }[] = []
  ordered.forEach((record, index) => {
    if (consumed.has(record.id) || isRetired(record)) return
    const prior = ordered.slice(0, index).filter(other => !consumed.has(other.id) && !isRetired(other))
    const hit = findDuplicate({ name: record.name, steps: record.steps, triggers: record.triggers }, prior)
    if (hit === undefined) return
    pairs.push({ scriptId: record.id, targetId: hit.id })
    consumed.add(record.id)
  })
  return pairs
}

/**
 * 全部治理建议（只读；Spec INV-14）。
 * @param records - 全库记录。
 * @param now - 判定时刻（注入以便单测）。
 */
export function governanceAdvices(records: readonly ScriptView[], now: number): ScriptAdvice[] {
  const advices: ScriptAdvice[] = []
  const evidenceOf = (record: ScriptView): ScriptAdvice['evidence'] => ({
    invocationCount: record.invocationCount,
    successRate: record.invocationCount === 0 ? null : successRate(record),
    idleDays: record.invocationCount === 0 ? Math.floor((now - record.updatedAt) / MS_PER_DAY) : null,
    workspaces: record.invokedWorkspaces.length,
  })

  for (const record of records) {
    if (isRetired(record)) continue
    const evidence = evidenceOf(record)
    if (record.invocationCount >= RETIRE_MIN_INVOCATIONS && successRate(record) < RETIRE_MAX_SUCCESS_RATE) {
      advices.push({
        id: adviceId('retire', record.id),
        kind: 'retire',
        action: 'archive',
        scriptId: record.id,
        name: record.name,
        targetId: null,
        evidence,
      })
      continue
    }
    if (isZombie(record, now)) {
      advices.push({
        id: adviceId('zombie', record.id),
        kind: 'zombie',
        action: 'archive',
        scriptId: record.id,
        name: record.name,
        targetId: null,
        evidence,
      })
      continue
    }
    // `global` 却只在一个工作区被调用过 → 它其实是工作区脚本（Spec §6.2 / D8）。
    if (record.scope === 'global' && record.invokedWorkspaces.length === 1) {
      advices.push({
        id: adviceId('downgrade-scope', record.id),
        kind: 'downgrade-scope',
        action: 'set-scope-workspace',
        scriptId: record.id,
        name: record.name,
        targetId: null,
        evidence,
      })
    }
  }

  const byId = new Map(records.map(record => [record.id, record]))
  for (const pair of duplicatePairs(records)) {
    const record = byId.get(pair.scriptId)
    if (record === undefined) continue
    advices.push({
      id: adviceId('merge-duplicate', pair.scriptId, pair.targetId),
      kind: 'merge-duplicate',
      action: 'merge',
      scriptId: pair.scriptId,
      name: record.name,
      targetId: pair.targetId,
      evidence: evidenceOf(record),
    })
  }

  return advices.sort((a, b) =>
    KIND_RANK[a.kind] - KIND_RANK[b.kind]
    || a.scriptId.localeCompare(b.scriptId)
    || a.id.localeCompare(b.id))
}

/** 空分档计数（避免三处手写初值）。 */
export function emptyRateBuckets(): Record<ScriptRateBucket, number> {
  return { untested: 0, low: 0, mid: 0, high: 0 }
}

/**
 * 审计统计（Spec §6.5）。
 * `total` / `byStatus` / `byScope` 看全库；`rateBuckets` / `acceptance` / `zombies` 只看 `active`。
 */
export function auditStats(records: readonly ScriptView[], now: number): ScriptAuditStats {
  const active = records.filter(record => record.status === 'active')
  const rateBuckets = emptyRateBuckets()
  for (const record of active) rateBuckets[rateBucket(successRate(record), record.invocationCount)] += 1
  const withAcceptanceStep = active.filter(record => hasAcceptanceStep(record)).length
  const countBy = <T extends string>(values: readonly T[], pick: (record: ScriptView) => T): Record<T, number> => {
    const counts = Object.fromEntries(values.map(value => [value, 0])) as Record<T, number>
    for (const record of records) counts[pick(record)] += 1
    return counts
  }
  return {
    total: records.length,
    byStatus: countBy(['active', 'archived', 'superseded', 'candidate'], record => record.status),
    byScope: countBy(['global', 'workspace', 'project'], record => record.scope),
    rateBuckets,
    acceptance: {
      withAcceptanceStep,
      total: active.length,
      ratio: active.length === 0 ? 0 : withAcceptanceStep / active.length,
    },
    zombies: active.filter(record => isZombie(record, now)).length,
  }
}
