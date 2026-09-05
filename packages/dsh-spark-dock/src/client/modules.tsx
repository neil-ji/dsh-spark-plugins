/**
 * Dock 模块注册表：每个插件模块声明 icon/强调色/子页。
 * Phase 2 先落框架与占位内容；Phase 3+ 各模块接入真实数据源
 * （原则：dock 不写业务，只消费各包已导出的 client api / 组件）。
 */
import type { ReactNode } from 'react'
import { SparksPane, ProposalsPane, ScriptsPane, GraphPane } from './spark/SparkModule.tsx'
import { FinancePane } from './finance/FinanceModule.tsx'
import { HippoEmbedPane } from './hippo/HippoEmbed.tsx'
import { GithubEmbedPane } from './github/GithubEmbed.tsx'
import { NpmEmbedPane } from './npm/NpmEmbed.tsx'

export interface DockPane {
  id: string
  label: string
  render: () => ReactNode
}

export interface DockModule {
  id: string
  label: string
  name: string
  sub: string
  /** 模块强调色（css color 值），驱动 tab 激活态与面板内 pill。 */
  accent: string
  icon: ReactNode
  panes: DockPane[]
}

/* 16px 线性图标（与 demo 对齐，stroke=currentColor 以吃强调色） */
const stroke = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {d.split('|').map((seg, i) => <path key={i} d={seg} strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>
)

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.6c.7 5.2 4.2 8.7 9.4 9.4-5.2.7-8.7 4.2-9.4 9.4-.7-5.2-4.2-8.7-9.4-9.4 5.2-.7 8.7-4.2 9.4-9.4z" />
  </svg>
)
const HippoIcon = () => stroke('M8.9 8.4 11 15.1|M15.1 8.4 13 15.1|M7 9.4V17|M17 9.4V17')
const FinanceIcon = () => stroke('M12 7.6v8.8|M9 8.5c0-.6 1.3-1 3-1s3 .4 3 1-1.2.9-3 1.2-3 .7-3 1.3 1.2 1 3 1 3-.4 3-1|M12 7.6v1.4|M12 15.2v1.2')
const GithubIcon = () => stroke('M6 8.4v7.2|M18 11.4c0 2-1 3.2-2.4 3.8|M6 12c1.8 0 3.6.8 5.4 2.4')
const NpmIcon = () => stroke('M12 3 21 8.2v7.6L12 21 3 15.8V8.2 12 3z|M3 8.2l9 5.2 9-5.2|M12 13.4V21')

/** 子页占位（后续阶段逐个替换为真实数据渲染）。 */
const placeholder = (moduleLabel: string, paneLabel: string, phase: string) => () => (
  <div className="dock-empty">{moduleLabel} · {paneLabel} — 真实数据接入于 {phase}。</div>
)

/** spark：真实数据（dsh-spark http api）。 */
const sparkPanes = [
  { id: 'sparks', label: '火花流', render: () => <SparksPane /> },
  { id: 'proposals', label: '涌现提议', render: () => <ProposalsPane /> },
  { id: 'scripts', label: '脚本目录', render: () => <ScriptsPane /> },
  { id: 'graph', label: 'Graph', render: () => <GraphPane /> },
]

/** hippomemo：全功能内嵌官方 MemorySection（dock 取代设置页入口）。
 *  组件自带 4 tab 总览/记忆/偏好/进化 + CRUD + SSE，无需 dock 子页。 */
const hippoPanes = [
  { id: 'memories', label: '记忆', render: () => <HippoEmbedPane /> },
]

export const DOCK_MODULES: DockModule[] = [
  {
    id: 'spark', label: '火花', name: '火花流 Sparks',
    sub: '手动捕获 · 结晶 · 涌现提议 · 脚本目录 · Graph',
    accent: 'var(--acc-spark, #f59e0b)', icon: <SparkIcon />,
    panes: sparkPanes,
  },
  {
    id: 'hippomemo', label: '记忆', name: '记忆 HippoMemo',
    sub: '四脑区总览 · 记忆 CRUD · 我的偏好 · 进化引擎',
    accent: 'var(--acc-hippomemo, #3b82f6)', icon: <HippoIcon />,
    panes: hippoPanes,
  },
  {
    id: 'finance', label: '成本', name: '财务审计 Finance',
    sub: '余额 · Token 用量与成本总览',
    accent: 'var(--acc-finance, #22c55e)', icon: <FinanceIcon />,
    panes: [{ id: 'main', label: '总览', render: () => <FinancePane /> }],
  },
  {
    id: 'github', label: 'GitHub', name: 'GitHub 连接',
    sub: '令牌 · 操作权限 · Git 身份与代理',
    accent: 'var(--acc-github, #8b5cf6)', icon: <GithubIcon />,
    panes: [{ id: 'main', label: '连接', render: () => <GithubEmbedPane /> }],
  },
  {
    id: 'npm', label: 'npm', name: 'npm 发布',
    sub: 'granular token · 注册表与套件包状态',
    accent: 'var(--acc-npm, #cb3837)', icon: <NpmIcon />,
    panes: [{ id: 'main', label: '发布', render: () => <NpmEmbedPane /> }],
  },
]
