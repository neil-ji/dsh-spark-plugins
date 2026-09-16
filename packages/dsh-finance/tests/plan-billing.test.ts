/**
 * 「本月值不值 → 订阅等价」恒为 0 的回归线（2026-09-17 真宿主 bug）。
 *
 * 客户端 `ThisMonthView.billingFor` 有三层：显式标记 > **填过月费 = 订阅** > 宿主默认。
 * 账本侧的 `financeBillingMode` 只有宿主默认 + 显式标记 —— 于是用户「填了月费但没打标记」
 * 的厂商（真宿主：zai / minimax-cn）在面板里被排进「订阅计划」卡，账本却把它们记成按量：
 * 顶部「订阅等价」永远是 ¥0、按量支出虚高。
 *
 * 这里走**真实服务链路**（constructor → currentConfig → buildFinanceLedger），
 * 而不是只测纯函数，否则 `raw.plans` 没接进折叠这种漏接会静默通过。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FinanceService } from '../src/index.ts'
import type { FinanceTokenBuckets, FinanceUsageProjection } from '../src/types.ts'

interface Header {
  id: string
  createdAt: number
}

function buckets(uncachedInputTokens: number, outputTokens: number): FinanceTokenBuckets {
  return { uncachedInputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens }
}

/** 一条会话的 financeUsage 投影值：单模型 + 当日 + 合计，与真投影同形。 */
function usage(modelKey: string, uncachedInputTokens: number, outputTokens: number): FinanceUsageProjection {
  const day = '2026-01-15'
  return {
    byModel: { [modelKey]: buckets(uncachedInputTokens, outputTokens) },
    byDay: { [day]: buckets(uncachedInputTokens, outputTokens) },
    totals: buckets(uncachedInputTokens, outputTokens),
  }
}

/** 最小宿主 ctx：账本要的 persistence / projection cache / workspace registry。 */
function makeCtx(sessions: Array<{ header: Header; values: Record<string, unknown> }>) {
  const ctx = new Context()
  const snapshots = sessions.map(entry => ({ header: entry.header, revision: 'rev-' + entry.header.id }))
  const valuesOf = new Map(sessions.map(entry => [entry.header.id, entry.values]))
  const legs = () => ({ financeRate: { byModel: {} }, financeContext: { byModel: {} } })
  Object.assign(ctx as unknown as Record<string, unknown>, {
    sessionPersistence: {
      listSnapshots: async () => snapshots,
      inspect: async (id: string) => ({
        meta: sessions.find(entry => entry.header.id === id)?.header ?? { id },
        inheritedEventCount: 0,
        events: [],
      }),
    },
    sessionProjectionCache: {
      cachedSnapshot: (meta: Header) => {
        const values = valuesOf.get(meta.id)
        return values === undefined ? undefined : { asOfSeq: 1, values: { ...legs(), ...values } }
      },
      coldSnapshot: (meta: Header) => ({ asOfSeq: 1, values: { ...legs(), ...(valuesOf.get(meta.id) ?? {}) } }),
    },
    workspaceRegistry: { list: () => [] },
  })
  return ctx
}

const sessions = [
  { header: { id: 'sess-zai', createdAt: 1000 }, values: { financeUsage: usage('zai/glm-5.3-flash', 1_000, 2_000), title: 'Zai 会话' } },
  { header: { id: 'sess-ds', createdAt: 2000 }, values: { financeUsage: usage('deepseek-official/deepseek-flash', 4_000, 3_000), title: 'DeepSeek 会话' } },
]

describe('套餐条目 → 账本计费口径', () => {
  it('填过月费的厂商记成订阅：订阅等价 = 该厂商的按量等价，按量支出只剩真按量的部分', async () => {
    const ctx = makeCtx(sessions)
    const service = new FinanceService(ctx, {
      plans: [{ provider: 'zai', monthlyMicros: 94_400_000, currency: 'CNY', periodLabel: 'month-week-5h', effectiveFrom: 0 }],
    })
    const ledger = await service.getLedger()

    const zai = ledger.byModel.find(row => row.modelKey === 'zai/glm-5.3-flash')
    const ds = ledger.byModel.find(row => row.modelKey === 'deepseek-official/deepseek-flash')
    expect(zai?.billingMode).toBe('plan')
    expect(ds?.billingMode).toBe('metered')
    expect(ledger.planEquivalentCostMicros).toBe(zai?.costMicros)
    expect(ledger.planEquivalentCostMicros).toBeGreaterThan(0)
    expect(ledger.meteredCostMicros).toBe(ds?.costMicros)
    // 三块加起来必须正好是总额（订阅等价不是额外支出，只是换个口径的同一笔用量）。
    expect(ledger.totalCostMicros)
      .toBe((ledger.meteredCostMicros ?? 0) + (ledger.planEquivalentCostMicros ?? 0) + (ledger.freeCostMicros ?? 0))
    // provider 汇总行也要跟着标 plan，否则「本月值不值」的厂商卡还会说它按量。
    expect(ledger.byProvider.find(row => row.provider === 'zai')?.billingMode).toBe('plan')
  })

  it('显式标记压过月费推断（用户自己说某个填过月费的厂商其实按量）', async () => {
    const ctx = makeCtx(sessions)
    const service = new FinanceService(ctx, {
      plans: [{ provider: 'zai', monthlyMicros: 1_000_000, currency: 'CNY', effectiveFrom: 0 }],
      providers: [{ provider: 'zai', billingMode: 'metered', totalPriceMicros: 0, currency: 'CNY', autoFetchBalance: false }],
    })
    const ledger = await service.getLedger()
    expect(ledger.byModel.find(row => row.modelKey === 'zai/glm-5.3-flash')?.billingMode).toBe('metered')
    expect(ledger.planEquivalentCostMicros).toBe(0)
  })

  it('套餐里写 deepseek（不带 -official 后缀）也能对上账本的 deepseek-official 行', async () => {
    const ctx = makeCtx(sessions)
    const service = new FinanceService(ctx, {
      plans: [{ provider: 'deepseek', monthlyMicros: 1_000_000, currency: 'CNY', effectiveFrom: 0 }],
    })
    const ledger = await service.getLedger()
    expect(ledger.byModel.find(row => row.modelKey === 'deepseek-official/deepseek-flash')?.billingMode).toBe('plan')
    expect(ledger.planEquivalentCostMicros)
      .toBe(ledger.byModel.find(row => row.modelKey === 'deepseek-official/deepseek-flash')?.costMicros)
  })
})
