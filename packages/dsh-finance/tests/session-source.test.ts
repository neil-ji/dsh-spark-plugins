/**
 * Cross-generation `ctx.sessionPersistence` compatibility (DSH 0.1.2 → 0.1.5).
 *
 * The 0.1.5 host replaced the flat read surface (`listSnapshots` / `inspect`)
 * with per-session handles (`list` / `open` → `read`). A build that calls the
 * old names unconditionally crashes the 财务/总览 tab with
 * `ctx.sessionPersistence.listSnapshots is not a function`; these tests pin the
 * probe that keeps both generations working.
 */
import { describe, expect, it, vi } from 'vitest'
import { inspectPersistenceSession, listPersistenceSnapshots } from '../src/session-source.ts'
import { buildFinanceLedger } from '../src/ledger.ts'
import type { FinanceConfig, FinanceUsageProjection } from '../src/types.ts'

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
}

function usage(uncachedInputTokens: number, outputTokens: number): FinanceUsageProjection {
  return {
    byModel: { 'deepseek-official/deepseek-v4-flash': { uncachedInputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens } },
    byDay: { '2026-01-15': { uncachedInputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens } },
    totals: { uncachedInputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens },
  }
}

/** The DSH ≤ 0.1.2 flat surface. */
function flatPersistence(headers: Header[]) {
  return {
    listSnapshots: vi.fn(async () => headers.map(header => ({ header, revision: 'rev-' + header.id }))),
    inspect: vi.fn(async (id: string) => ({
      meta: headers.find(header => header.id === id) ?? ({ id } as Header),
      inheritedEventCount: 0,
      events: [] as never[],
    })),
  }
}

/** The DSH ≥ 0.1.5 handle surface: `list` + `open(id,'read')` → `read`/`close`. */
function handlePersistence(headers: Header[]) {
  const close = vi.fn(async () => {})
  const read = vi.fn(async () => ({ eventState: 'owned' as const, events: [] as never[] }))
  const open = vi.fn(async (id: string) => ({
    header: headers.find(header => header.id === id) ?? ({ id } as Header),
    inheritedEventCount: 0,
    read,
    close,
  }))
  return {
    service: { list: vi.fn(async () => headers.map(header => ({ header, revision: 'rev-' + header.id }))), open },
    close,
    read,
    open,
  }
}

function ledgerCtx(sessionPersistence: object, projectionValues: Record<string, Record<string, unknown>>) {
  const coldSnapshot = vi.fn((meta: Header) => ({ asOfSeq: 1, values: projectionValues[meta.id] ?? {} }))
  return {
    ctx: {
      sessionPersistence,
      sessionProjectionCache: {
        cachedSnapshot: (meta: Header) => {
          const values = projectionValues[meta.id]
          if (values === undefined) return undefined
          // 命中缓存的切面默认带齐 P1-B / P2 两条腿：本文件测的是 persistence 代际
          // 兼容与"不多读日志"，"缺腿必须回冷折"那条线在 ledger.test.ts 里。
          const legs = { financeRate: { byModel: {} }, financeContext: { byModel: {} } }
          return { asOfSeq: 1, values: { ...legs, ...values } }
        },
        coldSnapshot,
      },
      workspaceRegistry: { list: () => [] },
    } as never,
    coldSnapshot,
  }
}

describe('sessionPersistence compatibility', () => {
  it('uses the flat surface when the host provides it (DSH 0.1.2)', async () => {
    const service = flatPersistence([{ id: 'a', createdAt: 1 }])
    const ctx = { sessionPersistence: service } as never
    await expect(listPersistenceSnapshots(ctx)).resolves.toHaveLength(1)
    await expect(inspectPersistenceSession(ctx, 'a')).resolves.toMatchObject({ inheritedEventCount: 0 })
    expect(service.listSnapshots).toHaveBeenCalledOnce()
    expect(service.inspect).toHaveBeenCalledOnce()
  })

  it('falls back to the handle surface on a 0.1.5 host and closes the handle', async () => {
    const { service, read, close, open } = handlePersistence([{ id: 'a', createdAt: 1 }])
    const ctx = { sessionPersistence: service } as never
    const signal = new AbortController().signal
    const snapshots = await listPersistenceSnapshots(ctx, signal)
    expect(snapshots).toHaveLength(1)
    const inspection = await inspectPersistenceSession(ctx, 'a', signal)
    expect(inspection.meta.id).toBe('a')
    expect(inspection.inheritedEventCount).toBe(0)
    expect(open).toHaveBeenCalledWith('a', 'read', { signal })
    expect(read).toHaveBeenCalledWith(0, undefined, { signal })
    expect(close).toHaveBeenCalledOnce()
  })

  it('forwards the abort signal to list() as an options object', async () => {
    const { service } = handlePersistence([])
    const ctx = { sessionPersistence: service } as never
    const signal = new AbortController().signal
    await listPersistenceSnapshots(ctx, signal)
    expect(service.list).toHaveBeenCalledWith({ signal })
  })

  it('omits the options argument entirely when there is no signal', async () => {
    const { service } = handlePersistence([])
    const ctx = { sessionPersistence: service } as never
    await listPersistenceSnapshots(ctx)
    expect(service.list).toHaveBeenCalledWith(undefined)
  })

  it('names the peer mismatch instead of throwing "is not a function"', async () => {
    const ctx = { sessionPersistence: {} } as never
    await expect(listPersistenceSnapshots(ctx)).rejects.toThrow(/unsupported ctx\.sessionPersistence API/)
    await expect(inspectPersistenceSession(ctx, 'a')).rejects.toThrow(/unsupported ctx\.sessionPersistence API/)
  })

  it('builds the ledger on a 0.1.5 host (the 总览 crash regression)', async () => {
    const { service, close } = handlePersistence([{ id: 'a', createdAt: 1000 }])
    const { ctx, coldSnapshot } = ledgerCtx(service, { 'a': { financeUsage: usage(100, 50), title: 'A' } })
    // Before the compat probe this rejected with
    // "ctx.sessionPersistence.listSnapshots is not a function".
    const ledger = await buildFinanceLedger(ctx, config)
    expect(ledger.sessionCount).toBe(1)
    expect(ledger.sessions[0]!.sessionId).toBe('a')
    expect(coldSnapshot).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })
})
