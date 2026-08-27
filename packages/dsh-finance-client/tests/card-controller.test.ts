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
import type { FinanceConfigInput } from 'dsh-finance/types'

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
      const stored = JSON.parse(storage.get('dsh-finance.prefs') ?? '{}')
      expect(stored.layout).toBe('standard')
      expect(stored.charts.byModel).toBe(false)
    } finally {
      ;(globalThis as { localStorage?: unknown }).localStorage = original
    }
  })
})
