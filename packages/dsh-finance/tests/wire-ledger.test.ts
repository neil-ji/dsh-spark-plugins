import { describe, expect, it } from 'vitest'
import { financeLedgerSchema, financeModelRowSchema } from 'dsh-spark-finance-wire'

/**
 * 账本边界 schema 的两条新腿（P1-B 每模型速率 / P2 上下文分布）必须**声明**在 wire 上。
 *
 * 网关把这份 strict schema 当作端点的结果契约对外宣告；宿主返回了而这里没声明的
 * 字段，客户端照样收得到（网关的结果路径不做 decode），但契约面读不到它 —— P1-B
 * 就是这么发的。zod 对象默认剥掉未知键，所以"parse 之后还在"正好是"声明过"的判据。
 */
const row = {
  modelKey: 'deepseek-official/deepseek-flash',
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  billingMode: 'metered' as const,
  usage: { uncachedInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50 },
  costMicros: 1_234,
}

describe('financeModelRowSchema', () => {
  it('keeps the P1-B rate and P2 context legs through parse', () => {
    const rate = { decodeMs: 10_000, decodeTokens: 500, ttftMs: 800, ttftSteps: 1 }
    const context = [
      { maxPromptTokens: 32_000, usage: row.usage, steps: 3 },
      { maxPromptTokens: null, usage: row.usage, steps: 1 },
    ]
    const parsed = financeModelRowSchema.parse({ ...row, shiftSavingsMicros: 7, rate, context })
    expect(parsed.rate).toEqual(rate)
    expect(parsed.context).toEqual(context)
  })

  it('still accepts a row from a host that predates both legs', () => {
    const parsed = financeModelRowSchema.parse(row)
    expect(parsed.rate).toBeUndefined()
    expect(parsed.context).toBeUndefined()
  })
})

/**
 * SPEC §10 回归线：`quota` / `windows` 必须能穿过 wire 的 strict 契约。
 *
 * 为什么这条测试必须存在：`financeLedgerSchema` 是普通 `z.object`，Zod 默认**丢弃**
 * 未声明的键。2026-09-19 实测到过这个坑 —— 宿主算得对、host 单测全绿，
 * 而 `quota` 在过 wire 时被静默剥离，真宿主 UI 永远空白。
 * （P1-B 的 `rate` 当年也是这么漏的，见 `financeModelRowSchema` 的注释。）
 */
describe('financeLedgerSchema 承载 SPEC §10 新字段', () => {
  const baseLedger = {
    generatedAt: 1,
    currency: 'CNY',
    totals: { uncachedInputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
    totalCostMicros: 1,
    sessionCount: 1,
    workspaceCount: 1,
    taskCount: 1,
    byDay: [],
    byModel: [],
    byWorkspace: [],
    tasks: [],
    sessions: [],
    byHourOfDay: [],
    hourOfDayWindowStartMs: 0,
    peakValley: {
      peakCostMicros: 0, offPeakCostMicros: 0, flatCostMicros: 0,
      unclassifiedCostMicros: 0, legacyCostMicros: 0, shiftSavingsMicros: 0,
    },
  }

  it('keeps quota across the wire (episodes, rows, vendor code, reset raw)', () => {
    const parsed = financeLedgerSchema.parse({
      ...baseLedger,
      quota: {
        rows: [{
          provider: 'zai', hits: 1, attempts: 6, lastHitAtMs: 5, nextResetAtMs: null,
          windows: [{ window: '5h', hits: 1, resetAtMs: null }],
        }],
        totalHits: 1,
        episodes: [{
          provider: 'zai', modelKey: 'zai/glm-5.3-flash', window: '5h',
          firstAtMs: 1, lastAtMs: 2, attempts: 6, final: true,
          resetAtMs: null, resetRaw: '2026-09-19 23:17:45', vendorCode: '1308',
        }],
        monthStartMs: 0,
      },
    })
    expect(parsed.quota).toBeDefined()
    expect(parsed.quota?.totalHits).toBe(1)
    expect(parsed.quota?.episodes[0]?.vendorCode).toBe('1308')
    expect(parsed.quota?.episodes[0]?.resetRaw).toBe('2026-09-19 23:17:45')
  })

  it('keeps windows across the wire (duration and per-model split)', () => {
    const parsed = financeLedgerSchema.parse({
      ...baseLedger,
      windows: [{
        span: '5h', startMs: 0, endMs: 10, anchoredAtHit: false,
        usage: { uncachedInputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
        costMicros: 5, decodeMs: 60_000, ttftMs: 100, steps: 1,
        models: [{
          modelKey: 'zai/glm-5.3-flash', provider: 'zai',
          usage: { uncachedInputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
          costMicros: 5, decodeMs: 60_000, ttftMs: 100, steps: 1,
        }],
        providerCount: 1,
      }],
    })
    expect(parsed.windows).toHaveLength(1)
    expect(parsed.windows?.[0]?.span).toBe('5h')
    expect(parsed.windows?.[0]?.models[0]?.decodeMs).toBe(60_000)
  })

  it('still accepts a pre-§10 host payload (both fields optional)', () => {
    const parsed = financeLedgerSchema.parse(baseLedger)
    expect(parsed.quota).toBeUndefined()
    expect(parsed.windows).toBeUndefined()
  })
})
