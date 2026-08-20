/**
 * Finance audit settings section. Pure presentation over the controller's
 * snapshot; all data and callbacks arrive through props.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotSelectorHook } from 'dsh-plugin-kit/client'
import type {
  FinanceBalanceView,
  FinanceHourOfDayRow,
  FinanceLedger,
  FinanceOverview,
  FinancePeakValleySplit,
} from 'dsh-finance/types'
import type { FinanceAuditState } from './controller.ts'
import type { FinanceKey } from './locales.ts'
import { readFinancePrefs } from './persist.ts'
import { Button } from 'dsh-ui-kit'
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

/** Round up to a clean axis maximum (1 / 2 / 2.5 / 5 × 10^n) so gridlines land on round values. */
function niceCeil(value: number): number {
  if (value <= 0) return 1
  const base = 10 ** Math.floor(Math.log10(value))
  const factor = value / base
  const step = factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 2.5 ? 2.5 : factor <= 5 ? 5 : 10
  return step * base
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
 * Distinct hues per breakdown category. The design system only ships blue
 * (incl. the brand family), green, amber, red and neutrals, so two adjacent
 * categories were both blue (flash and pro were indistinguishable). This
 * categorical palette therefore uses literal hexes with maximal hue
 * separation — brand first, then complementary chart accents. The static
 * tokens are fixed colors anyway, so literals behave identically.
 */
const PALETTE = [
  '#4176e6', // dsw-static-deepseek-500 (brand)
  '#22c55e', // dsw-static-green-500
  '#f59e0b', // dsw-static-amber-500
  '#ef4444', // dsw-static-red-500
  '#8b5cf6', // violet chart accent
  '#14b8a6', // teal chart accent
  '#2563eb', // dsw-static-blue-600
  '#e879f9', // fuchsia chart accent
  '#fb923c', // orange chart accent
  '#64748b', // slate chart accent
]

/** Aggregated "everything else" slice; deliberately muted. */
const OTHER_COLOR = '#65676b'

/** Peak-hour bars / peak segment of the peak-valley split (amber). */
const PEAK_COLOR = '#f59e0b'
/** Off-peak bars / off-peak segment (brand blue). */
const OFFPEAK_COLOR = '#4176e6'
/** Flat-rate (no window schedule) bars / segment (slate). */
const FLAT_COLOR = '#64748b'
/** Pre-window-era sessions, billed at the flat rate (lighter slate). */
const LEGACY_COLOR = '#94a3b8'

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

interface BreakdownDatum {
  key: string
  label: string
  costMicros: number
  /** Share of the total cost, 0-100. */
  percent: number
  color: string
  detail?: string
}

/**
 * Sort a cost breakdown by cost (descending), keep the top `limit` entries and
 * fold the remainder into a single "Other" row so a handful of slices stay
 * legible. Every entry keeps its share of the total.
 */
function buildBreakdown(sources: readonly BreakdownSource[], limit: number, t: (key: FinanceKey) => string): BreakdownDatum[] {
  const sorted = [...sources].sort((a, b) => b.costMicros - a.costMicros)
  const total = sorted.reduce((sum, row) => sum + row.costMicros, 0)
  const rest = sorted.slice(limit)
  const data = sorted.slice(0, limit).map((row, i) => ({
    key: row.key,
    label: row.label,
    costMicros: row.costMicros,
    percent: total === 0 ? 0 : row.costMicros / total * 100,
    color: row.color ?? PALETTE[i % PALETTE.length],
    detail: row.detail,
  }))
  if (rest.length > 0) {
    const restCost = rest.reduce((sum, row) => sum + row.costMicros, 0)
    const secondary = rest.reduce((sum, row) => sum + (row.value2 ?? 0), 0)
    data.push({
      key: '__other__',
      label: t('other'),
      costMicros: restCost,
      percent: total === 0 ? 0 : restCost / total * 100,
      color: OTHER_COLOR,
      detail: rest[0].value2Label !== undefined && secondary > 0 ? `${secondary} ${rest[0].value2Label}` : undefined,
    })
  }
  return data
}

interface ChartHover {
  index: number
  /** Pointer position relative to the chart container. */
  x: number
  y: number
  /** Container size, used to clamp the tooltip into view. */
  w: number
  h: number
}

/**
 * Shared hover state for the breakdown charts. Coordinates are measured
 * relative to the chart container (NOT the viewport) and the tooltip is
 * absolutely positioned inside it: position:fixed with viewport coords is
 * broken when the settings surface lives under a transformed ancestor, which
 * offsets every tooltip out of sight.
 */
function useChartHover() {
  const [hover, setHover] = useState<ChartHover | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const move = useCallback((index: number) => (event: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({ index, x: event.clientX - rect.left, y: event.clientY - rect.top, w: rect.width, h: rect.height })
  }, [])
  const leave = useCallback(() => setHover(null), [])
  return { hover, wrapRef, move, leave }
}

/** Pointer-following tooltip shared by the breakdown charts. */
function ChartTip({ row, currency, x, y, w, h }: { row: BreakdownDatum; currency: string; x: number; y: number; w: number; h: number }) {
  const width = 240
  const height = row.detail === undefined ? 54 : 74
  // Prefer above the cursor, flip below near the top; clamp to the chart bounds.
  const left = Math.max(4, Math.min(x + 12, w - width - 4))
  const top = y - height - 12 >= 4 ? y - height - 12 : Math.max(4, Math.min(y + 16, h - height - 4))
  return (
    <div className={css.tip} role="tooltip" style={{ left, top }}>
      <div className={css.tipTitle}>{row.label}</div>
      <div className={css.tipCost}>{formatMicros(row.costMicros, currency)} · {row.percent.toFixed(1)}%</div>
      {row.detail === undefined ? null : <div className={css.tipDetail}>{row.detail}</div>}
    </div>
  )
}

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

const DONUT_SIZE = 132
const DONUT_R = 50
const DONUT_STROKE = 17

/**
 * SVG donut of the cost breakdown: one ring segment per category in its own
 * hue, total cost in the hole, hover tooltip, and a synced legend showing each
 * category's share and cost. Mirrors the trend chart's interactivity.
 */
function Donut({ rows, currency, ariaLabel, t }: {
  rows: readonly BreakdownDatum[]
  currency: string
  ariaLabel: string
  t: (key: FinanceKey) => string
}) {
  const { hover, wrapRef, move, leave } = useChartHover()
  const center = DONUT_SIZE / 2
  const circumference = 2 * Math.PI * DONUT_R
  const total = rows.reduce((sum, row) => sum + row.costMicros, 0)
  let cursor = 0
  const segments = rows.map(row => {
    const fraction = total === 0 ? 0 : row.costMicros / total
    const segment = { ...row, start: cursor, fraction }
    cursor += fraction
    return segment
  })

  if (rows.length === 0) return <div className={css.empty}>{t('empty')}</div>

  return (
    <div ref={wrapRef} className={css.donutWrap} onPointerLeave={leave}>
      <svg
        width={DONUT_SIZE}
        height={DONUT_SIZE}
        viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
        className={css.donut}
        role="img"
        aria-label={ariaLabel}
      >
        <circle cx={center} cy={center} r={DONUT_R} fill="none" className={css.donutTrack} />
        {segments.map((segment, i) => (
          <circle
            key={segment.key}
            cx={center}
            cy={center}
            r={DONUT_R}
            fill="none"
            style={{ stroke: segment.color }}
            strokeWidth={DONUT_STROKE}
            strokeDasharray={`${Math.max(0, segment.fraction * circumference - 1.5)} ${circumference}`}
            strokeDashoffset={-segment.start * circumference}
            transform={`rotate(-90 ${center} ${center})`}
            className={hover === null || hover.index === i ? css.donutSeg : `${css.donutSeg} ${css.donutSegDim}`}
            onPointerMove={move(i)}
          />
        ))}
        <text x={center} y={center - 1} textAnchor="middle" className={css.donutCenterValue}>
          {formatAxisLabel(total, currency)}
        </text>
        <text x={center} y={center + 13} textAnchor="middle" className={css.donutCenterLabel}>
          {t('trendTotal')}
        </text>
      </svg>
      <div className={css.donutLegend}>
        {segments.map((segment, i) => (
          <div
            key={segment.key}
            className={hover !== null && hover.index === i ? `${css.legendRow} ${css.legendRowActive}` : css.legendRow}
            onPointerMove={move(i)}
          >
            <span className={css.legendSwatch} style={{ background: segment.color }} />
            <span className={css.legendLabel} title={segment.label}>{segment.label}</span>
            <span className={css.legendPercent}>{segment.percent.toFixed(1)}%</span>
            <span className={css.legendValue}>{formatMicros(segment.costMicros, currency)}</span>
          </div>
        ))}
      </div>
      {hover === null ? null : <ChartTip row={segments[hover.index]} currency={currency} x={hover.x} y={hover.y} w={hover.w} h={hover.h} />}
    </div>
  )
}

/**
 * Horizontal bar breakdown with a value axis and gridlines: bars scale to the
 * largest category, each carries its share and cost, and hovering any row pops
 * a pointer-following tooltip. Mirrors the trend chart's axes and tooltip.
 */
function CostBars({ rows, currency, t }: { rows: readonly BreakdownDatum[]; currency: string; t: (key: FinanceKey) => string }) {
  const { hover, wrapRef, move, leave } = useChartHover()
  const maxCost = rows.reduce((max, row) => Math.max(max, row.costMicros), 0)

  if (rows.length === 0) return <div className={css.empty}>{t('empty')}</div>

  return (
    <div ref={wrapRef} className={css.bars} onPointerLeave={leave}>
      <div className={css.barsPlot}>
        <div className={css.barsGrid} aria-hidden="true">
          {[0.25, 0.5, 0.75].map(fraction => (
            <div key={fraction} className={css.barsGridLine} style={{ left: `${fraction * 100}%` }} />
          ))}
        </div>
        {rows.map((row, i) => (
          <div
            key={row.key}
            className={hover !== null && hover.index !== i ? `${css.barRow} ${css.barRowDim}` : css.barRow}
            onPointerMove={move(i)}
          >
            <div className={css.barHead}>
              <span className={css.barLabel} title={row.label}>{row.label}</span>
              <span className={css.barMeta}>
                <span className={css.barPercent}>{row.percent.toFixed(1)}%</span>
                <span className={css.barValue}>{formatMicros(row.costMicros, currency)}</span>
              </span>
            </div>
            <div className={css.barTrack}>
              <div
                className={css.barFill}
                style={{
                  width: `${maxCost === 0 ? 0 : Math.max(row.costMicros / maxCost * 100, row.costMicros === 0 ? 0 : 2)}%`,
                  background: row.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {maxCost === 0 ? null : (
        <div className={css.barsAxis} aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map(fraction => (
            <span key={fraction} className={css.barsAxisLabel} style={{ left: `${fraction * 100}%` }}>
              {formatAxisLabel(maxCost * fraction, currency)}
            </span>
          ))}
        </div>
      )}
      {hover === null ? null : <ChartTip row={rows[hover.index]} currency={currency} x={hover.x} y={hover.y} w={hover.w} h={hover.h} />}
    </div>
  )
}

const TREND_W = 640
const TREND_H = 220
const TREND_PAD = { top: 14, right: 10, bottom: 30, left: 50 }

function Trend({ ledger, t }: { ledger: FinanceLedger; t: (key: FinanceKey) => string }) {
  const rows = useMemo(() => ledger.byDay.slice(-30), [ledger])
  const [hover, setHover] = useState<number | null>(null)

  const plotW = TREND_W - TREND_PAD.left - TREND_PAD.right
  const plotH = TREND_H - TREND_PAD.top - TREND_PAD.bottom
  const baseY = TREND_PAD.top + plotH

  const geometry = useMemo(() => {
    if (rows.length < 2) return null
    const yMax = niceCeil(Math.max(...rows.map(row => row.costMicros), 1))
    const xs = rows.map((_, i) => TREND_PAD.left + i / (rows.length - 1) * plotW)
    const ys = rows.map(row => baseY - row.costMicros / yMax * plotH)
    const points = rows.map((_, i) => `${xs[i]},${ys[i]}`).join(' ')
    const area = `M ${xs[0]},${baseY} L ${rows.map((_, i) => `${xs[i]},${ys[i]}`).join(' L ')} L ${xs[xs.length - 1]},${baseY} Z`
    let peakIndex = 0
    rows.forEach((row, i) => { if (row.costMicros > rows[peakIndex].costMicros) peakIndex = i })
    // 4 intervals -> 5 gridlines including the baseline.
    const yTicks = Array.from({ length: 5 }, (_, i) => ({ value: yMax * i / 4, y: baseY - plotH * i / 4 }))
    const labelCount = Math.min(5, rows.length)
    const xTicks = [...new Set(Array.from({ length: labelCount }, (_, i) => Math.round((rows.length - 1) * i / (labelCount - 1))))]
    return { xs, ys, points, area, yMax, peakIndex, yTicks, xTicks }
  }, [rows])

  if (geometry === null) return <div className={css.empty}>{t('empty')}</div>

  const { xs, ys, points, area, peakIndex, yTicks, xTicks } = geometry
  const currency = ledger.currency
  const totalMicros = rows.reduce((sum, row) => sum + row.costMicros, 0)

  let tip: ReactNode = null
  if (hover !== null) {
    const x = xs[hover]
    const y = ys[hover]
    const tipW = 128
    const tipH = 38
    const tx = Math.max(TREND_PAD.left, Math.min(TREND_W - TREND_PAD.right - tipW, x - tipW / 2))
    const ty = y - 14 - tipH >= TREND_PAD.top ? y - 14 - tipH : y + 14
    tip = (
      <g pointerEvents="none">
        <line x1={x} y1={TREND_PAD.top} x2={x} y2={baseY} className={css.trendGuide} />
        <rect x={tx} y={ty} width={tipW} height={tipH} rx={6} className={css.trendTip} />
        <text x={tx + 10} y={ty + 15} className={css.trendTipDate}>{rows[hover].day}</text>
        <text x={tx + 10} y={ty + 30} className={css.trendTipCost}>{formatMicros(rows[hover].costMicros, currency)}</text>
      </g>
    )
  }

  return (
    <div className={css.trendWrap}>
      <div className={css.trendStats}>
        <span>{t('trendRange')} {rows.length} {t('trendDaysUnit')}</span>
        <span>{t('trendTotal')} {formatMicros(totalMicros, currency)}</span>
        <span>{t('trendAvg')} {formatMicros(Math.round(totalMicros / rows.length), currency)}</span>
      </div>
      <svg className={css.trend} viewBox={`0 0 ${TREND_W} ${TREND_H}`} role="img" aria-label={t('byDay')}>
        <defs>
          <linearGradient id="dsh-finance-trend-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--dsw-static-deepseek-500)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--dsw-static-deepseek-500)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map(tick => (
          <g key={tick.value}>
            <line x1={TREND_PAD.left} y1={tick.y} x2={TREND_W - TREND_PAD.right} y2={tick.y} className={css.trendGrid} />
            <text x={TREND_PAD.left - 8} y={tick.y + 3.5} textAnchor="end" className={css.trendAxis}>
              {formatAxisLabel(tick.value, currency)}
            </text>
          </g>
        ))}
        <line x1={TREND_PAD.left} y1={baseY} x2={TREND_W - TREND_PAD.right} y2={baseY} className={css.trendAxisBase} />
        {xTicks.map(index => (
          <g key={index}>
            <line x1={xs[index]} y1={baseY} x2={xs[index]} y2={baseY + 4} className={css.trendGrid} />
            <text x={xs[index]} y={baseY + 18} textAnchor="middle" className={css.trendAxis}>
              {dayShortLabel(rows[index].day)}
            </text>
          </g>
        ))}
        <path d={area} className={css.trendArea} />
        <polyline points={points} className={css.trendLine} fill="none" vectorEffect="non-scaling-stroke" />
        {xs.map((x, i) => (
          <circle
            key={rows[i].day}
            cx={x}
            cy={ys[i]}
            r={i === peakIndex ? 4.2 : 3}
            className={i === peakIndex ? `${css.trendDot} ${css.trendDotPeak}` : css.trendDot}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {tip}
        <rect
          x={0}
          y={0}
          width={TREND_W}
          height={TREND_H}
          fill="transparent"
          pointerEvents="all"
          className={css.trendOverlay}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const px = (event.clientX - rect.left) / rect.width * TREND_W
            const index = Math.round((px - TREND_PAD.left) / plotW * (rows.length - 1))
            setHover(Math.max(0, Math.min(rows.length - 1, index)))
          }}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
    </div>
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
function HourOfDayChart({ byHourOfDay, split, currency, t }: {
  byHourOfDay: readonly FinanceHourOfDayRow[]
  split: FinancePeakValleySplit
  currency: string
  t: (key: FinanceKey) => string
}) {
  const rows = useMemo(() => {
    const slots: FinanceHourOfDayRow[] = Array.from({ length: 24 }, (_, localHour) => ({
      localHour,
      usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      costMicros: 0,
      peakCostMicros: 0,
      flatCostMicros: 0,
      shiftSavingsMicros: 0,
    }))
    for (const row of byHourOfDay) {
      if (Number.isInteger(row.localHour) && row.localHour >= 0 && row.localHour < 24) slots[row.localHour] = { ...row }
    }
    return slots
  }, [byHourOfDay])
  const [hover, setHover] = useState<number | null>(null)

  const plotW = HOD_W - HOD_PAD.left - HOD_PAD.right
  const plotH = HOD_H - HOD_PAD.top - HOD_PAD.bottom
  const baseY = HOD_PAD.top + plotH
  const yMax = niceCeil(Math.max(...rows.map(row => row.costMicros), 1))
  const slotW = plotW / 24
  const barW = Math.min(14, Math.max(4, slotW * 0.62))
  const xTicks = [0, 6, 12, 18, 23]
  const yTicks = Array.from({ length: 5 }, (_, i) => ({ value: yMax * i / 4, y: baseY - plotH * i / 4 }))

  let tip: ReactNode = null
  if (hover !== null && rows[hover].costMicros > 0) {
    const row = rows[hover]
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
        <text x={tx + 10} y={ty + 15} className={css.trendTipDate}>{String(row.localHour).padStart(2, '0')}:00</text>
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
        {xTicks.map(hour => (
          <g key={hour}>
            <line x1={HOD_PAD.left + (hour + 0.5) * slotW} y1={baseY} x2={HOD_PAD.left + (hour + 0.5) * slotW} y2={baseY + 4} className={css.trendGrid} />
            <text x={HOD_PAD.left + (hour + 0.5) * slotW} y={baseY + 18} textAnchor="middle" className={css.trendAxis}>{hour}</text>
          </g>
        ))}
        {rows.map((row, i) => {
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

  const modelRows = useMemo(() => buildBreakdown(ledger.byModel.map(row => {
    const parts = [
      `${t('tipInput')} ${formatTokens(row.usage.uncachedInputTokens)}`,
      `${t('tipOutput')} ${formatTokens(row.usage.outputTokens)}`,
    ]
    if ((row.shiftSavingsMicros ?? 0) > 0) {
      parts.push(`${t('shiftSavings')} ${formatMicros(row.shiftSavingsMicros ?? 0, ledger.currency)}`)
    }
    return {
      key: row.modelKey,
      label: row.modelKey,
      costMicros: row.costMicros,
      detail: parts.join(' · '),
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
    .map(row => ({ hour: String(row.localHour).padStart(2, '0'), savingsMicros: row.shiftSavingsMicros ?? 0 })),
  [ledger])

  // Peak/off-peak split donut: semantic hues per time band, zero-cost bands
  // omitted. The five buckets are disjoint and sum to the ledger total —
  // legacy (pre-window-era sessions) included, so the donut center stays the
  // full cost while peak/valley only covers the windowed era.
  const split = ledger.peakValley
  const legacyCost = split?.legacyCostMicros ?? 0
  const splitRows = useMemo(() => {
    if (split === undefined) return [] as BreakdownDatum[]
    const sources: BreakdownSource[] = []
    if (legacyCost > 0) sources.push({ key: 'legacy', label: t('legacySessions'), costMicros: legacyCost, color: LEGACY_COLOR })
    if (split.peakCostMicros > 0) sources.push({ key: 'peak', label: t('peakBand'), costMicros: split.peakCostMicros, color: PEAK_COLOR })
    if (split.offPeakCostMicros > 0) sources.push({ key: 'offpeak', label: t('offPeak'), costMicros: split.offPeakCostMicros, color: OFFPEAK_COLOR })
    if (split.flatCostMicros > 0) sources.push({ key: 'flat', label: t('flat'), costMicros: split.flatCostMicros, color: FLAT_COLOR })
    if (split.unclassifiedCostMicros > 0) sources.push({ key: 'unclassified', label: t('unclassified'), costMicros: split.unclassifiedCostMicros, color: OTHER_COLOR })
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

      {charts.gauge ? <BalanceGauge balance={balance} peak={peak} spentMicros={ledger.totalCostMicros} currency={ledger.currency} t={t} /> : null}

      {charts.kpis ? (
        <div className={css.kpis}>
          <KpiCard label={t('totalInput')} value={formatTokens(ledger.totals.uncachedInputTokens)} />
          <KpiCard label={t('totalOutput')} value={formatTokens(ledger.totals.outputTokens)} />
          <KpiCard label={t('sessions')} value={String(ledger.sessionCount)} />
          <KpiCard label={t('workspaces')} value={String(ledger.workspaceCount)} />
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
              <Donut rows={splitRows} currency={ledger.currency} ariaLabel={t('peakValleySplit')} t={t} />
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
              <HourOfDayChart byHourOfDay={ledger.byHourOfDay ?? []} split={split} currency={ledger.currency} t={t} />
            </section>
          ) : null}
        </div>
      ) : null}

      {charts.byModel || charts.byWorkspace || charts.byDay ? (
        <div className={css.grid}>
          {charts.byModel ? (
            <section className={css.card}>
              <div className={css.cardTitle}>{t('byModel')}</div>
              <div className={css.cardStats}>
                <span>{ledger.byModel.length} {t('modelCountUnit')}</span>
                <span>{t('trendTotal')} {formatMicros(ledger.totalCostMicros, ledger.currency)}</span>
              </div>
              <Donut rows={modelRows} currency={ledger.currency} ariaLabel={t('byModel')} t={t} />
            </section>
          ) : null}
          {charts.byWorkspace ? (
            <section className={css.card}>
              <div className={css.cardTitle}>{t('byWorkspace')}</div>
              <div className={css.cardStats}>
                <span>{ledger.byWorkspace.length} {t('workspaceCountUnit')}</span>
                <span>{t('trendTotal')} {formatMicros(ledger.totalCostMicros, ledger.currency)}</span>
              </div>
              <CostBars rows={workspaceRows} currency={ledger.currency} t={t} />
            </section>
          ) : null}
          {charts.byDay ? (
            <section className={css.cardWide}>
              <div className={css.cardTitle}>{t('byDay')}</div>
              <Trend ledger={ledger} t={t} />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
