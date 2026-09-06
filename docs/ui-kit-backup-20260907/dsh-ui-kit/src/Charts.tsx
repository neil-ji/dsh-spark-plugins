/**
 * Cordis-free chart primitives — SVG donut, horizontal bars and a line/area
 * trend, all self-drawn (no chart library), styled only through `--dsw-*`
 * tokens. Ported from the finance plugin's audit dashboard so any plugin can
 * reuse the same visual language.
 *
 * Every chart takes a generic value axis and a `formatValue` renderer, so
 * consumers decide how values are displayed (currency, tokens, counts, …).
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import css from './Charts.module.css'

/** Distinct hues per category; brand first, then complementary accents. */
export const CHART_PALETTE = [
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
export const OTHER_CHART_COLOR = '#65676b'

/** Round up to a clean axis maximum (1 / 2 / 2.5 / 5 × 10^n) so gridlines land on round values. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1
  const base = 10 ** Math.floor(Math.log10(value))
  const factor = value / base
  const step = factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 2.5 ? 2.5 : factor <= 5 ? 5 : 10
  return step * base
}

/** One slice / bar: a labelled value with an optional fixed hue and tooltip line. */
export interface ChartDatum {
  key: string
  label: string
  value: number
  /** Optional fixed hue; defaults to the palette by index. */
  color?: string | undefined
  /** Extra tooltip line (e.g. "cited 3"). */
  detail?: string | undefined
}

/** One trend point: a labelled value along an implicit time/sequence axis. */
export interface TrendPoint {
  key: string
  label: string
  value: number
  detail?: string | undefined
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
 * Shared hover state for the charts. Coordinates are measured relative to the
 * chart container (NOT the viewport) and the tooltip is absolutely positioned
 * inside it: position:fixed with viewport coords is broken when the surface
 * lives under a transformed ancestor.
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

/** Pointer-following tooltip shared by the donut and bar charts. */
function ChartTip({ label, valueText, percent, detail, x, y, w, h }: {
  label: string
  valueText: string
  percent: number
  detail?: string | undefined
  x: number
  y: number
  w: number
  h: number
}) {
  const width = 220
  const height = detail === undefined ? 52 : 72
  const left = Math.max(4, Math.min(x + 12, w - width - 4))
  const top = y - height - 12 >= 4 ? y - height - 12 : Math.max(4, Math.min(y + 16, h - height - 4))
  return (
    <div className={css.tip} role="tooltip" style={{ left, top }}>
      <div className={css.tipTitle}>{label}</div>
      <div className={css.tipValue}>{valueText} · {percent.toFixed(1)}%</div>
      {detail === undefined ? null : <div className={css.tipDetail}>{detail}</div>}
    </div>
  )
}

const DONUT_SIZE = 132
const DONUT_R = 50
const DONUT_STROKE = 17

export interface DonutChartProps {
  rows: readonly ChartDatum[]
  /** Formatted total shown in the hole. */
  centerValue: string
  centerLabel?: string | undefined
  ariaLabel: string
  formatValue: (value: number) => string
}

/**
 * SVG donut of a value breakdown: one ring segment per row in its own hue,
 * the total in the hole, hover tooltip, and a synced legend.
 */
export function DonutChart({ rows, centerValue, centerLabel, ariaLabel, formatValue }: DonutChartProps): ReactNode {
  const { hover, wrapRef, move, leave } = useChartHover()
  const center = DONUT_SIZE / 2
  const circumference = 2 * Math.PI * DONUT_R
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  let cursor = 0
  const segments = rows.map((row, i) => {
    const fraction = total === 0 ? 0 : row.value / total
    const segment = { ...row, color: row.color ?? CHART_PALETTE[i % CHART_PALETTE.length], start: cursor, fraction, percent: fraction * 100 }
    cursor += fraction
    return segment
  })

  if (rows.length === 0) return <div className={css.empty}>—</div>

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
          {centerValue}
        </text>
        {centerLabel === undefined ? null : (
          <text x={center} y={center + 13} textAnchor="middle" className={css.donutCenterLabel}>
            {centerLabel}
          </text>
        )}
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
            <span className={css.legendValue}>{formatValue(segment.value)}</span>
          </div>
        ))}
      </div>
      {hover === null ? null : (
        <ChartTip
          label={segments[hover.index].label}
          valueText={formatValue(segments[hover.index].value)}
          percent={segments[hover.index].percent}
          detail={segments[hover.index].detail}
          x={hover.x}
          y={hover.y}
          w={hover.w}
          h={hover.h}
        />
      )}
    </div>
  )
}

export interface BarChartProps {
  rows: readonly ChartDatum[]
  ariaLabel: string
  formatValue: (value: number) => string
  axisFormatter?: ((value: number) => string) | undefined
}

/**
 * Horizontal bar breakdown with a value axis and gridlines: bars scale to the
 * largest row, each carries its share and value, and hovering pops a tooltip.
 */
export function BarChart({ rows, ariaLabel, formatValue, axisFormatter }: BarChartProps): ReactNode {
  const { hover, wrapRef, move, leave } = useChartHover()
  const maxValue = rows.reduce((max, row) => Math.max(max, row.value), 0)
  const total = rows.reduce((sum, row) => sum + row.value, 0)

  if (rows.length === 0) return <div className={css.empty}>—</div>

  return (
    <div ref={wrapRef} className={css.bars} onPointerLeave={leave}>
      <div className={css.barsPlot}>
        <div className={css.barsGrid} aria-hidden="true">
          {[0.25, 0.5, 0.75].map(fraction => (
            <div key={fraction} className={css.barsGridLine} style={{ left: `${fraction * 100}%` }} />
          ))}
        </div>
        {rows.map((row, i) => {
          const percent = total === 0 ? 0 : row.value / total * 100
          return (
            <div
              key={row.key}
              className={hover !== null && hover.index !== i ? `${css.barRow} ${css.barRowDim}` : css.barRow}
              onPointerMove={move(i)}
            >
              <div className={css.barHead}>
                <span className={css.barLabel} title={row.label}>{row.label}</span>
                <span className={css.barMeta}>
                  <span className={css.barPercent}>{percent.toFixed(1)}%</span>
                  <span className={css.barValue}>{formatValue(row.value)}</span>
                </span>
              </div>
              <div className={css.barTrack}>
                <div
                  className={css.barFill}
                  style={{
                    width: `${maxValue === 0 ? 0 : Math.max(row.value / maxValue * 100, row.value === 0 ? 0 : 2)}%`,
                    background: row.color ?? CHART_PALETTE[i % CHART_PALETTE.length],
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
      {maxValue === 0 ? null : (
        <div className={css.barsAxis} aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map(fraction => (
            <span key={fraction} className={css.barsAxisLabel} style={{ left: `${fraction * 100}%` }}>
              {axisFormatter !== undefined ? axisFormatter(maxValue * fraction) : formatValue(maxValue * fraction)}
            </span>
          ))}
        </div>
      )}
      {hover === null ? null : (
        <ChartTip
          label={rows[hover.index].label}
          valueText={formatValue(rows[hover.index].value)}
          percent={total === 0 ? 0 : rows[hover.index].value / total * 100}
          detail={rows[hover.index].detail}
          x={hover.x}
          y={hover.y}
          w={hover.w}
          h={hover.h}
        />
      )}
    </div>
  )
}

const TREND_W = 640
const TREND_H = 220
const TREND_PAD = { top: 14, right: 10, bottom: 30, left: 50 }

export interface TrendChartProps {
  points: readonly TrendPoint[]
  ariaLabel: string
  formatValue: (value: number) => string
  /** Stable id for the area gradient (unique per chart instance). */
  gradientId: string
}

/**
 * Line + area trend over an implicit sequence axis (days, sessions, …).
 * Hovering pops the point's value and label; the peak point is emphasized.
 */
export function TrendChart({ points, ariaLabel, formatValue, gradientId }: TrendChartProps): ReactNode {
  const [hover, setHover] = useState<number | null>(null)

  const plotW = TREND_W - TREND_PAD.left - TREND_PAD.right
  const plotH = TREND_H - TREND_PAD.top - TREND_PAD.bottom
  const baseY = TREND_PAD.top + plotH

  const geometry = useMemo(() => {
    if (points.length < 2) return null
    const yMax = niceCeil(Math.max(...points.map(point => point.value), 1))
    const xs = points.map((_, i) => TREND_PAD.left + i / (points.length - 1) * plotW)
    const ys = points.map(point => baseY - point.value / yMax * plotH)
    const line = points.map((_, i) => `${xs[i]},${ys[i]}`).join(' ')
    const area = `M ${xs[0]},${baseY} L ${line} L ${xs[xs.length - 1]},${baseY} Z`
    let peakIndex = 0
    points.forEach((point, i) => { if (point.value > points[peakIndex].value) peakIndex = i })
    const yTicks = Array.from({ length: 5 }, (_, i) => ({ value: yMax * i / 4, y: baseY - plotH * i / 4 }))
    const labelCount = Math.min(5, points.length)
    const xTicks = [...new Set(Array.from({ length: labelCount }, (_, i) => Math.round((points.length - 1) * i / (labelCount - 1))))]
    return { xs, ys, line, area, yMax, peakIndex, yTicks, xTicks }
  }, [points])

  if (geometry === null) return <div className={css.empty}>—</div>

  const { xs, ys, line, area, peakIndex, yTicks, xTicks } = geometry

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
        <text x={tx + 10} y={ty + 15} className={css.trendTipDate}>{points[hover].label}</text>
        <text x={tx + 10} y={ty + 30} className={css.trendTipValue}>{formatValue(points[hover].value)}</text>
      </g>
    )
  }

  return (
    <svg className={css.trend} viewBox={`0 0 ${TREND_W} ${TREND_H}`} role="img" aria-label={ariaLabel}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--dsw-static-deepseek-500)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--dsw-static-deepseek-500)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map(tick => (
        <g key={tick.value}>
          <line x1={TREND_PAD.left} y1={tick.y} x2={TREND_W - TREND_PAD.right} y2={tick.y} className={css.trendGrid} />
          <text x={TREND_PAD.left - 8} y={tick.y + 3.5} textAnchor="end" className={css.trendAxis}>
            {formatValue(tick.value)}
          </text>
        </g>
      ))}
      <line x1={TREND_PAD.left} y1={baseY} x2={TREND_W - TREND_PAD.right} y2={baseY} className={css.trendAxisBase} />
      {xTicks.map(index => (
        <g key={index}>
          <line x1={xs[index]} y1={baseY} x2={xs[index]} y2={baseY + 4} className={css.trendGrid} />
          <text x={xs[index]} y={baseY + 18} textAnchor="middle" className={css.trendAxis}>
            {points[index].label}
          </text>
        </g>
      ))}
      <path d={area} className={css.trendArea} style={{ fill: `url(#${gradientId})` }} />
      <polyline points={line} className={css.trendLine} fill="none" vectorEffect="non-scaling-stroke" />
      {xs.map((x, i) => (
        <circle
          key={points[i].key}
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
          const index = Math.round((px - TREND_PAD.left) / plotW * (points.length - 1))
          setHover(Math.max(0, Math.min(points.length - 1, index)))
        }}
        onPointerLeave={() => setHover(null)}
      />
    </svg>
  )
}
