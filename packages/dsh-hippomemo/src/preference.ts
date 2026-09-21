/**
 * 偏好派生的**纯函数唯一源**（host 与 client 共用）。
 *
 * 为什么单独成模块：`decayPercent` 是宿主算好随 `/hippomemo/preferences` 下发的派生值，
 * 而「这条偏好该不该进待办」是同一套数学的第二个消费者（客户端待办队列）。
 * 规则若在两边各写一份，改一个数就会让「面板说衰减到 40%」与「队列到 60% 才进件」
 * 互相打脸。所以阈值与曲线都放这里：宿主引用它算 decay，客户端引用同一条规则算进件。
 *
 * 依赖面上这里**只允许 type-only import**（types.ts 被 host/client 双方引用，
 * 类型在产物里被擦除）——一旦引入 cordis / storage / react，客户端产物就会被拽进宿主依赖。
 */
import type { MemoryRecord } from './types.ts'

/** 偏好 30 天半衰期：衰减曲线的唯一参数。 */
export const PREFERENCE_HALF_LIFE_DAYS = 30
/** 衰减地板（百分比，剩余量）：低于它的偏好不再继续变淡（留一条底）。 */
export const PREFERENCE_DECAY_FLOOR = 40
/**
 * 「衰减已经压到地板」= 已损失 ≥ 100 - 40 = 60%。
 * 这是**待办进件阈值**：未确认的偏好损失到 60% 才需要人表态（约 40 天没被命中），
 * 否则每个工作区级偏好都会天天排队。
 */
export const PREFERENCE_REVIEW_DECAY = 100 - PREFERENCE_DECAY_FLOOR

/**
 * Heuristic for "is this preference user-declared or auto-mined": if the
 * record carries an explicit `updatedBy: 'human'` author tag it is always
 * manual; otherwise we treat an agent-written record that survived at least
 * one recall as 'auto' (spark's valence miner is the producer). Defaults to
 * 'manual' when uncertain so the UI never over-claims an automatic origin.
 */
export function detectPreferenceSource(record: MemoryRecord): 'auto' | 'manual' {
  if (record.updatedBy === 'human') return 'manual'
  if (record.updatedBy === 'agent') return 'auto'
  // 'system' defaults: sourceSparkId present → auto crystallised from a spark
  return record.sourceSparkId !== undefined && record.sourceSparkId !== null && record.sourceSparkId.length > 0
    ? 'auto'
    : 'manual'
}

/**
 * Compute a 0..100 decay percent for the preference zone. Mirrors the
 * existing recencyDecay curve but maps to a percentage and returns null when
 * the preference is either freshly written or global-confirmed (no decay).
 */
export function computePreferenceDecay(record: MemoryRecord, now: number): number | null {
  if (record.scope === 'global' && record.globalProven === true) return null
  const anchor = record.lastRecalledAt ?? record.updatedAt
  const ageDays = Math.max(0, (now - anchor) / 86_400_000)
  if (ageDays <= 0) return null
  const raw = Math.pow(0.5, ageDays / PREFERENCE_HALF_LIFE_DAYS)
  // recencyDecay is clamped to [floor, 1] — express the *lost* fraction so
  // the UI can label "衰减中 60%" when raw dropped 0.40 below 1.0.
  const decay = Math.max(PREFERENCE_DECAY_FLOOR / 100, raw)
  const lost = Math.max(0, Math.min(100, Math.round((1 - decay) * 100)))
  return lost === 0 ? null : lost
}

/**
 * 待办进件规则：**未确认 + 衰减已压到地板** 的偏好才需要人表态。
 *
 * 入参取 `PreferenceRecord` 里已有的两个派生字段（而不是 MemoryRecord），
 * 这样客户端不需要自己拼 scope/globalProven/half-life —— 规则与数据形状解耦，
 * 两边（宿主已确认 → decay 为 null）天然自洽。
 */
export function preferenceNeedsReview(item: { confirmed: boolean; decayPercent: number | null }): boolean {
  if (item.confirmed) return false
  return item.decayPercent !== null && item.decayPercent >= PREFERENCE_REVIEW_DECAY
}
