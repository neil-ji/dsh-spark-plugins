/**
 * Client-safe finance vocabulary shared by the host ledger service and the
 * web finance-audit surface. Types only; the projection key declaration lives
 * here so client aggregates import one face without dragging the host service.
 *
 * @module @deepseek-ai/dsh-spark-finance/types
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
  /**
   * Per-provider configuration entries — one row per provider the user wants
   * to track (DeepSeek-official, MiniMax-M3, OpenAI, ...). Each row carries
   * billing mode, plan/top-up budget, currency, optional auto-fetch flag, and
   * an optional validity range. Empty array = no per-provider tracking yet;
   * commit 12 will start filling this from settings + host-known metadata.
   * The schema upper bound for `totalPriceMicros` is 100_000_000_000 (i.e.
   * 100,000 CNY/USD in micros), matching the 0-100,000 UI range.
   */
  providers?: FinanceProviderEntry[]
}

/**
 * Per-provider billing classification surfaced in the provider config card.
 * `metered` = pay-as-you-go wallet (the historical DeepSeek default);
 * `plan` = subscription (cost is a list-price equivalent, never cash flow);
 * `free` = no money changes hands at all. The `free` value is rendered in the
 * card but never produces a balance view (auto-fetch is hidden, plan window
 * does not apply).
 */
export type FinanceProviderBillingMode = 'metered' | 'plan' | 'free'

/**
 * One row in the per-provider configuration list. `totalPriceMicros` is in
 * currency micros (CNY or USD depending on `currency`) and is interpreted as
 * either the subscription total (`plan`) or the topped-up wallet amount
 * (`metered`). `validity` is optional: when absent the provider is treated as
 * permanent (typical for `metered`). Auto-fetch is currently only honoured by
 * `deepseek-official`; the host-known provider metadata decides whether the
 * field is even rendered.
 */
export interface FinanceProviderEntry {
  /** Provider id, matches the leading path segment of `modelKey` (`provider/model`). */
  provider: string
  billingMode: FinanceProviderBillingMode
  /** Currency micros; UI displays in major units (元 / $). Capped at 100,000. */
  totalPriceMicros: number
  currency: 'CNY' | 'USD'
  /** Persisted user toggle; the host actually fires the balance fetch. */
  autoFetchBalance: boolean
  /** Optional validity window in epoch ms. Both bounds optional; absent = 永久. */
  validity?: { startMs?: number; endMs?: number }
}

/**
 * Balance view for one provider. The current host only fetches DeepSeek; other
 * providers surface as `status: 'unsupported'` with a stable `code` so the UI
 * can pick a sensible empty state. `totalMicros` is in the provider's declared
 * currency (CNY or USD depending on the corresponding entry's `currency`).
 */
export interface FinanceProviderBalance {
  status: 'ok' | 'missing-credential' | 'unsupported' | 'error'
  provider: string
  totalMicros?: number
  currency?: 'CNY' | 'USD'
  /** Stable lower-kebab code (e.g. 'auth', 'http', 'unsupported-provider'). */
  code?: string
  /** Human-readable message; UI may show or hide depending on the code. */
  message?: string
  /** Epoch ms when this view was produced; never reused across calls. */
  fetchedAt: number
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
  /** Resolved per-provider list (defaults to [] when settings omit it). */
  providers: readonly FinanceProviderEntry[]
}

export type FinanceBalanceStatus = 'ok' | 'missing-credential' | 'error'

/**
 * Host-only projection of the DeepSeek balance endpoint. The legacy
 * single-provider fields (currency / totalMicros / ...) remain the DeepSeek
 * view: the host still fetches DeepSeek first and copies that into the
 * `providers.deepseek-official` slot of `providers` (commit 12). Other
 * providers carry their own per-provider view there. `providers` is optional
 * so older hosts and older settings can stay zero-dependency.
 */
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
  /**
   * Per-provider balance views keyed by provider id. Present once the host
   * has provider-aware balance fetching (commit 12). The DeepSeek-official
   * entry is the same shape as the legacy single fields above.
   */
  providers?: Record<string, FinanceProviderBalance>
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

/**
 * Optional inputs to `finance.syncCommunityPrices`: a provider allow-list and
 * a CNY-USD FX override. Both keys are optional; omitted keys fall back to the
 * host-side defaults (`COMMUNITY_SYNC_DEFAULT_PROVIDERS` / `COMMUNITY_SYNC_DEFAULT_FX`).
 */
export interface FinanceSyncOptions {
  /** Providers to restrict the sync to. */
  providers?: readonly string[]
  /** CNY micros per USD applied to the conversion. */
  fx?: number
}

/**
 * Per-call outcome of one `finance.syncCommunityPrices` invocation.
 * `ok: true` means the fetched rows were applied to the in-memory
 * community-prices layer (and the ledger cache was invalidated so the next
 * `getLedger` rebuilds at the new rates). `ok: false` means the fetch or
 * parse failed; the layer was left untouched and the prior status stays
 * current — `getSyncStatus` continues to report the last successful sync.
 */
export interface FinanceCommunitySyncResult {
  ok: boolean
  /** Where the data came from (the upstream dataset URL). */
  source: string
  /** Epoch ms when the layer was updated. Undefined on `ok: false`. */
  appliedAt?: number
  /** CNY micros per USD applied to the conversion. */
  fx: number
  /** Providers the sync attempted to ingest. */
  requestedProviders: readonly string[]
  /** Providers in `requestedProviders` that the upstream dataset did NOT expose. */
  requestedMissing: readonly string[]
  /** Final per-model-key count that landed in the community layer. */
  kept: number
  /** Dated release snapshots dropped because an undated sibling exists. */
  droppedDated: number
  /** Non-token product variants skipped (TTS / realtime / transcription). */
  droppedNonToken: number
  /** Models dropped because the upstream cost had no usable input/output pair. */
  droppedNoCost: number
  /** Provider-set actually written (subset of `requestedProviders` ∩ upstream). */
  providers: readonly string[]
  /** Error tag + message when `ok: false`. */
  error?: { message: string }
}

/**
 * Snapshot of the last successful community-sync. Distinct from the result of
 * a particular call: `syncCommunityPrices` returns once, the dashboard polls
 * `getSyncStatus` continuously. Absent until the user (or auto-sync) runs at
 * least one successful sync.
 */
export interface FinanceSyncStatus {
  /** Source URL of the last successful sync. */
  source: string
  /** Epoch ms of the last successful sync. */
  appliedAt: number
  /** Final kept count at that sync. */
  kept: number
  /** Providers written at that sync. */
  providers: readonly string[]
  /** CNY-USD FX used by that sync (informational). */
  fx: number
}