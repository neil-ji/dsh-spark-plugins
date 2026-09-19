import { describe, expect, it } from 'vitest'
import { financeContextProjectionDefinition as context } from '../src/projection.ts'
import { layerFinanceTiers, normalizeFinanceConfig, normalizeFinanceTiers } from '../src/pricing.ts'
import { FINANCE_CONTEXT_BOUNDARIES } from '../src/types.ts'

/**
 * P2：上下文长度分布（`financeContext`）。它存在的唯一理由是账本其余部分
 * 都把"每一步的 prompt 有多长"聚合掉了，而阶梯价与"拆分会话"必须知道它。
 */
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0)

const header = (time: number, provider: string, model: string) => ({
  type: 'request/header',
  time,
  data: { header: { config: { provider, model } } },
} as const)

const usageMessage = (time: number, turn: number, step: number, usage: Record<string, number>) => ({
  type: 'assistant/message',
  time,
  data: { turn, step, usage },
} as const)

function fold(events: readonly unknown[]) {
  let state = context.init()
  for (const event of events) state = context.apply(state, event as never)
  return context.wire.view(state)
}

/** 找到 prompt 落在某桶（按上界）的那一格。 */
const at = (buckets: readonly { maxPromptTokens: number | null }[], maxPromptTokens: number | null) =>
  buckets.findIndex((entry) => entry.maxPromptTokens === maxPromptTokens)

describe('financeContext projection', () => {
  it('buckets each step by its prompt size', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      // prompt = 100k -> 落在 128k 桶
      usageMessage(T0, 1, 0, { inputTokens: 60_000, cacheReadTokens: 40_000, outputTokens: 10 }),
      // prompt = 500k -> 兜底桶（>1M 才到最后一格；500k 落在 1M 桶）
      usageMessage(T0 + 1_000, 1, 1, { inputTokens: 500_000, outputTokens: 10 }),
      // prompt = 2M -> 无上界桶
      usageMessage(T0 + 2_000, 1, 2, { inputTokens: 2_000_000, outputTokens: 10 }),
    ])
    const buckets = view.byModel['a/llm']
    expect(buckets).toHaveLength(FINANCE_CONTEXT_BOUNDARIES.length + 1)
    expect(buckets[at(buckets, 128_000)].steps).toBe(1)
    expect(buckets[at(buckets, 1_000_000)].steps).toBe(1)
    expect(buckets[at(buckets, null)].steps).toBe(1)
    expect(buckets[at(buckets, 128_000)].usage.uncachedInputTokens).toBe(60_000)
    expect(buckets[at(buckets, 128_000)].usage.cacheReadTokens).toBe(40_000)
  })

  it('counts the same step once (last-wins replacement)', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      usageMessage(T0, 1, 0, { inputTokens: 10_000, outputTokens: 1 }),
      usageMessage(T0 + 500, 1, 0, { inputTokens: 20_000, outputTokens: 2 }),
    ])
    const buckets = view.byModel['a/llm']
    const total = buckets.reduce((sum, bucket) => sum + bucket.steps, 0)
    expect(total).toBe(1)
    const tokens = buckets.reduce((sum, bucket) => sum + bucket.usage.uncachedInputTokens, 0)
    expect(tokens).toBe(20_000)
  })

  it('moves a step between buckets without leaving a duplicate behind', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      usageMessage(T0, 1, 0, { inputTokens: 10_000, outputTokens: 1 }),
      usageMessage(T0 + 500, 1, 0, { inputTokens: 150_000, outputTokens: 1 }),
    ])
    const buckets = view.byModel['a/llm']
    // 桶数组恒为定长（客户端要按任意上界聚合），但被撤销的那一格必须清零
    expect(buckets[at(buckets, 32_000)].steps).toBe(0)
    expect(buckets[at(buckets, 32_000)].usage.uncachedInputTokens).toBe(0)
    expect(buckets[at(buckets, 200_000)].steps).toBe(1)
    expect(buckets.at(-1)?.steps).toBe(0)
    expect(buckets.reduce((sum, bucket) => sum + bucket.steps, 0)).toBe(1)
  })

  it('keeps models apart', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      usageMessage(T0, 1, 0, { inputTokens: 10_000, outputTokens: 1 }),
      header(T0 + 1_000, 'b', 'llm'),
      usageMessage(T0 + 1_000, 2, 0, { inputTokens: 10_000, outputTokens: 1 }),
    ])
    expect(view.byModel['a/llm'].reduce((sum, bucket) => sum + bucket.steps, 0)).toBe(1)
    expect(view.byModel['b/llm'].reduce((sum, bucket) => sum + bucket.steps, 0)).toBe(1)
  })
})

describe('normalizeFinanceTiers', () => {
  it('sorts by ceiling and keeps the catch-all last (legacy bare-array shape)', () => {
    const tiers = normalizeFinanceTiers({
      'a/llm': [
        { maxPromptTokens: 0, inputMicrosPerMtok: 3_000_000, outputMicrosPerMtok: 9_000_000 },
        { maxPromptTokens: 200_000, inputMicrosPerMtok: 2_000_000, outputMicrosPerMtok: 8_000_000 },
        { maxPromptTokens: 32_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 },
      ],
    })
    expect(tiers['a/llm'][0].tiers.map((tier) => tier.maxPromptTokens)).toEqual([32_000, 200_000, 0])
    // 旧形状：隐式 CNY、无折扣 —— 这条断言就是向后兼容的契约。
    expect(tiers['a/llm'][0].currency).toBe('CNY')
    expect(tiers['a/llm'][0].offPeakDiscount).toBe(1)
  })

  it('drops rows it cannot trust and keeps the optional cache rates', () => {
    const tiers = normalizeFinanceTiers({
      'a/llm': [
        { maxPromptTokens: 32_000, inputMicrosPerMtok: Number.NaN, outputMicrosPerMtok: 1 },
        { maxPromptTokens: -1, inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 },
        { maxPromptTokens: 32_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000, cacheReadMicrosPerMtok: 100_000 },
      ],
      'b/llm': [],
    } as never)
    expect(Object.keys(tiers)).toEqual(['a/llm'])
    expect(tiers['a/llm'][0].tiers[0].cacheReadMicrosPerMtok).toBe(100_000)
  })

  it('accepts the new spec shape and keeps currency / discount / era fields', () => {
    const tiers = normalizeFinanceTiers({
      'openai/gpt-5.6#USD': {
        currency: 'USD',
        tiers: [{ maxPromptTokens: 272_000, inputMicrosPerMtok: 1, outputMicrosPerMtok: 2 }],
        offPeakDiscount: 0.5,
        effectiveFrom: '2027-01-01',
        effectiveTo: 1_893_456_000_000,
        region: 'us',
        serviceTier: 'batch',
      },
    })
    // key 带后缀 → 归到剥净后的 modelKey，原始 key 与 suffix 都保留。
    const group = tiers['openai/gpt-5.6'][0]
    expect(group.key).toBe('openai/gpt-5.6#USD')
    expect(group.suffix).toBe('USD')
    expect(group.currency).toBe('USD')
    expect(group.offPeakDiscount).toBe(0.5)
    expect(group.effectiveFrom).toBe(Date.parse('2027-01-01'))
    expect(group.effectiveTo).toBe(1_893_456_000_000)
    expect(group.region).toBe('us')
    expect(group.serviceTier).toBe('batch')
  })

  it('drops an implausible discount and a spec with no usable tiers', () => {
    const tiers = normalizeFinanceTiers({
      'a/llm': { currency: 'CNY', tiers: [], offPeakDiscount: 0 },
      'b/llm': { currency: 'CNY', offPeakDiscount: 2, tiers: [{ maxPromptTokens: 0, inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 }] },
      'c/llm': 'not-an-object',
    } as never)
    // 全坏档的组整组丢弃；0 与 >1 的折扣都不可信，回落成 1（不打折）。
    expect(Object.keys(tiers).sort()).toEqual(['b/llm'])
    expect(tiers['b/llm'][0].offPeakDiscount).toBe(1)
  })

  it('keeps several groups under one modelKey (currency / region variants)', () => {
    const tiers = normalizeFinanceTiers({
      'qwen/qwen3-max': { currency: 'CNY', tiers: [{ maxPromptTokens: 0, inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 }] },
      'qwen/qwen3-max#intl': { currency: 'USD', tiers: [{ maxPromptTokens: 0, inputMicrosPerMtok: 2, outputMicrosPerMtok: 2 }] },
    })
    expect(tiers['qwen/qwen3-max']).toHaveLength(2)
    expect(tiers['qwen/qwen3-max'].map((group) => group.currency)).toEqual(['CNY', 'USD'])
  })

  it('flows into the resolved config', () => {
    const config = normalizeFinanceConfig({
      tiers: { 'a/llm': [{ maxPromptTokens: 32_000, inputMicrosPerMtok: 1, outputMicrosPerMtok: 2 }] },
    })
    expect(config.tiers['a/llm'][0].tiers).toHaveLength(1)
    expect(normalizeFinanceConfig({}).tiers).toEqual({})
  })
})

describe('layerFinanceTiers（INV-1 单一结构源）', () => {
  const spec = (input: number) => ({
    currency: 'CNY',
    tiers: [{ maxPromptTokens: 128_000, inputMicrosPerMtok: input, outputMicrosPerMtok: input * 4 }],
  })

  it('releaseBase 优先；被取代的手填键必须报出来（不许静默忽略用户输入）', () => {
    const layered = layerFinanceTiers({ 'a/llm': spec(1_000_000) }, { 'a/llm': spec(9_999_999) })
    expect(layered.tiers['a/llm']).toEqual(spec(1_000_000))
    expect(layered.shadowedKeys).toEqual(['a/llm'])
  })

  it('手填只补官方表没有的 key（legacy 兼容）', () => {
    const layered = layerFinanceTiers({ 'a/llm': spec(1) }, { 'b/llm': spec(2) })
    expect(Object.keys(layered.tiers).sort()).toEqual(['a/llm', 'b/llm'])
    expect(layered.shadowedKeys).toEqual([])
  })

  it('releaseBase 缺失时手填全部生效（未迁版宿主仍可用）', () => {
    expect(layerFinanceTiers(undefined, { 'a/llm': spec(5) }).tiers['a/llm']).toEqual(spec(5))
    expect(layerFinanceTiers({}, undefined).tiers).toEqual({})
  })

  it('分层只做"谁覆盖谁"：形状校验仍归 normalizeFinanceTiers（不越权）', () => {
    const layered = layerFinanceTiers({ 'a/llm': spec(1) }, {})
    const normalized = normalizeFinanceTiers(layered.tiers)
    expect(normalized['a/llm'][0].tiers[0].inputMicrosPerMtok).toBe(1)
  })
})
