/**
 * Graph 子页：火花关联图（标签亲和 / 涌现提议关联）—— 纯火花域（v2 P10/E5）。
 *
 * 分工：**口径全在宿主**（`dsh-spark/src/graph.ts` 的 buildSparkGraph），
 * 客户端只拿 nodes/edges 画图 —— 关联判定不在 UI 里重算（与窗口归因同一原则）。
 *
 * 布局：确定性力导向（Fruchterman-Reingold 变体，固定迭代次数、初始位置由 id
 * 哈希决定）—— 同数据同画面，不用 Math.random（否则每次渲染抖动，也没法验收）。
 * 无第三方依赖：节点上限 60（宿主默认），迭代 260 次的代价可以忽略。
 *
 * 视觉：节点颜色取 ui-kit token（按火花状态），边按语义分两档线型；
 * 悬浮/键盘聚焦出 tooltip 看全文标题。
 */
import { useMemo, useState } from 'react'
import { Card } from 'dsh-ui-kit'
import type { SparkGraph, SparkGraphNode } from 'dsh-spark-wire'
import { api } from './sparkApi.ts'
import { useApiResource } from './useApiResource.ts'
import type { SparkT } from './locales.ts'

const WIDTH = 720
const HEIGHT = 420
const PADDING = 28
const ITERATIONS = 260

interface Placed extends SparkGraphNode {
  x: number
  y: number
  r: number
}

/** 稳定伪随机：id 哈希 → [0,1)。用于初始环形摆放，保证同数据同布局。 */
function hash01(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

function layout(graph: SparkGraph): Placed[] {
  const nodes = graph.nodes
  const n = nodes.length
  if (n === 0) return []
  const cx = WIDTH / 2
  const cy = HEIGHT / 2
  const radius = Math.min(WIDTH, HEIGHT) / 2 - PADDING
  const pos = nodes.map((node, i) => {
    // 初始沿圆环摆开 + 哈希抖动：环形保证均匀，抖动打破对称僵局。
    const angle = (i / n) * Math.PI * 2 + hash01(node.id) * 0.6
    return { x: cx + Math.cos(angle) * radius * 0.9, y: cy + Math.sin(angle) * radius * 0.9 }
  })
  const index = new Map(nodes.map((node, i) => [node.id, i]))
  const links = graph.edges
    .map((edge) => ({ a: index.get(edge.source), b: index.get(edge.target), w: edge.weight }))
    .filter((link): link is { a: number; b: number; w: number } => link.a !== undefined && link.b !== undefined)

  const area = (WIDTH - PADDING * 2) * (HEIGHT - PADDING * 2)
  const k = Math.sqrt(area / n)
  let temperature = WIDTH / 8
  const cooling = temperature / (ITERATIONS + 1)

  for (let step = 0; step < ITERATIONS; step += 1) {
    const dispX = new Array<number>(n).fill(0)
    const dispY = new Array<number>(n).fill(0)
    // 斥力：所有节点两两相推。
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = pos[i]!.x - pos[j]!.x
        let dy = pos[i]!.y - pos[j]!.y
        let dist = Math.hypot(dx, dy)
        if (dist < 0.01) { dx = 0.01; dy = 0.01; dist = 0.01 }
        const force = (k * k) / dist
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        dispX[i]! += fx; dispY[i]! += fy
        dispX[j]! -= fx; dispY[j]! -= fy
      }
    }
    // 引力：有边的节点互拉，权重越高越紧。
    for (const link of links) {
      let dx = pos[link.a]!.x - pos[link.b]!.x
      let dy = pos[link.a]!.y - pos[link.b]!.y
      let dist = Math.hypot(dx, dy)
      if (dist < 0.01) { dx = 0.01; dy = 0.01; dist = 0.01 }
      const force = ((dist * dist) / k) * Math.min(3, link.w)
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      dispX[link.a]! -= fx; dispY[link.a]! -= fy
      dispX[link.b]! += fx; dispY[link.b]! += fy
    }
    for (let i = 0; i < n; i += 1) {
      const len = Math.hypot(dispX[i]!, dispY[i]!) || 1
      const step_ = Math.min(len, temperature)
      pos[i]!.x += (dispX[i]! / len) * step_
      pos[i]!.y += (dispY[i]! / len) * step_
      // 边界收敛（不硬夹，避免节点贴边成一条线）。
      pos[i]!.x = Math.max(PADDING, Math.min(WIDTH - PADDING, pos[i]!.x))
      pos[i]!.y = Math.max(PADDING, Math.min(HEIGHT - PADDING, pos[i]!.y))
    }
    temperature -= cooling
  }

  return nodes.map((node, i) => ({
    ...node,
    x: pos[i]!.x,
    y: pos[i]!.y,
    // 尺寸由宿主给的度决定：孤立点也看得见，枢纽点明显更大。
    r: Math.min(18, 5 + node.degree * 1.1),
  }))
}

/** 边按语义分两档线型（与图例一一对应）。 */
const EDGE_CLASS: Record<SparkGraph['edges'][number]['kind'], string> = {
  tag: 'dock-graph-edge dock-graph-edge-tag',
  proposal: 'dock-graph-edge dock-graph-edge-proposal',
  derived: 'dock-graph-edge dock-graph-edge-derived',
}

/** 节点按状态上色。 */
function stateClass(node: SparkGraphNode): string {
  if (node.status === 'archived') return 'dock-graph-node-archived'
  return 'dock-graph-node-active'
}

export function GraphPane({ t }: { t: SparkT }): JSX.Element {
  const { data, error, reload } = useApiResource<SparkGraph>(() => api.graph(), [])
  const [active, setActive] = useState<string | null>(null)

  const placed = useMemo(() => (data === null ? [] : layout(data)), [data])
  const byId = useMemo(() => new Map(placed.map((node) => [node.id, node])), [placed])

  const sparkCount = data === null ? 0 : data.nodes.length
  const edgeCount = data === null ? 0 : data.edges.length

  return (
    <Card
      title={t('graphTitle')}
      actions={(
        <>
          <span className={'dock-hint dock-graph-summary'}>
            {`${String(sparkCount)} ${t('graphUnitSparks')} · ${String(edgeCount)} ${t('graphUnitLinks')}`}
          </span>
          <button className={'dock-pill dock-graph-refresh'} type="button" onClick={reload}>{t('graphRefresh')}</button>
        </>
      )}
    >
      {error !== null ? <p className={'dock-graph-error'} role="alert">{t('graphErrorPrefix')}: {error}</p> : null}
      {data === null && error === null ? <p className={'dock-hint dock-graph-empty'}>{t('loading')}</p> : null}
      {data !== null && data.edges.length === 0 ? (
        <p className={'dock-hint dock-graph-empty'}>{t('graphNoLinks')}</p>
      ) : null}
      {placed.length > 0 ? (
        <div className={'dock-graph-wrap'}>
          <svg
            className={'dock-graph-svg'}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${t('graphTitle')}: ${String(sparkCount)} ${t('graphUnitSparks')} · ${String(edgeCount)} ${t('graphUnitLinks')}`}
          >
            {data?.edges.map((edge) => {
              const a = byId.get(edge.source)
              const b = byId.get(edge.target)
              if (a === undefined || b === undefined) return null
              return (
                <line
                  key={edge.kind + edge.source + edge.target}
                  className={EDGE_CLASS[edge.kind]}
                  data-edge={edge.kind}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  strokeWidth={edge.kind === 'tag' ? Math.min(2.4, 0.8 + edge.weight * 0.5) : 1.6}
                />
              )
            })}
            {placed.map((node) => (
              <g
                key={node.id}
                className={'dock-graph-node'}
                data-node={node.kind}
                data-node-id={node.id}
                tabIndex={0}
                aria-label={node.label}
                onMouseEnter={() => setActive(node.id)}
                onMouseLeave={() => setActive((current) => (current === node.id ? null : current))}
                onFocus={() => setActive(node.id)}
                onBlur={() => setActive((current) => (current === node.id ? null : current))}
              >
                <circle className={stateClass(node)} cx={node.x} cy={node.y} r={node.r} />
                {active === node.id ? (
                  <text className={'dock-graph-tip'} x={node.x} y={node.y - node.r - 6} textAnchor="middle">
                    {node.label.slice(0, 34)}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
          <ul className={'dock-graph-legend'}>
            <li><i className={'dock-graph-dot dock-graph-dot-active'} />{t('graphLegendActive')}</li>
            <li><i className={'dock-graph-dot dock-graph-dot-archived'} />{t('graphLegendArchived')}</li>
            <li><i className={'dock-graph-line dock-graph-line-tag'} />{t('graphLegendTagEdge')}</li>
            <li><i className={'dock-graph-line dock-graph-line-proposal'} />{t('graphLegendProposalEdge')}</li>
            <li><i className={'dock-graph-line dock-graph-line-derived'} />{t('graphLegendDerivedEdge')}</li>
          </ul>
          {data?.truncated === true ? <p className={'dock-hint dock-graph-empty'}>{t('graphTruncated')}</p> : null}
        </div>
      ) : null}
    </Card>
  )
}
