import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  OPENAI_LONG_CONTEXT_THRESHOLD,
  parseMoneyCell,
  parseOpenAiTierPage,
  parseXaiTierPage,
  rowToTierModel,
  snapshotToTierSpecs,
  usdToMicrosPerMtok,
} from '../src/sync/vendor/tier-pricing.ts'

/**
 * 阶梯价解析（S4）：厂商页 → 结构。这里锁的是 SPEC §2.3 的几条硬语义 ——
 * 尤其是「全量按所在档」（规则 7）在产物结构上的体现：档位是**上界**，不是分段。
 */
const openaiMd = readFileSync(new URL('./fixtures/openai-pricing.2026-09-19.md', import.meta.url), 'utf8')
const xaiMd = readFileSync(new URL('./fixtures/xai-grok-4.6.2026-09-19.md', import.meta.url), 'utf8')
const FX = 7.2

describe('parseMoneyCell', () => {
  it('解析 $ 金额，且区分"-"（不适用）与 $0.00（真免费）', () => {
    expect(parseMoneyCell('$12.50')).toBe(12.5)
    expect(parseMoneyCell('$0.075')).toBe(0.075)
    expect(parseMoneyCell('$0.00')).toBe(0)
    // `-` 表示该档不收费/不适用 —— 必须与 0 区分，否则会写出一个假的免费档。
    expect(parseMoneyCell('-')).toBeUndefined()
    expect(parseMoneyCell('—')).toBeUndefined()
    expect(parseMoneyCell('')).toBeUndefined()
    expect(parseMoneyCell('free')).toBeUndefined()
  })
})

describe('usdToMicrosPerMtok', () => {
  it('主单位 → 整数 micros/Mtok（按 fx 折算）', () => {
    expect(usdToMicrosPerMtok(1, 7.2)).toBe(7_200_000)
    expect(usdToMicrosPerMtok(2.5, 7.2)).toBe(18_000_000)
    // 必须取整：账本全程整数 micros，浮点会累积误差。
    expect(Number.isInteger(usdToMicrosPerMtok(0.075, 7.2))).toBe(true)
  })
})

describe('rowToTierModel', () => {
  it('长档全空 = 无长度阶梯（只出短档），用于把"无阶梯"与"阶梯同价"区分开', () => {
    const model = rowToTierModel('m', [1, undefined, undefined, 2, undefined, undefined, undefined, undefined], 272_000, FX)
    expect(model?.long).toBeUndefined()
    expect(model?.short.inputMicrosPerMtok).toBe(usdToMicrosPerMtok(1, FX))
  })

  it('两档完全同价时按无阶梯处理（避免产物里出现等价冗余档）', () => {
    const model = rowToTierModel('m', [1, undefined, undefined, 2, 1, undefined, undefined, 2], 272_000, FX)
    expect(model?.long).toBeUndefined()
  })

  it('缺输入或输出价的行整行丢弃（不猜）', () => {
    expect(rowToTierModel('m', [undefined, undefined, undefined, 2, undefined, undefined, undefined, undefined], 272_000, FX)).toBeUndefined()
    expect(rowToTierModel('m', [1, undefined, undefined, undefined, undefined, undefined, undefined, undefined], 272_000, FX)).toBeUndefined()
  })
})

describe('parseOpenAiTierPage', () => {
  const snapshot = parseOpenAiTierPage(openaiMd, FX)

  it('只读 Standard 段（Batch/Flex/Fast 是 serviceTier 维度，混进来会算错价）', () => {
    // Standard 表里 gpt-5.6-terra 短档输入 $2.00；Batch 段是 $1.00。
    const terra = snapshot.models.find(m => m.modelId === 'gpt-5.6-terra')
    expect(terra?.short.inputMicrosPerMtok).toBe(usdToMicrosPerMtok(2, FX))
  })

  it('阈值取官方 272K，且长档严格更贵', () => {
    expect(snapshot.threshold).toBe(OPENAI_LONG_CONTEXT_THRESHOLD)
    const terra = snapshot.models.find(m => m.modelId === 'gpt-5.6-terra')
    expect(terra?.long).toBeDefined()
    expect(terra!.long!.inputMicrosPerMtok).toBeGreaterThan(terra!.short.inputMicrosPerMtok)
  })

  it('长档的缓存列也要带出来（漏了会让长上下文请求的缓存价按输入价算）', () => {
    const terra = snapshot.models.find(m => m.modelId === 'gpt-5.6-terra')
    expect(terra?.short.cacheWriteMicrosPerMtok).toBe(usdToMicrosPerMtok(2.5, FX))
    expect(terra?.long?.cacheWriteMicrosPerMtok).toBe(usdToMicrosPerMtok(5, FX))
    expect(terra?.long?.cacheReadMicrosPerMtok).toBe(usdToMicrosPerMtok(0.4, FX))
  })

  it('表头里的 "<272K context length" 说明不影响模型 id 抽取', () => {
    expect(snapshot.models.some(m => m.modelId === 'gpt-5.5')).toBe(true)
    expect(snapshot.models.some(m => m.modelId.includes('<'))).toBe(false)
  })

  it('缺 Standard 段时抛错（不产出半张表）', () => {
    expect(() => parseOpenAiTierPage('# Pricing\n\nnothing here', FX)).toThrow(/Standard/)
  })
})

describe('parseXaiTierPage', () => {
  it('转置表（行=Type / 列=档位）也能解析，阈值取 200K', () => {
    const snapshot = parseXaiTierPage(xaiMd, 'grok-4.6', FX)
    expect(snapshot.threshold).toBe(200_000)
    const model = snapshot.models[0]
    expect(model.modelId).toBe('grok-4.6')
    expect(model.short.inputMicrosPerMtok).toBe(usdToMicrosPerMtok(2, FX))
    expect(model.long?.inputMicrosPerMtok).toBe(usdToMicrosPerMtok(4, FX))
    expect(model.short.cacheReadMicrosPerMtok).toBe(usdToMicrosPerMtok(0.5, FX))
  })

  it('表头不是两档形态时抛错', () => {
    expect(() => parseXaiTierPage('| Type | Only one |\n| --- | --- |\n| Input | $1 |', 'm', FX)).toThrow()
  })
})

describe('snapshotToTierSpecs', () => {
  const specs = snapshotToTierSpecs(parseOpenAiTierPage(openaiMd, FX), 'CNY')

  it('落档语义：档位是上界，短档 = 阈值、兜底档 = 0 且排最后（SPEC §2.3 规则 7）', () => {
    const tiers = specs['openai/gpt-5.6-terra'].tiers
    expect(tiers.map(t => t.maxPromptTokens)).toEqual([272_000, 0])
  })

  it('无长度阶梯的模型**不进**产物（否则"没阶梯"与"没录入"区分不开）', () => {
    expect(specs['openai/gpt-5.4-mini']).toBeUndefined()
    expect(Object.keys(specs).every(key => specs[key].tiers.length === 2)).toBe(true)
  })

  it('币种写目标记账币种（写源页面币种会让整张表被币种守卫静默排除）', () => {
    for (const spec of Object.values(specs)) expect(spec.currency).toBe('CNY')
  })

  it('输出按 key 稳定：同一输入两次解析结果逐值相同（生成物幂等 INV-8 的前提）', () => {
    const again = snapshotToTierSpecs(parseOpenAiTierPage(openaiMd, FX), 'CNY')
    expect(JSON.stringify(again)).toBe(JSON.stringify(specs))
  })
})