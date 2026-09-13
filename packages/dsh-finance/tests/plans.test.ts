import { describe, expect, it } from 'vitest'
import { normalizeFinanceConfig, normalizeFinancePlans } from '../src/pricing.ts'

/**
 * P1 套餐（`finance.plans`）：用户填一次的静态订阅定义。
 * 这里锁两件事：归一化容错（坏数据不猜、不崩），以及它真的进了 resolved config
 * —— 客户端写回的形状就是这两条函数的输入。
 */
describe('normalizeFinancePlans', () => {
  it('keeps the client-written shape and defaults the effective date to always', () => {
    const plans = normalizeFinancePlans([{ provider: 'deepseek', monthlyMicros: 10_000_000, currency: 'CNY', periodLabel: 'month' }])
    expect(plans).toHaveLength(1)
    expect(plans[0]).toEqual({ provider: 'deepseek', monthlyMicros: 10_000_000, currency: 'CNY', periodLabel: 'month', effectiveFrom: 0 })
  })

  it('accepts a date string or epoch ms for effectiveFrom', () => {
    const [fromString, fromNumber] = normalizeFinancePlans([
      { provider: 'a', monthlyMicros: 1, currency: 'CNY', effectiveFrom: '2026-09-01' },
      { provider: 'b', monthlyMicros: 1, currency: 'CNY', effectiveFrom: 1_700_000_000_000 },
    ])
    expect(fromString.effectiveFrom).toBe(Date.parse('2026-09-01'))
    expect(fromNumber.effectiveFrom).toBe(1_700_000_000_000)
  })

  it('skips rows it cannot trust instead of inventing values', () => {
    const plans = normalizeFinancePlans([
      { provider: '', monthlyMicros: 1, currency: 'CNY' },
      { provider: 'b', monthlyMicros: Number.NaN, currency: 'CNY' },
      { provider: 'c', monthlyMicros: -1, currency: 'CNY' },
      { provider: 'd', monthlyMicros: 5, currency: '' },
    ] as never)
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ provider: 'd', monthlyMicros: 5, currency: 'CNY' })
  })

  it('keeps the optional token quota when it is a positive number', () => {
    const [plan] = normalizeFinancePlans([
      { provider: 'a', monthlyMicros: 1, currency: 'CNY', quotaTokens: 5_000_000 },
      { provider: 'b', monthlyMicros: 1, currency: 'CNY', quotaTokens: 0 },
    ])
    expect(plan.quotaTokens).toBe(5_000_000)
  })

  it('is idempotent for already-normalized entries', () => {
    const once = normalizeFinancePlans([{ provider: 'a', monthlyMicros: 2, currency: 'CNY', effectiveFrom: 3 }])
    expect(normalizeFinancePlans(once as never)).toEqual(once)
  })

  it('flows into the resolved config', () => {
    const config = normalizeFinanceConfig({ plans: [{ provider: 'a', monthlyMicros: 7, currency: 'USD' }] })
    expect(config.plans).toEqual([{ provider: 'a', monthlyMicros: 7, currency: 'USD', effectiveFrom: 0 }])
    expect(normalizeFinanceConfig({}).plans).toEqual([])
  })
})
