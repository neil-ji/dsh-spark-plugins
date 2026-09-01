/**
 * Provider-balance grid (commit 21).
 *
 * One card per provider from `listProviders`:
 * - - fetch-capable providers with a fresh `ok` slot: full battery gauge + a
 *   historical-peak reference line + the user's validity tag.
 * - - `missing-credential` / `unsupported` / `error`: a stable "—"" placeholder
 *   with the slot's code so the user can act on the message.
 *
 * The grid is a stable component so the dashboard can layout with a CSS
 * `display: grid`; we render an outer `<div>` with `data-balance-grid` so the
 * CSS module can target the rows without coupling to internal class names.
 */

import { Button } from 'dsh-ui-kit'
import type {
  FinanceListProvidersEntry,
  FinanceListProvidersResult,
  FinanceProviderBalance,
} from 'dsh-spark-finance/types'
import type { StoredBalancePeak } from './persist.ts'
import type { FinanceKey } from './locales.ts'
import css from './FinanceAuditSection.module.css'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Render-side state for the validity tag pill. Drives the CSS modifier that
 * tints the tag (`permanent` neutral, `expired` warning, `remaining`/`startsIn` info).
 */
export type ProviderValidityState = 'permanent' | 'remaining' | 'expired' | 'startsIn'

/**
 * Format a `validity` window as a human-readable tag plus a CSS state.
 * Returns null when no `userEntry` was set (no tag to render). Three cases:
 * - both bounds absent → permanent
 * - end in the past → expired
 * - end in the future → remaining
 * - start in the future → startsIn
 */
export function formatProviderValidityTag(
  validity: { startMs?: number; endMs?: number } | undefined,
  now: number,
  t: (key: FinanceKey) => string,
): { text: string; state: ProviderValidityState } | null {
  if (validity === undefined) return null
  const { startMs, endMs } = validity
  if (startMs === undefined && endMs === undefined) return { text: t('validityPermanent'), state: 'permanent' }
  if (endMs !== undefined && endMs < now) {
    const days = Math.max(1, Math.round((now - endMs) / MS_PER_DAY))
    return { text: t('validityExpired').replace('{days}', String(days)), state: 'expired' }
  }
  if (startMs !== undefined && startMs > now) {
    const days = Math.max(1, Math.round((startMs - now) / MS_PER_DAY))
    return { text: t('validityStartsIn').replace('{days}', String(days)), state: 'startsIn' }
  }
  if (endMs !== undefined) {
    const days = Math.max(0, Math.round((endMs - now) / MS_PER_DAY))
    return { text: t('validityRemaining').replace('{days}', String(days)), state: 'remaining' }
  }
  return { text: t('validityPermanent'), state: 'permanent' }
}

interface BalanceGridProps {
  list: FinanceListProvidersResult
  peaks: Readonly<Record<string, StoredBalancePeak>>
  /** Map of provider id → "is a refresh in flight" flag, used to disable buttons. */
  refreshing: Readonly<Record<string, boolean>>
  t: (key: FinanceKey) => string
  onRefresh: (provider: string) => void
}

/** Render the multi-provider balance grid. */
export function BalanceGrid({ list, peaks, refreshing, t, onRefresh }: BalanceGridProps): JSX.Element {
  return (
    <div className={css.balanceGrid} data-balance-grid="">
      {list.providers.map((row) => (
        <BalanceCard
          key={row.provider}
          row={row}
          peak={peaks[row.provider]}
          refreshing={refreshing[row.provider] === true}
          t={t}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  )
}

interface BalanceCardProps {
  row: FinanceListProvidersEntry
  peak: StoredBalancePeak | undefined
  refreshing: boolean
  t: (key: FinanceKey) => string
  onRefresh: (provider: string) => void
}

/** A single provider card. */
function BalanceCard({ row, peak, refreshing, t, onRefresh }: BalanceCardProps): JSX.Element {
  const slot = row.balance
  const validity = formatProviderValidityTag(row.userEntry?.validity, Date.now(), t)
  const hostKnown = row.hostMeta !== undefined
  const meta = row.hostMeta
  return (
    <article className={css.balanceCard} data-provider={row.provider}>
      <header className={css.balanceCardHead}>
        <span className={css.balanceCardTitle}>
          {row.provider}
          {hostKnown ? <span className={css.balanceCardTag}>· {t('hostKnown')}</span> : null}
        </span>
        {validity !== null
          ? <span className={css.balanceCardValidity} data-state={validity.state}>{validity.text}</span>
          : null}
      </header>
      {renderBalanceBody(row, slot, peak, t)}
      <footer className={css.balanceCardFoot}>
        <button
          type="button"
          className={css.balanceCardRefresh}
          disabled={refreshing || !canRefresh(slot)}
          onClick={() => onRefresh(row.provider)}
          aria-label={`${t('refreshBalance')}: ${row.provider}`}
        >
          {refreshing ? t('refreshing') : t('refreshBalance')}
        </button>
        {meta !== undefined && !meta.supportsBalanceFetch
          ? <span className={css.balanceCardNote}>{t('balanceFetchUnsupported')}</span>
          : null}
      </footer>
    </article>
  )
}

/** Decide whether the per-provider refresh button is interactive. */
function canRefresh(slot: FinanceProviderBalance): boolean {
  // Allow the user to attempt a refresh on anything that's not the
  // permanently-disabled "free provider" case — host-fetched providers
  // already went through the autoFetchBalance gate server-side.
  return slot.status !== 'unsupported' || slot.code !== 'free-provider'
}

/** Render the body of one card based on the slot status. */
function renderBalanceBody(
  row: FinanceListProvidersEntry,
  slot: FinanceProviderBalance,
  peak: StoredBalancePeak | undefined,
  t: (key: FinanceKey) => string,
): JSX.Element {
  if (slot.status === 'ok' && slot.totalMicros !== undefined) {
    const currency = slot.currency ?? 'CNY'
    const totalMajor = slot.totalMicros / 1_000_000
    const peakMajor = peak?.micros !== undefined && peak.currency === currency
      ? peak.micros / 1_000_000
      : null
    const percent = peakMajor === null || peakMajor <= 0
      ? 100
      : Math.round(Math.min(1, totalMajor / peakMajor) * 100)
    return (
      <div className={css.balanceCardBody} aria-live="polite">
        <div className={css.balanceCardValue} title={`${currency} ${totalMajor.toFixed(2)}`}>
          <span className={css.balanceCardAmount}>{formatMajor(totalMajor)}</span>
          <span className={css.balanceCardCurrency}>{currency}</span>
        </div>
        <div className={css.balanceCardTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('balanceGauge')}>
          <div className={css.balanceCardFill} style={{ width: `${percent}%` }} />
        </div>
        <div className={css.balanceCardMeta}>
          <span>{t('remaining')} {percent}%</span>
          {peakMajor !== null
            ? <span>{t('peak')} {formatMajor(peakMajor)} {peak?.currency ?? currency}</span>
            : null}
        </div>
      </div>
    )
  }
  if (slot.status === 'missing-credential') {
    return (
      <div className={css.balanceCardError}>
        <span className={css.balanceCardDash}>—</span>
        <p>{t('missingCredential')}</p>
      </div>
    )
  }
  if (slot.status === 'unsupported') {
    return (
      <div className={css.balanceCardError}>
        <span className={css.balanceCardDash}>—</span>
        <p title={slot.message ?? slot.code}>{t('balanceUnsupported').replace('{code}', slot.code ?? 'unsupported')}</p>
      </div>
    )
  }
  // error
  return (
    <div className={css.balanceCardError}>
      <span className={css.balanceCardDash}>—</span>
      <p title={slot.message ?? slot.code ?? ''}>{t('balanceError')}</p>
    </div>
  )
}

/** Format a major-units number with two decimals. */
function formatMajor(major: number): string {
  if (major >= 100) return major.toFixed(0)
  if (major >= 10) return major.toFixed(1)
  return major.toFixed(2)
}
