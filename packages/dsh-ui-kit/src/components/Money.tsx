import { cx } from '../cx.js'
import css from './Money.module.css'

export type MoneySize = 'sm' | 'md' | 'lg'

export interface MoneyProps {
  /** 整数 micros（10^-6 主单位） */
  micros: number
  /** ISO 货币码（CNY/USD/...）；空串只渲染数字 */
  currency: string
  size?: MoneySize
  muted?: boolean
  /** 表格数字列：固定两位小数（列内对齐）；默认 false = 紧凑规则。 */
  exact?: boolean
  className?: string
}

const SYMBOLS: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥' }

function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? (currency ? `${currency} ` : '')
}

function trim(text: string): string {
  return text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/**
 * micros → 主单位紧凑文本（kit 内统一精度规则）：
 * ≥1000 取整带千分位；≥1 两位小数去尾零；<1 两位有效数字；0 → "0"。
 *
 * ⚠️ **这是裸数字**（不含货币符号）。凡是金额要上屏的地方，用 `<Money>`（DOM）
 * 或 `formatMoneyMicros`（字符串）；只有**非金额**的数字才直接用本函数。
 * 插件源码直调本函数会被 `check:contrast` 的「金额裸数字」段拦下。
 */
export function formatMicros(micros: number): string {
  if (!Number.isFinite(micros)) return '0'
  const major = micros / 1e6
  const abs = Math.abs(major)
  if (abs === 0) return '0'
  if (abs >= 1000) return major.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (abs >= 1) return trim(major.toFixed(2))
  return trim(major.toPrecision(2))
}

/**
 * 表格数字列专用：固定两位小数 + 千分位。
 * 为什么单列一个：`formatMicros` 的紧凑规则会去尾零（261.90 → 261.9），
 * 在**纵向对齐的数字列**里就会出现 261.9 / 72.32 混排（复核报告 PCQA-018）。
 * 列内对齐优先于紧凑，因此表格单元格用 exact 变体。
 */
export function formatMicrosExact(micros: number): string {
  if (!Number.isFinite(micros)) return '0.00'
  return (micros / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * micros + 货币码 → **带货币符号**的紧凑文本（图表 / 图例 / title / locale 插值用）。
 *
 * 为什么必须与 `formatMicros` 并存：`formatMicros` 是**裸数字**格式化器，它只回答
 * "数字长什么样"。凡是要 Show 给用户看金额的地方，符号不能丢 —— 但图表与
 * locale 插值拿到的是**字符串**，套不了 `Money` 组件，于是很容易顺手用 `formatMicros`，
 * 结果上屏成裸数字（2026-09-21 实测缺陷：错峰卡图例渲染成 `8.57` / `10.34` / `3.03`，
 * 而同屏表格里的金额都是 `¥…`，同一屏两种货币表达）。
 *
 * 规则（见 UI-UX-SPEC §3.5 第 6 条）：**金额一律带货币符号**。
 *  - 要 DOM 节点（可加 tabular-nums / 字号）→ 用 `<Money>`；
 *  - 只要字符串（图表 formatValue / axisFormatter / title / t() 参数）→ 用本函数。
 *  - `formatMicros` 只应出现在**金额之外**的场合，或作为本函数的内部实现细节。
 */
export function formatMoneyMicros(micros: number, currency: string): string {
  return `${currencySymbol(currency)}${formatMicros(micros)}`
}

/** @see formatMoneyMicros —— exact 变体（固定两位小数，用于需要列内对齐的字符串）。 */
export function formatMoneyMicrosExact(micros: number, currency: string): string {
  return `${currencySymbol(currency)}${formatMicrosExact(micros)}`
}

/** Spark UI Kit 金额 — micros 主单位换算 + 货币符号 + tabular-nums */
export function Money({ micros, currency, size = 'md', muted = false, exact = false, className }: MoneyProps) {
  return (
    <span className={cx(css.money, css[size], muted && css.muted, className)}>
      {currencySymbol(currency)}{exact ? formatMicrosExact(micros) : formatMicros(micros)}
    </span>
  )
}
