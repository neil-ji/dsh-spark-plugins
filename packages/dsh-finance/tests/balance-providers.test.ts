/**
 * Tests for `FinanceService.getBalance`'s per-provider `providers` map
 * (commit 12). Covers:
 *
 * - Legacy behavior preserved (empty providers list → fetch deepseek-official
 *   via the legacy single-provider view).
 * - Explicit deepseek-official entry with autoFetchBalance=true → real fetch.
 * - Explicit deepseek-official entry with autoFetchBalance=false →
 *   `unsupported` / `auto-fetch-disabled` (no fetch fires).
 * - Explicit deepseek-official entry with `billingMode: 'free'` →
 *   `unsupported` / `free-provider`.
 * - Unknown provider (not in `HOST_KNOWN_PROVIDER_META`) →
 *   `unsupported` / `unsupported-provider`.
 * - Multiple entries: deepseek + unknown both populated in one call.
 * - Missing credential: legacy `missing-credential` + per-provider slot
 *   reflects the same status.
 *
 * Uses the same fetch-mock pattern as `tests/balance.test.ts`. Credentials are
 * stubbed on the context directly — Cordis' Proxy lets us add a property
 * post-construction and the existing `ctx.credentials.resolve` call site will
 * pick it up.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FinanceService } from '../src/index.ts'
import type { FinanceProviderEntry } from '../src/types.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function dsEntry(overrides: Partial<FinanceProviderEntry> = {}): FinanceProviderEntry {
  return {
    provider: 'deepseek-official',
    billingMode: 'metered',
    totalPriceMicros: 0,
    currency: 'CNY',
    autoFetchBalance: true,
    ...overrides,
  }
}

function stubCredentials(ctx: Context, value: string | undefined): void {
  ;(ctx as unknown as { credentials: { resolve: ReturnType<typeof vi.fn> } }).credentials = {
    resolve: vi.fn(async () => value === undefined ? undefined : { value }),
  }
}

describe('FinanceService.getBalance providers map', () => {
  let originalFetch: typeof fetch
  let fake: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fake = vi.fn(async () => jsonResponse({
      balance_infos: [{ currency: 'CNY', total_balance: '110.000000' }],
    })) as typeof fetch
    globalThis.fetch = fake
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('preserves legacy behavior with empty providers list (auto-fetch deepseek)', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {})
    const view = await service.getBalance()
    expect(view.status).toBe('ok')
    expect(view.totalMicros).toBe(110_000_000)
    expect(view.providers).toEqual({
      'deepseek-official': {
        status: 'ok',
        provider: 'deepseek-official',
        totalMicros: 110_000_000,
        currency: 'CNY',
        fetchedAt: view.providers!['deepseek-official'].fetchedAt,
      },
    })
    expect(fake).toHaveBeenCalledOnce()
  })

  it('fetches deepseek when the explicit entry has autoFetchBalance=true', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [dsEntry({ autoFetchBalance: true })],
    })
    const view = await service.getBalance()
    expect(view.status).toBe('ok')
    expect(view.providers!['deepseek-official']!.status).toBe('ok')
    expect(view.providers!['deepseek-official']!.totalMicros).toBe(110_000_000)
    expect(fake).toHaveBeenCalledOnce()
  })

  it('skips the fetch when autoFetchBalance=false (auto-fetch-disabled)', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [dsEntry({ autoFetchBalance: false })],
    })
    const view = await service.getBalance()
    // Commit 19: the legacy view derives from the canonical per-provider slot,
    // so an unsupported slot surfaces as legacy `status: 'error'` with the
    // slot's code preserved (more accurate than the old `missing-credential`).
    expect(view.status).toBe('error')
    expect(view.code).toBe('auto-fetch-disabled')
    expect(view.providers!['deepseek-official']).toEqual({
      status: 'unsupported',
      provider: 'deepseek-official',
      code: 'auto-fetch-disabled',
      message: 'balance fetch is disabled for this entry',
      fetchedAt: view.providers!['deepseek-official']!.fetchedAt,
    })
    expect(fake).not.toHaveBeenCalled()
  })

  it('marks billingMode=free as free-provider (never fetches)', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [dsEntry({ billingMode: 'free', autoFetchBalance: true })],
    })
    const view = await service.getBalance()
    // Commit 19: free-provider surfaces as legacy `status: 'error'`.
    expect(view.status).toBe('error')
    expect(view.code).toBe('free-provider')
    expect(view.providers!['deepseek-official']).toMatchObject({
      status: 'unsupported',
      provider: 'deepseek-official',
      code: 'free-provider',
    })
    expect(fake).not.toHaveBeenCalled()
  })

  it('marks unknown providers as unsupported-provider', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'minimax-cn',
        billingMode: 'plan',
        totalPriceMicros: 100_000_000,
        currency: 'USD',
        autoFetchBalance: true,
      }],
    })
    const view = await service.getBalance()
    expect(view.providers!['minimax-cn']).toMatchObject({
      status: 'unsupported',
      provider: 'minimax-cn',
      code: 'unsupported-provider',
    })
    expect(view.providers!['minimax-cn']!.message).toContain('minimax-cn')
    // No deepseek entry, so no fetch should fire either.
    expect(fake).not.toHaveBeenCalled()
    // Commit 19: the canonical surface always carries a deepseek-official slot,
    // even when the user has no per-provider entry — the dashboard can render
    // a coherent "you have not configured this provider" empty state instead
    // of an undefined slot.
    expect(view.providers!['deepseek-official']).toMatchObject({
      status: 'unsupported',
      provider: 'deepseek-official',
      code: 'unsupported-provider',
    })
  })

  it('marks free unknown providers as free-provider', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'minimax-cn',
        billingMode: 'free',
        totalPriceMicros: 0,
        currency: 'CNY',
        autoFetchBalance: false,
      }],
    })
    const view = await service.getBalance()
    expect(view.providers!['minimax-cn']).toMatchObject({
      status: 'unsupported',
      code: 'free-provider',
    })
  })

  it('populates multiple entries in one call (deepseek + unknown)', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [
        dsEntry({ autoFetchBalance: true }),
        {
          provider: 'openai',
          billingMode: 'plan',
          totalPriceMicros: 50_000_000,
          currency: 'USD',
          autoFetchBalance: true,
        },
      ],
    })
    const view = await service.getBalance()
    expect(view.providers!['deepseek-official']!.status).toBe('ok')
    expect(view.providers!['openai']).toMatchObject({
      status: 'unsupported',
      code: 'unsupported-provider',
    })
    expect(fake).toHaveBeenCalledOnce()
  })

  it('surfaces missing-credential status in both legacy view and deepseek slot', async () => {
    const ctx = new Context()
    stubCredentials(ctx, undefined)
    const service = new FinanceService(ctx as never, {})
    const view = await service.getBalance()
    expect(view.status).toBe('missing-credential')
    expect(view.providers!['deepseek-official']).toMatchObject({
      status: 'missing-credential',
      provider: 'deepseek-official',
    })
    expect(fake).not.toHaveBeenCalled()
  })

  it('surfaces HTTP 5xx as error status on the deepseek slot', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({}, 503)) as typeof fetch
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {})
    const view = await service.getBalance()
    expect(view.status).toBe('error')
    expect(view.code).toBe('http')
    expect(view.providers!['deepseek-official']).toMatchObject({
      status: 'error',
      provider: 'deepseek-official',
      code: 'http',
    })
  })
})
