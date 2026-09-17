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

/** Spark UI Kit 金额 — micros 主单位换算 + 货币符号 + tabular-nums */
export function Money({ micros, currency, size = 'md', muted = false, exact = false, className }: MoneyProps) {
  return (
    <span className={cx(css.money, css[size], muted && css.muted, className)}>
      {currencySymbol(currency)}{exact ? formatMicrosExact(micros) : formatMicros(micros)}
    </span>
  )
}
