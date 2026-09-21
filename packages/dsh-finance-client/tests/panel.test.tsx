import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FinanceLedger, FinanceListProvidersResult, FinanceTokenBuckets } from 'dsh-spark-finance/types'
import { Pill, formatMicros, formatMoneyMicros } from 'dsh-ui-kit'
import { zh } from '../src/client/locales.ts'
import { FinancePanel, type FinancePanelInjected } from '../src/client/FinancePanel.tsx'
import { ProjectDetail, ProjectsView } from '../src/client/views/ProjectsView.tsx'
import { SaveMoreView } from '../src/client/views/SaveMoreView.tsx'
import { ThisMonthView } from '../src/client/views/ThisMonthView.tsx'
import { WhoToUseView } from '../src/client/views/WhoToUseView.tsx'
import { zh } from '../src/client/locales.ts'
import type { FinanceTranslate } from '../src/client/locales.ts'
import type { FinancePanelState } from '../src/client/controller.ts'

/** 取词直接回 key：断言渲染结构，不断言文案（文案归 locale）。 */
const t = ((key: string) => key) as unknown as FinanceTranslate

/**
 * 截出「上限可省」那一格的内容：卡片别处（峰谷 / 缓存卡）也渲染 `estimateTag`，
 * 所以断言"没有出金额"必须限定在上下文表的成本格里。
 */
const contextCells = (html: string): string => {
  const cells = [...html.matchAll(/data-testid="finance-context-cost-[^"]*"[^>]*>([\s\S]*?)<\/span><\/div>/g)]
  return cells.map((match) => match[1]).join('')
}

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
    {
      // 第二家：按量付费卡列它（两池化后所有 metered 厂商都进本卡，SPEC §5.4 修订）
      provider: 'a',
      sources: ['ledger-observed'],
      hostMeta: { defaultBillingMode: 'metered', defaultCurrency: 'CNY', supportsBalanceFetch: true },
      balance: { status: 'ok', provider: 'a', totalMicros: 5_000_000, currency: 'CNY', fetchedAt: 1 },
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
    const html = render({
      status: 'loading',
      progress: { phase: 'backfill', percent: 33, scanned: 3, total: 9, rescanned: 0, startedAt: 0 },
      progressLines: ['backfill 3/9 replay s3', 'aggregate 1/9 s1'],
    })
    expect(html).toContain('finance-loading')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="33"')
    // 全流程百分比 + 动作日志逐行呈现；帮助/提示文案已退役
    expect(html).toContain('33%')
    expect(html).toContain('finance-init-log')
    expect(html).toContain('backfill 3/9 replay s3')
    for (const key of ['loadingDetail', 'loadingProgress', 'loadingReassure']) expect(html).not.toContain(key)
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
    expect(html).toContain('finance-provider-deepseek-official')
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

  it('趋势数据不足两天时给空占位而不是空白画布', () => {
    const html = renderToStaticMarkup(createElement(ThisMonthView, {
      ledger: { ...LEDGER, byDay: LEDGER.byDay.slice(0, 1) },
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
    expect(html).toContain('trendEmpty')
  })

  it('价格表操作与刷新同排（sm），脚注不再承载操作按钮与口径段落', () => {
    const html = render({
      status: 'ready',
      ledger: { ...LEDGER, unreadableSessions: [{ sessionId: 'bad', createdAt: 1, reason: 'v0' }] },
      providerList: PROVIDERS,
      lastSyncAppliedAt: Date.now() - 60_000,
    })
    expect(html).toContain('updatePrices')
    expect(html).toContain('restorePrices')
    expect(html).toContain('refresh')
    // 已移除的脚注段落文案不得回潮（禁用原因那一行是 §3.1 的硬要求，不在此列）
    for (const key of ['priceNoteNever', 'estimateNote', 'unreadableNote']) {
      expect(html).not.toContain(key)
    }
  })

  it('价格动作/刷新进行中时按钮走 loading 形制（spinner + aria-busy），不是只置 disabled', () => {
    // 2026-09-21 用户实测反馈：点「更新价格表」后没有任何 loading 动效，而会话多时
    // 重算要跑秒级到十秒级 —— 只 disabled 会让人以为按钮失灵。ui-kit Button 的 loading
    // 同时给 spinner、aria-busy 与锁点击，是这三件事的唯一实现处。
    const idle = render({ status: 'ready', ledger: LEDGER, providerList: PROVIDERS, refreshing: false })
    // 空闲时三枚按钮都不该是 busy 态（否则"进行中"这个信号就永远为真、等于没有）。
    expect(idle).not.toContain('aria-busy="true"')

    const updating = render({ status: 'ready', ledger: LEDGER, providerList: PROVIDERS, priceAction: 'update' })
    expect(updating).toContain('aria-busy="true"')

    const restoring = render({ status: 'ready', ledger: LEDGER, providerList: PROVIDERS, priceAction: 'restore' })
    expect(restoring).toContain('aria-busy="true"')

    const refreshing = render({ status: 'ready', ledger: LEDGER, providerList: PROVIDERS, refreshing: true })
    expect(refreshing).toContain('aria-busy="true"')
  })

  it('「还原」禁用时给可见原因并挂到按钮上（UI-UX-SPEC §3.1 禁用必须给原因）', () => {
    // priceTable 存在且 overlayKeyCount + userKeyCount === 0 → 没有可回退的东西。
    const html = render({
      status: 'ready',
      ledger: LEDGER,
      providerList: PROVIDERS,
      priceTable: {
        base: { ok: true, source: 'stub', updated: '2026-09-16T00:00:00.000Z', expected: 'stub', actual: 'stub' },
        overlay: null,
        overlayKeyCount: 0,
        userKeyCount: 0,
        rejected: [],
      },
    })
    expect(html).toContain('restoreDisabledHint')
    expect(html).toContain('id="finance-restore-hint"')
    expect(html).toContain('aria-describedby="finance-restore-hint"')
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
    expect(html).toContain('finance-provider-deepseek-official')
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
      onSetBillingMode: async () => {},
    }))
    // 供应商总表（订阅/按量合并）：a、b 都进同一张表；操作收敛为「…」菜单
    expect(noPlan).toContain('finance-provider-a')
    expect(noPlan).toContain('finance-provider-b')
    expect(noPlan).toContain('actionsMenu: a')
    // 表内不再有独立的订阅空态卡；付费类型列 + Tag 归位
    expect(noPlan).toContain('colBillingType')
    expect(noPlan).toContain('billing_metered')

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
    // 等价按量价 10_000_000 > 月费 1_000_000 → 按量等价列给出金额（SPEC §5.4）
    expect(withPlan).toContain('planEquivalent')
    // 2026-09-21 用户裁决：非付费类型列的 tag 一律移除（列窄，tag 挤金额）。
    // 省额降级为悬浮提示（planSaved），不再渲染「超值」tag。
    expect(withPlan).not.toContain('superValue')
    expect(withPlan).toContain('planSaved')
  })

  it('供应商总表内只留付费类型一个 tag（额度触达/超值/手填都不在表里）', () => {
    // 真宿主实测：额度触达 pill 长 170px 塞进 140px 的供应商列会溢出被裁 +
    // 把行高从 50px 撑到 65px，整张表看起来错位。修法 = 这些 tag 移出表格，
    // 额度信号改由详情弹窗承载（SPEC §10.5 修订）。
    const html = renderToStaticMarkup(createElement(ThisMonthView, {
      ledger: {
        ...LEDGER,
        quota: {
          rows: [{ provider: 'a', hits: 2, attempts: 11, lastHitAtMs: 1, nextResetAtMs: Date.now() + 3_600_000, windows: [] }],
          totalHits: 2,
          episodes: [{
            provider: 'a', modelKey: 'acme/llm', window: '5h', firstAtMs: 1, lastAtMs: 2,
            attempts: 6, final: true, resetAtMs: Date.now() + 3_600_000, resetRaw: null, vendorCode: '1308',
          }],
        },
      } as FinanceLedger,
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
    // 付费类型 Tag 保留（唯一合法 tag）。
    expect(html).toContain('billing_metered')
    // 其余三处一律不在表格里（详情弹窗未展开 → 整页也不该有）。
    expect(html).not.toContain('finance-quota-a')
    expect(html).not.toContain('quotaPill')
    expect(html).not.toContain('superValue')
    expect(html).not.toContain('balanceManual')
  })

  it('ui-kit Pill 透传 data-testid / aria-label（不透传会让断言验一个不存在的节点）', () => {
    // 2026-09-21 实测发现：`Pill` 原先只解构固定几个 prop、**不透传其余属性**，
    // 于是调用方传的 `data-testid` / `aria-label` 被静默丢弃 —— finance 的额度触达
    // pill 就带着 SPEC §10.5 要求的 `aria-label` + `data-testid` 传进来，实际 DOM
    // 里两个都没有（断言因此在验一个不存在的节点）。这里直接用 ui-kit 钉住透传。
    const html = renderToStaticMarkup(createElement(Pill, {
      tone: 'warn',
      'data-testid': 'probe-pill',
      'aria-label': '探针胶囊',
      title: '悬浮',
    }, '内容'))
    expect(html).toContain('data-testid="probe-pill"')
    expect(html).toContain('aria-label="探针胶囊"')
    expect(html).toContain('title="悬浮"')
    // 可点分支（button）同样透传。
    const clickable = renderToStaticMarkup(createElement(Pill, {
      onClick: () => {},
      'data-testid': 'probe-click',
      'aria-label': '可点探针',
    }, '内容'))
    expect(clickable).toContain('<button')
    expect(clickable).toContain('data-testid="probe-click"')
    expect(clickable).toContain('aria-label="可点探针"')
  })

  it('free 厂商收归订阅卡：强制月费 0、不给节省列与月费编辑入口', () => {
    const freeProviders: FinanceListProvidersResult = {
      generatedAt: 1,
      providers: [
        {
          provider: 'free-guy',
          sources: ['ledger-observed'],
          userEntry: { provider: 'free-guy', billingMode: 'free', totalPriceMicros: 0 },
          balance: { status: 'unsupported', provider: 'free-guy' },
        },
      ],
    }
    const html = renderToStaticMarkup(createElement(ThisMonthView, {
      ledger: LEDGER,
      providerList: freeProviders,
      t,
      refreshProvider: async () => {},
      plans: [],
      plansWritable: true,
      savePlan: async () => {},
      removePlan: async () => {},
      refreshing: false,
      onRefresh: () => {},
      lastSyncAppliedAt: undefined,
      onSetBillingMode: async () => {},
      onTagProvider: async () => {},
    }))
    // 订阅行月费列强制 0（¥0.00），节省列无比较意义
    expect(html).toContain('finance-provider-free-guy')
    expect(html).toContain('¥0.00')
    // 行内不再展开编辑表单（编辑入口收敛为 modal，未点开时不渲染）
    expect(html).not.toContain('finance-provider-form-free-guy')
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
    // 有月费条目的厂商按「订阅」归类 → 付费类型 Tag 呈订阅；只读时不给操作菜单
    expect(html).toContain('finance-provider-a')
    expect(html).toContain('billing_plan')
    expect(html).not.toContain('providerEditTitle')
  })

  it('WhoToUse groups the same model across vendors and marks the cheaper one', () => {
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: LEDGER, t }))
    // 组名是模型名（不是 provider/model）：两家供应同一个模型才可能同组比较
    expect(html).toContain('finance-model-llm')
    // 次要口径隐式化：命中率的算式挂在指标名 title，不再是展开区里的段落
    expect(html).toContain('title="hitRateHint"')
    expect(html).not.toContain('whoHint')
    expect(html).toContain('whoBest')
    // 转置（2026-09-20）：行 = 指标，列 = 供应商
    expect(html).toContain('finance-compare-llm')
    expect(html).toContain('finance-compare-row-unitCost')
    expect(html).toContain('finance-compare-row-hitRate')
  })

  it('该用谁列出输出速率，并对同一模型给出时间成本比较（标注估算）', () => {
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: LEDGER, t }))
    expect(html).toContain('compareMetricSpeed')
    expect(html).toContain('perSecond')
    // 92 tok/s 与 22 tok/s 是观测值，直接渲染
    expect(html).toContain('92.0')
    expect(html).toContain('22.0')
    // 时间成本比较常显在组头下面，并带「估算」标签
    expect(html).toContain('finance-time-compare')
    expect(html).toContain('timeCompareSaved')
    expect(html).toContain('estimateTag')
  })

  it('转置表有表头：左上角是「供应商」列头（此前留空）', () => {
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: LEDGER, t }))
    const head = /data-testid="finance-compare-head">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
    // 表头行列出的是各供应商，所以角格读作「供应商」而不是「指标」——
    // 指标名是每一行左侧的格，不在这行。
    expect(html).toContain('compareColProvider')
    expect(head).not.toBe('')
    for (const provider of ['a', 'b']) expect(head).toContain(provider)
  })

  it('组头不再有「仅一家在用/样本不足」结论标签与「明细」展开按钮', () => {
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: LEDGER, t }))
    // 无信息表述退役：单供应商时说"仅一家在用"、样本不足时说"暂不比较"都是废话
    expect(html).not.toContain('whoSingle')
    expect(html).not.toContain('whoNoVerdict')
    // 「明细」这个**旧的**展开块整块退役：它藏的 token 分桶已提升为表格的行。
    // 注意：aria-expanded 现在是手风琴（2026-09-21 新增）在用的，不再是"退役"标志 ——
    // 这条断言只钉旧块自己的 key，不再拿 aria-expanded 当替身。
    expect(html).not.toContain('detailToggle')
    expect(html).not.toContain('detailBuckets')
  })

  it('明细不再是展开区，而是表格里多出的四行 token 桶', () => {
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: LEDGER, t }))
    for (const metric of ['input', 'cacheRead', 'cacheWrite', 'output']) {
      expect(html).toContain(`finance-compare-row-${metric}`)
    }
    expect(html).toContain('compareMetricInput')
    expect(html).toContain('compareMetricOutput')
    // token 桶是 neutral：不判最优、不给相对差
    expect(html).toContain('compareMetricCost')
  })

  it('每行取最优并将其余格百分化（一眼看出相差多少）', () => {
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: LEDGER, t }))
    expect(html).toContain('compareBestTag')
    // a=92 tok/s 最优，b=22 tok/s → 与最优差 (22−92)/92 = −76.1%
    expect(html).toContain('−76.1%')
    // 总成本不参与最优判定（由用量规模决定）
    expect(html).toContain('compareMetricCost')
  })

  it('没有速率样本的会话不显示速率（不是 0）', () => {
    const withoutRate = {
      ...LEDGER,
      byModel: LEDGER.byModel.map(({ rate: _rate, ...row }) => row),
    }
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: withoutRate, t }))
    expect(html).toContain('compareMetricSpeed')
    expect(html).not.toContain('perSecond')
    expect(html).not.toContain('finance-time-compare')
  })

  it('金额不裸数字：formatMoneyMicros 真的带货币符号（否则闸门等于没修）', () => {
    // 实测缺陷（用户截图）：错峰卡图例渲染成 8.57 / 10.34 / 3.03，而同屏表格是 ¥…
    // 这道断言钉的是"修法本身有效"——同一个 micros，裸数字与带符号必须真的不同。
    // 静态闸门（check:contrast 的 auditBareMoney）负责"没人再用裸格式化器"，
    // 这里负责"替代品确实带符号"，两条缺一不可。
    expect(formatMicros(8_570_000)).toBe('8.57')
    expect(formatMoneyMicros(8_570_000, 'CNY')).toBe('¥8.57')
    // 未知币种用码 + 空格（与 Money 的 currencySymbol 同口径）。
    expect(formatMoneyMicros(1_000_000, 'SGD')).toBe('SGD 1')
  })

  it('SaveMore shows both actionable estimates with their basis', () => {
    const html = renderToStaticMarkup(createElement(SaveMoreView, { ledger: LEDGER, tiers: {}, t }))
    expect(html).toContain('finance-peak-savings')
    expect(html).toContain('finance-cache-savings')
    // 口径不再作为段落平铺：以 title 提示贴在数字上（仍在 HTML 里可断言）
    expect(html).toContain('title="cacheSavingsNote"')
    expect(html).not.toContain('cacheSavingsLabel')
    expect(html).toContain('estimateTag')
  })

  it('SaveMore 无可省金额时：不给解释性散文，但**给空占位**（2026-09-21 修订）', () => {
    // 真正"空"= 既无可省金额、**也没有构成数据**（bands 为空）。
    // 只把 savings 归零但留着 peakValley 各档，卡片仍有堆叠条可看 —— 那不算空。
    const html = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: {
        ...LEDGER,
        peakValley: {
          ...LEDGER.peakValley,
          shiftSavingsMicros: 0,
          peakCostMicros: 0, offPeakCostMicros: 0, flatCostMicros: 0, legacyCostMicros: 0,
        },
      },
      tiers: {},
      t,
    }))
    // 2026-09-20 退役的是**解释性散文**（"你的价目表没有峰谷窗口，或近期没有高峰时段
    // 用量"这类技术推理）—— 这条继续成立：那个 key 不许回来。
    expect(html).not.toContain('peakCardEmpty')
    // 2026-09-21 用户裁决「缺乏空占位」：真空时不再是静默 null（那会让整张卡只剩一行
    // 标题、看起来像渲染坏了），改为 EmptyState 占位（说"缺什么"）。
    expect(html).toContain('peakEmpty')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('finance-peak-savings')
  })

  it('有构成数据、只是没有可省金额时：仍给堆叠条，不误判为空', () => {
    // 反面：把 savings 归零但保留各档 → 卡片有内容，不该显示空占位。
    const html = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: { ...LEDGER, peakValley: { ...LEDGER.peakValley, shiftSavingsMicros: 0 } },
      tiers: {},
      t,
    }))
    expect(html).toContain('stackedTrack')
    expect(html).not.toContain('peakEmpty')
  })

  it('三张省额卡在无数据时都给空占位（不留"一行光标题"）', () => {
    // 用户截图实测：空数据下缓存卡只有 48px 高、正文仅 8 字符（= 标题），
    // 看起来像渲染失败。三张卡（错峰/缓存/拆分）统一补 EmptyState。
    // 造"真空"夹具：
    //  · 错峰：各档全 0 → bands 空；
    //  · 缓存：byModel 里每个 model 只留一行 → 没有跨供应商可比对象（cacheExtremes 为 null）；
    //  · 拆分：去掉 context → contextRows 空。
    const singlePerModel = LEDGER.byModel.filter((row) => row.provider === 'a')
      .map(({ context: _c, ...row }) => row)
    const html = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: {
        ...LEDGER,
        peakValley: {
          ...LEDGER.peakValley,
          shiftSavingsMicros: 0,
          peakCostMicros: 0, offPeakCostMicros: 0, flatCostMicros: 0, legacyCostMicros: 0,
        },
        byModel: singlePerModel,
      },
      tiers: {},
      t,
    }))
    for (const key of ['peakEmpty', 'cacheEmpty', 'contextEmpty']) {
      expect(html, `缺少空占位 ${key}`).toContain(key)
    }
  })

  it('错峰卡用 100% 堆叠条：各档宽度即真实占比，条本体占满卡片宽度', () => {
    const html = renderToStaticMarkup(createElement(SaveMoreView, { ledger: LEDGER, tiers: {}, t }))
    expect(html).toContain('stackedTrack')
    const widths = [...html.matchAll(/data-testid="stacked-slice-([A-Za-z]+)"[^>]*?width:\s*([\d.]+)%/g)]
    const alt = [...html.matchAll(/width:\s*([\d.]+)%[^>]*data-testid="stacked-slice-/g)]
    const parsed = widths.length > 0 ? widths.map((m) => Number(m[2])) : alt.map((m) => Number(m[1]))
    expect(parsed.length).toBeGreaterThanOrEqual(2)
    // 占比合计恒为 100%（这就是"占满 Card"的机器判据）。
    expect(parsed.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1)
    // 不再用按 niceCeil 归一的 BarChart（最大档只占 ~52%，看构成是错的信号）。
    expect(html).not.toContain('barFill')
  })

  it('拆分卡：有上下文分布 + 阶梯价时给出上限估算，没阶梯价时明说拆分不改变单价', () => {
    const group = {
      key: 'acme/llm',
      modelKey: 'acme/llm',
      currency: 'CNY',
      offPeakDiscount: 1,
      // 最小档 128k：把长上下文逐步压进这一档的费率
      tiers: [{ maxPromptTokens: 128_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 }],
    }
    const withTiers = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: LEDGER,
      tiers: { 'acme/llm': [group] },
      t,
    }))
    expect(withTiers).toContain('finance-context-card')
    expect(withTiers).toContain('estimateTag')
    expect(withTiers).toContain('contextNote')

    const withoutTiers = renderToStaticMarkup(createElement(SaveMoreView, { ledger: LEDGER, tiers: {}, t }))
    // 2026-09-21 用户裁决：「此处改为仅渲染我们已知支持梯度上下文 size 的模型，
    // 没命中的模型没必要展示在这里」—— 一张阶梯价都没有时，整张表不渲染（给空占位），
    // 而不是列出一堆只有「—」的行（用户截图里 5 行有 4 行是破折号）。
    expect(withoutTiers).not.toContain('finance-context-card')
    expect(withoutTiers).toContain('contextEmpty')
    expect(withoutTiers).not.toContain('contextNoTiers')
  })

  it('拆分卡：分界线取**各模型自己的最小档**，不在视图里写死 128k', () => {
    // 2026-09-21 用户裁决：「128K 太小了，几乎随便一个任务就能超过」。
    // 实测 7 家真实价表里有 32k/128k/200k/256k/272k/512k 六种档位 ——
    // 写死 128k 会让 256k 档的模型永远显示"界外输入占 ~100%"。
    const make = (ceiling: number) => ({
      key: 'acme/llm', modelKey: 'acme/llm', currency: 'CNY', offPeakDiscount: 1,
      tiers: [{ maxPromptTokens: ceiling, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 }],
    })
    // 必须用**真字典**：测试的 t 是 key 回显桩，不会插值 {tokens}，
    // 那样这条断言就只是在检查字符串 "contextAboveShare" 存在与否（永远为真）。
    const realT = ((key: string, params?: Record<string, string | number>) => {
      const template = (zh as Record<string, string>)[key] ?? key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? `{${name}}`))
    }) as unknown as FinanceTranslate
    const html = (ceiling: number): string => renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: LEDGER, tiers: { 'acme/llm': [make(ceiling)] }, t: realT,
    }))
    // 单元格里带出**该模型**的阈值（超过 256k / 超过 32k），且两者确实不同。
    expect(html(256_000)).toContain('256K')
    expect(html(32_000)).toContain('32K')
    expect(html(256_000)).not.toContain('128K')
    // 列头不再写死任何一个阈值（阈值逐行不同，写进列头必然对某些行是错的）。
    const head = /<div class="[^"]*tableHead[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html(256_000))?.[1] ?? ''
    expect(head).not.toContain('128K')
  })

  it('拆分卡：币种不匹配的阶梯价不参与估算（宁可不算，不可算错）', () => {
    const usdGroup = {
      key: 'acme/llm#USD',
      modelKey: 'acme/llm',
      suffix: 'USD',
      currency: 'USD',
      offPeakDiscount: 1,
      tiers: [{ maxPromptTokens: 128_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 }],
    }
    // 账本币种是 CNY，档位按 USD 计价 → 不给金额，只说明原因。
    const html = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: { ...LEDGER, currency: 'CNY' },
      tiers: { 'acme/llm': [usdGroup] },
      t,
    }))
    expect(html).toContain('finance-context-cost-acme/llm')
    expect(html).toContain('contextCurrencyMismatch')
    // 上下文那一格**没有**出金额（页面别处（峰谷/缓存卡）的 estimateTag 不算）。
    expect(contextCells(html)).not.toContain('estimateTag')

    // 币种一致（账本也按 USD）时正常给估算。
    const matched = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: { ...LEDGER, currency: 'USD' },
      tiers: { 'acme/llm': [usdGroup] },
      t,
    }))
    expect(matched).toContain('estimateTag')
    expect(matched).not.toContain('contextCurrencyMismatch')
  })

  it('拆分卡：生效窗口外的阶梯价不参与估算，错峰折扣在金额旁标注', () => {
    const base = {
      key: 'acme/llm',
      modelKey: 'acme/llm',
      currency: 'CNY',
      tiers: [{ maxPromptTokens: 128_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 }],
    }
    const expired = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: LEDGER,
      // 账本 generatedAt 是"一分钟前"，这里把窗口收在过去 → 已失效。
      tiers: { 'acme/llm': [{ ...base, offPeakDiscount: 1, effectiveTo: LEDGER.generatedAt - 86_400_000 }] },
      t,
    }))
    expect(expired).toContain('contextEraMismatch')

    const discounted = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: LEDGER,
      tiers: { 'acme/llm': [{ ...base, offPeakDiscount: 0.5 }] },
      t,
    }))
    expect(discounted).toContain('finance-context-discount-acme/llm')
    expect(discounted).toContain('contextOffPeakApplied')
  })

  it('拆分卡：没有上下文分布的旧会话不假装上下文很短（也不解释为什么）', () => {
    const noContext = { ...LEDGER, byModel: LEDGER.byModel.map(({ context: _context, ...row }) => row) }
    const html = renderToStaticMarkup(createElement(SaveMoreView, { ledger: noContext, tiers: {}, t }))
    // 整张表不渲染（而不是渲染一段"该投影是新增的，只有新会话才有"的说明）。
    expect(html).not.toContain('finance-context-card')
    expect(html).not.toContain('finance-context-empty')
    expect(html).not.toContain('contextNoData')
  })

  it('Projects lists workspaces with their cost', () => {
    const html = renderToStaticMarkup(createElement(ProjectsView, { ledger: LEDGER, plans: [], t }))
    expect(html).toContain('finance-projects')
    expect(html).toContain('AgentStudio')
    // 表格形制：项目 / 消耗 / 总 token / 总耗时 四列都在
    expect(html).toContain('colTokensTotal')
    expect(html).toContain('colDuration')
  })

  it('项目详情把趋势与会话明细渲染为嵌套 Card（inset 变体）', () => {
    const html = renderToStaticMarkup(createElement(ProjectDetail, {
      row: { workspaceId: 'w1', title: 'AgentStudio', meteredMicros: 10_000_000, planEstimateMicros: 0, totalMicros: 10_000_000 },
      ledger: LEDGER,
      currency: 'CNY',
      t,
      onBack: () => {},
    }))
    expect(html).toContain('finance-project-detail')
    // 三个分块（消耗构成 / 成本趋势 / 会话明细）全部走 ui-kit Card variant=inset
    expect(html).toContain('inset')
    expect(html).toContain('projectCostSplitTitle')
    expect(html).toContain('projectSessionsTitle')
    expect(html).toContain('trendTitle')
  })

  it('Projects shows the guidance empty state without workspaces', () => {
    const html = renderToStaticMarkup(createElement(ProjectsView, { ledger: { ...LEDGER, byWorkspace: [] }, plans: [], t }))
    expect(html).toContain('finance-projects-empty')
  })
})

describe('locale dictionaries', () => {
  it('keeps zh/en key sets identical', async () => {
    const { en } = await import('../src/client/locales.ts')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
/**
 * SPEC §10.8 的克制口径（2026-09-20 用户裁决）：
 * 窗口归因卡**不承载任何口径解释/提示性文案** —— 月长折算口径、迁移边界
 * （"旧会话没有时长数据"）、"未填月费"这类说明一律不进 UI。
 *
 * 理由与背景：neilji 的一贯口径是「提示文案只在异常且必须给原因时出现」。
 * 无数据本身已经由「—」表意，再补一段解释就是把认知负担丢给用户。
 * 卡里只允许出现**数字与列名**。
 *
 * 这条测试锁的是"文案不再回来"——口径说明的正确归宿是
 * `docs/FINANCE-PRICING-SPEC.md` §10.8，不是屏幕。
 */
describe('QuotaWindowCard 不含提示性文案（SPEC §10.8）', () => {
  const windowLedger: FinanceLedger = {
    ...LEDGER,
    windows: [{
      span: '5h',
      startMs: 0,
      endMs: 1000,
      anchoredAtHit: false,
      usage: buckets(100_000, 1_000, 0, 700),
      costMicros: 30_000,
      decodeMs: 60_000,
      ttftMs: 100,
      steps: 1,
      models: [{
        modelKey: 'acme/llm',
        provider: 'acme',
        usage: buckets(100_000, 1_000, 0, 700),
        costMicros: 30_000,
        decodeMs: 60_000,
        ttftMs: 100,
        steps: 1,
      }],
      providerCount: 1,
    }],
  }

  const render = (ledger: FinanceLedger) => renderToStaticMarkup(
    createElement(ThisMonthView, {
      ledger,
      providerList: PROVIDERS,
      t,
      refreshProvider: async () => {},
      plans: [],
      plansWritable: true,
      savePlan: async () => {},
      removePlan: async () => {},
      onSetBillingMode: async () => {},
      onTagProvider: async () => {},
      refreshing: false,
      onRefresh: () => {},
      lastSyncAppliedAt: undefined,
      priceTable: undefined,
      priceAction: undefined,
      priceError: null,
      onUpdatePrices: async () => {},
      onRestorePrices: async () => {},
    } as never),
  )

  it('renders only numbers and column labels, no explanatory prose', () => {
    const html = render(windowLedger)
    const card = /data-testid="finance-quota-window"[\s\S]*?(?=<\/section>|data-testid="finance-quota-window-end")/.exec(html)
    expect(card).not.toBeNull()
    const inner = card![0]

    // 口径解释与提示性文案一律不得出现（key 即文案，t() 原样回显 key）。
    for (const banned of [
      'windowEstimateNote',
      'windowDurationNone',
      'windowNoPlan',
      'windowProviderCount',
      'windowCardHint',
      'windowAnchored',
    ]) {
      expect(inner).not.toContain(banned)
    }
    // 但数字与列名必须在场（否则就是"删过头"）。
    expect(inner).toContain('windowColModel')
    expect(inner).toContain('windowEquivalent')
  })

  it('shows the value verdict only when the monthly fee allows computing it', () => {
    const withPlanHtml = renderToStaticMarkup(
      createElement(ThisMonthView, {
        ledger: windowLedger,
        providerList: PROVIDERS,
        t,
        refreshProvider: async () => {},
        plans: [{ provider: 'acme', monthlyMicros: 10_000_000, currency: 'CNY', effectiveFrom: 0 }],
        plansWritable: true,
        savePlan: async () => {},
        removePlan: async () => {},
        onSetBillingMode: async () => {},
        onTagProvider: async () => {},
        refreshing: false,
        onRefresh: () => {},
        lastSyncAppliedAt: undefined,
        priceTable: undefined,
        priceAction: undefined,
        priceError: null,
        onUpdatePrices: async () => {},
        onRestorePrices: async () => {},
      } as never),
    )
    // 有月费 -> 出现结论；无月费 -> 一个字都不多说（首次 render() 已断言）。
    expect(withPlanHtml).toMatch(/windowSavings(Up|Down)/)
    // 2026-09-21 用户裁决：结论句从「指标区下方另起一行的正文」改为
    // **「按量等价」数值下方的小字说明**（ui-kit Stat.description）。断言它确实
    // 落在 statDesc 里、且不再有旧的 windowVerdict 段落 —— 否则就是"改了文案没改形制"。
    expect(withPlanHtml).toContain('statDesc')
    expect(withPlanHtml).not.toContain('windowVerdict')
  })

  it('「按量等价」的结论句渲染在数值下方（Stat.description），不是另起一行正文', () => {
    // 形制不变量：结论必须在 Stat 的 description 槽里，与"按量等价"那个大数字同卡。
    // 断言结构而不是文案 —— 值域由 t() 决定，形制才是这次裁决的对象。
    const html = renderToStaticMarkup(
      createElement(ThisMonthView, {
        ledger: windowLedger,
        providerList: PROVIDERS,
        t,
        refreshProvider: async () => {},
        plans: [{ provider: 'acme', monthlyMicros: 10_000_000, currency: 'CNY', effectiveFrom: 0 }],
        plansWritable: true,
        savePlan: async () => {},
        removePlan: async () => {},
        refreshing: false,
        onRefresh: () => {},
        lastSyncAppliedAt: undefined,
        priceTable: undefined,
        priceAction: undefined,
        priceError: null,
        onUpdatePrices: async () => {},
        onRestorePrices: async () => {},
      } as never),
    )
    // statDesc 紧跟 statValue，且结论 key 出现在 statDesc 之后（即同一张 Stat 内）。
    const i = html.indexOf('statDesc')
    expect(i).toBeGreaterThan(-1)
    const savingsAt = html.search(/windowSavings(Up|Down)/)
    expect(savingsAt).toBeGreaterThan(i)
    // 三张 Stat 里只有「按量等价」那一张带 description。
    expect((html.match(/statDesc/g) ?? []).length).toBe(1)
  })

  it('各模型明细的模型名走 CellText 2 行截断，且不被外层的 nowrap 压回单行', () => {
    // 2026-09-21 用户裁决：模型名要「支持换行，最多 2 行，超出截断」。
    // 实测缺陷：CellText 与 `.cell` 连用时，后者的 `white-space: nowrap` 与
    // CellText 的单类选择器同特异度 → 谁胜出取决于样式注入顺序，实测 nowrap 胜出、
    // `-webkit-line-clamp` 静默失效（模型名退化成单行省略）。
    // 修法：换行语义完全归 CellText（组件自带 white-space:normal），调用方**不再传 .cell**。
    const repoRoot = new URL('../../../', import.meta.url)
    const cellTextSrc = readFileSync(new URL('packages/dsh-ui-kit/src/components/CellText.module.css', repoRoot), 'utf8')
    // CellText 自己必须声明 normal（否则再次输给 nowrap）。
    expect(cellTextSrc).toMatch(/\.cellText\s*\{[\s\S]*white-space:\s*normal/)
    expect(cellTextSrc).toMatch(/-webkit-line-clamp:\s*var\(--cell-lines,\s*2\)/)
    // 调用方不得再把它和 nowrap 的 .cell 拼在一起。
    const viewSrc = readFileSync(new URL('packages/dsh-finance-client/src/client/views/QuotaWindowCard.tsx', repoRoot), 'utf8')
    expect(viewSrc).not.toMatch(/<CellText className=\{css\.cell\}/)
    expect(viewSrc).toMatch(/<CellText className=\{css\.cellTextOnly\}/)
  })
})

/**
 * 卡片层级（2026-09-20 用户裁决）：一张 Card 里混了多种内容（指标区 + 表格、
 * 提示 + 表格、组头 + 表格）时，**表格要包一层 inset 子卡**，与外层卡形成可辨层级。
 *
 * 反面模式是「同色卡套卡」看不出结构 —— 先例见项目详情（消耗构成 / 趋势 /
 * 会话明细三张 inset 卡）。这条测试锁的是层级确实产生了，而不是只改了源码。
 */
describe('混合内容的卡：表格包一层 inset 子卡', () => {
  const insetCount = (html: string): number => (html.match(/_inset"/g) ?? []).length
  const cardTitles = (html: string): string[] =>
    [...html.matchAll(/<h3 class="[^"]*title[^"]*">([^<]*)<\/h3>/g)].map((m) => m[1])

  it('额度窗口归因：指标区 + 模型明细表 → 表格是 inset 子卡', () => {
    const html = renderToStaticMarkup(createElement(ThisMonthView, {
      ledger: { ...LEDGER, windows: [{ span: '5h', startMs: 0, endMs: 1000, anchoredAtHit: false, usage: buckets(1, 0, 0, 1), costMicros: 10, decodeMs: 1000, ttftMs: 10, steps: 1, models: [{ modelKey: 'acme/llm', provider: 'acme', usage: buckets(1, 0, 0, 1), costMicros: 10, decodeMs: 1000, ttftMs: 10, steps: 1 }], providerCount: 1 }] },
      providerList: PROVIDERS, t, refreshProvider: async () => {}, plans: [], plansWritable: true,
      savePlan: async () => {}, removePlan: async () => {}, onSetBillingMode: async () => {},
      onTagProvider: async () => {}, refreshing: false, onRefresh: () => {}, lastSyncAppliedAt: undefined,
      priceTable: undefined, priceAction: undefined, priceError: null,
      onUpdatePrices: async () => {}, onRestorePrices: async () => {},
    } as never))
    expect(insetCount(html)).toBeGreaterThanOrEqual(1)
    // 外层「额度窗口归因」里嵌了「各模型明细」
    const titles = cardTitles(html)
    expect(titles).toContain('windowCardTitle')
    expect(titles).toContain('windowTableTitle')
  })

  it('会话拆分节省估算：提示 + 明细表 → 表格是 inset 子卡', () => {
    // 必须给**阶梯价**：2026-09-21 起没命中阶梯价的模型不再出现在这张表里，
    // 空 tiers 时整表不渲染（上面那条测试钉住了这一点）。
    const tierGroup = {
      key: 'acme/llm',
      modelKey: 'acme/llm',
      currency: 'CNY',
      offPeakDiscount: 1,
      tiers: [{ maxPromptTokens: 128_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 }],
    }
    const html = renderToStaticMarkup(createElement(SaveMoreView, {
      ledger: LEDGER,
      tiers: { 'acme/llm': [tierGroup] },
      t,
    }))
    expect(insetCount(html)).toBeGreaterThanOrEqual(1)
    expect(cardTitles(html)).toContain('contextTableTitle')
  })

  it('该用谁：每个模型组一个手风琴项，默认只展开首项、且不再嵌套 inset 卡', () => {
    // **必须用多组夹具**：默认夹具只有一个模型组（acme/llm × 2 家），
    // 此时"只展开首项"与"全部展开"在渲染结果上**无法区分**（index===0 恒真）
    // —— 第一版就是这样写了条永远绿的断言（负向验证时没抓住 defaultOpen={true}）。
    // 这里加第二个模型组，让"展开数 = 1"真正可判。
    const twoGroups: FinanceLedger = {
      ...LEDGER,
      byModel: [
        ...LEDGER.byModel,
        {
          modelKey: 'acme/other',
          provider: 'a',
          model: 'other',
          usage: buckets(500_000, 100_000, 0, 50_000),
          costMicros: 5_000_000,
        },
      ],
    }
    const html = renderToStaticMarkup(createElement(WhoToUseView, { ledger: twoGroups, t }))
    // 2026-09-21 用户裁决：接入模型一多，"全展开平铺"读不动 → 改手风琴；
    // 手风琴本身已起内容分割作用 → **移除原先的嵌套 inset Card**。
    const groupCount = (html.match(/data-testid="finance-model-/g) ?? []).length
    expect(groupCount).toBe(2)
    // 每个组一个 Disclosure。注意 ui-kit Disclosure 把 aria-expanded **同时**挂在
    // 外层 div 与头行 button 上（wrapper 供 CSS 选择 `[aria-expanded="true"]` 驱动动画，
    // button 供无障碍），所以按"元素数"数会得到 2×；这里只数头行 button（折叠头）。
    const headCount = (html.match(/<button[^>]*aria-expanded=/g) ?? []).length
    expect(headCount).toBe(groupCount)
    // 默认展开**恰好一个**（首项 = 总成本最高的组，最可能先看）。
    expect((html.match(/<button[^>]*aria-expanded="true"/g) ?? []).length).toBe(1)
    // 嵌套 inset 卡已移除：本视图不再渲染任何 inset。
    expect(html).not.toContain('_inset"')
  })
})
