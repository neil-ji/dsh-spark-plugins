import { describe, expect, it } from 'vitest'
import { financeModelRowSchema } from 'dsh-spark-finance-wire'

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
