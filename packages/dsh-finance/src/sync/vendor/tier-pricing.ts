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
  /**
   * 缓存读倍率（相对该档 input）。页面上只给倍率、不给绝对价的厂商用它
   * （Qwen 官方："命中 10%（显式）/ 20%（隐式）"）。与绝对价二选一，绝对价优先。
   */
  cacheReadMultiplier?: number
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

/* ─────────────────── 通用 N 档形状（GLM / Qwen 用） ─────────────────── */

/**
 * 一档（通用）：`maxPromptTokens` 是**上界**，0 = 兜底档（恒排最后）。
 * OpenAI / xAI 是"短/长两档"特例；GLM 最多 2 档、Qwen 最多 4 档，故这里用通用形状。
 */
export interface VendorTierRow {
  maxPromptTokens: number
  rates: VendorTierRates
}

/** N 档 → `FinanceTierSpec`（升序 + 兜底档最后；落档语义见 SPEC §2.3 规则 7）。 */
export function rowsToTierSpec(rows: readonly VendorTierRow[], currency: string): FinanceTierSpec {
  if (rows.length === 0) throw new Error('tier-pricing: 空档位表')
  const toEntry = (row: VendorTierRow): FinanceTierEntryInput => ({
    maxPromptTokens: row.maxPromptTokens,
    inputMicrosPerMtok: row.rates.inputMicrosPerMtok,
    outputMicrosPerMtok: row.rates.outputMicrosPerMtok,
    ...row.rates.cacheReadMicrosPerMtok !== undefined ? { cacheReadMicrosPerMtok: row.rates.cacheReadMicrosPerMtok } : {},
    ...row.rates.cacheWriteMicrosPerMtok !== undefined ? { cacheWriteMicrosPerMtok: row.rates.cacheWriteMicrosPerMtok } : {},
    ...row.rates.cacheReadMultiplier !== undefined ? { cacheReadMultiplier: row.rates.cacheReadMultiplier } : {},
  })
  const bounded = rows.filter(row => row.maxPromptTokens > 0).slice().sort((a, b) => a.maxPromptTokens - b.maxPromptTokens)
  const catchAll = rows.filter(row => row.maxPromptTokens === 0)
  return { currency, tiers: [...bounded, ...catchAll].map(toEntry) }
}

/**
 * 档位文本 → 上界 token（0 = 无上界/兜底档）。三种官方写法都要认：
 *
 * - `≥32K` / `>1M` —— 无上界 → 0（兜底档）
 * - `[0, 32K)` / `[32K, 128K)`（GLM）—— 取**右端**（半开区间上界）
 * - `0<Token≤32K` / `32K<Token≤256K`（Qwen）—— 取 `≤` 右侧
 */
export function ceilingOf(label: string): number | undefined {
  const scale = (value: string, unit: string | undefined): number => {
    const number = Number(value)
    if (!Number.isFinite(number)) return Number.NaN
    const suffix = (unit ?? '').toLowerCase()
    if (suffix === 'k') return Math.round(number * 1_000)
    if (suffix === 'm') return Math.round(number * 1_000_000)
    return Math.round(number)
  }
  // 半开区间 `[a, b)`：取右端 b。
  const range = /[\[(]\s*[0-9.]+\s*[kKmM]?\s*,\s*([0-9.]+)\s*([kKmM])?\s*[)\]]/.exec(label)
  if (range !== null) return scale(range[1]!, range[2])
  // 无上界：`≥` / `>`（但不含 `≤`/`<`，否则是 Qwen 的 `32K<Token≤256K` 这种区间写法）。
  if (/[≥>]/.test(label) && !/[≤<]/.test(label)) return 0
  // `≤` / `<` 右侧取**最后一个**（Qwen 的 `32K<Token≤256K` 上界是 256K，不是 32K）。
  const bounds = [...label.matchAll(/[≤<]\s*([0-9.]+)\s*([kKmM])?/g)]
  const last = bounds[bounds.length - 1]
  if (last === undefined) return undefined
  const value = scale(last[1]!, last[2])
  return Number.isFinite(value) ? value : undefined
}

/** 价格单元格 → 数值；`限时免费` / `免费` = 0，`-` / 非数字 = undefined（该行丢弃）。 */
export function parseCnyPriceCell(text: string): number | undefined {
  const trimmed = text.replace(/[\s\u00a0]+/g, '').trim()
  if (trimmed === '') return undefined
  if (trimmed === '免费' || trimmed === '限时免费') return 0
  const match = /^([0-9]+(?:\.[0-9]+)?)/.exec(trimmed)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/* ─────────────────────────── 智谱 GLM（zai） ─────────────────────────── */

/**
 * GLM 定价页（`docs.bigmodel.cn/cn/guide/start/pricing`，服务端渲染）→ 阶梯表。
 *
 * 列：模型名称 | 上下文/档位 | 输入单价 | 输出单价 | 缓存存储 | 缓存命中。
 * 单位一律 **元/百万 Tokens**（页面原文），故 `fx = 1`。
 *
 * **两条跳过规则**（不猜、不补）：
 * 1. **二维档（输入 × 输出）整模型跳过**：GLM-4.7 / GLM-4.5-Air 的档位形如
 *    `输入 [0, 32K)，输出 [0, 0.2K)`，`tiers` 是一维（只有 prompt 上界），
 *    无法忠实表达。若只跳带"输出"的行，会留下半张表（更糟）—— 所以按**整模型**跳。
 *    这些模型仍由 community 层的 flat 价覆盖，成本口径不受影响。
 * 2. **缓存存储**（元/百万 Tokens/小时）当前"限时免费"，且 `tiers` 无该维度 → 不产出。
 *
 * 缓存命中是**绝对价**（页面原文），直接落 `cacheReadMicrosPerMtok`，不走倍率。
 */
export function parseGlmTierPage(html: string, provider = 'zai'): Record<string, FinanceTierSpec> {
  const rowsByModel = new Map<string, { label: string; cells: string[] }[]>()
  for (const table of tablesOf(html)) {
    if (!table.includes('输入长度') && !table.includes('输入 [')) continue
    for (const raw of expandRows(table)) {
      const cells = raw.map(cleanText)
      const model = cells[0] ?? ''
      const label = cells[1] ?? ''
      if (!/^[A-Za-z0-9][A-Za-z0-9.\-]*$/.test(model)) continue
      if (!label.includes('输入长度') && !label.includes('输入 [')) continue
      const list = rowsByModel.get(model) ?? []
      list.push({ label, cells })
      rowsByModel.set(model, list)
    }
  }

  const out: Record<string, FinanceTierSpec> = {}
  for (const [model, rows] of rowsByModel) {
    // 跳过规则 1：任一档带"输出"维度 → 整个模型不进产物。
    if (rows.some(row => row.label.includes('输出'))) continue
    const tiers: VendorTierRow[] = []
    let bad = false
    for (const { label, cells } of rows) {
      const ceiling = ceilingOf(label)
      const input = parseCnyPriceCell(cells[2] ?? '')
      const output = parseCnyPriceCell(cells[3] ?? '')
      if (ceiling === undefined || input === undefined || output === undefined) { bad = true; break }
      const cacheRead = parseCnyPriceCell(cells[5] ?? '')
      tiers.push({
        maxPromptTokens: ceiling,
        rates: {
          inputMicrosPerMtok: Math.round(input * 1_000_000),
          outputMicrosPerMtok: Math.round(output * 1_000_000),
          ...cacheRead !== undefined ? { cacheReadMicrosPerMtok: Math.round(cacheRead * 1_000_000) } : {},
        },
      })
    }
    if (bad || tiers.length === 0) continue
    // 只有兜底档 = 事实上没有长度阶梯 → 不进产物（与"没录入"区分开）。
    if (tiers.every(row => row.maxPromptTokens === 0)) continue
    // 必须存在兜底档，否则长请求无价可落。
    if (!tiers.some(row => row.maxPromptTokens === 0)) continue
    out[`${provider}/${model.toLowerCase()}`] = rowsToTierSpec(tiers, 'CNY')
  }
  return out
}

/* ─────────────────────────── 阿里云百炼 Qwen ─────────────────────────── */

/**
 * Qwen 定价页（`help.aliyun.com/zh/model-studio/model-pricing`）→ 阶梯表。
 *
 * 只取**中国内地**价目（CNY，页面原文 → `fx = 1`）；海外站（全球/国际/美国/欧盟/日本…）
 * 是独立价目，混进来会把账算错（SPEC §2.3 规则 5 的"禁止跨币种/站点合并"）。
 *
 * **列位由表头解析，绝不写死偏移**：实测该页有 12 种表头形态（有无"服务部署范围"、
 * 有无"模式"、档位列叫"输入Token数"还是"输入Token范围"、输出价是一列还是按模式拆两列）。
 * 写死偏移会静默错列 —— 那正是"宁可不算，不可算错"要防的。
 *
 * **跳过规则**：
 * 1. **输出价按"非思考模式 / 思考模式"拆成两列 → 整模型跳过**：`tiers` 的输出价只有一个
 *    字段，无法忠实表达（qwen-plus 系列等）。
 * 2. 档位写 `无阶梯计价`、或只有单一档（无长度阶梯）的模型不产出。
 *
 * 缓存：页面只给"命中 10%（显式）/ 20%（隐式）"的**倍率区间**，取更贵的 0.2（保守侧）。
 */
export function parseQwenTierPage(html: string, provider = 'dashscope'): Record<string, FinanceTierSpec> {
  const REGIONS = new Set(['中国内地', '全球', '国际', '美国', '欧盟', '日本', '新加坡', '澳大利亚'])
  const rowsByModel = new Map<string, { ceiling: number; input: number; output: number }[]>()
  const divergent = new Set<string>()

  for (const table of tablesOf(html)) {
    if (!table.includes('Token≤') && !table.includes('无阶梯计价')) continue
    const header = headerOf(table)
    if (header === undefined) continue
    const tierCol = header.findIndex(cell => cell.includes('输入Token'))
    if (tierCol < 0) continue
    const regionCol = header.findIndex(cell => cell.includes('服务部署范围'))
    // 价格列：档位列之后、表头含"单价"的列。输出价按模式拆列时会有 ≥2 个"输出单价"。
    const priceCols = header.map((cell, index) => ({ cell, index })).filter(entry => entry.index > tierCol && entry.cell.includes('单价'))
    const inputCol = priceCols.find(entry => entry.cell.includes('输入'))
    if (inputCol === undefined) continue

    for (const raw of expandRows(table)) {
      const cells = raw.map(cleanText)
      const model = (cells[0] ?? '').split('\n')[0].trim().toLowerCase()
      if (!/^qwen[a-z0-9.\-]*$/.test(model)) continue
      if (regionCol >= 0) {
        const region = cells[regionCol] ?? ''
        // 非"中国内地"（含空 = 继承上一行的中国内地）一律不取。
        if (region !== '' && region !== '中国内地') continue
      }
      const ceiling = ceilingOf(cells[tierCol] ?? '')
      if (ceiling === undefined) continue
      const input = parseCnyPriceCell(cells[inputCol.index] ?? '')
      // 价格列：档位列之后的全部含"元"单元格。
      // **按单元格数而不是按表头数判分叉**：拆模式的表把"非思考模式 / 思考模式"放在
      // 子表头里，`<th>` 只有一个"输出单价"，但数据行有 3 个价格格。按表头数判会漏。
      const priceCells = cells.slice(tierCol + 1).filter(cell => cell.includes('元'))
      if (priceCells.length >= 3) { divergent.add(model); continue }
      const output = parseCnyPriceCell(priceCells[1] ?? priceCells[priceCells.length - 1] ?? '')
      if (input === undefined || output === undefined) continue
      const list = rowsByModel.get(model) ?? []
      list.push({ ceiling, input, output })
      rowsByModel.set(model, list)
    }
  }

  const out: Record<string, FinanceTierSpec> = {}
  for (const [model, rows] of rowsByModel) {
    if (divergent.has(model)) continue
    // 去重（同一模型可能在多张表里重复出现，例如"旗舰模型"段与"文本模型"段）。
    const byCeiling = new Map<number, { ceiling: number; input: number; output: number }>()
    for (const row of rows) if (!byCeiling.has(row.ceiling)) byCeiling.set(row.ceiling, row)
    const tiers = [...byCeiling.values()]
    // 无长度阶梯（只有一档）→ 不进产物，与"没录入"区分开。
    if (tiers.length < 2) continue
    /*
     * Qwen 的最高档是**有界**的（`128K<Token≤256K`），不像 OpenAI/xAI 那样给一个开口档。
     * 而落档语义要求存在无上界档，否则超出最高档的请求没有明确的价可落。故把**最高档**
     * 改写成兜底档（`maxPromptTokens = 0`）——语义等价：官方声明"输入总量落在该档即全量
     * 按该档单价结算"，而最高档本就吃掉超过它的一切（其上下文窗口即该上界）。
     * 已带显式兜底档时原样保留。
     */
    const sorted = tiers.slice().sort((a, b) => a.ceiling - b.ceiling)
    const normalized = sorted.some(row => row.ceiling === 0)
      ? sorted
      : sorted.map((row, index) => (index === sorted.length - 1 ? { ...row, ceiling: 0 } : row))
    out[`${provider}/${model}`] = rowsToTierSpec(normalized.map(row => ({
      maxPromptTokens: row.ceiling,
      rates: {
        inputMicrosPerMtok: Math.round(row.input * 1_000_000),
        outputMicrosPerMtok: Math.round(row.output * 1_000_000),
        cacheReadMultiplier: QWEN_CACHE_READ_MULTIPLIER,
      },
    })), 'CNY')
  }
  return out
}

/** 一张表的表头单元格（`<th>`；无 `<thead>` 时退回第一行的 `<td>`）。 */
function headerOf(table: string): string[] | undefined {
  const inHead = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(match => cleanText(match[1] ?? ''))
  if (inHead.length > 0) return inHead
  const firstRow = /<tr[^>]*>([\s\S]*?)<\/tr>/.exec(table)
  if (firstRow === null) return undefined
  return [...(firstRow[1] ?? '').matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(match => cleanText(match[1] ?? ''))
}

/** Qwen 缓存命中倍率：官方给"显式 10% / 隐式 20%"区间，取更贵的 0.2（保守）。 */
export const QWEN_CACHE_READ_MULTIPLIER = 0.2

/* ─────────────────────────── 共用工具 ─────────────────────────── */

/** 页面里的全部 `<table>`。 */
function tablesOf(html: string): string[] {
  return [...html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/g)].map(match => match[0])
}

/** 单元格文本：去标签、去零宽、压空白（**保留**换行，调用方按需切首行）。 */
function cleanText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim()
}

/**
 * 展开一张表的行（处理 rowspan）——与 `deepseek-pricing.expandTable` 同一算法。
 * 这里自带一份是为了不跨文件耦合（deepseek 那份绑定其自身单元格解析）。
 */
function expandRows(tableHtml: string): string[][] {
  const rawRows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1] ?? '')
  const out: string[][] = []
  let pending = new Map<number, { text: string; rowsLeft: number }>()
  for (const raw of rawRows) {
    const queue = [...raw.matchAll(/<(t[dh])([^>]*)>([\s\S]*?)<\/\1>/g)].map(m => ({
      text: m[3] ?? '',
      colspan: Number((/colspan="(\d+)"/.exec(m[2] ?? '') ?? [])[1] ?? 1) || 1,
      rowspan: Number((/rowspan="(\d+)"/.exec(m[2] ?? '') ?? [])[1] ?? 1) || 1,
    }))
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