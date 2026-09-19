import { describe, expect, it, vi } from 'vitest'
import type { FinanceLedger, FinanceListProvidersResult, FinanceProviderBalance } from 'dsh-spark-finance/types'
import { FinancePanelController } from '../src/client/controller.ts'

// dsh-client-runtime ./client 是浏览器 bundle（模块级 window）；测试用普通 store 顶替。
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

const ZERO_LEDGER: FinanceLedger = {
  generatedAt: 1,
  currency: 'CNY',
  totals: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
  totalCostMicros: 0,
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
  unreadableSessions: [],
  byHourOfDay: [],
  peakValley: { peakCostMicros: 0, offPeakCostMicros: 0, flatCostMicros: 0, unclassifiedCostMicros: 0, legacyCostMicros: 0, shiftSavingsMicros: 0 },
}

const okBalance = (overrides: Partial<FinanceProviderBalance> = {}): FinanceProviderBalance => ({
  status: 'ok',
  provider: 'deepseek-official',
  totalMicros: 100_000_000,
  currency: 'CNY',
  fetchedAt: 1,
  ...overrides,
})

const providerList = (rows: Array<{ provider: string; balance: FinanceProviderBalance }>): FinanceListProvidersResult => ({
  generatedAt: 1,
  providers: rows.map((row) => ({
    provider: row.provider,
    sources: ['host-known'] as FinanceListProvidersResult['providers'][number]['sources'],
    balance: row.balance,
  })),
})

const STUB_SYNC_RESULT = {
  ok: true,
  source: 'models.dev',
  fx: 7.2,
  requestedProviders: [],
  requestedMissing: [],
  kept: 0,
  droppedDated: 0,
  droppedNonToken: 0,
  droppedNoCost: 0,
  providers: [],
}

const STUB_PRICE_TABLE = {
  base: {
    ok: true,
    source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    updated: '2026-09-16T00:00:00.000Z',
    expected: 'stub',
    actual: 'stub',
  },
  overlay: null,
  overlayKeyCount: 0,
  userKeyCount: 0,
  rejected: [],
}

interface FakeRemote {
  listProviders: ReturnType<typeof vi.fn>
  getLedger: ReturnType<typeof vi.fn>
  refreshBalance: ReturnType<typeof vi.fn>
  getSyncStatus: ReturnType<typeof vi.fn>
  getPriceTableStatus: ReturnType<typeof vi.fn>
  syncCommunityPrices: ReturnType<typeof vi.fn>
  clearPriceOverlay: ReturnType<typeof vi.fn>
}

function fakeRemote(overrides: Partial<Record<keyof FakeRemote, ReturnType<typeof vi.fn>>> = {}): FakeRemote {
  return {
    listProviders: vi.fn().mockResolvedValue({ ok: true, value: providerList([]) }),
    getLedger: vi.fn().mockResolvedValue({ ok: true, value: ZERO_LEDGER }),
    refreshBalance: vi.fn().mockResolvedValue({ ok: true, value: okBalance() }),
    getSyncStatus: vi.fn().mockResolvedValue({ ok: true, value: null }),
    getPriceTableStatus: vi.fn().mockResolvedValue({ ok: true, value: STUB_PRICE_TABLE }),
    syncCommunityPrices: vi.fn().mockResolvedValue({ ok: true, value: STUB_SYNC_RESULT }),
    clearPriceOverlay: vi.fn().mockResolvedValue({ ok: true, value: { cleared: false, clearedKeys: 0 } }),
    ...overrides,
  } as unknown as FakeRemote
}

describe('FinancePanelController', () => {
  it('loads the provider list + ledger and clears the loading state', async () => {
    const list = providerList([{ provider: 'deepseek-official', balance: okBalance() }])
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
      getLedger: vi.fn().mockResolvedValue({ ok: true, value: { ...ZERO_LEDGER, totalCostMicros: 42 } }),
    })
    const controller = new FinancePanelController(remote as never)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.ledger?.totalCostMicros).toBe(42)
    expect(state.providerList?.providers).toHaveLength(1)
    expect(state.error).toBeNull()
  })

  it('goes to the error state with the envelope message when listProviders fails', async () => {
    const remote = fakeRemote({ listProviders: vi.fn().mockResolvedValue({ ok: false, error: { message: 'boom' } }) })
    const controller = new FinancePanelController(remote as never)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('goes to the error state when getLedger fails', async () => {
    const remote = fakeRemote({ getLedger: vi.fn().mockResolvedValue({ ok: false, error: { message: 'ledger down' } }) })
    const controller = new FinancePanelController(remote as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('error')
    expect(controller.store.getSnapshot().error).toBe('ledger down')
  })

  it('keeps the last good snapshot and reports a thrown error', async () => {
    const remote = fakeRemote()
    const controller = new FinancePanelController(remote as never)
    await controller.load()
    remote.getLedger.mockRejectedValue(new Error('network'))
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('network')
    expect(state.ledger).toBeDefined()
  })

  it('lands backfill progress frames and accumulates the action log', () => {
    const controller = new FinancePanelController(fakeRemote() as never)
    controller.setProgress({ phase: 'backfill', percent: 20, scanned: 1, total: 9, rescanned: 0, startedAt: 0, line: 'backfill 1/9 replay s1' })
    controller.setProgress({ phase: 'backfill', percent: 40, scanned: 2, total: 9, rescanned: 1, startedAt: 0, line: 'backfill 2/9 cached s2' })
    const state = controller.store.getSnapshot()
    expect(state.progress?.scanned).toBe(2)
    expect(state.progress?.percent).toBe(40)
    expect(state.progressLines).toEqual(['backfill 1/9 replay s1', 'backfill 2/9 cached s2'])
    // 同一行重复推帧不重复累积
    controller.setProgress({ phase: 'backfill', percent: 40, scanned: 2, total: 9, rescanned: 1, startedAt: 0, line: 'backfill 2/9 cached s2' })
    expect(controller.store.getSnapshot().progressLines).toHaveLength(2)
  })

  it('patches a single provider balance without touching the others', async () => {
    const list = providerList([
      { provider: 'deepseek-official', balance: okBalance({ totalMicros: 1 }) },
      { provider: 'other', balance: { status: 'unsupported', provider: 'other', fetchedAt: 1 } },
    ])
    const remote = fakeRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: true, value: list }),
      refreshBalance: vi.fn().mockResolvedValue({ ok: true, value: okBalance({ totalMicros: 999 }) }),
    })
    const controller = new FinancePanelController(remote as never)
    await controller.load()
    await controller.refreshProvider('deepseek-official')
    const providers = controller.store.getSnapshot().providerList?.providers ?? []
    expect(providers.find((row) => row.provider === 'deepseek-official')?.balance.totalMicros).toBe(999)
    expect(providers.find((row) => row.provider === 'other')?.balance.status).toBe('unsupported')
  })

  it('reads plans from the settings seam and writes them back', async () => {
    let plans = [{ provider: 'acme', monthlyMicros: 5_000_000, currency: 'CNY', effectiveFrom: 0 }]
    let listeners = 0
    const seam = {
      getSnapshot: () => ({ plans, tiers: {}, writable: true }),
      subscribe: () => { listeners += 1; return () => { listeners -= 1 } },
      write: async (next: typeof plans) => { plans = next },
    }
    const controller = new FinancePanelController(fakeRemote() as never, seam as never)
    expect(controller.store.getSnapshot().plans).toHaveLength(1)
    expect(controller.store.getSnapshot().plansWritable).toBe(true)

    await controller.savePlan({ provider: 'other', monthlyMicros: 1_000_000, currency: 'CNY', effectiveFrom: 0 })
    expect(plans.map((plan) => plan.provider).sort()).toEqual(['acme', 'other'])

    // 同 provider 覆盖而不是追加
    await controller.savePlan({ provider: 'acme', monthlyMicros: 9_000_000, currency: 'CNY', effectiveFrom: 0 })
    expect(plans.find((plan) => plan.provider === 'acme')?.monthlyMicros).toBe(9_000_000)

    await controller.removePlan('other')
    expect(plans.map((plan) => plan.provider)).toEqual(['acme'])

    controller.dispose()
    expect(listeners).toBe(0)
  })

  it('updatePrices 带业务参数调用 syncCommunityPrices（平台客户端校验 arity）', async () => {
    const remote = fakeRemote()
    const controller = new FinancePanelController(remote as never)
    await controller.updatePrices()
    expect(remote.syncCommunityPrices).toHaveBeenCalledWith({})
  })

  it('价格动作结束后 priceBusy 必须复位（成功路径不得永久禁用两枚价格按钮）', async () => {
    // 回归：runPriceAction 成功时会 await this.load()，而 load() 自己 ++generation；
    // 若 finally 用动作开始时的 generation 做守卫，priceBusy 就永远停在 true，
    // 「更新价格表」「还原到发版快照」两枚按钮从此 disabled 且不给原因（UI-UX-SPEC §3.1）。
    const controller = new FinancePanelController(fakeRemote() as never)
    await controller.load()
    expect(controller.store.getSnapshot().priceBusy).toBe(false)
    await controller.updatePrices()
    expect(controller.store.getSnapshot().priceBusy).toBe(false)
    await controller.restorePrices()
    expect(controller.store.getSnapshot().priceBusy).toBe(false)
  })

  it('价格动作失败时同样复位 priceBusy，并把失败写进 priceError', async () => {
    const remote = fakeRemote({ syncCommunityPrices: vi.fn().mockResolvedValue({ ok: false, error: { message: 'sync down' } }) })
    const controller = new FinancePanelController(remote as never)
    await controller.load()
    await controller.updatePrices()
    const state = controller.store.getSnapshot()
    expect(state.priceBusy).toBe(false)
    expect(state.priceError).toBe('sync down')
  })

  it('records the last successful community sync for the price footnote', async () => {
    const remote = fakeRemote({ getPriceTableStatus: vi.fn().mockResolvedValue({ ok: true, value: { ...STUB_PRICE_TABLE, overlay: { source: 'models.dev', appliedAt: 123, kept: 1, providers: [], fx: 7.2 } } }) })
    const controller = new FinancePanelController(remote as never)
    await controller.load()
    expect(controller.store.getSnapshot().lastSyncAppliedAt).toBe(123)
  })
})
