import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FinanceAuditController } from '../src/client/controller.ts'
import type { FinanceOverview } from 'dsh-spark-finance/types'

// The dsh-client-runtime ./client export is the browser bundle (module-scope
// window); tests exercise the controller against a plain store instead.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: object) => {
    let state = structuredClone(init)
    return {
      getSnapshot: () => state,
      subscribe: () => () => {},
      update: (mutator: (draft: object) => void) => { mutator(state) },
      set: (next: object) => { state = next },
    }
  },
}))

// In-memory localStorage so the peak (recharge baseline) tracking runs in node.
const memory = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
  clear: () => { memory.clear() },
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() { return memory.size },
}
beforeEach(() => { memory.clear() })

function overview(): FinanceOverview {
  return {
    balance: { status: 'ok', updatedAt: 1, totalMicros: 100, currency: 'CNY' },
    ledger: {
      generatedAt: 1,
      currency: 'CNY',
      totals: { uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 },
      totalCostMicros: 42,
      sessionCount: 1,
      workspaceCount: 1,
      taskCount: 1,
      byDay: [],
      byModel: [],
      byWorkspace: [],
      tasks: [],
      sessions: [],
    },
  }
}

function fakeRemote(
  getOverview = vi.fn(),
  getBalance = vi.fn(),
  getBackfillProgress = vi.fn(),
  syncCommunityPrices = vi.fn(async () => ({ ok: true as const, value: stubOkSync })),
  getSyncStatus = vi.fn(async () => ({ ok: true as const, value: null })),
) {
  return { getOverview, getBalance, getBackfillProgress, syncCommunityPrices, getSyncStatus } as never
}

import type { FinanceCommunitySyncResult } from 'dsh-spark-finance/types'

const stubOkSync: FinanceCommunitySyncResult = {
  ok: true,
  source: 'https://models.dev/api.json',
  appliedAt: 0,
  fx: 7.2,
  requestedProviders: [],
  requestedMissing: [],
  kept: 0,
  droppedDated: 0,
  droppedNonToken: 0,
  droppedNoCost: 0,
  providers: [],
}

describe('FinanceAuditController', () => {
  it('loads the overview into the store', async () => {
    const remote = fakeRemote(vi.fn().mockResolvedValue({ ok: true, value: overview() }))
    const controller = new FinanceAuditController(remote)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.overview?.ledger.totalCostMicros).toBe(42)
  })

  it('maps a Remote failure envelope to the error state', async () => {
    const remote = fakeRemote(vi.fn().mockResolvedValue({ ok: false, error: { code: 'internal', message: 'boom', details: {} } }))
    const controller = new FinanceAuditController(remote)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('maps a rejected promise to the error state', async () => {
    const remote = fakeRemote(vi.fn().mockRejectedValue(new Error('network down')))
    const controller = new FinanceAuditController(remote)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('network down')
  })

  it('ignores stale responses after a newer load started', async () => {
    let resolveFirst: (value: never) => void = () => {}
    const first = new Promise(resolve => { resolveFirst = resolve as never })
    const remote = fakeRemote(
      vi.fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce({ ok: true, value: overview() }),
    )
    const controller = new FinanceAuditController(remote)
    const firstLoad = controller.load()
    await controller.load()
    resolveFirst({} as never)
    await firstLoad
    // The second load wins; the stale first load must not overwrite it.
    expect(remote.getOverview).toHaveBeenCalledTimes(2)
  })

  it('patches a fresh balance into the current snapshot', async () => {
    const remote = fakeRemote(
      vi.fn().mockResolvedValue({ ok: true, value: overview() }),
      vi.fn().mockResolvedValue({ ok: true, value: { status: 'ok', updatedAt: 2, totalMicros: 200, currency: 'CNY' } }),
    )
    const controller = new FinanceAuditController(remote)
    await controller.load()
    await controller.refreshBalance()
    expect(controller.store.getSnapshot().overview?.balance.totalMicros).toBe(200)
  })

  it('sets the first balance as the peak baseline', async () => {
    const remote = fakeRemote(vi.fn().mockResolvedValue({ ok: true, value: overview() }))
    const controller = new FinanceAuditController(remote)
    await controller.load()
    expect(controller.store.getSnapshot().peak?.micros).toBe(100)
  })

  it('raises the peak when a later balance is higher (recharge)', async () => {
    const remote = fakeRemote(
      vi.fn().mockResolvedValue({ ok: true, value: overview() }),
      vi.fn().mockResolvedValue({ ok: true, value: { status: 'ok', updatedAt: 3, totalMicros: 150, currency: 'CNY' } }),
    )
    const controller = new FinanceAuditController(remote)
    await controller.load()
    await controller.refreshBalance()
    expect(controller.store.getSnapshot().peak?.micros).toBe(150)
  })

  it('keeps the peak when the balance drops (normal spending)', async () => {
    const remote = fakeRemote(
      vi.fn().mockResolvedValue({ ok: true, value: overview() }),
      vi.fn().mockResolvedValue({ ok: true, value: { status: 'ok', updatedAt: 3, totalMicros: 80, currency: 'CNY' } }),
    )
    const controller = new FinanceAuditController(remote)
    await controller.load()
    await controller.refreshBalance()
    expect(controller.store.getSnapshot().peak?.micros).toBe(100)
  })

  it('patches a balance failure into the snapshot without losing the ledger', async () => {
    const remote = fakeRemote(
      vi.fn().mockResolvedValue({ ok: true, value: overview() }),
      vi.fn().mockResolvedValue({ ok: false, error: { code: 'auth', message: 'rejected', details: {} } }),
    )
    const controller = new FinanceAuditController(remote)
    await controller.load()
    await controller.refreshBalance()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.overview?.balance.status).toBe('error')
    expect(state.overview?.balance.code).toBe('client')
    expect(state.overview?.ledger.sessionCount).toBe(1)
  })

  it('falls back to a full load when refreshing an idle store', async () => {
    const remote = fakeRemote(vi.fn().mockResolvedValue({ ok: true, value: overview() }))
    const controller = new FinanceAuditController(remote)
    await controller.refreshBalance()
    expect(remote.getOverview).toHaveBeenCalledTimes(1)
  })

  it('polls backfill progress while the first load runs and stops when done', async () => {
    vi.useFakeTimers()
    try {
      let resolveOverview: (value: never) => void = () => {}
      const overviewPromise = new Promise(resolve => { resolveOverview = resolve as never })
      const progress = { phase: 'backfill', scanned: 45, total: 96, rescanned: 5, startedAt: 1 }
      const remote = fakeRemote(
        vi.fn().mockReturnValueOnce(overviewPromise).mockResolvedValue({ ok: true, value: overview() }),
        vi.fn(),
        vi.fn().mockResolvedValue({ ok: true, value: progress }),
      )
      const controller = new FinanceAuditController(remote)
      const load = controller.load()
      // The first load shows the loading state and starts polling.
      expect(controller.store.getSnapshot().status).toBe('loading')
      await vi.advanceTimersByTimeAsync(700)
      expect(remote.getBackfillProgress).toHaveBeenCalled()
      expect(controller.store.getSnapshot().progress?.scanned).toBe(45)
      expect(controller.store.getSnapshot().progress?.total).toBe(96)
      // The load settles: polling stops and progress clears.
      resolveOverview({ ok: true, value: overview() } as never)
      await load
      expect(controller.store.getSnapshot().status).toBe('ready')
      expect(controller.store.getSnapshot().progress).toBeUndefined()
      const callsWhileLoading = remote.getBackfillProgress.mock.calls.length
      await vi.advanceTimersByTimeAsync(2000)
      expect(remote.getBackfillProgress.mock.calls.length).toBe(callsWhileLoading)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes quietly when an overview is already visible (no loading flash)', async () => {
    const remote = fakeRemote(vi.fn().mockResolvedValue({ ok: true, value: overview() }))
    const controller = new FinanceAuditController(remote)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    const refreshing = controller.load()
    // A refresh keeps the visible snapshot instead of flipping to loading.
    expect(controller.store.getSnapshot().status).toBe('ready')
    await refreshing
    expect(controller.store.getSnapshot().status).toBe('ready')
  })

  it('dispose invalidates in-flight reads', async () => {
    const remote = fakeRemote(vi.fn().mockResolvedValue({ ok: true, value: overview() }))
    const controller = new FinanceAuditController(remote)
    const load = controller.load()
    controller.dispose()
    await load
    // The stale load must not flip the snapshot to ready; it stays at loading.
    expect(controller.store.getSnapshot().status).toBe('loading')
  })

})
