import { useEffect, useRef } from 'react'
import { cx } from '../cx.js'
import css from './Sparkline.module.css'

export interface SparklineProps {
  data: number[]
  /** 视口宽高（SVG viewBox，CSS 拉伸铺满容器） */
  width?: number
  height?: number
  /** 线色，默认品牌蓝 */
  color?: string
  /** 进入视口时描线生长动画（默认开；prefers-reduced-motion 自动跳过） */
  animated?: boolean
  /** hover 时同步数值到该回调（十字线联动外部数值显示） */
  onHoverValue?: (value: number | null) => void
  className?: string
  ariaLabel?: string
  /**
   * 未显式给 ariaLabel 时的可访问名（缺省 '趋势图'）。
   *
   * ui-kit 零 workspace 依赖、拿不到插件 locale，所以缺省值保留中文、由使用方传本地化文案。
   */
  defaultAriaLabel?: string
}

const PAD = 8

/** Spark UI Kit 迷你趋势线 — 品牌蓝渐变填充 + 描线生长 + hover 十字线 */
export function Sparkline({
  data,
  width = 560,
  height = 140,
  color = 'var(--spk-brand)',
  animated = true,
  onHoverValue,
  className,
  ariaLabel,
  defaultAriaLabel,
}: SparklineProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const lineRef = useRef<SVGPathElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    const line = lineRef.current
    if (!svg || !line || !animated) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) { svg.classList.add(css.drawn); return }

    const len = line.getTotalLength()
    line.style.strokeDasharray = String(len)
    line.style.strokeDashoffset = String(len)

    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          line.style.strokeDashoffset = '0'
          svg.classList.add(css.drawn)
        })
      })
    }, { threshold: 0.2 })
    io.observe(svg)
    return () => io.disconnect()
  }, [animated, data])

  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (width - PAD * 2)
    const y = height - PAD - ((v - min) / span) * (height - PAD * 2)
    return [x, y] as const
  })
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lastX, lastY] = pts[pts.length - 1]
  const gid = `sparkFill-${Math.round(width)}-${Math.round(height)}`

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onHoverValue) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1))))
    onHoverValue(data[idx])
  }

  return (
    <svg
      ref={svgRef}
      className={cx(css.spark, className)}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel ?? defaultAriaLabel ?? '趋势图'}
      onMouseMove={onMove}
      onMouseLeave={() => onHoverValue?.(null)}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          {/* 色值走 style：SVG presentation attribute 里的 var() 不可靠 */}
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.22 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path className={css.area} d={`${d} L${width - PAD} ${height - PAD} L${PAD} ${height - PAD} Z`} fill={`url(#${gid})`} />
      <path ref={lineRef} className={css.line} d={d} fill="none" style={{ stroke: color }} strokeWidth="2" strokeLinecap="round" pathLength={1} />
      <circle className={css.dot} cx={lastX} cy={lastY} r="3.5" style={{ fill: color, stroke: 'var(--spk-bg)' }} strokeWidth="2" />
    </svg>
  )
}
