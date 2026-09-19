#!/usr/bin/env node
/**
 * gen-finance-tiers.mjs — 厂商**阶梯价**生成器（规范：docs/FINANCE-PRICING-SPEC.md §2.3 / §3）。
 *
 * 职责（薄壳，纯逻辑在 packages/dsh-finance/src/sync/vendor/tier-pricing.ts）：
 *   1. 取厂商定价页（OpenAI / xAI；`--file` 走离线 fixture）
 *   2. 解析成长短两档的阶梯表
 *   3. 渲染进 `packages/dsh-finance-bundle/cordis.patch.yml` 的 `tiers:` 生成段
 *      —— 这是 releaseBase，也就是 INV-1 下 `tiers` 的**唯一结构源**
 *   4. 同步 `prices.series.json` 的 `tiers` 段（维护者输入 + 幂等锚点）
 *
 * 为什么 `tiers` 要走生成物（S4）：SPEC INV-1 把 `tiers` 定义为结构维度，只能由 releaseBase
 * 产出；用户侧覆盖不得新增/替换结构。生成物随发版冻结，用户手填降级为 legacy overlay。
 *
 * 用法：
 *   node scripts/gen-finance-tiers.mjs --dry-run                  # 只打印，不落盘
 *   node scripts/gen-finance-tiers.mjs --file openai=./p.md       # 离线 fixture
 *   node scripts/gen-finance-tiers.mjs --fx 7.2 --currency CNY
 *
 * 幂等（INV-8）：同样的输入 → 逐字节相同的产物。渲染按 key 排序、字段序固定。
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseOpenAiTierPage, parseXaiTierPage, snapshotToTierSpecs } from '../packages/dsh-finance/src/sync/vendor/tier-pricing.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE_YAML = path.join(ROOT, 'packages/dsh-finance-bundle/cordis.patch.yml')
const SERIES_JSON = path.join(ROOT, 'packages/dsh-finance-bundle/prices.series.json')

export const MARKER_BEGIN = '# >>> FINANCE-VENDOR-TIERS-BEGIN'
export const MARKER_END = '# <<< FINANCE-VENDOR-TIERS-END'
/**
 * 8 空格：与 `prices:` 同级（都是 finance 行 `config` 的直接子键）。
 *
 * 踩过的坑：`prices` 生成段用 10 空格是因为它在 `prices:` **内部**；`tiers` 段必须
 * 用 8 空格 —— 用 10 会让 `tiers:` 缩进成 `prices` 的子键，被 YAML 静默吞掉
 * （表现为"生成物看着对、config 里根本没有 tiers"）。
 */
const YAML_INDENT = '        '
/** CNY micros per USD — 与 sync-finance-prices.mjs 的 DEFAULT_FX 同口径。 */
export const DEFAULT_FX = 7.2

/** 各 provider 的取数方式（URL 必须是可解析的 markdown；SPA 页面一律不猜）。 */
export const TIER_SOURCES = {
  openai: {
    kind: 'openai',
    url: 'https://developers.openai.com/api/docs/pricing.md',
    provider: 'openai',
  },
  xai: {
    kind: 'xai',
    url: 'https://docs.x.ai/developers/models/grok-4.6.md',
    modelId: 'grok-4.6',
    provider: 'xai',
  },
}

/** 一条档位 → YAML 行（字段序固定，保证幂等）。 */
function renderTierEntryYaml(entry, indent) {
  const lines = [`${indent}- maxPromptTokens: ${entry.maxPromptTokens}`]
  lines.push(`${indent}  inputMicrosPerMtok: ${entry.inputMicrosPerMtok}`)
  if (entry.cacheReadMicrosPerMtok !== undefined) lines.push(`${indent}  cacheReadMicrosPerMtok: ${entry.cacheReadMicrosPerMtok}`)
  if (entry.cacheWriteMicrosPerMtok !== undefined) lines.push(`${indent}  cacheWriteMicrosPerMtok: ${entry.cacheWriteMicrosPerMtok}`)
  lines.push(`${indent}  outputMicrosPerMtok: ${entry.outputMicrosPerMtok}`)
  return lines
}

/**
 * 阶梯表 → YAML 生成段正文（不含 markers）。key 排序保证幂等（INV-8）。
 *
 * **必须写出 `tiers:` 父键**：生成段是在 `config` 里与 `prices` 平级插入的，
 * 少了这一行，`openai/gpt-5.4:` 会变成 config 的未知字段而被 schema 静默丢弃
 * （表现为"生成物看着对、面板读不到"）。
 */
export function renderTierBlock(specs, meta) {
  const keys = Object.keys(specs).sort()
  const lines = [`${YAML_INDENT}${MARKER_BEGIN} source=${meta.source} updated=${meta.updated} fx=${meta.fx} currency=${meta.currency}`]
  lines.push(`${YAML_INDENT}# 生成物：scripts/gen-finance-tiers.mjs，禁止手改（INV-1 结构源）`)
  lines.push(`${YAML_INDENT}tiers:`)
  let lastProvider = ''
  for (const key of keys) {
    const provider = key.slice(0, key.indexOf('/'))
    if (provider !== lastProvider) {
      lines.push(`${YAML_INDENT}  # ${provider}`)
      lastProvider = provider
    }
    const spec = specs[key]
    lines.push(`${YAML_INDENT}  ${key}:`)
    lines.push(`${YAML_INDENT}    currency: ${spec.currency}`)
    lines.push(`${YAML_INDENT}    tiers:`)
    for (const entry of spec.tiers) lines.push(...renderTierEntryYaml(entry, YAML_INDENT + '      '))
  }
  lines.push(`${YAML_INDENT}${MARKER_END}`)
  return lines.join('\n')
}

/** 把生成段拼进 YAML（原地替换 markers 之间；不存在则插在 prices 生成段之后）。 */
export function spliceTierBlock(yaml, block) {
  const begin = yaml.indexOf(MARKER_BEGIN)
  const end = yaml.indexOf(MARKER_END)
  if (begin !== -1 && end !== -1 && end > begin) {
    const lineStart = yaml.lastIndexOf('\n', begin) === -1 ? 0 : yaml.lastIndexOf('\n', begin) + 1
    const newlineAfterEnd = yaml.indexOf('\n', end)
    const after = newlineAfterEnd === -1 ? '' : yaml.slice(newlineAfterEnd + 1)
    return `${yaml.slice(0, lineStart)}${block}\n${after}`
  }
  if (begin !== -1 || end !== -1) throw new Error('gen-finance-tiers: 标记只出现一半，请先手工修正 YAML')
  // 首次插入：紧跟 prices 的 vendor 生成段之后（仍属 config.prices/… 的兄弟位置）。
  const anchor = yaml.indexOf('# <<< FINANCE-VENDOR-PRICES-END')
  if (anchor === -1) throw new Error('gen-finance-tiers: 找不到锚点（FINANCE-VENDOR-PRICES-END）')
  const anchorLineEnd = yaml.indexOf('\n', anchor)
  if (anchorLineEnd === -1) throw new Error('gen-finance-tiers: 锚点行没有换行符')
  return `${yaml.slice(0, anchorLineEnd + 1)}${block}\n${yaml.slice(anchorLineEnd + 1)}`
}

/** 解析一个 provider 的源文本 → specs。 */
export function parseTierSource(text, source, fx) {
  if (source.kind === 'openai') return snapshotToTierSpecs(parseOpenAiTierPage(text, fx, source.provider), 'CNY')
  if (source.kind === 'xai') return snapshotToTierSpecs(parseXaiTierPage(text, source.modelId, fx, source.provider), 'CNY')
  throw new Error('gen-finance-tiers: 未知的源类型 ' + source.kind)
}

async function main(argv) {
  const flag = name => argv.includes(`--${name}`)
  const value = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1] }
  const dryRun = flag('dry-run')
  const fx = Number(value('fx', String(DEFAULT_FX)))
  const currency = value('currency', 'CNY')
  const files = new Map()
  // 支持多个 `--file name=path`（离线 fixture / 单源调试）。
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--file') continue
    const pair = argv[i + 1] ?? ''
    const [name, file] = pair.split('=')
    if (name !== undefined && file !== undefined && file !== '') files.set(name, file)
  }

  const specs = {}
  const sources = []
  for (const [name, source] of Object.entries(TIER_SOURCES)) {
    let text
    let usedUrl = source.url
    const local = files.get(name)
    if (local !== undefined) {
      text = await readFile(local, 'utf8')
      usedUrl = local
    } else {
      let response
      try {
        response = await fetch(source.url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'Mozilla/5.0' } })
      } catch (error) {
        // SPEC §3.4：来源不可达 → 不产出该部分，**绝不**回落上一次的值假装成功（INV-7）。
        console.error(`  skip ${name}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (!response.ok) {
        console.error(`  skip ${name}: HTTP ${response.status} from ${source.url}`)
        continue
      }
      text = await response.text()
    }
    const parsed = parseTierSource(text, source, fx)
    Object.assign(specs, parsed)
    sources.push({ id: name, url: usedUrl, keys: Object.keys(parsed).length })
    console.error(`  ${name}: ${Object.keys(parsed).length} 个模型有长度阶梯`)
  }

  if (Object.keys(specs).length === 0) {
    console.error('gen-finance-tiers: 没有解析出任何阶梯价（源全部不可达？）—— 不落盘')
    process.exitCode = 1
    return
  }

  const updated = new Date().toISOString()
  const block = renderTierBlock(specs, { source: sources.map(s => s.id).join('+'), updated, fx, currency })

  if (dryRun) {
    console.log(block)
    return
  }
  const yaml = await readFile(BUNDLE_YAML, 'utf8')
  await writeFile(BUNDLE_YAML, spliceTierBlock(yaml, block), 'utf8')

  // 序列侧同步一份：维护者输入 + 幂等锚点（与 prices 段同一文件）。
  let series
  try { series = JSON.parse(await readFile(SERIES_JSON, 'utf8')) } catch { series = {} }
  await writeFile(SERIES_JSON, JSON.stringify({ ...series, tiers: specs, tiersUpdatedAt: updated, tiersSources: sources }, null, 2) + '\n', 'utf8')
  console.log(`wrote ${path.relative(ROOT, BUNDLE_YAML)}, ${path.relative(ROOT, SERIES_JSON)}（${Object.keys(specs).length} 个模型）`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2))