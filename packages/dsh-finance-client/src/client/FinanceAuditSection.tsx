/**
 * Finance audit settings section. Pure presentation over the controller's
 * snapshot; all data and callbacks arrive through props.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import type {
  FinanceBalanceView,
  FinanceHourOfDayRow,
  FinanceLedger,
  FinanceOverview,
  FinancePeakValleySplit,
} from 'dsh-spark-finance/types'
import type { FinanceAuditState } from './controller.ts'
import type { FinanceKey } from './locales.ts'
import { readFinancePrefs } from './persist.ts'
import { BarChart, Button, DonutChart, TrendChart, CHART_PALETTE, OTHER_CHART_COLOR, niceCeil } from 'dsh-ui-kit'
import type { ChartDatum } from 'dsh-ui-kit'
import type { FinancePrefs } from './persist.ts'
import css from './FinanceAuditSection.module.css'

export interface FinanceAuditInjected {
  useSnapshot: SnapshotSelectorHook<FinanceAuditState>
  t: (key: FinanceKey) => string
  refresh: () => void
}

export interface FinanceAuditSectionProps extends SettingsSectionOwnerProps, FinanceAuditInjected {}

function formatMicros(micros: number, currency: string): string {
  return `${currency} ${(micros / 1_000_000).toFixed(2)}`
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

const CURRENCY_SYMBOLS: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥' }

function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency
}


/** Compact axis label for a micros value: currency symbol + up to two decimals. */
function formatAxisLabel(micros: number, currency: string): string {
  const yuan = micros / 1_000_000
  const text = yuan >= 100 ? yuan.toFixed(0) : yuan >= 10 ? yuan.toFixed(1) : yuan.toFixed(2)
  return `${currencySymbol(currency)}${text}`
}

/** "2026-01-15" -> "01-15" for axis tick labels. */
function dayShortLabel(day: string): string {
  return day.length >= 10 ? day.slice(5) : day
}


/**
 * Format an epoch moment as Beijing time (UTC+8), the DeepSeek peak/off-peak
 * reference clock: "2026-08-17 00:00". The era boundary is defined on that
 * clock by the price table, so the displayed date must not drift with the
 * viewer's own timezone.
 */
function formatBeijingTime(ms: number): string {
  const d = new Date(ms + 8 * 3_600_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** "08-22 13:37" — Beijing-time short stamp for rolling-window ticks and tooltips. */
function formatBeijingShort(ms: number): string {
  const d = new Date(ms + 8 * 3_600_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** Local hour (0-23) on the Beijing (UTC+8) clock, the peak/off-peak reference. */
function beijingHourOf(ms: number): number {
  return Math.floor(((ms + 8 * 3_600_000) % 86_400_000) / 3_600_000)
}

/** "13:37" — Beijing clock time only, for compact axis edge ticks. */
function beijingClock(ms: number): string {
  const d = new Date(ms + 8 * 3_600_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}



interface BreakdownSource {
  key: string
  label: string
  costMicros: number
  /** Extra tooltip line (tokens, session count, …). */
  detail?: string
  /** Numeric secondary value folded into the "Other" row's detail. */
  value2?: number
  value2Label?: string
  /** Optional fixed hue (peak/off-peak segments keep semantic colors). */
  color?: string
}

/**
 * Sort a cost breakdown by cost (descending), keep the top `limit` entries and
 * fold the remainder into a single "Other" row so a handful of slices stay
 * legible. Every entry keeps its share of the total.
 */
function buildBreakdown(sources: readonly BreakdownSource[], limit: number, t: (key: FinanceKey) => string): ChartDatum[] {
  const sorted = [...sources].sort((a, b) => b.costMicros - a.costMicros)
  const total = sorted.reduce((sum, row) => sum + row.costMicros, 0)
  const rest = sorted.slice(limit)
  const data = sorted.slice(0, limit).map((row, i) => ({
    key: row.key,
    label: row.label,
    value: row.costMicros,
    color: row.color ?? CHART_PALETTE[i % CHART_PALETTE.length],
    detail: row.detail,
  }))
  if (rest.length > 0) {
    const restCost = rest.reduce((sum, row) => sum + row.costMicros, 0)
    const secondary = rest.reduce((sum, row) => sum + (row.value2 ?? 0), 0)
    data.push({
      key: '__other__',
      label: t('other'),
      value: restCost,
      color: OTHER_CHART_COLOR,
      detail: rest[0].value2Label !== undefined && secondary > 0 ? `${secondary} ${rest[0].value2Label}` : undefined,
    })
  }
  return data
}

/** Peak-hour bars / peak segment of the peak-valley split (amber). */
const PEAK_COLOR = '#f59e0b'
/** Off-peak bars / off-peak segment (brand blue). */
const OFFPEAK_COLOR = '#4176e6'
/** Flat-rate (no window schedule) bars / segment (slate). */
const FLAT_COLOR = '#64748b'
/** Pre-window-era sessions, billed at the flat rate (lighter slate). */
const LEGACY_COLOR = '#94a3b8'
/** Plan (subscription) routes: list-price equivalents, never cash flow. */
const PLAN_COLOR = '#a855f7'

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={css.kpi}>
      <div className={css.kpiLabel}>{label}</div>
      <div className={css.kpiValue}>{value}</div>
      {sub === undefined ? null : <div className={css.kpiSub}>{sub}</div>}
    </div>
  )
}

/**
 * Balance battery gauge: the bar fills from the historical peak (recharge
 * baseline) down to the current balance. A detected top-up raises the peak and
 * refills the gauge; spending drains it. Peak tracking lives in the controller.
 */
function BalanceGauge({ balance, peak, spentMicros, currency, t }: {
  balance: FinanceBalanceView
  peak?: { micros: number; updatedAt: number }
  spentMicros: number
  currency: string
  t: (key: FinanceKey) => string
}) {
  if (balance.status === 'missing-credential') {
    return (
      <section className={css.gaugeCard}>
        <div className={css.gaugeStatus}>{t('missingCredential')}</div>
      </section>
    )
  }
  if (balance.status === 'error') {
    return (
      <section className={css.gaugeCard}>
        <div className={css.gaugeStatus}>{t('error')}</div>
        {balance.message === undefined ? null : <div className={css.statusDetail}>{balance.message}</div>}
      </section>
    )
  }
  const total = balance.totalMicros ?? 0
  const peakMicros = Math.max(peak?.micros ?? total, total)
  const percent = peakMicros <= 0 ? 100 : Math.round(Math.min(1, total / peakMicros) * 100)
  return (
    <section className={css.gaugeCard}>
      <div className={css.gaugeHead}>
        <span className={css.gaugeTitle}>{t('balanceGauge')}</span>
        <span className={css.gaugePercent}>{t('remaining')} {percent}%</span>
      </div>
      <div className={css.gaugeTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('balanceGauge')}>
        <div className={css.gaugeFill} style={{ width: `${percent}%` }} />
      </div>
      <div className={css.gaugeMeta}>
        <span>{t('balance')} {formatMicros(total, currency)}</span>
        <span>{t('peak')} {formatMicros(peakMicros, currency)}</span>
        <span>{t('spent')} {formatMicros(spentMicros, currency)}</span>
      </div>
    </section>
  )
}

const HOD_W = 640
const HOD_H = 220
const HOD_PAD = { top: 14, right: 10, bottom: 30, left: 50 }

/**
 * 24 local hour-of-day cost bars, colored by time band (amber = peak hour,
 * brand blue = off-peak, slate = flat-era line). Hovering pops the hour's
 * cost, tokens, and band breakdown; the stats row summarizes the peak/off-peak
 * split and the potential shift savings.
 */
function HourOfDayChart({ byHourOfDay, split, currency, windowStartMs, t }: {
  byHourOfDay: readonly FinanceHourOfDayRow[]
  split: FinancePeakValleySplit
  currency: string
  /** Rolling 24h window start (epoch ms); the chart shows only this window. */
  windowStartMs: number
  t: (key: FinanceKey) => string
}) {
  const slots = useMemo(() => {
    const arr: FinanceHourOfDayRow[] = Array.from({ length: 24 }, (_, localHour) => ({
      localHour,
      usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      costMicros: 0,
      peakCostMicros: 0,
      flatCostMicros: 0,
      shiftSavingsMicros: 0,
    }))
    for (const row of byHourOfDay) {
      if (Number.isInteger(row.localHour) && row.localHour >= 0 && row.localHour < 24) arr[row.localHour] = { ...row }
    }
    return arr
  }, [byHourOfDay])
  const WINDOW_MS = 24 * 3_600_000
  // Round the window edges to whole hours so the axis stays stable and
  // symmetric: the right edge is the current moment rounded UP to the next
  // hour (covering the in-flight hour), the left edge exactly 24h before.
  // The axis therefore never jitters at minute granularity; it rolls one
  // hour forward with each ledger refresh.
  const windowEndMs = Math.ceil((windowStartMs + WINDOW_MS) / 3_600_000) * 3_600_000
  const windowStartDisplayMs = windowEndMs - WINDOW_MS
  // Beijing midnights that fall inside the window: the 昨日/今日 boundary
  // the chart draws as a dashed divider.
  const dayDividersMs = useMemo(() => {
    const marks: number[] = []
    const day = new Date(windowEndMs + 8 * 3_600_000)
    for (let offset = -1; offset <= 0; offset++) {
      const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + offset) - 8 * 3_600_000
      if (midnight > windowStartDisplayMs && midnight < windowEndMs) marks.push(midnight)
    }
    return marks
  }, [windowEndMs, windowStartDisplayMs])
  // Lay the 24 buckets out in time order across the rounded window: the
  // first bucket starts at the left edge, each later bucket one hour on.
  // Every local hour appears exactly once in a 24h window, so reordering
  // is lossless.
  const firstBucketStartMs = windowStartDisplayMs
  const firstLocalHour = beijingHourOf(firstBucketStartMs)
  const ordered = useMemo(() => Array.from({ length: 24 }, (_, i) => ({
    row: slots[(firstLocalHour + i) % 24],
    startMs: firstBucketStartMs + i * 3_600_000,
  })), [slots, firstLocalHour, firstBucketStartMs])
  const [hover, setHover] = useState<number | null>(null)

  const plotW = HOD_W - HOD_PAD.left - HOD_PAD.right
  const plotH = HOD_H - HOD_PAD.top - HOD_PAD.bottom
  const baseY = HOD_PAD.top + plotH
  if (ordered.every(item => item.row.costMicros <= 0)) return <div className={css.empty}>{t('empty')}</div>
  const yMax = niceCeil(Math.max(...ordered.map(item => item.row.costMicros), 1))
  const slotW = plotW / 24
  const barW = Math.min(14, Math.max(4, slotW * 0.62))
  // Hour ticks every 4 buckets (4h apart) so the axis stays detailed but
  // not dense; both window edges carry their own labels.
  const xTicks = [4, 8, 12, 16, 20]
  const yTicks = Array.from({ length: 5 }, (_, i) => ({ value: yMax * i / 4, y: baseY - plotH * i / 4 }))

  let tip: ReactNode = null
  if (hover !== null && ordered[hover].row.costMicros > 0) {
    const item = ordered[hover]
    const row = item.row
    const x = HOD_PAD.left + (hover + 0.5) * slotW
    const y = baseY - row.costMicros / yMax * plotH
    const offPeak = row.costMicros - row.peakCostMicros - row.flatCostMicros
    const parts: string[] = []
    if (row.peakCostMicros > 0) parts.push(`${t('peakBand')} ${formatMicros(row.peakCostMicros, currency)}`)
    if (offPeak > 0) parts.push(`${t('offPeak')} ${formatMicros(offPeak, currency)}`)
    if (row.flatCostMicros > 0) parts.push(`${t('flat')} ${formatMicros(row.flatCostMicros, currency)}`)
    // Per-hour shift savings (peak cost − off-peak equivalent): which hours
    // are most worth shifting.
    const shiftSavings = row.shiftSavingsMicros ?? 0
    const detailLines: string[] = []
    if (parts.length > 0) detailLines.push(parts.join(' · '))
    if (shiftSavings > 0) detailLines.push(`${t('shiftSavings')} ${formatMicros(shiftSavings, currency)}`)
    const tipW = 170
    const tipH = 38 + detailLines.length * 20
    const tx = Math.max(HOD_PAD.left, Math.min(HOD_W - HOD_PAD.right - tipW, x - tipW / 2))
    const ty = y - 14 - tipH >= HOD_PAD.top ? y - 14 - tipH : y + 14
    tip = (
      <g pointerEvents="none">
        <line x1={x} y1={HOD_PAD.top} x2={x} y2={baseY} className={css.trendGuide} />
        <rect x={tx} y={ty} width={tipW} height={tipH} rx={6} className={css.trendTip} />
        <text x={tx + 10} y={ty + 15} className={css.trendTipDate}>{formatBeijingShort(item.startMs)}–{formatBeijingShort(item.startMs + 3_600_000)}</text>
        <text x={tx + 10} y={ty + 30} className={css.trendTipCost}>{formatMicros(row.costMicros, currency)}</text>
        {detailLines.map((line, i) => (
          <text key={i} x={tx + 10} y={ty + 47 + i * 20} className={css.trendTipDate}>{line}</text>
        ))}
      </g>
    )
  }

  return (
    <div className={css.trendWrap}>
      <div className={css.trendStats}>
        <span>{t('hourWindowRange')} {formatBeijingShort(windowStartDisplayMs)} → {formatBeijingShort(windowEndMs)}</span>
        <span>{t('peakBand')} {formatMicros(split.peakCostMicros, currency)}</span>
        <span>{t('offPeak')} {formatMicros(split.offPeakCostMicros, currency)}</span>
        <span>{t('flat')} {formatMicros(split.flatCostMicros, currency)}</span>
        {split.legacyCostMicros > 0
          ? <span title={t('legacyHint')}>{t('legacySessions')} {formatMicros(split.legacyCostMicros, currency)}</span>
          : null}
        <span title={t('shiftSavingsHint')}>{t('shiftSavings')} {formatMicros(split.shiftSavingsMicros, currency)}</span>
        {split.peakCostMicros > 0
          ? <span title={t('shiftSavingsHint')}>{t('shiftSavingsOfPeak')} {Math.round(split.shiftSavingsMicros / split.peakCostMicros * 100)}%</span>
          : null}
      </div>
      <div className={css.hodLegend} aria-hidden="true">
        <span className={css.hodLegendItem}><span className={css.legendSwatch} style={{ background: PEAK_COLOR }} />{t('peakBand')}</span>
        <span className={css.hodLegendItem}><span className={css.legendSwatch} style={{ background: OFFPEAK_COLOR }} />{t('offPeak')}</span>
        <span className={css.hodLegendItem}><span className={css.legendSwatch} style={{ background: FLAT_COLOR }} />{t('flat')}</span>
      </div>
      <svg className={css.trend} viewBox={`0 0 ${HOD_W} ${HOD_H}`} role="img" aria-label={t('hourOfDay')}>
        {yTicks.map(tick => (
          <g key={tick.value}>
            <line x1={HOD_PAD.left} y1={tick.y} x2={HOD_W - HOD_PAD.right} y2={tick.y} className={css.trendGrid} />
            <text x={HOD_PAD.left - 8} y={tick.y + 3.5} textAnchor="end" className={css.trendAxis}>
              {formatAxisLabel(tick.value, currency)}
            </text>
          </g>
        ))}
        <line x1={HOD_PAD.left} y1={baseY} x2={HOD_W - HOD_PAD.right} y2={baseY} className={css.trendAxisBase} />
        {/* 昨日/今日 day dividers (Beijing midnights inside the window). */}
        {dayDividersMs.map(midnight => {
          const x = HOD_PAD.left + (midnight - windowStartDisplayMs) / WINDOW_MS * plotW
          // Flip the label inward when the divider hugs the right edge, so it
          // never collides with the "now" tick.
          const nearRight = x > HOD_PAD.left + plotW - 48
          return (
            <g key={midnight}>
              <line x1={x} y1={HOD_PAD.top} x2={x} y2={baseY} className={css.hodDayDivider} />
              <text x={nearRight ? x - 3 : x + 3} y={HOD_PAD.top + 9} textAnchor={nearRight ? 'end' : 'start'} className={css.hodDayLabel}>{t('today')}</text>
            </g>
          )
        })}
        {/* Left edge: the rounded window start (now - 24h, whole hour). */}
        <line x1={HOD_PAD.left} y1={baseY} x2={HOD_PAD.left} y2={baseY + 4} className={css.trendGrid} />
        <text x={HOD_PAD.left - 4} y={baseY + 18} textAnchor="end" className={css.trendAxis}>{beijingClock(windowStartDisplayMs)}</text>
        {/* Hour ticks every 4 buckets (4h apart) ON BUCKET BOUNDARIES: the
            tick at HH:00 marks the start of the hour its right-hand bucket
            aggregates ([HH:00, HH:59:59]), so the axis is boundary-aligned. */}
        {xTicks.map(i => {
          const startMs = ordered[i].startMs
          const x = HOD_PAD.left + i * slotW
          return (
            <g key={i}>
              <line x1={x} y1={baseY} x2={x} y2={baseY + 4} className={css.trendGrid} />
              <text x={x} y={baseY + 18} textAnchor="middle" className={css.trendAxis}>{String(beijingHourOf(startMs)).padStart(2, '0')}:00</text>
            </g>
          )
        })}
        {/* Right edge: the rounded end of the data window = the current moment
            rounded UP to the next whole hour (covering the in-flight hour).
            Labeled with the hour only, so it never reads as a fake clock time. */}
        <line x1={HOD_PAD.left + plotW} y1={baseY} x2={HOD_PAD.left + plotW} y2={baseY + 4} className={css.trendGrid} />
        <text x={HOD_PAD.left + plotW} y={baseY + 18} textAnchor="end" className={css.trendAxis}>{beijingClock(windowEndMs)}</text>
        {ordered.map((item, i) => {
          const row = item.row
          if (row.costMicros <= 0) return null
          const x = HOD_PAD.left + (i + 0.5) * slotW
          const h = row.costMicros / yMax * plotH
          const color = row.peakCostMicros > 0 ? PEAK_COLOR : row.flatCostMicros > 0 ? FLAT_COLOR : OFFPEAK_COLOR
          return (
            <rect
              key={i}
              x={x - barW / 2}
              y={baseY - h}
              width={barW}
              height={h}
              rx={2}
              fill={color}
              opacity={hover === null || hover === i ? 1 : 0.35}
              className={css.hodBar}
            />
          )
        })}
        {tip}
        <rect
          x={HOD_PAD.left}
          y={HOD_PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          pointerEvents="all"
          className={css.trendOverlay}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const px = (event.clientX - rect.left) / rect.width * plotW + HOD_PAD.left
            const index = Math.round((px - HOD_PAD.left) / slotW - 0.5)
            setHover(Math.max(0, Math.min(23, index)))
          }}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
    </div>
  )
}

export function FinanceAuditSection(props: FinanceAuditSectionProps) {
  const { useSnapshot, t, refresh } = props
  const state = useSnapshot(s => s)

  useEffect(() => {
    if (state.status === 'idle') refresh()
  }, [state.status, refresh])

  // The hour-of-day chart is a rolling 24h window: while the panel stays open,
  // quietly refresh so the window does not go stale (server rebuilds the ledger
  // with the current now; the refresh patches the snapshot without flashing).
  useEffect(() => {
    const timer = setInterval(() => { refresh() }, 30 * 60_000)
    return () => clearInterval(timer)
  }, [refresh])

  if (state.status === 'idle' || state.status === 'loading') {
    // First open runs the host's one-time hourly backfill, which can take a
    // while — show a spinner, explain what is happening, and reassure the
    // user with live progress instead of a bare "loading…" line.
    const progress = state.progress
    const percent = progress !== undefined && progress.total > 0
      ? Math.min(100, Math.round(progress.scanned / progress.total * 100))
      : null
    return (
      <div className={css.status} role="status" aria-live="polite">
        <div className={css.spinner} aria-hidden="true" />
        <div className={css.statusTitle}>{t('loadingTitle')}</div>
        <div className={css.statusDetail}>{t('loadingDetail')}</div>
        {progress === undefined || progress.total <= 0 ? null : (
          <>
            <div
              className={css.progressTrack}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.scanned}
              aria-label={t('loadingProgress')}
            >
              <div className={css.progressFill} style={{ width: `${percent}%` }} />
            </div>
            <div className={css.statusDetail}>{t('loadingProgress')} {progress.scanned} / {progress.total}</div>
          </>
        )}
        <div className={css.statusDetail}>{t('loadingReassure')}</div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className={css.status}>
        <div>{t('error')}</div>
        <div className={css.statusDetail}>{state.error}</div>
        <Button variant="outline" onClick={refresh}>{t('refresh')}</Button>
      </div>
    )
  }

  if (state.overview === undefined) return null
  return <FinanceReady overview={state.overview} peak={state.peak} t={t} refresh={refresh} />
}

function FinanceReady({ overview, peak, t, refresh }: {
  overview: FinanceOverview
  peak?: { micros: number; updatedAt: number }
  t: (key: FinanceKey) => string
  refresh: () => void
}) {
  const { balance, ledger } = overview

  // View preferences: layout density and per-chart visibility, read from the
  // browser and honored here. The controls themselves live on the plugin
  // configuration card (设置 → 插件 → 插件配置页); the dashboard only reports.
  const [prefs] = useState<FinancePrefs>(() => readFinancePrefs())
  const charts = prefs.charts

  // Model donut: the slice label is the model id, the tooltip names its
  // provider (the ledger now splits provider/model on every row).
  const modelRows = useMemo(() => buildBreakdown(ledger.byModel.map(row => {
    const parts = [
      `${t('tipProvider')} ${row.provider}`,
      `${t('tipInput')} ${formatTokens(row.usage.uncachedInputTokens)}`,
      `${t('tipOutput')} ${formatTokens(row.usage.outputTokens)}`,
    ]
    if ((row.shiftSavingsMicros ?? 0) > 0) {
      parts.push(`${t('shiftSavings')} ${formatMicros(row.shiftSavingsMicros ?? 0, ledger.currency)}`)
    }
    const plan = row.billingMode === 'plan'
    if (plan) parts.unshift(`${t('planEquivalent')} ${formatMicros(row.costMicros, ledger.currency)}`)
    return {
      key: row.modelKey,
      label: plan ? `${row.model} ·${t('planTag')}` : row.model,
      costMicros: row.costMicros,
      color: plan ? PLAN_COLOR : undefined,
      detail: parts.join(' · '),
    }
  }), 5, t), [ledger, t])
  // Provider donut: cost rollup per LLM provider, with the distinct model
  // count folded into the Other row's secondary value.
  const providerRows = useMemo(() => buildBreakdown((ledger.byProvider ?? []).map(row => {
    const plan = row.billingMode === 'plan'
    const mixed = row.billingMode === 'mixed'
    return {
      key: row.provider,
      label: plan ? `${row.provider} ·${t('planTag')}` : mixed ? `${row.provider} ·${t('mixedTag')}` : row.provider,
      costMicros: row.costMicros,
      color: plan ? PLAN_COLOR : mixed ? OTHER_CHART_COLOR : undefined,
      detail: `${row.modelCount} ${t('modelCountUnit')} · ${t('tipInput')} ${formatTokens(row.usage.uncachedInputTokens)}`,
      value2: row.modelCount,
      value2Label: t('modelCountUnit'),
    }
  }), 5, t), [ledger, t])
  const workspaceRows = useMemo(() => buildBreakdown(ledger.byWorkspace.map(row => ({
    key: row.workspaceId ?? '__unassigned__',
    label: row.title,
    costMicros: row.costMicros,
    detail: `${row.sessionCount} ${t('sessions')}`,
    value2: row.sessionCount,
    value2Label: t('sessions'),
  })), 6, t), [ledger, t])

  // The hours whose peak usage is most worth shifting off-peak, for a
  // concrete "shift these hours" hint (per-hour savings sum to the total).
  const topShiftHours = useMemo(() => [...(ledger.byHourOfDay ?? [])]
    .filter(row => (row.shiftSavingsMicros ?? 0) > 0)
    .sort((a, b) => (b.shiftSavingsMicros ?? 0) - (a.shiftSavingsMicros ?? 0))
    .slice(0, 3)
    .map(row => ({
      hour: row.hourStartMs !== undefined ? formatBeijingShort(row.hourStartMs) : `${String(row.localHour).padStart(2, '0')}:00`,
      savingsMicros: row.shiftSavingsMicros ?? 0,
    })),
  [ledger])

  // Peak/off-peak split donut: semantic hues per time band, zero-cost bands
  // omitted. The five buckets are disjoint and sum to the ledger total —
  // legacy (pre-window-era sessions) included, so the donut center stays the
  // full cost while peak/valley only covers the windowed era.
  const split = ledger.peakValley
  const legacyCost = split?.legacyCostMicros ?? 0
  const splitRows = useMemo(() => {
    if (split === undefined) return [] as ChartDatum[]
    const sources: BreakdownSource[] = []
    if (legacyCost > 0) sources.push({ key: 'legacy', label: t('legacySessions'), costMicros: legacyCost, color: LEGACY_COLOR })
    if (split.peakCostMicros > 0) sources.push({ key: 'peak', label: t('peakBand'), costMicros: split.peakCostMicros, color: PEAK_COLOR })
    if (split.offPeakCostMicros > 0) sources.push({ key: 'offpeak', label: t('offPeak'), costMicros: split.offPeakCostMicros, color: OFFPEAK_COLOR })
    if (split.flatCostMicros > 0) sources.push({ key: 'flat', label: t('flat'), costMicros: split.flatCostMicros, color: FLAT_COLOR })
    if (split.unclassifiedCostMicros > 0) sources.push({ key: 'unclassified', label: t('unclassified'), costMicros: split.unclassifiedCostMicros, color: OTHER_CHART_COLOR })
    return buildBreakdown(sources, 5, t)
  }, [split, legacyCost, t])

  const shiftPct = split !== undefined && split.peakCostMicros > 0
    ? Math.round(split.shiftSavingsMicros / split.peakCostMicros * 100)
    : null

  const layoutClass = prefs.layout === 'compact' ? css.rootCompact : css.rootStandard

  return (
    <div className={`${css.root} ${layoutClass}`}>
      <div className={css.head}>
        <div>
          <div className={css.title}>{t('title')}</div>
          <div className={css.subtitle}>{t('subtitle')}</div>
        </div>
        <div className={css.actions}>
          <Button variant="outline" onClick={refresh}>{t('refresh')}</Button>
        </div>
      </div>

      {charts.gauge ? (
        <BalanceGauge
          balance={balance}
          peak={peak}
          // The wallet only ever loses METERED money; plan subscriptions are a
          // flat fee, so their list-price equivalent must not drain the gauge.
          spentMicros={ledger.meteredCostMicros ?? ledger.totalCostMicros}
          currency={ledger.currency}
          t={t}
        />
      ) : null}

      {charts.kpis ? (
        <div className={css.kpis}>
          <KpiCard label={t('totalInput')} value={formatTokens(ledger.totals.uncachedInputTokens)} />
          <KpiCard label={t('totalOutput')} value={formatTokens(ledger.totals.outputTokens)} />
          <KpiCard label={t('sessions')} value={String(ledger.sessionCount)} />
          <KpiCard label={t('workspaces')} value={String(ledger.workspaceCount)} />
        </div>
      ) : null}
      {(ledger.planEquivalentCostMicros ?? 0) > 0 && charts.kpis ? (
        <div className={css.kpis}>
          <KpiCard label={t('meteredSpend')} value={formatMicros(ledger.meteredCostMicros ?? ledger.totalCostMicros, ledger.currency)} sub={t('meteredSpendHint')} />
          <KpiCard label={t('planEquivalent')} value={formatMicros(ledger.planEquivalentCostMicros ?? 0, ledger.currency)} sub={t('planEquivalentHint')} />
        </div>
      ) : null}
      {ledger.windowedSinceMs == null ? (
        <div className={css.peakValleyNotes}>{t('peakValleyHint')}</div>
      ) : (
        <div className={css.peakValleyNotes}>
          <div>{t('peakValleySince')} {formatBeijingTime(ledger.windowedSinceMs)} {t('peakValleySinceTail')}</div>
          <div>{t('peakValleyHint')}</div>
        </div>
      )}

      {split !== undefined && (charts.split || charts.hourOfDay) ? (
        <div className={css.grid}>
          {charts.split ? (
            <section className={css.card}>
              <div className={css.cardTitle}>{t('peakValleySplit')}</div>
              <div className={css.cardStats}>
                <span>{t('peakBand')} {formatMicros(split.peakCostMicros, ledger.currency)}</span>
                <span>{t('offPeak')} {formatMicros(split.offPeakCostMicros, ledger.currency)}</span>
                {legacyCost > 0
                  ? <span title={t('legacyHint')}>{t('legacySessions')} {formatMicros(legacyCost, ledger.currency)}</span>
                  : null}
                <span title={t('shiftSavingsHint')}>{t('shiftSavings')} {formatMicros(split.shiftSavingsMicros, ledger.currency)}</span>
                {shiftPct === null ? null : <span title={t('shiftSavingsHint')}>{t('shiftSavingsOfPeak')} {shiftPct}%</span>}
              </div>
              <DonutChart
                rows={splitRows}
                centerValue={formatAxisLabel(splitRows.reduce((sum, row) => sum + row.value, 0), ledger.currency)}
                centerLabel={t('trendTotal')}
                ariaLabel={t('peakValleySplit')}
                formatValue={(value) => formatMicros(value, ledger.currency)}
              />
              {topShiftHours.length === 0 ? null : (
                <div className={css.shiftSavingsTop} title={t('shiftSavingsHint')}>
                  <span className={css.shiftSavingsTopLabel}>{t('shiftSavingsTop')}</span>
                  {topShiftHours.map((entry, i) => (
                    <span key={entry.hour}>{i > 0 ? ' · ' : null}{entry.hour}:00（{formatMicros(entry.savingsMicros, ledger.currency)}）</span>
                  ))}
                </div>
              )}
            </section>
          ) : null}
          {charts.hourOfDay ? (
            <section className={css.cardWide}>
              <div className={css.cardTitle}>{t('hourOfDay')}</div>
              <HourOfDayChart byHourOfDay={ledger.byHourOfDay ?? []} split={split} currency={ledger.currency} windowStartMs={ledger.hourOfDayWindowStartMs} t={t} />
            </section>
          ) : null}
        </div>
      ) : null}

      {charts.byProvider || charts.byModel || charts.byWorkspace || charts.byDay ? (
        <div className={css.grid}>
          {charts.byProvider ? (
            <section className={css.card}>
              <div className={css.cardTitle}>{t('byProvider')}</div>
              <div className={css.cardStats}>
                <span>{(ledger.byProvider ?? []).length} {t('providerCountUnit')}</span>
                {(ledger.planEquivalentCostMicros ?? 0) > 0 ? (
                  <>
                    <span title={t('meteredSpendHint')}>{t('meteredSpend')} {formatMicros(ledger.meteredCostMicros ?? ledger.totalCostMicros, ledger.currency)}</span>
                    <span title={t('planEquivalentHint')}>{t('planEquivalent')} {formatMicros(ledger.planEquivalentCostMicros ?? 0, ledger.currency)}</span>
                  </>
                ) : (
                  <span>{t('trendTotal')} {formatMicros(ledger.totalCostMicros, ledger.currency)}</span>
                )}
              </div>
              <DonutChart
                rows={providerRows}
                centerValue={formatAxisLabel(providerRows.reduce((sum, row) => sum + row.value, 0), ledger.currency)}
                centerLabel={t('trendTotal')}
                ariaLabel={t('byProvider')}
                formatValue={(value) => formatMicros(value, ledger.currency)}
              />
            </section>
          ) : null}
          {charts.byModel ? (
            <section className={css.card}>
              <div className={css.cardTitle}>{t('byModel')}</div>
              <div className={css.cardStats}>
                <span>{ledger.byModel.length} {t('modelCountUnit')}</span>
                <span>{t('trendTotal')} {formatMicros(ledger.totalCostMicros, ledger.currency)}</span>
              </div>
              <DonutChart
                rows={modelRows}
                centerValue={formatAxisLabel(modelRows.reduce((sum, row) => sum + row.value, 0), ledger.currency)}
                centerLabel={t('trendTotal')}
                ariaLabel={t('byModel')}
                formatValue={(value) => formatMicros(value, ledger.currency)}
              />
            </section>
          ) : null}
          {charts.byWorkspace ? (
            <section className={css.card}>
              <div className={css.cardTitle}>{t('byWorkspace')}</div>
              <div className={css.cardStats}>
                <span>{ledger.byWorkspace.length} {t('workspaceCountUnit')}</span>
                <span>{t('trendTotal')} {formatMicros(ledger.totalCostMicros, ledger.currency)}</span>
              </div>
              <BarChart
                rows={workspaceRows}
                ariaLabel={t('byWorkspace')}
                formatValue={(value) => formatMicros(value, ledger.currency)}
                axisFormatter={(value) => formatAxisLabel(value, ledger.currency)}
              />
            </section>
          ) : null}
          {charts.byDay ? (
            <section className={css.cardWide}>
              <div className={css.cardTitle}>{t('byDay')}</div>
              <div className={css.trendWrap}>
                <div className={css.trendStats}>
                  <span>{t('trendRange')} {ledger.byDay.length} {t('trendDaysUnit')}</span>
                  <span>{t('trendTotal')} {formatMicros(ledger.byDay.reduce((sum, row) => sum + row.costMicros, 0), ledger.currency)}</span>
                  <span>{t('trendAvg')} {formatMicros(Math.round(ledger.byDay.reduce((sum, row) => sum + row.costMicros, 0) / Math.max(1, ledger.byDay.length)), ledger.currency)}</span>
                </div>
                <TrendChart
                  points={ledger.byDay.slice(-30).map(row => ({ key: row.day, label: dayShortLabel(row.day), value: row.costMicros }))}
                  ariaLabel={t('byDay')}
                  formatValue={(value) => formatAxisLabel(value, ledger.currency)}
                  gradientId="dsh-spark-finance-trend-grad"
                />
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
