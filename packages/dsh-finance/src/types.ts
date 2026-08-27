/**
 * Client-safe finance vocabulary shared by the host ledger service and the
 * web finance-audit surface. Types only; the projection key declaration lives
 * here so client aggregates import one face without dragging the host service.
 *
 * @module @deepseek-ai/dsh-finance/types
 */

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Provider-reported token buckets accumulated by model and by UTC day. */
    financeUsage: FinanceUsageProjection
    /**
     * Provider-reported token buckets accumulated by model and by UTC hour
     * (`YYYY-MM-DDTHH`). The hour key is what lets the ledger price each
     * usage hour at its own peak/off-peak rate. Registered as a SEPARATE unit
     * from `financeUsage` on purpose: bumping the shared unit's
     * `stateVersion` would discard every cached checkpoint (the cache drops
     * rows on version mismatch, never migrates), forcing a full log replay of
     * every session. Sessions checkpointed before this unit existed simply
     * lack it and fall back to `financeUsage` totals priced at the base
     * (off-peak) rate — same graceful degradation as the `tokenUsage` path.
     */
    financeUsageHourly: FinanceHourlyProjection
    /**
     * Provider-reported token totals from the harness core token-meter.
     * Checkpointed for every session (including ones persisted before this
     * plugin existed), so the ledger can read historical totals with zero log
     * replay. Structurally identical to FinanceTokenBuckets.
     */
    tokenUsage: FinanceTokenBuckets
  }
}

/** Disjoint token buckets for one model call or aggregate. */
export interface FinanceTokenBuckets {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

/** Durable finance projection value for one session log. */
export interface FinanceUsageProjection {
  /** Keyed by `${provider}/${model}`, the request-header route at usage time. */
  byModel: Record<string, FinanceTokenBuckets>
  /** Keyed by YYYY-MM-DD in UTC. */
  byDay: Record<string, FinanceTokenBuckets>
  totals: FinanceTokenBuckets
}

/** Durable per-hour finance projection value for one session log. */
export interface FinanceHourlyProjection {
  /** Keyed by modelKey, then by UTC hour key `YYYY-MM-DDTHH`. */
  byModelHour: Record<string, Record<string, FinanceTokenBuckets>>
}

/**
 * Price rate expressed in integer micros per million tokens. Cache fields are
 * optional: when absent the input rate is used (DeepSeek has no separate
 * cache-write line; its API never reports cache writes).
 */
export interface FinancePriceRate {
  inputMicrosPerMtok: number
  cacheReadMicrosPerMtok?: number
  cacheWriteMicrosPerMtok?: number
  outputMicrosPerMtok: number
}

/**
 * Time-of-day pricing for one model: separate rates for peak and off-peak
 * local hours. Peak windows are half-open hour ranges (end exclusive) that
 * apply only on the listed days of the week. Defaults follow DeepSeek's
 * official peak window: weekdays (Mon-Fri) 9:00-12:00 and 14:00-18:00
 * Beijing time, i.e. UTC+8.
 */
export interface FinanceWindowedRate {
  /** Rate applied outside every peak window. */
  offPeak: FinancePriceRate
  /** Rate applied inside any peak window. */
  peak: FinancePriceRate
  /** Half-open local-hour ranges; default [[9,12],[14,18]]. */
  peakHours?: ReadonlyArray<readonly [number, number]>
  /**
   * Days of the week (0=Sunday..6=Saturday on the entry's local clock) the
   * peak windows apply on; default weekdays [1,2,3,4,5] (Mon-Fri), matching
   * DeepSeek's official peak hours. Omit only when a schedule genuinely peaks
   * every day.
   */
  peakDays?: ReadonlyArray<number>
  /** UTC offset in minutes for the local hour clock; default 480 (UTC+8). */
  utcOffsetMinutes?: number
}

/**
 * One normalized price-table entry: a rate (flat 24/7 or peak/off-peak) that
 * applies from a moment onward. Several entries per model form an era history
 * — the latest entry whose `effectiveFrom` is <= the usage time prices it.
 */
export type FinancePriceEntry =
  | { effectiveFrom: number; kind: 'flat'; rate: FinancePriceRate }
  | { effectiveFrom: number; kind: 'windowed'; rate: FinanceWindowedRate }

/**
 * Raw price entry as configured in YAML/settings, before normalization. The
 * shapes deliberately mirror schemastery's inferred input types (mutable
 * arrays, optional effectiveFrom) so the settings schema stays assignable.
 */
export type FinancePriceEntryInput =
  | {
    effectiveFrom?: string | number
    inputMicrosPerMtok: number
    cacheReadMicrosPerMtok?: number
    cacheWriteMicrosPerMtok?: number
    outputMicrosPerMtok: number
  }
  | {
    effectiveFrom?: string | number
    offPeak: FinancePriceRate
    peak: FinancePriceRate
    peakHours?: number[][]
    peakDays?: number[]
    utcOffsetMinutes?: number
  }

/** Raw finance configuration as validated from settings, before normalization. */
export interface FinanceConfigInput {
  currency?: string
  balance?: FinanceConfig['balance']
  defaultPrice?: FinancePriceRate
  /**
   * Flat per-provider fallback rates, keyed by provider (the part of the model
   * key before the first '/' of 'provider/model'). A model with no
   * prices[modelKey] entry prices at its provider's default rate first, then
   * at the global defaultPrice. This is what lets the ledger give non-DeepSeek
   * providers (openai/*, anthropic/*, google/*, ...) a sensible cost without
   * enumerating every model.
   */
  providerDefaults?: Record<string, FinancePriceRate>
  /**
   * How every route is billed: 'metered' (pay-as-you-go wallet, the default)
   * or 'plan' (subscription — its computed amount is a LIST-PRICE EQUIVALENT,
   * never real cash flow). Keys may be either a full model key ('zai/glm-4.6',
   * highest precedence) or just a provider ('zai').
   */
  billingModes?: Record<string, 'metered' | 'plan'>
  /** One price entry per model key, or an era history list of entries. */
  prices?: Record<string, FinancePriceEntryInput | FinancePriceEntryInput[]>
}

/** Resolved finance configuration (prices normalized to era-sorted entries). */
export interface FinanceConfig {
  currency: string
  balance: {
    baseURL: string
    apiKeyEnv: string
    timeoutMs: number
  }
  defaultPrice: FinancePriceRate
  providerDefaults: Record<string, FinancePriceRate>
  /** Route-level billing classification; absent = 'metered' at lookup time. */
  billingModes: Record<string, 'metered' | 'plan'>
  prices: Record<string, readonly FinancePriceEntry[]>
}

export type FinanceBalanceStatus = 'ok' | 'missing-credential' | 'error'

/** Host-only projection of the DeepSeek balance endpoint. Never carries a key. */
export interface FinanceBalanceView {
  status: FinanceBalanceStatus
  updatedAt: number
  isAvailable?: boolean
  currency?: string
  totalMicros?: number
  grantedMicros?: number
  toppedUpMicros?: number
  code?: string
  message?: string
}

export interface FinanceSessionRow {
  sessionId: string
  title: string | null
  createdAt: number
  cwd?: string
  workspaceId: string | null
  workspaceTitle: string | null
  taskId: string
  parentSessionId?: string
  delegationDepth?: number
  origin?: 'subagent'
  modelKeys: readonly string[]
  usage: FinanceTokenBuckets
  costMicros: number
}

export interface FinanceTaskRow {
  taskId: string
  title: string | null
  createdAt: number
  sessionCount: number
  usage: FinanceTokenBuckets
  costMicros: number
}

export interface FinanceWorkspaceRow {
  workspaceId: string | null
  title: string
  sessionCount: number
  usage: FinanceTokenBuckets
  costMicros: number
}

/**
 * Billing route classification. 'plan' routes are subscriptions: their
 * amounts in the ledger are LIST-PRICE EQUIVALENTS, not cash flow, so the
 * client labels them apart and excludes them from wallet-facing math.
 */
export type FinanceBillingMode = 'metered' | 'plan'

export interface FinanceModelRow {
  modelKey: string
  /** Provider part of the model key (the part before the first '/'). */
  provider: string
  /** Model part of the model key (the part after the first '/'). */
  model: string
  /**
   * How this route bills ('mixed' never appears here — that is a rollup-only
   * state). Absent on old snapshots = 'metered'.
   */
  billingMode?: FinanceBillingMode
  usage: FinanceTokenBuckets
  costMicros: number
  /**
   * Potential savings of shifting this model's peak-hour usage off-peak
   * (peak cost minus the same tokens at off-peak rates). Present only on the
   * exact per-hour path; absent when the model has no hour detail.
   */
  shiftSavingsMicros?: number
}

/** Per-provider cost rollup across every model observed under that provider. */
export interface FinanceProviderRow {
  provider: string
  usage: FinanceTokenBuckets
  costMicros: number
  /** Distinct models observed under this provider. */
  modelCount: number
  /**
   * Rollup of member models' modes: all-plan -> 'plan', mixed -> 'mixed',
   * otherwise omitted (pure-metered is the default and needs no marker).
   */
  billingMode?: FinanceBillingMode | 'mixed'
}

export interface FinanceDayRow {
  day: string
  usage: FinanceTokenBuckets
  costMicros: number
}

/**
 * Cost band of one priced usage hour. peak/offpeak come from a windowed
 * (peak/off-peak) price entry; flat from a flat 24/7 era line or the
 * default-price fallback. Sessions without hour detail are not banded — they
 * land in the ledger's unclassified bucket instead.
 */
export type FinanceTimeBand = 'peak' | 'offpeak' | 'flat'

/**
 * One hour-of-day bucket aggregated across the whole ledger from the
 * windowed-era hourly usage (the hour detail financeUsageHourly provides).
 * The 24 rows cover one rolling 24-hour window (hourOfDayWindowStartMs ..
 * now): each local hour of day appears exactly once, so the row can be
 * rendered either as a fixed 0-23 clock pattern or as a time-ordered
 * rolling window when hourStartMs is present.
 */
export interface FinanceHourOfDayRow {
  /** Local hour 0-23 on the model schedule's clock (default UTC+8). */
  localHour: number
  /**
   * Epoch ms of the real hour this bucket aggregates (the UTC hour start of
   * the usage hour). Lets the client lay the 24 buckets out in time order
   * across the rolling window and label ticks/tooltips with the real clock.
   * Absent on legacy snapshots — clients fall back to a bare HH:00 label.
   */
  hourStartMs?: number
  usage: FinanceTokenBuckets
  costMicros: number
  /** Cost priced inside a peak window; > 0 tints the bar as a peak hour. */
  peakCostMicros: number
  /** Cost priced at a flat era line; > 0 tints the bar as a flat-rate hour. */
  flatCostMicros: number
  /**
   * Potential savings of shifting THIS hour's peak usage off-peak (peak cost
   * minus the same tokens at off-peak rates). The sum across the 24 rows
   * equals the ledger-wide shiftSavingsMicros.
   */
  shiftSavingsMicros: number
}

/**
 * Peak/off-peak split of the ledger's estimated cost, plus the potential
 * savings of shifting peak-hour usage off-peak. The five cost buckets are
 * disjoint and sum to totalCostMicros (legacy included).
 */
export interface FinancePeakValleySplit {
  /** Cost billed inside peak windows (windowed-era hourly usage). */
  peakCostMicros: number
  /** Cost billed outside every peak window (windowed-era hourly usage). */
  offPeakCostMicros: number
  /** Hour-known usage priced at a flat price line (no window schedule). */
  flatCostMicros: number
  /** Hour-unknown usage priced at the base rate (no hourly detail). */
  unclassifiedCostMicros: number
  /**
   * Cost of sessions created BEFORE the windowed era began (see
   * `FinanceLedger.windowedSinceMs`). Peak/valley billing does not apply to
   * them: they are priced entirely at their pre-era flat rate and excluded
   * from the peak/off-peak buckets above and from the hour-of-day chart.
   */
  legacyCostMicros: number
  /**
   * What peak-hour usage would have cost at off-peak rates: the extra amount
   * paid because usage fell in peak hours (shift savings).
   */
  shiftSavingsMicros: number
}

export interface FinanceLedger {
  generatedAt: number
  currency: string
  totals: FinanceTokenBuckets
  totalCostMicros: number
  /**
   * Pay-as-you-go share of totalCostMicros: money that actually left (or is
   * draining) a metered wallet. The balance gauge reconciles against THIS.
   */
  meteredCostMicros?: number
  /**
   * Subscription-route share of totalCostMicros, valued at list prices — a
   * 'what this would have cost without the plan' equivalent, not cash flow.
   * Present only from hosts with billing-mode awareness.
   */
  planEquivalentCostMicros?: number
  sessionCount: number
  workspaceCount: number
  taskCount: number
  /**
   * Epoch ms when the windowed (peak/off-peak) era begins — the earliest
   * `effectiveFrom` among the config's windowed price entries. Sessions
   * created before this moment are legacy: priced flat, excluded from the
   * peak/valley split and hour-of-day chart. `null` when no windowed
   * pricing is configured, i.e. peak/valley never applies.
   */
  windowedSinceMs: number | null
  /**
   * Epoch ms where the rolling 24-hour window used by the hour-of-day chart
   * and the peak/off-peak split begins. Only usage that occurred at or after
   * this moment (hour-bucket timestamps) enters byHourOfDay and the
   * peak/off-peak/flat cost buckets; legacy (pre-windowed-era) sessions and
   * hour-less (unclassified) costs stay outside either way.
   */
  hourOfDayWindowStartMs: number
  byDay: readonly FinanceDayRow[]
  byModel: readonly FinanceModelRow[]
  /**
   * Per-provider cost rollup (provider part of the model key), sorted by cost
   * descending. Lets the dashboard show which LLM provider drives the spend.
   */
  byProvider: readonly FinanceProviderRow[]
  byWorkspace: readonly FinanceWorkspaceRow[]
  tasks: readonly FinanceTaskRow[]
  sessions: readonly FinanceSessionRow[]
  /**
   * 24 local hour-of-day cost buckets for the rolling 24-hour window
   * (hourOfDayWindowStartMs .. now), i.e. what the dashboard labels
   * "last 24 hours" - not the whole ledger's lifetime total.
   */
  byHourOfDay: readonly FinanceHourOfDayRow[]
  /** Peak/off-peak cost split (24h window) and potential off-peak-shift savings. */
  peakValley: FinancePeakValleySplit
}

export interface FinanceOverview {
  balance: FinanceBalanceView
  ledger: FinanceLedger
}

/** Result of the automatic hourly backfill (sessions whose logs were replayed). */
export interface FinanceRescanResult {
  /** Persisted sessions considered. */
  sessionCount: number
  /** Sessions whose logs were replayed to backfill financeUsageHourly. */
  rescanned: number
}

/** Mutable progress sink updated while backfillFinanceHourly runs. */
export interface FinanceBackfillSink {
  total: number
  scanned: number
  rescanned: number
}

/**
 * Live progress of the first-open hourly backfill, polled by the dashboard's
 * loading state so the user sees how far the one-time replay has got.
 */
export interface FinanceBackfillProgress {
  /** idle: no backfill started; backfill: replaying logs; done: finished. */
  phase: 'idle' | 'backfill' | 'done'
  /** Sessions considered so far. */
  scanned: number
  /** Persisted sessions to consider. */
  total: number
  /** Sessions whose logs were replayed. */
  rescanned: number
  startedAt: number
}