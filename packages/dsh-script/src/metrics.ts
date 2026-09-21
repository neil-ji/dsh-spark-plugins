/**
 * 计量与读模型口径（Spec §6.1 / §6.5）—— 纯函数叶子模块，无 I/O、无 ctx。
 *
 * 这里是**全仓唯一**的成功率定义与紧凑读模型构造点：服务、治理引擎、HTTP、注入层都从
 * 这里取值，而不是各自算一遍（Spec INV-7 / D10）。架构闸门 `ratemetric` 只允许本文件
 * 出现那条除法 —— 谁在别处重算，闸门先生效，而不是等人 review 时眼尖。
 */
import { scriptSummarySchema, type ScriptSummary, type ScriptView } from 'dsh-script-wire'

/** 成功率单源（Spec INV-7）：未调用过记 `0`（口径必须可比较，不返回 null）。 */
export function successRate(record: Pick<ScriptView, 'successCount' | 'invocationCount'>): number {
  return record.invocationCount === 0 ? 0 : record.successCount / record.invocationCount
}

/** 成功率分档（Spec §6.5 边界：`low < 0.5 ≤ mid < 0.9 ≤ high`；未调用过单列）。 */
export type ScriptRateBucket = 'untested' | 'low' | 'mid' | 'high'

export const RATE_MID_THRESHOLD = 0.5
export const RATE_HIGH_THRESHOLD = 0.9

/**
 * 分档（纯函数）。
 * @param rate - 已算好的成功率（0..1）。
 * @param invocationCount - 调用次数（0 = 从未调用 → `untested`）。
 */
export function rateBucket(rate: number, invocationCount: number): ScriptRateBucket {
  if (invocationCount === 0) return 'untested'
  if (rate < RATE_MID_THRESHOLD) return 'low'
  if (rate < RATE_HIGH_THRESHOLD) return 'mid'
  return 'high'
}

/**
 * 记录 → 紧凑读模型（**唯一**构造点）：带上 `stepCount` 与宿主算好的 `successRate`。
 * zod 默认剥离未知键，所以 `steps` / `searchTerms` 不会漏进摘要视图。
 */
export function toSummary(record: ScriptView): ScriptSummary {
  return scriptSummarySchema.parse({
    ...record,
    stepCount: record.steps.length,
    successRate: successRate(record),
  })
}
