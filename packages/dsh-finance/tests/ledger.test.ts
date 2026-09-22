import { describe, expect, it, vi } from 'vitest'
import { backfillFinanceHourly, buildFinanceLedger } from '../src/ledger.ts'
import { normalizeFinancePrices } from '../src/pricing.ts'
import type { FinanceConfig, FinancePriceEntry, FinanceTokenBuckets, FinanceUsageProjection } from '../src/types.ts'

const config: FinanceConfig = {
  currency: 'CNY',
  balance: { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 1000 },
  defaultPrice: {
    inputMicrosPerMtok: 2_000_000,
    cacheReadMicrosPerMtok: 500_000,
    cacheWriteMicrosPerMtok: 2_000_000,
    outputMicrosPerMtok: 8_000_000,
  },
  hostMetaByProvider: { 'deepseek-official': 'metered' },
  prices: {},
}

interface Header {
  id: string
  createdAt: number
  cwd?: string
  parentSession?: string
  delegationDepth?: number
  origin?: 'subagent'
  /** Fork lineage: a seeded Session's inherited cut only its storage handle knows. */
  isSeeded?: boolean
}

function usage(uncachedInputTokens: number, outputTokens: number): FinanceUsageProjection {
  return {
    byModel: { 'deepseek-official/deepseek-v4-flash': { uncachedInputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens } },
    byDay: { '2026-01-15': { uncachedInputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens } },
    totals: { uncachedInputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens },
  }
}

/** The harness core tokenUsage projection view: totals only, no model split. */
function tokenUsage(uncachedInputTokens: number, outputTokens: number, cacheReadTokens = 0): FinanceTokenBuckets {
  return { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens: 0 }
}

/**
 * The reader-side failure a legacy v0 artifact produces on the real host:
 * `@deepseek-ai/dsh-session-format-v0-to-v1` refuses the whole log when one
 * `turn/end` abort cause carries a member its exact-key check does not admit.
 */
const UNREADABLE_REASON = 'turn/end 9936 reason abort cause has unexpected member "stack"'

/** 缓存切面里 P1-B / P2 两条腿的默认值（空样本）。 */
const EMPTY_RATE_LEG = { financeRate: { byModel: {} } }
const EMPTY_CONTEXT_LEG = { financeContext: { byModel: {} } }

function makeCtx(
  headers: Header[],
  projectionValues: Record<string, Record<string, unknown>>,
  coldProjectionValues: Record<string, Record<string, unknown>> = projectionValues,
  options: {
    /** Session ids whose persistence read rejects, like a migration-refused log. */
    unreadable?: readonly string[]
    /**
     * Session ids whose cached cut is missing the P1-B / P2 legs (row absent, or
     * dropped by the unit's stateVersion gate) — the cold-refold regression line.
     */
    missingCacheLegs?: readonly string[]
    logger?: { warn: (message: string, error?: unknown) => void }
  } = {},
) {
  const unreadable = new Set(options.unreadable ?? [])
  const missingCacheLegs = new Set(options.missingCacheLegs ?? [])
  const snapshots = headers.map(header => ({ header, revision: 'rev-' + header.id }))
  // 0.1.2：coldSnapshot 是同步纯折叠（meta, inheritedEventCount, events）；
  // 折叠输入改由 sessionPersistence.inspect 提供的存储元数据 + 完整日志。
  const coldSnapshot = vi.fn((meta: Header) => ({ asOfSeq: 1, values: coldProjectionValues[meta.id] ?? {} }))
  const inspect = vi.fn(async (id: string) => {
    if (unreadable.has(id)) throw new Error(UNREADABLE_REASON)
    const meta = headers.find(header => header.id === id) ?? ({ id } as Header)
    return { meta, inheritedEventCount: 0, events: [] as never[] }
  })
  const coldSessionIds = (): string[] => coldSnapshot.mock.calls.map(call => (call[0] as Header).id)
  return {
    ctx: {
      sessionPersistence: { listSnapshots: async () => snapshots, inspect },
      sessionProjectionCache: {
        cachedSnapshot: (meta: Header) => {
          const values = projectionValues[meta.id]
          if (values === undefined) return undefined
          // 命中缓存的用例默认带上 P1-B / P2 两条腿；"缺腿必须回冷折"由
          // missingCacheLegs 显式造出来（否则账本会拿空对象当答案永远显示 —）。
          const legs = missingCacheLegs.has(meta.id) ? {} : { ...EMPTY_RATE_LEG, ...EMPTY_CONTEXT_LEG }
          return { asOfSeq: 1, values: { ...legs, ...values } }
        },
        coldSnapshot,
      },
      workspaceRegistry: {
        list: () => [{
          id: 'ws-1',
          path: '/workspaces/a',
          title: 'Workspace A',
          sessionIds: ['sess-top'],
        }],
      },
      logger: options.logger,
    } as never,
    coldSnapshot,
    coldSessionIds,
    inspect,
  }
}

describe('buildFinanceLedger', () => {
  it('joins sessions to workspaces and computes task roots from parentSession', async () => {
    const { ctx } = makeCtx([
      { id: 'sess-top', createdAt: 1000, cwd: '/workspaces/a' },
      { id: 'sess-child', createdAt: 2000, parentSession: 'sess-top', delegationDepth: 1, origin: 'subagent' },
      { id: 'sess-standalone', createdAt: 3000, cwd: '/elsewhere' },
    ], {
      'sess-top': { financeUsage: usage(100, 50), title: 'Top task' },
      'sess-child': { financeUsage: usage(10, 5), title: 'Child task' },
      'sess-standalone': { financeUsage: usage(1, 1), title: 'Standalone' },
    })
    const ledger = await buildFinanceLedger(ctx, config)

    expect(ledger.sessionCount).toBe(3)
    expect(ledger.taskCount).toBe(2) // sess-top + sess-child fold into one task
    expect(ledger.workspaceCount).toBe(2) // Workspace A + unassigned

    const top = ledger.sessions.find(s => s.sessionId === 'sess-top')!
    expect(top.workspaceId).toBe('ws-1')
    expect(top.workspaceTitle).toBe('Workspace A')
    expect(top.taskId).toBe('sess-top')

    const child = ledger.sessions.find(s => s.sessionId === 'sess-child')!
    expect(child.parentSessionId).toBe('sess-top')
    expect(child.taskId).toBe('sess-top') // folded into the top-level root
    expect(child.origin).toBe('subagent')

    const standalone = ledger.sessions.find(s => s.sessionId === 'sess-standalone')!
    expect(standalone.workspaceId).toBeNull()
    expect(standalone.taskId).toBe('sess-standalone')

    const topTask = ledger.tasks.find(t => t.taskId === 'sess-top')!
    expect(topTask.sessionCount).toBe(2)
    expect(topTask.usage.uncachedInputTokens).toBe(110)

    const wsA = ledger.byWorkspace.find(w => w.workspaceId === 'ws-1')!
    expect(wsA.sessionCount).toBe(1)
    expect(wsA.usage.uncachedInputTokens).toBe(100)
  })

  it('sums totals and costs across sessions', async () => {
    const { ctx } = makeCtx([
      { id: 'a', createdAt: 1000 },
      { id: 'b', createdAt: 2000 },
    ], {
      'a': { financeUsage: usage(1_000_000, 0), title: 'A' },
      'b': { financeUsage: usage(0, 500_000), title: 'B' },
    })
    const ledger = await buildFinanceLedger(ctx, config)
    expect(ledger.totals.uncachedInputTokens).toBe(1_000_000)
    expect(ledger.totals.outputTokens).toBe(500_000)
    // 1M input at 2 CNY + 0.5M output at 4 CNY = 6,000,000 micros
    expect(ledger.totalCostMicros).toBe(6_000_000)
  })

  it('reads pre-install sessions from cached tokenUsage without a cold read', async () => {
    // A session persisted before the finance plugin was installed has a cached
    // cut with the core token-meter totals but no financeUsage row. The ledger
    // must read those totals from the cached cut directly — no event-log
    // replay — and price them at the default rate.
    const { ctx, coldSnapshot, inspect } = makeCtx([
      { id: 'pre-install', createdAt: 1000 },
    ], {
      'pre-install': { tokenUsage: tokenUsage(100, 50), title: 'Old session' },
    }, {
      // The cold values must never be read: the cached cut already answers.
      'pre-install': { tokenUsage: tokenUsage(999, 999), title: 'Old session' },
    })
    const ledger = await buildFinanceLedger(ctx, config)
    expect(coldSnapshot).not.toHaveBeenCalled()
    // 2026-09-23 真机事故回归线：命中检查点连**日志都不该打开**。原实现先
    // `inspectPersistenceSession`（读完整日志）再查缓存 —— 每次账本构建都对全部
    // 会话全量解码（3080 实库 301 会话 / 1.2G → 每轮 145%~232% CPU、Web UI 卡死）。
    expect(inspect).not.toHaveBeenCalled()
    expect(ledger.sessionCount).toBe(1)
    expect(ledger.sessions[0].usage.uncachedInputTokens).toBe(100)
    expect(ledger.sessions[0].usage.outputTokens).toBe(50)
    // 100 uncached input at 2 CNY/Mtok + 50 output at 8 CNY/Mtok = 600 micros.
    expect(ledger.sessions[0].costMicros).toBe(600)
    // No per-model / per-day detail exists for the fallback source.
    expect(ledger.sessions[0].modelKeys).toEqual([])
    expect(ledger.byModel).toEqual([])
    expect(ledger.byDay).toEqual([])
  })

  it('prices cached tokenUsage cache reads at the default cache rate', async () => {
    const { ctx } = makeCtx([
      { id: 'a', createdAt: 1000 },
    ], {
      'a': { tokenUsage: tokenUsage(1000, 100, 10_000), title: 'A' },
    })
    const ledger = await buildFinanceLedger(ctx, config)
    // 1000 input at 2 + 10000 cache reads at 0.5 + 100 output at 8 = 7,800 micros.
    expect(ledger.sessions[0].costMicros).toBe(7_800)
  })

  it('falls back to a cold read only when no cached rows exist', async () => {
    const { ctx, coldSnapshot, coldSessionIds } = makeCtx([
      { id: 'a', createdAt: 1000 },
    ], {}, {
      'a': { tokenUsage: tokenUsage(50, 25), title: 'Cold only' },
    })
    const ledger = await buildFinanceLedger(ctx, config)
    expect(coldSessionIds()).toContain('a')
    expect(ledger.sessions[0].usage.uncachedInputTokens).toBe(50)
    expect(ledger.sessions[0].costMicros).toBe(300) // 50 input + 25 output at default rates
  })

  // 2026-09-17 修 bug（「该用谁 → 输出速率没数据」）：financeRate 的 v1 行在 0.1.5
  // 宿主上恒为空（只认 assistant/chunk），靠 stateVersion 提升作废；版本门丢掉该行后
  // 缓存切面**仍然有别的键**，所以账本必须自己发现缺腿再冷折一次 —— 只看
  // `cached === undefined` 的话，旧会话永远显示 `—`。
  it('cold-folds a cached cut whose P1-B/P2 leg was dropped by the version gate', async () => {
    const stats = { decodeMs: 10_000, decodeTokens: 500, ttftMs: 800, ttftSteps: 1 }
    const rateLeg = { byModel: { 'deepseek-official/deepseek-v4-flash': stats } }
    const contextLeg = {
      byModel: {
        'deepseek-official/deepseek-v4-flash': [
          { maxPromptTokens: 32_000, usage: { uncachedInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50 }, steps: 3 },
        ],
      },
    }
    const { ctx, coldSessionIds } = makeCtx(
      [{ id: 'a', createdAt: 1000 }],
      { a: { financeUsage: usage(100, 50), title: 'Stale rate row' } },
      { a: { financeUsage: usage(100, 50), title: 'Stale rate row', financeRate: rateLeg, financeContext: contextLeg } },
      { missingCacheLegs: ['a'] },
    )
    const ledger = await buildFinanceLedger(ctx, config)
    expect(coldSessionIds()).toContain('a')
    expect(ledger.byModel[0].rate).toEqual(stats)
    expect(ledger.byModel[0].context).toEqual(contextLeg.byModel['deepseek-official/deepseek-v4-flash'])
  })

  it('keeps the cached cut when both legs are present (no replay for healthy rows)', async () => {
    const { ctx, coldSessionIds } = makeCtx([
      { id: 'a', createdAt: 1000 },
    ], {
      'a': { financeUsage: usage(100, 50), title: 'Fresh' },
    })
    const ledger = await buildFinanceLedger(ctx, config)
    expect(coldSessionIds()).toEqual([])
    expect(ledger.sessions[0].usage.uncachedInputTokens).toBe(100)
  })

  it('reads a session with no usage anywhere as zero', async () => {
    const { ctx } = makeCtx([
      { id: 'a', createdAt: 1000 },
    ], {
      'a': { title: 'No usage yet' },
    }, {
      'a': { title: 'No usage yet' },
    })
    const ledger = await buildFinanceLedger(ctx, config)
    expect(ledger.sessionCount).toBe(1)
    expect(ledger.sessions[0].usage).toEqual({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
    expect(ledger.sessions[0].costMicros).toBe(0)
  })

  it('sorts sessions newest-first and model rows by cost', async () => {
    const { ctx } = makeCtx([
      { id: 'old', createdAt: 1000 },
      { id: 'new', createdAt: 2000 },
    ], {
      'old': { financeUsage: usage(0, 100), title: 'Old' },
      'new': { financeUsage: usage(0, 200), title: 'New' },
    })
    const ledger = await buildFinanceLedger(ctx, config)
    expect(ledger.sessions.map(s => s.sessionId)).toEqual(['new', 'old'])
  })

  // The real-world regression: the host's v0→v1 session migration fail-loud
  // refuses a whole legacy log when one abort cause carries an extra member,
  // and the old ledger walk let that single session blank the dashboard.
  it('skips an unreadable session and reports it instead of failing the ledger', async () => {
    const warn = vi.fn()
    const { ctx } = makeCtx([
      { id: 'sess-ok', createdAt: 1000 },
      { id: 'sess-legacy', createdAt: 2000, origin: 'subagent', delegationDepth: 2 },
      { id: 'sess-also-ok', createdAt: 3000 },
    ], {
      'sess-ok': { financeUsage: usage(100, 50), title: 'OK' },
      'sess-also-ok': { financeUsage: usage(1, 1), title: 'Also OK' },
    }, {
      'sess-ok': { financeUsage: usage(100, 50), title: 'OK' },
      // 这条会话**没有检查点**（只有冷值）：命中缓存就不读日志，也就压不到
      // "读失败不毁账本"这条线 —— 所以它的缓存必须为空（2026-09-23）。
      'sess-legacy': { financeUsage: usage(9_000, 9_000), title: 'Legacy' },
      'sess-also-ok': { financeUsage: usage(1, 1), title: 'Also OK' },
    }, { unreadable: ['sess-legacy'], logger: { warn } })

    const ledger = await buildFinanceLedger(ctx, config)

    // The ledger still builds, and only the readable sessions are priced.
    expect(ledger.sessionCount).toBe(2)
    expect(ledger.sessions.map(s => s.sessionId).sort()).toEqual(['sess-also-ok', 'sess-ok'])
    expect(ledger.totals.uncachedInputTokens).toBe(101)
    expect(ledger.byModel).toHaveLength(1)
    expect(ledger.byWorkspace.every(row => row.sessionCount <= 2)).toBe(true)

    // …and the skipped session is reported for the dashboard warning.
    expect(ledger.unreadableSessions).toEqual([
      { sessionId: 'sess-legacy', createdAt: 2000, reason: UNREADABLE_REASON },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('sess-legacy')
  })

  it('reports an empty unreadable list when every session reads', async () => {
    const { ctx } = makeCtx([{ id: 'a', createdAt: 1000 }], { 'a': { financeUsage: usage(1, 1), title: 'A' } })
    const ledger = await buildFinanceLedger(ctx, config)
    expect(ledger.unreadableSessions).toEqual([])
  })

  it('propagates cancellation instead of reporting it as an unreadable session', async () => {
    const controller = new AbortController()
    const { ctx } = makeCtx([
      { id: 'a', createdAt: 1000 },
      { id: 'b', createdAt: 2000 },
    ], {
      'a': { financeUsage: usage(1, 1), title: 'A' },
    }, {
      'a': { financeUsage: usage(1, 1), title: 'A' },
      // 同上：没有检查点才会真的去读日志，取消才有机会从读取里抛出来。
      'b': { financeUsage: usage(1, 1), title: 'B' },
    }, { unreadable: ['b'] })

    controller.abort()
    await expect(buildFinanceLedger(ctx, config, controller.signal)).rejects.toThrow(UNREADABLE_REASON)
  })
})


/** A financeUsageHourly projection view: per-model per-UTC-hour buckets. */
function hourlyUsage(byModelHour: Record<string, Record<string, FinanceTokenBuckets>>): Record<string, unknown> {
  return { byModelHour }
}

const ERA_B = Date.UTC(2026, 7, 16, 16) // 2026-08-17T00:00:00+08:00

// Fixed "now" for the rolling 24h hour-of-day window: [2026-08-16T04:00Z,
// 2026-08-17T04:00Z), which contains both hourly fixture buckets below
// (2026-08-17T02 and 2026-08-16T19).
const HOUR_NOW_MS = Date.UTC(2026, 7, 17, 4)

const windowedFlash: FinancePriceEntry = {
  effectiveFrom: ERA_B,
  kind: 'windowed',
  rate: {
    offPeak: { inputMicrosPerMtok: 1_500_000, cacheReadMicrosPerMtok: 50_000, outputMicrosPerMtok: 4_500_000 },
    peak: { inputMicrosPerMtok: 3_000_000, cacheReadMicrosPerMtok: 100_000, outputMicrosPerMtok: 9_000_000 },
    peakHours: [[9, 12], [14, 18]],
    utcOffsetMinutes: 480,
  },
}

const windowedConfig: FinanceConfig = {
  ...config,
  prices: normalizeFinancePrices({ 'deepseek-official/deepseek-v4-flash': [windowedFlash] }),
}

describe('buildFinanceLedger with hourly usage', () => {
  it('prices each usage hour at its own peak/off-peak rate and keeps day rows exact', async () => {
    const { ctx } = makeCtx([
      { id: 'a', createdAt: ERA_B },
    ], {
      'a': {
        financeUsageHourly: hourlyUsage({
          'deepseek-official/deepseek-v4-flash': {
            // Beijing 10:00 -> peak
            '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
            // Beijing 03:00 -> off-peak
            '2026-08-16T19': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
        }),
        title: 'A',
      },
    })
    const ledger = await buildFinanceLedger(ctx, windowedConfig, undefined, { nowMs: HOUR_NOW_MS })
    const session = ledger.sessions[0]
    // 1M input at peak (3 CNY) + 1M input at off-peak (1.5 CNY)
    expect(session.costMicros).toBe(4_500_000)
    expect(session.usage.uncachedInputTokens).toBe(2_000_000)
    expect(session.modelKeys).toEqual(['deepseek-official/deepseek-v4-flash'])

    const day17 = ledger.byDay.find(d => d.day === '2026-08-17')!
    expect(day17.usage.uncachedInputTokens).toBe(1_000_000)
    expect(day17.costMicros).toBe(3_000_000)
    const day16 = ledger.byDay.find(d => d.day === '2026-08-16')!
    expect(day16.costMicros).toBe(1_500_000)

    const model = ledger.byModel.find(m => m.modelKey === 'deepseek-official/deepseek-v4-flash')!
    expect(model.usage.uncachedInputTokens).toBe(2_000_000)
    expect(model.costMicros).toBe(4_500_000)
    expect(model.provider).toBe('deepseek-official')
    expect(model.model).toBe('deepseek-v4-flash')
    const provider = ledger.byProvider.find(p => p.provider === 'deepseek-official')!
    expect(provider.costMicros).toBe(4_500_000)
    expect(provider.modelCount).toBe(1)

    // Aggregate rows stay consistent with the session total.
    expect(ledger.totalCostMicros).toBe(4_500_000)
    expect(ledger.totals.uncachedInputTokens).toBe(2_000_000)
    expect(ledger.byWorkspace[0].costMicros).toBe(4_500_000)
    expect(ledger.tasks[0].costMicros).toBe(4_500_000)
  })

  it('prices weekend peak hours at the off-peak rate (weekdays-only schedule)', async () => {
    // Saturday 2026-08-22 Beijing 10:00 falls inside a peak window but on a
    // weekend, so the weekdays-only schedule prices it off-peak.
    const SAT_10 = Date.UTC(2026, 7, 22, 2)
    const { ctx } = makeCtx([{ id: 'a', createdAt: ERA_B }], {
      'a': {
        financeUsageHourly: hourlyUsage({
          'deepseek-official/deepseek-v4-flash': {
            '2026-08-22T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
        }),
        title: 'A',
      },
    })
    const ledger = await buildFinanceLedger(ctx, windowedConfig, undefined, { nowMs: SAT_10 + 2 * 3_600_000 })
    expect(ledger.sessions[0].costMicros).toBe(1_500_000) // off-peak rate
    expect(ledger.peakValley.peakCostMicros).toBe(0)
    expect(ledger.peakValley.offPeakCostMicros).toBe(1_500_000)
    const flash = ledger.byModel.find(m => m.modelKey === 'deepseek-official/deepseek-v4-flash')!
    expect(flash.shiftSavingsMicros).toBe(0)
    const hour10 = ledger.byHourOfDay[10]
    expect(hour10.costMicros).toBe(1_500_000)
    expect(hour10.peakCostMicros).toBe(0)
    expect(hour10.shiftSavingsMicros).toBe(0)
  })

  it('prefers financeUsageHourly over financeUsage when both exist', async () => {
    const { ctx } = makeCtx([
      { id: 'a', createdAt: ERA_B },
    ], {
      'a': {
        financeUsage: usage(0, 999), // would price at the default rate if used
        financeUsageHourly: hourlyUsage({
          'deepseek-official/deepseek-v4-flash': {
            '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
        }),
        title: 'A',
      },
    })
    const ledger = await buildFinanceLedger(ctx, windowedConfig, undefined, { nowMs: HOUR_NOW_MS })
    expect(ledger.sessions[0].usage.uncachedInputTokens).toBe(1_000_000)
    expect(ledger.sessions[0].costMicros).toBe(3_000_000)
    expect(ledger.sessions[0].usage.outputTokens).toBe(0)
  })

  it('prices multi-model hourly usage per model and per hour', async () => {
    const { ctx } = makeCtx([
      { id: 'a', createdAt: ERA_B },
    ], {
      'a': {
        financeUsageHourly: hourlyUsage({
          'deepseek-official/deepseek-v4-flash': {
            '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
          'custom/my-model': {
            '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
        }),
        title: 'A',
      },
    })
    const ledger = await buildFinanceLedger(ctx, windowedConfig, undefined, { nowMs: HOUR_NOW_MS })
    const session = ledger.sessions[0]
    // flash peak (3 CNY) + unknown model at default (2 CNY)
    expect(session.costMicros).toBe(5_000_000)
    const custom = ledger.byModel.find(m => m.modelKey === 'custom/my-model')!
    expect(custom.costMicros).toBe(2_000_000)
    expect(custom.provider).toBe('custom')
    expect(custom.model).toBe('my-model')
    // Unknown models price at the flat default: no shift savings.
    expect(custom.shiftSavingsMicros).toBe(0)
    // Provider rollup folds the two providers' models into two rows.
    expect(ledger.byProvider).toHaveLength(2)
    const byCustom = ledger.byProvider.find(p => p.provider === 'custom')!
    expect(byCustom.costMicros).toBe(2_000_000)
    expect(byCustom.modelCount).toBe(1)
    expect(ledger.byProvider[0].provider).toBe('deepseek-official')
  })

  it('splits metered and plan costs when hostMeta marks a provider', async () => {
    // The route-level billingModes map is gone; classification flows from
    // hostMetaByProvider (per-provider), injected by the service layer.
    const { ctx } = makeCtx([{ id: 'a', createdAt: ERA_B }], {
      'a': {
        financeUsageHourly: hourlyUsage({
          'zai/glm-4.6': { '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
          'deepseek-official/deepseek-v4-flash': { '2026-08-17T02': { uncachedInputTokens: 2_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
        }),
        title: 'A',
      },
    })
    const planConfig: FinanceConfig = {
      ...windowedConfig,
      hostMetaByProvider: { ...windowedConfig.hostMetaByProvider, zai: 'plan' },
    }
    const ledger = await buildFinanceLedger(ctx, planConfig, undefined, { nowMs: HOUR_NOW_MS })
    // session total: peak flash (3 CNY/Mtok x 2M) + glm at default 2/Mtok = 8M
    expect(ledger.totalCostMicros).toBe(8_000_000)
    // plan share = the zai model only; metered reconciles to the rest.
    const glmRow = ledger.byModel.find(m => m.modelKey === 'zai/glm-4.6')!
    expect(glmRow.billingMode).toBe('plan')
    expect(ledger.planEquivalentCostMicros).toBe(glmRow.costMicros)
    expect(ledger.meteredCostMicros).toBe(ledger.totalCostMicros - ledger.planEquivalentCostMicros)
    const zaiProvider = ledger.byProvider.find(p => p.provider === 'zai')!
    expect(zaiProvider.billingMode).toBe('plan')
    expect(ledger.byProvider.find(p => p.provider === 'deepseek-official')!.billingMode).toBeUndefined()
  })

  it('rolls multiple models of one provider under a single byProvider mode', async () => {
    // With hostMetaByProvider as the only source of truth, a provider can no
    // longer mix plan/metered models — every model under the provider inherits
    // its single mode. The rollup stays consistent: 'plan' if the provider
    // is plan, otherwise the metered default.
    const { ctx } = makeCtx([{ id: 'a', createdAt: ERA_B }], {
      'a': {
        financeUsageHourly: hourlyUsage({
          'zai/glm-4.6': { '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
          'zai/api-only': { '2026-08-17T02': { uncachedInputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
        }),
        title: 'A',
      },
    })
    const planConfig: FinanceConfig = {
      ...windowedConfig,
      hostMetaByProvider: { ...windowedConfig.hostMetaByProvider, zai: 'plan' },
    }
    const ledger = await buildFinanceLedger(ctx, planConfig, undefined, { nowMs: HOUR_NOW_MS })
    expect(ledger.byModel.find(m => m.modelKey === 'zai/glm-4.6')!.billingMode).toBe('plan')
    expect(ledger.byModel.find(m => m.modelKey === 'zai/api-only')!.billingMode).toBe('plan')
    const zaiProvider = ledger.byProvider.find(p => p.provider === 'zai')!
    expect(zaiProvider.billingMode).toBe('plan')
    expect(zaiProvider.modelCount).toBe(2)
  })

  it('rolls multiple models of one provider into a single byProvider row', async () => {
    const { ctx } = makeCtx([{ id: 'a', createdAt: ERA_B }], {
      'a': {
        financeUsageHourly: hourlyUsage({
          'openai/gpt-4o': { '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
          'openai/gpt-4o-mini': { '2026-08-17T02': { uncachedInputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
          'anthropic/claude-opus': { '2026-08-17T02': { uncachedInputTokens: 200_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
        }),
        title: 'A',
      },
    })
    const configWithOpenAI: FinanceConfig = {
      ...windowedConfig,
      providerDefaults: { openai: { inputMicrosPerMtok: 4_000_000, outputMicrosPerMtok: 20_000_000 } },
    }
    const ledger = await buildFinanceLedger(ctx, configWithOpenAI, undefined, { nowMs: HOUR_NOW_MS })
    // openai/gpt-4o (1M @ 4) + openai/gpt-4o-mini (0.5M @ 4) = 6,000,000
    // anthropic/claude-opus (0.2M @ default 2) = 400,000
    const openai = ledger.byProvider.find(p => p.provider === 'openai')!
    expect(openai.costMicros).toBe(6_000_000)
    expect(openai.modelCount).toBe(2)
    expect(openai.usage.uncachedInputTokens).toBe(1_500_000)
    const anthropic = ledger.byProvider.find(p => p.provider === 'anthropic')!
    expect(anthropic.costMicros).toBe(400_000)
    expect(anthropic.modelCount).toBe(1)
    // Sorted by cost descending: openai first.
    expect(ledger.byProvider[0].provider).toBe('openai')
    // byModel rows still carry the split provider/model.
    const mini = ledger.byModel.find(m => m.modelKey === 'openai/gpt-4o-mini')!
    expect(mini.provider).toBe('openai')
    expect(mini.model).toBe('gpt-4o-mini')
  })
})

describe('buildFinanceLedger peak/valley split', () => {
  it('folds hourly usage into local hour-of-day buckets with a peak/off-peak split', async () => {
    const { ctx } = makeCtx([
      { id: 'a', createdAt: ERA_B },
    ], {
      'a': {
        financeUsageHourly: hourlyUsage({
          'deepseek-official/deepseek-v4-flash': {
            // Beijing 10:00 -> peak
            '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
            // Beijing 03:00 -> off-peak
            '2026-08-16T19': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
        }),
        title: 'A',
      },
    })
    const ledger = await buildFinanceLedger(ctx, windowedConfig, undefined, { nowMs: HOUR_NOW_MS })

    expect(ledger.byHourOfDay).toHaveLength(24)
    const hour10 = ledger.byHourOfDay[10]
    const hour3 = ledger.byHourOfDay[3]
    expect(hour10.localHour).toBe(10)
    expect(hour10.hourStartMs).toBe(Date.UTC(2026, 7, 17, 2)) // the real hour bucket
    expect(hour10.costMicros).toBe(3_000_000) // peak rate
    expect(hour10.peakCostMicros).toBe(3_000_000)
    expect(hour10.usage.uncachedInputTokens).toBe(1_000_000)
    expect(hour3.hourStartMs).toBe(Date.UTC(2026, 7, 16, 19))
    expect(hour3.costMicros).toBe(1_500_000) // off-peak rate
    expect(hour3.peakCostMicros).toBe(0)
    expect(ledger.byHourOfDay.filter(h => h.costMicros > 0).map(h => h.localHour)).toEqual([3, 10])
    // Per-hour shift savings: only the peak hour carries them.
    expect(hour10.shiftSavingsMicros).toBe(1_500_000)
    expect(hour3.shiftSavingsMicros).toBe(0)
    // Per-model shift savings on the exact path.
    const flash = ledger.byModel.find(m => m.modelKey === 'deepseek-official/deepseek-v4-flash')!
    expect(flash.shiftSavingsMicros).toBe(1_500_000)

    expect(ledger.peakValley.peakCostMicros).toBe(3_000_000)
    expect(ledger.peakValley.offPeakCostMicros).toBe(1_500_000)
    expect(ledger.peakValley.flatCostMicros).toBe(0)
    expect(ledger.peakValley.unclassifiedCostMicros).toBe(0)
    // The session started exactly when the windowed era begins: not legacy.
    expect(ledger.peakValley.legacyCostMicros).toBe(0)
    expect(ledger.windowedSinceMs).toBe(ERA_B)
    // The hour-of-day window is the fixed 24h clock injected above.
    expect(ledger.hourOfDayWindowStartMs).toBe(HOUR_NOW_MS - 24 * 3_600_000)
    // 1M input at peak (3 CNY) would cost 1.5 CNY off-peak: 1.5 CNY saved.
    expect(ledger.peakValley.shiftSavingsMicros).toBe(1_500_000)
    // The five split buckets are disjoint and sum to the ledger total.
    const sum = ledger.peakValley.peakCostMicros + ledger.peakValley.offPeakCostMicros
      + ledger.peakValley.flatCostMicros + ledger.peakValley.unclassifiedCostMicros
      + ledger.peakValley.legacyCostMicros
    expect(sum).toBe(ledger.totalCostMicros)
  })

  it('attributes fallback (hour-less) cost to unclassified', async () => {
    const { ctx } = makeCtx([
      { id: 'a', createdAt: 1000 },
    ], {
      'a': { financeUsage: usage(1_000_000, 0), title: 'A' },
    })
    const ledger = await buildFinanceLedger(ctx, config)
    expect(ledger.peakValley.peakCostMicros).toBe(0)
    expect(ledger.peakValley.offPeakCostMicros).toBe(0)
    expect(ledger.peakValley.flatCostMicros).toBe(0)
    expect(ledger.peakValley.unclassifiedCostMicros).toBe(ledger.totalCostMicros)
    expect(ledger.byHourOfDay.every(h => h.costMicros === 0)).toBe(true)
    expect(ledger.peakValley.shiftSavingsMicros).toBe(0)
  })

  it('prices pre-window sessions as legacy flat and keeps them out of peak/valley', async () => {
    // The shipped table shape: a flat launch era, then the windowed era.
    const eraConfig: FinanceConfig = {
      ...config,
      prices: normalizeFinancePrices({ 'deepseek-official/deepseek-v4-flash': [
        { inputMicrosPerMtok: 1_000_000, cacheReadMicrosPerMtok: 20_000, outputMicrosPerMtok: 2_000_000 },
        {
          effectiveFrom: '2026-08-17T00:00:00+08:00',
          offPeak: { inputMicrosPerMtok: 1_500_000, cacheReadMicrosPerMtok: 50_000, outputMicrosPerMtok: 4_500_000 },
          peak: { inputMicrosPerMtok: 3_000_000, cacheReadMicrosPerMtok: 100_000, outputMicrosPerMtok: 9_000_000 },
        },
      ] }),
    }
    // Session started one ms before the windowed era began; one of its usage
    // hours even falls AFTER the era start (Beijing 10:00 of Aug 17). Because
    // the session itself predates the era, peak/valley billing never applies:
    // the whole cost is the flat launch price and the peak/off-peak split and
    // hour-of-day chart stay empty for it.
    const { ctx } = makeCtx([
      { id: 'a', createdAt: ERA_B - 1 },
    ], {
      'a': {
        financeUsageHourly: hourlyUsage({
          'deepseek-official/deepseek-v4-flash': {
            // Beijing 10:00 on Aug 17 — a peak hour in the windowed era.
            '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
            // Beijing 03:00 on Aug 16 — before the era.
            '2026-08-16T19': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
        }),
        title: 'A',
      },
    })
    const ledger = await buildFinanceLedger(ctx, eraConfig)
    const session = ledger.sessions[0]
    // 2M input at the flat launch rate (1 CNY), never at peak/off-peak rates.
    expect(session.costMicros).toBe(2_000_000)
    expect(ledger.peakValley.legacyCostMicros).toBe(2_000_000)
    expect(ledger.peakValley.peakCostMicros).toBe(0)
    expect(ledger.peakValley.offPeakCostMicros).toBe(0)
    expect(ledger.peakValley.flatCostMicros).toBe(0)
    expect(ledger.peakValley.unclassifiedCostMicros).toBe(0)
    expect(ledger.peakValley.shiftSavingsMicros).toBe(0)
    // Legacy sessions contribute no bars to the hour-of-day chart.
    expect(ledger.byHourOfDay.every(h => h.costMicros === 0)).toBe(true)
    // Day rows still carry the exact flat-rate cost.
    expect(ledger.byDay.find(d => d.day === '2026-08-17')!.costMicros).toBe(1_000_000)
    expect(ledger.byDay.find(d => d.day === '2026-08-16')!.costMicros).toBe(1_000_000)
    // The four non-legacy buckets + legacy sum to the ledger total.
    const split = ledger.peakValley
    const sum = split.peakCostMicros + split.offPeakCostMicros + split.flatCostMicros
      + split.unclassifiedCostMicros + split.legacyCostMicros
    expect(sum).toBe(ledger.totalCostMicros)
  })

  it('exposes no windowed era when the table has only flat entries', async () => {
    const flatConfig: FinanceConfig = {
      ...config,
      prices: normalizeFinancePrices({ 'deepseek-official/deepseek-v4-flash': [{
        effectiveFrom: 0,
        kind: 'flat',
        rate: { inputMicrosPerMtok: 1_000_000, cacheReadMicrosPerMtok: 20_000, outputMicrosPerMtok: 2_000_000 },
      }] }),
    }
    const { ctx } = makeCtx([{ id: 'a', createdAt: 1000 }], {
      'a': { financeUsage: usage(1_000_000, 0), title: 'A' },
    })
    const ledger = await buildFinanceLedger(ctx, flatConfig, undefined, { nowMs: HOUR_NOW_MS })
    expect(ledger.windowedSinceMs).toBeNull()
    expect(ledger.peakValley.legacyCostMicros).toBe(0)
  })

  it('bands flat-era hourly usage as flat cost at its local hour', async () => {
    const flatConfig: FinanceConfig = {
      ...config,
      prices: normalizeFinancePrices({ 'deepseek-official/deepseek-v4-flash': [{
        effectiveFrom: 0,
        kind: 'flat',
        rate: { inputMicrosPerMtok: 1_000_000, cacheReadMicrosPerMtok: 20_000, outputMicrosPerMtok: 2_000_000 },
      }] }),
    }
    const { ctx } = makeCtx([
      { id: 'a', createdAt: 1000 },
    ], {
      'a': {
        financeUsageHourly: hourlyUsage({
          'deepseek-official/deepseek-v4-flash': {
            // Beijing 10:00 in the flat era: no window, so not a peak hour
            '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
        }),
        title: 'A',
      },
    })
    const ledger = await buildFinanceLedger(ctx, flatConfig, undefined, { nowMs: HOUR_NOW_MS })
    expect(ledger.peakValley.flatCostMicros).toBe(1_000_000)
    expect(ledger.peakValley.peakCostMicros).toBe(0)
    expect(ledger.peakValley.offPeakCostMicros).toBe(0)
    expect(ledger.peakValley.shiftSavingsMicros).toBe(0)
    expect(ledger.byHourOfDay[10].costMicros).toBe(1_000_000)
    expect(ledger.byHourOfDay[10].flatCostMicros).toBe(1_000_000)
    expect(ledger.byHourOfDay[10].peakCostMicros).toBe(0)
  })

  it('keeps only the last 24 hours in the hour-of-day buckets', async () => {
    const { ctx } = makeCtx([
      { id: 'a', createdAt: ERA_B },
    ], {
      'a': {
        financeUsageHourly: hourlyUsage({
          'deepseek-official/deepseek-v4-flash': {
            // 2026-08-17T02 is 2h AFTER the window end (now = 2026-08-17T00): dropped.
            '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
            // 2026-08-16T19 is inside [08-16T00, 08-17T00): kept (Beijing 03:00 off-peak).
            '2026-08-16T19': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
        }),
        title: 'A',
      },
    })
    const ledger = await buildFinanceLedger(ctx, windowedConfig, undefined, { nowMs: Date.UTC(2026, 7, 17, 0) })
    // Session totals stay full-ledger; only the hour buckets are windowed.
    expect(ledger.totalCostMicros).toBe(4_500_000)
    expect(ledger.byHourOfDay.filter(h => h.costMicros > 0).map(h => h.localHour)).toEqual([3])
    expect(ledger.byHourOfDay[3].costMicros).toBe(1_500_000)
    expect(ledger.byHourOfDay[10].costMicros).toBe(0)
    expect(ledger.peakValley.peakCostMicros).toBe(0)
    expect(ledger.peakValley.offPeakCostMicros).toBe(1_500_000)
    expect(ledger.peakValley.shiftSavingsMicros).toBe(0)
  })
})

describe('backfillFinanceHourly', () => {
  it('replays only sessions whose cached cut lacks the hourly unit', async () => {
    const { ctx, coldSnapshot, coldSessionIds } = makeCtx([
      { id: 'old', createdAt: 1000 },
      { id: 'new', createdAt: 2000 },
    ], {
      'old': { financeUsage: usage(100, 50), title: 'Old' },
      'new': { financeUsageHourly: hourlyUsage({
        'deepseek-official/deepseek-v4-flash': {
          '2026-08-17T02': { uncachedInputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
        },
      }), title: 'New' },
    })
    const result = await backfillFinanceHourly(ctx)
    expect(result.sessionCount).toBe(2)
    expect(result.rescanned).toBe(1)
    expect(coldSessionIds()).toContain('old')
    expect(coldSessionIds()).not.toContain('new')
  })

  it('replays sessions with no cached rows at all', async () => {
    const { ctx, coldSnapshot, coldSessionIds } = makeCtx([
      { id: 'a', createdAt: 1000 },
    ], {}, {
      'a': { tokenUsage: tokenUsage(1, 1), title: 'A' },
    })
    const result = await backfillFinanceHourly(ctx)
    expect(result.rescanned).toBe(1)
    expect(coldSessionIds()).toContain('a')
  })

  it('reports progress through the optional sink while scanning', async () => {
    const { ctx } = makeCtx([
      { id: 'old', createdAt: 1000 },
      { id: 'new', createdAt: 2000 },
    ], {
      'old': { financeUsage: usage(100, 50), title: 'Old' },
      'new': { financeUsageHourly: hourlyUsage({
        'deepseek-official/deepseek-v4-flash': {
          '2026-08-17T02': { uncachedInputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
        },
      }), title: 'New' },
    })
    const sink = { total: 0, scanned: 0, rescanned: 0 }
    const result = await backfillFinanceHourly(ctx, undefined, sink)
    expect(sink.total).toBe(2)
    expect(sink.scanned).toBe(2)
    expect(sink.rescanned).toBe(1)
    expect(result.rescanned).toBe(1)
  })

  // 2026-09-23 真机事故回归线：整段首算原先对**每个**会话无条件读完整日志
  // （open + read）之后才查检查点，于是 24 个会话 / 1.2G 的日志每轮被全量解码
  // （真机 profile：parseJson 24.9% 单核、宿主 145% CPU 约 30s、Web UI 卡死）。
  // 命中检查点的会话必须**一次都不打开日志**。
  it('serves a session whose cached cut carries the unit without reading its log', async () => {
    const { ctx, inspect, coldSessionIds } = makeCtx([
      { id: 'cached', createdAt: 1000 },
      { id: 'stale', createdAt: 2000 },
    ], {
      'cached': { financeUsageHourly: hourlyUsage({}), title: 'Cached' },
      'stale': { financeUsage: usage(10, 10), title: 'Stale' },
    })
    const result = await backfillFinanceHourly(ctx)
    expect(result.sessionCount).toBe(2)
    expect(result.rescanned).toBe(1)
    // 只有缺单元的 'stale' 被打开；'cached' 走 header 身份直接命中检查点。
    expect(inspect.mock.calls.map(call => call[0])).toEqual(['stale'])
    expect(coldSessionIds()).toEqual(['stale'])
  })

  it('still reads a seeded fork, whose inherited cut only the handle knows', async () => {
    const { ctx, inspect, coldSessionIds } = makeCtx([
      { id: 'fork', createdAt: 1000, isSeeded: true },
    ], {
      'fork': { financeUsageHourly: hourlyUsage({}), title: 'Fork' },
    })
    const result = await backfillFinanceHourly(ctx)
    expect(result.rescanned).toBe(0)
    // 身份算不出来 → 保守回退到读取；读到命中即不冷折。
    expect(inspect).toHaveBeenCalledOnce()
    expect(coldSessionIds()).toEqual([])
  })
})

