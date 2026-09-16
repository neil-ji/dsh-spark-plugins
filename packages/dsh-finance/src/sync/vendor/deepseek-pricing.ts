/**
 * DeepSeek 官方定价页解析：把 api-docs.deepseek.com 的「模型 & 价格」表归一成
 * vendor 快照，再由 `snapshotToEras` 转成 finance 的 windowed **era 条目**。
 *
 * 纯函数、零依赖、不碰网络 —— 抓取与落盘在 `scripts/gen-finance-prices.mjs`。
 * 规范见 `docs/FINANCE-PRICING-SPEC.md` §3（生成器）与 §6（规则层）。
 *
 * ⚠️ 抓取端必须使用**带尾斜杠**的 `.../pricing/`：不带斜杠会被 CDN 坏缓存
 * 返回另一份文档（"Your First API Call"），且随缓存 TTL 间歇复现。
 *
 * 页面形状（服务端渲染，单张转置表：模型是列）：
 *   行 0   模型 | deepseek-flash(1) | deepseek-v4-pro(2)
 *   价格段 每行 = [价格(n)] [百万tokens输入（缓存命中|未命中）| 百万tokens输出] [空闲|高峰时段] [各模型单价]元
 *   脚注   (1) 别名与"按 Flash 价格计费"  (3) 空闲=高峰一半 + 高峰时段（北京时间）
 *
 * @module dsh-spark-finance/sync/vendor/deepseek-pricing
 */

import { stableJson } from '../../pricing.ts'
import type { FinancePriceEntry, FinancePriceRate, FinanceWindowedRate } from '../../types.ts'

/** DeepSeek 官方路由的 provider 段（与 llm-deepseek 注册的 PROVIDER 一致）。 */
export const DEEPSEEK_PROVIDER = 'deepseek-official'

/**
 * 厂商标价页（**中文页**：我们按 CNY 记账）。尾斜杠是必需的：不带斜杠会被 CDN 坏缓存
 * 返回另一份文档（"Your First API Call"），且随缓存 TTL 间歇复现。
 */
export const DEEPSEEK_PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'

/** 单价对：空闲/高峰（CNY per million tokens，原样保留厂商精度）。 */
export interface VendorRatePair {
  offPeak: number
  peak: number
}

/** 一个模型的三个计价项（缓存命中/未命中各算输入，另加输出）。 */
export interface VendorModelPrice {
  modelId: string
  cacheHit: VendorRatePair
  cacheMiss: VendorRatePair
  output: VendorRatePair
}

/** 厂商声明的峰谷窗口（本站时间 + 星期）。 */
export interface VendorPeakWindows {
  hours: ReadonlyArray<readonly [number, number]>
  days: readonly number[]
  utcOffsetMinutes: number
}

/** 一页定价文档解析出的全部事实。 */
export interface DeepSeekPricingSnapshot {
  headlineModelId: string
  retiredAliases: readonly string[]
  models: readonly VendorModelPrice[]
  peakWindows: VendorPeakWindows | null
  /** 脚注是否声明"空闲时段价格为高峰时段价格的一半"。 */
  offPeakIsHalfOfPeak: boolean
}

const MODEL_HEADER = /^([a-z][a-z0-9.-]*)\s*\((\d+)\)$/
const VALUE_CNY = /^([0-9]+(?:\.[0-9]+)?)\s*元(?:\(\d+\))?$/
const WEEKDAY_INDEX: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

/** 解码实体并压平空白（页面里模型名与别名被 `<code>` 包裹，故标签先换空格）。 */
export function cellText(html: string): string {
  const decoded = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#39|amp|lt|gt|quot|nbsp);/g, (_all, name: string) => {
      if (name === 'amp') return '&'
      if (name === 'lt') return '<'
      if (name === 'gt') return '>'
      if (name === 'quot') return '"'
      if (name === 'nbsp') return ' '
      return "'"
    })
  return decoded.replace(/\s+/g, ' ').trim()
}

interface RawCell {
  text: string
  colspan: number
  rowspan: number
}

function parseRowCells(rowHtml: string): RawCell[] {
  const cells: RawCell[] = []
  const re = /<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/g
  let match = re.exec(rowHtml)
  while (match !== null) {
    const attrs = match[2] ?? ''
    const colspan = Number(/\bcolspan="(\d+)"/.exec(attrs)?.[1] ?? '1')
    const rowspan = Number(/\browspan="(\d+)"/.exec(attrs)?.[1] ?? '1')
    cells.push({
      text: cellText(match[3] ?? ''),
      colspan: Number.isFinite(colspan) && colspan > 0 ? colspan : 1,
      rowspan: Number.isFinite(rowspan) && rowspan > 0 ? rowspan : 1,
    })
    match = re.exec(rowHtml)
  }
  return cells
}

/**
 * 把一张 HTML 表展开成规整矩阵：colspan 复制到各列，rowspan 向后续行下沉。
 * 定价页用 `rowspan="2"` 复用「价格(n) + 计价项」两格，展开后每个时段行都自带标签。
 */
export function expandTable(tableHtml: string): string[][] {
  const rawRows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1] ?? '')
  const out: string[][] = []
  let pending = new Map<number, { text: string; rowsLeft: number }>()
  for (const raw of rawRows) {
    const queue = parseRowCells(raw)
    const row: string[] = []
    const next = new Map<number, { text: string; rowsLeft: number }>()
    let col = 0
    while (queue.length > 0 || pending.has(col)) {
      const carried = pending.get(col)
      if (carried !== undefined) {
        row[col] = carried.text
        if (carried.rowsLeft - 1 > 0) next.set(col, { text: carried.text, rowsLeft: carried.rowsLeft - 1 })
        col += 1
        continue
      }
      const cell = queue.shift()
      if (cell === undefined) break
      for (let i = 0; i < cell.colspan; i++) {
        row[col + i] = cell.text
        if (cell.rowspan > 1) next.set(col + i, { text: cell.text, rowsLeft: cell.rowspan - 1 })
      }
      col += cell.colspan
    }
    pending = next
    out.push(row)
  }
  return out
}

function footnoteTexts(html: string): string[] {
  return [...html.matchAll(/<p>\s*\((\d+)\)([\s\S]*?)<\/p>/g)].map(m => cellText(m[2] ?? ''))
}

function metricOf(label: string): 'cacheHit' | 'cacheMiss' | 'output' | null {
  if (label.includes('缓存命中')) return 'cacheHit'
  if (label.includes('缓存未命中')) return 'cacheMiss'
  if (label.includes('输出')) return 'output'
  return null
}

function bandOf(label: string): 'offPeak' | 'peak' | null {
  if (label.includes('空闲')) return 'offPeak'
  if (label.includes('高峰')) return 'peak'
  return null
}

function parseValueCny(text: string): number | null {
  const m = VALUE_CNY.exec(text)
  if (m === null) return null
  const value = Number(m[1])
  return Number.isFinite(value) ? value : null
}

function parseWeekdayRange(text: string): number[] | null {
  const m = /周([一二三四五六日天])至周([一二三四五六日天])/.exec(text)
  if (m === null) return null
  const start = WEEKDAY_INDEX[m[1] ?? '']
  const end = WEEKDAY_INDEX[m[2] ?? '']
  if (start === undefined || end === undefined) return null
  const days: number[] = []
  for (let day = start; day <= end; day++) days.push(day)
  return days
}

function parsePeakWindows(note: string, offPeakIsHalfOfPeak: boolean): VendorPeakWindows | null {
  if (!note.includes('高峰时段')) return null
  const days = parseWeekdayRange(note)
  const hours: Array<readonly [number, number]> = []
  for (const m of note.matchAll(/(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})/g)) {
    hours.push([Number(m[1]), Number(m[3])])
  }
  if (days === null || hours.length === 0) return null
  const utcOffsetMinutes = note.includes('北京时间') ? 480 : 0
  return { hours, days, utcOffsetMinutes }
}

/** 解析厂商标价页；结构不符合预期时抛错（显式失败，绝不猜）。 */
export function parseDeepSeekPricingPage(html: string): DeepSeekPricingSnapshot {
  const table = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html)
  if (table === null) throw new Error('deepseek-pricing: 页面里找不到 <table>')
  const grid = expandTable(table[1] ?? '')
  const header = grid[0]
  if (header === undefined) throw new Error('deepseek-pricing: 表格没有数据行')

  const modelColumns: Array<{ modelId: string; col: number }> = []
  header.forEach((text, col) => {
    const m = MODEL_HEADER.exec(text)
    if (m !== null && m[1] !== undefined) modelColumns.push({ modelId: m[1], col })
  })
  if (modelColumns.length === 0) throw new Error('deepseek-pricing: 表头里找不到模型列')

  const rates = new Map<string, { cacheHit: VendorRatePair; cacheMiss: VendorRatePair; output: VendorRatePair }>()
  for (const { modelId } of modelColumns) rates.set(modelId, { cacheHit: { offPeak: NaN, peak: NaN }, cacheMiss: { offPeak: NaN, peak: NaN }, output: { offPeak: NaN, peak: NaN } })

  for (const row of grid) {
    const band = row.map(bandOf).find((b): b is 'offPeak' | 'peak' => b !== null)
    if (band === undefined) continue
    const metric = row.map(metricOf).find((m): m is 'cacheHit' | 'cacheMiss' | 'output' => m !== null)
    if (metric === undefined) continue
    for (const { modelId, col } of modelColumns) {
      const value = parseValueCny(row[col] ?? '')
      if (value === null) throw new Error(`deepseek-pricing: ${modelId} 的 ${metric}/${band} 单价无法解析（原始格 "${row[col] ?? ''}"）`)
      const entry = rates.get(modelId)
      if (entry === undefined) continue
      entry[metric][band] = value
    }
  }

  const models: VendorModelPrice[] = modelColumns.map(({ modelId }) => {
    const rate = rates.get(modelId)
    if (rate === undefined) throw new Error(`deepseek-pricing: 模型 ${modelId} 没有解析出价格`)
    for (const metric of ['cacheHit', 'cacheMiss', 'output'] as const) {
      const pair = rate[metric]
      if (!Number.isFinite(pair.offPeak) || !Number.isFinite(pair.peak)) {
        throw new Error(`deepseek-pricing: ${modelId} 缺少 ${metric} 的空闲或高峰单价`)
      }
    }
    return { modelId, cacheHit: rate.cacheHit, cacheMiss: rate.cacheMiss, output: rate.output }
  })

  const footnotes = footnoteTexts(html)
  const aliasNote = footnotes.find(note => note.includes('旧模型名')) ?? ''
  const retiredAliases: string[] = []
  for (const m of aliasNote.matchAll(/[a-z][a-z0-9.-]*-(?:flash|pro)[a-z0-9.-]*/g)) {
    const id = m[0]
    if (!retiredAliases.includes(id) && !models.some(model => model.modelId === id)) retiredAliases.push(id)
  }

  const headlineModelId = /模型名请使用\s*([a-z][a-z0-9.-]*)/.exec(aliasNote)?.[1] ?? models[0]?.modelId
  if (headlineModelId === undefined) throw new Error('deepseek-pricing: 无法确定主模型 id')

  const offPeakIsHalfOfPeak = footnotes.some(note => note.includes('空闲时段价格为高峰时段价格的一半'))
  const windowsNote = footnotes.find(note => note.includes('高峰时段')) ?? ''
  const peakWindows = parsePeakWindows(windowsNote, offPeakIsHalfOfPeak)
  if (peakWindows === null) throw new Error('deepseek-pricing: 脚注里没有峰谷窗口（高峰时段 … 北京时间）')

  return { headlineModelId, retiredAliases, models, peakWindows, offPeakIsHalfOfPeak }
}

function toRate(cacheMiss: number, cacheHit: number, output: number): FinancePriceRate {
  return {
    inputMicrosPerMtok: Math.round(cacheMiss * 1_000_000),
    cacheReadMicrosPerMtok: Math.round(cacheHit * 1_000_000),
    outputMicrosPerMtok: Math.round(output * 1_000_000),
  }
}

/** 一个模型的 key（provider/model）。 */
export function deepSeekModelKey(modelId: string): string {
  return `${DEEPSEEK_PROVIDER}/${modelId}`
}

export interface SnapshotEraOptions {
  /** 该组价位的生效时刻（epoch ms）；生成器按"与上一版比较"决定是否追加。 */
  effectiveFrom: number
}

/**
 * 快照 → finance era 条目（windowed）。
 *
 * 规则层事实（`docs/FINANCE-PRICING-SPEC.md` §6）一并落进结构：峰时 = 2 × 谷时、
 * 窗口与星期取自负注。**结构只由这里产出** —— 用户侧覆盖不得改写（INV-1）。
 * 退役别名按脚注"按 Flash 价格计费"映射到主模型价位。
 */
export function snapshotToEras(
  snapshot: DeepSeekPricingSnapshot,
  options: SnapshotEraOptions,
): Record<string, FinancePriceEntry[]> {
  const { peakWindows } = snapshot
  if (peakWindows === null) throw new Error('deepseek-pricing: 缺少峰谷窗口，无法生成 windowed 条目')
  const out: Record<string, FinancePriceEntry[]> = {}
  const byModel = new Map(snapshot.models.map(model => [model.modelId, model]))

  const entryFor = (model: VendorModelPrice): FinancePriceEntry => {
    for (const metric of ['cacheHit', 'cacheMiss', 'output'] as const) {
      const pair = model[metric]
      if (Math.abs(pair.peak - pair.offPeak * 2) > 1e-9) {
        throw new Error(`deepseek-pricing: ${model.modelId} 的 ${metric} 不满足"空闲 = 高峰的一半"（${pair.offPeak} / ${pair.peak}）`)
      }
    }
    const rate: FinanceWindowedRate = {
      offPeak: toRate(model.cacheMiss.offPeak, model.cacheHit.offPeak, model.output.offPeak),
      peak: toRate(model.cacheMiss.peak, model.cacheHit.peak, model.output.peak),
      peakHours: peakWindows.hours,
      peakDays: peakWindows.days,
      utcOffsetMinutes: peakWindows.utcOffsetMinutes,
    }
    return { effectiveFrom: options.effectiveFrom, kind: 'windowed', rate }
  }

  for (const model of snapshot.models) out[deepSeekModelKey(model.modelId)] = [entryFor(model)]
  const headline = byModel.get(snapshot.headlineModelId)
  if (headline !== undefined) {
    for (const alias of snapshot.retiredAliases) out[deepSeekModelKey(alias)] = [entryFor(headline)]
  }
  return out
}

function sameRate(a: FinancePriceEntry, b: FinancePriceEntry): boolean {
  if (a.kind !== b.kind) return false
  return stableJson(a.rate) === stableJson(b.rate)
}

/**
 * 追加式历史的唯一入口（INV-4）：与最后一个 era 的数值/结构一致 → 不追加；
 * 否则必须 `effectiveFrom` 严格晚于最后一条再追加。永不删除既有 era。
 */
export function appendEra(
  existing: readonly FinancePriceEntry[],
  next: FinancePriceEntry,
): { entries: FinancePriceEntry[]; changed: boolean } {
  const last = existing[existing.length - 1]
  if (last === undefined) return { entries: [next], changed: true }
  if (sameRate(last, next)) return { entries: [...existing], changed: false }
  if (next.effectiveFrom <= last.effectiveFrom) {
    throw new Error(`deepseek-pricing: 新 era 的 effectiveFrom(${next.effectiveFrom}) 必须晚于最后一条(${last.effectiveFrom})`)
  }
  return { entries: [...existing, next], changed: true }
}
