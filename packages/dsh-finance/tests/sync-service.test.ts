import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FinanceService } from '../src/index.ts'
import { SOURCE_URL } from '../src/sync/community-prices.ts'

const fakeModelDoc = {
  openai: { models: {
    'gpt-4o': { cost: { input: 2.5, output: 10, cache_read: 1.25 } },
  } },
  zai: { models: {
    'glm-4.6': { cost: { input: 0.6, output: 2.2, cache_read: 0.11 } },
  } },
  anthropic: { models: {} },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('FinanceService community sync', () => {
  let originalFetch: typeof fetch
  let fake: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fake = vi.fn(async () => jsonResponse(fakeModelDoc)) as typeof fetch
    globalThis.fetch = fake
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('bootstraps with empty community + user + composition prices', () => {
    const ctx = new Context()
    const service = new FinanceService(ctx as never, {
      currency: 'CNY',
      balance: { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 1000 },
      defaultPrice: { inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 },
      prices: { 'deepseek-official/v4': [{ effectiveFrom: 0, kind: 'flat', rate: { inputMicrosPerMtok: 1000, outputMicrosPerMtok: 2000 } }] },
    })
    expect(service.getCommunityPrices()).toEqual({})
  })

  it('syncCommunityPrices writes the in-memory layer and reports keep/drop stats', async () => {
    const ctx = new Context()
    const service = new FinanceService(ctx as never, {})
    const result = await service.syncCommunityPrices()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).toBe(SOURCE_URL)
    expect(result.appliedAt).toBeGreaterThan(0)
    expect(result.fx).toBe(7.2)
    expect(result.requestedProviders).toEqual(['openai', 'anthropic', 'google', 'zai', 'volcengine'])
    expect(result.kept).toBe(2)
    expect(result.providers).toEqual(['openai', 'zai'])

    const layer = service.getCommunityPrices()
    expect(Object.keys(layer).sort()).toEqual(['openai/gpt-4o', 'zai/glm-4.6'])
  })

  it('getSyncStatus mirrors the last success and is null before any sync', async () => {
    const ctx = new Context()
    const service = new FinanceService(ctx as never, {})
    expect(await service.getSyncStatus()).toBeNull()
    const r1 = await service.syncCommunityPrices()
    expect(r1.ok).toBe(true)
    const status = await service.getSyncStatus()
    expect(status?.source).toBe(SOURCE_URL)
    expect(status?.kept).toBe(2)
    expect(status?.fx).toBe(7.2)
    expect(status?.providers.sort()).toEqual(['openai', 'zai'])
  })

  it('preserves the prior community layer when a sync fails (ok:false)', async () => {
    const ctx = new Context()
    const service = new FinanceService(ctx as never, {})

    // First sync succeeds
    const ok = await service.syncCommunityPrices()
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    const before = JSON.stringify(service.getCommunityPrices())

    // Next sync fails
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 503 })) as typeof fetch
    const failed = await service.syncCommunityPrices()
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.error?.message).toMatch(/HTTP 503/)

    // Layer untouched
    expect(JSON.stringify(service.getCommunityPrices())).toBe(before)

    // Status still reflects the previous success
    const status = await service.getSyncStatus()
    expect(status?.appliedAt).toBe(ok.appliedAt)
  })

  it('honors custom provider list and fx overrides', async () => {
    const ctx = new Context()
    const service = new FinanceService(ctx as never, {})
    const result = await service.syncCommunityPrices({ providers: ['openai'], fx: 7.5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.requestedProviders).toEqual(['openai'])
    expect(result.fx).toBe(7.5)
    expect(result.kept).toBe(1)
  })
})
