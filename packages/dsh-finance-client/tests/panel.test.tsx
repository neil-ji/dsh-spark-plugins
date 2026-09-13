import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FinanceLedger, FinanceListProvidersResult, FinanceTokenBuckets } from 'dsh-spark-finance/types'
import { FinancePanel, type FinancePanelInjected } from '../src/client/FinancePanel.tsx'
import { ProjectsView } from '../src/client/views/ProjectsView.tsx'
import { SaveMoreView } from '../src/client/views/SaveMoreView.tsx'
import { ThisMonthView } from '../src/client/views/ThisMonthView.tsx'
import { WhoToUseView } from '../src/client/views/WhoToUseView.tsx'
import { zh } from '../src/client/locales.ts'
import type { FinanceTranslate } from '../src/client/locales.ts'
import type { FinancePanelState } from '../src/client/controller.ts'

/** 取词直接回 key：断言渲染结构，不断言文案（文案归 locale）。 */
const t = ((key: string) => key) as unknown as FinanceTranslate

const buckets = (input: number, cacheRead: number, cacheWrite: number, output: number): FinanceTokenBuckets => ({
  uncachedInputTokens: input,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
  outputTokens: output,
})

const LEDGER: FinanceLedger = {
  generatedAt: Date.now() - 60_000,
  currency: 'CNY',
  totals: buckets(3_000_000, 1_200_000, 100_000, 400_000),
  totalCostMicros: 100_000_000,
  meteredCostMicros: 60_000_000,
  planEquivalentCostMicros: 40_000_000,
  sessionCount: 3,
  workspaceCount: 1,
  taskCount: 2,
  windowedSinceMs: 1_700_000_000_000,
  hourOfDayWindowStartMs: 1_700_000_000_000,
  byDay: [
    { day: '2026-09-13', usage: buckets(1_000_000, 400_000, 0, 100_000), costMicros: 40_000_000 },
    { day: '2026-09-14', usage: buckets(2_000_000, 800_000, 100_000, 300_000), costMicros: 60_000_000 },
  ],
  byModel: [
    { modelKey: 'acme/llm', provider: 'a', model: 'llm', usage: buckets(1_000_000, 1_000_000, 0, 100_000), costMicros: 10_000_000 },
    { modelKey: 'acme/llm', provider: 'b', model: 'llm', usage: buckets(2_000_000, 200_000, 0, 100_000), costMicros: 40_000_000 },
  ],
  byProvider: [
    { provider: 'a', usage: buckets(1_000_000, 1_000_000, 0, 100_000), costMicros: 10_000_000, modelCount: 1 },
    { provider: 'b', usage: buckets(2_000_000, 200_000, 0, 100_000), costMicros: 40_000_000, modelCount: 1 },
  ],
  byWorkspace: [
    { workspaceId: 'w1', title: 'AgentStudio', sessionCount: 3, usage: buckets(3_000_000, 1_200_000, 100_000, 400_000), costMicros: 100_000_000 },
  ],
  tasks: [],
  sessions: [
    {
      sessionId: 's1',
      title: '财务插件重建',
      createdAt: 1_700_000_000_000,
      workspaceId: 'w1',
      workspaceTitle: 'AgentStudio',
      taskId: 't1',
      modelKeys: ['acme/llm'],
      usage: buckets(1_000_000, 1_000_000, 0, 100_000),
      costMicros: 10_000_000,
    },
  ],
  unreadableSessions: [],
  byHourOfDay: [],
  peakValley: {
    peakCostMicros: 30_000_000,
    offPeakCostMicros: 50_000_000,
    flatCostMicros: 20_000_000,
    unclassifiedCostMicros: 0,
    legacyCostMicros: 0,
    shiftSavingsMicros: 7_500_000,
  },
}

const PROVIDERS: FinanceListProvidersResult = {
  generatedAt: 1,
  providers: [
    {
      provider: 'deepseek-official',
      sources: ['host-known'],
      hostMeta: { defaultBillingMode: 'metered', defaultCurrency: 'CNY', supportsBalanceFetch: true },
      balance: { status: 'ok', provider: 'deepseek-official', totalMicros: 128_000_000, currency: 'CNY', fetchedAt: 1 },
    },
  ],
}

function render(state: Partial<FinancePanelState>): string {
  const injected = {
    useSnapshot: () => ({ status: 'ready', error: null, plans: [], plansWritable: false, ...state }) as FinancePanelState,
    t,
    refresh: () => {},
    refreshProvider: async () => {},
    savePlan: async () => {},
    removePlan: async () => {},
  } as unknown as FinancePanelInjected
  return renderToStaticMarkup(createElement(FinancePanel, injected))
}

describe('FinancePanel shell', () => {
  it('renders the first-open loading state with an accessible progress bar', () => {
    const html = render({ status: 'loading', progress: { phase: 'backfill', scanned: 3, total: 9, rescanned: 0, startedAt: 0 } })
    expect(html).toContain('finance-loading')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow')
  })

  it('renders the error state with a retry action', () => {
    const html = render({ status: 'error', error: 'boom' })
    expect(html).toContain('finance-error')
    expect(html).toContain('boom')
  })

  it('renders the four decision views and the leading stats when ready', () => {
    const html = render({ status: 'ready', ledger: LEDGER, providerList: PROVIDERS })
    expect(html).toContain('finance-stat-cost')
    expect(html).toContain('finance-stat-metered')
    expect(html).toContain('finance-stat-plan')
    expect(html).toContain('finance-view-thisMonth')
    expect(html).toContain('finance-balance-deepseek-official')
    // 四个视图页签都在（label 走 t，这里断言 key 出现）
    for (const key of ['tabThisMonth', 'tabWhoToUse', 'tabSaveMore', 'tabProjects']) expect(html).toContain(key)
  })

  it('shows the guidance empty state when no session is persisted', () => {
    const html = render({ status: 'ready', ledger: { ...LEDGER, sessionCount: 0 }, providerList: PROVIDERS })
    expect(html).toContain('finance-empty')
    expect(html).toContain('finance-stat-cost')
  })

  it('footnotes the price source, the estimate rule and unreadable sessions', () => {
    const html = render({
      status: 'ready',
      ledger: { ...LEDGER, unreadableSessions: [{ sessionId: 'bad', createdAt: 1, reason: 'v0' }] },
      providerList: PROVIDERS,
      lastSyncAppliedAt: Date.now() - 60_000,
    })
    expect(html).toContain('priceNote')
    expect(html).toContain('estimateNote')
    expect(html).toContain('unreadableNote')
  })

  it('says it never synced community prices instead of inventing a source', () => {
    const html = render({ status: 'ready', ledger: LEDGER, providerList: PROVIDERS })
    expect(html).toContain('priceNoteNever')
  })
})

describe('finance views', () => {
  it('ThisMonth lists balances, the trend and the priciest models', () => {
    const html = renderToStaticMarkup(createElement(ThisMonthView, {
      ledger: LEDGER,
      providerList: PROVIDERS,
      t,
      refreshProvider: async () => {},
      plans: [],
      plansWritable: true,
      savePlan: async () => {},
      removePlan: async () => {},
    }))
    expect(html).toContain('finance-balance-deepseek-official')
    expect(html).toContain('topModelsHint')
    expect(html).toContain('trendTitle')
  })

  it('订阅卡只列用过的厂商，并对已填套餐给出省/亏结论', () => {
    const noPlan = renderToStaticMarkup(createElement(ThisMonthView, {
      ledger: LEDGER,
      providerList: PROVIDERS,
      t,
      refreshProvider: async () => {},
      plans: [],
      plansWritable: true,
      savePlan: async () => {},
      removePlan: async () => {},
    }))
    // 账本里用过 a / b，而未接入的厂商不会出现
    expect(noPlan).toContain('finance-plan-a')
    expect(noPlan).toContain('finance-plan-b')
    expect(noPlan).toContain('planFill')

    const withPlan = renderToStaticMarkup(createElement(ThisMonthView, {
      ledger: LEDGER,
      providerList: PROVIDERS,
      t,
      refreshProvider: async () => {},
      plans: [{ provider: 'a', monthlyMicros: 1_000_000, currency: 'CNY', effectiveFrom: 0 }],
      plansWritable: true,
      savePlan: async () => {},
      removePlan: async () => {},
    }))
    // 等价按量价 10_000_000 > 月费 1_000_000 → 「省了」
    expect(withPlan).toContain('planSaved')
    expect(withPlan).toContain('planDiscount')
  })

  it('设置只读时套餐卡明确说明不能改，且不给编辑入口', () => {
    const html = renderToStaticMarkup(createElement(ThisMonthView, {
      ledger: LEDGER,
      providerList: PROVIDERS,
      t,
      refreshProvider: async () => {},
      plans: [{ provider: 'a', monthlyMicros: 1_000_000, currency: 'CNY', effectiveFrom: 0 }],
      plansWritable: false,
      savePlan: async () => {},
      removePlan: async () => {},
    }))
    expect(html).toContain('planReadOnly')
    expect(html).not.toContain('planEdit')
  })

  it('WhoToUse groups the same model across vendors and marks the cheaper one', () => {
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: LEDGER, t }))
    expect(html).toContain('finance-model-acme/llm')
    expect(html).toContain('whoBest')
    expect(html).toContain('colHitRate')
  })

  it('SaveMore shows both actionable estimates with their basis', () => {
    const html = renderToStaticMarkup(createElement(SaveMoreView, { ledger: LEDGER, t }))
    expect(html).toContain('finance-peak-savings')
    expect(html).toContain('finance-cache-savings')
    expect(html).toContain('cacheSavingsNote')
    expect(html).toContain('estimateTag')
  })

  it('SaveMore says there is nothing actionable when there is no peak window', () => {
    const html = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: { ...LEDGER, windowedSinceMs: null, peakValley: { ...LEDGER.peakValley, shiftSavingsMicros: 0 } },
      t,
    }))
    expect(html).toContain('finance-peak-empty')
  })

  it('Projects lists workspaces with their cost', () => {
    const html = renderToStaticMarkup(createElement(ProjectsView, { ledger: LEDGER, t }))
    expect(html).toContain('finance-projects')
    expect(html).toContain('AgentStudio')
  })

  it('Projects shows the guidance empty state without workspaces', () => {
    const html = renderToStaticMarkup(createElement(ProjectsView, { ledger: { ...LEDGER, byWorkspace: [] }, t }))
    expect(html).toContain('finance-projects-empty')
  })
})

describe('locale dictionaries', () => {
  it('keeps zh/en key sets identical', async () => {
    const { en } = await import('../src/client/locales.ts')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
