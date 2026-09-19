/**
 * 窗口归因聚合（SPEC §10.8）：把用量按 5h / 周 / 月切片。
 *
 * 锁三件事：
 *  1. 窗口边界正确（闭开区间，超出窗口的桶不进来）；
 *  2. 锚定撞墙时刻时 `endMs` 跟着走（"那次撞墙前的 5 小时"）；
 *  3. 时长来自 `financeRateHourly`，旧会话缺该键时为 0（forward-only 边界）。
 */
import { describe, expect, it } from 'vitest'
import { buildFinanceLedger } from '../src/ledger.ts'
import type { FinanceConfig, FinanceRateStats } from '../src/types.ts'

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0)
/** 每个 UTC 小时的起点，便于造按小时分桶的 fixture。 */
const hour = (h: number, dayOffset = 0): number => Date.UTC(2026, 8, 19 + dayOffset, h, 0, 0)
const hourKeyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 13)

const config: FinanceConfig = {
  currency: 'CNY',
  balance: { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 1000 },
  defaultPrice: {
    inputMicrosPerMtok: 2_000_000,
    cacheReadMicrosPerMtok: 500_000,
    cacheWriteMicrosPerMtok: 2_000_000,
    outputMicrosPerMtok: 8_000_000,
  },
  hostMetaByProvider: { zai: 'plan' },
  prices: {},
}

interface Header { id: string; createdAt: number; cwd?: string }

const EMPTY_RATE_LEG = { financeRate: { byModel: {} } }
const EMPTY_CONTEXT_LEG = { financeContext: { byModel: {} } }

function makeCtx(headers: Header[], values: Record<string, Record<string, unknown>>) {
  const snapshots = headers.map(header => ({ header, revision: 'rev-' + header.id }))
  return {
    sessionPersistence: {
      listSnapshots: async () => snapshots,
      inspect: async (id: string) => ({
        meta: headers.find(header => header.id === id) ?? ({ id } as Header),
        inheritedEventCount: 0,
        events: [] as never[],
      }),
    },
    sessionProjectionCache: {
      cachedSnapshot: (meta: Header) => {
        const found = values[meta.id]
        if (found === undefined) return undefined
        return { asOfSeq: 1, values: { ...EMPTY_RATE_LEG, ...EMPTY_CONTEXT_LEG, ...found } }
      },
      coldSnapshot: (meta: Header) => ({ asOfSeq: 1, values: values[meta.id] ?? {} }),
    },
    workspaceRegistry: { list: () => [] },
  } as never
}

const buckets = (input: number, output: number) => ({
  uncachedInputTokens: input, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: output,
})

const rateStat = (decodeMs: number, decodeTokens: number, ttftMs = 100, ttftSteps = 1): FinanceRateStats =>
  ({ decodeMs, decodeTokens, ttftMs, ttftSteps })

describe('窗口归因聚合', () => {
  /** 两个会话：一个在 2 小时前（落在 5h 窗内），一个在 3 天前（只在周/月窗内）。 */
  const headers: Header[] = [
    { id: 'recent', createdAt: hour(10) },
    { id: 'older', createdAt: hour(9, -3) },
  ]

  function values() {
    return {
      recent: {
        financeUsageHourly: {
          byModelHour: {
            'zai/glm-5.3-flash': {
              [hourKeyOf(hour(10))]: buckets(1000, 500),
            },
          },
        },
        financeRateHourly: {
          byModelHour: {
            'zai/glm-5.3-flash': { [hourKeyOf(hour(10))]: rateStat(60_000, 500) },
          },
        },
      },
      older: {
        financeUsageHourly: {
          byModelHour: {
            'zai/glm-5.3-flash': {
              [hourKeyOf(hour(9, -3))]: buckets(4000, 2000),
            },
          },
        },
        financeRateHourly: {
          byModelHour: {
            'zai/glm-5.3-flash': { [hourKeyOf(hour(9, -3))]: rateStat(120_000, 2000) },
          },
        },
      },
    }
  }

  it('slices usage into 5h / week / month windows', async () => {
    const ledger = await buildFinanceLedger(makeCtx(headers, values()), config, undefined, { nowMs: NOW })
    const windows = ledger.windows!
    expect(windows.map(w => w.span)).toEqual(['5h', 'week', 'month'])

    const [fiveHour, week] = windows
    // 5 小时窗只装得下 2 小时前那一条。
    expect(fiveHour.usage.uncachedInputTokens).toBe(1000)
    expect(fiveHour.models).toHaveLength(1)
    expect(fiveHour.decodeMs).toBe(60_000)
    // 周窗装得下两条。
    expect(week.usage.uncachedInputTokens).toBe(5000)
    expect(week.decodeMs).toBe(180_000)
  })

  it('reports the reason a hit happened: per-model split and cost', async () => {
    const ledger = await buildFinanceLedger(makeCtx(headers, values()), config, undefined, { nowMs: NOW })
    const fiveHour = ledger.windows![0]
    const row = fiveHour.models[0]
    expect(row.modelKey).toBe('zai/glm-5.3-flash')
    expect(row.provider).toBe('zai')
    expect(row.decodeMs).toBe(60_000)
    expect(row.steps).toBe(1)
    expect(fiveHour.providerCount).toBe(1)
    expect(fiveHour.costMicros).toBeGreaterThan(0)
  })

  it('anchors a window on a hit so "the 5h before the wall" is answerable', async () => {
    // 锚点回拨 4 小时 -> 2 小时前那条落在窗外，窗口内应为空。
    const ledger = await buildFinanceLedger(
      makeCtx(headers, values()), config, undefined,
      { nowMs: NOW, windowAnchors: { '5h': hour(6) } },
    )
    const fiveHour = ledger.windows!.find(w => w.span === '5h')!
    expect(fiveHour.anchoredAtHit).toBe(true)
    expect(fiveHour.endMs).toBe(hour(6))
    expect(fiveHour.usage.uncachedInputTokens).toBe(0)
  })

  it('degrades to zero duration for sessions without the rate-hourly leg', async () => {
    const noRate = {
      recent: {
        financeUsageHourly: { byModelHour: { 'zai/glm-5.3-flash': { [hourKeyOf(hour(10))]: buckets(1000, 500) } } },
      },
      older: {},
    }
    const ledger = await buildFinanceLedger(makeCtx(headers, noRate), config, undefined, { nowMs: NOW })
    const fiveHour = ledger.windows![0]
    expect(fiveHour.usage.uncachedInputTokens).toBe(1000) // 用量仍在
    expect(fiveHour.decodeMs).toBe(0) // 时长缺失，UI 不显示该列
  })
})