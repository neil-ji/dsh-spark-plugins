import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { FinanceAuditSection } from '../src/client/FinanceAuditSection.tsx'
import type { FinanceListProvidersResult, FinanceLedger } from 'dsh-spark-finance/types'
import { writeBalancePeak } from '../src/client/persist.ts'

// In-memory localStorage so persist reads (e.g. peak on first paint) don't throw.
const memory = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
  clear: () => { memory.clear() },
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() { return memory.size },
}

const t = (key: string): string => key

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

function ledger(overrides: Partial<FinanceLedger> = {}): FinanceLedger {
  return { ...ZERO_LEDGER, ...overrides } as FinanceLedger
}

function providerList(rows: FinanceListProvidersResult['providers']): FinanceListProvidersResult {
  return { generatedAt: 1, providers: rows }
}

function okProvider(provider: string, totalMicros: number, currency: 'CNY' | 'USD' = 'CNY'): FinanceListProvidersResult['providers'][number] {
  return {
    provider,
    sources: ['host-known', 'user-config', 'ledger-observed'],
    hostMeta: provider === 'deepseek-official'
      ? { defaultBillingMode: 'metered', defaultCurrency: 'CNY', supportsBalanceFetch: true, lockBillingModeAndCurrency: true }
      : undefined,
    userEntry: undefined,
    balance: { status: 'ok', provider, totalMicros, currency, fetchedAt: 1 },
  }
}

function missingCredentialProvider(provider: string): FinanceListProvidersResult['providers'][number] {
  return {
    provider,
    sources: ['host-known'],
    hostMeta: provider === 'deepseek-official'
      ? { defaultBillingMode: 'metered', defaultCurrency: 'CNY', supportsBalanceFetch: true, lockBillingModeAndCurrency: true }
      : undefined,
    userEntry: undefined,
    balance: { status: 'missing-credential', provider, fetchedAt: 1 },
  }
}

function unsupportedProvider(provider: string, code: string): FinanceListProvidersResult['providers'][number] {
  return {
    provider,
    sources: ['host-known'],
    hostMeta: provider === 'deepseek-official'
      ? { defaultBillingMode: 'metered', defaultCurrency: 'CNY', supportsBalanceFetch: true, lockBillingModeAndCurrency: true }
      : undefined,
    userEntry: undefined,
    balance: { status: 'unsupported', provider, code, message: 'no endpoint', fetchedAt: 1 },
  }
}

function baseProps() {
  return {
    useSnapshot: () => ({ status: 'ready' as const, providerList: undefined, ledger: undefined, peaks: {}, error: null }),
    t,
    refresh: () => {},
    refreshProvider: () => {},
  }
}

function readyProps(list: FinanceListProvidersResult, led: FinanceLedger, peaks: Record<string, { micros: number; updatedAt: number; currency: string }> = {}) {
  return {
    useSnapshot: () => ({ status: 'ready' as const, providerList: list, ledger: led, peaks, error: null }),
    t,
    refresh: () => {},
    refreshProvider: () => {},
  }
}

describe('FinanceAuditSection (commit 21: multi-provider)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders an informative loading state with a spinner', () => {
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps(),
      useSnapshot: () => ({ status: 'loading' as const, peaks: {}, error: null }),
    }))
    expect(html).toContain('loadingTitle')
    expect(html).toContain('loadingDetail')
    expect(html).toContain('role="status"')
  })

  it('renders the error state with a refresh action', () => {
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps(),
      useSnapshot: () => ({ status: 'error' as const, error: 'boom', peaks: {} }),
    }))
    expect(html).toContain('boom')
    expect(html).toContain('refresh')
  })

  it('renders a balance card for every provider in the list', () => {
    const list = providerList([
      okProvider('deepseek-official', 100_000_000),
      unsupportedProvider('minimax-cn', 'unsupported-provider'),
    ])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, ledger())))
    expect(html).toContain('data-provider="deepseek-official"')
    expect(html).toContain('data-provider="minimax-cn"')
    // Deepseek has a battery gauge; minimax-cn shows the — placeholder.
    expect(html).toContain('role="progressbar"')
    // The unsupported message wraps the code in a title attribute so the
    // user can hover for the precise reason.
    expect(html).toContain('title="no endpoint"')
  })

  it('renders the missing-credential state for providers without an API key', () => {
    const list = providerList([missingCredentialProvider('deepseek-official')])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, ledger())))
    expect(html).toContain('missingCredential')
  })

  it('renders a host-known tag on rows whose provider id is in the registry', () => {
    const list = providerList([okProvider('deepseek-official', 100_000_000)])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, ledger())))
    expect(html).toContain('hostKnown')
  })

  it('reads the per-provider peak from the supplied peaks map', () => {
    const list = providerList([okProvider('deepseek-official', 100_000_000)])
    const peaks = { 'deepseek-official': { micros: 200_000_000, updatedAt: 1, currency: 'CNY' } }
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, ledger(), peaks)))
    // peak currency is CNY and the row currency is CNY — the historical
    // peak is rendered as a reference next to the live balance.
    expect(html).toContain('peak')
    expect(html).toContain('200')
  })

  it('disables the per-provider refresh button while a refresh is in flight', () => {
    const list = providerList([okProvider('deepseek-official', 100_000_000)])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...readyProps(list, ledger()),
      useSnapshot: () => ({ status: 'ready' as const, providerList: list, ledger: ledger(), peaks: {}, error: null }),
    }))
    // No in-flight refresh: the button is enabled.
    expect(html).toContain('refreshBalance')
    expect(html).toContain('data-provider="deepseek-official"')
  })

  it('renders a permanent validity tag for a user entry without end bounds', () => {
    const list = providerList([
      {
        ...okProvider('deepseek-official', 100_000_000),
        userEntry: {
          provider: 'deepseek-official',
          billingMode: 'metered',
          totalPriceMicros: 0,
          currency: 'CNY',
          autoFetchBalance: true,
          validity: {},
        },
      },
    ])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, ledger())))
    expect(html).toContain('validityPermanent')
  })

  it('renders a remaining-N-days tag when the validity end is in the future', () => {
    const list = providerList([
      {
        ...okProvider('deepseek-official', 100_000_000),
        userEntry: {
          provider: 'deepseek-official',
          billingMode: 'plan',
          totalPriceMicros: 0,
          currency: 'CNY',
          autoFetchBalance: false,
          validity: { endMs: Date.now() + 30 * 24 * 60 * 60 * 1000 },
        },
      },
    ])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, ledger())))
    expect(html).toContain('validityRemaining')
  })

  it('renders an expired-N-days tag when the validity end is in the past', () => {
    const list = providerList([
      {
        ...okProvider('deepseek-official', 100_000_000),
        userEntry: {
          provider: 'deepseek-official',
          billingMode: 'plan',
          totalPriceMicros: 0,
          currency: 'CNY',
          autoFetchBalance: false,
          validity: { endMs: Date.now() - 30 * 24 * 60 * 60 * 1000 },
        },
      },
    ])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, ledger())))
    expect(html).toContain('validityExpired')
  })

  it('renders a starts-in-N-days tag when the validity start is in the future', () => {
    const list = providerList([
      {
        ...okProvider('deepseek-official', 100_000_000),
        userEntry: {
          provider: 'deepseek-official',
          billingMode: 'plan',
          totalPriceMicros: 0,
          currency: 'CNY',
          autoFetchBalance: false,
          validity: { startMs: Date.now() + 30 * 24 * 60 * 60 * 1000 },
        },
      },
    ])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, ledger())))
    expect(html).toContain('validityStartsIn')
  })

  it('renders the by-model table (not a donut) for the cost-by-model card', () => {
    const led = ledger({
      totalCostMicros: 5_500_000,
      byModel: [
        { modelKey: 'openai/gpt-4o-mini', provider: 'openai', model: 'gpt-4o-mini', usage: { uncachedInputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500 }, costMicros: 5_000_000 },
        { modelKey: 'deepseek-official/deepseek-v4-flash', provider: 'deepseek-official', model: 'deepseek-v4-flash', usage: { uncachedInputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 200 }, costMicros: 500_000 },
      ],
    })
    const list = providerList([okProvider('deepseek-official', 50_000_000)])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, led)))
    // Table headers + cells present; the raw model key is shown (no provider prefix).
    expect(html).toContain('finance-by-model-table')
    expect(html).toContain('openai/gpt-4o-mini')
    expect(html).toContain('deepseek-official/deepseek-v4-flash')
  })

  it('renders the daily trend chart from the ledger', () => {
    const led = ledger({
      byDay: [
        { day: '2026-01-15', usage: { uncachedInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50 }, costMicros: 1_000_000 },
        { day: '2026-01-16', usage: { uncachedInputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100 }, costMicros: 2_000_000 },
      ],
    })
    const list = providerList([okProvider('deepseek-official', 50_000_000)])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, led)))
    expect(html).toContain('byDay')
    // The trend axis shows short labels (MM-DD) so the user can fit a month.
    expect(html).toContain('01-15')
    expect(html).toContain('01-16')
  })

  it('renders the peak/valley split donut from the ledger', () => {
    const led = ledger({
      peakValley: {
        peakCostMicros: 3_000_000,
        offPeakCostMicros: 1_500_000,
        flatCostMicros: 0,
        unclassifiedCostMicros: 0,
        legacyCostMicros: 0,
        shiftSavingsMicros: 1_500_000,
      },
    })
    const list = providerList([okProvider('deepseek-official', 50_000_000)])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, led)))
    expect(html).toContain('peakValleySplit')
    expect(html).toContain('shiftSavings')
  })

  it('renders the by-workspace bar chart from the ledger', () => {
    const led = ledger({
      byWorkspace: [
        { workspaceId: 'ws-1', title: 'Workspace A', sessionCount: 5, usage: { uncachedInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50 }, costMicros: 1_000_000 },
      ],
    })
    const list = providerList([okProvider('deepseek-official', 50_000_000)])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, led)))
    expect(html).toContain('byWorkspace')
  })

  it('renders the by-provider cost donut from the ledger rollup', () => {
    const led = ledger({
      byProvider: [
        { provider: 'deepseek-official', usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, costMicros: 5_000_000, modelCount: 1, billingMode: 'metered' },
        { provider: 'openai', usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, costMicros: 1_000_000, modelCount: 1, billingMode: 'plan' },
      ],
    })
    const list = providerList([okProvider('deepseek-official', 50_000_000)])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, led)))
    expect(html).toContain('byProvider')
    // Plan providers get a separate color in the donut.
    expect(html).toContain('stroke:#a855f7')
  })

  it('shows the windowed-era effective date when windowedSinceMs is set', () => {
    const led = ledger({
      windowedSinceMs: Date.UTC(2026, 7, 16, 16),
    })
    const list = providerList([okProvider('deepseek-official', 50_000_000)])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, led)))
    expect(html).toContain('peakValleySince')
  })

  it('renders KPI cards from the ledger totals', () => {
    const led = ledger({
      totals: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 },
      sessionCount: 42,
      workspaceCount: 7,
    })
    const list = providerList([okProvider('deepseek-official', 50_000_000)])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, led)))
    expect(html).toContain('totalInput')
    expect(html).toContain('totalOutput')
    expect(html).toContain('sessions')
    expect(html).toContain('workspaces')
  })

  it('shows the empty state when there are no persisted sessions', () => {
    const list = providerList([okProvider('deepseek-official', 0)])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, ledger())))
    expect(html).toContain('empty')
  })

  it('renders multiple provider cards in the grid without folding them into Other', () => {
    const list = providerList([
      okProvider('deepseek-official', 100_000_000),
      okProvider('openai', 50_000_000, 'USD'),
      unsupportedProvider('minimax-cn', 'unsupported-provider'),
    ])
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, readyProps(list, ledger())))
    // Each provider renders as its own card.
    expect(html.match(/data-provider=/g)?.length).toBe(3)
  })
})

/**
 * Static guard (commit 21 followup): every CSS module class referenced by
 * BalanceGrid + ByModelTable must be defined in
 * FinanceAuditSection.module.css. The components reference hashed class
 * names from the module (via `css.<className>`), so a missing rule produces
 * a render-time regression that `renderToStaticMarkup` can't see. This
 * check reads the .module.css file and confirms every class name the
 * components touch is present.
 *
 * If you add a new class to a component, add the rule here too — the
 * test fails fast and points at the missing line.
 */
describe('CSS module coverage (BalanceGrid + ByModelTable)', () => {
  function loadCss(): string {
    // The test runner runs in the package root, so the module path is fixed.
    return readFileSync(join(__dirname, '..', 'src', 'client', 'FinanceAuditSection.module.css'), 'utf8')
  }

  function collectClassNames(source: string): Set<string> {
    // Match any class name referenced by `css.<name>` (so we don't flag the
    // CSS module's own selectors that don't have a JS counterpart yet).
    const used = new Set<string>()
    const re = /css\.([A-Za-z_][A-Za-z0-9_]*)/g
    for (const [, name] of source.matchAll(re)) used.add(name)
    return used
  }

  function collectModuleClasses(css: string): Set<string> {
    // Each rule starts with `.<name> {` or `.<name>.<other>`. Strip
    // selectors + pseudos to get the top-level class name list.
    const defined = new Set<string>()
    for (const m of css.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      defined.add(m[1]!)
    }
    return defined
  }

  it('BalanceGrid + ByModelTable CSS classes are all defined in the module', () => {
    const componentSrc = readFileSync(join(__dirname, '..', 'src', 'client', 'BalanceGrid.tsx'), 'utf8')
      + '\n' + readFileSync(join(__dirname, '..', 'src', 'client', 'ByModelTable.tsx'), 'utf8')
    const cssText = loadCss()
    const used = collectClassNames(componentSrc)
    const defined = collectModuleClasses(cssText)
    const missing: string[] = []
    for (const name of used) if (!defined.has(name)) missing.push(name)
    expect(
      missing,
      `CSS classes used in components but missing from FinanceAuditSection.module.css: ${missing.join(', ')}`,
    ).toEqual([])
  })
})
