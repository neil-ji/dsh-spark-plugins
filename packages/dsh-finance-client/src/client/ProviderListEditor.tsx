/**
 * Per-provider Form List editor (commit 13).
 *
 * One row per `FinanceProviderEntry`. Five controls per row:
 *   1. provider id (text input; host-known providers shown by name)
 *   2. billing mode (segmented: metered / plan / free)
 *   3. currency (segmented: CNY / USD; locked for host-known locked providers)
 *   4. total price in major units (number input; stored as micros)
 *   5. auto-fetch balance (checkbox; only host-known fetch-capable providers)
 *   6. validity range (two date inputs; empty = 永久)
 *
 * Locked fields (per `FinanceHostProviderMeta.lockBillingModeAndCurrency`)
 * render disabled with a hint, so the user can see why they can't change
 * DeepSeek-official's CNY / metered defaults.
 */

import { defaultProviderEntry } from 'dsh-spark-finance'
import { Button, Input, SegmentedControl } from 'dsh-ui-kit'
import { metaFor, providersToRows } from './provider-forms.ts'
import type { ProviderRow } from './provider-forms.ts'
import type { FinanceKey } from './locales.ts'
import css from './FinanceCard.module.css'

/** Format an epoch ms (or undefined) as a `YYYY-MM-DD` local date string. */
function msToDateInput(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return ''
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Parse `YYYY-MM-DD` as the UTC midnight of that day (or undefined). */
function dateInputToMs(text: string): number | undefined {
  if (text === '') return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (match === null) return undefined
  const [, yyyy, mm, dd] = match as unknown as [string, string, string, string]
  const ms = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd))
  return Number.isNaN(ms) ? undefined : ms
}

/** Render a single provider entry. */
function ProviderRowView({ index, row, disabled, t, onChange, onRemove }: {
  index: number
  row: ProviderRow
  disabled: boolean
  t: (key: FinanceKey) => string
  onChange: (next: ProviderRow) => void
  onRemove: () => void
}) {
  const meta = metaFor(row.provider)
  const lockBilling = meta?.lockBillingModeAndCurrency === true
  const showAutoFetch = meta?.supportsBalanceFetch === true
  const currencySymbol = row.currency === 'USD' ? '$' : '¥'
  const isFree = row.billingMode === 'free'
  return (
    <div className={css.providerCard}>
      <div className={css.providerCardHead}>
        <span className={css.providerName}>
          {row.provider || t('cardProviderNewRow')}
          {meta !== undefined ? <span className={css.providerHostTag}>· {t('cardProviderHostKnown')}</span> : null}
        </span>
        <button
          type="button"
          className={css.billingRemove}
          disabled={disabled}
          aria-label={`${t('removeProviderRow')}: ${row.provider || `#${index + 1}`}`}
          onClick={onRemove}
        >
          ×
        </button>
      </div>

      <div className={css.providerGrid}>
        <label className={css.providerField}>
          <span className={css.providerLabel}>{t('cardProviderId')}</span>
          <Input
            className={css.providerInput}
            type="text"
            value={row.provider}
            disabled={disabled}
            spellCheck={false}
            placeholder="provider-id"
            aria-label={t('cardProviderId')}
            onChange={(event) => onChange({ ...row, provider: event.currentTarget.value })}
          />
        </label>

        <label className={css.providerField}>
          <span className={css.providerLabel}>
            {t('cardProviderBillingMode')}
            {lockBilling ? <span className={css.providerLocked}>🔒</span> : null}
          </span>
          <SegmentedControl
            options={[
              { value: 'metered', label: t('modeMetered') },
              { value: 'plan', label: t('modePlan') },
              { value: 'free', label: t('modeFree') },
            ]}
            value={row.billingMode}
            disabled={disabled || lockBilling}
            ariaLabel={t('cardProviderBillingMode')}
            onChange={(value) => onChange({ ...row, billingMode: value as ProviderRow['billingMode'] })}
          />
        </label>

        <label className={css.providerField}>
          <span className={css.providerLabel}>
            {t('cardProviderCurrency')}
            {lockBilling ? <span className={css.providerLocked}>🔒</span> : null}
          </span>
          <SegmentedControl
            options={[
              { value: 'CNY', label: 'CNY' },
              { value: 'USD', label: 'USD' },
            ]}
            value={row.currency}
            disabled={disabled || lockBilling}
            ariaLabel={t('cardProviderCurrency')}
            onChange={(value) => onChange({ ...row, currency: value as ProviderRow['currency'] })}
          />
        </label>

        <label className={css.providerField}>
          <span className={css.providerLabel}>{t('cardProviderTotalPrice')}</span>
          <div className={css.providerPriceWrap}>
            <span className={css.providerCurrencyPrefix}>{currencySymbol}</span>
            <Input
              className={css.providerPriceInput}
              type="number"
              min={0}
              max={100000}
              step={0.01}
              value={Number.isFinite(row.totalPriceMajor) ? row.totalPriceMajor : 0}
              disabled={disabled}
              aria-label={t('cardProviderTotalPrice')}
              onChange={(event) => {
                const next = Number(event.currentTarget.value)
                onChange({ ...row, totalPriceMajor: Number.isFinite(next) ? Math.max(0, next) : 0 })
              }}
            />
          </div>
        </label>

        {showAutoFetch ? (
          <label className={css.providerField}>
            <span className={css.providerLabel}>{t('cardProviderAutoFetch')}</span>
            <label className={css.providerAutoFetch}>
              <input
                type="checkbox"
                checked={row.autoFetchBalance}
                disabled={disabled}
                onChange={(event) => onChange({ ...row, autoFetchBalance: event.currentTarget.checked })}
              />
              <span>{t('cardProviderAutoFetchHint')}</span>
            </label>
          </label>
        ) : null}

        <div className={css.providerField}>
          <span className={css.providerLabel}>{t('cardProviderValidity')}</span>
          <div className={css.providerValidity}>
            <Input
              className={css.providerDateInput}
              type="date"
              value={msToDateInput(row.validityStartMs)}
              disabled={disabled || isFree}
              aria-label={t('cardProviderValidityStart')}
              onChange={(event) => onChange({ ...row, validityStartMs: dateInputToMs(event.currentTarget.value) })}
            />
            <span className={css.providerValiditySep}>→</span>
            <Input
              className={css.providerDateInput}
              type="date"
              value={msToDateInput(row.validityEndMs)}
              disabled={disabled || isFree}
              aria-label={t('cardProviderValidityEnd')}
              onChange={(event) => onChange({ ...row, validityEndMs: dateInputToMs(event.currentTarget.value) })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Form List wrapper: renders every row plus an "+ 添加 provider" button that
 * adds either the next host-known provider (with defaults seeded from
 * `HOST_KNOWN_PROVIDER_META`) or a blank row once all host-known ones are
 * already added.
 */
export function ProviderListEditor({ rows, disabled, t, onChange }: {
  rows: readonly ProviderRow[]
  disabled: boolean
  t: (key: FinanceKey) => string
  onChange: (rows: readonly ProviderRow[]) => void
}) {
  const update = (index: number, next: ProviderRow): void => {
    onChange(rows.map((row, i) => (i === index ? next : row)))
  }
  const remove = (index: number): void => {
    onChange(rows.filter((_, i) => i !== index))
  }
  const addHostKnown = (): void => {
    // Find the next host-known provider not already in the list.
    const taken = new Set(rows.map((r) => r.provider))
    const next = Object.keys({
      'deepseek-official': true,
    }).find((id) => !taken.has(id))
    if (next !== undefined) {
      const [seeded] = providersToRows([defaultProviderEntry(next)])
      if (seeded !== undefined) onChange([...rows, seeded])
      return
    }
    // All host-known providers added — append a blank plan/CNY row.
    const [blank] = providersToRows([defaultProviderEntry('')])
    if (blank !== undefined) onChange([...rows, blank])
  }
  return (
    <div className={css.providerList}>
      {rows.map((row, index) => (
        <ProviderRowView
          key={`${row.provider}-${index}`}
          index={index}
          row={row}
          disabled={disabled}
          t={t}
          onChange={(next) => update(index, next)}
          onRemove={() => remove(index)}
        />
      ))}
      <Button
        variant="outline"
        disabled={disabled}
        onClick={addHostKnown}
        data-testid="finance-provider-add"
      >
        {t('addProvider')}
      </Button>
    </div>
  )
}
