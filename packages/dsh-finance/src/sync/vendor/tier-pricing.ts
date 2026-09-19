/**
 * 厂商**阶梯价**解析与生成（规范：docs/FINANCE-PRICING-SPEC.md §2.3 规则 7 / §3）。
 *
 * 为什么单独一条腿：`deepseek-pricing.ts` 处理的是 DeepSeek 的**峰谷窗口**（那家没有长度
 * 阶梯）；本模块处理"按单次请求输入 token 分档"的厂商（OpenAI 272K / xAI 200K）。
 * 两者产出的结构不同（windowed era vs tier spec），但都遵守同一条落档语义：
 * **全量按所在档**，不是分段累计（SPEC §2.3 规则 7）。
 *
 * 纯函数：解析与归一化不碰网络、不碰文件，薄壳在 `scripts/gen-finance-tiers.mjs`。
 */

import type { FinanceTierEntryInput, FinanceTierSpec } from '../../types.ts'

/** OpenAI 短/长上下文的分界（官方页 `<272K context length` 标注 + 272K 阈值文档）。 */
export const OPENAI_LONG_CONTEXT_THRESHOLD = 272_000
/** xAI 长短上下文的分界（官方页 "≥ 200k prompt tokens"）。 */
export const XAI_LONG_CONTEXT_THRESHOLD = 200_000

/** 一档价（整数 micros / Mtok，已按 fx 折算）。 */
export interface VendorTierRates {
  inputMicrosPerMtok: number
  outputMicrosPerMtok: number
  cacheReadMicrosPerMtok?: number
  cacheWriteMicrosPerMtok?: number
}

/** 一个模型的短/长两档。长档缺省 = 该模型没有长度阶梯。 */
export interface VendorTierModel {
  modelId: string
  /** 短上下文档（上界 = threshold）。 */
  short: VendorTierRates
  /** 长上下文档（上界 = 0，兜底）。缺省 = 无阶梯。 */
  long?: VendorTierRates
}

/** 一个 provider 的阶梯解析结果。 */
export interface VendorTierSnapshot {
  provider: string
  /** 短/长档的分界 token 数。 */
  threshold: number
  models: VendorTierModel[]
  /**
   * 源页面报价币种（通常是 USD）—— **只作溯源**。产物里写的是折算后的目标币种，
   * 因为账本按 CNY 记账（沿用 prices 生成器的 `--fx` 口径：宁可折算并标注，也不让
   * 整张表因币种不匹配被静默排除，SPEC §2.3 规则 5）。
   */
  sourceCurrency: string
}

/**
 * `$12.50` / `$0.075` / `-` → 数值（源报价的主单位）；`-` / 空 → undefined。
 *
 * 源页面用 `-` 表示"该档不收费/不适用"，与 `$0.00`（真的免费）语义不同，
 * 所以必须区分：前者返回 undefined（不写该字段），后者返回 0。
 */
export function parseMoneyCell(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '-' || trimmed === '—') return undefined
  const match = /^\$?\s*([0-9]+(?:\.[0-9]+)?)$/.exec(trimmed)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** 主单位（$）→ 整数 micros/Mtok（`fx` = 目标币种每 1 源币种）。 */
export function usdToMicrosPerMtok(value: number, fx: number): number {
  return Math.round(value * fx * 1_000_000)
}

/**
 * 一行报价 → 一个模型的短/长档。
 *
 * 长档全部缺省（`-`）时判定为**无长度阶梯**：只产出短档一条，`long` 留空 ——
 * 这样"该模型没有阶梯"与"阶梯两边同价"在产物里可区分。
 */
export function rowToTierModel(
  modelId: string,
  cells: readonly (number | undefined)[],
  shortCeiling: number,
  fx: number,
): VendorTierModel | undefined {
  const [shortInput, shortCached, shortWrite, shortOutput, longInput, longCached, longWrite, longOutput] = cells
  if (shortInput === undefined || shortOutput === undefined) return undefined
  const short: VendorTierRates = {
    inputMicrosPerMtok: usdToMicrosPerMtok(shortInput, fx),
    outputMicrosPerMtok: usdToMicrosPerMtok(shortOutput, fx),
    ...shortCached !== undefined ? { cacheReadMicrosPerMtok: usdToMicrosPerMtok(shortCached, fx) } : {},
    ...shortWrite !== undefined ? { cacheWriteMicrosPerMtok: usdToMicrosPerMtok(shortWrite, fx) } : {},
  }
  const hasLong = longInput !== undefined && longOutput !== undefined
  if (!hasLong) return { modelId, short }
  const long: VendorTierRates = {
    inputMicrosPerMtok: usdToMicrosPerMtok(longInput, fx),
    outputMicrosPerMtok: usdToMicrosPerMtok(longOutput, fx),
    ...longCached !== undefined ? { cacheReadMicrosPerMtok: usdToMicrosPerMtok(longCached, fx) } : {},
    ...longWrite !== undefined ? { cacheWriteMicrosPerMtok: usdToMicrosPerMtok(longWrite, fx) } : {},
  }
  // 两档完全同价 = 事实上无阶梯，按无阶梯产出（避免产物里出现等价冗余档）。
  if (sameRates(short, long)) return { modelId, short }
  void shortCeiling
  return { modelId, short, long }
}

function sameRates(a: VendorTierRates, b: VendorTierRates): boolean {
  return a.inputMicrosPerMtok === b.inputMicrosPerMtok
    && a.outputMicrosPerMtok === b.outputMicrosPerMtok
    && a.cacheReadMicrosPerMtok === b.cacheReadMicrosPerMtok
    && a.cacheWriteMicrosPerMtok === b.cacheWriteMicrosPerMtok
}

/**
 * 模型 → 该模型的阶梯表（`FinanceTierSpec`）。
 *
 * 落档语义（SPEC §2.3 规则 7）：档位 `maxPromptTokens` 是**上界**，命中该档后
 * **该请求全部 token** 按该档结算 —— 与 7 家官方原文一致。
 */
export function modelToTierSpec(model: VendorTierModel, threshold: number, currency: string): FinanceTierSpec {
  const toEntry = (rates: VendorTierRates, ceiling: number): FinanceTierEntryInput => ({
    maxPromptTokens: ceiling,
    inputMicrosPerMtok: rates.inputMicrosPerMtok,
    outputMicrosPerMtok: rates.outputMicrosPerMtok,
    ...rates.cacheReadMicrosPerMtok !== undefined ? { cacheReadMicrosPerMtok: rates.cacheReadMicrosPerMtok } : {},
    ...rates.cacheWriteMicrosPerMtok !== undefined ? { cacheWriteMicrosPerMtok: rates.cacheWriteMicrosPerMtok } : {},
  })
  const tiers: FinanceTierEntryInput[] = model.long === undefined
    ? [toEntry(model.short, 0)]
    : [toEntry(model.short, threshold), toEntry(model.long, 0)]
  return { currency, tiers }
}

/* ─────────────────────────── OpenAI ─────────────────────────── */

/** OpenAI 官方定价页的 markdown 表格行（`| model | short… | long… |`）。 */
const MD_ROW = /^\|([^|]+)\|(.+)\|\s*$/

/**
 * OpenAI 定价页（`developers.openai.com/api/docs/pricing.md`）→ 阶梯快照。
 *
 * 只读 **Standard** 表：Batch / Flex / Fast 是 serviceTier 维度（SPEC §9 非目标），
 * 混进来会把 Standard 价算错。表头自带 `Short/Long context …` 语义，故不靠猜列序。
 */
export function parseOpenAiTierPage(markdown: string, fx: number, provider = 'openai'): VendorTierSnapshot {
  const section = sectionOf(markdown, 'Standard pricing data')
  if (section === '') throw new Error('tier-pricing: OpenAI 页面缺少 Standard pricing data 段')
  const rows = tableRows(section)
  const header = rows[0]
  if (header === undefined) throw new Error('tier-pricing: OpenAI Standard 段没有表格')
  const columns = header.map(cell => cell.trim().toLowerCase())
  const indexOf = (needle: string): number => columns.findIndex(column => column.includes(needle))
  const col = {
    input: indexOf('short context input'),
    cached: indexOf('short context cached'),
    write: indexOf('short context cache writes'),
    output: indexOf('short context output'),
    longInput: indexOf('long context input'),
    longCached: indexOf('long context cached'),
    longWrite: indexOf('long context cache writes'),
    longOutput: indexOf('long context output'),
  }
  if (col.input < 0 || col.output < 0) throw new Error('tier-pricing: OpenAI 表头缺少 short context 列')
  const models: VendorTierModel[] = []
  for (const row of rows.slice(1)) {
    const rawName = (row[0] ?? '').trim()
    if (rawName === '' || rawName === '---') continue
    // 表头里的 `<272K context length` 是**说明**，模型 id 取第一个词。
    const modelId = rawName.split(/\s+/)[0]
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(modelId)) continue
    const model = rowToTierModel(modelId, [
      parseMoneyCell(row[col.input] ?? ''),
      col.cached < 0 ? undefined : parseMoneyCell(row[col.cached] ?? ''),
      col.write < 0 ? undefined : parseMoneyCell(row[col.write] ?? ''),
      parseMoneyCell(row[col.output] ?? ''),
      col.longInput < 0 ? undefined : parseMoneyCell(row[col.longInput] ?? ''),
      col.longCached < 0 ? undefined : parseMoneyCell(row[col.longCached] ?? ''),
      col.longWrite < 0 ? undefined : parseMoneyCell(row[col.longWrite] ?? ''),
      col.longOutput < 0 ? undefined : parseMoneyCell(row[col.longOutput] ?? ''),
    ], OPENAI_LONG_CONTEXT_THRESHOLD, fx)
    if (model !== undefined) models.push(model)
  }
  if (models.length === 0) throw new Error('tier-pricing: OpenAI Standard 段未解析出任何模型')
  return { provider, threshold: OPENAI_LONG_CONTEXT_THRESHOLD, models, sourceCurrency: 'USD' }
}

/* ─────────────────────────── xAI ─────────────────────────── */

/**
 * xAI 模型页（`docs.x.ai/developers/models/<id>.md`）→ 阶梯快照。
 *
 * 该页是一张「Type × 档位」的转置表（行 = Input / Cached input / Output，
 * 列 = 两个档位），与 OpenAI 的行式表相反，故单独一个解析器。
 */
export function parseXaiTierPage(markdown: string, modelId: string, fx: number, provider = 'xai'): VendorTierSnapshot {
  const rows = tableRows(markdown)
  if (rows.length === 0) throw new Error('tier-pricing: xAI 页面没有表格')
  const header = rows[0].map(cell => cell.trim())
  // 表头第一格是「Type」，其后每格是一个档位（含阈值文案）。
  const thresholds = header.slice(1).map(cell => thresholdOf(cell))
  if (thresholds.length !== 2 || thresholds.some(t => t === undefined)) {
    throw new Error('tier-pricing: xAI 表头不是"两档"形态：' + JSON.stringify(header))
  }
  const byType = new Map<string, (number | undefined)[]>()
  for (const row of rows.slice(1)) {
    const label = (row[0] ?? '').trim().toLowerCase()
    if (label === '') continue
    byType.set(label, row.slice(1).map(cell => parseMoneyCell(cell)))
  }
  const pick = (label: string): (number | undefined)[] | undefined => {
    for (const [key, value] of byType) if (key.includes(label)) return value
    return undefined
  }
  const input = pick('input')
  const output = pick('output')
  const cached = pick('cached')
  if (input === undefined || output === undefined) throw new Error('tier-pricing: xAI 表格缺少 Input/Output 行')
  // 档位按阈值升序：短档 = 较小阈值，长档 = 较大阈值（或无穷）。
  const order = thresholds[0]! <= thresholds[1]! ? [0, 1] : [1, 0]
  const shortIndex = order[0]
  const longIndex = order[1]
  const shortThreshold = thresholds[shortIndex]!
  const model = rowToTierModel(modelId, [
    input[shortIndex], cached?.[shortIndex], undefined, output[shortIndex],
    input[longIndex], cached?.[longIndex], undefined, output[longIndex],
  ], shortThreshold, fx)
  if (model === undefined) throw new Error('tier-pricing: xAI 页面缺少可用档位')
  return { provider, threshold: shortThreshold, models: [model], sourceCurrency: 'USD' }
}

/** `≥ 200k prompt tokens` / `< 200k prompt tokens` → 200000；无数字时 undefined。 */
function thresholdOf(cell: string): number | undefined {
  const match = /([0-9]+(?:\.[0-9]+)?)\s*([kKmM])?/.exec(cell)
  if (match === null) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined
  const unit = (match[2] ?? '').toLowerCase()
  if (unit === 'k') return Math.round(value * 1_000)
  if (unit === 'm') return Math.round(value * 1_000_000)
  return Math.round(value)
}

/* ─────────────────────────── 共用工具 ─────────────────────────── */

/** 取 `### <title>` 到下一个 `###` 之间的正文。 */
function sectionOf(markdown: string, title: string): string {
  const start = markdown.indexOf('### ' + title)
  if (start < 0) return ''
  const rest = markdown.slice(start)
  const next = rest.indexOf('\n### ', 1)
  return next < 0 ? rest : rest.slice(0, next)
}

/** markdown 表格 → 单元格二维数组（只取 `|` 行，剥掉分隔行）。 */
function tableRows(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split('\n')) {
    const match = MD_ROW.exec(line.trim())
    if (match === null) continue
    const cells = match[2].split('|').map(cell => cell.trim())
    if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue
    rows.push([match[1].trim(), ...cells])
  }
  return rows
}

/**
 * 阶梯快照 → `Record<modelKey, FinanceTierSpec>`（生成器产物形状）。
 *
 * - 只产出**真有阶梯**的模型：无阶梯的模型不该在产物里留一条"单档"记录 ——
 *   那会让"这个模型没阶梯"与"我们还没录入"在面板上无法区分。
 * - `targetCurrency` 是**折算后**的记账币种（生成器按 `--fx` 折好再写），
 *   不是源页面币种：账本按该币种记账，写源币种会让整张表被币种守卫静默排除。
 */
export function snapshotToTierSpecs(
  snapshot: VendorTierSnapshot,
  targetCurrency = 'CNY',
): Record<string, FinanceTierSpec> {
  const out: Record<string, FinanceTierSpec> = {}
  for (const model of snapshot.models) {
    if (model.long === undefined) continue
    out[`${snapshot.provider}/${model.modelId}`] = modelToTierSpec(model, snapshot.threshold, targetCurrency)
  }
  return out
}