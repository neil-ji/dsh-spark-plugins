import type { ReactNode } from 'react'
import { cx } from '../cx.js'
import css from './Charts.module.css'

/** 图表调色板 — 五模块 accent + 补充色相（全部 ≥3:1 图形对比度），索引循环取色 */
export const CHART_PALETTE = [
  'var(--spk-acc-hippomemo)',
  'var(--spk-acc-finance)',
  'var(--spk-acc-spark)',
  'var(--spk-acc-github)',
  'var(--spk-acc-npm)',
  'var(--spk-chart-alt-1)',
  'var(--spk-chart-alt-2)',
  'var(--spk-chart-alt-3)',
] as const

/** 「其他」聚合切片的弱化色 */
export const OTHER_CHART_COLOR = 'var(--spk-label-3)'

/** 轴最大值取整（1 / 2 / 2.5 / 5 × 10^n），让网格线落在整数上 */
export function niceCeil(value: number): number {
  if (value <= 0) return 1
  const base = 10 ** Math.floor(Math.log10(value))
  const factor = value / base
  const step = factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 2.5 ? 2.5 : factor <= 5 ? 5 : 10
  return step * base
}

/** 一个切片 / 一根条：带标签的数值，可固定色相与附加说明 */
export interface ChartDatum {
  key: string
  label: string
  value: number
  color?: string | undefined
  detail?: string | undefined
}

/** 趋势线上的一个点 */
export interface TrendPoint {
  key: string
  label: string
  value: number
  detail?: string | undefined
}

function sliceColor(rows: readonly ChartDatum[], i: number): string {
  return rows[i].color ?? (rows[i].key === '__other__' ? OTHER_CHART_COLOR : CHART_PALETTE[i % CHART_PALETTE.length])
}

/* ── DonutChart ── */

export interface DonutChartProps {
  rows: ChartDatum[]
  centerValue: ReactNode
  centerLabel: ReactNode
  ariaLabel: string
  formatValue: (value: number) => string
  className?: string
}

/** 环图 — SVG dasharray 扇区 + 中心数值 + 图例列表 */
export function DonutChart({ rows, centerValue, centerLabel, ariaLabel, formatValue, className }: DonutChartProps): ReactNode {
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  const R = 15.9155 // 周长 ≈ 100，方便直接用百分比 dasharray
  let acc = 0

  return (
    <div className={cx(css.donutWrap, className)}>
      <svg viewBox="0 0 42 42" role="img" aria-label={ariaLabel} className={css.donutSvg}>
        <circle className={css.donutTrack} cx="21" cy="21" r={R} fill="none" />
        {total > 0 && rows.map((row, i) => {
          const pct = (row.value / total) * 100
          const dash = `${pct} ${100 - pct}`
          const offset = 25 - acc
          acc += pct
          return (
            <circle
              key={row.key}
              className={css.donutSlice}
              cx="21" cy="21" r={R} fill="none"
              /* 色值走 style 而不是 presentation attribute：SVG 属性里的 var()
                 解析在规范与实现上都不受保证（W3C SVGWG #987/#1031），
                 写 style 才一定能拿到 --spk-* 的解析结果。 */
              style={{ stroke: sliceColor(rows, i) }}
              strokeWidth="5.5"
              strokeDasharray={dash}
              strokeDashoffset={offset}
            >
              <title>{`${row.label}: ${formatValue(row.value)}${row.detail ? ` · ${row.detail}` : ''}`}</title>
            </circle>
          )
        })}
        <text className={css.donutValue} x="21" y="20.5" textAnchor="middle">{centerValue}</text>
        <text className={css.donutLabel} x="21" y="26.5" textAnchor="middle">{centerLabel}</text>
      </svg>
      <ul className={css.legend}>
        {rows.map((row, i) => (
          <li key={row.key} className={css.legendItem}>
            <span className={css.legendDot} style={{ background: sliceColor(rows, i) }} aria-hidden="true" />
            <span className={css.legendLabel} title={row.detail}>{row.label}</span>
            <span className={css.legendValue}>{formatValue(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── BarChart ── */

export interface BarChartProps {
  rows: ChartDatum[]
  ariaLabel: string
  formatValue: (value: number) => string
  /** 轴刻度格式（如货币符号前缀紧凑形） */
  axisFormatter?: (value: number) => string
  className?: string
}

/** 横向条形图 — label 左 / 条中 / 数值右，条长按 niceCeil 归一 */
export function BarChart({ rows, ariaLabel, formatValue, axisFormatter, className }: BarChartProps): ReactNode {
  const max = niceCeil(Math.max(...rows.map((r) => r.value), 1))
  return (
    <div role="img" aria-label={ariaLabel} className={cx(css.barWrap, className)}>
      {rows.map((row, i) => (
        <div key={row.key} className={css.barRow} title={`${row.label}: ${formatValue(row.value)}${row.detail ? ` · ${row.detail}` : ''}`}>
          <span className={css.barLabel}>{row.label}</span>
          <span className={css.barTrack}>
            <span
              className={css.barFill}
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: sliceColor(rows, i) }}
            />
          </span>
          <span className={css.barValue}>{axisFormatter ? axisFormatter(row.value) : formatValue(row.value)}</span>
        </div>
      ))}
    </div>
  )
}

/* ── TrendChart ── */

export interface TrendChartProps {
  points: TrendPoint[]
  ariaLabel: string
  formatValue: (value: number) => string
  /** SVG 渐变 id（同页多实例需互不相同） */
  gradientId: string
  className?: string
}

const TW = 560
const TH = 150
const TP = 10

/** 趋势面积图 — 渐变填充 + 末端点 + 稀疏 x 轴标签 */
export function TrendChart({ points, ariaLabel, formatValue, gradientId, className }: TrendChartProps): ReactNode {
  if (points.length < 2) return null
  const max = niceCeil(Math.max(...points.map((p) => p.value), 1))
  const xy = points.map((p, i) => {
    const x = TP + (i / (points.length - 1)) * (TW - TP * 2)
    const y = TH - TP - (p.value / max) * (TH - TP * 2)
    return { x, y, p }
  })
  const d = xy.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const last = xy[xy.length - 1]
  const labelEvery = Math.max(1, Math.ceil(points.length / 6))

  return (
    <div className={cx(css.trendWrap, className)}>
      <svg viewBox={`0 0 ${TW} ${TH + 16}`} role="img" aria-label={ariaLabel} className={css.trendSvg} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--spk-brand)', stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: 'var(--spk-brand)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <line className={css.trendAxis} x1={TP} y1={TH - TP} x2={TW - TP} y2={TH - TP} />
        <path className={css.trendArea} d={`${d} L${(TW - TP).toFixed(1)} ${TH - TP} L${TP} ${TH - TP} Z`} fill={`url(#${gradientId})`} />
        <path className={css.trendLine} d={d} fill="none" />
        <circle className={css.trendDot} cx={last.x} cy={last.y} r="3" />
        {xy.map(({ x, p }, i) => (
          i % labelEvery === 0 || i === xy.length - 1
            ? <text key={p.key} className={css.trendTick} x={x} y={TH + 12} textAnchor={i === 0 ? 'start' : i === xy.length - 1 ? 'end' : 'middle'}>{p.label}</text>
            : null
        ))}
        {xy.map(({ x, y, p }) => (
          <circle key={`h-${p.key}`} className={css.trendHit} cx={x} cy={y} r="8">
            <title>{`${p.label}: ${formatValue(p.value)}${p.detail ? ` · ${p.detail}` : ''}`}</title>
          </circle>
        ))}
      </svg>
      <span className={css.trendMax}>{formatValue(max)}</span>
    </div>
  )
}

/* ── StackedBar ── */

export interface StackedBarProps {
  /** 按顺序堆叠的切片；值为 0 的片段不渲染（但保留在 totals 里）。 */
  rows: ChartDatum[]
  ariaLabel: string
  /** 每片悬浮文案（默认 `label: value`）。 */
  formatValue: (value: number) => string
  className?: string
}

/**
 * 100% 堆叠条 —— **条本体占满容器宽度**，宽度按各片占比分配。
 *
 * 与 `BarChart` 的区别（为什么不是同一种图）：
 *  - `BarChart` 是"每项一根独立条 + 按 niceCeil 归一"，用于**跨项比大小**；
 *    归一化会让最大项不满宽（实测 10.34 → 上取整到 20 → 只占 52%），
 *    这在"看构成"的场景反而是错的信号。
 *  - 本组件用于**看构成**：总和恒为 100%，占比关系直接由物理宽度表达，
 *    最小片用 minWidth 兜底保证可见（否则 0.5% 的片等于消失）。
 *
 * 因此两者不是替换关系：比大小用 BarChart，看构成用 StackedBar。
 */
export function StackedBar({ rows, ariaLabel, formatValue, className }: StackedBarProps): ReactNode {
  const visible = rows.filter((row) => row.value > 0)
  const total = visible.reduce((sum, row) => sum + row.value, 0)
  if (visible.length === 0 || total <= 0) return null
  return (
    <div role="img" aria-label={ariaLabel} className={cx(css.stackedWrap, className)}>
      <div className={css.stackedTrack}>
        {visible.map((row, index) => (
          <span
            key={row.key}
            className={css.stackedSlice}
            style={{ width: `${(row.value / total) * 100}%`, background: sliceColor(visible, index) }}
            title={`${row.label}: ${formatValue(row.value)}${row.detail === undefined ? '' : ` · ${row.detail}`}`}
            data-testid={`stacked-slice-${row.key}`}
          />
        ))}
      </div>
      <ul className={css.stackedLegend}>
        {visible.map((row, index) => (
          <li key={row.key} className={css.legendItem}>
            <span className={css.legendDot} style={{ background: sliceColor(visible, index) }} />
            <span className={css.legendLabel}>{row.label}</span>
            <span className={css.legendValue}>{formatValue(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
