import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { basePriceFingerprint, financePricesFingerprint } from '../src/pricing.ts'
import {
  FINANCE_PRICES_HASH,
  FINANCE_PRICES_SOURCE,
  FINANCE_PRICES_UPDATED,
} from '../src/pricing-hash.generated.ts'

/**
 * 价格表完整性（SPEC INV-5 / §2.2）：
 * 生成物哈希与 host 侧校验必须用同一个指纹函数，且**仓库里的数据必须真的等于那个哈希** ——
 * 否则「基础表被本地修改」的检测就是摆设。
 */

const series = JSON.parse(
  readFileSync(new URL('../../dsh-finance-bundle/prices.series.json', import.meta.url), 'utf8'),
) as { prices: Record<string, unknown> }

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

describe('价格表指纹与完整性', () => {
  it('仓库里的 prices.series.json 与 host 侧哈希常量逐字节一致', () => {
    expect(sha(basePriceFingerprint(series.prices))).toBe(FINANCE_PRICES_HASH)
    expect(FINANCE_PRICES_SOURCE).toContain('api-docs.deepseek.com')
    expect(Number.isFinite(Date.parse(FINANCE_PRICES_UPDATED))).toBe(true)
  })

  it('指纹只覆盖结构与数值：键序、单值/列表形态、无关 provider 都不影响', () => {
    const normalized = {
      'deepseek-official/x': [{ effectiveFrom: 0, kind: 'flat', rate: { inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 2_000_000 } }],
    }
    const reordered = {
      'deepseek-official/x': [{ kind: 'flat', rate: { outputMicrosPerMtok: 2_000_000, inputMicrosPerMtok: 1_000_000 }, effectiveFrom: 0 }],
    }
    const withCommunity = {
      ...normalized,
      'openai/gpt-4o': [{ inputMicrosPerMtok: 9, outputMicrosPerMtok: 9 }],
    }
    expect(financePricesFingerprint(normalized)).toBe(financePricesFingerprint(reordered))
    expect(basePriceFingerprint(normalized)).toBe(basePriceFingerprint(withCommunity))
  })

  it('数值被改动 → 指纹变化（篡改可被发现）', () => {
    const base = { 'deepseek-official/x': [{ effectiveFrom: 0, kind: 'flat', rate: { inputMicrosPerMtok: 1_000_000, outputMicrosPerMtok: 2_000_000 } }] }
    const tampered = { 'deepseek-official/x': [{ effectiveFrom: 0, kind: 'flat', rate: { inputMicrosPerMtok: 1_500_000, outputMicrosPerMtok: 2_000_000 } }] }
    expect(sha(basePriceFingerprint(tampered))).not.toBe(FINANCE_PRICES_HASH)
    expect(basePriceFingerprint(tampered)).not.toBe(basePriceFingerprint(base))
  })
})
