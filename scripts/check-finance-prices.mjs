#!/usr/bin/env node
/**
 * check-finance-prices.mjs — 财务价格体系闸门（SPEC §7 的 A2/A3/A4）。
 *
 * 防线动机（都是踩过的）：
 *   A2 覆盖：DSH 内置 deepseek 阵容里任何一个 model id 没有价格条目 → 账本会**静默**
 *      回落到全局 legacy 兜底价（本次 10~16 倍虚高的直接机制）。所以缺一条即失败。
 *   A3 结构：厂商规则"空闲 = 高峰的一半"必须逐项成立（含 cacheRead/input/output）。
 *   A4 一致性：生成物（cordis.patch.yml 的生成段）必须真的等于序列 prices.series.json，
 *      且必须能被 YAML 解析（曾经因为拼接缩进错误导致 - id: ui-finance 掉到第 0 列）。
 *
 * 用法：node scripts/check-finance-prices.mjs
 * 退出码：0 = 全过；1 = 有硬失败。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERIES_PATH = path.join(ROOT, 'packages/dsh-finance-bundle/prices.series.json')
const YAML_PATH = path.join(ROOT, 'packages/dsh-finance-bundle/cordis.patch.yml')
const MARKER_BEGIN = '# >>> FINANCE-VENDOR-PRICES-BEGIN'
const MARKER_END = '# <<< FINANCE-VENDOR-PRICES-END'
const PROVIDER = 'deepseek-official'

/** 厂商当前阵容：漏一个就会静默回落 legacy 兜底价（A2 的存在理由）。 */
const REQUIRED_KEYS = [
  PROVIDER + '/deepseek-flash',
  PROVIDER + '/deepseek-v4-flash',
  PROVIDER + '/deepseek-v4-pro',
  PROVIDER + '/deepseek-v4-flash-vision-exp',
]

const failures = []
const notes = []
const ok = (label, detail = '') => console.log('  ok   ' + label + (detail === '' ? '' : '   ' + detail))
const bad = (label, detail = '') => { failures.push(label); console.log('  FAIL ' + label + (detail === '' ? '' : '   ' + detail)) }

const series = JSON.parse(readFileSync(SERIES_PATH, 'utf8'))
const prices = series.prices ?? {}

console.log('══ 财务价格体系闸门（A2 覆盖 / A3 结构 / A4 生成物一致）══')

// ── A2 覆盖 ────────────────────────────────────────────────────────────────
const missing = REQUIRED_KEYS.filter(key => !(key in prices))
if (missing.length === 0) ok('A2 厂商当前阵容全部有条目', REQUIRED_KEYS.length + ' 个 key')
else bad('A2 厂商阵容缺条目（会静默回落 legacy 兜底价）', JSON.stringify(missing))

const emptyEras = Object.entries(prices).filter(([, eras]) => !Array.isArray(eras) || eras.length === 0).map(([key]) => key)
if (emptyEras.length === 0) ok('A2 每个 key 至少有一个 era')
else bad('A2 存在空 era 列表', JSON.stringify(emptyEras))

// ── A3 结构（峰 = 2 × 谷）───────────────────────────────────────────────────
const RATE_FIELDS = ['inputMicrosPerMtok', 'cacheReadMicrosPerMtok', 'cacheWriteMicrosPerMtok', 'outputMicrosPerMtok']
const rateMismatches = []
for (const [key, eras] of Object.entries(prices)) {
  for (const era of eras) {
    if (era.kind !== 'windowed') continue
    for (const field of RATE_FIELDS) {
      const off = era.rate?.offPeak?.[field]
      const peak = era.rate?.peak?.[field]
      if (off === undefined || peak === undefined) continue
      if (Math.abs(peak - off * 2) > 1) rateMismatches.push(key + '.' + field + ' off=' + off + ' peak=' + peak)
    }
    if (!Array.isArray(era.rate?.peakHours) || !Array.isArray(era.rate?.peakDays)) rateMismatches.push(key + ' 缺 peakHours/peakDays')
  }
}
if (rateMismatches.length === 0) ok('A3 峰时 = 2 × 谷时，且窗口/星期齐全')
else bad('A3 峰谷倍率或窗口结构不成立', JSON.stringify(rateMismatches))

// ── A4 生成物与序列一致（优先真解析 YAML）──────────────────────────────────
const yamlText = readFileSync(YAML_PATH, 'utf8')
const begin = yamlText.indexOf(MARKER_BEGIN)
const end = yamlText.indexOf(MARKER_END)
if (begin === -1 || end === -1 || end < begin) {
  bad('A4 找不到生成段 marker')
} else {
  const header = yamlText.slice(begin, yamlText.indexOf('\n', begin))
  if (/source=.+/.test(header) && /sha256=/.test(header)) ok('A4 生成段带来源与哈希标注')
  else bad('A4 生成段缺少 source/sha256 标注', header)

  const yamlModule = await loadYamlModule()
  if (yamlModule === null) {
    notes.push('未找到 yaml 解析器（可用 DSH_YAML_MODULE 指定）→ A4 退化为文本级检查')
    const block = yamlText.slice(begin, end)
    const missingKeys = REQUIRED_KEYS.filter(key => !block.includes('\n          ' + key + ':'))
    if (missingKeys.length === 0) ok('A4（文本级）生成段覆盖全部必需 key')
    else bad('A4（文本级）生成段缺 key', JSON.stringify(missingKeys))
  } else {
    const document = yamlModule.parse(yamlText)
    const row = (document?.[0]?.insert ?? []).find(entry => entry.id === 'finance')
    const yamlPrices = row?.config?.prices ?? {}
    const diffs = []
    for (const key of Object.keys(prices)) {
      const fromYaml = yamlPrices[key]
      if (fromYaml === undefined) { diffs.push(key + ' 在 YAML 里缺失'); continue }
      // 键序无关比较：YAML 往返会改变 rate 内部字段顺序（序列 seed 的键序与生成器不同）。
      if (stableJson(normalize(fromYaml)) !== stableJson(normalize(prices[key]))) diffs.push(key + ' 数值不一致')
    }
    if (diffs.length === 0) ok('A4 YAML 可解析，且生成段与 prices.series.json 逐值一致', Object.keys(prices).length + ' 个 key')
    else bad('A4 生成物与序列不一致', JSON.stringify(diffs))
  }
}

/**
 * 把两边的条目归一到同一形状再比：YAML 里是**未归一化**的形态（`offPeak`/`inputMicrosPerMtok`，
 * 没有 `kind`），序列里是归一化形态（`kind` + `rate`）。键序固定，故可逐字节比较。
 */
function toEra(entry) {
  const effectiveFrom = Number(new Date(entry.effectiveFrom ?? 0).getTime())
  if (entry.kind !== undefined) return { effectiveFrom, kind: entry.kind, rate: entry.rate }
  if (entry.offPeak !== undefined || entry.peak !== undefined) {
    return {
      effectiveFrom,
      kind: 'windowed',
      rate: {
        offPeak: entry.offPeak,
        peak: entry.peak,
        peakHours: entry.peakHours,
        peakDays: entry.peakDays,
        utcOffsetMinutes: entry.utcOffsetMinutes,
      },
    }
  }
  return {
    effectiveFrom,
    kind: 'flat',
    rate: {
      inputMicrosPerMtok: entry.inputMicrosPerMtok,
      cacheReadMicrosPerMtok: entry.cacheReadMicrosPerMtok,
      outputMicrosPerMtok: entry.outputMicrosPerMtok,
    },
  }
}

function normalize(eras) {
  return eras.map(toEra).sort((a, b) => a.effectiveFrom - b.effectiveFrom)
}

/** 键序无关的规范化 JSON（与 pricing.ts 的 stableJson 同规则）。 */
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item)).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}

async function loadYamlModule() {
  const candidates = [process.env.DSH_YAML_MODULE, 'yaml', globalYamlPath()].filter(Boolean)
  for (const candidate of candidates) {
    try {
      const spec = candidate.startsWith('file:') || candidate.includes(':') || candidate.includes('/') || candidate.includes('\\')
        ? pathToFileURL(candidate).href
        : candidate
      return await import(spec)
    } catch { /* 试下一个 */ }
  }
  return null
}

function globalYamlPath() {
  const nodeDir = path.dirname(process.execPath)
  return path.join(nodeDir, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', 'yaml', 'dist', 'index.js')
}

console.log('')
for (const note of notes) console.log('  note ' + note)
if (failures.length === 0) {
  console.log('合计：0 处硬失败 · 结果：PASS')
  process.exitCode = 0
} else {
  console.log('合计：' + failures.length + ' 处硬失败 · 结果：FAIL')
  process.exitCode = 1
}
