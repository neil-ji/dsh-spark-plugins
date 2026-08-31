/**
 * Balance-peak persistence: the recharge baseline lives in the browser so it
 * survives page reloads (and server restarts). The peak is a display heuristic
 * — "the highest balance this browser has observed" — not authoritative state,
 * so a per-origin localStorage key is the right scope. Every access is guarded:
 * SSR tests, sandboxed frames, and quota failures degrade to session-only
 * tracking instead of throwing.
 */

/** Single-key record; currency guards against config switches. */
export interface StoredBalancePeak {
  micros: number
  updatedAt: number
  currency: string
}

const PEAK_KEY = 'dsh-spark-finance.balance-peak'

export function readBalancePeak(): StoredBalancePeak | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined
    const raw = localStorage.getItem(PEAK_KEY)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as Partial<StoredBalancePeak>
    if (typeof parsed.micros !== 'number' || typeof parsed.updatedAt !== 'number' || typeof parsed.currency !== 'string') {
      return undefined
    }
    return parsed as StoredBalancePeak
  } catch {
    return undefined
  }
}

export function writeBalancePeak(peak: StoredBalancePeak): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(PEAK_KEY, JSON.stringify(peak))
  } catch {
    // Quota / disabled storage: non-fatal, the peak just resets next load.
  }
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
  charts: {
    gauge: true,
    kpis: true,
    split: true,
    hourOfDay: true,
    byProvider: true,
    byModel: true,
    byWorkspace: true,
    byDay: true,
  },
  // autoSync defaults to TRUE: the whole point of the simplification is "users
  // do not hand-edit prices, the host fetches them". Opt-out is per-browser.
  autoSync: true,
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
    // Default to true so older browser storage (without these keys) silently
    // enables auto-sync on first read; users can opt out per browser.
    autoSync: parsed?.autoSync === false ? false : DEFAULT_FINANCE_PREFS.autoSync,
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
