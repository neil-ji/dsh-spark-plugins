/**
 * By-model cost table (commit 21).
 *
 * The legacy donut chart's `buildBreakdown` folds everything past rank 5
 * into a single ""Other"" row, which loses information when the dashboard
 * has 6+ providers and 20+ models. This table renders every model key
 * (with optional scrolling), lets the user click the headers to sort,
 * and keeps the full-width breakdown readable.
 *
 * The table is `aria-sort` aware and supports keyboard navigation; it
 * stays purely presentational — sorting is local component state.
 */

import { useMemo, useState } from 'react'
import { Money } from 'dsh-ui-kit'
import type { FinanceModelRow } from 'dsh-spark-finance/types'
import type { FinanceKey } from './locales.ts'
import css from './FinanceAuditSection.module.css'

type SortKey = 'cost' | 'input' | 'output' | 'model'

interface ByModelTableProps {
  rows: readonly FinanceModelRow[]
  /** Currency used to format the cost column. */
  currency: string
  t: (key: FinanceKey) => string
}

/**
 * Sort + render the full by-model table. Top-N + scrolling is left to CSS
 * (`max-height` + `overflow: auto`) so the whole table stays visible
 * without pagination.
 */
export function ByModelTable({ rows, currency, t }: ByModelTableProps): JSX.Element {
  const [sort, setSort] = useState<SortKey>('cost')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const sorted = useMemo(() => sortRows(rows, sort, dir), [rows, sort, dir])
  const onSort = (key: SortKey): void => {
    if (key === sort) {
      setDir(dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(key)
      setDir(key === 'model' ? 'asc' : 'desc')
    }
  }
  return (
    <div className={css.byModelTableWrap} data-testid="finance-by-model-table">
      <table className={css.byModelTable}>
        <thead>
          <tr>
            <th aria-sort={ariaFor(sort, dir, 'model')}>
              <button type="button" onClick={() => onSort('model')}>{t('modelHeader')}</button>
            </th>
            <th aria-sort={ariaFor(sort, dir, 'cost')}>
              <button type="button" onClick={() => onSort('cost')}>{t('costHeader')}</button>
            </th>
            <th aria-sort={ariaFor(sort, dir, 'input')}>
              <button type="button" onClick={() => onSort('input')}>{t('inputHeader')}</button>
            </th>
            <th aria-sort={ariaFor(sort, dir, 'output')}>
              <button type="button" onClick={() => onSort('output')}>{t('outputHeader')}</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0
            ? (
              <tr>
                <td colSpan={4} className={css.byModelTableEmpty}>
                  <div>{t('noProviderData')}</div>
                  <div className={css.byModelTableEmptyHint}>{t('noProviderDataHint')}</div>
                  <button
                    type="button"
                    className={css.balanceEmptyAction}
                    onClick={() => window.dispatchEvent(new CustomEvent('dsh-finance-open-config'))}
                  >
                    {t('openConfig')}
                  </button>
                </td>
              </tr>
            )
            : sorted.map((row) => (
              <tr key={row.modelKey}>
                <td>{row.modelKey}</td>
                <td><Money micros={row.costMicros} currency={currency} size="sm" muted /></td>
                <td>{formatTokens(row.usage.uncachedInputTokens + row.usage.cacheReadTokens)}</td>
                <td>{formatTokens(row.usage.outputTokens)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

function sortRows(rows: readonly FinanceModelRow[], sort: SortKey, dir: 'asc' | 'desc'): FinanceModelRow[] {
  const sorted = [...rows]
  sorted.sort((a, b) => {
    let cmp = 0
    switch (sort) {
      case 'model':
        cmp = a.modelKey.localeCompare(b.modelKey)
        break
      case 'cost':
        cmp = a.costMicros - b.costMicros
        break
      case 'input':
        cmp = (a.usage.uncachedInputTokens + a.usage.cacheReadTokens)
          - (b.usage.uncachedInputTokens + b.usage.cacheReadTokens)
        break
      case 'output':
        cmp = a.usage.outputTokens - b.usage.outputTokens
        break
    }
    return dir === 'asc' ? cmp : -cmp
  })
  return sorted
}

function ariaFor(active: SortKey, dir: 'asc' | 'desc', key: SortKey): 'ascending' | 'descending' | 'none' {
  if (active !== key) return 'none'
  return dir === 'asc' ? 'ascending' : 'descending'
}

// formatCurrency retired — see <Money> in dsh-ui-kit. The BMT only needs
// this for the table cell; rendered inline above. Kept the function
// stub in case a future sort header reuses it.

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

