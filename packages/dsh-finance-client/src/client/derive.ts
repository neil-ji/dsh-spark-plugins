/**
 * 财务面板的派生计算：纯函数，无 React、无 cordis，全部可单测。
 *
 * 口径（UI 上必须能看到，见 locales 的 *Hint 文案）：
 *  - 缓存命中率 = cacheRead ÷ (uncachedInput + cacheRead + cacheWrite)
 *  - 混合单位成本 = costMicros ÷ 总 token 数（仍是 micros/Mtok）——按你「实际用量结构」
 *    折算的单价，因此同模型跨厂商可直接比大小
 *  - 可用天数 = 余额 ÷ 近 7 日该厂商日均成本（估算，标注为推算）
 */

import type { FinanceTranslate } from './locales.ts'
import type {
  FinanceContextBucket,
  FinanceDayRow,
  FinanceLedger,
  FinanceModelRow,
  FinancePlanEntry,
  FinanceProviderRow,
  FinanceRateStats,
  FinanceSessionRow,
  FinanceTierEntry,
  FinanceTierGroup,
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

/**
 * 混合单位成本（micros per million tokens）；没有计费 token 时 null。
 * 分母 = 未命中输入 + 缓存写 + 输出 —— 缓存读按折扣价计费、成本里已体现，
 * 再摊回分母会把单价稀释到失真（真宿主实测 0.34 vs 应为 0.88 CNY/Mtok）。
 */
export function mixedUnitCostMicros(costMicros: number, buckets: FinanceTokenBuckets): number | null {
  const billable = buckets.uncachedInputTokens + buckets.cacheWriteTokens + buckets.outputTokens
  if (billable <= 0) return null
  return costMicros / (billable / 1_000_000)
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
  /** 速率样本；旧会话缺该键（此时不显示速率，而不是显示 0）。 */
  rate?: FinanceRateStats
  /** 上下文长度分布；旧会话缺该键（此时不显示分布与拆分估算）。 */
  context?: readonly FinanceContextBucket[]
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
    ...(row.rate !== undefined ? { rate: row.rate } : {}),
    ...(row.context !== undefined ? { context: row.context } : {}),
  }))
}

/**
 * 按**模型名**分组（不是 modelKey！），组内按成本降序。
 *
 * 关键：`modelKey` 是 `provider/model`，同一个模型由两家供应时 modelKey 天然不同
 * （`deepseek/deepseek-reasoner` vs `tencent/deepseek-reasoner`）。要回答"同一个模型
 * 哪家更划算/更快"，必须按 `model` 分组，否则每家各成一组、永远不存在可比对象。
 */
export function groupByModel(rows: readonly ModelComparisonRow[]): Array<{ model: string; rows: ModelComparisonRow[] }> {
  const groups = new Map<string, ModelComparisonRow[]>()
  for (const row of rows) {
    const list = groups.get(row.model)
    if (list === undefined) groups.set(row.model, [row])
    else list.push(row)
  }
  return [...groups.entries()]
    .map(([model, groupRows]) => ({
      model,
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
 * 刻意**只在同一模型内部比**（按 `model` 而不是 modelKey 分组）：跨模型比命中率
 * 没有意义（不同模型的 prompt 结构与缓存策略本就不同）。
 */
export function cacheExtremes(rows: readonly ModelComparisonRow[]): { best: ModelComparisonRow; worst: ModelComparisonRow } | null {
  const byModel = new Map<string, ModelComparisonRow[]>()
  for (const row of rows) {
    if (row.hitRate === null) continue
    const list = byModel.get(row.model)
    if (list === undefined) byModel.set(row.model, [row])
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
  if (best.model !== worst.model) return null
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
 * （`deepseek-official`），套餐 / 余额接口常写 `deepseek` —— **两个方向都要能对上**，
 * 否则「套餐写 deepseek、账本记 deepseek-official」会静默配不上（等价用量算成 0）。
 * 大小写与 `-official` 后缀一律不敏感，与宿主 `financeProviderKey` 同口径。
 */
export function ledgerProviderNames(providerId: string): string[] {
  const key = providerKey(providerId)
  return [...new Set([providerId, key, `${key}-official`])]
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

/* ─────────────────────── 上下文分布与阶梯价（P2，全部标注估算） ─────────────────────── */

/**
 * 缓存单价解析（SPEC §2.3 规则 1）：绝对价 > 倍率 × 输入价 > 继承输入价。
 * 缓存写多一层 TTL（规则 2）：`cacheWriteMicrosPerMtok` > `cacheWriteMultiplier` >
 * `cacheWriteTtl.m5`（保守，命中率假设最低；不取 `h1`）> 继承输入价。
 */
export function resolveCacheReadMicros(rate: FinanceTierEntry): number {
  if (rate.cacheReadMicrosPerMtok !== undefined) return rate.cacheReadMicrosPerMtok
  if (rate.cacheReadMultiplier !== undefined) return rate.cacheReadMultiplier * rate.inputMicrosPerMtok
  return rate.inputMicrosPerMtok
}

export function resolveCacheWriteMicros(rate: FinanceTierEntry): number {
  if (rate.cacheWriteMicrosPerMtok !== undefined) return rate.cacheWriteMicrosPerMtok
  if (rate.cacheWriteMultiplier !== undefined) return rate.cacheWriteMultiplier * rate.inputMicrosPerMtok
  const ttl = rate.cacheWriteTtl?.m5
  if (ttl !== undefined) return ttl
  return rate.inputMicrosPerMtok
}

/** 一份用量按某个费率档折算成本（micros）。缓存读/写缺省时按输入价算。 */
export function usageCostMicros(usage: FinanceTokenBuckets, rate: FinanceTierEntry): number {
  const input = rate.inputMicrosPerMtok
  const cacheRead = resolveCacheReadMicros(rate)
  const cacheWrite = resolveCacheWriteMicros(rate)
  return (usage.uncachedInputTokens / 1_000_000) * input
    + (usage.cacheReadTokens / 1_000_000) * cacheRead
    + (usage.cacheWriteTokens / 1_000_000) * cacheWrite
    + (usage.outputTokens / 1_000_000) * rate.outputMicrosPerMtok
}

/**
 * 选组结果。**本产品暂不区分国际/国内**（只按中国内地价目计价），所以一个 modelKey
 * 下有多个变体组属于"暂不支持的配置"——必须显式报出，不能猜。
 */
export type TierGroupLookup =
  | { status: 'found'; group: FinanceTierGroup }
  /** 该 modelKey 没有任何阶梯价组。 */
  | { status: 'none' }
  /** 同一 modelKey 下有多个变体组 —— 无从判断哪个对，拒绝估算。 */
  | { status: 'ambiguous'; keys: readonly string[] }

/**
 * 选组（SPEC §2.3 规则 3）。
 *
 * 运行期 `useKey` 形如 `provider/model`（**永不带 `#` 后缀**，取自会话日志的
 * request header），带后缀的组只在配置侧存在；故此处先按原始 key 找、再按剥净后缀
 * 的 modelKey 找，两处都要求**唯一**。
 *
 * 为什么不再"取第一组"：那等于让写入顺序决定用哪套价 —— 一旦同一模型既有国际组
 * 又有国内组，面板会静默按"先写的那组"算账，而界面看不出任何异常。宁可不算。
 */
export function tierGroupFor(
  groups: Record<string, readonly FinanceTierGroup[]>,
  useKey: string,
): TierGroupLookup {
  const direct = groups[useKey]
  if (direct !== undefined && direct.length > 0) return singleOrAmbiguous(direct)
  const hash = useKey.lastIndexOf('#')
  const base = hash > 0 ? useKey.slice(0, hash) : useKey
  const fallback = groups[base]
  if (fallback !== undefined && fallback.length > 0) return singleOrAmbiguous(fallback)
  return { status: 'none' }
}

function singleOrAmbiguous(groups: readonly FinanceTierGroup[]): TierGroupLookup {
  if (groups.length === 1) return { status: 'found', group: groups[0]! }
  return { status: 'ambiguous', keys: groups.map(entry => entry.key) }
}

/** 一组阶梯价是否可用于账本币种 / 当前时刻（SPEC §2.3 规则 5）。 */
export type TierGroupUsability =
  /** 币种一致且落在生效窗口内，可参与估算。 */
  | 'usable'
  /** 计价币种与账本币种不一致：不换算、不参与估算。 */
  | 'currency-mismatch'
  /** 生效窗口已过或未到。 */
  | 'era-mismatch'

export function tierGroupUsability(group: FinanceTierGroup, ledgerCurrency: string, atMs: number): TierGroupUsability {
  if (normalizeCurrency(group.currency) !== normalizeCurrency(ledgerCurrency)) return 'currency-mismatch'
  if (group.effectiveFrom !== undefined && atMs < group.effectiveFrom) return 'era-mismatch'
  if (group.effectiveTo !== undefined && atMs > group.effectiveTo) return 'era-mismatch'
  return 'usable'
}

/** 币种比对：大小写与空白不敏感；空串按缺省 CNY 处理。 */
function normalizeCurrency(value: string): string {
  const trimmed = value.trim().toUpperCase()
  return trimmed === '' ? 'CNY' : trimmed
}

/** 上下文画像：以某个 prompt 上界为界，把用量劈成"界内 / 界外"。 */
export interface ContextProfile {
  /** prompt 长度 <= ceiling 的那部分（四类 token 分别累计）。 */
  atOrBelow: FinanceTokenBuckets
  /** prompt 长度 > ceiling 的那部分。 */
  above: FinanceTokenBuckets
  /** 该模型记录的步数。 */
  steps: number
  /** prompt 超过该界的步数。 */
  stepsAbove: number
  /** 界外 token 的输入侧占比（0..1）；没有输入侧 token 时 null。 */
  shareAbove: number | null
}

/**
 * 桶 -> 画像。**保守归属**：一个桶只有当它的上界本身 <= ceiling 时才计入"界内"，
 * 所以 `ceiling` 落在桶中间时会把这个桶整体算作界外（宁可少算省额）。
 */
export function contextProfile(buckets: readonly FinanceContextBucket[], ceiling: number): ContextProfile {
  let atOrBelow = emptyBuckets()
  let above = emptyBuckets()
  let steps = 0
  let stepsAbove = 0
  for (const bucket of buckets) {
    steps += bucket.steps
    const inRange = bucket.maxPromptTokens !== null && bucket.maxPromptTokens <= ceiling
    if (inRange) {
      atOrBelow = sumBuckets(atOrBelow, bucket.usage)
    } else {
      above = sumBuckets(above, bucket.usage)
      stepsAbove += bucket.steps
    }
  }
  const aboveInput = effectiveInputTokens(above)
  const totalInput = aboveInput + effectiveInputTokens(atOrBelow)
  return {
    atOrBelow,
    above,
    steps,
    stepsAbove,
    shareAbove: totalInput <= 0 ? null : aboveInput / totalInput,
  }
}

function emptyBuckets(): FinanceTokenBuckets {
  return { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
}

function sumBuckets(left: FinanceTokenBuckets, right: FinanceTokenBuckets): FinanceTokenBuckets {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  }
}

/** 某个桶适用的费率档：第一个上界 >= 桶上界的档；没有就用兜底档；再没有就用最后一档。 */
export function tierForBucket(bucket: FinanceContextBucket, tiers: readonly FinanceTierEntry[]): FinanceTierEntry | null {
  if (tiers.length === 0) return null
  const catchAll = tiers.find((tier) => tier.maxPromptTokens === 0)
  if (bucket.maxPromptTokens === null) return catchAll ?? tiers[tiers.length - 1]
  const match = tiers.find((tier) => tier.maxPromptTokens > 0 && tier.maxPromptTokens >= (bucket.maxPromptTokens as number))
  return match ?? catchAll ?? tiers[tiers.length - 1]
}

/** "把每一步都压进最小档"的上限估算。 */
export interface SplitEstimate {
  /** 按你填的阶梯价折算的观测成本（估算，独立于账本的成本口径）。 */
  observedMicros: number
  /** 同样的 token 量全部按最小档费率折算的成本（估算）。 */
  compressedMicros: number
  /** 上限可省 = observed − compressed（不小于 0）。 */
  savedMicros: number
  /** 所用的"最小档"上界（用户填的最小 maxPromptTokens）。 */
  smallestCeiling: number
  /** 落在最小档之上的输入侧 token 占比。 */
  shareAbove: number | null
  /** 已套用的错峰折扣（1 = 没打折）。见 `splitEstimate` 的口径说明。 */
  discountApplied: number
}

/** `splitEstimate` 的可选口径参数。 */
export interface SplitEstimateOptions {
  /**
   * 组声明的错峰折扣（SPEC §2.3 规则 6）。缺省 1。
   *
   * 桶数据没有小时维度，所以无法只给"空闲时段"那一半打折；这里对**两侧**都
   * 套同一个系数：绝对省额随之缩放（5 折的线路省得只有一半），比例不变。
   * 这是刻意的保守选择 —— 宁可少承诺，也不按全价虚报省额。
   */
  offPeakDiscount?: number
}

/**
 * "拆分会话能省多少"的**上限**估算。
 *
 * 口径（UI 必须原样带出）：按用户填的阶梯价，把观测到的每一步按它所在档定价得到
 * `observedMicros`；再把同样的 token 量全部按**最小档**费率定价得到 `compressedMicros`；
 * 差额就是"如果每个请求的上下文都能压进最小档"的上限。它**不含**拆分会话的代价
 * （重发前缀、打掉 prompt cache 命中），所以实际省额一定更小 —— 这也是为什么
 * 卡片文案写的是"上限"。没有阶梯价、或没有最小档时返回 null。
 *
 * 落档语义（SPEC §2.3 规则 7）：**全量按所在档**，不是分段累计 —— 与 7 家官方原文一致。
 * `tierForBucket` 是这条语义的唯一实现，改动它前先读 SPEC。
 */
export function splitEstimate(
  buckets: readonly FinanceContextBucket[],
  tiers: readonly FinanceTierEntry[],
  options: SplitEstimateOptions = {},
): SplitEstimate | null {
  if (buckets.length === 0 || tiers.length === 0) return null
  const smallest = tiers.find((tier) => tier.maxPromptTokens > 0)
  if (smallest === undefined) return null
  const discount = options.offPeakDiscount !== undefined && options.offPeakDiscount > 0 && options.offPeakDiscount <= 1
    ? options.offPeakDiscount
    : 1
  let observedMicros = 0
  let tokens = emptyBuckets()
  for (const bucket of buckets) {
    tokens = sumBuckets(tokens, bucket.usage)
    const tier = tierForBucket(bucket, tiers)
    if (tier !== null) observedMicros += usageCostMicros(bucket.usage, tier)
  }
  if (observedMicros <= 0) return null
  const compressedMicros = usageCostMicros(tokens, smallest)
  const profile = contextProfile(buckets, smallest.maxPromptTokens)
  return {
    observedMicros: observedMicros * discount,
    compressedMicros: compressedMicros * discount,
    savedMicros: Math.max(0, (observedMicros - compressedMicros) * discount),
    smallestCeiling: smallest.maxPromptTokens,
    shareAbove: profile.shareAbove,
    discountApplied: discount,
  }
}

/**
 * 该阶梯价表的**最小档上界** —— 也就是"界外"的分界线本身（`maxPromptTokens > 0` 的第一档）。
 *
 * 为什么单独暴露这个：分界线必须由**价表自己**决定，不能在视图里写死。
 * 2026-09-21 用户裁决：「128K 太小了，几乎随便一个任务就能超过」—— 实测 7 家真实价表里
 * 有 32k / 128k / 200k / 256k / 272k / 512k 六种档位，写死 128k 会让 256k 档的模型
 * （13 处价表）永远显示"界外输入占 ~100%"，而那个"界外"根本不是它的分界。
 *
 * 复用它而不是在视图里另算：`splitEstimate` 内部的"最小档"与这里**同源**，
 * 否则会出现"列头说 >256k、金额却按 32k 档折算"这类自相矛盾。
 *
 * @returns 最小档上界；全是兜底档（`maxPromptTokens = 0`）或没有档位时 null。
 */
export function smallestTierCeiling(tiers: readonly FinanceTierEntry[]): number | null {
  const smallest = tiers.find((tier) => tier.maxPromptTokens > 0)
  return smallest === undefined ? null : smallest.maxPromptTokens
}

/** 面板要能区分"没有阶梯价"与"有价但不可用"——两者文案完全不同（SPEC §2.3 规则 5）。 */
export type SplitEstimateOutcome =
  | { status: 'ok'; estimate: SplitEstimate }
  /** 该模型没有任何阶梯价组。 */
  | { status: 'no-tiers' }
  /** 有价，但计价币种与账本币种不一致：不换算、不参与估算。 */
  | { status: 'currency-mismatch'; tierCurrency: string }
  /** 有价，但生效窗口不覆盖当前时刻。 */
  | { status: 'era-mismatch' }
  /** 有价，但没有可用的上下文用量（或没有最小档，如只有兜底档）。 */
  | { status: 'no-usage' }
  /**
   * 同一 modelKey 下有多个变体组（例如国内 + 国际价目），而运行期拿不到"在用哪条线路"
   * 的信号 —— 无从判断用哪套价，拒绝估算（本产品暂不区分国际/国内）。
   */
  | { status: 'ambiguous'; keys: readonly string[] }

/**
 * 面向面板的取数：先按 `useKey` 选组（规则 3），再过币种 / 生效窗口守卫（规则 5），
 * 最后套错峰折扣（规则 6）交给 `splitEstimate`。
 *
 * `atMs` 由调用方给（面板传 `ledger.generatedAt`），保持本函数是纯函数、可单测。
 */
export function splitEstimateForModel(
  buckets: readonly FinanceContextBucket[],
  groups: Record<string, readonly FinanceTierGroup[]>,
  useKey: string,
  ledgerCurrency: string,
  atMs: number,
): SplitEstimateOutcome {
  const lookup = tierGroupFor(groups, useKey)
  if (lookup.status === 'none') return { status: 'no-tiers' }
  if (lookup.status === 'ambiguous') return { status: 'ambiguous', keys: lookup.keys }
  const { group } = lookup
  const usability = tierGroupUsability(group, ledgerCurrency, atMs)
  if (usability === 'currency-mismatch') return { status: 'currency-mismatch', tierCurrency: group.currency }
  if (usability === 'era-mismatch') return { status: 'era-mismatch' }
  const estimate = splitEstimate(buckets, group.tiers, { offPeakDiscount: group.offPeakDiscount })
  if (estimate === null) return { status: 'no-usage' }
  return { status: 'ok', estimate }
}

/* ─────────────────────────── 速率与时间成本（P1-B） ─────────────────────────── */

/**
 * 输出吞吐（tok/s）= 解码输出 token ÷ 解码墙钟。两个数都得有、时长 > 0 才给结论；
 * 缺数据一律 null（不拿 0 冒充"这个模型不产出"）。
 */
export function outputTokensPerSecond(rate: FinanceRateStats | undefined): number | null {
  if (rate === undefined || rate.decodeMs <= 0 || rate.decodeTokens <= 0) return null
  return rate.decodeTokens / (rate.decodeMs / 1000)
}

/** 平均首 token 延迟（ms）：多久开始出字。 */
export function firstTokenMs(rate: FinanceRateStats | undefined): number | null {
  if (rate === undefined || rate.ttftSteps <= 0) return null
  return rate.ttftMs / rate.ttftSteps
}

/** 吞吐文本（数值部分；单位走 locale）。 */
export function formatSpeed(tokensPerSecond: number | null): string {
  return tokensPerSecond === null ? '—' : tokensPerSecond.toFixed(1)
}

/** 首 token 延迟文本。 */
export function formatMs(ms: number | null): string {
  return ms === null ? '—' : `${Math.round(ms)} ms`
}

/** 同一模型两家的时间成本对比。 */
export interface SpeedComparison {
  fastest: ModelComparisonRow
  slowest: ModelComparisonRow
  /** 慢的那家实际产出的输出 token 量。 */
  tokens: number
  /** 慢的那家实际用的解码分钟数（观测）。 */
  slowestMinutes: number
  /** 同样的 token 量按快的那家速率需要几分钟（估算）。 */
  atFastestMinutes: number
  /** 省下的分钟数（估算）。 */
  savedMinutes: number
}

/**
 * 同一 modelKey 内"最快 vs 最慢"的时间成本对比。
 *
 * 刻意只在同一模型内比（跨模型比吞吐没有意义），且只在吞吐差 ≥1% 时给结论。
 * `savedMinutes` 是**估算**：把慢那家实际产出的 token 量按快那家的实测速率折算，
 * 不做任何"如果换模型"的推断。
 */
export function speedComparison(rows: readonly ModelComparisonRow[]): SpeedComparison | null {
  const rated = rows.filter((row) => outputTokensPerSecond(row.rate) !== null)
  if (rated.length < 2) return null
  const sorted = [...rated].sort(
    (a, b) => (outputTokensPerSecond(b.rate) as number) - (outputTokensPerSecond(a.rate) as number),
  )
  const fastest = sorted[0]
  const slowest = sorted[sorted.length - 1]
  if (fastest.model !== slowest.model) return null
  const fastSpeed = outputTokensPerSecond(fastest.rate) as number
  const slowSpeed = outputTokensPerSecond(slowest.rate) as number
  if (fastSpeed <= slowSpeed * 1.01) return null
  const tokens = slowest.rate?.decodeTokens ?? 0
  if (tokens <= 0) return null
  const slowestMinutes = tokens / slowSpeed / 60
  const atFastestMinutes = tokens / fastSpeed / 60
  return { fastest, slowest, tokens, slowestMinutes, atFastestMinutes, savedMinutes: slowestMinutes - atFastestMinutes }
}

/* ─────────────────────────── 订阅 vs 按量（P1） ─────────────────────────── */

/** 一条套餐的对比结论。月费由用户填一次，等价按量价来自账本（订阅路线按目录价折算）。 */
export interface PlanInsight {
  provider: string
  currency: string
  monthlyMicros: number
  /** 本月按量目录价等价（`ledger.byProvider.costMicros`）。 */
  equivalentMicros: number
  /** 正 = 省了，负 = 亏了。 */
  savingsMicros: number
  /** 折扣率 = 1 − 月费 ÷ 等价按量价；>0 表示按月费算比按量划算。null = 本月没有等价用量。 */
  discountRate: number | null
  /** 回本进度 = 等价按量价 ÷ 月费（1.0 = 刚好回本）。null = 没填月费。 */
  breakEvenRatio: number | null
}

/**
 * provider 比对键：账本用模型键前缀（`deepseek`），余额/套餐可能带 `-official`。
 * 先小写再剥后缀 —— 用户手写的套餐条目可能写成 `DeepSeek-Official`，宿主侧
 * `financeProviderKey` 是同一口径（大小写不敏感），两侧必须逐字一致。
 */
export function providerKey(provider: string): string {
  return provider.toLowerCase().replace(/-official$/, '')
}

/** 一条套餐 × 账本 → 对比结论。全观测值相减，没有估算成分。 */
export function planInsight(plan: { provider: string; monthlyMicros: number; currency: string }, ledger: FinanceLedger): PlanInsight {
  const equivalentMicros = providerCostMicros(ledger, plan.provider) ?? 0
  return {
    provider: plan.provider,
    currency: plan.currency,
    monthlyMicros: plan.monthlyMicros,
    equivalentMicros,
    savingsMicros: equivalentMicros - plan.monthlyMicros,
    discountRate: equivalentMicros > 0 ? 1 - plan.monthlyMicros / equivalentMicros : null,
    breakEvenRatio: plan.monthlyMicros > 0 ? equivalentMicros / plan.monthlyMicros : null,
  }
}

/**
 * 订阅卡的两种行：
 *  - `withPlan`：已填套餐的 provider（可能同时有用量）；
 *  - `withoutPlan`：**你实际用过但还没填月费**的 provider（从这里按需填写，
 *    没接入过的 provider 永远不出现 —— 这就是"只呈现你的实体"原则）。
 */
export function planRows(
  ledger: FinanceLedger,
  plans: readonly { provider: string; monthlyMicros: number; currency: string }[],
): { withPlan: PlanInsight[]; withoutPlan: string[] } {
  const planned = new Set(plans.map((plan) => providerKey(plan.provider)))
  const withPlan = plans
    .map((plan) => planInsight(plan, ledger))
    .sort((a, b) => b.equivalentMicros - a.equivalentMicros)
  const withoutPlan = ledger.byProvider
    .map((row) => row.provider)
    .filter((provider) => !planned.has(providerKey(provider)))
    .sort((a, b) => a.localeCompare(b))
  return { withPlan, withoutPlan }
}

/* ───────────── 项目账：按量现金 + 订阅估价（周期内用量占比分摊） ───────────── */

/** 项目账表格行：按量现金 + 订阅估价 + token / 耗时。 */
export interface ProjectCostRow {
  workspaceId: string | null
  title: string
  sessionCount: number
  /** 按量现金消耗：无套餐厂商的目录价成本（= 真金白银）。 */
  meteredMicros: number
  /**
   * 订阅估价：套餐费是沉没成本（用不到上限也不退），所以按「当周项目占全部项目
   * 按量等价的比例」分摊周费，跨周累加。见 `planEstimateHint` 文案。
   */
  planEstimateMicros: number
  /** 消耗合计 = 按量 + 订阅估价。 */
  totalMicros: number
  /** 该项目全部 token（四桶合计）。 */
  totalTokens: number
  /** 由 byModel 实测速率 × 项目输出 token 推算的输出耗时（秒）；无速率样本时 null。 */
  durationSeconds: number | null
}

/** modelKey → provider 段（`provider/model` 前缀；无 `/` 时整个键当 provider）。 */
function providerOfModelKey(modelKey: string): string {
  const slash = modelKey.indexOf('/')
  return slash === -1 ? modelKey : modelKey.slice(0, slash)
}

/** 某月的天数与「7 天一周」的周数（ceil；31 天月 = 5 周）。 */
function monthWeeks(epochMs: number): { monthKey: string; weeks: number; dayOfMonth: number } {
  const date = new Date(epochMs)
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return {
    monthKey: `${date.getFullYear()}-${date.getMonth()}`,
    weeks: Math.ceil(daysInMonth / 7),
    dayOfMonth: date.getDate(),
  }
}

/**
 * 项目成本行（含订阅估价）。算法（SPEC §5.4 推广）：
 *
 * 1. 套餐月费固定：`周费 = 月费 ÷ 当月周数`（31 天月 = ceil(31/7) = 5 周 → 100 元月费
 *    = 每周 20 元）。周上限 / 5 小时上限触发与否不影响这笔钱 —— 沉没成本。
 * 2. 每个周内：分母 = 全部项目在该厂商模型上的按量等价金额之和；分子 = 单个项目在该
 *    厂商模型上的按量等价金额。`分子 ÷ 分母 × 周费` = 该周该项目的订阅估价。
 * 3. 跨周累加得到项目订阅估价；加上按量厂商的现金消耗即为项目总消耗。
 *
 * 会话成本按 modelKeys 均摊到模型（账本只有会话级成本，模型级拆分是估算）。
 * 订阅路线的会话成本本身就是目录价等价（SPEC INV-1），可直接当「按量等价」用。
 */
export function projectCostRows(ledger: FinanceLedger, plans: readonly FinancePlanEntry[]): ProjectCostRow[] {
  /** 套餐月费：providerKey（大小写 / `-official` 归一）→ monthlyMicros。 */
  const planFee = new Map<string, number>()
  for (const plan of plans) planFee.set(providerKey(plan.provider), plan.monthlyMicros)

  // 分摊桶：`provider|month|weekIdx` → { weeks, denom, perWorkspace }
  interface Bucket { weeks: number; denom: number; ws: Map<string, number> }
  const bucketsByWeek = new Map<string, Bucket>()
  const metered = new Map<string, number>()

  for (const session of ledger.sessions) {
    const wsKey = session.workspaceId ?? 'none'
    if (session.modelKeys.length === 0) {
      metered.set(wsKey, (metered.get(wsKey) ?? 0) + session.costMicros)
      continue
    }
    const share = session.costMicros / session.modelKeys.length
    for (const modelKey of session.modelKeys) {
      const provider = providerKey(providerOfModelKey(modelKey))
      const fee = planFee.get(provider)
      if (fee === undefined) {
        metered.set(wsKey, (metered.get(wsKey) ?? 0) + share)
        continue
      }
      const { monthKey, weeks, dayOfMonth } = monthWeeks(session.createdAt)
      const weekIdx = Math.min(Math.floor((dayOfMonth - 1) / 7), weeks - 1)
      const bucketKey = `${provider}|${monthKey}|${weekIdx}`
      const bucket = bucketsByWeek.get(bucketKey) ?? { weeks, denom: 0, ws: new Map() }
      bucket.denom += share
      bucket.ws.set(wsKey, (bucket.ws.get(wsKey) ?? 0) + share)
      bucketsByWeek.set(bucketKey, bucket)
    }
  }

  // 周费分摊：分子 / 分母 × 周费，跨周累加到项目。周费 = 月费 ÷ 当月周数（沉没成本均摊）。
  const planEstimate = new Map<string, number>()
  for (const [key, bucket] of bucketsByWeek) {
    const provider = key.split('|')[0] ?? ''
    const weeklyFee = (planFee.get(provider) ?? 0) / bucket.weeks
    if (weeklyFee <= 0 || bucket.denom <= 0) continue
    for (const [wsKey, numerator] of bucket.ws) {
      planEstimate.set(wsKey, (planEstimate.get(wsKey) ?? 0) + (numerator / bucket.denom) * weeklyFee)
    }
  }

  // 输出耗时估算：全局实测速率（decodeTokens/decodeMs）× 项目输出 token。
  let decodeMs = 0
  let decodeTokens = 0
  for (const model of ledger.byModel) {
    if (model.rate === undefined) continue
    decodeMs += model.rate.decodeMs
    decodeTokens += model.rate.decodeTokens
  }
  const msPerOutputToken = decodeTokens > 0 ? decodeMs / decodeTokens : null

  return ledger.byWorkspace
    .map((row): ProjectCostRow => {
      const wsKey = row.workspaceId ?? 'none'
      const plan = planEstimate.get(wsKey) ?? 0
      const meter = metered.get(wsKey) ?? 0
      return {
        workspaceId: row.workspaceId,
        title: row.title,
        sessionCount: row.sessionCount,
        meteredMicros: Math.round(meter),
        planEstimateMicros: Math.round(plan),
        totalMicros: Math.round(meter + plan),
        totalTokens: totalTokens(row.usage),
        durationSeconds: msPerOutputToken === null
          ? null
          : Math.round((totalTokens(row.usage) - effectiveInputTokens(row.usage)) * msPerOutputToken / 1000),
      }
    })
    .sort((a, b) => b.totalMicros - a.totalMicros)
}

/** token 计数格式化：<1K 原样，1K–1M 用 K（1000），≥1M 用 M（1,000,000），最多 1 位小数并去尾零。 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0'
  if (count < 1_000) return String(Math.round(count))
  const trim = (value: number): string => {
    const fixed = value.toFixed(1)
    return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
  }
  if (count < 1_000_000) return `${trim(count / 1_000)}K`
  return `${trim(count / 1_000_000)}M`
}

/**
 * 人类易读的相对时间：秒 → 分钟 → 小时 → 天 → 月（30 天近似，超过按月计）。
 * 「0 分钟前」这类无信息表述不允许出现，最低粒度是秒。
 */
export function relativeTime(epochMs: number, t: FinanceTranslate): string {
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000))
  if (seconds < 60) return t('timeSeconds', { n: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('timeMinutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('timeHours', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('timeDays', { n: days })
  return t('timeMonths', { n: Math.floor(days / 30) })
}

/* ───────────────── 窗口归因与双值性价比（SPEC §10.8） ───────────────── */

/**
 * 一个窗口的「性价比」双值。
 *
 * 用户定义的两个值（2026-09-19 裁决）：
 *  - **窗口估价**：订阅月费按窗口长度折算的周期均值 —— "这个窗口我付了多少订阅费"；
 *  - **按量等价**：该窗口实际用量按目录价折算 —— "同样用量走按量要花多少"。
 *
 * 二者之差就是**性价比的明确相对标准**：等价 > 估价 = 这个窗口用订阅赚了。
 *
 * 口径与既有 `planInsight`（月度）**同一个公式、不同分母**，所以月度卡与窗口卡的数字
 * 天然自洽，不会互相打架。
 */
export interface WindowPlanVerdict {
  /** 该窗口的按量等价（目录价折算；订阅路线不是现金流）。 */
  equivalentMicros: number
  /** 该窗口的订阅估价（月费 × 窗口长度 ÷ 30 天）；未填月费时 null。 */
  plannedMicros: number | null
  /** 等价 − 估价；正 = 赚了。未填月费时 null。 */
  savingsMicros: number | null
  /** 等价 ÷ 估价；>1 = 赚了。未填月费或估价为 0 时 null。 */
  valueRatio: number | null
}

/** 名义月长（30 天）：与宿主 `WINDOW_SPANS` 的 month 保持一致（SPEC §10.8 决策 D1）。 */
const NOMINAL_MONTH_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 算一个窗口的性价比双值。
 *
 * @param costMicros - 该窗口的目录价等价（来自账本窗口切片）。
 * @param windowMs - 窗口长度。
 * @param monthlyMicros - 订阅月费；undefined = 未填（按量厂商或还没填月费）。
 */
export function windowPlanVerdict(
  costMicros: number,
  windowMs: number,
  monthlyMicros: number | undefined,
): WindowPlanVerdict {
  if (monthlyMicros === undefined || monthlyMicros <= 0 || windowMs <= 0) {
    return { equivalentMicros: costMicros, plannedMicros: null, savingsMicros: null, valueRatio: null }
  }
  const plannedMicros = (monthlyMicros * windowMs) / NOMINAL_MONTH_MS
  return {
    equivalentMicros: costMicros,
    plannedMicros,
    savingsMicros: costMicros - plannedMicros,
    valueRatio: plannedMicros > 0 ? costMicros / plannedMicros : null,
  }
}

/**
 * 解码时长的可读呈现：秒 → 分秒 → 时分。
 * 窗口归因里"用了多久"是核心问题之一，必须能一眼读出量级。
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours}h` : `${hours}h${restMinutes}m`
}

/**
 * 重置倒计时（"还有多久能再用"）。
 * 已过期返回 null —— 调用方据此不显示倒计时（不显示"已重置"，那是无信息表述）。
 */
export function resetCountdown(resetAtMs: number | null, nowMs: number): string | null {
  if (resetAtMs === null) return null
  const remaining = resetAtMs - nowMs
  if (remaining <= 0) return null
  return formatDuration(remaining)
}

/* ───────────────── 转置对比：每行一个指标、每列一个供应商 ───────────────── */

/** 指标方向：决定"最优"是取最小还是最大。 */
export type CompareMetricDirection = 'lower-better' | 'higher-better' | 'neutral'

/** 可横向对比的指标键（视图据此取词）。 */
export type CompareMetricKey =
  | 'cost' | 'unitCost' | 'hitRate' | 'speed' | 'ttft'
  | 'input' | 'cacheRead' | 'cacheWrite' | 'output'

export interface CompareMetricCell {
  provider: string
  /** 原始数值；null = 该供应商无此指标数据（不参与最优判定）。 */
  value: number | null
  /** 是否该行最优（并列时同时为 true）。 */
  best: boolean
  /**
   * 与最优值的**有符号相对差**：`(value − best) / best`。
   *  - 正 = 比最优大（单位成本/延迟 = 更差；速率/命中率 = 更好）
   *  - 0 = 就是最优；null = 无数据或该行不可比（neutral / 最优值为 0）
   *
   * 刻意**不给方向化的"好/坏"符号**：只报客观差值，好坏的解读交给列头与
   * 「最优」标记 —— 把 +/− 重新解释成"更好/更差"会在两类指标间翻转语义。
   */
  gapRatio: number | null
}

export interface CompareMetricRow {
  metric: CompareMetricKey
  direction: CompareMetricDirection
  cells: readonly CompareMetricCell[]
  /** 该行是否判出了最优（≥2 家都有数据，且最优值非 0）。 */
  hasBest: boolean
}

interface CompareMetricSpec {
  metric: CompareMetricKey
  direction: CompareMetricDirection
  pick: (row: ModelComparisonRow) => number | null
}

/**
 * 指标表（顺序即渲染顺序）。
 *
 * 前半是**质量指标**（可判最优）：单位成本、命中率、输出速率、首 token 延迟。
 * 后半是**用量构成**（全 neutral，不判最优）：四个 token 桶与总成本 ——
 * 它们由**用量规模**决定，不是质量指标。同一模型下 A 家花了 ¥10、B 家 ¥1，
 * 只说明 A 承载了更多活，不说明 A 更贵；给它们标"最优/最差"是**算错**
 * （违背"宁可不算，不可算错"）。可比的成本口径是单位成本，它才是同口径的单价。
 *
 * 2026-09-20：四个 token 桶原先藏在「明细」展开区里，现提升为表格的行 ——
 * 用户原话"你说的明细，其实完全可以加若干行"。于是展开按钮整个退役。
 */
const COMPARE_METRICS: readonly CompareMetricSpec[] = [
  { metric: 'unitCost', direction: 'lower-better', pick: (row) => row.unitCostMicros },
  { metric: 'hitRate', direction: 'higher-better', pick: (row) => row.hitRate },
  { metric: 'speed', direction: 'higher-better', pick: (row) => outputTokensPerSecond(row.rate) },
  { metric: 'ttft', direction: 'lower-better', pick: (row) => firstTokenMs(row.rate) },
  // 用量构成（原先藏在「明细」展开区里）：它们同样是可横向对比的指标，
  // 放进表里就多四行，不必再点开。全为 **neutral** —— 用得多说明活多，
  // 不代表更好或更差（同总成本的道理）。
  { metric: 'input', direction: 'neutral', pick: (row) => row.usage.uncachedInputTokens },
  { metric: 'cacheRead', direction: 'neutral', pick: (row) => row.usage.cacheReadTokens },
  { metric: 'cacheWrite', direction: 'neutral', pick: (row) => row.usage.cacheWriteTokens },
  { metric: 'output', direction: 'neutral', pick: (row) => row.usage.outputTokens },
  { metric: 'cost', direction: 'neutral', pick: (row) => row.costMicros },
]

/**
 * 把「同一模型的若干供应商」折成**转置**的指标行：每行一个指标、每列一个供应商。
 *
 * 每行取最优（单位成本/延迟取最小，命中率/速率取最大），其余格给出与最优的
 * 有符号相对差 —— 用户据此一眼看出"相差百分之多少"。
 *
 * 最优值退化为 0 时放弃该行的最优判定（相对差会除零/无限放大），`hasBest=false`。
 * 单个供应商时同样不判最优（没有可比对象）。
 *
 * @param rows - 同一模型下的供应商行（顺序决定列顺序，调用方负责排序）。
 */
export function compareMetricRows(rows: readonly ModelComparisonRow[]): CompareMetricRow[] {
  return COMPARE_METRICS.map((spec) => {
    const values = rows.map((row) => spec.pick(row))
    const usable = values.filter((value): value is number => value !== null && Number.isFinite(value))
    let bestValue: number | null = null
    if (spec.direction !== 'neutral' && usable.length >= 2) {
      bestValue = spec.direction === 'lower-better' ? Math.min(...usable) : Math.max(...usable)
      // 0 作分母无意义（延迟/成本理论上不该为 0，真为 0 时放弃判定而不是给 ∞%）。
      if (bestValue === 0) bestValue = null
    }
    const cells: CompareMetricCell[] = rows.map((row, index) => {
      const value = values[index]
      if (value === null || !Number.isFinite(value)) {
        return { provider: row.provider, value: null, best: false, gapRatio: null }
      }
      if (bestValue === null) {
        return { provider: row.provider, value, best: false, gapRatio: null }
      }
      const gapRatio = (value - bestValue) / bestValue
      return { provider: row.provider, value, best: value === bestValue, gapRatio }
    })
    return { metric: spec.metric, direction: spec.direction, cells, hasBest: bestValue !== null }
  })
}

/**
 * 相对差文本（带符号，一位小数）：`+12.7%` / `−12.1%` / `0%`。
 * 用数学减号 U+2212 而非连字符，与其余数字排版一致。
 */
export function formatGapRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—'
  const pct = ratio * 100
  if (Math.abs(pct) < 0.05) return '0%'
  const sign = pct > 0 ? '+' : '−'
  return `${sign}${Math.abs(pct).toFixed(1)}%`
}
