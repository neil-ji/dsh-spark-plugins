/**
 * 套餐设置面适配：把 settings 命名空间 `finance` 的 scope 收敛成控制器要的 seam。
 *
 * 只有"读 + 整体写回 plans"两条能力，不提供任何独立配置页；候选 provider 由账本
 * 里真正用过的厂商决定（面板侧过滤），所以不会出现你没接入的厂商。
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FinancePlanEntry, FinancePlanPeriod } from 'dsh-spark-finance/types'
import type { FinancePlanSeam } from './controller.ts'

/** settings 里 `finance` 命名空间的形状（只用 plans 一个字段）。 */
export interface FinanceSettingsSection {
  plans?: unknown
}

const PERIODS: readonly FinancePlanPeriod[] = ['month', 'month-week', 'month-week-5h']

function isPeriod(value: unknown): value is FinancePlanPeriod {
  return typeof value === 'string' && (PERIODS as readonly string[]).includes(value)
}

/**
 * 容错归一化：settings 的解析结果可能来自旧版本或手工编辑，字段缺失/类型不对一律
 * 跳过该条（不猜），坏数据不会让整张卡崩掉。
 */
export function normalizePlanList(value: unknown): FinancePlanEntry[] {
  if (!Array.isArray(value)) return []
  const out: FinancePlanEntry[] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
    const monthlyMicros = Number(record.monthlyMicros)
    if (provider === '' || !Number.isFinite(monthlyMicros) || monthlyMicros < 0) continue
    const quotaTokens = Number(record.quotaTokens)
    const effectiveFrom = Number(record.effectiveFrom)
    out.push({
      provider,
      monthlyMicros: Math.round(monthlyMicros),
      currency: typeof record.currency === 'string' && record.currency !== '' ? record.currency : 'CNY',
      ...(Number.isFinite(quotaTokens) && quotaTokens > 0 ? { quotaTokens: Math.round(quotaTokens) } : {}),
      ...(isPeriod(record.periodLabel) ? { periodLabel: record.periodLabel } : {}),
      effectiveFrom: Number.isFinite(effectiveFrom) ? effectiveFrom : 0,
    })
  }
  return out
}

/** settings 侧的写入形状（与宿主 Config schema 对齐）。 */
function toPlanInput(plan: FinancePlanEntry): Record<string, unknown> {
  return {
    provider: plan.provider,
    monthlyMicros: plan.monthlyMicros,
    currency: plan.currency,
    ...(plan.quotaTokens !== undefined ? { quotaTokens: plan.quotaTokens } : {}),
    ...(plan.periodLabel !== undefined ? { periodLabel: plan.periodLabel } : {}),
    effectiveFrom: plan.effectiveFrom,
  }
}

/** 把平台 settings scope 包成控制器要的 seam。 */
export function createPlanSeam(scope: SettingsScope<FinanceSettingsSection>): FinancePlanSeam {
  return {
    getSnapshot: () => {
      const snapshot = scope.getSnapshot()
      return {
        plans: normalizePlanList(snapshot.value?.plans),
        writable: snapshot.writable,
      }
    },
    subscribe: (listener) => scope.subscribe(listener),
    write: async (next) => {
      await scope.set('plans', next.map(toPlanInput))
    },
  }
}

/** 主单位（元 / $）→ micros，供面板输入框使用。 */
export function majorToMicros(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 1_000_000)
}

/** micros → 主单位文本（输入框回填）。 */
export function microsToMajor(micros: number): string {
  return String(micros / 1_000_000)
}

export { PERIODS as FINANCE_PLAN_PERIODS }
