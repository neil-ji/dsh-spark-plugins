import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFinanceBalance, FinanceBalanceError, microsFromDecimal } from '../src/balance.ts'
import type { FinanceConfig } from '../src/types.ts'

const config: FinanceConfig = {
  currency: 'CNY',
  balance: { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 1000 },
  defaultPrice: { inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 },
  prices: {},
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('microsFromDecimal', () => {
  it('parses whole and fractional decimals', () => {
    expect(microsFromDecimal('110')).toBe(110_000_000)
    expect(microsFromDecimal('10.5')).toBe(10_500_000)
    expect(microsFromDecimal('0.000001')).toBe(1)
    expect(microsFromDecimal('123.456789')).toBe(123_456_789)
  })
  it('rejects malformed values', () => {
    expect(microsFromDecimal(undefined)).toBeUndefined()
    expect(microsFromDecimal('')).toBeUndefined()
    expect(microsFromDecimal('abc')).toBeUndefined()
    expect(microsFromDecimal('-1')).toBeUndefined()
    expect(microsFromDecimal('1.2.3')).toBeUndefined()
  })
})

describe('fetchFinanceBalance', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('normalizes a successful response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      is_available: true,
      balance_infos: [{
        currency: 'CNY',
        total_balance: '110.000000',
        granted_balance: '10.000000',
        topped_up_balance: '100.000000',
      }],
    }))
    const view = await fetchFinanceBalance(config, 'sk-test')
    expect(view.status).toBe('ok')
    expect(view.isAvailable).toBe(true)
    expect(view.currency).toBe('CNY')
    expect(view.totalMicros).toBe(110_000_000)
    expect(view.grantedMicros).toBe(10_000_000)
    expect(view.toppedUpMicros).toBe(100_000_000)
  })

  it('selects the configured currency entry', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      balance_infos: [
        { currency: 'USD', total_balance: '5.00' },
        { currency: 'CNY', total_balance: '110.00' },
      ],
    }))
    const view = await fetchFinanceBalance(config, 'sk-test')
    expect(view.currency).toBe('CNY')
    expect(view.totalMicros).toBe(110_000_000)
  })

  it('sends the bearer header and never logs it', async () => {
    const call = vi.fn().mockResolvedValue(jsonResponse({ balance_infos: [{ currency: 'CNY', total_balance: '1' }] }))
    vi.mocked(fetch).mockImplementation(call)
    await fetchFinanceBalance(config, 'sk-secret-key')
    const [url, init] = call.mock.calls[0]
    expect(String(url)).toBe('https://api.deepseek.com/user/balance')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-secret-key')
  })

  it('maps 401/403 to auth', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, 401))
    await expect(fetchFinanceBalance(config, 'sk-test')).rejects.toMatchObject({ code: 'auth' })
  })

  it('maps 429 to rate-limit', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, 429))
    await expect(fetchFinanceBalance(config, 'sk-test')).rejects.toMatchObject({ code: 'rate-limit' })
  })

  it('maps non-ok to http', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, 500))
    await expect(fetchFinanceBalance(config, 'sk-test')).rejects.toMatchObject({ code: 'http' })
  })

  it('maps a missing balance_infos to invalid-response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}))
    await expect(fetchFinanceBalance(config, 'sk-test')).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('maps an invalid total to invalid-response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ balance_infos: [{ currency: 'CNY', total_balance: 'n/a' }] }))
    await expect(fetchFinanceBalance(config, 'sk-test')).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('maps a timed-out request to timeout', async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    await expect(fetchFinanceBalance(config, 'sk-test')).rejects.toBeInstanceOf(FinanceBalanceError)
    await expect(fetchFinanceBalance(config, 'sk-test')).rejects.toMatchObject({ code: 'timeout' })
  }, 5000)

  it('maps a network failure to network', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'))
    await expect(fetchFinanceBalance(config, 'sk-test')).rejects.toMatchObject({ code: 'network' })
  })
})
