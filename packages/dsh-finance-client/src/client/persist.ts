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

export interface FinancePrefs {
  layout: FinanceLayout
  charts: FinanceChartPrefs
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
}

const PREFS_KEY = 'dsh-spark-finance.prefs'

function mergePrefs(parsed: Partial<FinancePrefs> | null): FinancePrefs {
  const charts = { ...DEFAULT_FINANCE_PREFS.charts, ...(parsed?.charts ?? {}) }
  return {
    layout: parsed?.layout === 'standard' ? 'standard' : DEFAULT_FINANCE_PREFS.layout,
    charts,
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
