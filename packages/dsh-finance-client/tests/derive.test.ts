import { describe, expect, it } from 'vitest'
import type { FinanceLedger, FinanceSessionRow, FinanceTokenBuckets } from 'dsh-spark-finance/types'
import {
  balanceDaysLeft,
  cacheExtremes,
  cheapestInGroup,
  dailyAverageMicros,
  effectiveInputTokens,
  estimateCacheSavings,
  formatPercent,
  groupByModel,
  hitRate,
  mixedUnitCostMicros,
  modelComparisonRows,
  peakShare,
  planInsight,
  planRows,
  projectRows,
  providerCostMicros,
  providerDailyMicros,
  sessionsOfWorkspace,
  sessionsTrend,
  totalTokens,
} from '../src/client/derive.ts'

const buckets = (input: number, cacheRead: number, cacheWrite: number, output: number): FinanceTokenBuckets => ({
  uncachedInputTokens: input,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
  outputTokens: output,
})

const ZERO_LEDGER: FinanceLedger = {
  generatedAt: 1,
  currency: 'CNY',
  totals: buckets(0, 0, 0, 0),
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
  unreadableSessions: [],
  byHourOfDay: [],
  peakValley: { peakCostMicros: 0, offPeakCostMicros: 0, flatCostMicros: 0, unclassifiedCostMicros: 0, legacyCostMicros: 0, shiftSavingsMicros: 0 },
}

const ledger = (overrides: Partial<FinanceLedger> = {}): FinanceLedger => ({ ...ZERO_LEDGER, ...overrides })

describe('derive: token buckets', () => {
  it('counts cache read/write as input side', () => {
    const b = buckets(100, 30, 20, 40)
    expect(effectiveInputTokens(b)).toBe(150)
    expect(totalTokens(b)).toBe(190)
  })

  it('hit rate is null (not 0) without input-side tokens', () => {
    expect(hitRate(buckets(0, 0, 0, 10))).toBeNull()
    expect(hitRate(buckets(100, 100, 0, 10))).toBeCloseTo(0.5)
  })

  it('mixed unit cost is micros per million tokens', () => {
    // 2_000_000 micros over 2_000_000 tokens = 1 micros/token = 1e6 micros/Mtok
    expect(mixedUnitCostMicros(2_000_000, buckets(1_000_000, 900_000, 0, 100_000))).toBeCloseTo(1_000_000)
    expect(mixedUnitCostMicros(10, buckets(0, 0, 0, 0))).toBeNull()
  })

  it('formats percentages with a dash for unknown values', () => {
    expect(formatPercent(0.625)).toBe('62.5%')
    expect(formatPercent(null)).toBe('—')
  })
})

describe('derive: model comparison', () => {
  const cheap = { usage: buckets(1_000_000, 1_000_000, 0, 100_000), costMicros: 10_000_000 }
  const pricey = { usage: buckets(2_000_000, 200_000, 0, 100_000), costMicros: 40_000_000 }
  const rows = [
    { modelKey: 'acme/llm', provider: 'a', model: 'llm', ...cheap },
    { modelKey: 'acme/llm', provider: 'b', model: 'llm', ...pricey },
    { modelKey: 'acme/other', provider: 'a', model: 'other', usage: buckets(500_000, 0, 0, 50_000), costMicros: 1_000_000 },
  ].map((row) => ({
    ...row,
    hitRate: hitRate(row.usage),
    unitCostMicros: mixedUnitCostMicros(row.costMicros, row.usage),
  }))

  it('groups by model, heaviest model first', () => {
    const groups = groupByModel(rows)
    expect(groups.map((g) => g.modelKey)).toEqual(['acme/llm', 'acme/other'])
    expect(groups[0].rows).toHaveLength(2)
  })

  it('picks the cheaper provider only when the gap is material', () => {
    const best = cheapestInGroup(rows.filter((r) => r.modelKey === 'acme/llm'))
    expect(best?.provider).toBe('a')
    // 同一供应商只有一行 -> 不给结论
    expect(cheapestInGroup(rows.filter((r) => r.modelKey === 'acme/other'))).toBeNull()
    // 差值在 0.5% 以内 -> 不硬凑赢家
    const twin = rows.filter((r) => r.modelKey === 'acme/llm').map((r) => ({ ...r, unitCostMicros: 100 }))
    expect(cheapestInGroup(twin)).toBeNull()
  })

  it('finds the cache extremes and estimates the saving with a documented basis', () => {
    const extremes = cacheExtremes(rows)
    expect(extremes?.best.provider).toBe('a')
    expect(extremes?.worst.provider).toBe('b')
    const savings = estimateCacheSavings(rows)
    expect(savings).not.toBeNull()
    if (savings !== null) {
      expect(savings.from.provider).toBe('b')
      expect(savings.to.provider).toBe('a')
      const unitGap = (pricey.costMicros / (2_300_000 / 1_000_000)) - (cheap.costMicros / (2_100_000 / 1_000_000))
      expect(savings.amountMicros).toBeCloseTo((2_200_000 / 1_000_000) * unitGap)
    }
  })

  it('never claims a cache saving for different models', () => {
    const crossModel = rows.filter((r) => r.provider === 'a')
    expect(estimateCacheSavings(crossModel)).toBeNull()
  })

  it('maps ledger rows through modelComparisonRows', () => {
    const mapped = modelComparisonRows(ledger({
      byModel: [
        { modelKey: 'acme/llm', provider: 'acme', model: 'llm', usage: cheap.usage, costMicros: cheap.costMicros },
      ],
    }))
    expect(mapped).toHaveLength(1)
    expect(mapped[0].hitRate).toBeCloseTo(0.5)
    expect(mapped[0].unitCostMicros).toBeCloseTo(cheap.costMicros / 2.1)
  })
})

describe('derive: balance days left', () => {
  it('averages the most recent days', () => {
    const byDay = [
      { day: '2026-09-01', usage: buckets(0, 0, 0, 0), costMicros: 10 },
      { day: '2026-09-14', usage: buckets(0, 0, 0, 0), costMicros: 30 },
      { day: '2026-09-13', usage: buckets(0, 0, 0, 0), costMicros: 20 },
    ]
    expect(dailyAverageMicros(byDay, 2)).toBeCloseTo(25)
    expect(dailyAverageMicros([], 7)).toBeNull()
  })

  it('attributes ledger cost to a balance-side provider id', () => {
    const l = ledger({
      byDay: [{ day: '2026-09-14', usage: buckets(0, 0, 0, 0), costMicros: 7_000_000 }],
      byProvider: [{ provider: 'deepseek', usage: buckets(0, 0, 0, 0), costMicros: 7_000_000, modelCount: 1 }],
    })
    expect(providerCostMicros(l, 'deepseek-official')).toBe(7_000_000)
    expect(providerDailyMicros(l, 'deepseek-official')).toBeCloseTo(7_000_000)
    expect(balanceDaysLeft(21_000_000, 7_000_000)).toBeCloseTo(3)
    expect(balanceDaysLeft(undefined, 1)).toBeNull()
    expect(balanceDaysLeft(100, null)).toBeNull()
  })
})

describe('derive: 订阅 vs 按量', () => {
  const l = ledger({
    byProvider: [
      { provider: 'deepseek', usage: buckets(1_000_000, 0, 0, 0), costMicros: 30_000_000, modelCount: 1 },
      { provider: 'acme', usage: buckets(1_000_000, 0, 0, 0), costMicros: 5_000_000, modelCount: 1 },
    ],
  })

  it('compares the metered equivalent against the monthly fee', () => {
    const saved = planInsight({ provider: 'deepseek-official', monthlyMicros: 10_000_000, currency: 'CNY' }, l)
    expect(saved.equivalentMicros).toBe(30_000_000)
    expect(saved.savingsMicros).toBe(20_000_000)
    expect(saved.discountRate).toBeCloseTo(1 - 10 / 30)
    expect(saved.breakEvenRatio).toBeCloseTo(3)

    const lost = planInsight({ provider: 'acme', monthlyMicros: 10_000_000, currency: 'CNY' }, l)
    expect(lost.savingsMicros).toBe(-5_000_000)
    expect(lost.breakEvenRatio).toBeCloseTo(0.5)
  })

  it('says nothing when the month has no equivalent usage', () => {
    const unknown = planInsight({ provider: 'nobody', monthlyMicros: 1_000_000, currency: 'CNY' }, l)
    expect(unknown.equivalentMicros).toBe(0)
    expect(unknown.discountRate).toBeNull()
  })

  it('lists only the vendors the ledger actually observed', () => {
    const { withPlan, withoutPlan } = planRows(l, [{ provider: 'deepseek', monthlyMicros: 1, currency: 'CNY' }])
    expect(withPlan.map((row) => row.provider)).toEqual(['deepseek'])
    expect(withoutPlan).toEqual(['acme'])
    // 没接入过的厂商永不出现
    expect([...withPlan.map((r) => r.provider), ...withoutPlan]).not.toContain('openai')
  })
})

describe('derive: peak share and projects', () => {
  it('computes the peak share of total cost, null when there is no cost', () => {
    const l = ledger({
      totalCostMicros: 100,
      peakValley: { peakCostMicros: 25, offPeakCostMicros: 60, flatCostMicros: 15, unclassifiedCostMicros: 0, legacyCostMicros: 0, shiftSavingsMicros: 5 },
    })
    expect(peakShare(l)).toBeCloseTo(0.25)
    expect(peakShare(ledger())).toBeNull()
  })

  it('sorts projects by cost and filters their sessions', () => {
    const session = (id: string, workspaceId: string | null, costMicros: number, createdAt: number): FinanceSessionRow => ({
      sessionId: id,
      title: null,
      createdAt,
      workspaceId,
      workspaceTitle: workspaceId,
      taskId: 't',
      modelKeys: ['acme/llm'],
      usage: buckets(0, 0, 0, 0),
      costMicros,
    })
    const l = ledger({
      byWorkspace: [
        { workspaceId: 'w2', title: 'B', sessionCount: 1, usage: buckets(0, 0, 0, 0), costMicros: 5 },
        { workspaceId: 'w1', title: 'A', sessionCount: 2, usage: buckets(0, 0, 0, 0), costMicros: 9 },
      ],
      // s1/s2 同一天（相差 10 分钟），s3 属于未归属工作区的会话。
      sessions: [session('s1', 'w1', 4, 1_700_000_000_000), session('s2', 'w1', 5, 1_700_000_600_000), session('s3', null, 1, 1_700_200_000_000)],
    })
    expect(projectRows(l).map((row) => row.workspaceId)).toEqual(['w1', 'w2'])
    const w1 = sessionsOfWorkspace(l, 'w1')
    expect(w1.map((s) => s.sessionId)).toEqual(['s2', 's1'])
    expect(sessionsOfWorkspace(l, null).map((s) => s.sessionId)).toEqual(['s3'])
    const trend = sessionsTrend(w1)
    expect(trend).toHaveLength(1)
    expect(trend[0].value).toBe(9)
  })
})
