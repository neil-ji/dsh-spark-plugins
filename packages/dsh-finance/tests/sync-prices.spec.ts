import { describe, expect, it } from 'vitest'
import {
  MARKER_BEGIN,
  MARKER_END,
  collectRows,
  costToRate,
  normalizeProvider,
  renderYamlBody,
  splicePrices,
} from '../../../scripts/sync-finance-prices.mjs'

const doc = {
  openai: { models: {
    'gpt-4o': { cost: { input: 2.5, output: 10, cache_read: 1.25 } },
    'gpt-4o-20240806': { cost: { input: 2.5, output: 10 } },          // dated sibling dropped (8-digit suffix)
    'gpt-tts-mini': { cost: { input: 5, output: 40 } },                // non-token variant dropped
    'gpt-broken': {},                                                  // no cost -> dropped
  } },
  zai: { models: {
    'glm-4.6': { cost: { input: 0.6, output: 2.2, cache_read: 0.11, cache_write: 0 } },
    'glm-4.6-20250901': { cost: { input: 1, output: 1 } }, // dated sibling dropped (base exists)
  } },
  volcengine: { models: {
    'doubao-pro': { cost: { input: 0.475, output: 2.375 } },
    'doubao-lite-20250101': { cost: { input: 1, output: 1 } }, // lone dated snapshot: no base sibling -> kept
  } },
  'off-default-co': { models: { 'weird-model-20260102': { cost: { input: 1, output: 1 } } } }, // provider filtered out entirely
  cohere: { models: { 'command-x': { cost: { input: 3, output: 15 } } } }, // not requested by default
  mistral: { models: {} },                                           // empty provider skipped silently

}

describe('costToRate', () => {
  it('converts USD per Mtok into CNY integer micros with rounding', () => {
    // 0.14 USD x 7.2 fx = 1.008 CNY/Mtok = 1,008,000 micros (float rounds clean)
    expect(costToRate({ input: 0.14, output: 0.28 }, 7.2)).toEqual({
      inputMicrosPerMtok: 1008000,
      outputMicrosPerMtok: 2016000,
    })
  })

  it('maps cache lines when present and omits them when not', () => {
    expect(costToRate({ input: 1, output: 2, cache_read: 0.25, cache_write: 1 }, 7.2)).toEqual({
      inputMicrosPerMtok: 7200000,
      cacheReadMicrosPerMtok: 1800000,
      cacheWriteMicrosPerMtok: 7200000,
      outputMicrosPerMtok: 14400000,
    })
  })

  it('returns null for unusable costs', () => {
    expect(costToRate(undefined, 7.2)).toBeNull()
    expect(costToRate({}, 7.2)).toBeNull()
    expect(costToRate({ input: -1, output: 2 }, 7.2)).toBeNull()
  })
})

describe('collectRows', () => {
  const result = collectRows(doc)

  it('keeps only the requested providers, keyed as provider/model', () => {
    const keys = result.rows.map(r => r.modelKey)
    expect(keys).toContain('openai/gpt-4o')
    expect(keys).toContain('zai/glm-4.6')
    expect(keys).not.toContain('cohere/command-x')            // off the default list
    expect(keys).not.toContain('off-default-co/weird-model-20260102') // whole provider off-list
  })

  it('drops dated snapshots only when the undated sibling exists', () => {
    const keys = result.rows.map(r => r.modelKey)
    expect(keys).not.toContain('openai/gpt-4o-20240806')   // base present -> drop
    expect(keys).toContain('volcengine/doubao-lite-20250101') // no sibling -> keep
  })

  it('drops non-token variants and cost-less entries', () => {
    const keys = result.rows.map(r => r.modelKey)
    expect(keys).not.toContain('openai/gpt-tts-mini')
    expect(keys).not.toContain('openai/gpt-broken')
    expect(result.stats.droppedNonToken).toBe(1)
    expect(result.stats.droppedNoCost).toBe(1)
    expect(result.stats.droppedDated).toBe(2) // openai snapshot + zai snapshot both have base siblings
    expect(result.stats.kept).toBe(keys.length)
  })

  it('sorts rows deterministically', () => {
    const keys = result.rows.map(r => r.modelKey)
    expect([...keys].sort((a, b) => a.localeCompare(b))).toEqual(keys)
  })

  it('reports requested providers missing upstream', () => {
    const missing = collectRows(doc, { providers: ['volcengine', 'nowhere'] })
    expect(missing.stats.requestedMissing).toEqual(['nowhere'])
  })

  it('honors a custom provider list case-insensitively', () => {
    const custom = collectRows(doc, { providers: ['Cohere'] })
    expect(custom.rows.map(r => r.modelKey)).toEqual(['cohere/command-x'])
  })
})

describe('splicePrices', () => {
  const meta = { source: 'test', updated: '2026-08-27T06:00Z', fx: 7.2 }
  const body = renderYamlBody([{ modelKey: 'zai/glm-4.6', rate: { inputMicrosPerMtok: 4320000, outputMicrosPerMtok: 15840000 } }], meta)

  it('replaces an existing marker block in place', () => {
    const yml = [`        prices:`, `          ${MARKER_BEGIN} source=old updated=old fx=1`, `          openai/stale:`, `            - inputMicrosPerMtok: 1`, `              outputMicrosPerMtok: 1`, `          ${MARKER_END}`, ``, `    - id: ui-finance`].join('\n')
    const next = splicePrices(yml, body, meta)
    expect(next).toContain(MARKER_BEGIN + ' source=test updated=2026-08-27T06:00Z fx=7.2')
    expect(next).toContain('zai/glm-4.6:')
    expect(next).not.toContain('stale')
    expect(next.trimEnd().endsWith('- id: ui-finance')).toBe(true)
  })

  it('is idempotent: splicing twice yields one identical block', () => {
    const yml = [`        prices:`, `          ${MARKER_BEGIN} a=1`, `          ${MARKER_END}`].join('\n')
    const once = splicePrices(yml, body, meta)
    const twice = splicePrices(once, body, meta)
    expect(twice).toBe(once)
    expect((twice.match(new RegExp(MARKER_BEGIN, 'g')) ?? []).length).toBe(1)
  })

  it('throws on half-present markers instead of guessing', () => {
    expect(() => splicePrices(`x\n${MARKER_BEGIN}\ny`, body, meta)).toThrow(/half-present/)
  })
})

describe('normalizeProvider', () => {
  it('equals across separators so zai matches z_ai', () => {
    expect(normalizeProvider('Zai')).toBe(normalizeProvider('z_ai'))
    expect(normalizeProvider('volc-engine')).toBe('volcengine')
  })
})