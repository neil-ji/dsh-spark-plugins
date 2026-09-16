import { describe, expect, it } from 'vitest'
import { financeRateProjectionDefinition as rate } from '../src/projection.ts'

/**
 * `financeRate` 折叠：与平台 `sessionStats` 同一套事件语义（step/start → 首个 token →
 * assistant/message），但按模型分桶。这里锁的就是"哪一刻算开始出字、哪些步
 * 不计时"——面板上的 tok/s 与时间成本全靠它。
 *
 * 两代平台都要锁（2026-09-17「该用谁 → 输出速率没数据」的根因就是只锁了 0.1.2）：
 *  1. 0.1.2：delta 是会话事件 `assistant/chunk`（上面的 fixture）；
 *  2. 0.1.5+（真宿主）：日志里**没有** `assistant/chunk`，整条流内嵌在
 *     `assistant/message.stream` / `assistant/attempt.stream` 里。
 *     内嵌记录的字段形状照抄真宿主 `session.v3.jsonl.zstd` 里的实测样本。
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

/**
 * 平台 0.1.5 的 settlement 事件：delta 不再以 `assistant/chunk` 出现在日志里，
 * 而是打包进事件自身的 `stream`（真宿主实测记录形状）。
 */
const messageWithStream = (
  time: number,
  turn: number,
  step: number,
  outputTokens: number | undefined,
  stream: unknown,
) => ({
  type: 'assistant/message',
  time,
  data: { turn, step, ...outputTokens === undefined ? {} : { usage: { inputTokens: 10, outputTokens } }, stream },
} as const)

const attempt = (time: number, turn: number, step: number, stream: unknown) => ({
  type: 'assistant/attempt',
  time,
  data: { turn, step, stream },
} as const)

/** 原始 chunk 记录（stream 里的 `{type:'chunk'}` 成员）。 */
const streamChunk = (time: number, chunk: unknown) => ({ type: 'chunk', time, chunk })

describe('financeRate projection on 0.1.5 hosts (embedded stream)', () => {
  it('measures the rate from the message-embedded stream (no assistant/chunk exists)', () => {
    const view = fold([
      header(T0, 'deepseek-official', 'deepseek-flash'),
      stepStart(T0, 1, 1),
      // block-start / text / reasoning / usage / finish 都不是"开始出字"。
      messageWithStream(T0 + 1_400, 1, 1, 100, [
        streamChunk(T0 + 100, { type: 'block-start', index: 0, blockType: 'reasoning' }),
        streamChunk(T0 + 400, { type: 'reasoning-delta', index: 0, text: 'think' }),
        streamChunk(T0 + 600, { type: 'text-delta', index: 1, text: 'Hi' }),
        streamChunk(T0 + 1_300, { type: 'usage', usage: { inputTokens: 10, outputTokens: 100 } }),
      ]),
    ])
    expect(view.byModel['deepseek-official/deepseek-flash'])
      .toEqual({ ttftMs: 400, ttftSteps: 1, decodeMs: 1_000, decodeTokens: 100 })
  })

  it('restores packed-run member times via time0 + Σdt (reasoning run starts with an empty member)', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      messageWithStream(T0 + 1_120, 1, 0, 50, [
        streamChunk(T0 + 100, { type: 'block-start', index: 0, blockType: 'reasoning' }),
        // 成员 0 = time0（空串，不算出字）；成员 1 = time0 + dt[0] = T0+120。
        { type: 'reasoning-chunks', time0: T0 + 100, index: 0, dt: [20, 30], texts: ['', 'think', 'ing'] },
      ]),
    ])
    expect(view.byModel['a/llm']?.ttftMs).toBe(120)
    expect(view.byModel['a/llm']?.decodeMs).toBe(1_000)
    expect(view.byModel['a/llm']?.decodeTokens).toBe(50)
  })

  it('counts a tool-call run with a name from its first member', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      messageWithStream(T0 + 600, 1, 0, 20, [
        { type: 'tool-call-chunks', time0: T0 + 200, index: 0, dt: [10], id: 'call-1', name: 'run_code', args: ['{}', '{}'] },
      ]),
    ])
    expect(view.byModel['a/llm']?.ttftMs).toBe(200)
    expect(view.byModel['a/llm']?.decodeMs).toBe(400)
  })

  it('lets an assistant/attempt seed the first token of the open step', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      // 失败的尝试提交不了 message，但它已经出字了 —— 与平台 sessionStats 同规则。
      attempt(T0 + 500, 1, 0, [
        streamChunk(T0 + 300, { type: 'text-delta', index: 0, text: 'par' }),
      ]),
      messageWithStream(T0 + 1_300, 1, 0, 40, [
        streamChunk(T0 + 900, { type: 'text-delta', index: 0, text: 'tial' }),
      ]),
    ])
    expect(view.byModel['a/llm']?.ttftMs).toBe(300)
    expect(view.byModel['a/llm']?.decodeMs).toBe(1_000)
  })

  it('ignores an attempt belonging to another step', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      attempt(T0 + 100, 9, 9, [streamChunk(T0 + 100, { type: 'text-delta', index: 0, text: 'x' })]),
      messageWithStream(T0 + 1_000, 1, 0, 10, []),
    ])
    expect(view.byModel['a/llm']).toBeUndefined()
  })

  it('still records nothing when neither chunks nor a stream carry a token', () => {
    const view = fold([
      header(T0, 'a', 'llm'),
      stepStart(T0, 1, 0),
      messageWithStream(T0 + 1_000, 1, 0, 50, [
        streamChunk(T0 + 100, { type: 'usage', usage: { inputTokens: 10, outputTokens: 50 } }),
      ]),
    ])
    expect(view.byModel['a/llm']).toBeUndefined()
  })
})
