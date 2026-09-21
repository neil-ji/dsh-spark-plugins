/**
 * 重要度的**展示档位**（唯一映射表）。
 *
 * 为什么要有它：0..1 的裸数字对用户没有意义（「0.50」既不知道高低、也没有
 * 判断标准），而档位词（关键/重要/一般/次要）一眼可读（2026-09 用户裁决）。
 *
 * 三条纪律：
 *  1. **展示层映射，不改存储**：库里仍然是 0..1 的连续值（引擎的召回加权、
 *     衰减、排序都用原值）。档位只用于显示与编辑器的选择。
 *  2. 阈值与代表值只此一份：编辑器把用户选的档位写成代表值，执行器/列表/详情
 *     全走同一张表，避免「显示 重要、存 0.62、编辑器读回 0.60」的三处漂移。
 *  3. 边界归上不归下（>= 判定）：0.85 恰好是「关键」而不是「重要」。
 */

export type ImportanceTier = 'critical' | 'high' | 'normal' | 'low'

/** 由高到低 —— 编辑器的段控顺序、档位迭代都依赖它。 */
export const IMPORTANCE_TIERS: readonly ImportanceTier[] = ['critical', 'high', 'normal', 'low']

/** 各档位的下界（含）与写入代表值。 */
const TIER_SPEC: Record<ImportanceTier, { min: number; value: number }> = {
  critical: { min: 0.85, value: 0.9 },
  high: { min: 0.6, value: 0.7 },
  normal: { min: 0.35, value: 0.5 },
  low: { min: 0, value: 0.2 },
}

/** 数值 → 档位（边界归上）。越界值按 clamp 处理，不抛错。 */
export function importanceTier(importance: number): ImportanceTier {
  if (!Number.isFinite(importance)) return 'normal'
  const value = Math.min(1, Math.max(0, importance))
  for (const tier of IMPORTANCE_TIERS) {
    if (value >= TIER_SPEC[tier].min) return tier
  }
  return 'low'
}

/** 档位 → 写入值（编辑器选择该档位时存这个数）。 */
export function tierValue(tier: ImportanceTier): number {
  return TIER_SPEC[tier].value
}

/** 该数值是否正好落在某档的代表值上（用于判断"用户没改档位"）。 */
export function isTierRepresentative(importance: number): boolean {
  return tierValue(importanceTier(importance)) === importance
}
