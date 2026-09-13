import { describe, expect, it } from 'vitest'
import { financeRateProjectionDefinition as rate } from '../src/projection.ts'

/**
 * `financeRate` 折叠：与平台 `sessionStats` 同一套事件语义（step/start → 首个可见
 * delta → assistant/message），但按模型分桶。这里锁的就是"哪一刻算开始出字、哪些步
 * 不计时"——面板上的 tok/s 与时间成本全靠它。
 */
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0)

const header = (time: number, provider: string, model: string) => ({
  type: 'request/header',
  time,
  data: { header: { config: { provider, model } } },
} as const)

const stepStart = (time: number, turn: number, step: number) => ({
  type: 'step/start',
  time,
  data: { turn, step },
} as const)

const delta = (time: number, turn: number, step: number, text: string, kind: 'text-delta' | 'reasoning-delta' = 'text-delta') => ({
  type: 'assistant/chunk',
  time,
  data: { turn, step, chunk: { type: kind, index: 0, text } },
} as const)

const message = (time: number, turn: number, step: number, outputTokens?: number) => ({
  type: 'assistant/message',
  time,
  data: { turn, step, ...outputTokens === undefined ? {} : { usage: { inputTokens: 10, outputTokens } } },
} as const)

const stepEnd = (time: number, turn: number, step: number) => ({
  type: 'step/end',
  time,
  data: { turn, step },
} as const)

function fold(events: readonly unknown[]) {
  let state = rate.init()
  for (const event of events) state = rate.apply(state, event as never)
  return rate.wire.view(state)
}

describe('financeRate projection', () => {
  it('measures first-token latency and decode throughput per model', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      delta(T0 + 500, 1, 0, ''),
      delta(T0 + 600, 1, 0, 'H'),
      delta(T0 + 700, 1, 0, 'i'),
      message(T0 + 2_000, 1, 0, 100),
    ])
    expect(view.byModel['a/llm']).toEqual({ ttftMs: 600, ttftSteps: 1, decodeMs: 1_400, decodeTokens: 100 })
  })

  it('keeps each model in its own bucket (that is the whole point)', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      delta(T0 + 100, 1, 0, 'x'),
      message(T0 + 1_100, 1, 0, 50),
      header(T0 + 2_000, 'b', 'llm'),
      stepStart(T0 + 2_000, 1, 1),
      delta(T0 + 3_000, 1, 1, 'y'),
      message(T0 + 5_000, 1, 1, 50),
    ])
    expect(view.byModel['a/llm']).toEqual({ ttftMs: 100, ttftSteps: 1, decodeMs: 1_000, decodeTokens: 50 })
    expect(view.byModel['b/llm']).toEqual({ ttftMs: 1_000, ttftSteps: 1, decodeMs: 2_000, decodeTokens: 50 })
  })

  it('starts the clock at the first non-empty delta, not at the empty ones', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      delta(T0 + 100, 1, 0, ''),
      delta(T0 + 800, 1, 0, 'first'),
      message(T0 + 1_800, 1, 0, 10),
    ])
    expect(view.byModel['a/llm']?.ttftMs).toBe(800)
    expect(view.byModel['a/llm']?.decodeMs).toBe(1_000)
  })

  it('counts a reasoning delta as output starting too', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      delta(T0 + 400, 1, 0, 'thinking…', 'reasoning-delta'),
      message(T0 + 1_400, 1, 0, 10),
    ])
    expect(view.byModel['a/llm']?.ttftMs).toBe(400)
  })

  it('adds no timing for a step that never produced visible output', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      message(T0 + 1_000, 1, 0, 50),
    ])
    expect(view.byModel['a/llm']).toBeUndefined()
  })

  it('adds no timing for a cancelled step', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      delta(T0 + 200, 1, 0, 'partial'),
      stepEnd(T0 + 900, 1, 0),
      // 后续消息落在一个新 step 上，不能被算进已取消的那个
      stepStart(T0 + 1_000, 1, 1),
      delta(T0 + 1_100, 1, 1, 'ok'),
      message(T0 + 2_100, 1, 1, 20),
    ])
    expect(view.byModel['a/llm']).toEqual({ ttftMs: 100, ttftSteps: 1, decodeMs: 1_000, decodeTokens: 20 })
  })

  it('ignores chunks from a step that is not the open one', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      delta(T0 + 100, 9, 9, 'stray'),
      message(T0 + 1_000, 1, 0, 10),
    ])
    expect(view.byModel['a/llm']).toBeUndefined()
  })
})
