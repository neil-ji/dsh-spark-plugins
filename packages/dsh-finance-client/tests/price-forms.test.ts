import { describe, expect, it } from 'vitest'
import {
  EMPTY_PRICE_TABLE,
  newPriceEntry,
  newProviderRateRow,
  parsePriceTableDraft,
  parseProviderDefaultsDraft,
  parseRateDraft,
  seedPriceTable,
  seedProviderDefaults,
  validRateDraft,
} from '../src/client/price-forms.ts'

describe('parseRateDraft', () => {
  it('parses numbers and omits empty cache fields', () => {
    expect(parseRateDraft({ input: '2000000', cacheRead: '', cacheWrite: '', output: '8000000' }, false)).toEqual({
      inputMicrosPerMtok: 2000000,
      outputMicrosPerMtok: 8000000,
    })
  })

  it('treats optional fields as empty when omitted', () => {
    expect(parseRateDraft({ input: '1', cacheRead: '', cacheWrite: '', output: '2' }, false)).toEqual({ inputMicrosPerMtok: 1, outputMicrosPerMtok: 2 })
  })

  it('requires at least input or output when required', () => {
    expect(parseRateDraft({ input: '', cacheRead: '', cacheWrite: '', output: '' }, true)).toBeNull()
  })

  it('rejects negative and fractional micros', () => {
    expect(validRateDraft({ input: '-1', cacheRead: '', cacheWrite: '', output: '1' })).toBe(false)
    expect(validRateDraft({ input: '1.5', cacheRead: '', cacheWrite: '', output: '1' })).toBe(false)
  })
})

describe('parseProviderDefaultsDraft', () => {
  it('serializes rows into the wire map', () => {
    expect(parseProviderDefaultsDraft({ rows: [
      { provider: 'openai', rate: { input: '3600000', cacheRead: '900000', cacheWrite: '', output: '14400000' } },
    ] })).toEqual({ openai: { inputMicrosPerMtok: 3600000, cacheReadMicrosPerMtok: 900000, outputMicrosPerMtok: 14400000 } })
  })

  it('drops blank rows and returns null for an empty map', () => {
    expect(parseProviderDefaultsDraft({ rows: [{ provider: '', rate: { input: '', cacheRead: '', cacheWrite: '', output: '' } }] })).toBeNull()
  })

  it('rejects malformed rate rows', () => {
    const draft = { rows: [{ provider: 'zai', rate: { input: 'oops', cacheRead: '', cacheWrite: '', output: '' } }] }
    expect(parseProviderDefaultsDraft(draft)).toBeNull()
  })
})

describe('parsePriceTableDraft', () => {
  it('serializes flat entries with optional effectiveFrom', () => {
    const flat = newPriceEntry('flat')
    flat.flat = { input: '18000000', cacheRead: '9000000', cacheWrite: '', output: '72000000' }
    flat.effectiveFrom = '2026-01-01T00:00:00+08:00'
    const draft = { models: [{ modelKey: 'openai/gpt-4o', entries: [flat] }] }
    const parsed = parsePriceTableDraft(draft)
    expect(parsed).toEqual({ 'openai/gpt-4o': {
      effectiveFrom: '2026-01-01T00:00:00+08:00',
      inputMicrosPerMtok: 18000000,
      cacheReadMicrosPerMtok: 9000000,
      outputMicrosPerMtok: 72000000,
    } })
  })

  it('serializes windowed entries with the peak schedule', () => {
    const w = newPriceEntry('windowed')
    w.offPeak = { input: '1500000', cacheRead: '50000', cacheWrite: '', output: '4500000' }
    w.peak = { input: '3000000', cacheRead: '100000', cacheWrite: '', output: '9000000' }
    w.peakHours = '9-12, 14-18'
    w.peakDays = '1,2,3,4,5'
    const draft = { models: [{ modelKey: 'deepseek-official/deepseek-v4-flash', entries: [w] }] }
    const parsed = parsePriceTableDraft(draft) as Record<string, any>
    expect(parsed['deepseek-official/deepseek-v4-flash'].peakHours).toEqual([[9, 12], [14, 18]])
    expect(parsed['deepseek-official/deepseek-v4-flash'].peakDays).toEqual([1, 2, 3, 4, 5])
    expect(parsed['deepseek-official/deepseek-v4-flash'].peak.outputMicrosPerMtok).toBe(9000000)
  })

  it('rejects malformed hour ranges', () => {
    const w = newPriceEntry('windowed')
    w.offPeak = { input: '1', cacheRead: '', cacheWrite: '', output: '1' }
    w.peak = { input: '2', cacheRead: '', cacheWrite: '', output: '2' }
    w.peakHours = '9-25'
    expect(parsePriceTableDraft({ models: [{ modelKey: 'm', entries: [w] }] })).toBeNull()
  })
})

describe('seed functions', () => {
  it('seeds provider defaults from a wire map', () => {
    const draft = seedProviderDefaults({ openai: { inputMicrosPerMtok: 3600000, outputMicrosPerMtok: 14400000 } })
    expect(draft.rows).toHaveLength(1)
    expect(draft.rows[0].provider).toBe('openai')
    expect(draft.rows[0].rate.input).toBe('3600000')
  })

  it('seeds a single-entry price table and normalizes it to a list', () => {
    const draft = seedPriceTable({ 'openai/gpt-4o': { inputMicrosPerMtok: 18000000, outputMicrosPerMtok: 72000000 } })
    expect(draft.models[0].modelKey).toBe('openai/gpt-4o')
    expect(draft.models[0].entries[0].kind).toBe('flat')
    // An empty table seeds to the empty draft.
    expect(seedPriceTable(undefined)).toEqual(EMPTY_PRICE_TABLE)
  })
})