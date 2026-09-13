/**
 * 财务面板的派生计算：纯函数，无 React、无 cordis，全部可单测。
 *
 * 口径（UI 上必须能看到，见 locales 的 *Hint 文案）：
 *  - 缓存命中率 = cacheRead ÷ (uncachedInput + cacheRead + cacheWrite)
 *  - 混合单位成本 = costMicros ÷ 总 token 数（仍是 micros/Mtok）——按你「实际用量结构」
 *    折算的单价，因此同模型跨厂商可直接比大小
 *  - 可用天数 = 余额 ÷ 近 7 日该厂商日均成本（估算，标注为推算）
 */

import type {
  FinanceDayRow,
  FinanceLedger,
  FinanceModelRow,
  FinanceProviderRow,
  FinanceSessionRow,
  FinanceTokenBuckets,
  FinanceWorkspaceRow,
} from 'dsh-spark-finance/types'

/** 计费输入的三个桶（缓存读/写都算输入侧）。 */
export function effectiveInputTokens(buckets: FinanceTokenBuckets): number {
  return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/** 全部四个桶。 */
export function totalTokens(buckets: FinanceTokenBuckets): number {
  return effectiveInputTokens(buckets) + buckets.outputTokens
}

/** 缓存命中率（0..1）；没有任何输入时返回 null（不是 0——0 会读成「全不命中」）。 */
export function hitRate(buckets: FinanceTokenBuckets): number | null {
  const denominator = effectiveInputTokens(buckets)
  if (denominator <= 0) return null
  return buckets.cacheReadTokens / denominator
}

/** 混合单位成本（micros per million tokens）；没有 token 时 null。 */
export function mixedUnitCostMicros(costMicros: number, buckets: FinanceTokenBuckets): number | null {
  const total = totalTokens(buckets)
  if (total <= 0) return null
  return costMicros / (total / 1_000_000)
}

/** 百分比文本；null -> 短横（不冒充 0%）。 */
export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

/** 一行「模型 × 供应商」的对比数据。 */
export interface ModelComparisonRow {
  modelKey: string
  provider: string
  model: string
  costMicros: number
  usage: FinanceTokenBuckets
  /** 该行的缓存命中率；null = 无输入侧用量。 */
  hitRate: number | null
  /** 混合单位成本；null = 无用量。 */
  unitCostMicros: number | null
  billingMode: FinanceModelRow['billingMode']
  shiftSavingsMicros?: number
}

/** byModel 行 -> 对比行（保持账本的成本降序）。 */
export function modelComparisonRows(ledger: FinanceLedger): ModelComparisonRow[] {
  return ledger.byModel.map((row: FinanceModelRow) => ({
    modelKey: row.modelKey,
    provider: row.provider,
    model: row.model,
    costMicros: row.costMicros,
    usage: row.usage,
    hitRate: hitRate(row.usage),
    unitCostMicros: mixedUnitCostMicros(row.costMicros, row.usage),
    billingMode: row.billingMode,
    ...(row.shiftSavingsMicros !== undefined ? { shiftSavingsMicros: row.shiftSavingsMicros } : {}),
  }))
}

/** 同一 modelKey 分组（组内按成本降序）。 */
export function groupByModel(rows: readonly ModelComparisonRow[]): Array<{ modelKey: string; rows: ModelComparisonRow[] }> {
  const groups = new Map<string, ModelComparisonRow[]>()
  for (const row of rows) {
    const list = groups.get(row.modelKey)
    if (list === undefined) groups.set(row.modelKey, [row])
    else list.push(row)
  }
  return [...groups.entries()]
    .map(([modelKey, groupRows]) => ({
      modelKey,
      rows: [...groupRows].sort((a, b) => b.costMicros - a.costMicros),
    }))
    .sort((a, b) => sumCost(b.rows) - sumCost(a.rows))
}

function sumCost(rows: readonly ModelComparisonRow[]): number {
  return rows.reduce((acc, row) => acc + row.costMicros, 0)
}

/**
 * 组内单位成本最低的供应商。只在**双方都有 unitCostMicros** 且差值有意义
 * （> 0.5%）时给结论——样本太小时不硬凑赢家。
 */
export function cheapestInGroup(rows: readonly ModelComparisonRow[]): ModelComparisonRow | null {
  const priced = rows.filter((row) => row.unitCostMicros !== null)
  if (priced.length < 2) return null
  const sorted = [...priced].sort((a, b) => (a.unitCostMicros as number) - (b.unitCostMicros as number))
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  const bestCost = best.unitCostMicros as number
  const worstCost = worst.unitCostMicros as number
  if (worstCost <= 0 || (worstCost - bestCost) / worstCost <= 0.005) return null
  return best
}

/**
 * 命中率差距最大的一组「同一模型、不同供应商」的两行。
 *
 * 刻意**只在同一 modelKey 内部比**：跨模型比命中率没有意义（不同模型的 prompt
 * 结构与缓存策略本就不同），所以这里按模型分组，取组内差距 ≥2 个点且差距最大的一组。
 */
export function cacheExtremes(rows: readonly ModelComparisonRow[]): { best: ModelComparisonRow; worst: ModelComparisonRow } | null {
  const byModel = new Map<string, ModelComparisonRow[]>()
  for (const row of rows) {
    if (row.hitRate === null) continue
    const list = byModel.get(row.modelKey)
    if (list === undefined) byModel.set(row.modelKey, [row])
    else list.push(row)
  }
  let winner: { best: ModelComparisonRow; worst: ModelComparisonRow; spread: number } | null = null
  for (const group of byModel.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => (b.hitRate as number) - (a.hitRate as number))
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]
    const spread = (best.hitRate as number) - (worst.hitRate as number)
    if (spread < 0.02) continue
    if (winner === null || spread > winner.spread) winner = { best, worst, spread }
  }
  return winner === null ? null : { best: winner.best, worst: winner.worst }
}

/**
 * 「把最低命中率那部分 token 提到最高命中率水平」的估算可省金额。
 *
 * 口径（刻意保守，且必须标注为估算）：只用**同一 modelKey 在两个供应商之间的
 * 实测混合单位成本差** × 高成本那一侧的输入侧 token 量。它不假设价格表、不假设
 * 缓存一定命中，只回答「同样的活换个复用更好的通道，按你当前的实际单价能省多少」。
 */
export function estimateCacheSavings(rows: readonly ModelComparisonRow[]): {
  amountMicros: number
  from: ModelComparisonRow
  to: ModelComparisonRow
} | null {
  const extremes = cacheExtremes(rows)
  if (extremes === null) return null
  const { best, worst } = extremes
  if (best.modelKey !== worst.modelKey) return null
  if (best.unitCostMicros === null || worst.unitCostMicros === null) return null
  const unitGap = worst.unitCostMicros - best.unitCostMicros
  if (unitGap <= 0) return null
  const tokens = effectiveInputTokens(worst.usage)
  const amountMicros = (tokens / 1_000_000) * unitGap
  if (!(amountMicros > 0)) return null
  return { amountMicros, from: worst, to: best }
}

/** 近 N 天的日均成本（micros）；没有可用日数据时 null。 */
export function dailyAverageMicros(byDay: readonly FinanceDayRow[], days = 7): number | null {
  if (byDay.length === 0) return null
  const window = [...byDay].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, days)
  if (window.length === 0) return null
  const total = window.reduce((acc, row) => acc + row.costMicros, 0)
  if (total <= 0) return null
  return total / window.length
}

/**
 * 把一个 provider id 归一化到账本的 provider 名：账本用的是模型键前缀
 * （`deepseek`），余额接口用的是 host 注册表 id（`deepseek-official`）。
 */
export function ledgerProviderNames(providerId: string): string[] {
  const stripped = providerId.replace(/-official$/, '')
  return stripped === providerId ? [providerId] : [providerId, stripped]
}

/** 某 provider 在账本里的累计成本（micros）；找不到返回 null。 */
export function providerCostMicros(ledger: FinanceLedger, providerId: string): number | null {
  const names = ledgerProviderNames(providerId)
  const hit = ledger.byProvider.find((row: FinanceProviderRow) => names.includes(row.provider))
  return hit === undefined ? null : hit.costMicros
}

/** 某 provider 的日均成本（micros）。账本没有按 provider 的日粒度，故按总数摊到有数据的天数。 */
export function providerDailyMicros(ledger: FinanceLedger, providerId: string): number | null {
  const cost = providerCostMicros(ledger, providerId)
  if (cost === null || cost <= 0) return null
  const dayCount = Math.max(1, ledger.byDay.length)
  return cost / dayCount
}

/** 余额可支撑天数；余额或日均缺失时 null。 */
export function balanceDaysLeft(balanceMicros: number | undefined, dailyMicros: number | null): number | null {
  if (balanceMicros === undefined || dailyMicros === null || dailyMicros <= 0) return null
  const days = balanceMicros / dailyMicros
  return Number.isFinite(days) ? days : null
}

/** 项目行（按成本降序）。 */
export function projectRows(ledger: FinanceLedger): FinanceWorkspaceRow[] {
  return [...ledger.byWorkspace].sort((a, b) => b.costMicros - a.costMicros)
}

/** 某工作区的会话（按时间倒序）。 */
export function sessionsOfWorkspace(ledger: FinanceLedger, workspaceId: string | null): FinanceSessionRow[] {
  return ledger.sessions
    .filter((session) => (session.workspaceId ?? null) === workspaceId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** 该工作区里每个会话的主模型（第一个，缺失时给 `—`）。 */
export function sessionMainModel(session: FinanceSessionRow): string {
  return session.modelKeys[0] ?? ''
}

/** 会话的时间标签（本地 YYYY-MM-DD）。 */
export function dayKey(epochMs: number): string {
  const date = new Date(epochMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 一组会话按天聚合的成本趋势点（时间升序）。 */
export function sessionsTrend(sessions: readonly FinanceSessionRow[]): Array<{ key: string; label: string; value: number }> {
  const byDay = new Map<string, number>()
  for (const session of sessions) {
    const key = dayKey(session.createdAt)
    byDay.set(key, (byDay.get(key) ?? 0) + session.costMicros)
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => ({ key, label: key.slice(5), value }))
}

/** 峰谷拆分里高峰占总成本的比例（0..1）；没有可用分母时 null。 */
export function peakShare(ledger: FinanceLedger): number | null {
  const total = ledger.totalCostMicros
  if (total <= 0) return null
  return ledger.peakValley.peakCostMicros / total
}
