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
  FinancePriceEntryInput,
  FinancePriceRate,
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
 * How a route bills: an exact model-key entry in `billingModes` wins over the
 * provider-level entry; anything unlisted defaults to 'metered' (real wallet
 * spend). Plan routes still get priced at list prices — but the ledger keeps
 * that amount apart so subscriptions never masquerade as cash flow.
 */
export function financeBillingMode(config: FinanceConfig, modelKey: string): 'metered' | 'plan' {
  const modes = config.billingModes
  if (modes !== undefined) {
    const exact = modes[modelKey]
    if (exact !== undefined) return exact
    const providerLevel = modes[financeProviderOf(modelKey)]
    if (providerLevel !== undefined) return providerLevel
  }
  return 'metered'
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

/**
 * Three-tier merge of price tables: `composition` ⊆ `community` ⊆ `user`. Each
 * tier is a raw key→entry/entry-history shape; their strings keys are merged
 * with later-wins (composition < community < user). The result feeds back into
 * `normalizeFinanceConfig` so pricing.ts stays the single owner of price-table
 * shape. Used by `FinanceService.currentConfig` to fold the in-memory community
 * layer between the cordis.patch.yml defaults and the user overlay.
 *
 * Iteration is explicit (no `Object.assign`) so callers can audit each tier in
 * isolation. Empty tiers are skipped — no allocation for absent layers.
 */
export function mergePriceLayers(
  composition: FinanceConfigInput['prices'] | undefined,
  community: FinanceConfigInput['prices'] | undefined,
  user: FinanceConfigInput['prices'] | undefined,
): Record<string, FinanceConfigInput['prices'] extends infer T ? (T extends Record<string, infer V> ? V : never) : never> {
  const merged: Record<string, unknown> = {}
  if (composition !== undefined) Object.assign(merged, composition)
  if (community !== undefined) Object.assign(merged, community)
  if (user !== undefined) Object.assign(merged, user)
  return merged as Record<string, FinanceConfigInput['prices'] extends infer T ? (T extends Record<string, infer V> ? V : never) : never>
}

/** Normalize a raw config into the resolved `FinanceConfig` the ledger prices with. */
export function normalizeFinanceConfig(raw: FinanceConfigInput | FinanceConfig): FinanceConfig {
  const base = raw as FinanceConfig
  return {
    currency: base.currency ?? 'CNY',
    balance: base.balance ?? { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 10_000 },
    defaultPrice: base.defaultPrice ?? DEFAULT_PRICE,
    providerDefaults: base.providerDefaults ?? {},
    billingModes: base.billingModes ?? {},
    prices: normalizeFinancePrices(base.prices),
  }
}