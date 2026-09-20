import { describe, expect, it } from 'vitest'
import type { FinanceLedger, FinanceSessionRow, FinanceTokenBuckets } from 'dsh-spark-finance/types'
import {
  balanceDaysLeft,
  cacheExtremes,
  contextProfile,
  splitEstimate,
  tierForBucket,
  usageCostMicros,
  cheapestInGroup,
  compareMetricRows,
  formatGapRatio,
  dailyAverageMicros,
  effectiveInputTokens,
  estimateCacheSavings,
  firstTokenMs,
  formatPercent,
  formatSpeed,
  formatTokens,
  groupByModel,
  hitRate,
  outputTokensPerSecond,
  speedComparison,
  mixedUnitCostMicros,
  modelComparisonRows,
  peakShare,
  planInsight,
  planRows,
  projectCostRows,
  projectRows,
  providerCostMicros,
  providerDailyMicros,
  sessionsOfWorkspace,
  relativeTime,
  sessionsTrend,
  resolveCacheReadMicros,
  resolveCacheWriteMicros,
  splitEstimateForModel,
  tierGroupFor,
  tierGroupUsability,
  totalTokens,
} from '../src/client/derive.ts'
import type { FinanceTierGroup } from 'dsh-spark-finance/types'
import type { ModelComparisonRow } from '../src/client/derive.ts'

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

  it('mixed unit cost is micros per million BILLABLE tokens (cache-read excluded)', () => {
    // 分母 = 未命中输入 + 缓存写 + 输出 = 1.1M tok；缓存读 900K 不摊入
    expect(mixedUnitCostMicros(2_000_000, buckets(1_000_000, 900_000, 0, 100_000))).toBeCloseTo(1_818_181.8, 0)
    expect(mixedUnitCostMicros(2_000_000, buckets(1_000_000, 0, 0, 1_000_000))).toBeCloseTo(1_000_000)
    expect(mixedUnitCostMicros(10, buckets(0, 900_000, 0, 0))).toBeNull()
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
    // 按模型名分组（provider/model 里的 model 段）——这样同一模型的两家供应商才会落进同一组
    expect(groups.map((g) => g.model)).toEqual(['llm', 'other'])
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
      // 单位成本分母已改为计费 token（未命中输入+缓存写+输出）：pricey 2.1M、cheap 1.1M
      const unitGap = (pricey.costMicros / (2_100_000 / 1_000_000)) - (cheap.costMicros / (1_100_000 / 1_000_000))
      // 省额 = 单位成本差 × 高成本侧输入侧 token（2M 未命中 + 200K 缓存读 = 2.2M）
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
    expect(mapped[0].unitCostMicros).toBeCloseTo(cheap.costMicros / 1.1)
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

describe('derive: 上下文分布与阶梯价（P2）', () => {
  const bucket = (maxPromptTokens: number | null, usage: FinanceTokenBuckets, steps: number) => ({ maxPromptTokens, usage, steps })
  const buckets1: ReturnType<typeof bucket>[] = [
    bucket(32_000, buckets(400_000, 100_000, 0, 30_000), 20),
    bucket(128_000, buckets(200_000, 300_000, 0, 20_000), 10),
    bucket(200_000, buckets(0, 0, 0, 0), 0),
    bucket(1_000_000, buckets(100_000, 50_000, 0, 10_000), 5),
    bucket(null, buckets(0, 0, 0, 0), 0),
  ]
  const tiers = [
    { maxPromptTokens: 128_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 },
    { maxPromptTokens: 0, inputMicrosPerMtok: 2_000_000, outputMicrosPerMtok: 8_000_000 },
  ]

  it('splits usage at a context ceiling, conservatively', () => {
    const profile = contextProfile(buckets1, 128_000)
    // <= 128k 的两桶进界内
    expect(profile.atOrBelow.uncachedInputTokens).toBe(600_000)
    expect(profile.steps).toBe(35)
    // 1M 桶整体算界外（宁可少算省额）
    expect(profile.above.uncachedInputTokens).toBe(100_000)
    expect(profile.stepsAbove).toBe(5)
    // 界内输入 1_000_000（600k 未缓存 + 400k 缓存读），界外 150_000 → 150k/1_150k
    expect(profile.shareAbove).toBeCloseTo(150_000 / 1_150_000)
  })

  it('prices a tier by the bucket upper bound', () => {
    expect(tierForBucket(buckets1[2], tiers)?.maxPromptTokens).toBe(0)      // 200k 桶 -> 兜底档
    expect(tierForBucket(buckets1[1], tiers)?.maxPromptTokens).toBe(128_000) // 128k 桶 -> 128k 档
    expect(tierForBucket(buckets1[4], tiers)?.maxPromptTokens).toBe(0)       // 无上界 -> 兜底档
    expect(usageCostMicros(buckets(1_000_000, 0, 0, 1_000_000), tiers[0])).toBe(5_000_000)
    // 缓存读写缺省时按输入价算
    expect(usageCostMicros(buckets(0, 1_000_000, 1_000_000, 0), tiers[0])).toBe(2_000_000)
  })

  it('estimates the ceiling saving of compressing every step into the smallest tier', () => {
    const estimate = splitEstimate(buckets1, tiers)
    expect(estimate).not.toBeNull()
    if (estimate !== null) {
      expect(estimate.smallestCeiling).toBe(128_000)
      // 观测：32k 桶按 128k 档 400k 输入@1 + 100k 缓存读@1 + 30k 输出@4 = 620k；
      //        128k 桶按 128k 档 200k@1 + 300k@1 + 20k@4 = 580k；1M 桶按兜底档 100k@2 + 50k@2 + 10k@8 = 380k
      expect(estimate.observedMicros).toBeCloseTo(1_580_000)
      // 全部压进 128k 档：1_150k 输入@1 + 60k 输出@4 = 1_390_000
      expect(estimate.compressedMicros).toBeCloseTo(1_390_000)
      expect(estimate.savedMicros).toBeCloseTo(190_000)
    }
  })

  it('says nothing without tier prices or without a smallest tier', () => {
    expect(splitEstimate(buckets1, [])).toBeNull()
    expect(splitEstimate([], tiers)).toBeNull()
    expect(splitEstimate(buckets1, [{ maxPromptTokens: 0, inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 }])).toBeNull()
    expect(splitEstimate([bucket(32_000, buckets(0, 0, 0, 0), 0)], tiers)).toBeNull()
  })

  it('prices a tier by the whole request, not by segments (SPEC §2.3 规则 7)', () => {
    // 落在 128k 档的桶：**全部** token 按 128k 档算，不是"前 32k 便宜、超出部分贵"。
    // 这条断言锁死「全量按所在档」；改成分段累计会立刻红。
    const entry = { maxPromptTokens: 128_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 }
    const usage = buckets(100_000, 0, 0, 0)
    expect(usageCostMicros(usage, entry)).toBeCloseTo(100_000)
    // 若误按分段累计（32k@便宜档 + 68k@贵档）会得到别的数——这里直接比对全量口径。
    const segmented = 32_000 * 1 + 68_000 * 2
    expect(usageCostMicros(usage, entry)).not.toBeCloseTo(segmented)
  })

  it('resolves cache prices: absolute > multiplier × input > TTL m5 > input (SPEC §2.3 规则 1–2)', () => {
    const base = { maxPromptTokens: 32_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 }
    // 都没有 → 继承输入价。
    expect(resolveCacheReadMicros(base)).toBe(1_000_000)
    expect(resolveCacheWriteMicros(base)).toBe(1_000_000)
    // 倍率生效（Anthropic 读 0.1x）。
    expect(resolveCacheReadMicros({ ...base, cacheReadMultiplier: 0.1 })).toBeCloseTo(100_000)
    // 绝对价压过倍率。
    expect(resolveCacheReadMicros({ ...base, cacheReadMultiplier: 0.1, cacheReadMicrosPerMtok: 7 })).toBe(7)
    // 写：倍率 > TTL m5。
    expect(resolveCacheWriteMicros({ ...base, cacheWriteMultiplier: 2, cacheWriteTtl: { m5: 3 } })).toBe(2_000_000)
    // 写：只有 TTL 时取 m5（保守），不取 h1。
    expect(resolveCacheWriteMicros({ ...base, cacheWriteTtl: { m5: 20, h1: 40 } })).toBe(20)
  })

  it('resolves the unique group for a modelKey, and falls back across the # suffix (规则 3)', () => {
    const groups: Record<string, readonly FinanceTierGroup[]> = {
      'openai/gpt-5.6': [group('openai/gpt-5.6', 'CNY')],
      'openai/gpt-5.6#USD': [group('openai/gpt-5.6#USD', 'USD', 'USD')],
    }
    // 精确命中（配置侧可能带后缀）
    expect(tierGroupFor(groups, 'openai/gpt-5.6#USD')).toEqual({ status: 'found', group: groups['openai/gpt-5.6#USD']![0] })
    // 运行期真实形态：provider/model 永不带 #，按剥净后的 modelKey 找
    expect(tierGroupFor(groups, 'openai/gpt-5.6')).toEqual({ status: 'found', group: groups['openai/gpt-5.6']![0] })
    // 带后缀但该后缀没登记 → 剥后缀回退
    expect(tierGroupFor(groups, 'openai/gpt-5.6#intl')).toEqual({ status: 'found', group: groups['openai/gpt-5.6']![0] })
    expect(tierGroupFor(groups, 'nobody/else')).toEqual({ status: 'none' })
  })

  it('同一 modelKey 下有多个变体组时报 ambiguous，而不是"取第一组"（暂不区分国际/国内）', () => {
    // 这是关键回归线：旧实现按写入顺序取第一组，等于让 settings 的书写顺序决定用哪套价，
    // 界面上完全看不出异常。现在必须显式拒绝。
    const groups: Record<string, readonly FinanceTierGroup[]> = {
      'qwen/qwen3-max': [group('qwen/qwen3-max#intl', 'CNY', 'intl'), group('qwen/qwen3-max', 'CNY')],
    }
    expect(tierGroupFor(groups, 'qwen/qwen3-max')).toEqual({
      status: 'ambiguous',
      keys: ['qwen/qwen3-max#intl', 'qwen/qwen3-max'],
    })
  })

  it('refuses to price a group in another currency or outside its era (规则 5)', () => {
    const at = Date.parse('2026-09-19')
    expect(tierGroupUsability(group('a/b', 'CNY'), 'CNY', at)).toBe('usable')
    // 币种大小写/空白不敏感，但不同币种一律拒绝（禁止硬换汇）。
    expect(tierGroupUsability(group('a/b', 'usd'), 'USD', at)).toBe('usable')
    expect(tierGroupUsability(group('a/b', 'USD'), 'CNY', at)).toBe('currency-mismatch')
    // 生效窗口。
    expect(tierGroupUsability({ ...group('a/b', 'CNY'), effectiveFrom: at + 1 }, 'CNY', at)).toBe('era-mismatch')
    expect(tierGroupUsability({ ...group('a/b', 'CNY'), effectiveTo: at - 1 }, 'CNY', at)).toBe('era-mismatch')
    expect(tierGroupUsability({ ...group('a/b', 'CNY'), effectiveFrom: at - 1, effectiveTo: at + 1 }, 'CNY', at)).toBe('usable')
  })

  it('scales both sides by the off-peak discount so the ratio is unchanged (规则 6)', () => {
    const full = splitEstimate(buckets1, tiers)
    const half = splitEstimate(buckets1, tiers, { offPeakDiscount: 0.5 })
    expect(full).not.toBeNull()
    expect(half).not.toBeNull()
    if (full !== null && half !== null) {
      expect(half.savedMicros).toBeCloseTo(full.savedMicros * 0.5)
      expect(half.discountApplied).toBe(0.5)
      // 比例不变：省额 ÷ 观测成本 两侧一致。
      expect(half.savedMicros / half.observedMicros).toBeCloseTo(full.savedMicros / full.observedMicros)
      // 不可信的折扣（0 / >1）回落成 1，不静默打折。
      expect(splitEstimate(buckets1, tiers, { offPeakDiscount: 0 })?.discountApplied).toBe(1)
      expect(splitEstimate(buckets1, tiers, { offPeakDiscount: 2 })?.discountApplied).toBe(1)
    }
  })

  it('reports why a model has no estimate instead of collapsing every reason into one', () => {
    const groups: Record<string, readonly FinanceTierGroup[]> = { 'a/llm': [group('a/llm', 'CNY')] }
    expect(splitEstimateForModel(buckets1, groups, 'a/llm', 'CNY', Date.now()).status).toBe('ok')
    expect(splitEstimateForModel(buckets1, {}, 'a/llm', 'CNY', Date.now()).status).toBe('no-tiers')
    expect(splitEstimateForModel(buckets1, { 'a/llm': [group('a/llm', 'USD')] }, 'a/llm', 'CNY', Date.now()))
      .toEqual({ status: 'currency-mismatch', tierCurrency: 'USD' })
    expect(splitEstimateForModel(buckets1, { 'a/llm': [{ ...group('a/llm', 'CNY'), effectiveTo: 1 }] }, 'a/llm', 'CNY', Date.now()).status)
      .toBe('era-mismatch')
    expect(splitEstimateForModel([], groups, 'a/llm', 'CNY', Date.now()).status).toBe('no-usage')
  })
})

/** 造一组最简阶梯价分组（一档 128k），只关心组级字段时用它。 */
function group(key: string, currency: string, suffix?: string): FinanceTierGroup {
  return {
    key,
    modelKey: suffix === undefined ? key : key.slice(0, key.lastIndexOf('#')),
    ...suffix !== undefined ? { suffix } : {},
    currency,
    offPeakDiscount: 1,
    tiers: [{ maxPromptTokens: 128_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 }],
  }
}

describe('derive: 速率与时间成本', () => {
  const fast = { modelKey: 'acme/llm', provider: 'a', model: 'llm', usage: buckets(1_000_000, 0, 0, 100_000), costMicros: 10_000_000 }
  const slow = { modelKey: 'acme/llm', provider: 'b', model: 'llm', usage: buckets(1_000_000, 0, 0, 100_000), costMicros: 10_000_000 }
  const withRate = (row: typeof fast, speed: number, ms = 600_000) => ({
    ...row,
    hitRate: null,
    unitCostMicros: mixedUnitCostMicros(row.costMicros, row.usage),
    rate: { decodeMs: ms, decodeTokens: Math.round(speed * (ms / 1000)), ttftMs: 12_000, ttftSteps: 40 },
  })

  it('derives tok/s from decode tokens over decode wall time', () => {
    const row = withRate(fast, 50)
    expect(outputTokensPerSecond(row.rate)).toBeCloseTo(50)
    expect(outputTokensPerSecond(undefined)).toBeNull()
    expect(outputTokensPerSecond({ decodeMs: 0, decodeTokens: 10, ttftMs: 0, ttftSteps: 0 })).toBeNull()
    expect(formatSpeed(50)).toBe('50.0')
    expect(formatSpeed(null)).toBe('—')
  })

  it('averages first-token latency over the steps that carried one', () => {
    expect(firstTokenMs({ decodeMs: 1, decodeTokens: 1, ttftMs: 30_000, ttftSteps: 40 })).toBeCloseTo(750)
    expect(firstTokenMs({ decodeMs: 1, decodeTokens: 1, ttftMs: 0, ttftSteps: 0 })).toBeNull()
  })

  it('compares the same model across vendors in minutes, and stays quiet otherwise', () => {
    const rows = [withRate(fast, 60), withRate(slow, 20)]
    const comparison = speedComparison(rows)
    expect(comparison).not.toBeNull()
    if (comparison !== null) {
      expect(comparison.fastest.provider).toBe('a')
      expect(comparison.slowest.provider).toBe('b')
      expect(comparison.tokens).toBe(12_000)
      expect(comparison.slowestMinutes).toBeCloseTo(10)
      expect(comparison.atFastestMinutes).toBeCloseTo(10 / 3)
      expect(comparison.savedMinutes).toBeCloseTo(10 - 10 / 3)
    }
    // 跨模型不比
    const cross = [withRate(fast, 60), withRate({ ...slow, modelKey: 'acme/other', model: 'other' }, 20)]
    expect(speedComparison(cross)).toBeNull()
    // 差距 <1% 不给结论
    expect(speedComparison([withRate(fast, 60), withRate(slow, 60)])).toBeNull()
    // 缺速率样本不给结论
    expect(speedComparison([fast, slow].map((row) => ({ ...row, hitRate: null, unitCostMicros: null })))).toBeNull()
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

  it('账本记 deepseek-official、套餐写 deepseek 也要配得上（反方向同理）', () => {
    const official = ledger({
      byProvider: [
        { provider: 'deepseek-official', usage: buckets(1_000_000, 0, 0, 0), costMicros: 12_000_000, modelCount: 1 },
      ],
    })
    expect(planInsight({ provider: 'deepseek', monthlyMicros: 1, currency: 'CNY' }, official).equivalentMicros)
      .toBe(12_000_000)
    expect(providerCostMicros(official, 'deepseek-official')).toBe(12_000_000)
  })

  it('provider 比对键大小写不敏感（手写 DeepSeek-Official 也要认成 deepseek）', () => {
    // 值要对上账本的 deepseek 行；标签保留用户自己写的那串（显示层不做改写）。
    const insight = planInsight({ provider: 'DeepSeek-Official', monthlyMicros: 1, currency: 'CNY' }, l)
    expect(insight.equivalentMicros).toBe(30_000_000)
    const { withPlan, withoutPlan } = planRows(l, [{ provider: 'DeepSeek-Official', monthlyMicros: 1, currency: 'CNY' }])
    expect(withPlan).toHaveLength(1)
    expect(withoutPlan).toEqual(['acme'])
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

describe('derive: 项目账订阅估价（周费按用量占比分摊）', () => {
  // 2026-03-15（3 月 31 天 → ceil(31/7)=5 周；15 号 → weekIdx = floor(14/7) = 2）
  const T = new Date(2026, 2, 15, 12).getTime()
  const session = (sessionId: string, workspaceId: string, modelKeys: string[], costMicros: number, output = 400): FinanceSessionRow => ({
    sessionId,
    title: sessionId,
    createdAt: T,
    workspaceId,
    workspaceTitle: workspaceId,
    taskId: 't',
    modelKeys,
    usage: buckets(1_000, 0, 0, output),
    costMicros,
  })
  const ledger = {
    currency: 'CNY',
    byWorkspace: [
      { workspaceId: 'w1', title: 'Alpha', sessionCount: 1, usage: buckets(1_000, 0, 0, 400), costMicros: 3_000_000 },
      { workspaceId: 'w2', title: 'Beta', sessionCount: 2, usage: buckets(6_000, 0, 0, 800), costMicros: 6_000_000 },
    ],
    sessions: [
      session('s1', 'w1', ['deepseek/m1'], 3_000_000),
      session('s2', 'w2', ['deepseek-official/m2'], 1_000_000),
      session('s3', 'w2', ['acme/m3'], 5_000_000),
    ],
    byModel: [
      { modelKey: 'deepseek/m1', provider: 'deepseek', model: 'm1', usage: buckets(1_000, 0, 0, 400), costMicros: 3_000_000, rate: { decodeMs: 60_000, decodeTokens: 1_200, ttftMs: 0, ttftSteps: 0 } },
    ],
  } as unknown as FinanceLedger
  const plans = [{ provider: 'deepseek-official', monthlyMicros: 10_000_000, currency: 'CNY', effectiveFrom: 0 }]

  it('订阅估价 = 周费 × 项目当周按量等价占比；按量厂商走现金口径', () => {
    const rows = projectCostRows(ledger, plans)
    const alpha = rows.find((row) => row.workspaceId === 'w1')!
    const beta = rows.find((row) => row.workspaceId === 'w2')!
    // 周费 = 10_000_000 ÷ 5 = 2_000_000；当周分母 = 3_000_000 + 1_000_000 = 4_000_000
    // Alpha 订阅估价 = 3/4 × 2_000_000 = 1_500_000，按量 0
    expect(alpha.planEstimateMicros).toBe(1_500_000)
    expect(alpha.meteredMicros).toBe(0)
    expect(alpha.totalMicros).toBe(1_500_000)
    // Beta 订阅估价 = 1/4 × 2_000_000 = 500_000；acme 是按量现金 5_000_000
    expect(beta.planEstimateMicros).toBe(500_000)
    expect(beta.meteredMicros).toBe(5_000_000)
    expect(beta.totalMicros).toBe(5_500_000)
  })

  it('总 token 与总耗时（速率推算）随行给出', () => {
    const rows = projectCostRows(ledger, plans)
    const alpha = rows.find((row) => row.workspaceId === 'w1')!
    expect(alpha.totalTokens).toBe(1_400)
    // 400 output × (60_000ms / 1_200tok) = 20_000ms = 20s
    expect(alpha.durationSeconds).toBe(20)
  })

  it('没有套餐时不产生订阅估价，全部走按量；没有速率样本时耗时为 null', () => {
    const rows = projectCostRows(ledger, [])
    for (const row of rows) {
      expect(row.planEstimateMicros).toBe(0)
    }
    const beta = rows.find((row) => row.workspaceId === 'w2')!
    expect(beta.totalMicros).toBe(6_000_000)

    const withoutRate = {
      ...ledger,
      byModel: (ledger.byModel as FinanceLedger['byModel']).map(({ rate: _rate, ...row }) => row),
    } as FinanceLedger
    for (const row of projectCostRows(withoutRate, plans)) {
      expect(row.durationSeconds).toBeNull()
    }
  })
})

describe('derive: token 计数格式化', () => {
  it('K=1000 / M=1e6，最多 1 位小数并去尾零', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_000)).toBe('1K')
    expect(formatTokens(101_746)).toBe('101.7K')
    expect(formatTokens(1_024_000)).toBe('1M')
    expect(formatTokens(1_500_000)).toBe('1.5M')
  })
})

describe('derive: relativeTime（人类易读相对时间）', () => {
  const t = ((key: string, params?: Record<string, number>) => `${key}:${params?.n}`) as never
  it('秒→分→时→天→月逐级换算，不再出现「0 分钟前」', () => {
    expect(relativeTime(Date.now() - 5_000, t)).toBe('timeSeconds:5')
    expect(relativeTime(Date.now() - 120_000, t)).toBe('timeMinutes:2')
    expect(relativeTime(Date.now() - 7 * 3_600_000, t)).toBe('timeHours:7')
    expect(relativeTime(Date.now() - 2 * 86_400_000, t)).toBe('timeDays:2')
    expect(relativeTime(Date.now() - 45 * 86_400_000, t)).toBe('timeMonths:1')
  })
})

/**
 * 转置对比（2026-09-20）：每行一个指标、每列一个供应商；每行取最优，
 * 其余格给出与最优的有符号相对差。
 *
 * 这些断言锁的是**数学**，不是排版：最优方向（单位成本/延迟取最小、命中率/速率
 * 取最大）、相对差的符号与量级、以及两条"宁可不算"的边界（单供应商、最优值为 0）。
 */
describe('compareMetricRows', () => {
  const row = (provider: string, over: Partial<ModelComparisonRow> = {}): ModelComparisonRow => ({
    modelKey: `p/${provider}`,
    provider,
    model: 'llm',
    costMicros: 1_000_000,
    usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 },
    hitRate: 0.5,
    unitCostMicros: 1_000_000,
    billingMode: 'metered',
    ...over,
  })

  it('marks the cheapest vendor best on unit cost and reports the signed gap', () => {
    const rows = [
      row('a', { unitCostMicros: 1_000_000 }),
      row('b', { unitCostMicros: 1_500_000 }),
    ]
    const unitCost = compareMetricRows(rows).find((m) => m.metric === 'unitCost')!
    expect(unitCost.direction).toBe('lower-better')
    expect(unitCost.cells.map((c) => c.best)).toEqual([true, false])
    // (1.5M − 1.0M) / 1.0M = +50%
    expect(unitCost.cells[1].gapRatio).toBeCloseTo(0.5, 6)
    expect(formatGapRatio(unitCost.cells[1].gapRatio)).toBe('+50.0%')
  })

  it('marks the fastest vendor best on speed (higher is better)', () => {
    const rows = [
      row('a', { rate: { decodeMs: 1_000, decodeTokens: 100, ttftMs: 100, ttftSteps: 1 } }),
      row('b', { rate: { decodeMs: 1_000, decodeTokens: 50, ttftMs: 100, ttftSteps: 1 } }),
    ]
    const speed = compareMetricRows(rows).find((m) => m.metric === 'speed')!
    expect(speed.direction).toBe('higher-better')
    // a = 100 tok/s 是最优；b = 50 tok/s，与最优差 (50−100)/100 = −50%
    expect(speed.cells[0].best).toBe(true)
    expect(speed.cells[1].gapRatio).toBeCloseTo(-0.5, 6)
    expect(formatGapRatio(speed.cells[1].gapRatio)).toBe('−50.0%')
  })

  it('marks the lowest first-token latency best (lower is better)', () => {
    const rows = [
      row('a', { rate: { decodeMs: 1_000, decodeTokens: 100, ttftMs: 200, ttftSteps: 1 } }),
      row('b', { rate: { decodeMs: 1_000, decodeTokens: 100, ttftMs: 400, ttftSteps: 1 } }),
    ]
    const ttft = compareMetricRows(rows).find((m) => m.metric === 'ttft')!
    expect(ttft.cells[0].best).toBe(true)
    expect(ttft.cells[1].gapRatio).toBeCloseTo(1, 6) // 400 vs 200 -> +100%
  })

  it('never ranks total cost (it tracks usage volume, not quality)', () => {
    const rows = [
      row('a', { costMicros: 10_000_000 }),
      row('b', { costMicros: 1_000_000 }),
    ]
    const cost = compareMetricRows(rows).find((m) => m.metric === 'cost')!
    expect(cost.direction).toBe('neutral')
    expect(cost.hasBest).toBe(false)
    expect(cost.cells.every((c) => c.best === false && c.gapRatio === null)).toBe(true)
  })

  it('refuses to rank with a single vendor or a zero best value', () => {
    const single = compareMetricRows([row('a')])
    expect(single.every((m) => m.hasBest === false)).toBe(true)

    // 最优值为 0 时放弃判定（否则相对差是 ∞%）。
    const zeroBest = compareMetricRows([
      row('a', { unitCostMicros: 0 }),
      row('b', { unitCostMicros: 1_000_000 }),
    ]).find((m) => m.metric === 'unitCost')!
    expect(zeroBest.hasBest).toBe(false)
  })

  it('skips cells without data instead of treating them as zero', () => {
    const rows = [
      row('a', { unitCostMicros: 1_000_000 }),
      row('b', { unitCostMicros: null }),
    ]
    const unitCost = compareMetricRows(rows).find((m) => m.metric === 'unitCost')!
    expect(unitCost.cells[1].value).toBeNull()
    expect(unitCost.cells[1].gapRatio).toBeNull()
    // 只有一家有数据 -> 不判最优。
    expect(unitCost.hasBest).toBe(false)
  })

  it('formats the zero gap without a sign', () => {
    expect(formatGapRatio(0)).toBe('0%')
    expect(formatGapRatio(null)).toBe('—')
  })
})
