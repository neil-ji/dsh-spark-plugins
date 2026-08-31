import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FX,
  DEFAULT_PROVIDERS,
  MARKER_BEGIN,
  MARKER_END,
  SOURCE_URL,
  collectRows,
  costToRate,
  fetchCommunityPrices,
  normalizeProvider,
} from '../src/sync/community-prices.ts'

const doc = {
  openai: { models: {
    'gpt-4o': { cost: { input: 2.5, output: 10, cache_read: 1.25 } },
    'gpt-4o-20240806': { cost: { input: 2.5, output: 10 } },
    'gpt-tts-mini': { cost: { input: 5, output: 40 } },
    'gpt-broken': {},
  } },
  zai: { models: {
    'glm-4.6': { cost: { input: 0.6, output: 2.2, cache_read: 0.11, cache_write: 0 } },
    'glm-4.6-20250901': { cost: { input: 1, output: 1 } },
  } },
  volcengine: { models: {
    'doubao-pro': { cost: { input: 0.475, output: 2.375 } },
    'doubao-lite-20250101': { cost: { input: 1, output: 1 } },
  } },
  'off-default-co': { models: { 'weird-model-20260102': { cost: { input: 1, output: 1 } } } },
  cohere: { models: { 'command-x': { cost: { input: 3, output: 15 } } } },
  mistral: { models: {} },
}

describe('module constants', () => {
  it('exposes stable SOURCE_URL / MARKER_* / DEFAULT_FX / DEFAULT_PROVIDERS', () => {
    expect(SOURCE_URL).toBe('https://models.dev/api.json')
    expect(MARKER_BEGIN).toBe('# >>> FINANCE-COMMUNITY-PRICES-BEGIN')
    expect(MARKER_END).toBe('# <<< FINANCE-COMMUNITY-PRICES-END')
    expect(DEFAULT_FX).toBe(7.2)
    expect(DEFAULT_PROVIDERS).toEqual(['openai', 'anthropic', 'google', 'zai', 'volcengine'])
  })
})

describe('normalizeProvider', () => {
  it('equals across separators so zai matches z_ai', () => {
    expect(normalizeProvider('Zai')).toBe(normalizeProvider('z_ai'))
    expect(normalizeProvider('volc-engine')).toBe('volcengine')
  })
})

describe('costToRate', () => {
  it('converts USD per Mtok into CNY integer micros with rounding', () => {
    // 0.14 USD x 7.2 fx = 1.008 CNY/Mtok = 1,008,000 micros
    expect(costToRate({ input: 0.14, output: 0.28 }, 7.2)).toEqual({
      inputMicrosPerMtok: 1_008_000,
      outputMicrosPerMtok: 2_016_000,
    })
  })

  it('maps cache lines when present and omits them when not', () => {
    expect(costToRate({ input: 1, output: 2, cache_read: 0.25, cache_write: 1 }, 7.2)).toEqual({
      inputMicrosPerMtok: 7_200_000,
      cacheReadMicrosPerMtok: 1_800_000,
      cacheWriteMicrosPerMtok: 7_200_000,
      outputMicrosPerMtok: 14_400_000,
    })
  })

  it('returns null for unusable costs', () => {
    expect(costToRate(undefined, 7.2)).toBeNull()
    expect(costToRate({}, 7.2)).toBeNull()
    expect(costToRate({ input: -1, output: 2 }, 7.2)).toBeNull()
  })
})

describe('collectRows', () => {
  it('keeps only the requested providers, keyed as provider/model', () => {
    const { rows } = collectRows(doc)
    const keys = rows.map(r => r.modelKey)
    expect(keys).toContain('openai/gpt-4o')
    expect(keys).toContain('zai/glm-4.6')
    expect(keys).not.toContain('cohere/command-x')
    expect(keys).not.toContain('off-default-co/weird-model-20260102')
  })

  it('drops dated snapshots only when the undated sibling exists', () => {
    const { rows } = collectRows(doc)
    const keys = rows.map(r => r.modelKey)
    expect(keys).not.toContain('openai/gpt-4o-20240806')
    expect(keys).toContain('volcengine/doubao-lite-20250101')
  })

  it('drops non-token variants and cost-less entries', () => {
    const { stats } = collectRows(doc)
    expect(stats.droppedNonToken).toBe(1)
    expect(stats.droppedNoCost).toBe(1)
    expect(stats.droppedDated).toBe(2)
    expect(stats.kept).toBeGreaterThan(0)
  })

  it('sorts rows deterministically by modelKey', () => {
    const { rows } = collectRows(doc)
    expect(rows.map(r => r.modelKey)).toEqual([...rows.map(r => r.modelKey)].sort((a, b) => a.localeCompare(b)))
  })

  it('reports requested providers missing upstream', () => {
    const { stats } = collectRows(doc, { providers: ['volcengine', 'nowhere'] })
    expect(stats.requestedMissing).toEqual(['nowhere'])
  })

  it('honors a custom provider list case-insensitively', () => {
    const { rows } = collectRows(doc, { providers: ['Cohere'] })
    expect(rows.map(r => r.modelKey)).toEqual(['cohere/command-x'])
  })

  it('returns an empty bundle when the document is null/undefined', () => {
    const { rows, stats } = collectRows(null, { providers: ['openai'] })
    expect(rows).toEqual([])
    expect(stats.kept).toBe(0)
    expect(stats.requestedMissing).toEqual(['openai'])
  })
})

describe('fetchCommunityPrices', () => {
  it('returns the bundled shape from a synthetic fetch response', async () => {
    const fakeFetch: typeof fetch = async (input, init) => {
      expect(input).toBe(SOURCE_URL)
      expect(init?.signal).toBeDefined()
      return new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const result = await fetchCommunityPrices({ providers: ['openai', 'zai'] }, fakeFetch)
    expect(result.stats.kept).toBe(2)
    expect(result.rows.map(r => r.modelKey)).toEqual(['openai/gpt-4o', 'zai/glm-4.6'])
  })

  it('rethrows a non-2xx so the @Remote caller can convert to ok:false', async () => {
    const fakeFetch: typeof fetch = async () => new Response('boom', { status: 503 })
    await expect(fetchCommunityPrices({}, fakeFetch)).rejects.toThrow(/HTTP 503/)
  })

  it('rethrows a non-JSON body for the same path', async () => {
    const fakeFetch: typeof fetch = async () => new Response('not-json', { status: 200 })
    await expect(fetchCommunityPrices({}, fakeFetch)).rejects.toThrow(/JSON parse/)
  })
})
