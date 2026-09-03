/**
 * Tests for `FinanceService.refreshBalance` (commit 19).
 *
 * Covers:
 * - deepseek-official with autoFetchBalance=true fires the fetch
 * - deepseek-official with autoFetchBalance=false still fires the fetch
 *   (the user just clicked the refresh button — that's the whole point of
 *   the method)
 * - an unknown provider returns `unsupported-provider` without firing
 * - a billingMode=free provider returns `free-provider` without firing
 * - an entry with `autoFetchBalance=false` and `billingMode='metered'` (host
 *   knows the provider but the user disabled auto-fetch) returns
 *   `unsupported-provider` only because no fetch-capable provider id other
 *   than deepseek-official exists today — the slot still goes through the
 *   resolver.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FinanceService } from '../src/index.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubCredentials(ctx: Context, value: string | undefined): void {
  ;(ctx as unknown as { credentials: { resolve: ReturnType<typeof vi.fn> } }).credentials = {
    resolve: vi.fn(async () => value === undefined ? undefined : { value }),
  }
}

describe('FinanceService.refreshBalance', () => {
  let originalFetch: typeof fetch
  let fake: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fake = vi.fn(async () => jsonResponse({
      balance_infos: [{ currency: 'CNY', total_balance: '5.000000' }],
    }))
    globalThis.fetch = fake
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('refreshes deepseek-official when the user has autoFetchBalance=true', async () => {
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
    const slot = await service.refreshBalance({ provider: 'deepseek-official' })
    expect(slot.status).toBe('ok')
    expect(slot.provider).toBe('deepseek-official')
    expect(slot.totalMicros).toBe(5_000_000)
    expect(slot.fetchedAt).toBeGreaterThan(0)
    expect(fake).toHaveBeenCalledOnce()
  })

  it('still fires the fetch when the user disabled autoFetchBalance (force override)', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'deepseek-official',
        billingMode: 'metered',
        totalPriceMicros: 0,
        currency: 'CNY',
        autoFetchBalance: false,
      }],
    })
    const slot = await service.refreshBalance({ provider: 'deepseek-official' })
    expect(slot.status).toBe('ok')
    expect(slot.totalMicros).toBe(5_000_000)
    expect(fake).toHaveBeenCalledOnce()
  })

  it('returns missing-credential when no credential is configured', async () => {
    const ctx = new Context()
    stubCredentials(ctx, undefined)
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'deepseek-official',
        billingMode: 'metered',
        totalPriceMicros: 0,
        currency: 'CNY',
        autoFetchBalance: true,
      }],
    })
    const slot = await service.refreshBalance({ provider: 'deepseek-official' })
    expect(slot.status).toBe('missing-credential')
    expect(slot.provider).toBe('deepseek-official')
    expect(fake).not.toHaveBeenCalled()
  })

  it('falls back to the deepseek provider credential when the custom balance env is unset', async () => {
    const ctx = new Context()
    // Only the deepseek-official LLM adapter's default ref resolves; the
    // custom balance env (balance.apiKeyEnv) has no stored value.
    ;(ctx as unknown as { credentials: { resolve: ReturnType<typeof vi.fn> } }).credentials = {
      resolve: vi.fn(async (ref: string) => ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-test' } : undefined),
    }
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'deepseek-official',
        billingMode: 'metered',
        totalPriceMicros: 0,
        currency: 'CNY',
        autoFetchBalance: true,
      }],
      balance: { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'MY_CUSTOM_BALANCE_KEY', timeoutMs: 10000 },
    })
    const slot = await service.refreshBalance({ provider: 'deepseek-official' })
    expect(slot.status).toBe('ok')
    expect(slot.totalMicros).toBe(5_000_000)
    expect(fake).toHaveBeenCalledOnce()
  })

  it('returns unsupported-provider for an unknown provider id', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'minimax-cn',
        billingMode: 'plan',
        totalPriceMicros: 1_000_000,
        currency: 'USD',
        autoFetchBalance: true,
      }],
    })
    const slot = await service.refreshBalance({ provider: 'minimax-cn' })
    expect(slot.status).toBe('unsupported')
    expect(slot.provider).toBe('minimax-cn')
    expect(slot.code).toBe('unsupported-provider')
    expect(fake).not.toHaveBeenCalled()
  })

  it('returns free-provider without firing when billingMode is free', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never, {
      providers: [{
        provider: 'minimax-cn',
        billingMode: 'free',
        totalPriceMicros: 0,
        currency: 'CNY',
        autoFetchBalance: true,
      }],
    })
    const slot = await service.refreshBalance({ provider: 'minimax-cn' })
    expect(slot.status).toBe('unsupported')
    expect(slot.provider).toBe('minimax-cn')
    expect(slot.code).toBe('free-provider')
    expect(fake).not.toHaveBeenCalled()
  })

  it('returns unsupported-provider when the provider has no per-provider entry at all', async () => {
    const ctx = new Context()
    stubCredentials(ctx, 'sk-test')
    const service = new FinanceService(ctx as never)
    const slot = await service.refreshBalance({ provider: 'never-seen' })
    expect(slot.status).toBe('unsupported')
    expect(slot.code).toBe('unsupported-provider')
    expect(slot.provider).toBe('never-seen')
    expect(fake).not.toHaveBeenCalled()
  })
})
