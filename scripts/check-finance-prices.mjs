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

import { createHash } from 'node:crypto'
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
/* A6 的常量与数据先于此处的 A4 块声明（A4 的 YAML 分支要复用它做 config.tiers 断言）。 */
const TIERS_MARKER_BEGIN = '# >>> FINANCE-VENDOR-TIERS-BEGIN'
const TIERS_MARKER_END = '# <<< FINANCE-VENDOR-TIERS-END'
const seriesTiers = series.tiers ?? {}
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
    // 解析失败必须**记成失败项**，不能把异常抛出去：抛异常会让闸门以一个栈回溯退出，
    // 既看不到其它检查项的结果，也让 CI 报错信息变成"脚本崩了"而不是"YAML 坏了"。
    let document
    try {
      document = yamlModule.parse(yamlText)
    } catch (error) {
      bad('A4 cordis.patch.yml 无法解析（生成段缩进/键冲突）', error instanceof Error ? error.message.split('\n')[0] : String(error))
      document = undefined
    }
    const row = (document?.[0]?.insert ?? []).find(entry => entry.id === 'finance')
    const yamlPrices = row?.config?.prices ?? {}

    // A6 核心断言：`config.tiers` 必须真的解析出来。生成段缩进错了（例如与 `prices:`
    // 的子键同级）会被 YAML **静默吞掉** —— 文本里 marker 齐全、config 里却没有 tiers。
    // 只看文本永远发现不了，所以这里必须解析后断言。
    const parsedTiers = row?.config?.tiers
    if (document === undefined) {
      bad('A6 无法断言 config.tiers（YAML 解析失败，见上一条）')
    } else if (parsedTiers === undefined || Object.keys(parsedTiers).length === 0) {
      bad('A6 解析后的 config.tiers 为空（生成段缩进错误 → 被 YAML 吞掉）', 'tiers=' + JSON.stringify(parsedTiers))
    } else {
      ok('A6 解析出的 config.tiers 非空', Object.keys(parsedTiers).length + ' 个模型')
      const tierDiffs = Object.keys(seriesTiers).filter(key => parsedTiers[key] === undefined)
      if (tierDiffs.length === 0) ok('A6 解析出的 tiers 覆盖序列全部 key')
      else bad('A6 解析出的 tiers 缺 key', JSON.stringify(tierDiffs))
    }

    const diffs = []
    for (const key of Object.keys(prices)) {
      const fromYaml = yamlPrices[key]
      if (fromYaml === undefined) { diffs.push(key + ' 在 YAML 里缺失'); continue }
      // 键序无关比较：YAML 往返会改变 rate 内部字段顺序（序列 seed 的键序与生成器不同）。
      if (stableJson(normalize(fromYaml)) !== stableJson(normalize(prices[key]))) diffs.push(key + ' 数值不一致')
    }
    if (diffs.length === 0) ok('A4 YAML 可解析，且生成段与 prices.series.json 逐值一致', Object.keys(prices).length + ' 个 key')
    else bad('A4 生成物与序列不一致', JSON.stringify(diffs))

    // A4b 跨侧指纹：host 的 getBasePriceIntegrity 用 basePriceFingerprint(composition) 与 lib 内
    // 常量比对。两侧必须用同一个指纹函数且结果相等 —— 否则面板会**误报**「基础表已被本地改动」
    // （曾经因为归一会给 flat 条目补一个 undefined 的 cacheWrite 键而误报）。
    const { basePriceFingerprint } = await import(pathToFileURL(path.join(ROOT, 'packages/dsh-finance/src/pricing.ts')).href)
    const { FINANCE_PRICES_HASH } = await import(pathToFileURL(path.join(ROOT, 'packages/dsh-finance/src/pricing-hash.generated.ts')).href)
    const subset = {}
    for (const [key, value] of Object.entries(yamlPrices)) {
      if (key.startsWith(PROVIDER + '/')) subset[key] = value
    }
    const actualHash = createHash('sha256').update(basePriceFingerprint(subset)).digest('hex')
    if (actualHash === FINANCE_PRICES_HASH) ok('A4b 配置侧指纹 = lib 内哈希常量（完整性检测不会误报）')
    else bad('A4b 配置侧指纹 ≠ lib 内哈希常量（面板会误报基础表被改）', actualHash.slice(0, 16) + ' vs ' + FINANCE_PRICES_HASH.slice(0, 16))
  }
}

/* ── A6 阶梯价结构（INV-1 单一结构源 / SPEC §2.3）────────────────────────────
 * 防线动机：`tiers` 在 S4 之前是 settings 里的手填项；迁进 releaseBase 后，
 * 最危险的失效模式是**生成段缩进错了、YAML 静默吞掉整个 tiers 键** ——
 * 生成器说"写好了"、面板却读不到，日志里一个字都没有。所以这里直接解析 YAML
 * 断言 `config.tiers` 真的存在，而不是只看文本里有没有 marker。
 */
console.log('')
console.log('══ A6 阶梯价结构（releaseBase 唯一结构源）══')

const tiersBegin = yamlText.indexOf(TIERS_MARKER_BEGIN)
const tiersEnd = yamlText.indexOf(TIERS_MARKER_END)
if (tiersBegin === -1 || tiersEnd === -1 || tiersEnd < tiersBegin) {
  bad('A6 找不到阶梯价生成段 marker（S4 后 tiers 必须由 releaseBase 产出）')
} else {
  const tiersHeader = yamlText.slice(tiersBegin, yamlText.indexOf('\n', tiersBegin))
  if (/source=.+/.test(tiersHeader) && /currency=/.test(tiersHeader)) ok('A6 阶梯价生成段带来源与币种标注')
  else bad('A6 阶梯价生成段缺少 source/currency 标注', tiersHeader)
}

if (Object.keys(seriesTiers).length === 0) {
  bad('A6 prices.series.json 没有 tiers 段（生成器没跑？）')
} else {
  ok('A6 序列带有阶梯价段', Object.keys(seriesTiers).length + ' 个模型')
}

// 逐项结构断言：不管 YAML 能否解析，先校验序列自身的语义（SPEC §2.3 规则 7）。
const tierProblems = []
for (const [key, spec] of Object.entries(seriesTiers)) {
  const tiers = spec?.tiers
  if (!Array.isArray(tiers) || tiers.length === 0) { tierProblems.push(key + ' 没有档位'); continue }
  const bounded = tiers.filter(t => t.maxPromptTokens > 0)
  const catchAll = tiers.filter(t => t.maxPromptTokens === 0)
  if (catchAll.length > 1) tierProblems.push(key + ' 有多个兜底档')
  // 兜底档必须在**最后**（生成段按升序渲染；插在中间会让长请求落错档）。
  if (catchAll.length === 1 && tiers[tiers.length - 1].maxPromptTokens !== 0) {
    tierProblems.push(key + ' 兜底档不在最后')
  }
  // 档位必须严格升序。多档厂商（Qwen 最多 4 档）很容易解析出重复上界 ——
  // 重复上界会让 tierForBucket 的 `find(>=)` 命中错档，故逐对检查而非只看长度。
  const ceilings = bounded.map(t => t.maxPromptTokens)
  for (let i = 1; i < ceilings.length; i += 1) {
    if (ceilings[i] <= ceilings[i - 1]) { tierProblems.push(key + ' 档位未严格升序'); break }
  }
  // 档位价格必须逐档**严格递增**：官方阶梯都是"越长越贵"。若解析把列读错位
  // （例如把免费额度列当成单价），这里立刻能看出价格不再单调。
  const ordered = [...bounded, ...catchAll]
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].inputMicrosPerMtok <= ordered[i - 1].inputMicrosPerMtok) {
      tierProblems.push(key + ' 输入价未随档位递增（疑似列错位）')
      break
    }
  }
  // 缓存读要么给绝对价、要么给倍率、要么缺省继承；倍率必须是正数。
  if (tiers.some(t => t.cacheReadMultiplier !== undefined && !(t.cacheReadMultiplier > 0))) {
    tierProblems.push(key + ' cacheReadMultiplier 非正数')
  }
  // 长档必须真的更贵：同价的"两档"是噪声，说明解析把无阶梯模型也写进来了。
  if (bounded.length === 1 && catchAll.length === 1) {
    const short = bounded[0]
    const long = catchAll[0]
    if (short.inputMicrosPerMtok === long.inputMicrosPerMtok && short.outputMicrosPerMtok === long.outputMicrosPerMtok) {
      tierProblems.push(key + ' 短/长档同价（无阶梯的模型不该进产物）')
    }
  }
  if (typeof spec?.currency !== 'string' || spec.currency === '') tierProblems.push(key + ' 缺少币种')
}
if (tierProblems.length === 0) ok('A6 每个阶梯价条目：档位严格升序、兜底档最后、价格逐档递增、带币种')
else bad('A6 阶梯价条目结构不成立', JSON.stringify(tierProblems))

// A6b：**生成物必须覆盖所有已接源的 provider**。防"某家源解析退化成 0 个模型"
// 而被静默接受（生成器只会打印一行 `x: 0 个模型`，产物里少一整家也没人察觉）。
const TIER_PROVIDERS = ['openai', 'xai', 'zai', 'dashscope']
const presentProviders = new Set(Object.keys(seriesTiers).map(key => key.split('/')[0]))
const missingProviders = TIER_PROVIDERS.filter(provider => !presentProviders.has(provider))
if (missingProviders.length === 0) {
  ok('A6b 已接源的 provider 都有阶梯价条目', TIER_PROVIDERS.join(' / '))
} else {
  bad('A6b 阶梯价生成物缺 provider（该家源解析退化了？）', JSON.stringify(missingProviders))
}

// A6c：倍率写法必须活着走到序列里。Qwen 只给倍率（命中 10%/20%），漏渲染会让缓存读
// 静默退化成"按输入价算"——真实缓存读只有输入价的 20%，即虚高 5 倍。
if (presentProviders.has('dashscope')) {
  const missingMultiplier = Object.entries(seriesTiers)
    .filter(([key]) => key.startsWith('dashscope/'))
    .filter(([, spec]) => !(spec?.tiers ?? []).every(t => typeof t.cacheReadMultiplier === 'number' && t.cacheReadMultiplier > 0))
    .map(([key]) => key)
  if (missingMultiplier.length === 0) ok('A6c Qwen 档位都带 cacheReadMultiplier（缓存读不会退化成输入价）')
  else bad('A6c Qwen 档位缺 cacheReadMultiplier', JSON.stringify(missingMultiplier.slice(0, 5)))
}

// 生成段 ↔ 序列逐值一致（与 A4 同精神：文本对不上就是产物漂移）。
if (tiersBegin !== -1 && tiersEnd > tiersBegin) {
  const block = yamlText.slice(tiersBegin, tiersEnd)
  // 用正则而非写死缩进：生成段的缩进是"tiers: 父键 + 2"，写死空格数一旦对不上
  // 就会误报（本次 S4 就踩了：块从 10 空格改到 8 空格，断言跟着错）。
  const missing = Object.keys(seriesTiers).filter(key => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return !new RegExp('^\\s+' + escaped + ':\\s*$', 'm').test(block)
  })
  if (missing.length === 0) ok('A6 生成段覆盖全部阶梯价 key', Object.keys(seriesTiers).length + ' 个')
  else bad('A6 生成段缺 key（生成器没跑或缩进错了）', JSON.stringify(missing))
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
