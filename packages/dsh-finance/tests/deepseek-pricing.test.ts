import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  appendEra,
  deepSeekModelKey,
  expandTable,
  parseDeepSeekPricingPage,
  snapshotToEras,
} from '../src/sync/vendor/deepseek-pricing.ts'
import type { FinancePriceEntry } from '../src/types.ts'

const html = readFileSync(
  new URL('./fixtures/deepseek-pricing.zh-cn.2026-09-16.html', import.meta.url),
  'utf8',
)
const snapshot = parseDeepSeekPricingPage(html)
const EFFECTIVE_FROM = Date.parse('2026-09-10T00:00:00+08:00')

describe('expandTable', () => {
  it('把 rowspan 向后续行下沉（定价页用 rowspan=2 复用计价项标签）', () => {
    const rows = expandTable('<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>')
    expect(rows).toEqual([['A', 'B'], ['A', 'C']])
  })

  it('把 colspan 复制到各列', () => {
    const rows = expandTable('<table><tr><td colspan="3">X</td><td>Y</td></tr></table>')
    expect(rows).toEqual([['X', 'X', 'X', 'Y']])
  })
})

describe('parseDeepSeekPricingPage', () => {
  it('抽到两个模型列，主模型是 deepseek-flash', () => {
    expect(snapshot.models.map(model => model.modelId)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
    expect(snapshot.headlineModelId).toBe('deepseek-flash')
  })

  it('抽到退役别名（脚注 1）', () => {
    expect(snapshot.retiredAliases).toEqual(['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'])
  })

  it('抽到峰谷窗口：北京时间周一至周五 9-12 / 14-18（脚注 3）', () => {
    expect(snapshot.peakWindows).toEqual({
      hours: [[9, 12], [14, 18]],
      days: [1, 2, 3, 4, 5],
      utcOffsetMinutes: 480,
    })
  })

  // 附录 A 的 goldens：CNY / 百万 tokens
  it('deepseek-flash 单价与 SPEC 附录 A 逐值一致', () => {
    const flash = snapshot.models.find(model => model.modelId === 'deepseek-flash')
    expect(flash?.cacheHit).toEqual({ offPeak: 0.02, peak: 0.04 })
    expect(flash?.cacheMiss).toEqual({ offPeak: 1, peak: 2 })
    expect(flash?.output).toEqual({ offPeak: 4, peak: 8 })
  })

  it('deepseek-v4-pro 单价与 SPEC 附录 A 逐值一致', () => {
    const pro = snapshot.models.find(model => model.modelId === 'deepseek-v4-pro')
    expect(pro?.cacheHit).toEqual({ offPeak: 0.15, peak: 0.3 })
    expect(pro?.cacheMiss).toEqual({ offPeak: 4.5, peak: 9 })
    expect(pro?.output).toEqual({ offPeak: 13.5, peak: 27 })
  })

  it('脚注声明"空闲 = 高峰的一半"，且每个单价都满足', () => {
    expect(snapshot.offPeakIsHalfOfPeak).toBe(true)
    for (const model of snapshot.models) {
      for (const metric of ['cacheHit', 'cacheMiss', 'output'] as const) {
        expect(model[metric].peak).toBeCloseTo(model[metric].offPeak * 2, 10)
      }
    }
  })

  it('结构不符合预期时显式抛错，不猜', () => {
    expect(() => parseDeepSeekPricingPage('<html><body>nope</body></html>')).toThrow(/找不到 <table>/)
    expect(() => parseDeepSeekPricingPage('<table><tr><td>模型</td></tr></table>')).toThrow(/找不到模型列/)
  })
})

describe('snapshotToEras', () => {
  const eras = snapshotToEras(snapshot, { effectiveFrom: EFFECTIVE_FROM })

  it('两个模型 + 两个退役别名都有条目', () => {
    expect(Object.keys(eras).sort()).toEqual([
      'deepseek-official/deepseek-flash',
      'deepseek-official/deepseek-v4-flash',
      'deepseek-official/deepseek-v4-flash-vision-exp',
      'deepseek-official/deepseek-v4-pro',
    ])
  })

  it('deepseek-flash 的 windowed 条目 = SPEC 附录 A 的 micros 展开', () => {
    const entry = eras[deepSeekModelKey('deepseek-flash')]?.[0]
    expect(entry?.kind).toBe('windowed')
    expect(entry).toEqual({
      effectiveFrom: EFFECTIVE_FROM,
      kind: 'windowed',
      rate: {
        offPeak: { inputMicrosPerMtok: 1_000_000, cacheReadMicrosPerMtok: 20_000, outputMicrosPerMtok: 4_000_000 },
        peak: { inputMicrosPerMtok: 2_000_000, cacheReadMicrosPerMtok: 40_000, outputMicrosPerMtok: 8_000_000 },
        peakHours: [[9, 12], [14, 18]],
        peakDays: [1, 2, 3, 4, 5],
        utcOffsetMinutes: 480,
      },
    })
  })

  it('退役别名按脚注映射到主模型价位', () => {
    expect(eras[deepSeekModelKey('deepseek-v4-flash')]).toEqual(eras[deepSeekModelKey('deepseek-flash')])
    expect(eras[deepSeekModelKey('deepseek-v4-flash-vision-exp')]).toEqual(eras[deepSeekModelKey('deepseek-flash')])
  })

  it('deepseek-v4-pro 的 micros 值', () => {
    const entry = eras[deepSeekModelKey('deepseek-v4-pro')]?.[0]
    expect(entry?.kind === 'windowed' && entry.rate.offPeak).toEqual({
      inputMicrosPerMtok: 4_500_000,
      cacheReadMicrosPerMtok: 150_000,
      outputMicrosPerMtok: 13_500_000,
    })
  })
})

describe('appendEra', () => {
  const build = (inputMicrosPerMtok: number, effectiveFrom: number): FinancePriceEntry => ({
    effectiveFrom,
    kind: 'windowed',
    rate: {
      offPeak: { inputMicrosPerMtok, outputMicrosPerMtok: inputMicrosPerMtok * 4 },
      peak: { inputMicrosPerMtok: inputMicrosPerMtok * 2, outputMicrosPerMtok: inputMicrosPerMtok * 8 },
      peakHours: [[9, 12], [14, 18]],
      peakDays: [1, 2, 3, 4, 5],
      utcOffsetMinutes: 480,
    },
  })

  it('数值与结构都一致 → 不追加（幂等，INV-4/INV-8）', () => {
    const first = appendEra([], build(1_000_000, 1))
    const second = appendEra(first.entries, build(1_000_000, 2))
    expect(second.changed).toBe(false)
    expect(second.entries).toHaveLength(1)
  })

  it('数值相同但键序不同 → 仍判定未变化（INV-8，YAML 解析 vs 生成器构造）', () => {
    const parsed: FinancePriceEntry = {
      effectiveFrom: 1,
      kind: 'windowed',
      rate: {
        offPeak: { inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 4_000_000 },
        peak: { inputMicrosPerMtok: 2_000_000, outputMicrosPerMtok: 8_000_000 },
        peakHours: [[9, 12], [14, 18]],
        peakDays: [1, 2, 3, 4, 5],
        utcOffsetMinutes: 480,
      },
    }
    const constructed = build(1_000_000, 9)
    const { entries, changed } = appendEra([parsed], { ...constructed, effectiveFrom: 9 })
    expect(changed).toBe(false)
    expect(entries).toHaveLength(1)
  })

  it('价位变化 → 追加新 era，保留旧 era', () => {
    const first = appendEra([], build(1_000_000, 1))
    const second = appendEra(first.entries, build(1_500_000, 2))
    expect(second.changed).toBe(true)
    expect(second.entries).toHaveLength(2)
    expect(second.entries[0]?.effectiveFrom).toBe(1)
  })

  it('生效时刻不晚于最后一条 → 抛错（禁止改写历史）', () => {
    const first = appendEra([], build(1_000_000, 5))
    expect(() => appendEra(first.entries, build(1_500_000, 5))).toThrow(/必须晚于最后一条/)
  })
})
