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
    {
      modelKey: 'acme/llm',
      provider: 'a',
      model: 'llm',
      usage: buckets(1_000_000, 1_000_000, 0, 100_000),
      costMicros: 10_000_000,
      // 10 分钟解码窗口：a 92 tok/s、b 22 tok/s —— 同一模型跨供应商的时间成本可算。
      rate: { decodeMs: 600_000, decodeTokens: 55_200, ttftMs: 12_000, ttftSteps: 40 },
      // 上下文分布（P2）：多数步在 32k 以内，少数落在 128k–1M
      context: [
        { maxPromptTokens: 32_000, usage: buckets(400_000, 100_000, 0, 30_000), steps: 20 },
        { maxPromptTokens: 128_000, usage: buckets(200_000, 300_000, 0, 20_000), steps: 10 },
        { maxPromptTokens: 200_000, usage: buckets(0, 0, 0, 0), steps: 0 },
        { maxPromptTokens: 1_000_000, usage: buckets(100_000, 50_000, 0, 10_000), steps: 5 },
        { maxPromptTokens: null, usage: buckets(0, 0, 0, 0), steps: 0 },
      ],
    },
    {
      modelKey: 'acme/llm',
      provider: 'b',
      model: 'llm',
      usage: buckets(2_000_000, 200_000, 0, 100_000),
      costMicros: 40_000_000,
      rate: { decodeMs: 600_000, decodeTokens: 13_200, ttftMs: 30_000, ttftSteps: 40 },
      context: [
        { maxPromptTokens: 32_000, usage: buckets(100_000, 20_000, 0, 10_000), steps: 3 },
        { maxPromptTokens: 128_000, usage: buckets(0, 0, 0, 0), steps: 0 },
        { maxPromptTokens: 200_000, usage: buckets(300_000, 100_000, 0, 20_000), steps: 6 },
        { maxPromptTokens: 1_000_000, usage: buckets(0, 0, 0, 0), steps: 0 },
        { maxPromptTokens: null, usage: buckets(0, 0, 0, 0), steps: 0 },
      ],
    },
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
    useSnapshot: () => ({ status: 'ready', error: null, plans: [], tiers: {}, plansWritable: false, ...state }) as FinancePanelState,
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
    // 形制（与 hippomemo MemorySection 一致）：子页签栏是面板内容的第一件东西，
    // 指标/操作/脚注都在 tab 里，不允许置顶。
    expect(html.indexOf('finance-tabs')).toBeGreaterThan(-1)
    expect(html.indexOf('finance-tabs')).toBeLessThan(html.indexOf('finance-stat-cost'))
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
      refreshing: false,
      onRefresh: () => {},
      lastSyncAppliedAt: undefined,
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
      refreshing: false,
      onRefresh: () => {},
      lastSyncAppliedAt: undefined,
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
      refreshing: false,
      onRefresh: () => {},
      lastSyncAppliedAt: undefined,
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
      refreshing: false,
      onRefresh: () => {},
      lastSyncAppliedAt: undefined,
    }))
    expect(html).toContain('planReadOnly')
    expect(html).not.toContain('planEdit')
  })

  it('WhoToUse groups the same model across vendors and marks the cheaper one', () => {
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: LEDGER, t }))
    // 组名是模型名（不是 provider/model）：两家供应同一个模型才可能同组比较
    expect(html).toContain('finance-model-llm')
    expect(html).toContain('whoBest')
    expect(html).toContain('colHitRate')
  })

  it('该用谁列出输出速率，并对同一模型给出时间成本比较（标注估算）', () => {
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: LEDGER, t }))
    expect(html).toContain('colSpeed')
    expect(html).toContain('perSecond')
    // 92 tok/s 与 22 tok/s 是观测值，直接渲染
    expect(html).toContain('92.0')
    expect(html).toContain('22.0')
    // 时间成本比较常显在组头下面，并带「估算」标签
    expect(html).toContain('finance-time-compare')
    expect(html).toContain('timeCompareSaved')
    expect(html).toContain('estimateTag')
  })

  it('没有速率样本的会话不显示速率（不是 0）', () => {
    const withoutRate = {
      ...LEDGER,
      byModel: LEDGER.byModel.map(({ rate: _rate, ...row }) => row),
    }
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: withoutRate, t }))
    expect(html).toContain('colSpeed')
    expect(html).not.toContain('perSecond')
    expect(html).not.toContain('finance-time-compare')
  })

  it('SaveMore shows both actionable estimates with their basis', () => {
    const html = renderToStaticMarkup(createElement(SaveMoreView, { ledger: LEDGER, tiers: {}, t }))
    expect(html).toContain('finance-peak-savings')
    expect(html).toContain('finance-cache-savings')
    expect(html).toContain('cacheSavingsNote')
    expect(html).toContain('estimateTag')
  })

  it('SaveMore says there is nothing actionable when there is no peak window', () => {
    const html = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: { ...LEDGER, windowedSinceMs: null, peakValley: { ...LEDGER.peakValley, shiftSavingsMicros: 0 } },
      tiers: {},
      t,
    }))
    expect(html).toContain('finance-peak-empty')
  })

  it('拆分卡：有上下文分布 + 阶梯价时给出上限估算，没阶梯价时明说拆分不改变单价', () => {
    const withTiers = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: LEDGER,
      // 最小档 128k：把长上下文逐步压进这一档的费率
      tiers: { 'acme/llm': [{ maxPromptTokens: 128_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 }] },
      t,
    }))
    expect(withTiers).toContain('finance-context-card')
    expect(withTiers).toContain('contextSavedUpper')
    expect(withTiers).toContain('estimateTag')
    expect(withTiers).toContain('contextNote')

    const withoutTiers = renderToStaticMarkup(createElement(SaveMoreView, { ledger: LEDGER, tiers: {}, t }))
    expect(withoutTiers).toContain('finance-context-card')
    expect(withoutTiers).toContain('contextNoTiers')
  })

  it('拆分卡：没有上下文分布的旧会话不假装上下文很短', () => {
    const noContext = { ...LEDGER, byModel: LEDGER.byModel.map(({ context: _context, ...row }) => row) }
    const html = renderToStaticMarkup(createElement(SaveMoreView, { ledger: noContext, tiers: {}, t }))
    expect(html).toContain('finance-context-empty')
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
