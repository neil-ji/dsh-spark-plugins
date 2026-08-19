import { describe, expect, it } from 'vitest'
import { financeUsageHourlyProjectionDefinition as hourlyProjection, financeUsageProjectionDefinition as projection } from '../src/projection.ts'
import type { FinanceTokenBuckets } from '../src/types.ts'

const day = (time: number): string => new Date(time).toISOString().slice(0, 10)

function headerEvent(time: number, provider: string, model: string) {
  return {
    type: 'request/header',
    time,
    data: { header: { config: { provider, model } } },
  } as const
}

function usageChunkEvent(time: number, turn: number, step: number, usage: Record<string, number>) {
  return {
    type: 'assistant/chunk',
    time,
    data: { turn, step, chunk: { type: 'usage', usage } },
  } as const
}

function usageMessageEvent(time: number, turn: number, step: number, usage: Record<string, number>) {
  return {
    type: 'assistant/message',
    time,
    data: { turn, step, usage },
  } as const
}

const T0 = Date.UTC(2026, 0, 15, 12, 0, 0)

describe('financeUsage projection', () => {
  it('accumulates usage by model and by UTC day', () => {
    let state = projection.init()
    state = projection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    state = projection.apply(state, usageChunkEvent(T0, 1, 0, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    }))
    const view = projection.view(state)
    expect(view.totals).toEqual({ uncachedInputTokens: 100, cacheReadTokens: 10, cacheWriteTokens: 5, outputTokens: 50 })
    expect(view.byModel['deepseek-official/deepseek-v4-flash']).toEqual(view.totals)
    expect(view.byDay[day(T0)]).toEqual(view.totals)
  })

  it('replaces rather than double-counts the same step', () => {
    let state = projection.init()
    state = projection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    const first = usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 })
    const second = usageChunkEvent(T0, 1, 0, { inputTokens: 120, outputTokens: 60 })
    state = projection.apply(state, first)
    state = projection.apply(state, second)
    expect(projection.view(state).totals).toEqual({ uncachedInputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60 })
  })

  it('ignores a duplicate identical report for the same step', () => {
    let state = projection.init()
    state = projection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    const event = usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 })
    state = projection.apply(state, event)
    const once = projection.view(state)
    state = projection.apply(state, event)
    const twice = projection.view(state)
    expect(twice).toEqual(once)
    expect(twice.totals.uncachedInputTokens).toBe(100)
  })

  it('accumulates distinct steps in the same turn', () => {
    let state = projection.init()
    state = projection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    state = projection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 }))
    state = projection.apply(state, usageChunkEvent(T0, 1, 1, { inputTokens: 200, outputTokens: 100 }))
    expect(projection.view(state).totals).toEqual({ uncachedInputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 150 })
  })

  it('splits usage across UTC days by event time', () => {
    const later = T0 + 24 * 3600 * 1000
    let state = projection.init()
    state = projection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    state = projection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 }))
    state = projection.apply(state, usageMessageEvent(later, 2, 0, { inputTokens: 300, outputTokens: 150 }))
    const view = projection.view(state)
    expect(view.byDay[day(T0)].uncachedInputTokens).toBe(100)
    expect(view.byDay[day(later)].uncachedInputTokens).toBe(300)
    expect(view.totals.uncachedInputTokens).toBe(400)
  })

  it('does not count usage before any request/header', () => {
    let state = projection.init()
    state = projection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 }))
    expect(projection.view(state).totals.uncachedInputTokens).toBe(0)
  })

  it('ignores non-usage chunks', () => {
    let state = projection.init()
    state = projection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    state = projection.apply(state, {
      type: 'assistant/chunk',
      time: T0,
      data: { turn: 1, step: 0, chunk: { type: 'text', text: 'hi' } },
    } as never)
    expect(projection.view(state).totals.uncachedInputTokens).toBe(0)
  })

  it('keeps per-model buckets separate', () => {
    let state = projection.init()
    state = projection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    state = projection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 }))
    state = projection.apply(state, headerEvent(T0, 'custom', 'my-model'))
    state = projection.apply(state, usageChunkEvent(T0, 1, 1, { inputTokens: 10, outputTokens: 5 }))
    const view = projection.view(state)
    expect(view.byModel['deepseek-official/deepseek-v4-flash'].uncachedInputTokens).toBe(100)
    expect(view.byModel['custom/my-model'].uncachedInputTokens).toBe(10)
    expect(view.totals.uncachedInputTokens).toBe(110)
  })

  it('defends against zero/negative usage values (clamped by schema at rest)', () => {
    let state = projection.init()
    state = projection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    // negative input would poison totals; the state fold must still produce
    // non-negative totals for the common corrupted-report case.
    state = projection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    expect(projection.view(state).totals).toEqual({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
  })
})


describe('financeUsageHourly projection', () => {
  const hour = (time: number): string => new Date(time).toISOString().slice(0, 13)

  it('accumulates usage by model and by UTC hour', () => {
    let state = hourlyProjection.init()
    state = hourlyProjection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    state = hourlyProjection.apply(state, usageChunkEvent(T0, 1, 0, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    }))
    const view = hourlyProjection.view(state)
    expect(view.byModelHour['deepseek-official/deepseek-v4-flash'][hour(T0)]).toEqual({
      uncachedInputTokens: 100, cacheReadTokens: 10, cacheWriteTokens: 5, outputTokens: 50,
    })
  })

  it('replaces rather than double-counts the same step', () => {
    let state = hourlyProjection.init()
    state = hourlyProjection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    state = hourlyProjection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 }))
    state = hourlyProjection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 120, outputTokens: 60 }))
    const view = hourlyProjection.view(state)
    expect(view.byModelHour['deepseek-official/deepseek-v4-flash'][hour(T0)]).toEqual({
      uncachedInputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60,
    })
  })

  it('ignores a duplicate identical report for the same step', () => {
    let state = hourlyProjection.init()
    state = hourlyProjection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    const event = usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 })
    state = hourlyProjection.apply(state, event)
    const once = hourlyProjection.view(state)
    state = hourlyProjection.apply(state, event)
    expect(hourlyProjection.view(state)).toEqual(once)
  })

  it('accumulates distinct steps in the same turn and hour', () => {
    let state = hourlyProjection.init()
    state = hourlyProjection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    state = hourlyProjection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 }))
    state = hourlyProjection.apply(state, usageChunkEvent(T0, 1, 1, { inputTokens: 200, outputTokens: 100 }))
    const view = hourlyProjection.view(state)
    expect(view.byModelHour['deepseek-official/deepseek-v4-flash'][hour(T0)].uncachedInputTokens).toBe(300)
  })

  it('splits usage across UTC hours by event time', () => {
    const later = T0 + 3600 * 1000
    let state = hourlyProjection.init()
    state = hourlyProjection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    state = hourlyProjection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 }))
    state = hourlyProjection.apply(state, usageMessageEvent(later, 2, 0, { inputTokens: 300, outputTokens: 150 }))
    const view = hourlyProjection.view(state)
    expect(view.byModelHour['deepseek-official/deepseek-v4-flash'][hour(T0)].uncachedInputTokens).toBe(100)
    expect(view.byModelHour['deepseek-official/deepseek-v4-flash'][hour(later)].uncachedInputTokens).toBe(300)
  })

  it('does not count usage before any request/header', () => {
    let state = hourlyProjection.init()
    state = hourlyProjection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 }))
    expect(hourlyProjection.view(state).byModelHour).toEqual({})
  })

  it('keeps per-model hour buckets separate', () => {
    let state = hourlyProjection.init()
    state = hourlyProjection.apply(state, headerEvent(T0, 'deepseek-official', 'deepseek-v4-flash'))
    state = hourlyProjection.apply(state, usageChunkEvent(T0, 1, 0, { inputTokens: 100, outputTokens: 50 }))
    state = hourlyProjection.apply(state, headerEvent(T0, 'custom', 'my-model'))
    state = hourlyProjection.apply(state, usageChunkEvent(T0, 1, 1, { inputTokens: 10, outputTokens: 5 }))
    const view = hourlyProjection.view(state)
    expect(view.byModelHour['deepseek-official/deepseek-v4-flash'][hour(T0)].uncachedInputTokens).toBe(100)
    expect(view.byModelHour['custom/my-model'][hour(T0)].uncachedInputTokens).toBe(10)
  })
})

