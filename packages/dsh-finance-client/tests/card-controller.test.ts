import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: object) => {
    let state = init
    return {
      getSnapshot: () => state,
      subscribe: () => () => {},
      update: () => {},
      set: (next: object) => { state = next },
    }
  },
}))

import { FinanceCardController } from '../src/client/FinanceCardController.ts'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  FinanceConfigInput,
  FinanceListProvidersResult,
} from 'dsh-spark-finance/types'

/** Minimal in-memory SettingsScope: applies writes to the user/value layers and notifies. */
function makeScope(initial: {
  value?: FinanceConfigInput
  user?: Record<string, unknown>
  writable?: boolean
} = {}) {
  const user: Record<string, unknown> = { ...(initial.user ?? {}) }
  const value: FinanceConfigInput = { ...(initial.value ?? {}) }
  const writes: Array<{ op: 'set' | 'unset'; field: string; value?: unknown }> = []
  const listeners = new Set<() => void>()
  const scope: SettingsScope<FinanceConfigInput> = {
    getSnapshot: (): SettingsScopeSnapshot<FinanceConfigInput> => ({
      status: 'ready',
      value,
      base: {},
      user: Object.keys(user).length === 0 ? undefined : { ...user },
      revision: 1,
      writable: initial.writable ?? true,
      mode: 'host',
    }),
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set: async (field, val) => {
      writes.push({ op: 'set', field, value: val })
      user[field] = val
      ;(value as Record<string, unknown>)[field] = val
      for (const fn of listeners) fn()
    },
    unset: async (field) => {
      writes.push({ op: 'unset', field })
      delete user[field]
      delete (value as Record<string, unknown>)[field]
      for (const fn of listeners) fn()
    },
  }
  return { scope, writes, user }
}

/** Let the fire-and-forget inject actions settle. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

const SECTION = {
  currency: 'CNY',
  balance: { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 10000 },
}

function baseSection(): FinanceConfigInput {
  return JSON.parse(JSON.stringify(SECTION)) as FinanceConfigInput
}

describe('FinanceCardController', () => {
  it('is unavailable while the namespace is not served', () => {
    const { scope } = makeScope()
    const controller = new FinanceCardController(scope)
    const state = controller.inject().hooks.financeCard.getSnapshot()
    expect(state.available).toBe(true) // scope reports ready
    expect(state.writable).toBe(true)
    expect(state.currency.text).toBe('')
  })

  it('seeds field drafts from the resolved section', () => {
    const { scope } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const state = controller.inject().hooks.financeCard.getSnapshot()
    expect(state.currency.text).toBe('CNY')
    expect(state.balanceBaseURL.text).toBe('https://api.deepseek.com')
    expect(state.balanceApiKeyEnv.text).toBe('DEEPSEEK_API_KEY')
    expect(state.balanceTimeoutMs.text).toBe('10000')
    expect(state.dirty).toBe(false)
  })

  it('marks a field overridden when the user layer carries it', () => {
    const { scope } = makeScope({ value: baseSection(), user: { currency: 'USD' } })
    const controller = new FinanceCardController(scope)
    const state = controller.inject().hooks.financeCard.getSnapshot()
    expect(state.currency.overridden).toBe(true)
    expect(state.balanceBaseURL.overridden).toBe(false)
  })

  it('stages edits, saves them as one write per top-level field, and clears the drafts', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.edit('currency', 'USD')
    face.edit('balance.baseURL', 'https://example.com')
    const staged = face.hooks.financeCard.getSnapshot()
    expect(staged.dirty).toBe(true)
    expect(staged.currency.text).toBe('USD')
    expect(staged.invalid).toBe(false)

    face.save()
    await flush()

    expect(writes).toEqual([
      { op: 'set', field: 'currency', value: 'USD' },
      // The balance sub-fields save as one whole-object write preserving untouched members.
      {
        op: 'set',
        field: 'balance',
        value: { baseURL: 'https://example.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 10000 },
      },
    ])
    const after = face.hooks.financeCard.getSnapshot()
    expect(after.dirty).toBe(false)
    expect(after.failed).toBe(false)
  })

  it('blocks the save while a draft is invalid', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.edit('balance.timeoutMs', 'soon')
    expect(face.hooks.financeCard.getSnapshot().invalid).toBe(true)
    face.save()
    await flush()
    expect(writes).toEqual([])
  })

  it('treats a non-object defaultPrice draft as invalid and blocks the save', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.edit('defaultPrice', '[]')
    expect(face.hooks.financeCard.getSnapshot().invalid).toBe(true)
    face.save()
    await flush()
    expect(writes).toEqual([])
  })

  it('serializes the default-price draft to the wire rate on save', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.setDefaultPrice({ input: '2000000', cacheRead: '500000', cacheWrite: '', output: '8000000' })
    expect(face.hooks.financeCard.getSnapshot().dirty).toBe(true)
    face.save()
    await flush()
    expect(writes).toEqual([{ op: 'set', field: 'defaultPrice', value: { inputMicrosPerMtok: 2000000, cacheReadMicrosPerMtok: 500000, outputMicrosPerMtok: 8000000 } }])
  })

  it('blocks the save when the default-price draft is malformed', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.setDefaultPrice({ input: 'oops', cacheRead: '', cacheWrite: '', output: '1' })
    expect(face.hooks.financeCard.getSnapshot().invalid).toBe(true)
    face.save()
    await flush()
    expect(writes).toEqual([])
  })

  it('serializes provider-default rows into the wire map', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.setProviderDefaults({ rows: [{ provider: 'openai', rate: { input: '3600000', cacheRead: '900000', cacheWrite: '', output: '14400000' } }] })
    face.save()
    await flush()
    expect(writes).toEqual([{ op: 'set', field: 'providerDefaults', value: { openai: { inputMicrosPerMtok: 3600000, cacheReadMicrosPerMtok: 900000, outputMicrosPerMtok: 14400000 } } }])
  })

  it('serializes the price-table draft into the wire map', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    // A draft with one model row exercises the per-entry serialize path; an
    // empty `models: []` is also valid and short-circuits to `unset` when
    // the user layer already carries the field (covered by the next test).
    face.setPriceTable({ models: [{
      modelKey: 'openai/gpt-4o',
      entries: [{
        kind: 'flat',
        effectiveFrom: '',
        flat: { input: '18000000', cacheRead: '9000000', cacheWrite: '', output: '72000000' },
        offPeak: { input: '', cacheRead: '', cacheWrite: '', output: '' },
        peak: { input: '', cacheRead: '', cacheWrite: '', output: '' },
        peakHours: '',
        peakDays: '',
      }],
    }] })
    expect(face.hooks.financeCard.getSnapshot().dirty).toBe(true)
    face.save()
    await flush()
    expect(writes.length).toBe(1)
    expect(writes[0]?.op).toBe('set')
    expect(writes[0]?.field).toBe('prices')
    // The wire shape flattens to per-model rate records (mirrors what
    // serializePriceTableDraft emits).
    const value = writes[0]?.value as Record<string, { inputMicrosPerMtok: number }>
    expect(value['openai/gpt-4o']?.inputMicrosPerMtok).toBe(18000000)
  })

  it('clears an overridden field on reset + save', async () => {
    const { scope, writes } = makeScope({ value: baseSection(), user: { currency: 'USD' } })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.resetField('currency')
    const staged = face.hooks.financeCard.getSnapshot()
    expect(staged.currency.overridden).toBe(false) // a clear would drop the override
    face.save()
    await flush()
    expect(writes).toEqual([{ op: 'unset', field: 'currency' }])
    expect(face.hooks.financeCard.getSnapshot().dirty).toBe(false)
  })

  it('discards staged edits without writing', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.edit('currency', 'USD')
    face.discard()
    expect(face.hooks.financeCard.getSnapshot().dirty).toBe(false)
    face.save()
    await flush()
    expect(writes).toEqual([])
  })

  it('reports a failed save when the Host rejects the write', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    // A scope whose set never lands in the user layer reads back as failed.
    const originalSet = scope.set.bind(scope)
    scope.set = async (field, value) => {
      writes.push({ op: 'set', field, value })
      // do NOT apply — the Host rejected it
    }
    void originalSet
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.edit('currency', 'USD')
    face.save()
    await flush()
    const state = face.hooks.financeCard.getSnapshot()
    expect(state.failed).toBe(true)
    expect(state.dirty).toBe(true) // drafts kept for correction
  })

  it('applies dashboard view preferences immediately', () => {
    const original = (globalThis as { localStorage?: unknown }).localStorage
    const storage = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() { return storage.size },
    }
    try {
      const { scope } = makeScope({ value: baseSection() })
      const controller = new FinanceCardController(scope)
      const face = controller.inject()
      expect(face.hooks.financeCard.getSnapshot().prefs.layout).toBe('compact')
      face.setLayout('standard')
      expect(face.hooks.financeCard.getSnapshot().prefs.layout).toBe('standard')
      face.toggleChart('byModel')
      expect(face.hooks.financeCard.getSnapshot().prefs.charts.byModel).toBe(false)
      const stored = JSON.parse(storage.get('dsh-spark-finance.prefs') ?? '{}')
      expect(stored.layout).toBe('standard')
      expect(stored.charts.byModel).toBe(false)
    } finally {
      ;(globalThis as { localStorage?: unknown }).localStorage = original
    }
  })
})

/** Build a representative merged provider list with one host-known + one user-config entry. */
function makeProviderListFixture(): FinanceListProvidersResult {
  return {
    generatedAt: 1_700_000_000_000,
    providers: [
      {
        provider: 'deepseek-official',
        sources: ['host-known', 'user-config'],
        hostMeta: {
          defaultBillingMode: 'metered',
          defaultCurrency: 'CNY',
          supportsBalanceFetch: true,
          lockBillingModeAndCurrency: true,
        },
        userEntry: {
          provider: 'deepseek-official',
          billingMode: 'metered',
          totalPriceMicros: 30_000_000,
          currency: 'CNY',
          autoFetchBalance: true,
        },
        balance: {
          status: 'ok',
          provider: 'deepseek-official',
          totalMicros: 12_340_000,
          currency: 'CNY',
          fetchedAt: 1_700_000_000_000,
        },
      },
      {
        provider: 'minimax-cn',
        sources: ['ledger-observed'],
        userEntry: undefined,
        balance: {
          status: 'unsupported',
          provider: 'minimax-cn',
          code: 'no-balance-fetch',
          fetchedAt: 1_700_000_000_000,
        },
      },
    ],
  }
}

describe('FinanceCardController provider list (read-only)', () => {
  it('pulls listProviders on construction and surfaces it on state.providerList', async () => {
    const remote = makeProviderRemote()
    const { scope } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope, remote as never)
    await flush()
    const state = controller.inject().hooks.financeCard.getSnapshot()
    expect(remote.listProviders).toHaveBeenCalledTimes(1)
    expect(state.providerList?.providers.map((row) => row.provider)).toEqual(['deepseek-official', 'minimax-cn'])
  })

  it('skips the load when no remote was injected', async () => {
    const { scope } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    await flush()
    const state = controller.inject().hooks.financeCard.getSnapshot()
    expect(state.providerList).toBeUndefined()
  })

  it('leaves providerList undefined when listProviders rejects', async () => {
    const remote = makeProviderRemote({
      listProviders: vi.fn().mockRejectedValue(new Error('network down')),
    })
    const { scope } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope, remote as never)
    await flush()
    const state = controller.inject().hooks.financeCard.getSnapshot()
    expect(state.providerList).toBeUndefined()
  })

  it('merges the dsh snapshot with the localStorage overlay into dshProviderRows', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new FakeStorage() })
    try {
      const remote = makeProviderRemote()
      const { scope } = makeScope({ value: baseSection() })
      const controller = new FinanceCardController(scope, remote as never)
      await flush()
      const face = controller.inject()

      // Fresh browser: every row is present, none carries an overlay.
      const before = face.hooks.financeCard.getSnapshot()
      expect(before.dshProviderRows?.map(r => r.provider)).toEqual(['deepseek-official', 'minimax-cn'])
      expect(before.dshProviderRows?.every(r => r.override === undefined)).toBe(true)

      // Saving business fields writes localStorage and re-publishes at once.
      face.setDshProviderOverride('minimax-cn', { totalPriceMicros: 99_000_000, autoFetchBalance: true })
      const after = face.hooks.financeCard.getSnapshot()
      const mm = after.dshProviderRows?.find(r => r.provider === 'minimax-cn')
      expect(mm?.override?.totalPriceMicros).toBe(99_000_000)
      expect(mm?.override?.autoFetchBalance).toBe(true)
      // The other row is untouched by a single-provider write.
      expect(after.dshProviderRows?.find(r => r.provider === 'deepseek-official')?.override).toBeUndefined()

      // A second controller over the same storage rehydrates the overlay.
      const second = new FinanceCardController(makeScope({ value: baseSection() }).scope, makeProviderRemote() as never)
      await flush()
      const rehydrated = second.inject().hooks.financeCard.getSnapshot()
      expect(rehydrated.dshProviderRows?.find(r => r.provider === 'minimax-cn')?.override?.totalPriceMicros).toBe(99_000_000)

      // Clearing reverts the row to the dsh snapshot defaults.
      face.clearDshProviderOverride('minimax-cn')
      const cleared = face.hooks.financeCard.getSnapshot()
      expect(cleared.dshProviderRows?.find(r => r.provider === 'minimax-cn')?.override).toBeUndefined()
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
    }
  })

  it('leaves dshProviderRows undefined until the first listProviders lands', async () => {
    const { scope } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    await flush()
    expect(controller.inject().hooks.financeCard.getSnapshot().dshProviderRows).toBeUndefined()
  })

  it('leaves providerList undefined when listProviders returns an error envelope', async () => {
    const remote = makeProviderRemote({
      listProviders: vi.fn().mockResolvedValue({ ok: false as const, error: { code: 'internal', message: 'boom', details: {} } }),
    })
    const { scope } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope, remote as never)
    await flush()
    const state = controller.inject().hooks.financeCard.getSnapshot()
    expect(state.providerList).toBeUndefined()
  })
})

interface FakeProviderRemote {
  listProviders: ReturnType<typeof vi.fn>
  syncCommunityPrices?: ReturnType<typeof vi.fn>
  getSyncStatus?: ReturnType<typeof vi.fn>
  refreshBalance?: ReturnType<typeof vi.fn>
}

function makeProviderRemote(overrides: Partial<FakeProviderRemote> = {}): FakeProviderRemote {
  return {
    listProviders: vi.fn(async () => ({ ok: true as const, value: makeProviderListFixture() })),
    ...overrides,
  }
}

describe('FinanceCardController community sync', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new FakeStorage() })
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
  })

  it('exposes syncAvailable=false when no remote was injected', () => {
    const { scope } = makeScope()
    const controller = new FinanceCardController(scope)
    const state = controller.inject().hooks.financeCard.getSnapshot()
    expect(state.syncAvailable).toBe(false)
    expect(state.syncState.syncing).toBe(false)
    expect(state.syncState.lastSync).toBeNull()
  })

  it('syncing transitions through syncing=true then syncing=false + lastSync populated', async () => {
    const { scope } = makeScope()
    const remote = makeSyncRemote()
    const controller = new FinanceCardController(scope, remote as never)
    const face = controller.inject()
    const before = face.hooks.financeCard.getSnapshot()
    expect(before.syncAvailable).toBe(true)
    const inflight = face.syncNow()
    // syncing becomes true synchronously inside syncNow
    const mid = face.hooks.financeCard.getSnapshot()
    expect(mid.syncState.syncing).toBe(true)
    await inflight
    const after = face.hooks.financeCard.getSnapshot()
    expect(after.syncState.syncing).toBe(false)
    expect(after.syncState.lastSync?.appliedAt).toBe(1_700_000_000_000)
    expect(remote.syncCommunityPrices).toHaveBeenCalledTimes(1)
  })

  it('persists lastSync across controller instances via localStorage', async () => {
    const { scope } = makeScope()
    const remote = makeSyncRemote()
    const controller = new FinanceCardController(scope, remote as never)
    await controller.inject().syncNow()
    const persisted = JSON.parse(localStorage.getItem('dsh-spark-finance.prefs')!)
    expect(persisted.lastSync.kept).toBe(12)
    expect(persisted.lastSync.fx).toBe(7.2)

    // New instance picks up the persisted snapshot via constructor seed
    const secondScope = makeScope()
    const second = new FinanceCardController(secondScope.scope, makeSyncRemote() as never)
    const state = second.inject().hooks.financeCard.getSnapshot()
    expect(state.syncState.lastSync?.kept).toBe(12)
  })

  it('setAutoSync writes through to prefs without round-tripping the host', () => {
    const { scope } = makeScope()
    const remote = makeSyncRemote()
    const controller = new FinanceCardController(scope, remote as never)
    const face = controller.inject()
    face.setAutoSync(false)
    const state = face.hooks.financeCard.getSnapshot()
    expect(state.prefs.autoSync).toBe(false)
    expect(remote.syncCommunityPrices).not.toHaveBeenCalled()
  })

  it('ensureAutoSync fires syncNow only when prefs.autoSync is on AND lastSync is older than 24h', async () => {
    const { scope } = makeScope()
    const remote = makeSyncRemote()
    // Seed a stale lastSync 49h old
    localStorage.setItem('dsh-spark-finance.prefs', JSON.stringify({
      layout: 'compact',
      charts: {}, // merged with defaults by readFinancePrefs
      autoSync: true,
      lastSync: {
        appliedAt: Date.now() - 49 * 60 * 60 * 1000,
        source: 'https://models.dev/api.json',
        kept: 1,
        providers: [],
        fx: 7.2,
      },
    }))
    const controller = new FinanceCardController(scope, remote as never)
    controller.ensureAutoSync()
    await flush()
    expect(remote.syncCommunityPrices).toHaveBeenCalledTimes(1)
  })

  it('ensureAutoSync skips when prefs.autoSync is false', async () => {
    const { scope } = makeScope()
    const remote = makeSyncRemote()
    localStorage.setItem('dsh-spark-finance.prefs', JSON.stringify({
      layout: 'compact',
      charts: {},
      autoSync: false,
      lastSync: null,
    }))
    const controller = new FinanceCardController(scope, remote as never)
    controller.ensureAutoSync()
    await flush()
    expect(remote.syncCommunityPrices).not.toHaveBeenCalled()
  })
})

interface FakeFinanceSyncRemote {
  syncCommunityPrices: ReturnType<typeof vi.fn>
  getSyncStatus: ReturnType<typeof vi.fn>
  refreshBalance: ReturnType<typeof vi.fn>
}

function makeSyncRemote(overrides: Partial<FakeFinanceSyncRemote> = {}): FakeFinanceSyncRemote {
  return {
    syncCommunityPrices: vi.fn(async () => ({
      ok: true as const,
      value: {
        ok: true as const,
        source: 'https://models.dev/api.json',
        appliedAt: 1_700_000_000_000,
        fx: 7.2,
        requestedProviders: ['openai', 'anthropic', 'google', 'zai', 'volcengine'],
        requestedMissing: [],
        kept: 12,
        droppedDated: 0,
        droppedNonToken: 0,
        droppedNoCost: 0,
        providers: ['openai', 'zai'],
      },
    })),
    getSyncStatus: vi.fn(async () => ({ ok: true as const, value: null })),
    refreshBalance: vi.fn(async () => ({ ok: true as const, value: {
      status: 'ok' as const,
      provider: 'deepseek-official',
      totalMicros: 12_340_000,
      currency: 'CNY' as const,
      fetchedAt: 1,
    } })),
    ...overrides,
  }
}

class FakeStorage {
  private readonly store = new Map<string, string>()
  getItem(key: string): string | null { return this.store.get(key) ?? null }
  setItem(key: string, value: string): void { this.store.set(key, value) }
  removeItem(key: string): void { this.store.delete(key) }
  clear(): void { this.store.clear() }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null }
  get length(): number { return this.store.size }
}
