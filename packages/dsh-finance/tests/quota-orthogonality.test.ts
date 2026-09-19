/**
 * A11：INV-10 正交性 —— 额度触达**不得**影响任何金额口径（SPEC §10.6）。
 *
 * 这是本功能最容易犯的错：把"被挡了几次"混进成本，做出一个既不等于钱、
 * 也不等于额度的第三个数。证据是**逐字节相等**：
 * 同一批会话，加不加 `financeQuota` 键，金额聚合必须完全一致。
 */
import { describe, expect, it, vi } from 'vitest'
import { buildFinanceLedger, quotaMonthStart } from '../src/ledger.ts'
import type { FinanceConfig, FinanceQuotaEpisodeRow, FinanceUsageProjection } from '../src/types.ts'

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0)

const config: FinanceConfig = {
  currency: 'CNY',
  balance: { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 1000 },
  defaultPrice: {
    inputMicrosPerMtok: 2_000_000,
    cacheReadMicrosPerMtok: 500_000,
    cacheWriteMicrosPerMtok: 2_000_000,
    outputMicrosPerMtok: 8_000_000,
  },
  hostMetaByProvider: { zai: 'plan', 'deepseek-official': 'metered' },
  prices: {},
}

interface Header { id: string; createdAt: number; cwd?: string }

function usageFor(modelKey: string, input: number, output: number): FinanceUsageProjection {
  const buckets = { uncachedInputTokens: input, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: output }
  return {
    byModel: { [modelKey]: buckets },
    byDay: { '2026-09-19': buckets },
    totals: buckets,
  }
}

/** 一条额度触达 episode（形状与投影产出一致）。 */
function quotaEpisode(modelKey: string, atMs: number): FinanceQuotaEpisodeRow {
  return {
    provider: modelKey.slice(0, modelKey.indexOf('/')),
    modelKey,
    window: '5h',
    firstAtMs: atMs,
    lastAtMs: atMs,
    attempts: 6,
    final: true,
    resetAtMs: null,
    resetRaw: '2026-09-19 23:17:45',
    vendorCode: '1308',
  }
}

const EMPTY_RATE_LEG = { financeRate: { byModel: {} } }
const EMPTY_CONTEXT_LEG = { financeContext: { byModel: {} } }

function makeCtx(headers: Header[], values: Record<string, Record<string, unknown>>) {
  const snapshots = headers.map(header => ({ header, revision: 'rev-' + header.id }))
  return {
    sessionPersistence: {
      listSnapshots: async () => snapshots,
      inspect: vi.fn(async (id: string) => ({
        meta: headers.find(header => header.id === id) ?? ({ id } as Header),
        inheritedEventCount: 0,
        events: [] as never[],
      })),
    },
    sessionProjectionCache: {
      cachedSnapshot: (meta: Header) => {
        const found = values[meta.id]
        if (found === undefined) return undefined
        return { asOfSeq: 1, values: { ...EMPTY_RATE_LEG, ...EMPTY_CONTEXT_LEG, ...found } }
      },
      coldSnapshot: vi.fn((meta: Header) => ({ asOfSeq: 1, values: values[meta.id] ?? {} })),
    },
    workspaceRegistry: { list: () => [] },
  } as never
}

/** 只保留金额口径字段，用于逐字节比较。 */
function moneySnapshot(ledger: Awaited<ReturnType<typeof buildFinanceLedger>>) {
  return {
    totalCostMicros: ledger.totalCostMicros,
    meteredCostMicros: ledger.meteredCostMicros,
    planEquivalentCostMicros: ledger.planEquivalentCostMicros,
    freeCostMicros: ledger.freeCostMicros,
    totals: ledger.totals,
    byModel: ledger.byModel,
    byProvider: ledger.byProvider,
    byWorkspace: ledger.byWorkspace,
    byDay: ledger.byDay,
    peakValley: ledger.peakValley,
    byHourOfDay: ledger.byHourOfDay,
    tasks: ledger.tasks,
  }
}

describe('A11 · INV-10 quota/cost orthogonality', () => {
  const headers: Header[] = [
    { id: 'sess-a', createdAt: NOW - 5 * 60 * 60 * 1000, cwd: '/w/a' },
    { id: 'sess-b', createdAt: NOW - 3 * 60 * 60 * 1000, cwd: '/w/b' },
  ]

  it('leaves every money rollup byte-identical when quota episodes are present', async () => {
    const withoutQuota = {
      'sess-a': { financeUsage: usageFor('zai/glm-5.3-flash', 1000, 500), title: 'A' },
      'sess-b': { financeUsage: usageFor('deepseek-official/deepseek-v4-flash', 2000, 800), title: 'B' },
    }
    const withQuota = {
      'sess-a': {
        ...withoutQuota['sess-a'],
        financeQuota: { episodes: [quotaEpisode('zai/glm-5.3-flash', NOW - 60_000)] },
      },
      'sess-b': {
        ...withoutQuota['sess-b'],
        financeQuota: { episodes: [quotaEpisode('deepseek-official/deepseek-v4-flash', NOW - 30_000)] },
      },
    }

    const baseline = await buildFinanceLedger(makeCtx(headers, withoutQuota), config, undefined, NOW)
    const withHits = await buildFinanceLedger(makeCtx(headers, withQuota), config, undefined, NOW)

    // 核心断言：金额口径逐字节不变。
    expect(moneySnapshot(withHits)).toEqual(moneySnapshot(baseline))
    expect(withHits.totalCostMicros).toBe(baseline.totalCostMicros)
  })

  it('reports quota hits separately from cost', async () => {
    const values = {
      'sess-a': {
        financeUsage: usageFor('zai/glm-5.3-flash', 1000, 500),
        title: 'A',
        financeQuota: { episodes: [quotaEpisode('zai/glm-5.3-flash', NOW - 60_000)] },
      },
      'sess-b': { financeUsage: usageFor('deepseek-official/deepseek-v4-flash', 2000, 800), title: 'B' },
    }
    const ledger = await buildFinanceLedger(makeCtx(headers, values), config, undefined, NOW)

    expect(ledger.quota?.totalHits).toBe(1)
    expect(ledger.quota?.rows).toHaveLength(1)
    const row = ledger.quota!.rows[0]
    expect(row.provider).toBe('zai')
    expect(row.hits).toBe(1)
    expect(row.attempts).toBe(6) // hits 与 attempts 是两个口径
  })

  it('excludes hits from previous months (month-scoped, like the rest of the dashboard)', async () => {
    const lastMonth = quotaMonthStart(NOW) - 24 * 60 * 60 * 1000
    const values = {
      'sess-a': {
        financeUsage: usageFor('zai/glm-5.3-flash', 1000, 500),
        title: 'A',
        financeQuota: {
          episodes: [
            quotaEpisode('zai/glm-5.3-flash', NOW - 60_000),
            quotaEpisode('zai/glm-5.3-flash', lastMonth),
          ],
        },
      },
      'sess-b': { financeUsage: usageFor('deepseek-official/deepseek-v4-flash', 2000, 800), title: 'B' },
    }
    const ledger = await buildFinanceLedger(makeCtx(headers, values), config, undefined, NOW)
    expect(ledger.quota?.totalHits).toBe(1)
    expect(ledger.quota?.monthStartMs).toBe(quotaMonthStart(NOW))
  })

  it('still produces an empty quota summary for ledgers with no hits', async () => {
    const values = {
      'sess-a': { financeUsage: usageFor('zai/glm-5.3-flash', 1000, 500), title: 'A' },
      'sess-b': { financeUsage: usageFor('deepseek-official/deepseek-v4-flash', 2000, 800), title: 'B' },
    }
    const ledger = await buildFinanceLedger(makeCtx(headers, values), config, undefined, NOW)
    expect(ledger.quota?.totalHits).toBe(0)
    expect(ledger.quota?.rows).toEqual([])
    expect(ledger.quota?.episodes).toEqual([])
  })
})

describe('quotaMonthStart', () => {
  it('returns the local calendar month start', () => {
    const start = new Date(quotaMonthStart(NOW))
    expect(start.getDate()).toBe(1)
    expect(start.getMonth()).toBe(new Date(NOW).getMonth())
    expect(start.getHours()).toBe(0)
  })
})