// Money: unified currency display. Three formatters (formatMajor /
// formatMicros / formatCurrency) used to live in three different files
// with three different sizing conventions. The 2026-09-03 finance UX
// review found 14px / 12px / 11px / 18px text scattered everywhere for
// what is semantically the same component (some micros value rendered
// as currency).
//
// This component takes a value in MICROS and renders it as a major-unit
// number with the currency code trailing. Variants pick the layout
// (amount + code, amount only, code only); sizes pick the text size;
// muted swaps the currency code for a smaller, secondary tone.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './Money.module.css'

export type MoneySize = 'sm' | 'md' | 'lg' | 'xl'

/**
 * The semantic emphasis of the rendered amount.
 *
 * - `amount`: just the numeric amount, no currency (e.g. inside a
 *   chart tooltip where the unit is implied).
 * - `amountCode`: amount + uppercase currency code trailing (default).
 * - `codeAmount`: currency code leading, amount trailing (for
 *   right-aligned tables where the code is the unit and the amount
 *   is the variable).
 * - `codeOnly`: just the currency code, for axis labels.
 */
export type MoneyVariant = 'amount' | 'amountCode' | 'codeAmount' | 'codeOnly'

export interface MoneyProps {
  /** Integer micros (1 CNY = 1,000,000 micros). The component divides
   *  by 1e6 internally — passing raw integer avoids the unit-bug class
   *  of issues fixed in commit 6f6e295. */
  micros: number
  /** Currency code (CNY, USD, EUR, ...). Empty string hides the code. */
  currency: string
  /** Visual emphasis. Defaults to 'amountCode' (most common: KPI cards,
   *  balance rows, donut centers). */
  variant?: MoneyVariant | undefined
  /** Text size. Defaults to 'md'. */
  size?: MoneySize | undefined
  /** Tint the currency code in a softer secondary tone. Useful when
   *  the amount is the headline and the code is supporting info. */
  muted?: boolean | undefined
  /** When true, render the trailing '~' mark to flag estimated values
   *  (e.g. peak/off-peak split uses host-known rate, not actual
   *  charge). */
  estimated?: boolean | undefined
  /** Optional className passthrough for layout. */
  className?: string | undefined
  /** Optional aria-label override. Defaults to a derived
   *  '<amount> <code>'. */
  'aria-label'?: string | undefined
  /** Custom element wrapping; default 'span'. Use 'div' for block
   *  layout. */
  as?: 'span' | 'div' | undefined
}

/**
 * Format a micros value as a major-unit string with adaptive
 * precision (>= 100 → no decimals, >= 10 → 1 decimal, else 2). Pure
 * helper kept here so test code can poke at it without rendering the
 * component.
 */
export function formatMicros(micros: number): string {
  const major = micros / 1_000_000
  if (major >= 100) return major.toFixed(0)
  if (major >= 10) return major.toFixed(1)
  return major.toFixed(2)
}

/**
 * Render a money value. Single source of truth for currency display
 * across the dsh plugin set. See Money.test.tsx for the formatting /
 * sizing contract.
 */
export function Money({
  micros,
  currency,
  variant = 'amountCode',
  size = 'md',
  muted = false,
  estimated = false,
  className,
  'aria-label': ariaLabel,
  as = 'span',
}: MoneyProps): ReactNode {
  const text = formatMicros(micros)
  const code = currency.toUpperCase()
  const isAmountOnly = variant === 'amount'
  const isCodeOnly = variant === 'codeOnly'
  const showCode = !isAmountOnly && !isCodeOnly && code !== ''
  const label = ariaLabel !== undefined
    ? ariaLabel
    : isCodeOnly
      ? code
      : text + (showCode ? ' ' + code : '') + (estimated ? ' (estimated)' : '')
  const Tag = as
  return (
    <Tag
      className={clsx(
        css.root,
        css['size_' + size],
        isAmountOnly ? css.amountOnly : null,
        isCodeOnly ? css.codeOnly : null,
        muted ? css.muted : null,
        className,
      )}
      aria-label={label}
    >
      {variant === 'codeAmount' && showCode ? <span className={css.code}>{code}</span> : null}
      {variant === 'codeAmount' && showCode ? ' ' : null}
      {!isCodeOnly ? <span className={css.amount}>{text}{estimated ? '~' : ''}</span> : null}
      {variant !== 'codeAmount' && showCode ? <span className={css.code}>{code}</span> : null}
    </Tag>
  )
}
