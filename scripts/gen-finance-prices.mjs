#!/usr/bin/env node
/**
 * gen-finance-prices.mjs — 厂商价格**生成器**（规范：docs/FINANCE-PRICING-SPEC.md §3）。
 *
 * 职责（薄壳，纯逻辑在 packages/dsh-finance/src/sync/vendor/deepseek-pricing.ts）：
 *   1. 取厂商定价页（默认带尾斜杠的官方中文页；`--file` 走离线 fixture）
 *   2. 解析 → windowed era 条目
 *   3. 与已提交的追加式序列 `prices.series.json` 做 diff → **追加**新 era（INV-4，绝不覆盖）
 *   4. 产出三件套：prices.series.json（维护者输入）/ cordis.patch.yml 的生成段（发版随包）/
 *      packages/dsh-finance/src/pricing-hash.generated.ts（host 侧期望哈希锚点，INV-5）
 *
 * 用法：
 *   node scripts/gen-finance-prices.mjs --dry-run                 # 只打印 diff，不落盘
 *   node scripts/gen-finance-prices.mjs --file <html> --dry-run   # 离线 fixture
 *   node scripts/gen-finance-prices.mjs --effective-from 2026-09-10T00:00:00+08:00
 *   node scripts/gen-finance-prices.mjs --seed-from-yaml          # 一次性：把现有手写条目迁进序列
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  DEEPSEEK_PRICING_URL,
  DEEPSEEK_PROVIDER,
  appendEra,
  parseDeepSeekPricingPage,
  snapshotToEras,
} from '../packages/dsh-finance/src/sync/vendor/deepseek-pricing.ts'
import { financePricesFingerprint } from '../packages/dsh-finance/src/pricing.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE_YAML = path.join(ROOT, 'packages/dsh-finance-bundle/cordis.patch.yml')
const SERIES_JSON = path.join(ROOT, 'packages/dsh-finance-bundle/prices.series.json')
const HASH_TS = path.join(ROOT, 'packages/dsh-finance/src/pricing-hash.generated.ts')

export const MARKER_BEGIN = '# >>> FINANCE-VENDOR-PRICES-BEGIN'
export const MARKER_END = '# <<< FINANCE-VENDOR-PRICES-END'
const YAML_INDENT = '          ' // 10 空格：与脚本 sync-finance-prices.mjs 的 INDENT 一致（finance 行 config.prices 内）

/** 序列文件里的 era：finance 条目 + 溯源元数据。 */
function withMeta(entry, meta) {
  return { ...entry, meta }
}

/** 规范化 JSON：键序稳定 → 哈希与文件可逐字节复现（INV-8 / A4）。 */
export function canonicalSeries(series) {
  const prices = {}
  for (const key of Object.keys(series.prices).sort()) prices[key] = series.prices[key]
  return { ...series, prices }
}

/**
 * 产物哈希：必须与 host 侧校验用**同一个指纹函数**（pricing.ts 的 financePricesFingerprint），
 * 否则 YAML 往返一趟（键序变化、meta 丢失）就会假报警。
 */
export function hashSeries(series) {
  return createHash('sha256').update(financePricesFingerprint(canonicalSeries(series).prices)).digest('hex')
}

/** 条目 → YAML 段（只写 host 配置 schema 认识的字段；`kind` 由 offPeak 的存在推断）。 */
export function renderEntryYaml(entry, indent) {
  const lines = []
  const rate = entry.rate
  const isWindowed = rate.offPeak !== undefined
  // 列表项内容对齐列：键在 `${indent}`，"- " 之后的内容列在 indent + 2，嵌套映射再 +2。
  const body = indent + '  '
  const fields = (target, base) => {
    const out = [`${base}inputMicrosPerMtok: ${target.inputMicrosPerMtok}`]
    if (target.cacheReadMicrosPerMtok !== undefined) out.push(`${base}cacheReadMicrosPerMtok: ${target.cacheReadMicrosPerMtok}`)
    if (target.cacheWriteMicrosPerMtok !== undefined) out.push(`${base}cacheWriteMicrosPerMtok: ${target.cacheWriteMicrosPerMtok}`)
    out.push(`${base}outputMicrosPerMtok: ${target.outputMicrosPerMtok}`)
    return out
  }
  // 统一以 effectiveFrom 开列表项（0 → 1970，语义上"一直生效"），避免两种列表形态的缩进分歧。
  lines.push(`${indent}- effectiveFrom: "${new Date(entry.effectiveFrom).toISOString()}"`)
  if (!isWindowed) {
    lines.push(...fields(rate, body))
    return lines
  }
  lines.push(`${body}offPeak:`)
  lines.push(...fields(rate.offPeak, body + '  '))
  lines.push(`${body}peak:`)
  lines.push(...fields(rate.peak, body + '  '))
  if (rate.peakHours !== undefined) lines.push(`${body}peakHours: [${rate.peakHours.map(([s, e]) => `[${s}, ${e}]`).join(', ')}]`)
  if (rate.peakDays !== undefined) lines.push(`${body}peakDays: [${rate.peakDays.join(', ')}]`)
  if (rate.utcOffsetMinutes !== undefined) lines.push(`${body}utcOffsetMinutes: ${rate.utcOffsetMinutes}`)
  return lines
  /* c8 ignore next */
  if (entry.effectiveFrom > 0) {
    lines.push(`${indent}  offPeak:`)
    lines.push(`${indent}    inputMicrosPerMtok: ${rate.offPeak.inputMicrosPerMtok}`)
    if (rate.offPeak.cacheReadMicrosPerMtok !== undefined) lines.push(`${indent}    cacheReadMicrosPerMtok: ${rate.offPeak.cacheReadMicrosPerMtok}`)
    lines.push(`${indent}    outputMicrosPerMtok: ${rate.offPeak.outputMicrosPerMtok}`)
    lines.push(`${indent}  peak:`)
    lines.push(`${indent}    inputMicrosPerMtok: ${rate.peak.inputMicrosPerMtok}`)
    if (rate.peak.cacheReadMicrosPerMtok !== undefined) lines.push(`${indent}    cacheReadMicrosPerMtok: ${rate.peak.cacheReadMicrosPerMtok}`)
    lines.push(`${indent}    outputMicrosPerMtok: ${rate.peak.outputMicrosPerMtok}`)
    if (rate.peakHours !== undefined) lines.push(`${indent}  peakHours: [${rate.peakHours.map(([s, e]) => `[${s}, ${e}]`).join(', ')}]`)
    if (rate.peakDays !== undefined) lines.push(`${indent}  peakDays: [${rate.peakDays.join(', ')}]`)
    if (rate.utcOffsetMinutes !== undefined) lines.push(`${indent}  utcOffsetMinutes: ${rate.utcOffsetMinutes}`)
    return lines
  }
  lines.push(`${indent}- offPeak:`)
  lines.push(`${indent}    inputMicrosPerMtok: ${rate.offPeak.inputMicrosPerMtok}`)
  if (rate.offPeak.cacheReadMicrosPerMtok !== undefined) lines.push(`${indent}    cacheReadMicrosPerMtok: ${rate.offPeak.cacheReadMicrosPerMtok}`)
  lines.push(`${indent}    outputMicrosPerMtok: ${rate.offPeak.outputMicrosPerMtok}`)
  lines.push(`${indent}  peak:`)
  lines.push(`${indent}    inputMicrosPerMtok: ${rate.peak.inputMicrosPerMtok}`)
  if (rate.peak.cacheReadMicrosPerMtok !== undefined) lines.push(`${indent}    cacheReadMicrosPerMtok: ${rate.peak.cacheReadMicrosPerMtok}`)
  lines.push(`${indent}    outputMicrosPerMtok: ${rate.peak.outputMicrosPerMtok}`)
  if (rate.peakHours !== undefined) lines.push(`${indent}  peakHours: [${rate.peakHours.map(([s, e]) => `[${s}, ${e}]`).join(', ')}]`)
  if (rate.peakDays !== undefined) lines.push(`${indent}  peakDays: [${rate.peakDays.join(', ')}]`)
  if (rate.utcOffsetMinutes !== undefined) lines.push(`${indent}  utcOffsetMinutes: ${rate.utcOffsetMinutes}`)
  return lines
}

/** 生成段正文：只含本生成器负责的 provider（其余 provider 仍由社区同步块负责）。 */
export function renderVendorBlock(series, meta) {
  const keys = Object.keys(series.prices).filter(key => key.startsWith(DEEPSEEK_PROVIDER + '/')).sort()
  const lines = [`${YAML_INDENT}${MARKER_BEGIN} source=${meta.source} updated=${meta.updated} sha256=${meta.hash.slice(0, 16)}`]
  let lastProvider = ''
  for (const key of keys) {
    const provider = key.slice(0, key.indexOf('/'))
    if (provider !== lastProvider) {
      lines.push(`${YAML_INDENT}# ${provider}（生成物：scripts/gen-finance-prices.mjs，禁止手改）`)
      lastProvider = provider
    }
    lines.push(`${YAML_INDENT}${key}:`)
    for (const entry of series.prices[key]) lines.push(...renderEntryYaml(entry, YAML_INDENT + '  '))
  }
  lines.push(`${YAML_INDENT}${MARKER_END}`)
  return lines.join('\n')
}

export function spliceVendorBlock(yaml, block) {
  const begin = yaml.indexOf(MARKER_BEGIN)
  const end = yaml.indexOf(MARKER_END)
  if (begin !== -1 && end !== -1 && end > begin) {
    const lineStart = yaml.lastIndexOf('\n', begin) === -1 ? 0 : yaml.lastIndexOf('\n', begin) + 1
    const newlineAfterEnd = yaml.indexOf('\n', end)
    const after = newlineAfterEnd === -1 ? '' : yaml.slice(newlineAfterEnd + 1)
    return `${yaml.slice(0, lineStart)}${block}\n${after}`
  }
  if (begin !== -1 || end !== -1) throw new Error('gen-finance-prices: 标记只出现一半，请先手工修正 YAML')
  const anchor = yaml.lastIndexOf('- id: ui-finance')
  if (anchor === -1) throw new Error('gen-finance-prices: 找不到插入锚点（- id: ui-finance）')
  // 按【行首】切分：否则锚点行前导缩进会被留在 block 之前，锚点自身掉到第 0 列（YAML 直接解析失败）。
  const anchorLineStart = yaml.lastIndexOf('\n', anchor) === -1 ? 0 : yaml.lastIndexOf('\n', anchor) + 1
  return `${yaml.slice(0, anchorLineStart)}${block}\n\n${yaml.slice(anchorLineStart)}`
}

/**
 * 删除指定 provider 的**手写**条目（一次性迁移用）：跳过 markers 内的生成段，
 * 只清理散落在配置里的同名 key 及其缩进续行。迁移后本函数即空转（幂等）。
 */
export function stripProviderKeys(yaml, provider, markers) {
  const lines = yaml.split('\n')
  const out = []
  let insideMarkers = false
  let skipping = false
  let removed = 0
  for (const line of lines) {
    if (markers.some(marker => line.includes(marker))) {
      insideMarkers = !insideMarkers
      skipping = false
      out.push(line)
      continue
    }
    if (insideMarkers) { out.push(line); continue }
    if (skipping) {
      if (line.trim() === '' || /^\s{12,}/.test(line)) { removed += 1; continue }
      skipping = false
    }
    const key = new RegExp('^\\s*' + provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[a-z0-9.-]+:\\s*$')
    if (key.test(line)) { skipping = true; removed += 1; continue }
    out.push(line)
  }
  return { yaml: out.join('\n'), removed }
}

export function renderHashModule(hash, meta) {
  return `/**
 * 生成物 —— 禁止手改（scripts/gen-finance-prices.mjs）。
 *
 * host 加载 releaseBase 价格表后计算 sha256 并与本常量比对：不一致即"基础表被本地修改"
 * （FINANCE-PRICING-SPEC.md INV-5）。哈希锚点必须在 lib 里，不能与数据同处可写配置。
 */
export const FINANCE_PRICES_HASH = '${hash}'
export const FINANCE_PRICES_SOURCE = '${meta.source}'
export const FINANCE_PRICES_UPDATED = '${meta.updated}'
`
}

/** 一次性 seed：把 cordis.patch.yml 里手写的 deepseek-official 条目迁进序列（避免人工转录）。 */
export function seedFromYaml(yaml, provider) {
  const out = {}
  const lines = yaml.split('\n')
  let current = null
  let inWindowed = null
  for (const rawLine of lines) {
    const line = (rawLine.split('#')[0] ?? '').replace(/\s+$/, '')
    const keyMatch = /^\s+([a-z0-9-]+\/[a-z0-9.-]+):\s*$/.exec(line)
    if (keyMatch !== null) {
      if (current !== null && current.key.startsWith(provider + '/') && current.entries.length > 0) out[current.key] = current.entries
      current = { key: keyMatch[1], entries: [] }
      inWindowed = null
      continue
    }
    if (current === null) continue
    const flatStart = /^\s*-\s+inputMicrosPerMtok:\s*(\d+)/.exec(line)
    const eraStart = /^\s*-\s+effectiveFrom:\s*"?([^"]+)"?/.exec(line)
    if (eraStart !== null) {
      inWindowed = null
      current.entries.push({ effectiveFrom: Date.parse(eraStart[1]), kind: 'flat', rate: { inputMicrosPerMtok: 0, outputMicrosPerMtok: 0 } })
      continue
    }
    if (flatStart !== null) {
      if (inWindowed === null && current.entries.length === 0) current.entries.push({ effectiveFrom: 0, kind: 'flat', rate: { inputMicrosPerMtok: 0, outputMicrosPerMtok: 0 } })
      const entry = current.entries[current.entries.length - 1]
      if (entry.kind === 'flat' && entry.rate.inputMicrosPerMtok === 0) entry.rate.inputMicrosPerMtok = Number(flatStart[1])
      continue
    }
    const offPeakMark = /^\s*offPeak:\s*$/.exec(line)
    if (offPeakMark !== null) { inWindowed = 'offPeak'; continue }
    const peakMark = /^\s*peak:\s*$/.exec(line)
    if (peakMark !== null) { inWindowed = 'peak'; continue }
    const field = /^\s*(input|cacheRead|cacheWrite|output)MicrosPerMtok:\s*(\d+)/.exec(line)
    if (field !== null) {
      const name = field[1] + 'MicrosPerMtok'
      const entry = current.entries[current.entries.length - 1]
      if (entry === undefined) continue
      if (inWindowed === null) entry.rate[name] = Number(field[2])
      else {
        entry.kind = 'windowed'
        if (entry.rate.offPeak === undefined) entry.rate = { offPeak: { inputMicrosPerMtok: 0, outputMicrosPerMtok: 0 }, peak: { inputMicrosPerMtok: 0, outputMicrosPerMtok: 0 } }
        entry.rate[inWindowed][name] = Number(field[2])
      }
      continue
    }
    const hours = /^\s*peakHours:\s*(\[.*\])/.exec(line)
    if (hours !== null) { current.entries[current.entries.length - 1].rate.peakHours = JSON.parse(hours[1]); continue }
    const days = /^\s*peakDays:\s*(\[.*\])/.exec(line)
    if (days !== null) { current.entries[current.entries.length - 1].rate.peakDays = JSON.parse(days[1]); continue }
    const offset = /^\s*utcOffsetMinutes:\s*(\d+)/.exec(line)
    if (offset !== null) { current.entries[current.entries.length - 1].rate.utcOffsetMinutes = Number(offset[1]); continue }
  }
  if (current !== null && current.key.startsWith(provider + '/') && current.entries.length > 0) out[current.key] = current.entries
  return out
}

async function main(argv) {
  const flag = name => argv.includes(`--${name}`)
  const value = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1] }
  const dryRun = flag('dry-run')
  const bundleYaml = await readFile(BUNDLE_YAML, 'utf8')

  if (flag('seed-from-yaml')) {
    const seeded = seedFromYaml(bundleYaml, DEEPSEEK_PROVIDER)
    const series = canonicalSeries({
      schemaVersion: 1, currency: 'CNY', unit: 'per_mtok',
      generatedAt: new Date().toISOString(), sources: [],
      seedNote: 'migrated from cordis.patch.yml composition table (bill-verified 2026-09-16)',
      prices: seeded,
    })
    if (dryRun) { console.log(JSON.stringify(series.prices, null, 2)); return }
    await writeFile(SERIES_JSON, JSON.stringify(series, null, 2) + '\n', 'utf8')
    console.log(`seeded ${Object.keys(seeded).length} keys -> ${path.relative(ROOT, SERIES_JSON)}`)
    return
  }

  const observedAt = Date.parse(value('observed-at', new Date().toISOString()))
  const effectiveFrom = Date.parse(value('effective-from', new Date(observedAt).toISOString().slice(0, 10) + 'T00:00:00+08:00'))
  let html
  let source = DEEPSEEK_PRICING_URL
  if (flag('file')) {
    source = value('file')
    html = await readFile(source, 'utf8')
  } else {
    const response = await fetch(DEEPSEEK_PRICING_URL, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`gen-finance-prices: HTTP ${response.status} from ${DEEPSEEK_PRICING_URL}`)
    html = await response.text()
  }

  const snapshot = parseDeepSeekPricingPage(html)
  const fresh = snapshotToEras(snapshot, { effectiveFrom })

  let series
  try { series = JSON.parse(await readFile(SERIES_JSON, 'utf8')) } catch { series = { schemaVersion: 1, currency: 'CNY', unit: 'per_mtok', generatedAt: '', sources: [], prices: {} } }
  const prices = { ...series.prices }
  const report = []
  for (const [key, entries] of Object.entries(fresh)) {
    const existing = prices[key] ?? []
    const next = withMeta(entries[0], { src: source, observedAt, confidence: 'verified' })
    const { entries: merged, changed } = appendEra(existing.map(stripMeta), next)
    prices[key] = merged.map((entry, index) => (index < existing.length ? existing[index] : withMeta(entry, { src: source, observedAt, confidence: 'verified' })))
    report.push(`${changed ? 'APPEND' : '   same'} ${key} eras=${merged.length}`)
  }
  const nextSeries = canonicalSeries({ ...series, generatedAt: new Date(observedAt).toISOString(), sources: [{ id: 'deepseek-pricing-zh', url: source, fetchedAt: new Date(observedAt).toISOString() }], prices })
  const hash = hashSeries(nextSeries)
  const block = renderVendorBlock(nextSeries, { source, updated: new Date(observedAt).toISOString(), hash })

  console.log(report.join('\n'))
  console.log(`sha256=${hash}`)
  if (dryRun) {
    console.log('--- cordis.patch.yml 生成段（dry-run）---')
    console.log(block)
    return
  }
  const stripped = stripProviderKeys(bundleYaml, DEEPSEEK_PROVIDER, [MARKER_BEGIN, MARKER_END])
  if (stripped.removed > 0) console.log(`migrated: 删除 ${stripped.removed} 行手写 ${DEEPSEEK_PROVIDER} 条目`)
  await writeFile(SERIES_JSON, JSON.stringify(nextSeries, null, 2) + '\n', 'utf8')
  await writeFile(BUNDLE_YAML, spliceVendorBlock(stripped.yaml, block), 'utf8')
  await writeFile(HASH_TS, renderHashModule(hash, { source, updated: new Date(observedAt).toISOString() }), 'utf8')
  console.log(`wrote ${path.relative(ROOT, SERIES_JSON)}, ${path.relative(ROOT, BUNDLE_YAML)}, ${path.relative(ROOT, HASH_TS)}`)
}

/** 落盘时剥掉 meta（YAML/配置 schema 只认 finance 字段）。 */
function stripMeta(entry) {
  const { meta, ...rest } = entry
  return rest
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2))
