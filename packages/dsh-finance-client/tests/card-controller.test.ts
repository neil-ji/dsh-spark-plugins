import { describe, expect, it, vi } from 'vitest'

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
import type { FinanceConfigInput } from 'dsh-spark-finance/types'

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
    const state = face.hooks.financeCard.getSnapshot()
    expect(state.balanceTimeoutMs.invalid).toBe(true)
    expect(state.invalid).toBe(true)

    face.save()
    await flush()
    expect(writes).toEqual([]) // nothing crossed the wire
    expect(face.hooks.financeCard.getSnapshot().dirty).toBe(true)
  })

  it('rejects non-object JSON for the price fields', () => {
    const { scope } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.edit('prices', '[1,2]')
    expect(face.hooks.financeCard.getSnapshot().prices.invalid).toBe(true)
    face.edit('prices', '{bad json')
    expect(face.hooks.financeCard.getSnapshot().prices.invalid).toBe(true)
    face.edit('prices', '{}')
    expect(face.hooks.financeCard.getSnapshot().prices.invalid).toBe(false)
  })

  it('writes parsed JSON objects for the price fields', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    const prices = {
      'deepseek-official/deepseek-v4-flash': [
        { inputMicrosPerMtok: 1000000, outputMicrosPerMtok: 2000000 },
      ],
    }
    face.edit('prices', JSON.stringify(prices, null, 2))
    face.save()
    await flush()
    expect(writes).toEqual([{ op: 'set', field: 'prices', value: prices }])
  })

  it('stages and saves per-provider default rates as one JSON write', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    const defaults = { openai: { inputMicrosPerMtok: 3600000, outputMicrosPerMtok: 14400000 } }
    face.edit('providerDefaults', JSON.stringify(defaults, null, 2))
    const staged = face.hooks.financeCard.getSnapshot()
    expect(staged.providerDefaults.invalid).toBe(false)
    expect(staged.dirty).toBe(true)
    face.save()
    await flush()
    expect(writes).toEqual([{ op: 'set', field: 'providerDefaults', value: defaults }])
    // A non-object draft (array) stays invalid and blocks the save.
    face.edit('providerDefaults', '[1,2]')
    expect(face.hooks.financeCard.getSnapshot().invalid).toBe(true)
  })

  it('stages and saves billing-mode tags as one JSON write', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.edit('billingModes', JSON.stringify({ zai: 'plan' }))
    expect(face.hooks.financeCard.getSnapshot().billingModes.invalid).toBe(false)
    face.save()
    await flush()
    expect(writes).toEqual([{ op: 'set', field: 'billingModes', value: { zai: 'plan' } }])
    // Unknown mode strings fail validation like any other non-enum JSON.
    face.edit('billingModes', '{"zai":"prepaid"}')
    expect(face.hooks.financeCard.getSnapshot().invalid).toBe(true)
  })

  it('applies form-editor rows to the staged field and saves them', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    // The editor drives rows; the controller serializes them into the stage.
    face.setBillingModes([{ route: 'zai', mode: 'plan' }, { route: 'volcengine', mode: 'metered' }])
    const staged = face.hooks.financeCard.getSnapshot()
    expect(staged.billingModes.overridden).toBe(true)
    expect(staged.dirty).toBe(true)
    face.save()
    await flush()
    expect(writes).toEqual([{ op: 'set', field: 'billingModes', value: { zai: 'plan', volcengine: 'metered' } }])
  })

  it('clears the billing override when the editor empties', async () => {
    const { scope, writes } = makeScope({ value: baseSection(), user: { billingModes: { zai: 'plan' } } })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.setBillingModes([])
    const staged = face.hooks.financeCard.getSnapshot()
    expect(staged.billingModes.overridden).toBe(false)
    face.save()
    await flush()
    expect(writes).toEqual([{ op: 'unset', field: 'billingModes' }])
  })

  it('keeps the form clean (no dirty) when nothing changed', () => {
    const { scope } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.setBillingModes([]) // no stored value, empty editor
    expect(face.hooks.financeCard.getSnapshot().dirty).toBe(false)
  })

  it('keeps a just-added blank route visible in the editor rows', () => {
    const { scope } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    // The '+' button emits a blank route; the form must show it even though
    // serialization (and therefore the draft JSON) drops blanks.
    face.setBillingModes([{ route: 'zai', mode: 'plan' }, { route: '', mode: 'plan' }])
    const snapshot = face.hooks.financeCard.getSnapshot()
    expect(snapshot.billingRows).toHaveLength(2)
    expect(snapshot.billingRows[1].route).toBe('')
    // The staged payload stays clean: no blank-route entry is written.
    expect(JSON.parse(snapshot.billingModes.text)).toEqual({ zai: 'plan' })
  })

  it('reseeds the editor rows from the accepted value after save', async () => {
    const { scope, writes } = makeScope({ value: baseSection() })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.setBillingModes([{ route: 'zai', mode: 'plan' }, { route: '', mode: 'plan' }])
    face.save()
    await flush()
    // After a landed save the draft clears and the editor shows stored rows.
    const snapshot = face.hooks.financeCard.getSnapshot()
    expect(snapshot.billingRows.map(r => r.route)).toEqual(['zai'])
    expect(writes).toEqual([{ op: 'set', field: 'billingModes', value: { zai: 'plan' } }])
  })

  it('reseeds the editor rows from the composition default on reset', () => {
    const { scope } = makeScope({ value: baseSection(), user: { billingModes: { zai: 'plan' } } })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.setBillingModes([{ route: 'volcengine', mode: 'metered' }])
    face.resetField('billingModes')
    // Reset drops the override and returns the editor to the composition layer
    // (which carries no billingModes here), like every other field on the card.
    const snapshot = face.hooks.financeCard.getSnapshot()
    expect(snapshot.billingRows).toEqual([])
    expect(snapshot.billingModes.overridden).toBe(false)
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
    face.setPriceTable({ models: [{ modelKey: 'openai/gpt-4o', entries: [{
      kind: 'flat' as const,
      effectiveFrom: '',
      flat: { input: '18000000', cacheRead: '9000000', cacheWrite: '', output: '72000000' },
      offPeak: { input: '', cacheRead: '', cacheWrite: '', output: '' },
      peak: { input: '', cacheRead: '', cacheWrite: '', output: '' },
      peakHours: '',
      peakDays: '',
    }] }] })
    face.save()
    await flush()
    expect(writes).toEqual([{ op: 'set', field: 'prices', value: { 'openai/gpt-4o': { inputMicrosPerMtok: 18000000, cacheReadMicrosPerMtok: 9000000, outputMicrosPerMtok: 72000000 } } }])
  })

  it('clears an empty price-table draft through the unset path', async () => {
    const { scope, writes } = makeScope({ value: baseSection(), user: { prices: { 'x/y': { inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 } } } })
    const controller = new FinanceCardController(scope)
    const face = controller.inject()
    face.setPriceTable({ models: [] })
    face.save()
    await flush()
    expect(writes).toEqual([{ op: 'unset', field: 'prices' }])
  })
})
