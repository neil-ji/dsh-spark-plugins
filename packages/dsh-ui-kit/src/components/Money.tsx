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

/** Spark UI Kit 金额 — micros 主单位换算 + 货币符号 + tabular-nums */
export function Money({ micros, currency, size = 'md', muted = false, className }: MoneyProps) {
  return (
    <span className={cx(css.money, css[size], muted && css.muted, className)}>
      {currencySymbol(currency)}{formatMicros(micros)}
    </span>
  )
}
