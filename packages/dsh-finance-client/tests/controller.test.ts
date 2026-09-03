import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FinanceAuditController } from '../src/client/controller.ts'
import type {
  FinanceLedger,
  FinanceListProvidersResult,
  FinanceProviderBalance,
} from 'dsh-spark-finance/types'

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

const DSH_OVERRIDES_KEY = 'dsh-spark-finance.dsh-provider-overrides'

/** Seed the browser-local auto-fetch overlay for one provider. */
function setAutoFetchOverride(provider: string, autoFetchBalance: boolean): void {
  const raw = memory.get(DSH_OVERRIDES_KEY)
  const all = raw === undefined ? {} : JSON.parse(raw) as Record<string, { autoFetchBalance: boolean; totalPriceMicros: number }>
  all[provider] = { autoFetchBalance, totalPriceMicros: 0 }
  memory.set(DSH_OVERRIDES_KEY, JSON.stringify(all))
}

const ZERO_LEDGER: FinanceLedger = {
  generatedAt: 1,
  currency: 'CNY',
  totals: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
  totalCostMicros: 0,
  meteredCostMicros: 0,
  planEquivalentCostMicros: 0,
  sessionCount: 0,
  workspaceCount: 0,
  taskCount: 0,
  windowedSinceMs: null,
  hourOfDayWindowStartMs: 1,
  byDay: [],
  byModel: [],
  byProvider: [],
  byWorkspace: [],
  tasks: [],
  sessions: [],
  byHourOfDay: [],
  peakValley: { peakCostMicros: 0, offPeakCostMicros: 0, flatCostMicros: 0, unclassifiedCostMicros: 0, legacyCostMicros: 0, shiftSavingsMicros: 0 },
}

function ledgerWith(overrides: Partial<FinanceLedger> = {}): FinanceLedger {
  return { ...ZERO_LEDGER, ...overrides } as FinanceLedger
}

function okBalance(overrides: Partial<FinanceProviderBalance> = {}): FinanceProviderBalance {
  return {
    status: 'ok',
    provider: 'deepseek-official',
    totalMicros: 100_000_000, // 100 CNY
    currency: 'CNY',
    fetchedAt: 1,
    ...overrides,
  }
}

function providerList(rows: Array<{ provider: string; balance: FinanceProviderBalance; sources?: readonly string[] }>): FinanceListProvidersResult {
  return {
    generatedAt: 1,
    providers: rows.map(r => ({
      provider: r.provider,
      sources: (r.sources ?? ['host-known', 'user-config', 'ledger-observed']) as FinanceListProvidersResult['providers'][number]['sources'],
      hostMeta: r.provider === 'deepseek-official'
        ? { defaultBillingMode: 'metered', defaultCurrency: 'CNY', supportsBalanceFetch: true, lockBillingModeAndCurrency: true }
        : undefined,
      userEntry: undefined,
      balance: r.balance,
    })),
  }
}

interface FakeRemote {
  listProviders: ReturnType<typeof vi.fn>
  getLedger: ReturnType<typeof vi.fn>
  refreshBalance: ReturnType<typeof vi.fn>
  getBackfillProgress: ReturnType<typeof vi.fn>
  syncCommunityPrices: ReturnType<typeof vi.fn>
  getSyncStatus: ReturnType<typeof vi.fn>
}

function fakeRemote(
  overrides: Partial<Record<keyof FakeRemote, ReturnType<typeof vi.fn>>> = {},
): FakeRemote {
  return {
    listProviders: vi.fn().mockResolvedValue({ ok: true, value: providerList([]) }),
    getLedger: vi.fn().mockResolvedValue({ ok: true, value: ledgerWith() }),
    refreshBalance: vi.fn().mockResolvedValue({ ok: true, value: okBalance() }),
    getBackfillProgress: vi.fn(),
    syncCommunityPrices: vi.fn(),
    // No successful sync yet: dashboard controller polls but gets null back.
    getSyncStatus: vi.fn().mockResolvedValue({ ok: true, value: null }),
    ...overrides,
  } as unknown as FakeRemote
}

describe('FinanceAuditController (commit 21: multi-provider)', () => {
  it('loads the provider list + ledger into the store', async () => {
    const list = providerList([
      { provider: 'deepseek-official', balance: okBalance({ totalMicros: 100_000_000 }) },
    ])
    const led = ledgerWith({ totalCostMicros: 42 })
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
      getLedger: vi.fn().mockResolvedValue({ ok: true, value: led }),
    })
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.ledger?.totalCostMicros).toBe(42)
    expect(state.providerList?.providers).toHaveLength(1)
    expect(state.providerList?.providers[0]?.provider).toBe('deepseek-official')
  })

  it('maps a Remote failure envelope from listProviders to the error state', async () => {
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: false, error: { code: 'internal', message: 'boom', details: {} } }),
    })
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('maps a Remote failure envelope from getLedger to the error state', async () => {
    const remote = fakeRemote({
      getLedger: vi.fn().mockResolvedValue({ ok: false, error: { code: 'internal', message: 'ledger down', details: {} } }),
    })
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('error')
    expect(controller.store.getSnapshot().error).toBe('ledger down')
  })

  it('maps a rejected promise to the error state', async () => {
    const remote = fakeRemote({
      listProviders: vi.fn().mockRejectedValue(new Error('network down')),
    })
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('error')
    expect(controller.store.getSnapshot().error).toBe('network down')
  })

  it('ignores stale responses after a newer load started', async () => {
    let resolveFirst: (value: never) => void = () => {}
    const first = new Promise(resolve => { resolveFirst = resolve as never })
    const remote = fakeRemote({
      listProviders: vi.fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce({ ok: true, value: providerList([]) }),
      getLedger: vi.fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce({ ok: true, value: ledgerWith() }),
    })
    const controller = new FinanceAuditController(remote as never)
    const firstLoad = controller.load()
    await controller.load()
    resolveFirst({} as never)
    await firstLoad
    expect(remote.listProviders).toHaveBeenCalledTimes(2)
  })

  it('tracks per-provider peaks from the first load', async () => {
    const list = providerList([
      { provider: 'deepseek-official', balance: okBalance({ totalMicros: 100_000_000 }) },
      { provider: 'minimax-cn', balance: { status: 'unsupported', provider: 'minimax-cn', code: 'unsupported-provider', message: 'no endpoint', fetchedAt: 1 } },
    ])
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
    })
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    const peaks = controller.store.getSnapshot().peaks
    expect(peaks['deepseek-official']?.byCurrency.CNY?.micros).toBe(100_000_000)
    // Unsupported slots don't seed a peak (no money to track).
    expect(peaks['minimax-cn']).toBeUndefined()
  })

  it('auto-fetches gate-disabled providers whose overlay flags auto-fetch', async () => {
    const list = providerList([
      { provider: 'deepseek-official', balance: { status: 'unsupported', provider: 'deepseek-official', code: 'unsupported-provider', message: 'no per-provider entry', fetchedAt: 1 } },
    ])
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
      refreshBalance: vi.fn().mockResolvedValue({
        ok: true, value: okBalance({ totalMicros: 200_000_000, fetchedAt: 2 }),
      }),
    })
    setAutoFetchOverride('deepseek-official', true)
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    // The flagged row is force-refreshed past the host gate.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(remote.refreshBalance).toHaveBeenCalledWith({ provider: 'deepseek-official' })
    const dsSlot = controller.store.getSnapshot().providerList?.providers.find(p => p.provider === 'deepseek-official')
    expect(dsSlot?.balance.status).toBe('ok')
    expect(dsSlot?.balance.totalMicros).toBe(200_000_000)
    expect(controller.store.getSnapshot().peaks['deepseek-official']?.byCurrency.CNY?.micros).toBe(200_000_000)
  })

  it('does not force-fetch providers without the auto-fetch overlay flag', async () => {
    const list = providerList([
      { provider: 'deepseek-official', balance: { status: 'unsupported', provider: 'deepseek-official', code: 'unsupported-provider', message: 'no per-provider entry', fetchedAt: 1 } },
    ])
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
    })
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(remote.refreshBalance).not.toHaveBeenCalled()
  })

  it('auto-fetch flag is ignored once a provider is not fetch-capable (no hostMeta)', async () => {
    const list = providerList([
      { provider: 'minimax-cn', balance: { status: 'unsupported', provider: 'minimax-cn', code: 'unsupported-provider', message: 'no endpoint', fetchedAt: 1 } },
    ])
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
    })
    setAutoFetchOverride('minimax-cn', true)
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(remote.refreshBalance).not.toHaveBeenCalled()
  })

  it('patches a fresh per-provider balance via refreshProvider and bumps the peak', async () => {
    const list = providerList([
      { provider: 'deepseek-official', balance: okBalance({ totalMicros: 100_000_000 }) },
    ])
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
      refreshBalance: vi.fn().mockResolvedValue({
        ok: true, value: okBalance({ totalMicros: 200_000_000, fetchedAt: 2 }),
      }),
    })
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    expect(controller.store.getSnapshot().peaks['deepseek-official']?.byCurrency.CNY?.micros).toBe(100_000_000)

    await controller.refreshProvider('deepseek-official')
    const after = controller.store.getSnapshot()
    expect(after.peaks['deepseek-official']?.byCurrency.CNY?.micros).toBe(200_000_000)
    expect(after.providerList?.providers[0]?.balance.totalMicros).toBe(200_000_000)
  })

  it('keeps the per-provider peak when the balance drops (normal spending)', async () => {
    const list = providerList([
      { provider: 'deepseek-official', balance: okBalance({ totalMicros: 100_000_000 }) },
    ])
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
      refreshBalance: vi.fn().mockResolvedValue({
        ok: true, value: okBalance({ totalMicros: 80_000_000, fetchedAt: 2 }),
      }),
    })
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    await controller.refreshProvider('deepseek-official')
    expect(controller.store.getSnapshot().peaks['deepseek-official']?.byCurrency.CNY?.micros).toBe(100_000_000)
  })

  it('patches a refresh failure into the per-row slot without losing other rows', async () => {
    const list = providerList([
      { provider: 'deepseek-official', balance: okBalance({ totalMicros: 100_000_000 }) },
      { provider: 'minimax-cn', balance: { status: 'unsupported', provider: 'minimax-cn', code: 'unsupported-provider', message: 'no endpoint', fetchedAt: 1 } },
    ])
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
      refreshBalance: vi.fn().mockResolvedValue({
        ok: false, error: { code: 'auth', message: 'rejected', details: {} },
      }),
    })
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    await controller.refreshProvider('deepseek-official')
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    const dsSlot = state.providerList?.providers.find(p => p.provider === 'deepseek-official')
    expect(dsSlot?.balance.status).toBe('error')
    expect(dsSlot?.balance.code).toBe('client')
    expect(dsSlot?.balance.message).toBe('rejected')
    // The other row survives the failure.
    const mmSlot = state.providerList?.providers.find(p => p.provider === 'minimax-cn')
    expect(mmSlot?.balance.status).toBe('unsupported')
  })

  it('falls back to a full load when refreshing from an idle store', async () => {
    const remote = fakeRemote()
    const controller = new FinanceAuditController(remote as never)
    await controller.refreshProvider('deepseek-official')
    expect(remote.listProviders).toHaveBeenCalledTimes(1)
    expect(remote.getLedger).toHaveBeenCalledTimes(1)
  })

  it('refreshLedger only re-pulls the ledger (no balance refetch)', async () => {
    const list = providerList([
      { provider: 'deepseek-official', balance: okBalance({ totalMicros: 100_000_000 }) },
    ])
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
    })
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    expect(remote.listProviders).toHaveBeenCalledTimes(1)
    const before = remote.getLedger.mock.calls.length
    await controller.refreshLedger()
    expect(remote.getLedger.mock.calls.length).toBe(before + 1)
    // listProviders is not re-called.
    expect(remote.listProviders).toHaveBeenCalledTimes(1)
  })

  it('refreshes quietly when a snapshot is already visible (no loading flash)', async () => {
    const remote = fakeRemote()
    const controller = new FinanceAuditController(remote as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    const refreshing = controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    await refreshing
    expect(controller.store.getSnapshot().status).toBe('ready')
  })

  it('polls backfill progress while the first load runs and stops when done', async () => {
    vi.useFakeTimers()
    try {
      let resolveList: (value: never) => void = () => {}
      const listPromise = new Promise(resolve => { resolveList = resolve as never })
      const ledPromise = listPromise
      const progress = { phase: 'backfill' as const, scanned: 45, total: 96, rescanned: 5, startedAt: 1 }
      const remote = fakeRemote({
        listProviders: vi.fn().mockReturnValueOnce(listPromise),
        getLedger: vi.fn().mockReturnValueOnce(ledPromise),
        getBackfillProgress: vi.fn().mockResolvedValue({ ok: true, value: progress }),
      })
      const controller = new FinanceAuditController(remote as never)
      const load = controller.load()
      expect(controller.store.getSnapshot().status).toBe('loading')
      await vi.advanceTimersByTimeAsync(700)
      expect(remote.getBackfillProgress).toHaveBeenCalled()
      expect(controller.store.getSnapshot().progress?.scanned).toBe(45)
      expect(controller.store.getSnapshot().progress?.total).toBe(96)
      resolveList({ ok: true, value: providerList([]) } as never)
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

  it('dispose invalidates in-flight reads', async () => {
    const remote = fakeRemote()
    const controller = new FinanceAuditController(remote as never)
    const load = controller.load()
    controller.dispose()
    await load
    // The stale load must not flip the snapshot to ready; it stays at loading.
    expect(controller.store.getSnapshot().status).toBe('loading')
  })
})
