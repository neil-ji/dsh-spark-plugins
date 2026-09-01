/**
 * Finance dashboard controller: one snapshot store over the finance Remote.
 * Loads lazily on first open and refreshes balance independently.
 *
 * Commit 21: the canonical balance surface is now the per-provider list
 * returned by `listProviders`,` not the legacy single-gauge `getBalance`
 * payload. The ledger is fetched separately via `getLedger`.` Per-provider
 * recharge baselines live in a `peaks` map (one entry per provider id),
 * mirroring `persist.ts` (commit 19).`
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: augments ClientRemote with the generated finance namespace.
import type {} from 'dsh-spark-finance/remote'
import type {
  FinanceBackfillProgress,
  FinanceLedger,
  FinanceListProvidersResult,
  FinanceProviderBalance,
} from 'dsh-spark-finance/types'
import { readAllBalancePeaks, writeBalancePeak, type StoredBalancePeak } from './persist.ts'

export interface FinanceAuditState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Cold aggregate of every persisted session, cached for a short TTL on the host. */
  ledger?: FinanceLedger
  /**
   * Multi-provider canonical surface (commit 19 host + commit 21 client).
   * Hosts each provider row with its current balance slot + the user's
   * `FinanceProviderEntry` (so the dashboard can render validity tags).
   */
  providerList?: FinanceListProvidersResult
  /**
   * Per-provider recharge baseline (mirror of localStorage).` One entry per
   * provider id; the dashboard shows it as a historical-peak reference next
   * to the live balance.
   */
  peaks: Record<string, StoredBalancePeak>
  error: string | null
  /** Live progress of the first-open hourly backfill, shown while loading. */
  progress?: FinanceBackfillProgress
}

type FinanceRemote = ClientRemote['finance']

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**

 * Recharge detection: any balance above the persisted peak is treated as a
 * top-up, which raises the peak (and refills the gauge). The peak only ever
 * grows; drops are normal spending. Currency mismatches reset the baseline.
 *
 * Commit 21: per-provider; the controller takes the provider id + the slot,
 * not the legacy single `FinanceBalanceView`.
 */
function trackPeakFor(provider: string, slot: FinanceProviderBalance, current: StoredBalancePeak | undefined): StoredBalancePeak | undefined {
  if (slot.status !== 'ok' || slot.totalMicros === undefined) return current
  const currency = slot.currency ?? 'CNY'
  if (current === undefined || current.currency !== currency || slot.totalMicros > current.micros) {
    const next: StoredBalancePeak = { micros: slot.totalMicros, updatedAt: Date.now(), currency }
    writeBalancePeak(provider, next)
    return next
  }
  return current
}

/** One controller per settings surface; never a module-level singleton. */
export class FinanceAuditController {
  readonly store: SnapshotStore<FinanceAuditState> = createSnapshotStore<FinanceAuditState>({
    status: 'idle',
    error: null,
    peaks: {},
  })
  private generation = 0
  /** Polls getBackfillProgress while the first (backfilling) load runs. */
  private progressTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly remote: FinanceRemote) {}

  private stopProgressPolling(): void {
    if (this.progressTimer !== undefined) {
      clearInterval(this.progressTimer)
      this.progressTimer = undefined
    }
  }

  private startProgressPolling(): void {
    this.stopProgressPolling()
    this.progressTimer = setInterval(() => { void this.pollBackfillProgress() }, 600)
  }

  private async pollBackfillProgress(): Promise<void> {
    const generation = this.generation
    try {
      const result = await this.remote.getBackfillProgress()
      if (generation !== this.generation) { this.stopProgressPolling(); return }
      if (!result.ok) return
      this.store.update(state => { state.progress = result.value })
      if (result.value.phase === 'done' || result.value.phase === 'idle') this.stopProgressPolling()
    } catch {
      // Best-effort: a failed tick just skips until the next one.
    }
  }

  /**
   * Fetch the dashboard sources (ledger + provider list) in parallel.
   * Keeps the last good snapshot on failure; refreshes over an existing
   * snapshot patch quietly so the dashboard never flashes away.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    const firstLoad = this.store.getSnapshot().providerList === undefined
    this.store.update(state => {
      state.status = firstLoad ? 'loading' : 'ready'
      state.error = null
      if (firstLoad) state.progress = undefined
    })
    if (firstLoad) this.startProgressPolling()
    try {
      const [listResult, ledgerResult] = await Promise.all([
        this.remote.listProviders(),
        this.remote.getLedger(),
      ])
      if (generation !== this.generation) return
      if (!listResult.ok) {
        this.store.update(state => {
          state.status = 'error'
          state.error = listResult.error.message
        })
        this.stopProgressPolling()
        return
      }
      if (!ledgerResult.ok) {
        this.store.update(state => {
          state.status = 'error'
          state.error = ledgerResult.error.message
        })
        this.stopProgressPolling()
        return
      }
      this.store.update(state => {
        state.status = 'ready'
        state.providerList = listResult.value
        state.ledger = ledgerResult.value
        state.error = null
        state.progress = undefined
        // Track per-provider peaks off the freshly fetched slots.
        const peaks = { ...state.peaks }
        for (const row of listResult.value.providers) {
          const tracked = trackPeakFor(row.provider, row.balance, peaks[row.provider])
          if (tracked !== undefined) peaks[row.provider] = tracked
        }
        state.peaks = peaks
      })
      this.stopProgressPolling()
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update(state => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      this.stopProgressPolling()
    }
  }

  /**
   * Refresh the balance for ONE provider; used by the per-card refresh
   * button on each balance grid card. Updates the slot in `providerList`
   * + bumps the per-provider peak if the balance grew.
   */
  async refreshProvider(provider: string): Promise<void> {
    const snapshot = this.store.getSnapshot()
    if (snapshot.status !== 'ready' || snapshot.providerList === undefined) return this.load()
    const generation = this.generation
    try {
      const result = await this.remote.refreshBalance({ provider })
      if (generation !== this.generation) return
      if (!result.ok) {
        // Surface as a per-row failure without losing other rows.
        this.store.update(state => {
          if (state.status !== 'ready' || state.providerList === undefined) return
          state.providerList = {
            ...state.providerList,
            providers: state.providerList.providers.map((row) =>
              row.provider === provider
                ? {
                    ...row,
                    balance: { status: 'error', provider, code: 'client', message: result.error.message, fetchedAt: Date.now() },
                  }
                : row,
            ),
          }
        })
        return
      }
      this.store.update(state => {
        if (state.status !== 'ready' || state.providerList === undefined) return
        const slot = result.value
        const nextRows = state.providerList.providers.map((row) =>
          row.provider === provider ? { ...row, balance: slot } : row,
        )
        state.providerList = { ...state.providerList, providers: nextRows }
        const tracked = trackPeakFor(provider, slot, state.peaks[provider])
        if (tracked !== undefined) {
          state.peaks = { ...state.peaks, [provider]: tracked }
        } else {
          const { [provider]: _drop, ...rest } = state.peaks
          void _drop
          state.peaks = rest
        }
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update(state => {
        if (state.status !== 'ready' || state.providerList === undefined) return
        state.providerList = {
          ...state.providerList,
          providers: state.providerList.providers.map((row) =>
            row.provider === provider
              ? {
                  ...row,
                  balance: { status: 'error', provider, code: 'client', message: messageOf(error), fetchedAt: Date.now() },
                }
              : row,
          ),
        }
      })
    }
  }

  /**
   * Refresh the ledger only — useful when the user wants to refresh the
   * cost charts without re-pulling every balance.
   */
  async refreshLedger(): Promise<void> {
    const snapshot = this.store.getSnapshot()
    if (snapshot.status !== 'ready' || snapshot.ledger === undefined) return this.load()
    const generation = this.generation
    try {
      const result = await this.remote.getLedger()
      if (generation !== this.generation) return
      if (!result.ok) {
        this.store.update(state => {
          state.status = 'error'
          state.error = result.error.message
        })
        return
      }
      this.store.update(state => {
        if (state.status !== 'ready') return
        state.ledger = result.value
        state.status = 'ready'
        state.error = null
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update(state => {
        state.status = 'error'
        state.error = messageOf(error)
      })
    }
  }

  /** Invalidate in-flight reads and stop progress polling. */
  dispose(): void {
    this.generation += 1
    this.stopProgressPolling()
  }
}
