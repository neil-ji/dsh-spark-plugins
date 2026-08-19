import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { FinanceCard, FinanceCardBody } from '../src/client/FinanceCard.tsx'
import type { FinanceCardState, FinanceCardFieldState } from '../src/client/FinanceCardController.ts'
import { DEFAULT_FINANCE_PREFS } from '../src/client/persist.ts'
import type { FinancePrefs } from '../src/client/persist.ts'

const t = (key: string): string => key

function field(text = '', overridden = false, invalid = false): FinanceCardFieldState {
  return { text, overridden, invalid }
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
    prices: field(''),
    prefs: DEFAULT_FINANCE_PREFS,
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
  setLayout: () => {},
  toggleChart: () => {},
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
    onSetLayout: () => {},
    onToggleChart: () => {},
  }

  it('renders the connection fields seeded from the section', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, bodyProps))
    expect(html).toContain('cardConnectionTitle')
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
      state: state({ currency: field('USD', true), prices: field('{bad', false, true) }),
    }))
    expect(html).toContain('overridden')    // currency override badge
    expect(html).toContain('reset')         // reset control for the override
    expect(html).toContain('invalidJson')   // prices invalid badge
  })

  it('renders a failed-save status line', () => {
    const html = renderToStaticMarkup(createElement(FinanceCardBody, {
      ...bodyProps,
      state: state({ failed: true, dirty: true }),
    }))
    expect(html).toContain('saveFailed')
    expect(html).toContain('role="status"')
  })
})
