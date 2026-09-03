/**
 * Provider-balance list (compact single-line rows).
 *
 * One row per provider inside a single bordered list. Every piece of the
 * old per-provider card survives on ONE line: provider identity + pills on
 * the left, a 64px gauge with remaining/peak stats beside it, the balance
 * amount, and the refresh action pinned right — no second line, so a whole
 * provider takes ~30px instead of a tall card.
 *
 * Problem slots (missing-credential / unsupported / error) collapse the
 * middle to a short message and keep the refresh button (disabled when the
 * slot cannot fetch). Each row carries data-provider for tests; the gauge
 * stays a real role=progressbar.
 */

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
 * tints the tag ('permanent' neutral, 'expired' warning, 'remaining' info).
 */
export type ProviderValidityState = 'permanent' | 'remaining' | 'expired' | 'startsIn'

/**
 * Format a validity window as a human-readable tag plus a CSS state.
 * Returns null when no userEntry was set (no tag to render).
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

/** Render the multi-provider balance list. */
export function BalanceGrid({ list, peaks, refreshing, t, onRefresh }: BalanceGridProps): JSX.Element {
  return (
    <div className={css.balanceList} data-balance-grid="">
      {list.providers.map((row) => (
        <BalanceRow
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

interface BalanceRowProps {
  row: FinanceListProvidersEntry
  peak: StoredBalancePeak | undefined
  refreshing: boolean
  t: (key: FinanceKey) => string
  onRefresh: (provider: string) => void
}

/** Map a `FinanceProviderSource` to the i18n key + data-source attr that drives
 * the source pill's color (CSS rules live alongside the pill). The four keys
 * are the only ones the host's `listProviders` ever returns; the cast keeps
 * the JSON Schema enum narrowing tight. */
const SOURCE_KEY: Record<string, FinanceKey> = {
  'host-known': 'sourceHostKnown',
  'user-config': 'sourceUserConfig',
  'ledger-observed': 'sourceLedgerObserved',
  'llm-runtime': 'sourceLlmRuntime',
}

/** One compact single-line provider row. */
function BalanceRow({ row, peak, refreshing, t, onRefresh }: BalanceRowProps): JSX.Element {
  const slot = row.balance
  const validity = formatProviderValidityTag(row.userEntry?.validity, Date.now(), t)
  const hostKnown = row.hostMeta !== undefined
  const fetchUnsupportedNote = row.hostMeta !== undefined && !row.hostMeta.supportsBalanceFetch
  const ok = slot.status === 'ok' && slot.totalMicros !== undefined
  const canFetch = canRefresh(slot)
  // The host returns sources in stable order: host-known > user-config >
  // ledger-observed > llm-runtime. Picking the first keeps the pill stable
  // across reloads even when a provider belongs to several sources.
  const primarySource = row.sources[0]
  return (
    <div className={css.balanceRow} data-provider={row.provider}>
      <div className={css.balanceRowLabel}>
        <span className={css.balanceRowDot} data-status={slot.status} aria-hidden="true" />
        <span className={css.balanceRowName} title={row.provider}>{row.provider}</span>
        {primarySource !== undefined
          ? <span className={css.balanceRowSource} data-source={primarySource}>{t(SOURCE_KEY[primarySource] ?? 'sourceLlmRuntime')}</span>
          : null}
        {validity !== null
          ? <span className={css.balanceRowValidity} data-state={validity.state}>{validity.text}</span>
          : null}
      </div>
      {ok ? <OkStat slot={slot} peak={peak} t={t} /> : <ProblemMessage slot={slot} fetchUnsupportedNote={fetchUnsupportedNote} t={t} />}
      {ok ? <ValueCell slot={slot} /> : null}
      <button
        type="button"
        className={css.balanceRowRefresh}
        disabled={refreshing || !canFetch}
        onClick={() => onRefresh(row.provider)}
        aria-label={t('refreshBalance') + ': ' + row.provider}
      >
        {refreshing ? t('refreshing') : t('refreshBalance')}
      </button>
    </div>
  )
}

/**
 * Decide whether the per-provider refresh button is interactive: ok/error rows
 * can re-pull; missing-credential and unsupported rows are disabled (nothing
 * fresh to fetch — the host needs a key or an endpoint first).
 */
function canRefresh(slot: FinanceProviderBalance): boolean {
  return slot.status === 'ok' || slot.status === 'error'
}

/** Middle cell of an ok row: mini gauge + remaining/peak text on one line. */
function OkStat({ slot, peak, t }: { slot: FinanceProviderBalance; peak: StoredBalancePeak | undefined; t: (key: FinanceKey) => string }): JSX.Element {
  const currency = slot.currency ?? 'CNY'
  // totalMicros / 1_000_000 → major units. peakMajor below is already major; the
  // earlier code compared micros to major and pinned the gauge to 100% whenever
  // a peak existed.
  const totalMajor = (slot.totalMicros ?? 0) / 1_000_000
  const peakCurrencyBucket = peak?.byCurrency[currency]
  const peakMajor = peakCurrencyBucket !== undefined && peakCurrencyBucket.micros > 0
    ? peakCurrencyBucket.micros / 1_000_000
    : null
  const noPeak = peakMajor === null || peakMajor <= 0
  // Gauge reads "how much of the historical peak is still on hand". A ratio > 1
  // means the current balance exceeds the previously-observed peak (i.e. the
  // user just topped up); clamp the bar at 100% so the fill does not overflow
  // its track.
  const percent = noPeak
    ? 100
    : Math.max(0, Math.min(100, Math.round((totalMajor / peakMajor) * 100)))
  const pctText = noPeak ? t('peakUnsetHint') : t('remaining') + ' ' + percent + '%'
  const peakText = peakMajor !== null ? t('peak') + ' ' + formatMajor(peakMajor) + ' ' + currency : ''
  const statText = peakText === '' ? pctText : pctText + ' · ' + peakText
  const trackClass = noPeak ? css.balanceRowTrack + ' ' + css.balanceRowTrackNoPeak : css.balanceRowTrack
  return (
    <div className={css.balanceRowStat}>
      <div
        className={trackClass}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t('balanceGauge')}
      >
        <div className={css.balanceRowFill} style={{ width: percent + '%' }} />
      </div>
      <span className={css.balanceRowStatText} title={statText} aria-live="polite">{statText}</span>
    </div>
  )
}

/** Middle cell of a problem row: the slot's message (code rides in the title). */
function ProblemMessage({ slot, fetchUnsupportedNote, t }: { slot: FinanceProviderBalance; fetchUnsupportedNote: boolean; t: (key: FinanceKey) => string }): JSX.Element {
  let message: string
  let title: string | undefined
  if (slot.status === 'missing-credential') {
    message = t('missingCredential')
  } else if (slot.status === 'unsupported') {
    message = t('balanceUnsupported').replace('{code}', slot.code ?? 'unsupported')
    title = slot.message ?? slot.code
  } else {
    message = t('balanceError').replace('{code}', slot.code ?? 'error')
    title = slot.message ?? slot.code
  }
  const note = fetchUnsupportedNote ? t('balanceFetchUnsupported') : ''
  return (
    <p className={css.balanceRowMessage} title={note === '' ? (title ?? '') : title + ' · ' + note}>
      {note === '' ? message : message + ' · ' + note}
    </p>
  )
}

/** Right-pinned amount for an ok row. */
function ValueCell({ slot }: { slot: FinanceProviderBalance }): JSX.Element {
  const code = slot.currency ?? 'CNY'
  // The wire field is in integer micros (1 CNY = 1,000,000 micros); divide once
  // here so the rendered amount matches the unit the user expects. Skipping
  // the / 1_000_000 leaves a row that reads "32620000 CNY" instead of
  // "32.62 CNY".
  const totalMajor = (slot.totalMicros ?? 0) / 1_000_000
  return (
    <span className={css.balanceRowValue} title={code + ' ' + totalMajor.toFixed(2)}>
      <span className={css.balanceRowAmount}>{formatMajor(totalMajor)}</span>
      <span className={css.balanceRowCurrency}>{code}</span>
    </span>
  )
}

/**
 * Format a major-units number with adaptive precision.
 *
 * Expects **major units already** (i.e. the caller has done the `/ 1_000_000`
 * from micros). Callers that pass raw micros by mistake get nonsensical
 * output — every micros-magnitude number renders as a flat integer, which is
 * the symptom that originally surfaced the unit bug.
 */
function formatMajor(major: number): string {
  if (major >= 100) return major.toFixed(0)
  if (major >= 10) return major.toFixed(1)
  return major.toFixed(2)
}
