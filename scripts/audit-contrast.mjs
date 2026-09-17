#!/usr/bin/env node
/**
 * 亮/暗主题对比度与 token 完整性闸门（CI 可跑，零依赖）。
 *
 * 两个检查：
 *  1) 对比度：把「设计系统里真实存在的 fg/bg 组合」列成表，按 WCAG 2.1 计算
 *     对比度（AA 正文 4.5 / 大字 3.0 / 非文本 3.0），任一不达标即退出码 1。
 *  2) token 完整性：扫描 packages/** 的 CSS + 内联 CSS 字符串，检查所有
 *     `var(--spk-*)` / `var(--dsw-*)` 引用是否在 dsh-ui-kit 的 token 层里定义。
 *     未定义 = 该属性在浏览器里 invalid at computed-value time（背景变透明、
 *     渐变整条失效），且预览态与宿主态渲染不一致。
 *
 * 用法：
 *   node scripts/audit-contrast.mjs            # 全量检查
 *   node scripts/audit-contrast.mjs --json     # 机器可读
 *   node scripts/audit-contrast.mjs --pairs    # 只打印对比度表
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '..')
const UIKIT_STYLES = path.join(ROOT, 'packages', 'dsh-ui-kit', 'src', 'styles')
const TOKEN_FILES = ['spark-tokens.css', 'base.css', 'dsw-bridge.css']

/* ──────────────────────────── 颜色工具 ──────────────────────────── */

/** @typedef {{ r: number, g: number, b: number, a: number }} RGBA */

/** 解析 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() / transparent。失败返回 null。 */
export function parseColor(input) {
  if (input == null) return null
  const s = String(input).trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  let m = /^#([0-9a-f]{3,8})$/.exec(s)
  if (m) {
    const h = m[1]
    const expand = (c) => parseInt(c.length === 1 ? c + c : c, 16)
    if (h.length === 3 || h.length === 4) {
      return {
        r: expand(h[0]), g: expand(h[1]), b: expand(h[2]),
        a: h.length === 4 ? expand(h[3]) / 255 : 1,
      }
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: expand(h.slice(0, 2)), g: expand(h.slice(2, 4)), b: expand(h.slice(4, 6)),
        a: h.length === 8 ? expand(h.slice(6, 8)) / 255 : 1,
      }
    }
    return null
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.some(Number.isNaN)) return null
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }
  return null
}

/** sRGB 相对亮度（WCAG 2.1）。 */
export function luminance({ r, g, b }) {
  const f = (v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** 把带 alpha 的前景色合成到背景色上。 */
export function composite(fg, bg) {
  if (fg.a >= 1) return { ...fg, a: 1 }
  const a = fg.a
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  }
}

/** WCAG 对比度（1..21）。 */
export function contrast(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

export function hexOf({ r, g, b }) {
  const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** color-mix(in srgb, color p%, transparent)：等价于「color 以 alpha=p 叠加在 backdrop 上」。 */
export function tint(color, pct, backdrop) {
  return composite({ ...color, a: pct / 100 }, backdrop)
}

/* ──────────────────────────── token 解析 ──────────────────────────── */

/** 剥注释 + 取顶层规则块（token 文件里没有嵌套块）。 */
function ruleBlocks(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(clean))) out.push({ selector: m[1].trim(), body: m[2] })
  return out
}

function parseDecls(body) {
  /** @type {Record<string,string>} */
  const map = {}
  for (const chunk of body.split(';')) {
    const i = chunk.indexOf(':')
    if (i < 0) continue
    const name = chunk.slice(0, i).trim()
    if (!name.startsWith('--')) continue
    map[name] = chunk.slice(i + 1).trim()
  }
  return map
}

/** 从 token 文件集合里抽出 { base, light, dark } 三张表。 */
export function buildTokenTables(files = TOKEN_FILES) {
  let base = {}
  let light = {}
  let dark = {}
  for (const f of files) {
    const css = readFileSync(path.join(UIKIT_STYLES, f), 'utf8')
    for (const { selector, body } of ruleBlocks(css)) {
      const decls = parseDecls(body)
      if (!Object.keys(decls).length) continue
      const sel = selector.replace(/\s+/g, ' ')
      const isDark = /data-ds-dark-theme|data-theme="dark"/.test(sel)
      const isLight = /data-theme="light"/.test(sel)
      if (isDark) dark = { ...dark, ...decls }
      else if (isLight) light = { ...light, ...decls }
      // base.css 的 :root 与 spark-tokens.css 的裸 body 都是「两个主题共享」的层
      else if (/(^|,)\s*(body|:root)\s*$/.test(sel) || sel === 'body' || sel === ':root') base = { ...base, ...decls }
      else if (/^body(\s*,|$)/.test(sel)) base = { ...base, ...decls }
    }
  }
  return {
    light: { ...base, ...light },
    dark: { ...base, ...light, ...dark },
    /** 仅 spark-tokens.css 的 body 块：两个主题共享的 primitives（--spk-n-* 等） */
    base,
    bridged: buildBridgedNames(),
  }
}

/** dsw-bridge.css 里定义的 --dsw-* 名字集合（= 插件可以安全消费的宿主别名）。 */
function buildBridgedNames() {
  const css = readFileSync(path.join(UIKIT_STYLES, 'dsw-bridge.css'), 'utf8')
  const names = new Set()
  for (const { body } of ruleBlocks(css)) {
    for (const name of Object.keys(parseDecls(body))) names.add(name)
  }
  return names
}

/** 递归解 var() 链（带 fallback 支持）。解不出返回 null。 */
export function resolveToken(map, name, depth = 0) {
  if (depth > 12) return null
  const raw = map[name]
  if (raw == null) return null
  return resolveValue(map, raw, depth)
}

export function resolveValue(map, value, depth = 0) {
  if (depth > 12) return null
  const s = String(value).trim()
  if (!s.startsWith('var(')) return s
  const inner = s.slice(4, -1)
  // var(--x, fallback) —— fallback 内部可能又含逗号，所以按第一个顶层逗号切
  let level = 0
  let comma = -1
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '(') level++
    else if (ch === ')') level--
    else if (ch === ',' && level === 0) { comma = i; break }
  }
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
  const fallback = comma < 0 ? null : inner.slice(comma + 1).trim()
  const hit = map[name]
  if (hit != null) {
    const resolved = resolveValue(map, hit, depth + 1)
    if (resolved != null) return resolved
  }
  if (fallback != null) return resolveValue(map, fallback, depth + 1)
  return null
}

/* ──────────────────────────── 组合表达式 ──────────────────────────── */
/**
 * 求值一个「颜色表达式」：
 *   --spk-label            token
 *   #fff / rgba(...)        字面量
 *   mix(A, 14, B)           color-mix(in srgb, A 14%, transparent) 叠加在 B 上
 */
export function evalSpec(map, spec) {
  const s = String(spec).trim()
  const mixMatch = /^mix\(\s*([^,]+),\s*([\d.]+)\s*,\s*([^)]+)\)$/.exec(s)
  if (mixMatch) {
    const A = evalSpec(map, mixMatch[1])
    const B = evalSpec(map, mixMatch[3])
    if (!A || !B) return null
    return tint(A, Number(mixMatch[2]), B)
  }
  if (s.startsWith('--')) {
    const v = resolveToken(map, s)
    return v == null ? null : parseColor(v)
  }
  return parseColor(s)
}

/* ──────────────────────────── 对比度表 ──────────────────────────── */

/** 五模块 accent（与 spark-tokens.css 的 --spk-acc-* 对齐）。 */
const MODULES = ['spark', 'hippomemo', 'finance', 'github', 'npm']

/** 卡片面 / 面板面 / 浮层面 —— 表里反复用到，先取个短名。 */
const CARD = '--spk-surface-card'
const PANEL = '--spk-platform'
const FLOAT = '--spk-surface-float'
const L1 = '--spk-layer-1'
const L2 = '--spk-layer-2'
/**
 * 悬浮球球面 = `--spk-surface-float` 92% 叠在面板底上（玻璃球是半透明的，
 * 只用 surface-float 的不透明值算会和实际渲染偏掉 8%）。
 * 球浮在应用底/面板底之上，这两个底恰好都在浮层面附近，故合成后取值稳定。
 */
const BALL = 'mix(--spk-surface-float, 92, --spk-platform)'

/**
 * @typedef {object} Pair
 * @property {string} id       人读的说明
 * @property {string} source   出处（文件:规则），便于回查
 * @property {number} min      要求的最低对比度（AA）
 * @property {string} fg
 * @property {string} bg
 * @property {number} [fgAlpha] 前景再加一层元素 opacity（finance 的 opacity 写法）
 * @property {number} [bgAlpha]
 */

/** 与主题无关的配对（同一 token 名在 light/dark 下各算一次）。 */
export const THEMED_PAIRS = /** @type {Pair[]} */ ([
  // ── A. 中性文字层级（正文 / 次要 / 元信息）─────────────────────────
  { id: 'label on card', source: 'ui-kit Card.title', min: 4.5, fg: '--spk-label', bg: CARD },
  { id: 'label-2 on card', source: 'ui-kit Card body / Disclosure.body', min: 4.5, fg: '--spk-label-2', bg: CARD },
  { id: 'label-3 on card', source: 'ui-kit Card meta / Input.label', min: 4.5, fg: '--spk-label-3', bg: CARD },
  { id: 'label on layer-2', source: 'SettingsCard.statValue / Chart.donutValue', min: 4.5, fg: '--spk-label', bg: L2 },
  { id: 'label-2 on layer-2', source: 'BarChart.barLabel / legendLabel', min: 4.5, fg: '--spk-label-2', bg: L2 },
  { id: 'label-3 on layer-2', source: 'Chart.trendTick / legendValue / EmptyState.hint', min: 4.5, fg: '--spk-label-3', bg: L2 },
  { id: 'label on panel', source: 'dock-head .name', min: 4.5, fg: '--spk-label', bg: PANEL },
  { id: 'label-2 on panel', source: 'dock .meta / PanelShell.subtitle', min: 4.5, fg: '--spk-label-2', bg: PANEL },
  { id: 'label-3 on panel', source: 'dock-head .sub / dock-hint / dock-empty', min: 4.5, fg: '--spk-label-3', bg: PANEL },
  { id: 'label-3 on layer-1', source: 'SettingsCard.desc / Input placeholder', min: 4.5, fg: '--spk-label-3', bg: L1 },
  { id: 'label-2 on float', source: 'Menu.item / Modal.close / Toast text', min: 4.5, fg: '--spk-label-2', bg: FLOAT },
  { id: 'label on float', source: 'Modal.title / Toast body', min: 4.5, fg: '--spk-label', bg: FLOAT },

  // ── B. 品牌 ────────────────────────────────────────────────────────
  { id: 'brand-fg on card', source: 'Menu.selected / Modal strong / syncLink:hover', min: 4.5, fg: '--spk-brand-fg', bg: CARD },
  { id: 'brand-fg on layer-2', source: 'hippomemo tag-brand / fact-spark', min: 4.5, fg: '--spk-brand-fg', bg: L2 },
  { id: 'brand-fg on brand-soft', source: 'hippomemo tag-brand (10% tint)', min: 4.5, fg: '--spk-brand-fg', bg: 'mix(--spk-brand, 10, ' + CARD + ')' },
  { id: 'on-brand on brand fill', source: 'ui-kit Button.primary', min: 4.5, fg: '--spk-on-brand', bg: '--spk-brand' },
  { id: 'on-brand on brand-hover', source: 'ui-kit Button.primary:hover', min: 4.5, fg: '--spk-on-brand', bg: '--spk-brand-hover' },

  // ── C. 状态色当文字用 ──────────────────────────────────────────────
  { id: 'success on card', source: 'github/npm .notice / SettingsCard .pos', min: 4.5, fg: '--spk-success', bg: CARD },
  { id: 'success on layer-2', source: 'hippomemo tag-success / prefill-hit', min: 4.5, fg: '--spk-success', bg: L2 },
  { id: 'success on success-soft', source: 'hippomemo tag-success tint', min: 4.5, fg: '--spk-success', bg: 'mix(--spk-success, 10, ' + CARD + ')' },
  { id: 'warn on card', source: 'finance staleSyncHint / hippomemo tag-warn', min: 4.5, fg: '--spk-warn', bg: CARD },
  { id: 'warn on warn-soft', source: 'hippomemo tag-warn tint', min: 4.5, fg: '--spk-warn', bg: 'mix(--spk-warn, 10, ' + CARD + ')' },
  { id: 'error on card', source: 'github/npm .error / Input.error', min: 4.5, fg: '--spk-error', bg: CARD },
  // 危险态胶囊（dock .dock-pill.danger 的「丢弃」）躺在 layer-2 槽面上，不是卡面
  { id: 'error on layer-2', source: 'dock .dock-pill.danger（PCQA-015）', min: 4.5, fg: '--spk-error', bg: L2 },
  { id: 'error on error-soft', source: 'hippomemo tag-error tint', min: 4.5, fg: '--spk-error', bg: 'mix(--spk-error, 10, ' + CARD + ')' },
  { id: 'info on card', source: 'finance balanceRowSource host-known', min: 4.5, fg: '--spk-info', bg: CARD },
  { id: 'on-error on error fill', source: 'ui-kit Button.danger', min: 4.5, fg: '--spk-on-error', bg: '--spk-error' },

  // ── D. 非文本（图标 / 描边 / 状态点）3:1 ───────────────────────────
  { id: 'focus ring vs card', source: 'ui-kit 所有 :focus-visible', min: 3.0, fg: '--spk-focus-ring', bg: CARD },
  { id: 'error dot on card', source: 'StateDot.error / balanceRowDot', min: 3.0, fg: '--spk-error', bg: CARD },
  { id: 'success dot on card', source: 'StateDot.live', min: 3.0, fg: '--spk-success', bg: CARD },
  { id: 'warn dot on card', source: 'StateDot.idle', min: 3.0, fg: '--spk-warn', bg: CARD },

  // ── E. 反例留档（soft：只提示、不判失败）─────────────────────────
  //   元素 opacity 冲淡文字是 finance 面板的既有写法，v4 已把正文改回 token 层级；
  //   这几条留档说明「为什么不能用 opacity 当第三层级」。
  { id: '[反例] label-2 × .72 冲淡', source: 'FinanceAuditSection .subtitle（已改 token）', min: 4.5, fg: '--spk-label-2', bg: CARD, fgAlpha: 0.72, soft: true },
  { id: '[反例] label-2 × .6 冲淡', source: 'FinanceAuditSection .kpiSub（已改 token）', min: 4.5, fg: '--spk-label-2', bg: CARD, fgAlpha: 0.6, soft: true },
  { id: '[反例] label-3 × .8 冲淡', source: 'ui-kit EmptyState.hint（已去掉 opacity）', min: 4.5, fg: '--spk-label-3', bg: CARD, fgAlpha: 0.8, soft: true },
  { id: '[提示] border-2 vs card 轮廓', source: '输入框/次级按钮描边（有底色辅助，非唯一线索）', min: 3.0, fg: '--spk-border-2', bg: CARD, soft: true },

  // ── F. 终端块（无论哪个主题都是深底）──────────────────────────────
  { id: 'term fg on term bg', source: 'ui-kit TerminalBlock .text', min: 4.5, fg: '--spk-term-fg', bg: '--spk-terminal-bg' },
  { id: 'term dim on term bg', source: 'ui-kit TerminalBlock .dim / .bar em', min: 4.5, fg: '--spk-term-dim', bg: '--spk-terminal-bg' },
  { id: 'term ok on term bg', source: 'ui-kit TerminalBlock .ok', min: 4.5, fg: '--spk-term-ok', bg: '--spk-terminal-bg' },
  { id: 'term warn on term bg', source: 'ui-kit TerminalBlock tone warn', min: 4.5, fg: '--spk-term-warn', bg: '--spk-terminal-bg' },
  { id: 'term error on term bg', source: 'ui-kit TerminalBlock .error', min: 4.5, fg: '--spk-term-error', bg: '--spk-terminal-bg' },
  { id: 'term prompt on term bg', source: 'ui-kit TerminalBlock .prompt / .cursor', min: 4.5, fg: '--spk-term-prompt', bg: '--spk-terminal-bg' },

  // ── G. 分段控件（亮色下曾整条不可见）──────────────────────────────
  { id: 'seg selected label on thumb', source: 'ui-kit SegmentedControl .tab[aria-selected]', min: 4.5, fg: '--spk-label', bg: '--spk-seg-thumb' },
  { id: 'seg unselected label on track', source: 'ui-kit SegmentedControl .tab', min: 4.5, fg: '--spk-label-2', bg: L2 },

  // ── H. 图表补充色（图形对象 ≥3:1）
  { id: 'chart alt-1 vs card', source: 'ui-kit CHART_PALETTE[5]', min: 3.0, fg: '--spk-chart-alt-1', bg: CARD },
  { id: 'chart alt-2 vs card', source: 'ui-kit CHART_PALETTE[6]', min: 3.0, fg: '--spk-chart-alt-2', bg: CARD },
  { id: 'chart alt-3 vs card', source: 'ui-kit CHART_PALETTE[7]', min: 3.0, fg: '--spk-chart-alt-3', bg: CARD },

  // ── I. 浮层与面板层次（≥1.05 才算「看得出差别」）─────────────────
  { id: 'card vs panel (层次)', source: 'Card on dock panel', min: 1.05, fg: CARD, bg: PANEL },
  { id: 'float vs panel (层次)', source: 'Menu/Modal/Toast 抬起', min: 1.05, fg: FLOAT, bg: PANEL },
  { id: 'layer-2 track vs card', source: 'BarChart track / donutTrack', min: 1.05, fg: L2, bg: CARD },
  { id: '表格斑马纹 vs 卡面', source: 'FinanceAuditSection .byModelTable 奇偶行', min: 1.05, fg: L2, bg: CARD },
  { id: '表头 vs 卡面', source: 'FinanceAuditSection .byModelTable thead（吸顶）', min: 1.05, fg: L2, bg: CARD },

  // ── J. 悬浮球（2026-09 静默形态）──────────────────────────────────
  //   球身 = 92% surface-float 玻璃球；标识走 --spk-brand-fg（实色档 --spk-brand
  //   在暗色下只有 4.50:1，正好压在 AA 线上，故不用于标识）。
  { id: '球标识 on 球面', source: 'dock .dock-ball svg（ui-kit 图标层）', min: 4.5, fg: '--spk-brand-fg', bg: BALL },
  { id: '球 focus ring vs 球面', source: 'dock .dock-ball:focus-visible（MASTER §5.3）', min: 3.0, fg: '--spk-focus-ring', bg: BALL },
  { id: '球身 vs 面板底（层次）', source: 'dock .dock-ball 球底与面板底可辨', min: 1.05, fg: BALL, bg: PANEL },
  { id: '[提示] 球描边 vs 球面', source: 'border-2 只负责描轮廓，非唯一线索（另有阴影 + 内壁亮线）', min: 3.0, fg: '--spk-border-2', bg: BALL, soft: true },
  //   播报气泡 = ui-kit Toast 同款浮层（球旁的事件播报，零动画）。来源行走 label-2：
  //   label-3 在暗色浮层面上 4.39:1 不达 AA。
  { id: '气泡正文 on 浮层面', source: 'dock .dock-bubble 事件文本', min: 4.5, fg: '--spk-label', bg: FLOAT },
  { id: '气泡来源行 on 浮层面', source: 'dock .dock-bubble .src（label-3 于此仅 4.39，禁用）', min: 4.5, fg: '--spk-label-2', bg: FLOAT },
  { id: '气泡品牌脊线 vs 浮层面', source: 'dock .dock-bubble border-left（非文本 3:1）', min: 3.0, fg: '--spk-brand', bg: FLOAT },
])

/** 逐模块 accent 配对（实色图形 / 文字态 / 实底芯片 / 淡底胶囊）。 */
export function modulePairs() {
  /** @type {Pair[]} */
  const out = []
  for (const m of MODULES) {
    const acc = `--spk-acc-${m}`
    const fg = `--spk-acc-${m}-fg`
    out.push(
      { id: `${m} 实色 vs 卡片（图形对象）`, source: '图表填充 / 指示条 / 圆点', min: 3.0, fg: acc, bg: CARD },
      { id: `${m} 文字态图标 on 卡片`, source: 'dock-tab.active 图标 / dock-prop-type', min: 4.5, fg: fg, bg: CARD },
      { id: `${m} 文字态图标 on 侧栏`, source: 'dock-tab.active（rail 面）', min: 4.5, fg: fg, bg: L2 },
      { id: `${m} 实底芯片标签`, source: 'dock-pill.on / 模块实底 chip', min: 4.5, fg: '--spk-on-accent', bg: fg },
      { id: `${m} 淡底胶囊文字`, source: 'Pill accentColor / dock-pill.mini.accent', min: 4.5, fg: fg, bg: `mix(${acc}, 14, ${CARD})` },
    )
  }
  return out
}

/** 跑全部对比度检查。 */
export function runPairs(tables) {
  const results = []
  for (const theme of ['light', 'dark']) {
    const map = tables[theme]
    for (const p of [...THEMED_PAIRS, ...modulePairs()]) {
      const fgRaw = evalSpec(map, p.fg)
      const bgRaw = evalSpec(map, p.bg)
      if (!fgRaw || !bgRaw) {
        results.push({ ...p, theme, ratio: null, actual: null, reason: 'unresolved token', ok: false })
        continue
      }
      const bg = p.bgAlpha != null ? composite({ ...bgRaw, a: p.bgAlpha }, bgRaw) : bgRaw
      const fg = p.fgAlpha != null ? composite({ ...fgRaw, a: p.fgAlpha }, bg) : fgRaw
      const ratio = contrast(fg, bg)
      results.push({
        id: p.id, source: p.source, min: p.min, theme, soft: p.soft === true,
        ratio, fgHex: hexOf(fg), bgHex: hexOf(bg), ok: ratio >= p.min - 0.005,
      })
    }
  }
  return results
}

/* ──────────────────────────── token 完整性 ──────────────────────────── */

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'lib' || entry === 'build') continue
    const abs = path.join(dir, entry)
    if (statSync(abs).isDirectory()) walk(abs, acc)
    else acc.push(abs)
  }
  return acc
}

/**
 * 扫描插件源码里所有 `var(--spk-…)` / `var(--dsw-…)` 引用，检查是否在 token 层定义。
 * - error：未定义且无 fallback → 浏览器里该属性失效（背景透明 / 渐变归零）
 * - warn ：未定义但有 fallback → fallback 是写死的静态色，暗色主题不会跟随
 */
export function auditTokenCoverage(tables) {
  const spkNames = new Set()
  for (const theme of ['light', 'dark']) for (const n of Object.keys(tables[theme])) spkNames.add(n)
  for (const n of Object.keys(tables.base)) spkNames.add(n)
  const bridged = tables.bridged

  const files = walk(path.join(ROOT, 'packages')).filter((f) => /\.(css|ts|tsx)$/.test(f))
  const findings = []
  for (const file of files) {
    if (file.includes(`dsh-ui-kit${path.sep}src${path.sep}styles${path.sep}`)) continue
    const text = readFileSync(file, 'utf8')
    const re = /var\(\s*(--(?:spk|dsw)-[a-z0-9-]+)\s*(,)?/g
    let m
    while ((m = re.exec(text))) {
      const name = m[1]
      const hasFallback = m[2] === ','
      const defined = name.startsWith('--spk-') ? spkNames.has(name) : bridged.has(name)
      if (defined) continue
      const line = text.slice(0, m.index).split('\n').length
      findings.push({
        file: path.relative(ROOT, file),
        line,
        name,
        hasFallback,
        severity: hasFallback ? 'warn' : 'error',
      })
    }
  }
  // 去重：同一文件同一 token 只报一次，取最严重
  const byKey = new Map()
  for (const f of findings) {
    const key = `${f.file}|${f.name}`
    const prev = byKey.get(key)
    if (!prev || (prev.severity === 'warn' && f.severity === 'error')) byKey.set(key, f)
  }
  return [...byKey.values()].sort((a, b) => (a.file + a.name).localeCompare(b.file + b.name))
}

/**
 * 设计系统文档不许自造颜色。
 *
 * 背景：`design-system/spark-dock/MASTER.md` 曾经整篇写着另一套「暖炭 + 琥珀」色板，
 * 而代码与静态预览都是「冷灰 + DSH 蓝」—— 文档漂移了整整一个大版本没人发现。
 * 规则：设计系统的 Source of Truth 文档里出现的每个十六进制色，都必须能在
 * **属于该家族**的 token 文件里找到。找不到 = 文档在发明颜色。
 *
 * sparkie 家族暂不纳入：它的角色层（Claymorphism 皮肤 + 情绪/状态色）目前只有
 * preview 里的一份取值，尚未收进可校验的 token 层，强行校验会产生误报。
 */
const DESIGN_DOC_FAMILIES = [
  {
    doc: 'design-system/spark-dock/MASTER.md',
    tokenFiles: [
      'packages/dsh-ui-kit/src/styles/spark-tokens.css',
      'packages/dsh-ui-kit/src/styles/dsw-bridge.css',
      'docs/spark-dock-preview/css/tokens.css',
    ],
  },
]

export function auditDesignDocs() {
  const findings = []
  for (const { doc, tokenFiles } of DESIGN_DOC_FAMILIES) {
    const allowed = new Set()
    for (const f of tokenFiles) {
      const text = readFileSync(path.join(ROOT, f), 'utf8')
      for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) allowed.add(m[0].toLowerCase())
    }
    const text = readFileSync(path.join(ROOT, doc), 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        const hex = m[0].toLowerCase()
        const body = hex.slice(1)
        // 排除 issue / PR 编号这类"长得像短 hex"的东西（#987、#1031）：
        // 3-4 位且纯数字的按编号处理，不当颜色看。
        if (body.length <= 4 && /^[0-9]+$/.test(body)) continue
        if (allowed.has(hex)) continue
        // #rgb 缩写：允许其展开形式存在
        if (hex.length === 4) {
          const [r, g, b] = [hex[1], hex[2], hex[3]]
          if (allowed.has(`#${r}${r}${g}${g}${b}${b}`)) continue
        }
        findings.push({ file: doc, line: i + 1, hex, severity: 'error' })
      }
    })
  }
  return findings
}

/* ──────────────────── 静态设计稿 ↔ 产品 token 一致性 ──────────────────── */

const PREVIEW_TOKENS = 'docs/spark-dock-preview/css/tokens.css'

/**
 * 设计稿必须与产品 token 逐值一致（这是"唯一视觉源"的可执行定义）。
 * 过去这份静态稿把「始终深色面板」和「随主题翻转的 layer token」混用，
 * 于是亮色主题下出现了白色正文压白卡 —— 同源不同值就会长出这种 bug。
 */
export const PREVIEW_PARITY_NAMES = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-0',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-surface-l1',
  '--dsw-alias-surface-float',
  '--dsw-alias-tooltip-bg',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-error',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-foreground',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-error-content',
  '--dsw-alias-state-info-tint',
  '--dsw-alias-state-error-tint',
]

export function auditPreviewParity(tables) {
  const css = readFileSync(path.join(ROOT, PREVIEW_TOKENS), 'utf8')
  const light = {}
  const dark = {}
  for (const { selector, body } of ruleBlocks(css)) {
    const decls = parseDecls(body)
    if (!Object.keys(decls).length) continue
    const sel = selector.replace(/\s+/g, ' ')
    if (/data-theme="dark"/.test(sel)) Object.assign(dark, decls)
    else if (/(^|,)\s*:root\s*$/.test(sel)) Object.assign(light, decls)
  }
  const findings = []
  for (const theme of ['light', 'dark']) {
    const pv = theme === 'light' ? light : { ...light, ...dark }
    for (const name of PREVIEW_PARITY_NAMES) {
      const want = resolveToken(tables[theme], name)
      const got = resolveValue(pv, pv[name] ?? '')
      if (want == null) continue
      if (got == null) {
        findings.push({ file: PREVIEW_TOKENS, theme, name, issue: '设计稿缺少该语义 token' })
        continue
      }
      const a = parseColor(want)
      const b = parseColor(got)
      if (!a || !b) continue
      const near = Math.abs(a.r - b.r) <= 0.5 && Math.abs(a.g - b.g) <= 0.5 && Math.abs(a.b - b.b) <= 0.5 && Math.abs(a.a - b.a) <= 0.01
      if (!near) {
        findings.push({ file: PREVIEW_TOKENS, theme, name, issue: `设计稿 ${got} ≠ 产品 ${want}` })
      }
    }
  }
  return findings
}

/* ──────────────── 插件源码禁直连宿主 token（acc-20260917） ──────────────── */

/**
 * 允许直连的宿主 token 前缀：字体栈与阴影。
 * 两者不参与对比度判定，且「和 shell 同源」正是设计意图（spark-dock-design §4）。
 */
const DSW_DIRECT_ALLOWED = ['--dsw-font-', '--dsw-shadow-']

/**
 * 扫描插件源码里对宿主 token 的直接引用。
 *
 * 背景（PC 端验收 20260917 的 PCQA-007/016）：真宿主里 `--dsw-*` 这些名字**由宿主自己
 * 定义**，取值与 ui-kit 的桥接段（dsw-bridge.css）不同 —— 实测 light 主题
 * `--dsw-alias-label-tertiary` 宿主给 #81858C，桥接给 #5F6A7D。于是同一个组件
 * 「预览/闸门按桥接值算，真宿主按宿主值渲染」：对比度表 154 项全绿，真宿主上
 * dock 副标题只有 3.42:1。语义色必须直连 `--spk-*`（仓库自己的 token 层），
 * 闸门与预览才和真宿主一致。
 */
export function auditHostAliasUsage() {
  const files = walk(path.join(ROOT, 'packages')).filter((f) => /.(css|ts|tsx)$/.test(f))
  const findings = []
  for (const file of files) {
    if (file.includes(`dsh-ui-kit${path.sep}src${path.sep}styles${path.sep}`)) continue
    const text = readFileSync(file, 'utf8')
    const re = /var\(\s*(--dsw-[a-z0-9-]+)/g
    let m
    while ((m = re.exec(text))) {
      const name = m[1]
      if (DSW_DIRECT_ALLOWED.some((p) => name.startsWith(p))) continue
      findings.push({ file: path.relative(ROOT, file), line: text.slice(0, m.index).split('\n').length, name })
    }
  }
  const byKey = new Map()
  for (const f of findings) byKey.set(`${f.file}|${f.name}`, f)
  return [...byKey.values()].sort((a, b) => (a.file + a.name).localeCompare(b.file + b.name))
}

/* ──────────────────────────── CLI ──────────────────────────── */

function fmt(n) { return n == null ? '  n/a ' : n.toFixed(2).padStart(5) }

function main() {
  const argv = process.argv.slice(2)
  const asJson = argv.includes('--json')
  const tables = buildTokenTables()
  const pairs = runPairs(tables)
  const coverage = auditTokenCoverage(tables)
  const docDrift = auditDesignDocs()
  const parity = auditPreviewParity(tables)
  const hostAlias = auditHostAliasUsage()

  const pairFails = pairs.filter((p) => !p.ok && !p.soft)
  const pairSoft = pairs.filter((p) => !p.ok && p.soft)
  const covErrors = coverage.filter((c) => c.severity === 'error')
  const covWarns = coverage.filter((c) => c.severity === 'warn')

  if (asJson) {
    console.log(JSON.stringify({ pairFails, pairSoft, pairTotal: pairs.length, covErrors, covWarns, docDrift, parity, hostAlias }, null, 2))
    process.exit(pairFails.length + covErrors.length + docDrift.length + parity.length + hostAlias.length > 0 ? 1 : 0)
  }

  console.log('\n══ 对比度（WCAG 2.1 AA：正文 4.5 / 大字·非文本 3.0）══')
  for (const theme of ['light', 'dark']) {
    const rows = pairs.filter((p) => p.theme === theme)
    const bad = rows.filter((r) => !r.ok && !r.soft)
    console.log(`\n── ${theme.toUpperCase()} ── 硬性 ${rows.length - bad.length - rows.filter((r) => !r.ok && r.soft).length}/${rows.filter((r) => !r.soft).length} 通过`)
    for (const r of bad) {
      console.log(`  ✗ ${fmt(r.ratio)} (需 ${r.min})  ${r.id}\n      fg ${r.fgHex} on bg ${r.bgHex}  ← ${r.source}`)
    }
    for (const r of rows.filter((x) => !x.ok && x.soft)) {
      console.log(`  ·  ${fmt(r.ratio)} (参考 ${r.min})  ${r.id} — ${r.source}`)
    }
  }

  console.log('\n══ token 完整性 ══')
  console.log(`  未定义且无 fallback（属性直接失效）：${covErrors.length}`)
  for (const f of covErrors) console.log(`  ✗ ${f.file}:${f.line}  ${f.name}`)
  console.log(`  未定义但有写死 fallback（暗色不跟随）：${covWarns.length}`)
  for (const f of covWarns) console.log(`  ! ${f.file}:${f.line}  ${f.name}`)

  console.log('\n══ 插件源码直连宿主 token（语义色必须走 --spk-*）══')
  if (hostAlias.length === 0) console.log('  ok  插件源码零处直连 --dsw-*（仅字体栈/阴影例外）')
  for (const f of hostAlias) console.log('  ✗ ' + f.file + ':' + String(f.line) + '  ' + f.name)

  console.log('\n══ 设计系统文档色值一致性 ══')
  if (docDrift.length === 0) console.log('  ok  Source of Truth 文档里的颜色都来自 token 层')
  for (const f of docDrift) console.log(`  ✗ ${f.file}:${f.line}  ${f.hex} 不在该家族的 token 层里（文档自造颜色）`)

  console.log('\n══ 静态设计稿 ↔ 产品 token 一致性 ══')
  if (parity.length === 0) console.log('  ok  docs/spark-dock-preview 的语义值与产品逐值一致')
  for (const f of parity) console.log(`  ✗ [${f.theme}] ${f.name}：${f.issue}`)

  console.log(`\n合计：对比度硬性不达标 ${pairFails.length} 项（共 ${pairs.filter((p) => !p.soft).length} 项，另 ${pairSoft.length} 项参考）· token 硬失效 ${covErrors.length} 处 · token 静态回退 ${covWarns.length} 处 · 文档自造色 ${docDrift.length} 处 · 设计稿漂移 ${parity.length} 处 · 直连宿主 token ${hostAlias.length} 处`)
  const failed = pairFails.length > 0 || covErrors.length > 0 || docDrift.length > 0 || parity.length > 0 || hostAlias.length > 0
  console.log(failed ? '结果：FAIL\n' : '结果：PASS\n')
  process.exit(failed ? 1 : 0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
