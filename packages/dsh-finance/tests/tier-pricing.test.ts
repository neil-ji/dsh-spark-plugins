import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  OPENAI_LONG_CONTEXT_THRESHOLD,
  ceilingOf,
  parseDiscountedPrice,
  parseGlmTierPage,
  parseMinimaxTierPage,
  parseQwenTierPage,
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
/* ─────────────── 智谱 GLM（S4/P1，zai）与阿里百炼 Qwen（dashscope） ─────────────── */

const glmHtml = readFileSync(new URL('./fixtures/glm-pricing.2026-09-19.html', import.meta.url), 'utf8')
const qwenHtml = readFileSync(new URL('./fixtures/qwen-pricing.2026-09-19.html', import.meta.url), 'utf8')

describe('ceilingOf（三家档位写法）', () => {
  it('认三种官方写法：无上界 / 半开区间 / 不等号区间', () => {
    // 无上界 → 兜底档 0
    expect(ceilingOf('≥32K')).toBe(0)
    expect(ceilingOf('输入长度 ≥32K')).toBe(0)
    // GLM 半开区间：取右端
    expect(ceilingOf('输入长度 [0, 32K)')).toBe(32_000)
    expect(ceilingOf('输入长度 [32K, 128K)')).toBe(128_000)
    expect(ceilingOf('输入 [32K, 200K)')).toBe(200_000)
    // Qwen 不等号：取**最后**一个界（32K<Token≤256K 的上界是 256K，不是 32K）
    expect(ceilingOf('0<Token≤32K')).toBe(32_000)
    expect(ceilingOf('32K<Token≤256K')).toBe(256_000)
    expect(ceilingOf('256K<Token≤1M')).toBe(1_000_000)
    // 认不出 → undefined（调用方丢弃该行，不猜）
    expect(ceilingOf('无阶梯计价')).toBeUndefined()
  })
})

describe('parseGlmTierPage', () => {
  const specs = parseGlmTierPage(glmHtml)

  it('解析出「输入长度」一维阶梯的模型，单位是元（不乘 fx）', () => {
    // GLM-5.1 官方：输入长度 [0,32K) = ¥6/¥24，≥32K = ¥8/¥28
    expect(specs['zai/glm-5.1'].tiers.map(t => t.maxPromptTokens)).toEqual([32_000, 0])
    expect(specs['zai/glm-5.1'].tiers[0].inputMicrosPerMtok).toBe(6_000_000)
    expect(specs['zai/glm-5.1'].tiers[0].outputMicrosPerMtok).toBe(24_000_000)
    expect(specs['zai/glm-5.1'].tiers[1].inputMicrosPerMtok).toBe(8_000_000)
  })

  it('缓存命中落绝对价（页面给的就是绝对价，不是倍率）', () => {
    expect(specs['zai/glm-5.1'].tiers[0].cacheReadMicrosPerMtok).toBe(1_300_000)
    expect(specs['zai/glm-5.1'].tiers[1].cacheReadMicrosPerMtok).toBe(2_000_000)
  })

  it('二维档（输入 × 输出）的模型**整模型跳过**，避免留下半张表', () => {
    // GLM-4.7 / GLM-4.5-Air 的档位形如「输入 [0,32K)，输出 [0,0.2K)」，
    // tiers 是一维，无法忠实表达 —— 必须整模型不进产物。
    expect(specs['zai/glm-4.7']).toBeUndefined()
    expect(specs['zai/glm-4.5-air']).toBeUndefined()
  })

  it('无长度阶梯的模型（上下文列写 1M/200K）不进产物', () => {
    expect(specs['zai/glm-5.3']).toBeUndefined()
    expect(specs['zai/glm-5.2']).toBeUndefined()
  })

  it('币种一律 CNY', () => {
    for (const spec of Object.values(specs)) expect(spec.currency).toBe('CNY')
  })

  it('输出稳定（同一输入两次结果逐值相同，幂等前提）', () => {
    expect(JSON.stringify(parseGlmTierPage(glmHtml))).toBe(JSON.stringify(specs))
  })
})

describe('parseQwenTierPage', () => {
  const specs = parseQwenTierPage(qwenHtml)

  it('三档模型：档位上界与官方一致，最高档转成兜底档', () => {
    // qwen3-max 官方：0<Token≤32K ¥2.5/¥10；32K<Token≤128K ¥4/¥16；128K<Token≤256K ¥7/¥28
    const tiers = specs['dashscope/qwen3-max'].tiers
    expect(tiers.map(t => t.maxPromptTokens)).toEqual([32_000, 128_000, 0])
    expect(tiers.map(t => t.inputMicrosPerMtok)).toEqual([2_500_000, 4_000_000, 7_000_000])
    expect(tiers.map(t => t.outputMicrosPerMtok)).toEqual([10_000_000, 16_000_000, 28_000_000])
  })

  it('四档模型也解析完整（qwen3-coder-plus 有 4 档）', () => {
    const tiers = specs['dashscope/qwen3-coder-plus-2025-09-23']?.tiers
    expect(tiers).toBeDefined()
    expect(tiers!.length).toBeGreaterThanOrEqual(4)
    // 兜底档必须是最后一条（生成段按升序渲染）
    expect(tiers![tiers!.length - 1].maxPromptTokens).toBe(0)
  })

  it('输出价随「思考模式」分叉的模型整模型跳过', () => {
    // qwen-plus 系列：非思考 / 思考两套输出价，1D schema 无法忠实表达。
    expect(specs['dashscope/qwen-plus']).toBeUndefined()
    expect(specs['dashscope/qwen-plus-2025-12-01']).toBeUndefined()
  })

  it('只取中国内地价目，不混入海外站（禁止跨站点合并）', () => {
    // 同一模型若混入国际/美国价，输入价会被抬高到 2.9 元级别。
    const tiers = specs['dashscope/qwen3-max'].tiers
    expect(tiers[0].inputMicrosPerMtok).toBe(2_500_000)
    expect(tiers.some(t => t.inputMicrosPerMtok === 2_936_000)).toBe(false)
  })

  it('无长度阶梯（只有单档）的模型不进产物', () => {
    // qwen3.7-max / qwen3.8-max 是 0<Token≤1M 单档 → 没有阶梯
    expect(specs['dashscope/qwen3.7-max']).toBeUndefined()
    expect(specs['dashscope/qwen3.8-max']).toBeUndefined()
  })

  it('缓存读走倍率 0.2（官方给 10%/20% 区间，取更贵的那个）', () => {
    for (const spec of Object.values(specs)) {
      for (const tier of spec.tiers) expect(tier.cacheReadMultiplier).toBe(0.2)
    }
  })

  it('价格逐档严格递增（越长越贵，列错位会立刻暴露）', () => {
    for (const [key, spec] of Object.entries(specs)) {
      for (let i = 1; i < spec.tiers.length; i += 1) {
        expect(spec.tiers[i].inputMicrosPerMtok, key).toBeGreaterThan(spec.tiers[i - 1].inputMicrosPerMtok)
      }
    }
  })
})

/* ─────────────────────── MiniMax（minimax-cn，512K 两档） ─────────────────────── */

const minimaxMd = readFileSync(new URL('./fixtures/minimax-pricing.2026-09-19.md', import.meta.url), 'utf8')

describe('parseDiscountedPrice（删除线 = 永久五折）', () => {
  it('有删除线时取**折后价**，没有则取原值', () => {
    // 官方「永久五折」：~~4.20~~ 2.10 表示实际按 2.10 计费。取原价会虚高一倍。
    expect(parseDiscountedPrice('~~4.20~~ 2.10')).toBe(2.1)
    expect(parseDiscountedPrice('~~16.80~~ 8.40')).toBe(8.4)
    expect(parseDiscountedPrice('~~0.84~~ 0.42')).toBe(0.42)
    // 无删除线
    expect(parseDiscountedPrice('2.10')).toBe(2.1)
    // 非数字
    expect(parseDiscountedPrice('-')).toBeUndefined()
    expect(parseDiscountedPrice('')).toBeUndefined()
  })
})

describe('parseMinimaxTierPage', () => {
  const specs = parseMinimaxTierPage(minimaxMd)

  it('M3 两档，价格取折后值（元/百万 tokens）', () => {
    const tiers = specs['minimax-cn/minimax-m3'].tiers
    expect(tiers.map(t => t.maxPromptTokens)).toEqual([512_000, 0])
    expect(tiers[0].inputMicrosPerMtok).toBe(2_100_000)
    expect(tiers[0].outputMicrosPerMtok).toBe(8_400_000)
    expect(tiers[1].inputMicrosPerMtok).toBe(4_200_000)
    expect(tiers[1].outputMicrosPerMtok).toBe(16_800_000)
  })

  it('缓存读落绝对价（页面给的就是绝对价）', () => {
    expect(specs['minimax-cn/minimax-m3'].tiers[0].cacheReadMicrosPerMtok).toBe(420_000)
    expect(specs['minimax-cn/minimax-m3'].tiers[1].cacheReadMicrosPerMtok).toBe(840_000)
  })

  it('**只取「标准」Tab**：优先档是 1.5× serviceTier，混进来会把价格抬高 50%', () => {
    // 优先 Tab 的 ≤512k 输入价是 3.15（= 2.10 × 1.5）。若误取优先表，这里会看到 3_150_000。
    const tiers = specs['minimax-cn/minimax-m3'].tiers
    expect(tiers[0].inputMicrosPerMtok).toBe(2_100_000)
    expect(tiers.some(t => t.inputMicrosPerMtok === 3_150_000)).toBe(false)
    expect(tiers.some(t => t.inputMicrosPerMtok === 6_300_000)).toBe(false)
  })

  it('无长度阶梯的模型（M2.x 单档）不进产物', () => {
    expect(specs['minimax-cn/minimax-m2.7']).toBeUndefined()
    expect(specs['minimax-cn/minimax-m2.5']).toBeUndefined()
    expect(Object.keys(specs)).toEqual(['minimax-cn/minimax-m3'])
  })

  it('币种 CNY，且输出稳定（幂等前提）', () => {
    expect(specs['minimax-cn/minimax-m3'].currency).toBe('CNY')
    expect(JSON.stringify(parseMinimaxTierPage(minimaxMd))).toBe(JSON.stringify(specs))
  })
})
