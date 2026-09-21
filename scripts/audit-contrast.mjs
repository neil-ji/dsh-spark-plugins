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
  // 反例留档：**浮层上禁用 label-3**。暗色实测 4.39:1，差一点不达 AA ——
  // finance 详情弹窗的行标签曾用它（暗色下整表标签都不达标，用户反馈"不易读"）。
  // soft 是有意的：钉死"它不达标"这个事实，谁来用时能立刻看到原因。
  { id: '[反例] label-3 on float', source: '浮层上禁用（暗色仅 4.39:1）；行标签改 label-2', min: 4.5, fg: '--spk-label-3', bg: FLOAT, soft: true },

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

/* ──────────────────── 金额裸数字（2026-09-21） ──────────────────── */

/**
 * 金额裸数字闸门（UI-UX-SPEC §3.5 第 6 条：**金额一律带货币符号**，禁裸数字）。
 *
 * 实测缺陷（用户截图）：错峰卡的 100% 堆叠条图例渲染成 `8.57` / `10.34` / `3.03`，
 * 而**同一屏**的表格金额都是 `¥…` —— 一屏两种货币表达。成因是 ui-kit 的
 * `formatMicros` 是**裸数字**格式化器，图表（`formatValue` / `axisFormatter`）与
 * locale 插值（`t(key, { amount })`）拿到的是**字符串**、套不了 `<Money>` 组件，
 * 于是顺手用了 `formatMicros`。
 *
 * 判据：**插件源码**里不得直接调用 `formatMicros` / `formatMicrosExact`
 * （它们是字符串格式化器，只该作为 ui-kit 内部实现细节，或用于非金额场合）。
 * 要字符串金额 → `formatMoneyMicros(micros, currency)`；要 DOM 节点 → `<Money>`。
 *
 * 为什么不能靠"看有没有 ¥"来判：那需要在浏览器里跑遍每个视图的每种空/满数据态，
 * 而这类缺陷恰恰只在某些视图出现。静态判据在**写的当下**就拦得住。
 */
export function auditBareMoney() {
  const files = walk(path.join(ROOT, 'packages')).filter((f) => /\.(ts|tsx)$/.test(f))
  const findings = []
  const seen = new Set()
  for (const file of files) {
    // ui-kit 是这两个格式化器的家，只有内部实现允许用。
    if (file.includes(`dsh-ui-kit${path.sep}src${path.sep}`)) continue
    // 测试**必须**能引用裸格式化器 —— 上面那条"替代品确实带符号"的断言就是拿
    // formatMicros 与 formatMoneyMicros 对照的。闸门只守**上屏**的源码。
    if (/[/\\]tests?[/\\]/.test(file) || /\.(test|spec)\.[jt]sx?$/.test(file)) continue
    const rel = path.relative(ROOT, file)
    const text = readFileSync(file, 'utf8')
    text.split('\n').forEach((line, i) => {
      if (/^\s*import\b/.test(line)) return
      // 两种形态都要拦（**第二形态才是实测缺陷的形态**）：
      //  1. 直接调用：`formatMicros(x)` —— locale 插值 / 文本拼接；
      //  2. **裸引用**：`formatValue={formatMicros}` —— 把裸数字格式化器当回调传出去。
      //     第一版闸门只查了 `formatMicros(`（带括号），于是漏掉了真正的缺陷形态：
      //     负向验证（把 formatValue 改回 formatMicros）仍然 PASS 才暴露出来。
      const call = /\bformatMicros(Exact)?\s*\(/.exec(line)
      const bare = /\bformatMicros(Exact)?\b(?!\s*\()/.exec(line)
      const hit = call ?? bare
      if (hit === null) return
      const key = `${rel}:${i + 1}`
      if (seen.has(key)) return
      seen.add(key)
      findings.push({
        file: rel,
        line: i + 1,
        fn: call !== null ? call[0].replace(/\s*\($/, '') : hit[0],
        form: call !== null ? 'call' : 'reference',
      })
    })
  }
  return findings
}

/* ──────────────────── 文案占位符泄漏（2026-09-21） ──────────────────── */

/**
 * 占位符泄漏闸门。
 *
 * 一个 key 的字典值含 `{name}` 时，`t(key)` **必须**传第二参数，否则占位符原样上屏。
 * 实测缺陷（图片6）：finance 详情弹窗的标签渲染成字面量 `折扣 {pct}` / `回本 {pct}`
 * —— 调用处写了 `t('planDiscount')`，而值是 `"折扣 {pct}"`。
 *
 * **按包作用域判定**：跨包按 key 名匹配会误报 —— spark-dock 的 `timeSeconds` 值是
 * 无占位符的纯单位 `'秒前'`（数值由调用处前置拼接），而 finance 的同名 key 是
 * `"{n} 秒前"`。第一版扫描没做作用域，一次报了 6 处、其中 4 处是假的。
 */
export function auditPlaceholderLeaks() {
  const files = walk(path.join(ROOT, 'packages')).filter((f) => /\.(ts|tsx)$/.test(f))
  /** key → 含占位符的包集合 */
  const templated = new Map()
  for (const file of files.filter((f) => /locales?\.ts$/.test(f))) {
    const rel = path.relative(ROOT, file).split(path.sep)
    const pkg = rel.slice(0, 2).join('/')
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/"([A-Za-z0-9_]+)"\s*:\s*"([^"]*)"/g)) {
      if (!/\{\w+\}/.test(m[2])) continue
      if (!templated.has(m[1])) templated.set(m[1], new Set())
      templated.get(m[1]).add(pkg)
    }
  }
  const findings = []
  for (const file of files) {
    if (/locales?\.ts$/.test(file)) continue
    const rel = path.relative(ROOT, file).split(path.sep)
    const pkg = rel.slice(0, 2).join('/')
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'\s*\)/g)) {
      const owners = templated.get(m[1])
      if (owners === undefined || !owners.has(pkg)) continue
      findings.push({
        file: path.relative(ROOT, file),
        line: text.slice(0, m.index).split('\n').length,
        key: m[1],
      })
    }
  }
  return findings
}

/* ──────────────────── 卡片描边层级与一致性（2026-09-21） ──────────────────── */

/**
 * 卡片描边闸门（用户裁决：①「外浅内深」不合理，应当外深内浅；②「card border 必须
 * 统一 color、width、radius」）。
 *
 * 为什么必须是机器判据：这类"层级读起来是反的"缺陷**对比度全部达标**（border 从来
 * 不在 AA 的正文配对里，闸门原本一条都不查），只能靠两条结构不变量守：
 *
 *  1. **外深内浅**：外层卡描边与其卡面的对比度，必须**大于**嵌套 inset 描边与其卡面的
 *     对比度。实测反例（修前）：亮 1.35(外) vs 1.68(内)、暗 1.14(外) vs 1.35(内)。
 *     判据写成"比较"而不是"钉死某个 token 名"，这样换 token 值也不会假失败 ——
 *     真正要守的是**层级关系**，不是具体色号。
 *  2. **卡片族一致**：所有以 `--spk-surface-card` 为底的容器（ui-kit Card /
 *     SettingsCard / Stat）必须用**同一个**描边 token、同一个宽度、同一个圆角。
 */
export function auditCardSurfaces(tables) {
  const findings = []
  const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

  const parseBlock = (css, selector) => {
    const re = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, 's')
    return re.exec(css)?.[1] ?? ''
  }
  const declOf = (block, prop) => {
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm')
    return (re.exec(block)?.[1] ?? '').trim()
  }
  const tokenOf = (value) => /var\(\s*(--spk-[a-z0-9-]+)/.exec(value)?.[1] ?? null

  const cardCss = read('packages/dsh-ui-kit/src/components/Card.module.css')
  const outer = parseBlock(cardCss, '.card')
  const inset = parseBlock(cardCss, '.inset')

  const outerBorder = declOf(outer, 'border')
  const insetBorder = declOf(inset, 'border-color')
  const outerToken = tokenOf(outerBorder)
  const insetToken = tokenOf(insetBorder)

  // —— 不变量 1：描边档必须不同，且外层更强 ——
  if (outerToken === null || insetToken === null) {
    findings.push({ kind: 'card-border-token', message: `卡片描边必须引 --spk-* token（外层 ${outerToken} / inset ${insetToken}）` })
  } else if (outerToken === insetToken) {
    findings.push({ kind: 'card-border-same-token', message: `外层与 inset 用了同一个描边 token（${outerToken}）——嵌套层级将不可辨` })
  } else {
    const insetBgToken = tokenOf(declOf(inset, 'background'))
    for (const theme of ['light', 'dark']) {
      const map = tables[theme]
      const outerColor = evalSpec(map, outerToken)
      const insetColor = evalSpec(map, insetToken)
      const cardBg = evalSpec(map, '--spk-surface-card')
      const insetBg = insetBgToken === null ? cardBg : evalSpec(map, insetBgToken)
      if (!outerColor || !insetColor || !cardBg || !insetBg) continue
      const outerRatio = contrast(outerColor, cardBg)
      const insetRatio = contrast(insetColor, insetBg)
      if (insetRatio >= outerRatio) {
        findings.push({
          kind: 'card-border-inverted',
          message: `[${theme}] 内层描边不比外层弱：外层 ${outerToken} vs 卡面 ${outerRatio.toFixed(2)}，`
            + `inset ${insetToken} vs 其底面 ${insetRatio.toFixed(2)}（应外深内浅）`,
        })
      }
      // 下限：外层卡描边自己至少要"看得出"有轮廓（否则卡片等于无边）。
      if (outerRatio < 1.2) {
        findings.push({
          kind: 'card-border-faint',
          message: `[${theme}] 外层卡描边对比度过低（${outerRatio.toFixed(2)} < 1.20）——卡片轮廓看不出`,
        })
      }
    }
  }

  // —— 不变量 2：卡片族（surface-card 底的容器）描边/宽度/圆角一致 ——
  const familyFiles = [
    'packages/dsh-ui-kit/src/components/Card.module.css',
    'packages/dsh-ui-kit/src/components/SettingsCard.module.css',
  ]
  const shapes = []
  for (const file of familyFiles) {
    const css = read(file)
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/gs)) {
      const block = m[2]
      if (!/--spk-surface-card/.test(declOf(block, 'background'))) continue
      const border = declOf(block, 'border')
      if (border === '') continue
      shapes.push({
        file: path.relative(ROOT, file),
        selector: m[1].trim().replace(/\s+/g, ' '),
        width: /(\d+(?:\.\d+)?)px/.exec(border)?.[1] ?? null,
        token: tokenOf(border),
        radius: declOf(block, 'border-radius').replace(/\s+/g, ''),
      })
    }
  }
  const first = shapes[0]
  for (const s of shapes.slice(1)) {
    for (const key of ['width', 'token', 'radius']) {
      if (s[key] !== first[key]) {
        findings.push({
          kind: 'card-family-drift',
          message: `卡片族不一致（${key}）：${first.file} ${first.selector} = ${first[key]}，`
            + `而 ${s.file} ${s.selector} = ${s[key]}`,
        })
      }
    }
  }

  return findings
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
  const cardSurfaces = auditCardSurfaces(tables)
  const placeholderLeaks = auditPlaceholderLeaks()
  const bareMoney = auditBareMoney()

  const pairFails = pairs.filter((p) => !p.ok && !p.soft)
  const pairSoft = pairs.filter((p) => !p.ok && p.soft)
  const covErrors = coverage.filter((c) => c.severity === 'error')
  const covWarns = coverage.filter((c) => c.severity === 'warn')

  if (asJson) {
    console.log(JSON.stringify({ pairFails, pairSoft, pairTotal: pairs.length, covErrors, covWarns, docDrift, parity, hostAlias, cardSurfaces, placeholderLeaks, bareMoney }, null, 2))
    process.exit(pairFails.length + covErrors.length + docDrift.length + parity.length + hostAlias.length + cardSurfaces.length + placeholderLeaks.length + bareMoney.length > 0 ? 1 : 0)
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

  console.log('\n══ 文案占位符泄漏（含 {x} 的 key 必须传参数，否则占位符原样上屏）══')
  if (placeholderLeaks.length === 0) console.log('  ok  无 t(含占位符 key) 单参调用')
  for (const f of placeholderLeaks) console.log(`  ✗ ${f.file}:${f.line}  t('${f.key}') 未传参数 → 字面量 {…} 会上屏`)

  console.log('\n══ 金额裸数字（金额必须带货币符号）══')
  if (bareMoney.length === 0) console.log('  ok  插件源码零处裸数字金额格式化（用 formatMoneyMicros / <Money>）')
  for (const f of bareMoney) console.log(`  ✗ ${f.file}:${f.line}  ${f.fn}() 产出裸数字 → 用 formatMoneyMicros(micros, currency) 或 <Money>`)

  console.log('\n══ 卡片描边层级与一致性（外深内浅 · 卡片族同 color/width/radius）══')
  if (cardSurfaces.length === 0) console.log('  ok  外层卡描边强于 inset，且卡片族三项一致')
  for (const f of cardSurfaces) console.log(`  ✗ [${f.kind}] ${f.message}`)

  console.log(`\n合计：对比度硬性不达标 ${pairFails.length} 项（共 ${pairs.filter((p) => !p.soft).length} 项，另 ${pairSoft.length} 项参考）· token 硬失效 ${covErrors.length} 处 · token 静态回退 ${covWarns.length} 处 · 文档自造色 ${docDrift.length} 处 · 设计稿漂移 ${parity.length} 处 · 直连宿主 token ${hostAlias.length} 处 · 卡片描边 ${cardSurfaces.length} 处 · 占位符泄漏 ${placeholderLeaks.length} 处 · 金额裸数字 ${bareMoney.length} 处`)
  const failed = pairFails.length > 0 || covErrors.length > 0 || docDrift.length > 0 || parity.length > 0 || hostAlias.length > 0 || cardSurfaces.length > 0 || placeholderLeaks.length > 0 || bareMoney.length > 0
  console.log(failed ? '结果：FAIL\n' : '结果：PASS\n')
  process.exit(failed ? 1 : 0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
