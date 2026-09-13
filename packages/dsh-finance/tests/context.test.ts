import { describe, expect, it } from 'vitest'
import { financeContextProjectionDefinition as context } from '../src/projection.ts'
import { normalizeFinanceConfig, normalizeFinanceTiers } from '../src/pricing.ts'
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
  it('sorts by ceiling and keeps the catch-all last', () => {
    const tiers = normalizeFinanceTiers({
      'a/llm': [
        { maxPromptTokens: 0, inputMicrosPerMtok: 3_000_000, outputMicrosPerMtok: 9_000_000 },
        { maxPromptTokens: 200_000, inputMicrosPerMtok: 2_000_000, outputMicrosPerMtok: 8_000_000 },
        { maxPromptTokens: 32_000, inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 },
      ],
    })
    expect(tiers['a/llm'].map((tier) => tier.maxPromptTokens)).toEqual([32_000, 200_000, 0])
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
    expect(tiers['a/llm'][0].cacheReadMicrosPerMtok).toBe(100_000)
  })

  it('flows into the resolved config', () => {
    const config = normalizeFinanceConfig({
      tiers: { 'a/llm': [{ maxPromptTokens: 32_000, inputMicrosPerMtok: 1, outputMicrosPerMtok: 2 }] },
    })
    expect(config.tiers['a/llm']).toHaveLength(1)
    expect(normalizeFinanceConfig({}).tiers).toEqual({})
  })
})
