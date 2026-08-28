/**
 * Finance dashboard controller: one snapshot store over the finance Remote.
 * Loads lazily on first open and refreshes balance independently.
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: augments ClientRemote with the generated finance namespace.
import type {} from 'dsh-spark-finance/remote'
import type { FinanceBackfillProgress, FinanceBalanceView, FinanceOverview } from 'dsh-spark-finance/types'
import { readBalancePeak, writeBalancePeak } from './persist.ts'

export interface FinanceAuditState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  overview?: FinanceOverview
  error: string | null
  /** Live progress of the first-open hourly backfill, shown while loading. */
  progress?: FinanceBackfillProgress
  /** Recharge baseline: the highest balance this browser has observed. */
  peak?: { micros: number; updatedAt: number }
}

type FinanceRemote = ClientRemote['finance']

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One controller per settings surface; never a module-level singleton. */
export class FinanceAuditController {
  readonly store: SnapshotStore<FinanceAuditState> = createSnapshotStore<FinanceAuditState>({ status: 'idle', error: null })
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
   * Recharge detection: any balance above the persisted peak is treated as a
   * top-up, which raises the peak (and refills the gauge). The peak only ever
   * grows; drops are normal spending. Currency mismatches reset the baseline.
   */
  private trackPeak(balance: FinanceBalanceView): { micros: number; updatedAt: number } | undefined {
    if (balance.status !== 'ok' || balance.totalMicros === undefined) return undefined
    const currency = balance.currency ?? 'CNY'
    const current = readBalancePeak()
    if (current === undefined || current.currency !== currency || balance.totalMicros > current.micros) {
      const next = { micros: balance.totalMicros, updatedAt: Date.now(), currency }
      writeBalancePeak(next)
      return next
    }
    return current
  }

  /**
   * Fetch the overview, keeping the last good snapshot on failure. The first
   * load (no data yet) shows the loading state; refreshes over an existing
   * snapshot patch quietly instead — the dashboard never flashes away, so one
   * 刷新 button covers both the balance and the ledger without a separate
   * balance-only action.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    const firstLoad = this.store.getSnapshot().overview === undefined
    this.store.update(state => {
      state.status = firstLoad ? 'loading' : 'ready'
      state.error = null
      if (firstLoad) state.progress = undefined
    })
    // The first open runs the host's one-time hourly backfill, which can take
    // a while; poll its progress so the loading UI can show how far it is.
    if (firstLoad) this.startProgressPolling()
    try {
      const result = await this.remote.getOverview()
      if (generation !== this.generation) return
      if (!result.ok) {
        this.store.update(state => {
          state.status = 'error'
          state.error = result.error.message
        })
        this.stopProgressPolling()
        return
      }
      this.store.update(state => {
        state.status = 'ready'
        state.overview = result.value
        state.error = null
        state.progress = undefined
        state.peak = this.trackPeak(result.value.balance)
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

  /** Refresh only the balance card and patch it into the current snapshot. */
  async refreshBalance(): Promise<void> {
    const snapshot = this.store.getSnapshot()
    if (snapshot.status !== 'ready' || snapshot.overview === undefined) return this.load()
    const generation = this.generation
    try {
      const result = await this.remote.getBalance()
      if (generation !== this.generation) return
      if (!result.ok) {
        this.store.update(state => {
          if (state.status !== 'ready' || state.overview === undefined) return
          state.overview = {
            ...state.overview,
            balance: { status: 'error', code: 'client', message: result.error.message, updatedAt: Date.now() },
          }
        })
        return
      }
      this.store.update(state => {
        if (state.status !== 'ready' || state.overview === undefined) return
        state.overview = { ...state.overview, balance: result.value }
        state.peak = this.trackPeak(result.value)
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update(state => {
        if (state.status !== 'ready' || state.overview === undefined) return
        state.overview = {
          ...state.overview,
          balance: { status: 'error', code: 'client', message: messageOf(error), updatedAt: Date.now() },
        }
      })
    }
  }

  /** Invalidate in-flight reads and stop progress polling. */
  dispose(): void {
    this.generation += 1
    this.stopProgressPolling()
  }
}