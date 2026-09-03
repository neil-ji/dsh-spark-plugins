/**
 * Balance-peak persistence: the recharge baseline lives in the browser so it
 * survives page reloads (and server restarts). The peak is a display heuristic
 * — "the highest balance this browser has observed" — not authoritative state,
 * so a per-origin localStorage key is the right scope. Every access is guarded:
 * SSR tests, sandboxed frames, and quota failures degrade to session-only
 * tracking instead of throwing.
 */

/**
 * Per-currency peak record for one provider. A single provider can carry
 * peaks in several currencies (deepseek-official on a multi-currency account
 * reports both CNY and USD balances on different endpoints); keeping each
 * currency's history separate means a CNY → USD switch no longer wipes the
 * baseline. The map is keyed by currency code; absence = no history yet.
 */
export interface StoredCurrencyPeak {
  micros: number
  updatedAt: number
}

/**
 * One provider's stored baseline: a map of currency code → peak. Legacy
 * per-provider records (commit 19's `{micros, currency, updatedAt}` shape)
 * migrate into the map under their embedded currency on the next read.
 */
export interface StoredBalancePeak {
  byCurrency: Record<string, StoredCurrencyPeak>
}

const PEAK_KEY = 'dsh-spark-finance.balance-peak'
const PEAKS_KEY = 'dsh-spark-finance.balance-peaks'

/**
 * Read the peak for ONE provider (returns the full record so callers can
 * switch currencies without re-reading storage). The `provider` lookup is
 * the most common path; the multi-currency view is read off `byCurrency`.
 */
export function readBalancePeak(provider: string): StoredBalancePeak | undefined {
  return readAllBalancePeaks()[provider]
}

/** Read every provider's peak in one read. */
export function readAllBalancePeaks(): Record<string, StoredBalancePeak> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const rawMap = localStorage.getItem(PEAKS_KEY)
    if (rawMap !== null) {
      const parsed = JSON.parse(rawMap) as unknown
      if (isPeakMap(parsed)) return parsed
      // Legacy per-provider shape (commit 19: each entry has inline
      // {micros, currency, updatedAt}). Refold into the new `byCurrency` map
      // so old browsers don't lose their history.
      if (isLegacyPerProviderMap(parsed)) return migrateLegacyMap(parsed)
    }
    // No per-provider map yet: try to migrate the very first legacy shape
    // (single-key, committed before commit 19) under `deepseek-official`.
    const rawSingle = localStorage.getItem(PEAK_KEY)
    if (rawSingle === null) return {}
    const parsedSingle = JSON.parse(rawSingle) as unknown
    if (!isLegacyFlatPeak(parsedSingle)) return {}
    const migrated: Record<string, StoredBalancePeak> = {
      'deepseek-official': { byCurrency: { [parsedSingle.currency]: { micros: parsedSingle.micros, updatedAt: parsedSingle.updatedAt } } },
    }
    try {
      localStorage.setItem(PEAKS_KEY, JSON.stringify(migrated))
      localStorage.removeItem(PEAK_KEY)
    } catch {
      // Migration is best-effort: the next read will retry.
    }
    return migrated
  } catch {
    return {}
  }
}

/**
 * Write the recharge baseline for ONE provider, replacing the full
 * `byCurrency` map. The other providers are preserved. Callers that want
 * to update a single currency should read, mutate, then write back.
 */
export function writeBalancePeak(provider: string, peak: StoredBalancePeak): void {
  try {
    if (typeof localStorage === 'undefined') return
    const map = readAllBalancePeaks()
    const next = { ...map, [provider]: peak }
    localStorage.setItem(PEAKS_KEY, JSON.stringify(next))
    // Best-effort: drop the legacy single key once we own the per-provider map.
    try { localStorage.removeItem(PEAK_KEY) } catch { /* non-fatal */ }
  } catch {
    // Quota / disabled storage: non-fatal, the peak just resets next load.
  }
}

interface LegacyFlatPeak {
  micros: number
  updatedAt: number
  currency: string
}

function isLegacyFlatPeak(value: unknown): value is LegacyFlatPeak {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.micros === 'number'
    && typeof v.updatedAt === 'number'
    && typeof v.currency === 'string'
}

function isLegacyPerProviderMap(value: unknown): value is Record<string, LegacyFlatPeak> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (!isLegacyFlatPeak(entry)) return false
  }
  return true
}

function migrateLegacyMap(legacy: Record<string, LegacyFlatPeak>): Record<string, StoredBalancePeak> {
  const out: Record<string, StoredBalancePeak> = {}
  for (const [provider, peak] of Object.entries(legacy)) {
    const existing = out[provider] ?? { byCurrency: {} }
    existing.byCurrency[peak.currency] = { micros: peak.micros, updatedAt: peak.updatedAt }
    out[provider] = existing
  }
  try {
    localStorage.setItem(PEAKS_KEY, JSON.stringify(out))
  } catch {
    // Migration is best-effort.
  }
  return out
}

function isPeakMap(value: unknown): value is Record<string, StoredBalancePeak> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const v = entry as { byCurrency?: unknown }
    if (v === null || typeof v !== 'object' || typeof v.byCurrency !== 'object' || v.byCurrency === null) {
      return false
    }
    for (const sub of Object.values(v.byCurrency as Record<string, unknown>)) {
      if (!isLegacyFlatPeak({ ...(sub as Record<string, unknown>), currency: '?' })) return false
    }
  }
  return true
}

/**
 * Dashboard view preferences: layout density and per-chart visibility. Pure
 * presentation state scoped to the browser (localStorage), so each user picks
 * the charts that matter to them without touching server state. Reads merge
 * over the defaults so a new preference added later never blanks the others.
 */

export type FinanceLayout = 'compact' | 'standard'

export interface FinanceChartPrefs {
  gauge: boolean
  kpis: boolean
  split: boolean
  hourOfDay: boolean
  byProvider: boolean
  byModel: boolean
  byWorkspace: boolean
  byDay: boolean
}

/**
 * Snapshot of the most recent successful community sync as seen by the client.
 * Mirrors a subset of `FinanceSyncStatus` from `dsh-spark-finance/types`:
 * purely informational, fed by `getSyncStatus` so the dashboard can label the
 * price-sync row without re-firing `syncCommunityPrices`. Persisted alongside
 * the dashboard prefs so a returning browser still knows "we synced 6h ago".
 */
export interface FinanceSyncSnapshot {
  /** Epoch ms when the host applied the sync. */
  appliedAt: number
  /** Source URL (currently always models.dev). */
  source: string
  /** Final kept count from the sync. */
  kept: number
  /** Providers written. */
  providers: readonly string[]
  /** CNY/USD fx applied. */
  fx: number
}

export interface FinancePrefs {
  layout: FinanceLayout
  charts: FinanceChartPrefs
  /**
   * Whether the client should auto-sync the community price table on startup
   * when the last sync is older than the threshold (currently 24h). Defaults
   * to `true`: the user has to opt out to keep the auto-pull off.
   */
  autoSync: boolean
  /** Last successful sync the client has seen, if any. */
  lastSync: FinanceSyncSnapshot | null
}

export const DEFAULT_FINANCE_PREFS: FinancePrefs = {
  layout: 'compact',
  // First-screen charts (always on): balance gauge, KPI tiles, peak/off-peak
  // split, hour-of-day distribution, and the by-model table. The other three
  // (byProvider / byWorkspace / byDay) are the bulkier cards the settings
  // modal currently crops off — opt-in via the dashboard view preferences in
  // the plugin card so power users can still reach them, but a brand-new
  // browser lands on a useful dashboard instead of a sea of cards.
  charts: {
    gauge: true,
    kpis: true,
    split: true,
    hourOfDay: true,
    byModel: true,
    byProvider: false,
    byWorkspace: false,
    byDay: false,
  },
  // autoSync defaults to FALSE: opt-in keeps the user in control of the
  // first silent network call (sync against models.dev) and avoids surprising
  // users who already maintain prices by hand. Returning users who already
  // set `autoSync = true` keep their setting — see mergePrefs below.
  autoSync: false,
  lastSync: null,
}

const PREFS_KEY = 'dsh-spark-finance.prefs'

function isSyncSnapshot(value: unknown): value is FinanceSyncSnapshot {
  if (value === null || typeof value !== 'object') return false
  const v = value as Partial<FinanceSyncSnapshot>
  return (
    typeof v.appliedAt === 'number' &&
    typeof v.source === 'string' &&
    typeof v.kept === 'number' &&
    Array.isArray(v.providers) &&
    v.providers.every((p) => typeof p === 'string') &&
    typeof v.fx === 'number'
  )
}

function mergePrefs(parsed: Partial<FinancePrefs> | null): FinancePrefs {
  const charts = { ...DEFAULT_FINANCE_PREFS.charts, ...(parsed?.charts ?? {}) }
  return {
    layout: parsed?.layout === 'standard' ? 'standard' : DEFAULT_FINANCE_PREFS.layout,
    charts,
    // Opt-in: explicit value wins (including a stored `false`), absent key
    // falls back to the default. The early returns respect whichever the
    // browser stored last, so a returning user who flipped it off stays off.
    autoSync: typeof parsed?.autoSync === 'boolean' ? parsed.autoSync : DEFAULT_FINANCE_PREFS.autoSync,
    lastSync: isSyncSnapshot(parsed?.lastSync) ? parsed.lastSync : DEFAULT_FINANCE_PREFS.lastSync,
  }
}

export function readFinancePrefs(): FinancePrefs {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_FINANCE_PREFS
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw === null) return DEFAULT_FINANCE_PREFS
    const parsed = JSON.parse(raw) as Partial<FinancePrefs>
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FINANCE_PREFS
    return mergePrefs(parsed)
  } catch {
    return DEFAULT_FINANCE_PREFS
  }
}

export function writeFinancePrefs(prefs: FinancePrefs): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Quota / disabled storage: non-fatal, the view resets to defaults.
  }
}

/**
 * Per-provider business-field overrides layered on top of the dsh-llm provider
 * snapshot. The dsh-llm runtime registry is the *only* source of truth for
 * which providers exist and what they are — we never write back to it. This
 * store only carries the user-overlay fields we maintain client-side: the
 * price we want to charge, whether to auto-fetch its balance, and an
 * optional validity window. Everything else (host-known metadata, currency,
 * billing mode) comes from the host.
 *
 * Pure presentation state scoped to the browser, so each user picks the
 * fields that matter to them without touching server state. The controller
 * merges these over the dsh snapshot on every render and the user-facing
 * view presents the merged shape.
 */

export interface DshProviderOverride {
  /** Total price in micros per million tokens. */
  totalPriceMicros: number
  /** Whether to auto-fetch the balance for this provider. */
  autoFetchBalance: boolean
  /** Optional validity window: the override applies from this epoch ms (inclusive). */
  validityStartMs?: number
  /** Optional validity window: the override applies until this epoch ms (exclusive). */
  validityEndMs?: number
}

const DSH_OVERRIDES_KEY = 'dsh-spark-finance.dsh-provider-overrides'

function isDshProviderOverride(value: unknown): value is DshProviderOverride {
  if (value === null || typeof value !== 'object') return false
  const v = value as Partial<DshProviderOverride>
  if (typeof v.totalPriceMicros !== 'number' || v.totalPriceMicros < 0) return false
  if (typeof v.autoFetchBalance !== 'boolean') return false
  if (v.validityStartMs !== undefined && typeof v.validityStartMs !== 'number') return false
  if (v.validityEndMs !== undefined && typeof v.validityEndMs !== 'number') return false
  return true
}

function isDshProviderOverrideMap(value: unknown): value is Record<string, DshProviderOverride> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (!isDshProviderOverride(entry)) return false
  }
  return true
}

/** Read every provider's dsh-overlay entry. Returns an empty map on SSR / quota / disabled storage. */
export function readAllDshProviderOverrides(): Record<string, DshProviderOverride> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(DSH_OVERRIDES_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    if (isDshProviderOverrideMap(parsed)) return parsed
    return {}
  } catch {
    return {}
  }
}

/**
 * Write one provider's overlay. Other providers' entries are preserved; a
 * provider entry can be removed by passing `undefined` (the row then reverts
 * to the dsh snapshot's defaults).
 */
export function writeDshProviderOverride(
  provider: string,
  override: DshProviderOverride | undefined,
): void {
  try {
    if (typeof localStorage === 'undefined') return
    const map = readAllDshProviderOverrides()
    if (override === undefined) {
      delete map[provider]
    } else {
      map[provider] = override
    }
    localStorage.setItem(DSH_OVERRIDES_KEY, JSON.stringify(map))
  } catch {
    // Quota / disabled storage: the next write retries; the in-memory copy
    // stays valid for the rest of the session.
  }
}
