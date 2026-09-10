import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { FinanceCard, FinanceCardBody } from '../src/client/FinanceCard.tsx'
import type { FinanceTab } from '../src/client/FinanceCard.tsx'
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

// B7: the overview tab hosts the dashboard inline. These stubs cover the whole
// inject surface; the dashboard's own render paths are covered by
// section.test.tsx (an idle snapshot here lands it in the loading slot).
const dashboardProps = {
  useSnapshot: (selector: (snapshot: { status: 'idle' }) => unknown) => selector({ status: 'idle' as const }),
  dashboardRefresh: () => {},
  refreshProvider: () => Promise.resolve(),
}

/** Panel (`FinanceCard`) props — no tab control: the panel owns the active tab. */
const baseProps = {
  t,
  useFinanceCard: (selector: (snapshot: FinanceCardState) => unknown) => selector(state()),
  ...dashboardProps,
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
  retryListProviders: () => {},
}

/** Body props — the active tab is a controlled prop so each pane is renderable. */
function bodyProps(tab: FinanceTab = 'overview') {
  return {
    t,
    state: state(),
    tab,
    onTabChange: () => {},
    ...dashboardProps,
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
    onRetryListProviders: () => {},
  }
}

describe('FinanceCard', () => {
  it('renders nothing while the finance namespace is not served', () => {
    const html = renderToStaticMarkup(createElement(FinanceCard, {
      ...baseProps,
      useFinanceCard: (selector) => selector(state({ available: false })),
    }))
    expect(html).toBe('')
  })

  // 2026-09 形制统一：面板不再有可折叠卡头 —— 顶部是一条四页签 tablist，
  // 默认落在总览页，且同一时刻只渲染当前页的内容。
  it('renders the four-tab bar and opens on the overview tab', () => {
    const html = renderToStaticMarkup(createElement(FinanceCard, baseProps))
    expect(html).toContain('role="tablist"')
    expect(html).toContain('cardTabsLabel')
    for (const label of ['tabOverview', 'tabConnection', 'tabProviders', 'tabAdvanced']) {
      expect(html).toContain(label)
    }
    // 默认页 = 总览：dashboard 挂载，连接/供应商/高级页不渲染。
    expect(html).toContain('finance-card-dashboard')
    expect(html).not.toContain('cardDeepseekConnectionTitle')
    expect(html).not.toContain('cardAdvancedTitle')
  })

  it('has no collapsible chrome (no disclosure button, no <details>)', () => {
    const html = renderToStaticMarkup(createElement(FinanceCard, baseProps))
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('<details')
  })

  it('marks a panel holding unsaved edits in the save row', () => {
    const html = renderToStaticMarkup(createElement(FinanceCard, {
      ...baseProps,
      useFinanceCard: (selector) => selector(state({ dirty: true })),
    }))
    expect(html).toContain('unsaved')
  })
})

describe('FinanceCardBody', () => {
  it('renders exactly one pane at a time, keyed by the controlled tab', () => {
    const overview = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps('overview')))
    expect(overview).toContain('finance-tab-overview')
    expect(overview).not.toContain('finance-tab-connection')
    expect(overview).not.toContain('finance-tab-providers')
    expect(overview).not.toContain('finance-tab-advanced')

    const connection = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps('connection')))
    expect(connection).toContain('finance-tab-connection')
    expect(connection).not.toContain('finance-tab-overview')

    const providers = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps('providers')))
    expect(providers).toContain('finance-tab-providers')
    expect(providers).not.toContain('finance-tab-connection')

    const advanced = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps('advanced')))
    expect(advanced).toContain('finance-tab-advanced')
    expect(advanced).not.toContain('finance-tab-providers')
  })

  it('renders the connection fields seeded from the section', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps('connection')))
    expect(html).toContain('cardDeepseekConnectionTitle')
    expect(html).toContain('cardDeepseekConnectionHint')
    expect(html).toContain('cardBalanceURL')
    expect(html).toContain('cardBalanceApiKeyEnv')
    expect(html).toContain('cardBalanceTimeoutMs')
    expect(html).toContain('value="https://api.deepseek.com"')
    expect(html).toContain('value="DEEPSEEK_API_KEY"')
    expect(html).toContain('value="10000"')
  })

  it('renders the dashboard view preferences inside the overview tab', () => {
    const prefs: FinancePrefs = {
      layout: 'standard',
      charts: { ...DEFAULT_FINANCE_PREFS.charts, byModel: false },
    }
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('overview'),
      state: state({ prefs }),
    }))
    expect(html).toContain('cardViewsTitle')
    expect(html).toContain('cardViewsHint')
    expect(html).toContain('layoutStandard')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-pressed="false"') // byModel off
  })

  it('keeps the save row visible (and disabled) on every tab', () => {
    for (const tab of ['overview', 'connection', 'providers', 'advanced'] as const) {
      const html = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps(tab)))
      expect(html).toContain('save')
      expect(html).toContain('discard')
    }
  })

  it('disables the save button while there is nothing staged', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps()))
    expect(html).toContain('disabled') // discard + save both disabled
  })

  it('enables save when staged and disables it while a draft is invalid', () => {
    const dirty = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps(),
      state: state({ dirty: true }),
    }))
    expect(dirty).not.toContain('aria-disabled')
    expect(dirty).toContain('unsaved')
    const invalid = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps(),
      state: state({ dirty: true, invalid: true }),
    }))
    expect(invalid).toContain('disabled')
  })

  it('renders the read-only notice when the Host document is not writable', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps(),
      state: state({ writable: false }),
    }))
    expect(html).toContain('cardReadOnly')
    expect(html).toContain('role="status"')
  })

  it('renders field override badges and invalid notices', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('connection'),
      state: state({ balanceBaseURL: field('https://example.com', true, true) }),
    }))
    expect(html).toContain('overridden')    // balance URL override badge
    expect(html).toContain('reset')         // reset control for the override
    // JSON fields validate inline now (no textarea badge); the Field-based
    // invalid channel still surfaces on scalar fields like the balance URL.
    expect(html).toContain('invalidText')   // invalid scalar text badge
  })

  it('renders a failed-save status line', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps(),
      state: state({ failed: true, dirty: true }),
    }))
    expect(html).toContain('saveFailed')
    expect(html).toContain('role="status"')
  })

  // Provider configuration read-only view (replaces commit 13 Form List).
  // The 供应商 tab pulls one row per entry from `state.dshProviderRows`; every
  // visible row carries the host's `hostMeta` defaults plus any user-config
  // overrides (price, autoFetch, validity).
  it('renders the Provider configuration section title and hint', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps('providers')))
    expect(html).toContain('cardProvidersTitle')
    expect(html).toContain('cardProvidersHint')
  })

  it('renders a loading placeholder while dshProviderRows is undefined', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('providers'),
      state: state({ dshProviderRows: undefined }),
    }))
    expect(html).toContain('finance-provider-list-empty')
    expect(html).toContain('cardProvidersLoading')
  })

  it('renders an empty placeholder when dshProviderRows has no entries', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('providers'),
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
      ...bodyProps('providers'),
      state: state({ dshProviderRows: makeProviderRows() }),
    }))
    expect(html).toContain('data-provider="deepseek-official"')
    expect(html).toContain('data-provider="minimax-cn"')
  })

  it('shows the host-known tag and the overlay price for host-known providers', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('providers'),
      state: state({ dshProviderRows: makeProviderRows() }),
    }))
    expect(html).toContain('cardProviderHostKnown')
    // 30 CNY from the fixture's override.totalPriceMicros
    expect(html).toContain('¥30.00')
    // autoFetch on the host-known row (supportsBalanceFetch === true)
    expect(html).toContain('cardProviderAutoFetchOn')
  })

  // B8: the read-only panel used to advertise 计费方式/货币 as editable
  // fields, but the edit form had no inputs for them — the user clicked
  // 编辑, then couldn't change them. The fix moves host-owned meta
  // (billing mode + currency) into a dedicated strip under the card head
  // and leaves the body to only the editable business fields.
  it('renders host-owned meta (billing mode + currency) under the card head, not in the body', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('providers'),
      state: state({ dshProviderRows: makeProviderRows() }),
    }))
    // The new meta strip carries the host-owned fields and the bilingual labels.
    expect(html).toContain('finance-provider-meta-deepseek-official')
    expect(html).toContain('finance-provider-meta-minimax-cn')
    // minimax-cn has no hostMeta, so the meta strip still renders with the
    // label but a "—" placeholder rather than a hidden row.
    expect(html).toContain('cardProviderBillingMode')
    expect(html).toContain('cardProviderCurrency')
  })

  it('hides the autoFetch field for providers that do not support balance fetch', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('providers'),
      state: state({ dshProviderRows: makeProviderRows() }),
    }))
    // Only the deepseek row supports balance fetch — its autoFetch shows the
    // "on" badge, the minimax row renders no autoFetch field at all.
    expect(html).toContain('cardProviderAutoFetchOn')
    expect(html).not.toContain('cardProviderAutoFetchOff')
  })

  it('renders an edit button per row, plus a reset only where an overlay exists', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('providers'),
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
      ...bodyProps('providers'),
      state: state({ writable: false, dshProviderRows: makeProviderRows() }),
    }))
    expect(html).toContain('finance-provider-edit-deepseek-official')
    expect(html).toContain('disabled')
  })
})

// 价格同步区块在「连接」页；三份价格 JSON 表单在「高级」页。
describe('FinanceCard price sync section', () => {
  it('shows the sync section on the connection tab when the host exposes the sync Remote', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps('connection')))
    expect(html).toContain('cardPriceSyncTitle')
    expect(html).toContain('cardSyncNow')
    expect(html).toContain('cardAutoSync')
    expect(html).toContain('finance-sync-now')
    expect(html).toContain('https://models.dev')
  })

  it('hides the sync section when syncAvailable is false (legacy host)', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('connection'),
      state: state({ syncAvailable: false }),
    }))
    expect(html).not.toContain('cardPriceSyncTitle')
    expect(html).not.toContain('finance-sync-now')
  })

  it('renders a never-synced badge when the sync layer is empty', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('connection'),
      state: state({ syncAvailable: true, syncState: { syncing: false, lastSync: null, lastError: null } }),
    }))
    expect(html).toContain('cardSyncNever')
  })

  it('renders last-sync metadata when present', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('connection'),
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
      ...bodyProps('connection'),
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

  // 2026-09：三个价格 JSON 表单从 <details> 折叠区搬进「高级」页签 ——
  // 内容需要一次点击（页签），而不是两段折叠；默认页也不再露出它们。
  it('keeps the three price forms on the advanced tab, out of the default tab', () => {
    const advanced = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps('advanced')))
    expect(advanced).toContain('cardAdvancedTitle')
    expect(advanced).toContain('cardAdvancedHint')
    expect(advanced).toContain('cardDefaultPriceTitle')
    expect(advanced).toContain('cardProviderDefaultsTitle')
    expect(advanced).toContain('cardPricingTierTitle')
    expect(advanced).not.toContain('<details')

    const overview = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps('overview')))
    expect(overview).not.toContain('cardDefaultPriceTitle')
    expect(overview).not.toContain('cardPricesHint')
  })

  it('checkbox reflects prefs.autoSync when the sync block is on the connection tab', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('connection'),
      state: state({ prefs: { ...DEFAULT_FINANCE_PREFS, autoSync: false } }),
    }))
    // The autoSync checkbox is identifiable by its aria-label; `checked`
    // reflects the persisted `prefs.autoSync = false` so the input is
    // unchecked in the rendered markup.
    expect(html).toMatch(/<input[^>]*aria-label="cardAutoSync"[^>]*>/)
    expect(html).not.toMatch(/<input[^>]*aria-label="cardAutoSync"[^>]*checked/)
  })

  it('exposes the sync-now testid for the connection tab', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps('connection'),
      state: state({ syncAvailable: true }),
    }))
    expect(html).toContain('finance-sync-now')
  })
})
