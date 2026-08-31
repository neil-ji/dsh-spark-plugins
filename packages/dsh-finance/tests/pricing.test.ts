import { describe, expect, it } from 'vitest'
import {
  addFinanceBuckets,
  DEFAULT_UTC_OFFSET_MINUTES,
  emptyFinanceBuckets,
  financeBaseCostMicros,
  financeBaseRate,
  financeBillingMode,
  financeBucketCostMicros,
  financeCostByModelHour,
  financeEntryFor,
  financeHourTime,
  financeLocalDay,
  financeModelKey,
  financeModelOf,
  financeProviderDefault,
  financeProviderOf,
  financeRateAt,
  financeWindowedSince,
  financeWindowInfo,
  isPeakLocalDay,
  isPeakLocalHour,
  mergePriceLayers,
  normalizeFinanceConfig,
  normalizeFinancePrices,
} from '../src/pricing.ts'
import type { FinanceConfig, FinancePriceEntry } from '../src/types.ts'

const config: FinanceConfig = {
  currency: 'CNY',
  balance: { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 10000 },
  defaultPrice: {
    inputMicrosPerMtok: 2_000_000,
    cacheReadMicrosPerMtok: 500_000,
    cacheWriteMicrosPerMtok: 2_000_000,
    outputMicrosPerMtok: 8_000_000,
  },
  prices: {},
}

/** 2026-08-17T02:00Z = Beijing 10:00 (peak window), after the peak/valley era. */
const PEAK_TIME = Date.UTC(2026, 7, 17, 2)
/** 2026-08-16T19:00Z = Beijing 03:00 (off-peak), after the peak/valley era. */
const OFFPEAK_TIME = Date.UTC(2026, 7, 16, 19)
/** 2026-08-17T00:00:00+08:00 = the moment the peak/valley era begins. */
const ERA_B = Date.UTC(2026, 7, 16, 16)

const FLASH_FLAT: FinancePriceEntry = {
  effectiveFrom: 0,
  kind: 'flat',
  rate: { inputMicrosPerMtok: 1_000_000, cacheReadMicrosPerMtok: 20_000, outputMicrosPerMtok: 2_000_000 },
}

const FLASH_WINDOWED: FinancePriceEntry = {
  effectiveFrom: ERA_B,
  kind: 'windowed',
  rate: {
    offPeak: { inputMicrosPerMtok: 1_500_000, cacheReadMicrosPerMtok: 50_000, outputMicrosPerMtok: 4_500_000 },
    peak: { inputMicrosPerMtok: 3_000_000, cacheReadMicrosPerMtok: 100_000, outputMicrosPerMtok: 9_000_000 },
    peakHours: [[9, 12], [14, 18]],
    utcOffsetMinutes: 480,
  },
}

function flashConfig(prices: FinancePriceEntry[]): FinanceConfig {
  return { ...config, prices: { 'deepseek-official/deepseek-v4-flash': prices } }
}

describe('pricing', () => {
  it('builds the provider/model key vocabulary', () => {
    expect(financeModelKey('deepseek-official', 'deepseek-v4-flash')).toBe('deepseek-official/deepseek-v4-flash')
  })

  it('splits a model key back into provider and model', () => {
    expect(financeProviderOf('openai/gpt-4o')).toBe('openai')
    expect(financeModelOf('openai/gpt-4o')).toBe('gpt-4o')
    expect(financeProviderOf('bare-model')).toBe('bare-model')
    expect(financeModelOf('bare-model')).toBe('bare-model')
  })

  it('returns zero buckets', () => {
    expect(emptyFinanceBuckets()).toEqual({
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    })
  })

  it('adds buckets field by field', () => {
    expect(addFinanceBuckets(
      { uncachedInputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3, outputTokens: 4 },
      { uncachedInputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 40 },
    )).toEqual({ uncachedInputTokens: 11, cacheReadTokens: 22, cacheWriteTokens: 33, outputTokens: 44 })
  })

  it('prices 1M input tokens at 2 CNY (2,000,000 micros)', () => {
    const buckets = { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
    expect(financeBucketCostMicros(buckets, config.defaultPrice)).toBe(2_000_000)
  })

  it('prices 1M output tokens at 8 CNY (8,000,000 micros)', () => {
    const buckets = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 }
    expect(financeBucketCostMicros(buckets, config.defaultPrice)).toBe(8_000_000)
  })

  it('prices 1M cache-read tokens at 0.5 CNY and 1M cache-write at 2 CNY', () => {
    const buckets = { uncachedInputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000, outputTokens: 0 }
    expect(financeBucketCostMicros(buckets, config.defaultPrice)).toBe(2_500_000)
  })

  it('rounds fractional micros to the nearest micro', () => {
    const buckets = { uncachedInputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1, outputTokens: 1 }
    // 2 micro + 0.5 micro (rounds to 1) + 2 micro + 8 micro = 13 micros
    expect(financeBucketCostMicros(buckets, config.defaultPrice)).toBe(13)
  })

  it('falls back to the flat default rate for unknown models at any time', () => {
    const buckets = { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
    expect(financeRateAt(config, 'unknown/model', PEAK_TIME)).toBe(config.defaultPrice)
    expect(financeBucketCostMicros(buckets, financeRateAt(config, 'unknown/model', PEAK_TIME))).toBe(2_000_000)
  })

  it('prices unknown models of a configured provider at its per-provider default', () => {
    const openaiDefault = { inputMicrosPerMtok: 10_000_000, cacheReadMicrosPerMtok: 2_500_000, outputMicrosPerMtok: 40_000_000 }
    const custom: FinanceConfig = {
      ...config,
      providerDefaults: { openai: openaiDefault },
    }
    const buckets = { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 }
    expect(financeProviderDefault(custom, 'openai/gpt-4o')).toBe(openaiDefault)
    expect(financeRateAt(custom, 'openai/gpt-4o', PEAK_TIME)).toBe(openaiDefault)
    // 1M input at 10 + 1M output at 40 = 50,000,000 micros
    expect(financeBucketCostMicros(buckets, financeRateAt(custom, 'openai/gpt-4o', PEAK_TIME))).toBe(50_000_000)
  })

  it('still falls back to the global default for providers without a default', () => {
    const custom: FinanceConfig = {
      ...config,
      providerDefaults: { openai: { inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 } },
    }
    expect(financeProviderDefault(custom, 'anthropic/claude-opus')).toBe(config.defaultPrice)
    expect(financeRateAt(custom, 'anthropic/claude-opus', PEAK_TIME)).toBe(config.defaultPrice)
  })

  it('prices hour-less unknown models at the provider default rate', () => {
    const openaiDefault = { inputMicrosPerMtok: 10_000_000, cacheReadMicrosPerMtok: 2_500_000, outputMicrosPerMtok: 40_000_000 }
    const custom: FinanceConfig = { ...config, providerDefaults: { openai: openaiDefault } }
    const buckets = { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
    expect(financeBaseCostMicros(custom, 'openai/gpt-4o', buckets, OFFPEAK_TIME)).toBe(10_000_000)
  })

  it('reports unknown models of a configured provider as flat at its default rate', () => {
    const openaiDefault = { inputMicrosPerMtok: 10_000_000, cacheReadMicrosPerMtok: 2_500_000, outputMicrosPerMtok: 40_000_000 }
    const custom: FinanceConfig = { ...config, providerDefaults: { openai: openaiDefault } }
    const info = financeWindowInfo(custom, 'openai/gpt-4o', PEAK_TIME)
    expect(info.band).toBe('flat')
    expect(info.rate).toBe(openaiDefault)
  })

  it('recognizes the DeepSeek peak windows (Beijing hours)', () => {
    expect(isPeakLocalHour(9)).toBe(true)
    expect(isPeakLocalHour(11)).toBe(true)
    expect(isPeakLocalHour(12)).toBe(false) // window is half-open [9,12)
    expect(isPeakLocalHour(14)).toBe(true)
    expect(isPeakLocalHour(17)).toBe(true)
    expect(isPeakLocalHour(18)).toBe(false)
    expect(isPeakLocalHour(3)).toBe(false)
    expect(isPeakLocalHour(13)).toBe(false)
  })

  it('treats weekdays as peak days and weekends as off-peak by default', () => {
    expect(isPeakLocalDay(1)).toBe(true) // Monday
    expect(isPeakLocalDay(5)).toBe(true) // Friday
    expect(isPeakLocalDay(0)).toBe(false) // Sunday
    expect(isPeakLocalDay(6)).toBe(false) // Saturday
    // An explicit all-days schedule opts out of the weekdays-only default.
    expect(isPeakLocalDay(6, [0, 1, 2, 3, 4, 5, 6])).toBe(true)
  })

  it('maps an epoch moment to the local day of week on the entry clock', () => {
    // 2026-08-17 is a Monday; UTC and Beijing (UTC+8) agree on the date here.
    expect(financeLocalDay(PEAK_TIME, DEFAULT_UTC_OFFSET_MINUTES)).toBe(1)
    // 2026-08-15 is a Saturday.
    expect(financeLocalDay(Date.UTC(2026, 7, 15, 2), DEFAULT_UTC_OFFSET_MINUTES)).toBe(6)
  })

  it('prices weekend peak hours at the off-peak rate (weekdays-only schedule)', () => {
    const custom = flashConfig([FLASH_WINDOWED])
    // Saturday 2026-08-22 Beijing 10:00 -> off-peak despite the peak window.
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', Date.UTC(2026, 7, 22, 2))).toEqual(FLASH_WINDOWED.rate.offPeak)
    // Sunday 2026-08-23 Beijing 10:00 -> off-peak too.
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', Date.UTC(2026, 7, 23, 2))).toEqual(FLASH_WINDOWED.rate.offPeak)
    // Monday 2026-08-17 Beijing 10:00 stays peak.
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', PEAK_TIME)).toEqual(FLASH_WINDOWED.rate.peak)
  })

  it('honors an explicit peakDays schedule', () => {
    const custom = flashConfig([{
      effectiveFrom: 0,
      kind: 'windowed',
      rate: {
        ...FLASH_WINDOWED.rate,
        peakDays: [0, 6], // weekend-only peaks
      },
    }])
    // Saturday Beijing 10:00 -> peak on a weekend-only schedule.
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', Date.UTC(2026, 7, 22, 2))).toEqual(FLASH_WINDOWED.rate.peak)
    // Monday Beijing 10:00 -> off-peak.
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', PEAK_TIME)).toEqual(FLASH_WINDOWED.rate.offPeak)
  })

  it('resolves era by effectiveFrom: flat launch price before the peak/valley era', () => {
    const custom = flashConfig([FLASH_FLAT, FLASH_WINDOWED])
    const before = ERA_B - 1
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', before)).toEqual(FLASH_FLAT.rate)
  })

  it('resolves era by effectiveFrom: windowed price from the peak/valley era on', () => {
    const custom = flashConfig([FLASH_FLAT, FLASH_WINDOWED])
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', ERA_B)).toEqual(FLASH_WINDOWED.rate.offPeak)
  })

  it('applies the peak rate at Beijing 10:00 and the off-peak rate at Beijing 03:00', () => {
    const custom = flashConfig([FLASH_WINDOWED])
    const rate = custom.prices['deepseek-official/deepseek-v4-flash'][0]
    // Beijing 10:00 -> peak
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', PEAK_TIME)).toEqual(rate.rate.peak)
    // Beijing 03:00 -> off-peak
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', OFFPEAK_TIME)).toEqual(rate.rate.offPeak)
  })

  it('honors a custom UTC offset for the local hour clock', () => {
    const custom = flashConfig([{
      effectiveFrom: 0,
      kind: 'windowed',
      rate: {
        offPeak: { inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 },
        peak: { inputMicrosPerMtok: 9, outputMicrosPerMtok: 9 },
        peakHours: [[10, 11]],
        utcOffsetMinutes: -300, // UTC-5: 10:00 local = 15:00 UTC
      },
    }])
    // 15:00Z with offset -5 -> local 10:00 -> peak
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', Date.UTC(2026, 7, 17, 15)).inputMicrosPerMtok).toBe(9)
    // 14:00Z -> local 09:00 -> off-peak
    expect(financeRateAt(custom, 'deepseek-official/deepseek-v4-flash', Date.UTC(2026, 7, 17, 14)).inputMicrosPerMtok).toBe(1)
  })

  it('parses UTC hour keys back to epoch ms', () => {
    expect(financeHourTime('2026-08-17T02')).toBe(Date.UTC(2026, 7, 17, 2))
  })

  it('prices per-hour buckets each hour at its own rate', () => {
    const custom = flashConfig([FLASH_WINDOWED])
    const byHour = {
      '2026-08-17T02': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      '2026-08-16T19': { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
    }
    // 1M input at peak (3 CNY) + 1M input at off-peak (1.5 CNY) = 4,500,000 micros
    expect(financeCostByModelHour(custom, 'deepseek-official/deepseek-v4-flash', byHour)).toBe(4_500_000)
  })

  it('prices hour-less buckets at the era-resolved base (off-peak) rate', () => {
    const custom = flashConfig([FLASH_WINDOWED])
    const buckets = { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
    expect(financeBaseRate(FLASH_WINDOWED)).toEqual(FLASH_WINDOWED.rate.offPeak)
    expect(financeBaseCostMicros(custom, 'deepseek-official/deepseek-v4-flash', buckets, OFFPEAK_TIME)).toBe(1_500_000)
  })

  it('prices hour-less buckets at the flat rate for flat entries', () => {
    const custom = flashConfig([FLASH_FLAT])
    const buckets = { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 }
    // 1M input at 1 CNY + 1M output at 2 CNY = 3,000,000 micros
    expect(financeBaseCostMicros(custom, 'deepseek-official/deepseek-v4-flash', buckets, PEAK_TIME)).toBe(3_000_000)
  })

  it('returns the era-resolved entry for a moment', () => {
    const custom = flashConfig([FLASH_FLAT, FLASH_WINDOWED])
    expect(financeEntryFor(custom, 'deepseek-official/deepseek-v4-flash', 0)).toBe(FLASH_FLAT)
    expect(financeEntryFor(custom, 'deepseek-official/deepseek-v4-flash', ERA_B)).toBe(FLASH_WINDOWED)
    expect(financeEntryFor(config, 'unknown/model', 0)).toBeUndefined()
  })

  it('normalizes raw prices: string effectiveFrom, single vs list, era order', () => {
    const prices = normalizeFinancePrices({
      'deepseek-official/deepseek-v4-flash': [
        { inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 2_000_000 },
        {
          effectiveFrom: '2026-08-17T00:00:00+08:00',
          offPeak: { inputMicrosPerMtok: 1_500_000, outputMicrosPerMtok: 4_500_000 },
          peak: { inputMicrosPerMtok: 3_000_000, outputMicrosPerMtok: 9_000_000 },
          peakDays: [1, 2, 3, 4, 5],
        },
      ],
      'deepseek-official/deepseek-v4-pro': {
        inputMicrosPerMtok: 3_000_000,
        outputMicrosPerMtok: 6_000_000,
      },
    })
    const flash = prices['deepseek-official/deepseek-v4-flash']
    expect(flash).toHaveLength(2)
    expect(flash[0].kind).toBe('flat')
    expect(flash[0].effectiveFrom).toBe(0)
    expect(flash[1].kind).toBe('windowed')
    expect(flash[1].effectiveFrom).toBe(ERA_B)
    expect(flash[1].rate.peakDays).toEqual([1, 2, 3, 4, 5])
    expect(prices['deepseek-official/deepseek-v4-pro'][0].kind).toBe('flat')
  })

  it('normalizes an out-of-order era list into ascending effectiveFrom', () => {
    const prices = normalizeFinancePrices({
      'm': [
        { effectiveFrom: ERA_B, offPeak: { inputMicrosPerMtok: 2, outputMicrosPerMtok: 2 }, peak: { inputMicrosPerMtok: 4, outputMicrosPerMtok: 4 } },
        { inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 },
      ],
    })
    expect(prices['m'].map(e => e.effectiveFrom)).toEqual([0, ERA_B])
  })

  it('normalization is idempotent over already-normalized entries', () => {
    const prices = normalizeFinancePrices({ 'm': [FLASH_WINDOWED] })
    expect(prices['m'][0]).toBe(FLASH_WINDOWED)
  })

  it('resolves the billing mode with model-key precedence over provider', () => {
    const custom: FinanceConfig = {
      ...config,
      billingModes: { zai: 'plan', 'zai/special-model': 'metered' },
    }
    expect(financeBillingMode(custom, 'zai/glm-4.6')).toBe('plan')
    expect(financeBillingMode(custom, 'zai/special-model')).toBe('metered') // exact wins
    expect(financeBillingMode(custom, 'openai/gpt-4o')).toBe('metered')   // unlisted default
    expect(financeBillingMode(config, 'zai/glm-4.6')).toBe('metered')     // no map at all
  })

  it('normalizeFinanceConfig carries billing modes and defaults them to empty', () => {
    const normalized = normalizeFinanceConfig({ billingModes: { zai: 'plan' } })
    expect(normalized.billingModes).toEqual({ zai: 'plan' })
    expect(normalizeFinanceConfig({}).billingModes).toEqual({})
  })

  it('normalizeFinanceConfig carries provider defaults and defaults them to empty', () => {
    const normalized = normalizeFinanceConfig({
      providerDefaults: { openai: { inputMicrosPerMtok: 1, outputMicrosPerMtok: 2 } },
    })
    expect(normalized.providerDefaults.openai).toEqual({ inputMicrosPerMtok: 1, outputMicrosPerMtok: 2 })
    expect(normalizeFinanceConfig({}).providerDefaults).toEqual({})
    expect(normalizeFinanceConfig(config).providerDefaults).toEqual({})
  })
})

describe('financeWindowInfo', () => {
  it('resolves unknown models as flat at the default rate on the default clock', () => {
    const info = financeWindowInfo(config, 'unknown/model', PEAK_TIME)
    expect(info.band).toBe('flat')
    expect(info.rate).toBe(config.defaultPrice)
    expect(info.localHour).toBe(10) // Beijing 10:00 on UTC+8
  })

  it('reports a flat band and local hour for flat entries', () => {
    const custom = flashConfig([FLASH_FLAT])
    const info = financeWindowInfo(custom, 'deepseek-official/deepseek-v4-flash', PEAK_TIME)
    expect(info.band).toBe('flat')
    expect(info.rate).toBe(FLASH_FLAT.rate)
    expect(info.localHour).toBe(10)
  })

  it('reports a peak band inside a peak window and offpeak outside', () => {
    const custom = flashConfig([FLASH_WINDOWED])
    const peak = financeWindowInfo(custom, 'deepseek-official/deepseek-v4-flash', PEAK_TIME)
    expect(peak.band).toBe('peak')
    expect(peak.localHour).toBe(10)
    expect(peak.localDay).toBe(1) // Monday
    expect(peak.rate).toEqual(FLASH_WINDOWED.rate.peak)
    const off = financeWindowInfo(custom, 'deepseek-official/deepseek-v4-flash', OFFPEAK_TIME)
    expect(off.band).toBe('offpeak')
    expect(off.localHour).toBe(3)
    expect(off.localDay).toBe(1)
    expect(off.rate).toEqual(FLASH_WINDOWED.rate.offPeak)
  })

  it('reports an offpeak band for weekend peak hours (weekdays-only schedule)', () => {
    const custom = flashConfig([FLASH_WINDOWED])
    const info = financeWindowInfo(custom, 'deepseek-official/deepseek-v4-flash', Date.UTC(2026, 7, 22, 2)) // Saturday Beijing 10:00
    expect(info.band).toBe('offpeak')
    expect(info.localHour).toBe(10)
    expect(info.localDay).toBe(6) // Saturday
    expect(info.rate).toEqual(FLASH_WINDOWED.rate.offPeak)
  })

  it('honors a custom UTC offset for band and local hour', () => {
    const custom = flashConfig([{
      effectiveFrom: 0,
      kind: 'windowed',
      rate: {
        offPeak: { inputMicrosPerMtok: 1, outputMicrosPerMtok: 1 },
        peak: { inputMicrosPerMtok: 9, outputMicrosPerMtok: 9 },
        peakHours: [[10, 11]],
        utcOffsetMinutes: -300, // UTC-5: 10:00 local = 15:00 UTC
      },
    }])
    const info = financeWindowInfo(custom, 'deepseek-official/deepseek-v4-flash', Date.UTC(2026, 7, 17, 15))
    expect(info.band).toBe('peak')
    expect(info.localHour).toBe(10)
    expect(info.rate.inputMicrosPerMtok).toBe(9)
  })

  it('resolves the windowed era only from its effectiveFrom on', () => {
    const custom = flashConfig([FLASH_FLAT, FLASH_WINDOWED])
    expect(financeWindowInfo(custom, 'deepseek-official/deepseek-v4-flash', ERA_B - 1).band).toBe('flat')
    expect(financeWindowInfo(custom, 'deepseek-official/deepseek-v4-flash', ERA_B).band).toBe('offpeak')
  })
})

describe('financeWindowedSince', () => {
  it('returns the earliest windowed effectiveFrom across the table', () => {
    const custom = flashConfig([FLASH_FLAT, FLASH_WINDOWED])
    expect(financeWindowedSince(custom)).toBe(ERA_B)
  })

  it('returns null when no windowed entry exists', () => {
    expect(financeWindowedSince(flashConfig([FLASH_FLAT]))).toBeNull()
    expect(financeWindowedSince(config)).toBeNull()
  })

  it('takes the earliest windowed entry when models differ', () => {
    const later = { ...FLASH_WINDOWED, effectiveFrom: ERA_B + 3_600_000 }
    const custom: FinanceConfig = {
      ...config,
      prices: {
        'deepseek-official/deepseek-v4-flash': [FLASH_WINDOWED],
        'deepseek-official/deepseek-v4-pro': [later],
      },
    }
    expect(financeWindowedSince(custom)).toBe(ERA_B)
  })
})


describe('mergePriceLayers', () => {
  const flat = (input: number, output: number) => [{
    effectiveFrom: 0,
    kind: 'flat' as const,
    rate: { inputMicrosPerMtok: input, outputMicrosPerMtok: output },
  }]
  const windows = (peak: number, offPeak: number) => [{
    effectiveFrom: 0,
    kind: 'windowed' as const,
    rate: { peak: { inputMicrosPerMtok: peak, outputMicrosPerMtok: peak * 2 }, offPeak: { inputMicrosPerMtok: offPeak, outputMicrosPerMtok: offPeak * 2 } },
  }]

  it('returns empty when every tier is empty', () => {
    expect(mergePriceLayers(undefined, undefined, undefined)).toEqual({})
  })

  it('lets the user tier win over composition for shared keys', () => {
    const merged = mergePriceLayers(
      { 'openai/gpt-4o': flat(1, 2) },
      undefined,
      { 'openai/gpt-4o': flat(99, 99) },
    )
    expect(merged['openai/gpt-4o']).toEqual(flat(99, 99))
  })

  it('lets the user tier win over community for shared keys', () => {
    const merged = mergePriceLayers(
      { 'openai/gpt-4o': flat(1, 2) },
      { 'openai/gpt-4o': flat(50, 50) },
      { 'openai/gpt-4o': flat(99, 99) },
    )
    expect(merged['openai/gpt-4o']).toEqual(flat(99, 99))
  })

  it('lets the community tier win over composition for shared keys', () => {
    const merged = mergePriceLayers(
      { 'openai/gpt-4o': flat(1, 2) },
      { 'openai/gpt-4o': flat(50, 50) },
      undefined,
    )
    expect(merged['openai/gpt-4o']).toEqual(flat(50, 50))
  })

  it('preserves keys that are unique to each tier', () => {
    const merged = mergePriceLayers(
      { 'deepseek-official/v4-flash': flat(1, 2) },
      { 'openai/gpt-4o': flat(50, 50) },
      { 'anthropic/claude-opus': flat(99, 99) },
    )
    expect(Object.keys(merged).sort()).toEqual([
      'anthropic/claude-opus',
      'deepseek-official/v4-flash',
      'openai/gpt-4o',
    ])
  })

  it('round-trips into normalizeFinanceConfig and feeds financeRateAt', () => {
    const merged = mergePriceLayers(
      { 'openai/gpt-4o': flat(1_000_000, 2_000_000) },
      { 'openai/gpt-4o': flat(7_200_000, 14_400_000), 'zai/glm-4.6': flat(4_320_000, 15_840_000) },
      undefined,
    )
    const config = normalizeFinanceConfig({ prices: merged })
    expect(financeRateAt(config, 'openai/gpt-4o', 0)).toEqual({ inputMicrosPerMtok: 7_200_000, outputMicrosPerMtok: 14_400_000 })
    expect(financeRateAt(config, 'zai/glm-4.6', 0)).toEqual({ inputMicrosPerMtok: 4_320_000, outputMicrosPerMtok: 15_840_000 })
  })

  it('skips the community and user tiers when they are empty objects', () => {
    const merged = mergePriceLayers({ 'openai/gpt-4o': flat(1, 2) }, {}, {})
    expect(merged['openai/gpt-4o']).toEqual(flat(1, 2))
  })

  it('preserves the windowed shape across tiers', () => {
    const merged = mergePriceLayers(
      { 'deepseek-official/v4-flash': flat(1, 2) },
      { 'deepseek-official/v4-flash': windows(99, 99) },
      undefined,
    )
    expect((merged['deepseek-official/v4-flash'] as Array<{ kind: string }>)[0].kind).toBe('windowed')
  })
})

