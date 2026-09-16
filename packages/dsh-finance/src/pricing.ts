/**
 * Pure cost math over finance token buckets and the config price table. All
 * money is integer micros of the configured currency (1e-6 units), so summing
 * and comparison stay exact.
 *
 * The price table is time-aware in two dimensions:
 * - **era**: each model's `prices` list holds entries with `effectiveFrom`;
 *   the latest entry at or before a usage moment prices it (price changes are
 *   never retrofitted onto older usage).
 * - **window**: a windowed entry prices peak and off-peak local hours
 *   separately (DeepSeek's peak-valley billing). The projection folds usage by
 *   UTC hour, and the pricing side converts that hour to the entry's local
 *   clock at cost time — the projection itself stays timezone-agnostic.
 *
 * When only day/totals buckets exist (no hour detail), the base (off-peak)
 * rate of the era-resolved entry is used — a documented approximation.
 *
 * @module @deepseek-ai/dsh-spark-finance/pricing
 */

import type {
  FinanceConfig,
  FinanceConfigInput,
  FinancePriceEntry,
  FinancePlanEntry,
  FinancePlanEntryInput,
  FinanceTierEntry,
  FinanceTierEntryInput,
  FinancePriceEntryInput,
  FinancePriceRate,
  FinanceProviderBillingMode,
  FinanceTimeBand,
  FinanceTokenBuckets,
  FinanceWindowedRate,
} from './types.ts'

/** The one model key vocabulary: provider and model from a request header. */
export function financeModelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** The provider part of a model key (the part before the first '/'). */
export function financeProviderOf(modelKey: string): string {
  const slash = modelKey.indexOf('/')
  return slash === -1 ? modelKey : modelKey.slice(0, slash)
}

/** The model part of a model key (the part after the first '/'). */
export function financeModelOf(modelKey: string): string {
  const slash = modelKey.indexOf('/')
  return slash === -1 ? modelKey : modelKey.slice(slash + 1)
}

/**
 * The flat fallback rate for a model with no prices[modelKey] entry: the
 * provider's configured default rate when one exists, else the global
 * `defaultPrice`. This is the resolution that lets non-DeepSeek providers
 * (openai/*, anthropic/*, ...) price sensibly without a per-model entry.
 */
export function financeProviderDefault(config: FinanceConfig, modelKey: string): FinancePriceRate {
  return config.providerDefaults?.[financeProviderOf(modelKey)] ?? config.defaultPrice
}

/**
 * How a route bills: read from the resolved `hostMetaByProvider` map (the
 * host-known defaults + every provider the user has registered). Unknown
 * providers default to 'metered' (real wallet spend). Free routes never
 * enter this lookup — they hit the `free-provider` unsupported slot upstream
 * and never get priced for the wallet-vs-plan rollup.
 *
 * Migration note: a route-level `billingModes` map used to let users pin a
 * specific modelKey as plan/metered. The editor surface was retired (no UI
 * to set it on, no defaults that ever classified anything as plan), so the
 * classification now flows exclusively from the host-known provider registry.
 */
export function financeBillingMode(config: FinanceConfig, modelKey: string): FinanceProviderBillingMode {
  const mode = config.hostMetaByProvider[financeProviderOf(modelKey)]
  if (mode === 'plan') return 'plan'
  if (mode === 'free') return 'free'
  return 'metered'
}

/**
 * provider id 的比对键：与客户端 `derive.providerKey` 逐字同口径
 * （`deepseek-official` → `deepseek`，小写）。
 *
 * 为什么需要它：套餐条目里的 provider 是**用户手填/继承来的**字符串，而账本里的
 * provider 是模型键前缀；同一个厂商两侧可能差一个 `-official` 后缀。不归一的话，
 * "填过月费 = 订阅" 这条腿在客户端成立、在宿主不成立 —— 面板把厂商列进订阅卡，
 * 账本却按按量记账。
 */
export function financeProviderKey(provider: string): string {
  return provider.toLowerCase().replace(/-official$/, '')
}

/**
 * 折叠 provider 级计费方式，优先级自低到高：
 *
 *  1. `base`（内置默认，如 deepseek-official = metered）；
 *  2. **填过月费的 provider 视为订阅**（`planProviders`）—— 与客户端
 *     `ThisMonthView.billingFor` 的中间那条腿同口径：老数据（早就填过月费、还没打标记）
 *     不能被当成按量，否则客户端把它排进「订阅计划」卡、账本却按按量记账 →
 *     顶部「订阅等价」恒为 0、按量支出虚高（2026-09-17 真宿主 bug）；
 *  3. 用户层显式标记覆盖上面一切；`isLocked` 为真的 provider 保持宿主决定
 *     （如 deepseek-official 的余额接口是纯按量）—— 锁只挡显式标记这一层，
 *     因为客户端 billingFor 同样让月费条目越过锁，两侧必须一致。
 *
 * 抽成纯函数以便单测这个容易写错、又不容易被 UI 发现的分支。
 */
export function foldProviderBillingModes(
  base: Readonly<Record<string, FinanceProviderBillingMode>>,
  entries: readonly { provider?: unknown; billingMode?: unknown }[] | undefined,
  isLocked: (provider: string) => boolean = () => false,
  planProviders: readonly string[] = [],
): Record<string, FinanceProviderBillingMode> {
  const out: Record<string, FinanceProviderBillingMode> = { ...base }
  for (const raw of planProviders) {
    if (typeof raw !== 'string') continue
    const provider = raw.trim()
    if (provider === '') continue
    // 命中已有键（含 host-known 的 `-official` 写法）就改写那一条，否则按用户填的键登记：
    // 账本查的是模型键前缀，登记一个对不上的键等于没登记。
    const key = Object.keys(out).find(candidate => financeProviderKey(candidate) === financeProviderKey(provider)) ?? provider
    out[key] = 'plan'
  }
  for (const entry of entries ?? []) {
    const provider = entry?.provider
    if (typeof provider !== 'string' || provider === '') continue
    if (isLocked(provider)) continue
    const mode = entry?.billingMode
    if (mode === 'plan' || mode === 'metered' || mode === 'free') out[provider] = mode
  }
  return out
}

/** Empty token buckets. */
export function emptyFinanceBuckets(): FinanceTokenBuckets {
  return {
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  }
}

/** Add two token buckets field by field. */
export function addFinanceBuckets(left: FinanceTokenBuckets, right: FinanceTokenBuckets): FinanceTokenBuckets {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  }
}

/** Price a token bucket with one rate, rounding each line to the nearest micro. */
export function financeBucketCostMicros(buckets: FinanceTokenBuckets, rate: FinancePriceRate): number {
  const perMtok = 1_000_000
  const input = rate.inputMicrosPerMtok
  const cacheRead = rate.cacheReadMicrosPerMtok ?? input
  const cacheWrite = rate.cacheWriteMicrosPerMtok ?? input
  return Math.round(buckets.uncachedInputTokens * input / perMtok)
    + Math.round(buckets.cacheReadTokens * cacheRead / perMtok)
    + Math.round(buckets.cacheWriteTokens * cacheWrite / perMtok)
    + Math.round(buckets.outputTokens * rate.outputMicrosPerMtok / perMtok)
}

/** Default peak windows: DeepSeek official peak hours (Beijing 9:00-12:00, 14:00-18:00). */
export const DEFAULT_PEAK_HOURS: ReadonlyArray<readonly [number, number]> = [[9, 12], [14, 18]]

/**
 * Default peak days: Monday to Friday (1-5). DeepSeek's official peak hours
 * apply on weekdays only — weekends are entirely off-peak.
 */
export const DEFAULT_PEAK_DAYS: ReadonlyArray<number> = [1, 2, 3, 4, 5]

/** Default local clock: UTC+8 (Beijing), the DeepSeek peak-hour reference. */
export const DEFAULT_UTC_OFFSET_MINUTES = 480

/**
 * Fallback flat 24/7 price for models without a prices entry (deepseek-chat
 * era estimate). Placeholder — the real table lives in the bundle config's
 * `prices` map, maintained from official pricing docs.
 */
export const DEFAULT_PRICE: FinancePriceRate = {
  inputMicrosPerMtok: 2_000_000,
  cacheReadMicrosPerMtok: 500_000,
  cacheWriteMicrosPerMtok: 2_000_000,
  outputMicrosPerMtok: 8_000_000,
}

/** True when `localHour` (0-23) falls inside any half-open peak window. */
export function isPeakLocalHour(
  localHour: number,
  peakHours: ReadonlyArray<readonly [number, number]> = DEFAULT_PEAK_HOURS,
): boolean {
  return peakHours.some(([start, end]) => localHour >= start && localHour < end)
}

/**
 * True when `localDay` (0=Sunday..6=Saturday) is a peak day. Defaults to the
 * official weekdays-only schedule; a schedule that peaks every day passes an
 * explicit [0,1,2,3,4,5,6].
 */
export function isPeakLocalDay(
  localDay: number,
  peakDays: ReadonlyArray<number> = DEFAULT_PEAK_DAYS,
): boolean {
  return peakDays.includes(localDay)
}

/** The flat rate of a flat entry, or the off-peak rate of a windowed entry. */
export function financeBaseRate(entry: FinancePriceEntry): FinancePriceRate {
  return entry.kind === 'flat' ? entry.rate : entry.rate.offPeak
}

/**
 * Era-resolve a model's price entries at a moment: the latest entry whose
 * `effectiveFrom` is at or before `timeMs` (the list is sorted ascending,
 * so the first entry with a later `effectiveFrom` ends the search).
 */
function resolveEntries(entries: readonly FinancePriceEntry[] | undefined, timeMs: number): FinancePriceEntry | undefined {
  if (entries === undefined || entries.length === 0) return undefined
  let selected: FinancePriceEntry | undefined
  for (const entry of entries) {
    if (entry.effectiveFrom > timeMs) break
    selected = entry
  }
  return selected
}

/**
 * Era-resolve a model's price entries at a moment, with a bare-model fallback.
 * The exact `${provider}/${model}` key is consulted first; on miss, when the
 * key contains a `/` (so `financeModelOf` differs from the input), the bare
 * model is tried as a wildcard — a `prices['minimax-m3']` entry then prices
 * every `${*}/minimax-m3` call until a more specific entry is added.
 *
 * Concretely, this is the path that lets a vendor-agnostic subscription key
 * like `MiniMax-M3` price every `provider/minimax-m3` request without
 * having to enumerate providers in `cordis.patch.yml`. The unknown-provider
 * model-key call still falls through to `financeProviderDefault` after.
 */
export function financeEntryFor(config: FinanceConfig, modelKey: string, timeMs: number): FinancePriceEntry | undefined {
  const exact = resolveEntries(config.prices[modelKey], timeMs)
  if (exact !== undefined) return exact
  const model = financeModelOf(modelKey)
  if (model !== modelKey) {
    const fallback = resolveEntries(config.prices[model], timeMs)
    if (fallback !== undefined) return fallback
  }
  return undefined
}

/**
 * The moment the windowed (peak/off-peak) era begins across the whole config:
 * the earliest `effectiveFrom` of any windowed price entry. Sessions created
 * before it are legacy — priced entirely at their pre-era flat rate and
 * excluded from the peak/valley split and hour-of-day chart. Returns `null`
 * when no windowed entry exists anywhere (peak/valley billing never applies).
 */
export function financeWindowedSince(config: FinanceConfig): number | null {
  let earliest: number | null = null
  for (const entries of Object.values(config.prices)) {
    for (const entry of entries) {
      if (entry.kind === 'windowed' && (earliest === null || entry.effectiveFrom < earliest)) {
        earliest = entry.effectiveFrom
      }
    }
  }
  return earliest
}

/** Local hour (0-23) of an epoch moment on a clock with the given UTC offset. */
export function financeLocalHour(timeMs: number, utcOffsetMinutes: number): number {
  const utcHour = Math.floor(timeMs / 3_600_000)
  return (((utcHour + utcOffsetMinutes / 60) % 24) + 24) % 24
}

/** Local day of week (0=Sunday..6=Saturday) on a clock with the given UTC offset. */
export function financeLocalDay(timeMs: number, utcOffsetMinutes: number): number {
  return new Date(timeMs + utcOffsetMinutes * 60_000).getUTCDay()
}

/**
 * The full pricing picture for a model at a moment: which time band applies
 * (peak/off-peak on a windowed entry, flat otherwise), the local hour and
 * day on the entry's clock (default UTC+8), and the exact rate. A windowed
 * entry prices peak only when the local hour falls inside a peak window AND
 * the local day is a peak day (weekdays by default). Unknown models resolve
 * as flat at the default rate. The ledger uses this both to price per-hour
 * buckets and to aggregate the peak/off-peak split.
 */
export function financeWindowInfo(config: FinanceConfig, modelKey: string, timeMs: number): {
  band: FinanceTimeBand
  localHour: number
  localDay: number
  rate: FinancePriceRate
} {
  const entry = financeEntryFor(config, modelKey, timeMs)
  if (entry === undefined) {
    return {
      band: 'flat',
      localHour: financeLocalHour(timeMs, DEFAULT_UTC_OFFSET_MINUTES),
      localDay: financeLocalDay(timeMs, DEFAULT_UTC_OFFSET_MINUTES),
      rate: financeProviderDefault(config, modelKey),
    }
  }
  if (entry.kind === 'flat') {
    return {
      band: 'flat',
      localHour: financeLocalHour(timeMs, DEFAULT_UTC_OFFSET_MINUTES),
      localDay: financeLocalDay(timeMs, DEFAULT_UTC_OFFSET_MINUTES),
      rate: entry.rate,
    }
  }
  const offset = entry.rate.utcOffsetMinutes ?? DEFAULT_UTC_OFFSET_MINUTES
  const localHour = financeLocalHour(timeMs, offset)
  const localDay = financeLocalDay(timeMs, offset)
  const peak = isPeakLocalHour(localHour, entry.rate.peakHours ?? DEFAULT_PEAK_HOURS)
    && isPeakLocalDay(localDay, entry.rate.peakDays ?? DEFAULT_PEAK_DAYS)
  return { band: peak ? 'peak' : 'offpeak', localHour, localDay, rate: peak ? entry.rate.peak : entry.rate.offPeak }
}

/**
 * Full rate for a model at a moment: era-resolved, and peak/off-peak aware
 * for windowed entries (the UTC hour is converted to the entry's local clock).
 * Unknown models fall back to the flat `providerDefaults[provider]` rate, then
 * to the global `defaultPrice`.
 */
export function financeRateAt(config: FinanceConfig, modelKey: string, timeMs: number): FinancePriceRate {
  return financeWindowInfo(config, modelKey, timeMs).rate
}

/**
 * 顺序无关的规范化 JSON：era 比较与价格表指纹都靠它 —— 同一组价位的键序不同
 * （YAML 解析 vs 生成器构造）必须判定为「未变化」，否则会反复追加空 era（INV-8）。
 */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(item => stableJson(item)).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // 关键：**丢掉 undefined 值的键**。归一化会给 flat 条目补一个显式
      // `cacheWriteMicrosPerMtok: undefined`（YAML 里本来没这个键），若把它序列化成
      // `null`，配置侧与序列侧的指纹就会不等 —— host 会误报「基础表已被本地改动」。
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item)).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}

/** 生成器负责的 provider 段：基础表指纹只覆盖这一段（社区块另有来源）。 */
export const BASE_PRICE_PROVIDERS: readonly string[] = ['deepseek-official']

/**
 * 价格表指纹（SPEC §2.2 / INV-5）：只覆盖 **结构与数值**，丢掉 `meta`（来源/observedAt 等
 * 之后追加的元数据）与键序。生成物哈希与 host 侧校验必须用同一个函数，否则会假报警。
 */
export function financePricesFingerprint(prices: Record<string, unknown>): string {
  const normalized = normalizeFinancePrices(prices)
  const shaped: Record<string, unknown> = {}
  for (const key of Object.keys(normalized).sort()) {
    shaped[key] = (normalized[key] ?? []).map(entry => ({ effectiveFrom: entry.effectiveFrom, kind: entry.kind, rate: entry.rate }))
  }
  return stableJson(shaped)
}

/** 只取生成器负责的 provider 段（`deepseek-official/*`）做指纹。 */
export function basePriceFingerprint(prices: Record<string, unknown> | undefined): string {
  const subset: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(prices ?? {})) {
    if (BASE_PRICE_PROVIDERS.some(provider => key.startsWith(provider + '/'))) subset[key] = value
  }
  return financePricesFingerprint(subset)
}

/**
 * 一个模型键的定价来源分级（SPEC §4.2「未命中语义」）：
 * - `entry` 命中价格表条目（精确）；
 * - `provider-default` 命中 provider 级默认率（估算，UI 打「估」）；
 * - `builtin-fallback` 落到全局 `defaultPrice`（最弱，就是本次虚高的那条路径 —— 必须打「估」并标注来源）。
 */
export type FinancePriceProvenance = 'entry' | 'provider-default' | 'builtin-fallback'

export function financePriceProvenance(config: FinanceConfig, modelKey: string, timeMs: number): FinancePriceProvenance {
  if (financeEntryFor(config, modelKey, timeMs) !== undefined) return 'entry'
  if (config.providerDefaults?.[financeProviderOf(modelKey)] !== undefined) return 'provider-default'
  return 'builtin-fallback'
}

/** Epoch ms at the start of a UTC hour key `YYYY-MM-DDTHH`. */
export function financeHourTime(hourKey: string): number {
  return Date.UTC(
    Number(hourKey.slice(0, 4)),
    Number(hourKey.slice(5, 7)) - 1,
    Number(hourKey.slice(8, 10)),
    Number(hourKey.slice(11, 13)),
  )
}

/** Exact cost of a model's per-hour buckets: each hour at its own rate. */
export function financeCostByModelHour(config: FinanceConfig, modelKey: string, byHour: Record<string, FinanceTokenBuckets>): number {
  let cost = 0
  for (const [hourKey, buckets] of Object.entries(byHour)) {
    cost += financeBucketCostMicros(buckets, financeRateAt(config, modelKey, financeHourTime(hourKey)))
  }
  return cost
}

/**
 * Cost of buckets without hour detail: the era-resolved base (off-peak) rate.
 * Documented approximation — the hour split is unknown, so peak-hour usage is
 * priced at the cheapest line instead of guessed.
 */
export function financeBaseCostMicros(config: FinanceConfig, modelKey: string, buckets: FinanceTokenBuckets, timeMs: number): number {
  const entry = financeEntryFor(config, modelKey, timeMs)
  return financeBucketCostMicros(buckets, entry === undefined ? financeProviderDefault(config, modelKey) : financeBaseRate(entry))
}

/** Epoch ms from a raw `effectiveFrom` (number, ISO string, or absent). */
function effectiveFromMs(effectiveFrom: string | number | undefined): number {
  if (effectiveFrom === undefined) return 0
  if (typeof effectiveFrom === 'number') return effectiveFrom
  const parsed = Date.parse(effectiveFrom)
  if (Number.isNaN(parsed)) throw new Error(`finance: invalid effectiveFrom date ${JSON.stringify(effectiveFrom)}`)
  return parsed
}

function normalizePriceEntry(input: FinancePriceEntryInput | FinancePriceEntry): FinancePriceEntry {
  if ('kind' in input) return input
  const effectiveFrom = effectiveFromMs(input.effectiveFrom)
  if ('offPeak' in input) {
    return { effectiveFrom, kind: 'windowed', rate: {
      offPeak: input.offPeak,
      peak: input.peak,
      peakHours: input.peakHours as FinanceWindowedRate['peakHours'],
      peakDays: input.peakDays as FinanceWindowedRate['peakDays'],
      utcOffsetMinutes: input.utcOffsetMinutes,
    } }
  }
  return {
    effectiveFrom,
    kind: 'flat',
    rate: {
      inputMicrosPerMtok: input.inputMicrosPerMtok,
      cacheReadMicrosPerMtok: input.cacheReadMicrosPerMtok,
      cacheWriteMicrosPerMtok: input.cacheWriteMicrosPerMtok,
      outputMicrosPerMtok: input.outputMicrosPerMtok,
    },
  }
}

/**
 * Normalize raw `prices` (single entries or lists, string/number
 * `effectiveFrom`) into per-model era-sorted entry lists. Idempotent:
 * already-normalized entries pass through.
 */
export function normalizeFinancePrices(
  prices: Record<string, unknown> | undefined,
): Record<string, readonly FinancePriceEntry[]> {
  const out: Record<string, readonly FinancePriceEntry[]> = {}
  for (const [modelKey, value] of Object.entries(prices ?? {})) {
    const list = Array.isArray(value) ? value as unknown[] : [value]
    out[modelKey] = list
      .map(item => normalizePriceEntry(item as FinancePriceEntryInput | FinancePriceEntry))
      .sort((a, b) => a.effectiveFrom - b.effectiveFrom)
  }
  return out
}

/** 价格值的形状：结构维度（窗口/分档/阶梯）只允许由基础层产出（SPEC INV-1）。 */
export type FinancePriceShape = 'flat' | 'windowed' | 'unknown'

/** 覆盖层被拒绝的原因（SPEC INV-2：形状不兼容时拒绝并记录，绝不静默替换）。 */
export interface FinancePriceMergeDiagnostic {
  key: string
  reason: 'shape-mismatch'
  /** 基础层形状（保留者）。 */
  base: FinancePriceShape
  /** 被拒绝的覆盖层形状。 */
  incoming: FinancePriceShape
}

function asEntryList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [value]
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function shapeOfEntry(entry: unknown): FinancePriceShape {
  const record = recordOf(entry)
  if (record === undefined) return 'unknown'
  const rate = recordOf(record.rate)
  if (rate !== undefined && (rate.offPeak !== undefined || rate.peak !== undefined)) return 'windowed'
  if (record.offPeak !== undefined || record.peak !== undefined) return 'windowed'
  if (record.kind === 'windowed') return 'windowed'
  if (record.kind === 'flat') return 'flat'
  if (rate !== undefined || record.inputMicrosPerMtok !== undefined || record.outputMicrosPerMtok !== undefined) return 'flat'
  return 'unknown'
}

/** 值的形状由最后一个 era 决定（它是当前生效的那条）。 */
export function financePriceShape(value: unknown): FinancePriceShape {
  const list = asEntryList(value)
  return list.length === 0 ? 'unknown' : shapeOfEntry(list[list.length - 1])
}

function effectiveFromOfEntry(entry: unknown): number {
  const raw = recordOf(entry)?.effectiveFrom
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw !== '') {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/**
 * 只把覆盖层的**数值**搬进基础层的 era：窗口、星期、UTC 偏移、阶梯等结构字段一律保留
 * 基础层的值（INV-1）。兼容已归一化（`kind` + `rate`）与原始（`offPeak`/`peak`/`input…`）两种形态。
 */
function overlayNumbers(baseEntry: unknown, incomingEntry: unknown): unknown {
  const base = recordOf(baseEntry)
  const incoming = recordOf(incomingEntry)
  if (base === undefined || incoming === undefined) return baseEntry
  const baseRate = recordOf(base.rate)
  const incomingRate = recordOf(incoming.rate)
  if (baseRate !== undefined) {
    if (baseRate.offPeak !== undefined || baseRate.peak !== undefined) {
      return { ...base, rate: { ...baseRate, offPeak: incomingRate?.offPeak ?? baseRate.offPeak, peak: incomingRate?.peak ?? baseRate.peak } }
    }
    return { ...base, rate: { ...baseRate, ...(incomingRate ?? {}) } }
  }
  if (base.offPeak !== undefined || base.peak !== undefined) {
    return { ...base, offPeak: incoming.offPeak ?? base.offPeak, peak: incoming.peak ?? base.peak }
  }
  const numbers: Record<string, unknown> = {}
  for (const field of ['inputMicrosPerMtok', 'cacheReadMicrosPerMtok', 'cacheWriteMicrosPerMtok', 'outputMicrosPerMtok']) {
    if (incoming[field] !== undefined) numbers[field] = incoming[field]
  }
  return { ...base, ...numbers }
}

/**
 * 同形状合并：**保留基础层全部 era**（INV-4），覆盖层按 `effectiveFrom` 命中则只改数值、
 * 未命中则作为新 era 追加（保持升序）。形态（单值 vs 列表）跟随基础层。
 */
function mergeSameShape(baseValue: unknown, incomingValue: unknown): unknown {
  const out = asEntryList(baseValue).slice()
  for (const incoming of asEntryList(incomingValue)) {
    const at = effectiveFromOfEntry(incoming)
    const index = out.findIndex(entry => effectiveFromOfEntry(entry) === at)
    if (index === -1) out.push(incoming)
    else out[index] = overlayNumbers(out[index], incoming)
  }
  out.sort((a, b) => effectiveFromOfEntry(a) - effectiveFromOfEntry(b))
  return Array.isArray(baseValue) ? out : out[out.length - 1]
}

/**
 * 三层价格合并（`composition` ⊆ `community` ⊆ `user`），带**形状守卫**：
 *
 * - `composition` 是基础层，是**唯一的结构源**；
 * - 覆盖层可以补齐基础层没有的键（长尾模型）；
 * - 同形状（flat↔flat / windowed↔windowed）→ 逐 era 合并，只改数值、保留基础层全部 era；
 * - 形状不兼容（例如 windowed 基础层被 flat 社区快照覆盖）→ **拒绝该键 + 记录诊断**，
 *   基础层原样保留（SPEC INV-1/INV-2）。这条正是"用户点一次更新就把峰谷与纪元抹掉"的防线。
 */
export function mergePriceLayers(
  composition: FinanceConfigInput['prices'] | undefined,
  community: FinanceConfigInput['prices'] | undefined,
  user: FinanceConfigInput['prices'] | undefined,
): Record<string, FinanceConfigInput['prices'] extends infer T ? (T extends Record<string, infer V> ? V : never) : never> {
  return mergePriceLayersDetailed(composition, community, user).prices
}

/** 同 `mergePriceLayers`，但把被拒绝的键一并返回，供 UI 明示（SPEC §5.2）。 */
export function mergePriceLayersDetailed(
  composition: FinanceConfigInput['prices'] | undefined,
  community: FinanceConfigInput['prices'] | undefined,
  user: FinanceConfigInput['prices'] | undefined,
): {
  prices: Record<string, FinanceConfigInput['prices'] extends infer T ? (T extends Record<string, infer V> ? V : never) : never>
  diagnostics: readonly FinancePriceMergeDiagnostic[]
} {
  const diagnostics: FinancePriceMergeDiagnostic[] = []
  const merged: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(composition ?? {})) merged[key] = value
  for (const layer of [community, user]) {
    for (const [key, incoming] of Object.entries(layer ?? {})) {
      const base = merged[key]
      if (base === undefined) { merged[key] = incoming; continue }
      const baseShape = financePriceShape(base)
      const incomingShape = financePriceShape(incoming)
      if (baseShape !== 'unknown' && incomingShape !== 'unknown' && baseShape !== incomingShape) {
        diagnostics.push({ key, reason: 'shape-mismatch', base: baseShape, incoming: incomingShape })
        continue
      }
      merged[key] = mergeSameShape(base, incoming)
    }
  }
  return {
    prices: merged as Record<string, FinanceConfigInput['prices'] extends infer T ? (T extends Record<string, infer V> ? V : never) : never>,
    diagnostics,
  }
}

/**
 * Normalize a raw config into the resolved `FinanceConfig` the ledger prices
 * with. Caller passes the hostMeta map separately (so this pure helper stays
 * unaware of provider-meta); the service layer injects the resolved
 * `hostMetaByProvider` at every callsite.
 */
/**
 * 套餐条目归一化：`effectiveFrom`（日期串 / 数字 / 缺省）一律折算成 epoch ms，
 * 缺省为 0（= 始终生效）。`provider` 保持原样（比对时由调用方归一 `-official`）。
 * 幂等：已归一化的条目直接通过。
 */
export function normalizeFinancePlans(
  plans: readonly FinancePlanEntryInput[] | undefined,
): readonly FinancePlanEntry[] {
  const out: FinancePlanEntry[] = []
  for (const plan of plans ?? []) {
    if (plan === null || typeof plan !== 'object') continue
    const provider = typeof plan.provider === 'string' ? plan.provider.trim() : ''
    if (provider === '') continue
    const monthlyMicros = Number(plan.monthlyMicros)
    if (!Number.isFinite(monthlyMicros) || monthlyMicros < 0) continue
    out.push({
      provider,
      monthlyMicros: Math.round(monthlyMicros),
      currency: typeof plan.currency === 'string' && plan.currency !== '' ? plan.currency : 'CNY',
      ...plan.quotaTokens !== undefined && Number.isFinite(Number(plan.quotaTokens))
        ? { quotaTokens: Math.round(Number(plan.quotaTokens)) }
        : {},
      ...plan.periodLabel !== undefined ? { periodLabel: plan.periodLabel } : {},
      effectiveFrom: financePlanEffectiveFrom(plan.effectiveFrom),
    })
  }
  return out
}

/** 生效期折算：数字 = epoch ms；日期串 = Date.parse；无法解析或缺省 = 0（始终）。 */
function financePlanEffectiveFrom(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/**
 * context 阶梯价归一化：丢掉不可信的档（不猜），按 `maxPromptTokens` 升序排列，
 * `0`（兜底档）恒排最后。空列表的 modelKey 不写入 —— 客户端据此判断"这个模型
 * 没有阶梯价，拆分不改变单价"。
 */
export function normalizeFinanceTiers(
  tiers: Record<string, readonly FinanceTierEntryInput[]> | undefined,
): Record<string, readonly FinanceTierEntry[]> {
  const out: Record<string, readonly FinanceTierEntry[]> = {}
  for (const [modelKey, list] of Object.entries(tiers ?? {})) {
    if (!Array.isArray(list)) continue
    const entries: FinanceTierEntry[] = []
    for (const raw of list) {
      if (raw === null || typeof raw !== 'object') continue
      const maxPromptTokens = Number(raw.maxPromptTokens)
      const input = Number(raw.inputMicrosPerMtok)
      const output = Number(raw.outputMicrosPerMtok)
      if (!Number.isFinite(maxPromptTokens) || maxPromptTokens < 0) continue
      if (!Number.isFinite(input) || input < 0) continue
      if (!Number.isFinite(output) || output < 0) continue
      const cacheRead = Number(raw.cacheReadMicrosPerMtok)
      const cacheWrite = Number(raw.cacheWriteMicrosPerMtok)
      entries.push({
        maxPromptTokens: Math.round(maxPromptTokens),
        inputMicrosPerMtok: Math.round(input),
        outputMicrosPerMtok: Math.round(output),
        ...Number.isFinite(cacheRead) && cacheRead >= 0 ? { cacheReadMicrosPerMtok: Math.round(cacheRead) } : {},
        ...Number.isFinite(cacheWrite) && cacheWrite >= 0 ? { cacheWriteMicrosPerMtok: Math.round(cacheWrite) } : {},
      })
    }
    if (entries.length === 0) continue
    const bounded = entries.filter((entry) => entry.maxPromptTokens > 0).sort((a, b) => a.maxPromptTokens - b.maxPromptTokens)
    const catchAll = entries.filter((entry) => entry.maxPromptTokens === 0)
    out[modelKey] = [...bounded, ...catchAll]
  }
  return out
}

export function normalizeFinanceConfig(
  raw: FinanceConfigInput,
  hostMetaByProvider: Record<string, FinanceProviderBillingMode> = {},
): FinanceConfig {
  // Display currency for the dashboard falls through to 'CNY' for legacy
  // hosts that haven't migrated; per-provider fields surface each account's
  // own currency on the BalanceGrid.
  return {
    currency: 'CNY',
    balance: raw.balance ?? { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 10_000 },
    defaultPrice: raw.defaultPrice ?? DEFAULT_PRICE,
    providerDefaults: raw.providerDefaults ?? {},
    hostMetaByProvider,
    prices: normalizeFinancePrices(raw.prices),
    plans: normalizeFinancePlans(raw.plans),
    tiers: normalizeFinanceTiers(raw.tiers),
    providers: raw.providers ?? [],
  }
}