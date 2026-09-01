/**
 * Tests for `FinanceService.listProviders` (commit 19).
 *
 * Covers:
 * - host-known registry seeds the source flag
 * - user-config entries seed the source flag and surface a userEntry in the row
 * - ledger-observed rows seed the source flag (uses the cached ledger)
 * - multiple sources collapse into a single row
 * - the per-row balance slot is populated by the shared resolver (fetch
 *   vs unsupported vs missing-credential)
 * - output is deterministic across reloads (sort: host-known, then user-config, then observed)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FinanceService } from '../src/index.ts'
import type { FinanceLedger } from '../src/types.ts'
import { backfillFinanceHourly } from '../src/ledger.ts'

vi.mock('../src/ledger.ts', () => ({
  backfillFinanceHourly: vi.fn(async () => undefined),
  buildFinanceLedger: vi.fn(async () => fakeLedger()),
}))

function fakeLedger(): FinanceLedger {
  return {
    generatedAt: 1,
    currency: 'CNY',
    totals: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
    totalCostMicros: 0,
    meteredCostMicros: 0,
    planEquivalentCostMicros: 0,
    sessionCount: 0,
    workspaceCount: 0,
    taskCount: 0,
    windowedSinceMs: null,
    hourOfDayWindowStartMs: 1,
    byDay: [],
    byModel: [],
    byProvider: [
      { provider: 'deepseek-official', usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, costMicros: 0, modelCount: 1 },
      { provider: 'observed-only', usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, costMicros: 0, modelCount: 1 },
    ],
    byWorkspace: [],
    tasks: [],
    sessions: [],
    byHourOfDay: [],
    peakValley: { peakCostMicros: 0, offPeakCostMicros: 0, flatCostMicros: 0, unclassifiedCostMicros: 0, legacyCostMicros: 0, shiftSavingsMicros: 0 },
  } as FinanceLedger
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubCredentials(ctx: Context, value: string | undefined): void {
  ;(ctx as unknown as { credentials: { resolve: ReturnType<typeof vi.fn> } }).credentials = {
    resolve: vi.fn(async () => value === undefined ? undefined : { value }),
  }
}

describe('FinanceService.listProviders', () => {
  let originalFetch: typeof fetch
  let fake: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fake = vi.fn(async () => jsonResponse({
      balance_infos: [{ currency: 'CNY', total_balance: '88.500000' }],
    }))
    globalThis.fetch = fake
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('seeds the host-known registry entry with source flag + hostMeta + a fetched balance when the user has opted in', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'deepseek-official',
        billingMode: 'metered',
        totalPriceMicros: 0,
        currency: 'CNY',
        autoFetchBalance: true,
      }],
    })

    // Warm the ledger cache so ledger-observed surfaces deterministically.
    await service.getLedger()

    const result = await service.listProviders()
    const dsRow = result.providers.find(p => p.provider === 'deepseek-official')
    expect(dsRow).toBeDefined()
    expect(dsRow!.sources).toContain('host-known')
    expect(dsRow!.sources).toContain('user-config')
    expect(dsRow!.sources).toContain('ledger-observed')
    expect(dsRow!.hostMeta?.defaultBillingMode).toBe('metered')
    expect(dsRow!.hostMeta?.defaultCurrency).toBe('CNY')
    expect(dsRow!.hostMeta?.supportsBalanceFetch).toBe(true)
    expect(dsRow!.hostMeta?.lockBillingModeAndCurrency).toBe(true)
    expect(dsRow!.balance.status).toBe('ok')
    expect(dsRow!.balance.totalMicros).toBe(88_500_000)
    expect(fake).toHaveBeenCalledOnce()
  })

  it('surfaces user-config entries with the userEntry populated', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'minimax-cn',
        billingMode: 'plan',
        totalPriceMicros: 100_000_000,
        currency: 'USD',
        autoFetchBalance: false,
      }],
    })
    await service.getLedger()

    const result = await service.listProviders()
    const mmRow = result.providers.find(p => p.provider === 'minimax-cn')
    expect(mmRow).toBeDefined()
    expect(mmRow!.sources).toContain('user-config')
    expect(mmRow!.userEntry?.billingMode).toBe('plan')
    expect(mmRow!.userEntry?.currency).toBe('USD')
    expect(mmRow!.hostMeta).toBeUndefined()
    expect(mmRow!.balance.status).toBe('unsupported')
    expect(mmRow!.balance.code).toBe('unsupported-provider')
  })

  it('surfaces ledger-observed providers without a user-config or host-known source', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never)
    await service.getLedger()

    const result = await service.listProviders()
    const observed = result.providers.find(p => p.provider === 'observed-only')
    expect(observed).toBeDefined()
    expect(observed!.sources).toEqual(['ledger-observed'])
    expect(observed!.userEntry).toBeUndefined()
    expect(observed!.hostMeta).toBeUndefined()
    expect(observed!.balance.status).toBe('unsupported')
    expect(observed!.balance.code).toBe('unsupported-provider')
  })

  it('sorts host-known first, then user-config, then ledger-observed', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'aaa-user-only',
        billingMode: 'plan',
        totalPriceMicros: 1_000_000,
        currency: 'CNY',
        autoFetchBalance: false,
      }],
    })
    await service.getLedger()

    const result = await service.listProviders()
    const ids = result.providers.map(p => p.provider)
    // host-known: deepseek-official (only one today)
    // user-config: aaa-user-only
    // ledger-observed: observed-only (no user entry)
    expect(ids.indexOf('deepseek-official')).toBeLessThan(ids.indexOf('aaa-user-only'))
    expect(ids.indexOf('aaa-user-only')).toBeLessThan(ids.indexOf('observed-only'))
  })

  it('emits a fresh generatedAt per call', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never)
    await service.getLedger()

    const first = await service.listProviders()
    await new Promise(r => setTimeout(r, 2))
    const second = await service.listProviders()
    expect(second.generatedAt).toBeGreaterThanOrEqual(first.generatedAt)
  })

  it('merges the dsh-llm runtime registry as the `llm-runtime` source', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    // Stub the dsh-llm runtime: three providers the user has registered
    // through the dsh-llm settings UI. One of them is also host-known
    // (deepseek-official), the other two are runtime-only.
    ;(ctx as { llm: { listProviders: () => readonly { id: string; name: string }[] } }).llm = {
      listProviders: () => [
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'minimax-cn', name: 'minimax-cn' },
        { id: 'volcengine-ark', name: '火山引擎' },
      ],
    }
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'deepseek-official',
        billingMode: 'metered',
        totalPriceMicros: 0,
        currency: 'CNY',
        autoFetchBalance: true,
      }],
    })
    await service.getLedger()

    const result = await service.listProviders()
    const ids = result.providers.map(p => p.provider)
    // The runtime source surfaces volcengine-ark even though it has no
    // host-known metadata, no user entry, and no observed ledger row.
    expect(ids).toContain('volcengine-ark')
    const volcRow = result.providers.find(p => p.provider === 'volcengine-ark')
    expect(volcRow?.sources).toEqual(['llm-runtime'])
    expect(volcRow?.hostMeta).toBeUndefined()
    expect(volcRow?.userEntry).toBeUndefined()

    // deepseek-official picks up the `llm-runtime` flag alongside its
    // host-known + user-config + ledger-observed sources.
    const dsRow = result.providers.find(p => p.provider === 'deepseek-official')
    expect(dsRow?.sources).toContain('host-known')
    expect(dsRow?.sources).toContain('user-config')
    expect(dsRow?.sources).toContain('ledger-observed')
    expect(dsRow?.sources).toContain('llm-runtime')

    // minimax-cn only has the llm-runtime source today (no host-known
    // metadata, no user entry, no observed rows) — it still shows up.
    const mmRow = result.providers.find(p => p.provider === 'minimax-cn')
    expect(mmRow?.sources).toEqual(['llm-runtime'])

    // llm-runtime ranks below the other three sources in the stable order.
    expect(ids.indexOf('deepseek-official')).toBeLessThan(ids.indexOf('volcengine-ark'))
  })

  it('keeps working when the dsh-llm runtime is absent', async () => {
    // A real Context with no llm service installed: the try/catch in
    // listProviders should swallow the read and the other three sources
    // still resolve.
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never)
    await service.getLedger()

    const result = await service.listProviders()
    const ids = result.providers.map(p => p.provider)
    expect(ids).toContain('deepseek-official')
    // No runtime registrations means no source 'llm-runtime' on any row.
    expect(result.providers.some(p => p.sources.includes('llm-runtime'))).toBe(false)
  })
})
