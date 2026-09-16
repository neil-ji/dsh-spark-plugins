import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { financeBucketCostMicros, financeEntryFor, normalizeFinanceConfig } from '../src/pricing.ts'
import type { FinanceConfig, FinancePriceRate, FinanceTokenBuckets } from '../src/types.ts'

/**
 * A1 账单回归（FINANCE-PRICING-SPEC.md §7）：
 * 用生成器产出的价格表重算官方账单里的每一行 token，必须等于官方当日实扣。
 *
 * 为什么这是最强的一条断言：它同时验证
 *   ① 价格表数值正确（含峰谷两档）、② 纪元切分正确（08-16 峰谷制、09-10 换模型）、
 *   ③ 别名映射正确、④ 账本口径（缓存命中/未命中/输出三桶）与厂商一致。
 * 任一环节退化（例如又出现"缺条目 → 回落 legacy 兜底价"）本测试立刻变红。
 */

const FIXTURE = new URL('./fixtures/bill-2026-08-18_2026-09-16/', import.meta.url)
const series = JSON.parse(
  readFileSync(new URL('../../dsh-finance-bundle/prices.series.json', import.meta.url), 'utf8'),
) as { prices: Record<string, unknown> }

const config: FinanceConfig = normalizeFinanceConfig({ prices: series.prices }, {})

/**
 * 账单里出现过、但厂商页已不再列出的促销 SKU：按账单实证它与 v4-flash 同价
 * （09-08 两档单价逐值一致）。SPEC §6.1 把别名映射归规则层，③ 落地时搬过去。
 */
const BILL_MODEL_ALIASES: Record<string, string> = {
  'deepseek-v4.1-flash-expires-on-0910': 'deepseek-v4-flash',
}

interface AmountRow {
  date: string
  timeMs: number
  model: string
  type: string
  price: number
  amount: number
}

function readCsv(name: string): string[][] {
  return readFileSync(new URL(name, FIXTURE), 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map(line => line.split(',').map(cell => cell.trim()))
}

const amountRows: AmountRow[] = readCsv('amount.csv').map(cols => ({
  date: (cols[0] ?? '').slice(0, 10),
  timeMs: Date.parse(cols[0] ?? ''),
  model: cols[1] ?? '',
  type: cols[2] ?? '',
  price: Number(cols[3] ?? '0'),
  amount: Number(cols[4] ?? '0'),
}))

const wallet = new Map<string, number>()
for (const cols of readCsv('cost.csv')) {
  wallet.set((cols[0] ?? '').slice(0, 10) + '|' + (cols[1] ?? ''), Number(cols[2] ?? '0'))
}

const KINDS = ['input_cache_miss_tokens', 'input_cache_hit_tokens', 'output_tokens'] as const
type Kind = (typeof KINDS)[number]

function rateOf(rate: FinancePriceRate, kind: Kind): number {
  if (kind === 'output_tokens') return rate.outputMicrosPerMtok
  if (kind === 'input_cache_hit_tokens') return rate.cacheReadMicrosPerMtok ?? rate.inputMicrosPerMtok
  return rate.inputMicrosPerMtok
}

function modelKeyOf(model: string): string {
  return 'deepseek-official/' + (BILL_MODEL_ALIASES[model] ?? model)
}

interface Priced {
  /** 我们按价格表算出的成本（micros）。 */
  micros: number
  /** 官方逐行 token×单价 的成本（micros，仅作对照）。 */
  officialMicros: number
  /** 未能匹配到任何档位的行（必须为空）。 */
  unmatched: string[]
  days: Map<string, number>
}

function priceBill(): Priced {
  const unmatched: string[] = []
  const days = new Map<string, number>()
  let micros = 0
  let officialMicros = 0
  for (const row of amountRows) {
    if (row.type === 'request_count') continue
    if (!KINDS.includes(row.type as Kind)) continue
    const kind = row.type as Kind
    const key = modelKeyOf(row.model)
    const entry = financeEntryFor(config, key, row.timeMs)
    if (entry === undefined) { unmatched.push(row.date + ' ' + row.model + ' (未收录)'); continue }
    let band: 'offPeak' | 'peak' | 'flat'
    let rate: FinancePriceRate
    if (entry.kind === 'windowed') {
      // 单位统一到 micros/Mtok：账单单价是 CNY/token（×1e12），价格表本来就是 micros/Mtok。
      const officialMicrosPerMtok = row.price * 1_000_000_000_000
      if (Math.abs(officialMicrosPerMtok - rateOf(entry.rate.offPeak, kind)) < 1) { band = 'offPeak'; rate = entry.rate.offPeak }
      else if (Math.abs(officialMicrosPerMtok - rateOf(entry.rate.peak, kind)) < 1) { band = 'peak'; rate = entry.rate.peak }
      else { unmatched.push(`${row.date} ${row.model} ${kind} 单价 ${officialMicrosPerMtok} micros/Mtok 不在价格表的峰/谷两者之内`); continue }
    } else {
      band = 'flat'
      rate = entry.rate
      if (Math.abs(row.price * 1_000_000_000_000 - rateOf(rate, kind)) >= 1) {
        unmatched.push(`${row.date} ${row.model} ${kind} 单价与 flat 条目不符`)
        continue
      }
    }
    // 单行成本：与官方"逐行 token×单价"同形（每行一个桶），因此可以精确对到 micros。
    const bucket: FinanceTokenBuckets = {
      uncachedInputTokens: kind === 'input_cache_miss_tokens' ? row.amount : 0,
      cacheReadTokens: kind === 'input_cache_hit_tokens' ? row.amount : 0,
      cacheWriteTokens: 0,
      outputTokens: kind === 'output_tokens' ? row.amount : 0,
    }
    const cost = financeBucketCostMicros(bucket, rate)
    micros += cost
    // 按【账单里的模型名】聚合，而不是映射后的 key —— cost.csv 里别名是单独一行。
    const dayKey = row.date + '|' + row.model
    days.set(dayKey, (days.get(dayKey) ?? 0) + cost)
    officialMicros += Math.round(row.price * row.amount * 1_000_000)
  }
  return { micros, officialMicros, unmatched, days }
}

const priced = priceBill()

describe('A1 账单回归（官方账单 fixture）', () => {
  it('每一行 token 都能在价格表里匹配到档位（没有"未收录/不匹配"）', () => {
    expect(priced.unmatched).toEqual([])
  })

  it('deepseek-flash 由 windowed 条目定价（本次 bug 的回归点）', () => {
    const entry = financeEntryFor(config, 'deepseek-official/deepseek-flash', Date.parse('2026-09-12T12:00:00+08:00'))
    expect(entry?.kind).toBe('windowed')
    if (entry?.kind !== 'windowed') throw new Error('unreachable')
    expect(entry.rate.offPeak).toEqual({ inputMicrosPerMtok: 1_000_000, cacheReadMicrosPerMtok: 20_000, outputMicrosPerMtok: 4_000_000 })
    expect(entry.rate.peak).toEqual({ inputMicrosPerMtok: 2_000_000, cacheReadMicrosPerMtok: 40_000, outputMicrosPerMtok: 8_000_000 })
  })

  it('重算总额 = 官方实扣总额（¥179.56）', () => {
    let official = 0
    for (const value of wallet.values()) official += value
    expect(official).toBeCloseTo(179.56, 2)
    expect(priced.micros / 1_000_000).toBeCloseTo(official, 3)
  })

  it('逐「日期×模型」与官方钱包扣费一致（容差 0.01 元）', () => {
    const diffs: string[] = []
    for (const [key, official] of wallet) {
      const ours = (priced.days.get(key) ?? 0) / 1_000_000
      if (Math.abs(ours - official) > 0.01) diffs.push(`${key}: 官方 ${official.toFixed(2)} vs 重算 ${ours.toFixed(2)}`)
    }
    expect(diffs).toEqual([])
  })

  it('重算总额与"逐行 token×单价"完全一致（证明账本口径与厂商一致）', () => {
    expect(priced.micros).toBe(priced.officialMicros)
  })
})
