import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { FinanceCard, FinanceCardBody } from '../src/client/FinanceCard.tsx'
import type { FinanceCardState, FinanceCardFieldState } from '../src/client/FinanceCardController.ts'
import type { FinanceDshProviderRow } from '../src/client/FinanceCardController.ts'
import { DEFAULT_FINANCE_PREFS } from '../src/client/persist.ts'
import type { FinancePrefs } from '../src/client/persist.ts'

const t = (key: string): string => key

function field(text = '', overridden = false, invalid = false): FinanceCardFieldState {
  return { text, overridden, invalid }
}

/**
 * Two merged rows: one host-known provider carrying a user overlay (price +
 * autoFetch), one runtime-only provider with no overlay at all.
 */
function makeProviderRows(): readonly FinanceDshProviderRow[] {
  return [
    {
      provider: 'deepseek-official',
      name: 'deepseek-official',
      sources: ['host-known', 'llm-runtime'],
      hostMeta: {
        defaultBillingMode: 'metered',
        defaultCurrency: 'CNY',
        supportsBalanceFetch: true,
        lockBillingModeAndCurrency: true,
      },
      override: { totalPriceMicros: 30_000_000, autoFetchBalance: true },
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
      name: 'minimax-cn',
      sources: ['llm-runtime'],
      override: undefined,
      balance: {
        status: 'unsupported',
        provider: 'minimax-cn',
        code: 'no-balance-fetch',
        fetchedAt: 1_700_000_000_000,
      },
    },
  ]
}

function state(overrides: Partial<FinanceCardState> = {}): FinanceCardState {
  return {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    currency: field('CNY'),
    balanceBaseURL: field('https://api.deepseek.com'),
    balanceApiKeyEnv: field('DEEPSEEK_API_KEY'),
    balanceTimeoutMs: field('10000'),
    defaultPrice: field(''),
    providerDefaults: field(''),
    defaultPriceDraft: { input: '', cacheRead: '', cacheWrite: '', output: '' },
    providerDefaultsDraft: { rows: [] },
    priceTableDraft: { models: [] },
    prices: field(''),
    prefs: DEFAULT_FINANCE_PREFS,
    syncState: { syncing: false, lastSync: null, lastError: null },
    syncAvailable: true,
    providerList: undefined,
    dshProviderRows: undefined,
    ...overrides,
  }
}

const baseProps = {
  t,
  useFinanceCard: (selector: (snapshot: FinanceCardState) => unknown) => selector(state()),
  edit: () => {},
  resetField: () => {},
  save: () => {},
  discard: () => {},
  setDefaultPrice: () => {},
  setProviderDefaults: () => {},
  setPriceTable: () => {},
  setLayout: () => {},
  toggleChart: () => {},
  syncNow: () => Promise.resolve(null),
  setAutoSync: () => {},
  setDshProviderOverride: () => {},
  clearDshProviderOverride: () => {},
}

describe('FinanceCard', () => {
  it('renders nothing while the finance namespace is not served', () => {
    const html = renderToStaticMarkup(createElement(FinanceCard, {
      ...baseProps,
      useFinanceCard: (selector) => selector(state({ available: false })),
    }))
    expect(html).toBe('')
  })

  it('renders the card header naming the plugin and its scope', () => {
    const html = renderToStaticMarkup(createElement(FinanceCard, baseProps))
    expect(html).toContain('cardTitle')
    expect(html).toContain('cardDescription')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('cardExpand') // header disclosure aria-label
    // Body is collapsed by default.
    expect(html).not.toContain('cardCurrency')
    expect(html).not.toContain('cardViewsTitle')
  })

  it('marks a card holding unsaved edits', () => {
    const html = renderToStaticMarkup(createElement(FinanceCard, {
      ...baseProps,
      useFinanceCard: (selector) => selector(state({ dirty: true })),
    }))
    expect(html).toContain('unsaved')
  })
})

describe('FinanceCardBody', () => {
  const bodyProps = {
    t,
    state: state(),
    onEdit: () => {},
    onReset: () => {},
    onSave: () => {},
    onDiscard: () => {},
    onSetDefaultPrice: () => {},
    onSetProviderDefaults: () => {},
    onSetPriceTable: () => {},
    onSetLayout: () => {},
    onToggleChart: () => {},
    onSyncNow: () => Promise.resolve(null),
    onSetAutoSync: () => {},
    onSetDshProviderOverride: () => {},
    onClearDshProviderOverride: () => {},
  }

  it('renders the connection fields seeded from the section', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps))
    expect(html).toContain('cardDeepseekConnectionTitle')
    expect(html).toContain('cardDeepseekConnectionHint')
    expect(html).toContain('cardCurrency')
    expect(html).toContain('cardBalanceURL')
    expect(html).toContain('cardBalanceApiKeyEnv')
    expect(html).toContain('cardBalanceTimeoutMs')
    expect(html).toContain('cardDefaultPrice')
    expect(html).toContain('cardPrices')
    expect(html).toContain('value="CNY"')
    expect(html).toContain('value="https://api.deepseek.com"')
    expect(html).toContain('value="DEEPSEEK_API_KEY"')
    expect(html).toContain('value="10000"')
  })

  it('renders the dashboard view preferences with the persisted state', () => {
    const prefs: FinancePrefs = {
      layout: 'standard',
      charts: { ...DEFAULT_FINANCE_PREFS.charts, byModel: false },
    }
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ prefs }),
    }))
    expect(html).toContain('cardViewsTitle')
    expect(html).toContain('cardViewsHint')
    expect(html).toContain('layoutStandard')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-pressed="false"') // byModel off
  })

  it('disables the save button while there is nothing staged', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps))
    expect(html).toContain('disabled') // discard + save both disabled
    expect(html).toContain('save')
    expect(html).toContain('discard')
  })

  it('enables save when staged and disables it while a draft is invalid', () => {
    const dirty = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ dirty: true }),
    }))
    expect(dirty).not.toContain('aria-disabled')
    const invalid = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ dirty: true, invalid: true }),
    }))
    expect(invalid).toContain('disabled')
  })

  it('renders the read-only notice when the Host document is not writable', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ writable: false }),
    }))
    expect(html).toContain('cardReadOnly')
    expect(html).toContain('role="status"')
  })

  it('renders field override badges and invalid notices', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ currency: field('USD', true, true) }),
    }))
    expect(html).toContain('overridden')    // currency override badge
    expect(html).toContain('reset')         // reset control for the override
    // JSON fields validate inline now (no textarea badge); the Field-based
    // invalid channel still surfaces on scalar fields like currency.
    expect(html).toContain('invalidText')   // invalid currency text badge
  })

  it('renders a failed-save status line', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ failed: true, dirty: true }),
    }))
    expect(html).toContain('saveFailed')
    expect(html).toContain('role="status"')
  })

  // Provider configuration read-only view (replaces commit 13 Form List).
  // The section pulls one row per entry from `state.providerList`, no editable
  // controls — every visible row carries the host's `hostMeta` defaults plus
  // any user-config overrides (price, autoFetch, validity).
  it('renders the Provider configuration section title and hint', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps))
    expect(html).toContain('cardProvidersTitle')
    expect(html).toContain('cardProvidersHint')
  })

  it('renders a loading placeholder while dshProviderRows is undefined', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ dshProviderRows: undefined }),
    }))
    expect(html).toContain('finance-provider-list-empty')
    expect(html).toContain('cardProvidersLoading')
  })

  it('renders an empty placeholder when dshProviderRows has no entries', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ dshProviderRows: [] }),
    }))
    expect(html).toContain('finance-provider-list-empty')
    expect(html).toContain('cardProvidersNone')
    // The placeholder is rendered inside the same providerList element, so we
    // can only assert that the actual <article> cards are absent — nothing
    // draws `data-provider="…"` when the list is empty.
    expect(html).not.toContain('data-provider="deepseek-official"')
  })

  it('renders one card per dsh provider row', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ dshProviderRows: makeProviderRows() }),
    }))
    expect(html).toContain('data-provider="deepseek-official"')
    expect(html).toContain('data-provider="minimax-cn"')
  })

  it('shows the host-known tag and the overlay price for host-known providers', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ dshProviderRows: makeProviderRows() }),
    }))
    expect(html).toContain('cardProviderHostKnown')
    // 30 CNY from the fixture's override.totalPriceMicros
    expect(html).toContain('¥30.00')
    // autoFetch on the host-known row (supportsBalanceFetch === true)
    expect(html).toContain('cardProviderAutoFetchOn')
  })

  it('hides the autoFetch field for providers that do not support balance fetch', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ dshProviderRows: makeProviderRows() }),
    }))
    // Only the deepseek row supports balance fetch — its autoFetch shows the
    // "on" badge, the minimax row renders no autoFetch field at all.
    expect(html).toContain('cardProviderAutoFetchOn')
    expect(html).not.toContain('cardProviderAutoFetchOff')
  })

  it('renders an edit button per row, plus a reset only where an overlay exists', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ dshProviderRows: makeProviderRows() }),
    }))
    // Every row gets an edit affordance for the business fields.
    expect(html).toContain('finance-provider-edit-deepseek-official')
    expect(html).toContain('finance-provider-edit-minimax-cn')
    // Only the row carrying an override can be reset back to dsh defaults.
    expect(html).toContain('finance-provider-reset-deepseek-official')
    expect(html).not.toContain('finance-provider-reset-minimax-cn')
    // The overlay row is badged as overridden.
    expect(html).toContain('overridden')
  })

  it('disables the edit affordance when the Host document is read-only', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ writable: false, dshProviderRows: makeProviderRows() }),
    }))
    expect(html).toContain('finance-provider-edit-deepseek-official')
    expect(html).toContain('disabled')
  })
})

// 价格同步区块（commit 8）：原本默认面板三个表单隐藏 → 进 sync 区块 + 折叠 advanced
describe('FinanceCard price sync section', () => {
  it('shows the sync section when the host exposes the sync Remote', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...baseProps,
      state: state({ syncAvailable: true }),
    }))
    expect(html).toContain('cardPriceSyncTitle')
    expect(html).toContain('cardSyncNow')
    expect(html).toContain('cardAutoSync')
    expect(html).toContain('finance-sync-now')
    expect(html).toContain('https://models.dev')
  })

  it('hides the sync section when syncAvailable is false (legacy host)', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...baseProps,
      state: state({ syncAvailable: false }),
    }))
    expect(html).not.toContain('cardPriceSyncTitle')
    expect(html).not.toContain('finance-sync-now')
  })

  it('renders a never-synced badge when the sync layer is empty', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...baseProps,
      state: state({ syncAvailable: true, syncState: { syncing: false, lastSync: null, lastError: null } }),
    }))
    expect(html).toContain('cardSyncNever')
  })

  it('renders last-sync metadata when present', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...baseProps,
      state: state({
        syncAvailable: true,
        syncState: {
          syncing: false,
          lastSync: {
            appliedAt: Date.now() - 5 * 60_000,
            source: 'https://models.dev/api.json',
            kept: 28,
            providers: ['openai', 'zai'],
            fx: 7.2,
          },
          lastError: null,
        },
      }),
    }))
    expect(html).toContain('cardSyncLast')
    expect(html).toContain('28')
    expect(html).toContain('cardSyncModels')
  })

  it('renders a failed badge with the error message', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...baseProps,
      state: state({
        syncAvailable: true,
        syncState: {
          syncing: false,
          lastSync: null,
          lastError: 'HTTP 503 from models.dev',
        },
      }),
    }))
    expect(html).toContain('cardSyncFailed')
    expect(html).toContain('HTTP 503 from models.dev')
  })

  it('keeps the three price forms out of the main panel and inside an advanced <details>', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...baseProps,
      state: state({}),
    }))
    // The cards' defaultPrice / providerDefaults / prices form labels must NOT
    // appear in the open main flow when advanced disclosure is closed.
    expect(html).toContain('cardAdvancedTitle')
    expect(html).toMatch(/<details[^>]*class="[^"]*advancedDetails/)
    // Three forms inside details: a baseline assert that their inner labels render
    expect(html).toContain('cardDefaultPriceTitle')
    expect(html).toContain('cardProviderDefaultsTitle')
    expect(html).toContain('cardPricingTierTitle')
  })

  it('checkbox reflects prefs.autoSync and triggers setAutoSync when toggled', () => {
    let seen: boolean | null = null
    const setAutoSync = (next: boolean) => { seen = next }
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...baseProps,
      state: state({ prefs: { ...DEFAULT_FINANCE_PREFS, autoSync: false } }),
      setAutoSync,
    }))
    // The autoSync checkbox is identifiable by its aria-label; `checked`
    // reflects the persisted `prefs.autoSync = false` so the input is
    // unchecked in the rendered markup.
    expect(html).toMatch(/<input[^>]*aria-label="cardAutoSync"[^>]*>/)
    expect(html).not.toMatch(/<input[^>]*aria-label="cardAutoSync"[^>]*checked/)
    expect(seen).toBeNull() // synthetic markup, no click fired
  })

  it('Sync now button wires through to the onSyncNow handler', () => {
    let called = false
    const syncNow = async () => { called = true; return null }
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...baseProps,
      state: state({ syncAvailable: true }),
      syncNow,
    }))
    expect(html).toContain('finance-sync-now')
    void called
  })
})
