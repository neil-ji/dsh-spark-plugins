import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { FinanceAuditSection } from '../src/client/FinanceAuditSection.tsx'
import type { FinanceOverview } from 'dsh-finance/types'

const t = (key: string): string => key

function overview(): FinanceOverview {
  return {
    balance: { status: 'ok', updatedAt: 1, totalMicros: 100_000_000, currency: 'CNY' },
    ledger: {
      generatedAt: 1,
      currency: 'CNY',
      totals: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 },
      totalCostMicros: 6_000_000,
      sessionCount: 2,
      workspaceCount: 1,
      taskCount: 1,
      windowedSinceMs: null,
      hourOfDayWindowStartMs: 1,
      byDay: [
        { day: '2026-01-15', usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 }, costMicros: 6_000_000 },
      ],
      byModel: [
        { modelKey: 'deepseek-official/deepseek-v4-flash', provider: 'deepseek-official', model: 'deepseek-v4-flash', usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 }, costMicros: 6_000_000 },
      ],
      byProvider: [
        { provider: 'deepseek-official', usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 }, costMicros: 6_000_000, modelCount: 1 },
      ],
      byWorkspace: [
        { workspaceId: 'ws-1', title: 'Workspace A', sessionCount: 2, usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 }, costMicros: 6_000_000 },
      ],
      tasks: [
        { taskId: 'task-1', title: 'Task One', createdAt: 1, sessionCount: 2, usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 }, costMicros: 6_000_000 },
      ],
      sessions: [
        { sessionId: 'sess-1', title: 'Session One', createdAt: 2, workspaceId: 'ws-1', workspaceTitle: 'Workspace A', taskId: 'task-1', modelKeys: ['deepseek-official/deepseek-v4-flash'], usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 }, costMicros: 6_000_000 },
      ],
      byHourOfDay: Array.from({ length: 24 }, (_, localHour) => ({
        localHour,
        usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
        costMicros: 0,
        peakCostMicros: 0,
        flatCostMicros: 0,
        shiftSavingsMicros: 0,
      })),
      peakValley: { peakCostMicros: 0, offPeakCostMicros: 0, flatCostMicros: 0, unclassifiedCostMicros: 0, legacyCostMicros: 0, shiftSavingsMicros: 0 },
    },
  }
}

const baseProps = {
  useSnapshot: () => ({ status: 'ready' as const, overview: overview(), error: null }),
  t,
  refresh: () => {},
  close: () => {},
}

/** Snapshot props pinned to one ready overview (shared by several tests). */
function basePropsUse(ov: FinanceOverview) {
  return { ...baseProps, useSnapshot: () => ({ status: 'ready' as const, overview: ov, error: null }) }
}

describe('FinanceAuditSection', () => {
  it('renders an informative loading state with a spinner', () => {
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({ status: 'loading' as const, error: null }),
    }))
    expect(html).toContain('loadingTitle')
    expect(html).toContain('loadingDetail')
    expect(html).toContain('loadingReassure')
    expect(html).toContain('role="status"')
  })

  it('shows live backfill progress while the first load runs', () => {
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({
        status: 'loading' as const,
        error: null,
        progress: { phase: 'backfill', scanned: 45, total: 96, rescanned: 5, startedAt: 1 },
      }),
    }))
    expect(html).toContain('loadingProgress')
    expect(html).toContain('45 / 96')
    expect(html).toContain('aria-valuenow="45"')
    expect(html).toContain('aria-valuemax="96"')
  })

  it('renders the error state with a refresh action', () => {
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({ status: 'error' as const, error: 'boom', overview: undefined }),
    }))
    expect(html).toContain('boom')
    expect(html).toContain('refresh')
  })

  it('renders the balance gauge and the remaining KPI cards', () => {
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, baseProps))
    expect(html).toContain('balanceGauge') // gauge title
    expect(html).toContain('remaining')    // percentage label
    expect(html).toContain('peak')         // historical peak
    expect(html).toContain('spent')        // consumed amount
    expect(html).not.toContain('granted')
    expect(html).not.toContain('toppedUp')
    expect(html).toContain('CNY 100.00')   // balance
    expect(html).toContain('CNY 6.00')     // spent
  })

  it('fills the gauge by the peak when a recharge was detected', () => {
    const recharged = overview()
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({
        status: 'ready' as const,
        overview: recharged,
        error: null,
        peak: { micros: 150_000_000, updatedAt: 2 },
      }),
    }))
    // balance 100M / peak 150M -> 67%
    expect(html).toContain('aria-valuenow="67"')
    expect(html).toContain('remaining 67%')
    expect(html).toContain('CNY 150.00') // historical peak
  })

  it('renders the missing-credential state instead of the gauge', () => {
    const missing = overview()
    missing.balance = { status: 'missing-credential', updatedAt: 1 }
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({ status: 'ready' as const, overview: missing, error: null }),
    }))
    expect(html).toContain('missingCredential')
  })

  it('renders the daily trend chart with axes and summary stats', () => {
    const days = overview()
    days.ledger.byDay = [
      { day: '2026-01-15', usage: { uncachedInputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 250_000 }, costMicros: 3_000_000 },
      { day: '2026-01-16', usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 }, costMicros: 6_000_000 },
      { day: '2026-01-17', usage: { uncachedInputTokens: 250_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100_000 }, costMicros: 1_500_000 },
    ]
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({ status: 'ready' as const, overview: days, error: null }),
    }))
    expect(html).toContain('byDay')       // chart aria-label
    expect(html).toContain('01-15')       // x-axis date labels
    expect(html).toContain('01-17')
    expect(html).toContain('trendRange')  // summary stats row
    expect(html).toContain('trendTotal')
    expect(html).toContain('trendAvg')
    expect(html).toContain('CNY 10.50')   // 3-day total
  })

  it('renders the peak/valley split donut and the hour-of-day chart', () => {
    const pv = overview()
    pv.ledger.byHourOfDay = pv.ledger.byHourOfDay.map(row => row.localHour === 10
      ? { ...row, usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, costMicros: 3_000_000, peakCostMicros: 3_000_000, flatCostMicros: 0, shiftSavingsMicros: 1_500_000 }
      : row.localHour === 3
        ? { ...row, usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, costMicros: 1_500_000, peakCostMicros: 0, flatCostMicros: 0, shiftSavingsMicros: 0 }
        : row)
    pv.ledger.peakValley = { peakCostMicros: 3_000_000, offPeakCostMicros: 1_500_000, flatCostMicros: 0, unclassifiedCostMicros: 0, legacyCostMicros: 0, shiftSavingsMicros: 1_500_000 }
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({ status: 'ready' as const, overview: pv, error: null }),
    }))
    expect(html).toContain('peakValleySplit') // card title + donut aria-label
    expect(html).toContain('hourOfDay')       // card title + chart aria-label
    expect(html).toContain('peakBand')        // stats + legend + donut segment
    expect(html).toContain('offPeak')
    expect(html).toContain('shiftSavings')
    expect(html).toContain('shiftSavingsOfPeak') // savings as % of peak cost
    expect(html).toContain('50%')             // 1.5M / 3M peak
    expect(html).toContain('shiftSavingsTop') // most-worth-shifting hours hint
    expect(html).toContain('10:00')           // the shiftable hour
    expect(html).toContain('CNY 3.00')        // peak stat
    expect(html).toContain('CNY 1.50')        // off-peak stat + shift savings
    expect(html).toContain('¥4.50')           // donut center total (4.5M micros)
  })

  it('shows the windowed-era effective date and separates legacy session cost', () => {
    const pv = overview()
    pv.ledger.windowedSinceMs = Date.UTC(2026, 7, 16, 16) // 2026-08-17 00:00 +08:00
    pv.ledger.peakValley = {
      peakCostMicros: 3_000_000,
      offPeakCostMicros: 1_500_000,
      flatCostMicros: 0,
      unclassifiedCostMicros: 0,
      legacyCostMicros: 2_000_000,
      shiftSavingsMicros: 1_500_000,
    }
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({ status: 'ready' as const, overview: pv, error: null }),
    }))
    // Effective-date subtitle rendered in Beijing time.
    expect(html).toContain('peakValleySince')
    expect(html).toContain('2026-08-17 00:00')
    expect(html).toContain('peakValleySinceTail')
    // Legacy sessions shown as a separate stat in the split card stats row.
    expect(html).toContain('legacySessions')
    expect(html).toContain('CNY 2.00') // legacy cost
  })

  it('renders the dashboard without the config toolbar (config moved to the plugin card)', () => {
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, baseProps))
    expect(html).toContain('rootCompact')  // compact is the default density
    // The layout switch and chart chips live on the plugin configuration card
    // (设置 → 插件 → 插件配置页), not on the dashboard.
    expect(html).not.toContain('layoutCompact')
    expect(html).not.toContain('layoutStandard')
    expect(html).not.toContain('aria-pressed')
  })

  it('honors persisted prefs: standard single-column layout with the by-model chart hidden', () => {
    const storage = new Map<string, string>()
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() { return storage.size },
    }
    const original = (globalThis as { localStorage?: unknown }).localStorage
    ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage
    storage.set('dsh-finance.prefs', JSON.stringify({
      layout: 'standard',
      charts: {
        gauge: true, kpis: true, split: true, hourOfDay: true,
        byModel: false, byWorkspace: true, byDay: true,
      },
    }))
    try {
      const html = renderToStaticMarkup(createElement(FinanceAuditSection, baseProps))
      expect(html).toContain('rootStandard')
      expect(html).not.toContain('rootCompact')
      expect(html).not.toContain('>byModel<')            // card title gone
      expect(html).not.toContain('aria-label="byModel"') // donut gone
      expect(html).toContain('>byWorkspace<')            // card kept
      expect(html).toContain('>byDay<')                  // trend card kept
    } finally {
      ;(globalThis as { localStorage?: unknown }).localStorage = original
    }
  })

  it('renders the empty state when there are no sessions', () => {
    const empty = overview()
    empty.ledger.sessions = []
    empty.ledger.tasks = []
    empty.ledger.byWorkspace = []
    empty.ledger.byDay = []
    empty.ledger.byModel = []
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({ status: 'ready' as const, overview: empty, error: null }),
    }))
    expect(html).toContain('empty')
  })

  it('renders the by-model donut with legend shares and a center total', () => {
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, baseProps))
    expect(html).toContain('byModel')        // card title + svg aria-label
    expect(html).toContain('¥6.00')          // donut center total (compact currency)
    expect(html).toContain('100.0%')         // legend share
    expect(html).toContain('CNY 6.00')       // legend cost
    expect(html).toContain('modelCountUnit') // summary stats row
    expect(html).toContain('trendTotal')     // summary stats total label
  })

  it('renders the by-workspace bars with a value axis and shares', () => {
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, baseProps))
    expect(html).toContain('byWorkspace')    // card title
    expect(html).toContain('workspaceCountUnit')
    expect(html).toContain('¥0.00')          // value axis origin
    expect(html).toContain('¥6.00')          // value axis max tick (= max cost)
    expect(html).toContain('100.0%')         // share label
  })

  it('folds overflow rows into an Other segment', () => {
    const many = overview()
    const usage = { uncachedInputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50_000 }
    many.ledger.byModel = Array.from({ length: 8 }, (_, i) => ({
      modelKey: `model-${i + 1}`,
      provider: 'prov',
      model: `model-${i + 1}`,
      usage,
      costMicros: (8 - i) * 1_000_000,
    }))
    many.ledger.byWorkspace = Array.from({ length: 9 }, (_, i) => ({
      workspaceId: `ws-${i + 1}`,
      title: `Workspace ${i + 1}`,
      sessionCount: 8 - i,
      usage,
      costMicros: (8 - i) * 1_000_000,
    }))
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({ status: 'ready' as const, overview: many, error: null }),
    }))
    expect(html).toContain('other')          // both charts aggregate overflow
    expect(html).toContain('model-1')        // top model kept
    expect(html).not.toContain('model-6')    // 6th model folded (limit 5)
    expect(html).not.toContain('Workspace 7') // 7th workspace folded (limit 6)
  })

  it('assigns each donut segment a distinct categorical color', () => {
    const many = overview()
    const usage = { uncachedInputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50_000 }
    many.ledger.byModel = [
      { modelKey: 'deepseek-official/deepseek-v4-flash', provider: 'deepseek-official', model: 'deepseek-v4-flash', usage, costMicros: 3_400_000 },
      { modelKey: 'deepseek-official/deepseek-v4-pro', provider: 'deepseek-official', model: 'deepseek-v4-pro', usage, costMicros: 2_600_000 },
    ]
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({ status: 'ready' as const, overview: many, error: null }),
    }))
    // Adjacent categories must never share a hue (regression: flash/pro were both blue).
    expect(html).toContain('stroke:#4176e6') // brand
    expect(html).toContain('stroke:#22c55e') // green
    expect(html).not.toContain('stroke:#3b82f6') // the colliding blue token is gone
  })

  it('renders the per-provider cost donut with provider rollups', () => {
    const multi = overview()
    const usage = { uncachedInputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50_000 }
    multi.ledger.byProvider = [
      { provider: 'openai', usage, costMicros: 4_000_000, modelCount: 2 },
      { provider: 'anthropic', usage, costMicros: 2_000_000, modelCount: 1 },
    ]
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, {
      ...baseProps,
      useSnapshot: () => ({ status: 'ready' as const, overview: multi, error: null }),
    }))
    expect(html).toContain('byProvider')            // card title + aria-label
    expect(html).toContain('providerCountUnit')     // stats line
    expect(html).toContain('aria-label="byProvider"')
    expect(html).toContain('openai')                // provider label kept
    expect(html).toContain('anthropic')             // second provider kept
  })

  it('labels model donut slices by model and names the provider in the tooltip', () => {
    const cross = overview()
    const usage = { uncachedInputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50_000 }
    cross.ledger.byModel = [
      { modelKey: 'openai/gpt-4o-mini', provider: 'openai', model: 'gpt-4o-mini', usage, costMicros: 4_000_000 },
      { modelKey: 'deepseek-official/deepseek-v4-flash', provider: 'deepseek-official', model: 'deepseek-v4-flash', usage, costMicros: 2_000_000 },
    ]
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, basePropsUse(cross)))
    expect(html).toContain('gpt-4o-mini')              // short model label
    expect(html).toContain('deepseek-v4-flash')        // short model label
    expect(html).not.toContain('openai/gpt-4o-mini')   // raw key no longer the label
  })

  it('keeps breakdown tooltips out of the static markup (client-only hover)', () => {
    const html = renderToStaticMarkup(createElement(FinanceAuditSection, baseProps))
    expect(html).not.toContain('role="tooltip"')
    expect(html).not.toContain('tipInput')   // tooltip detail line is never static
  })
})