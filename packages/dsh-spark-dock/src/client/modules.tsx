/**
 * Dock 模块注册表：每个插件模块声明 icon/强调色/子页。
 * Phase 2 先落框架与占位内容；Phase 3+ 各模块接入真实数据源
 * （原则：dock 不写业务，只消费各包已导出的 client api / 组件）。
 */
import type { ReactNode } from 'react'
import { SparksPane, ProposalsPane, ScriptsPane, GraphPane } from './spark/SparkModule.tsx'
import { FinanceEmbedPane } from './finance/FinanceEmbed.tsx'
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

/* 模块图标：统一走 dsh-ui-kit 图标层（lucide），CSS `.dock-tab svg` 控制渲染尺寸。
 * 强调色经 currentColor 继承（tab active 态 color = --accent）。 */
import { IconDollar, IconGithub, IconPackage, IconSparkles, IconThink } from 'dsh-ui-kit'

const SparkIcon = () => <IconSparkles size={14} />
const HippoIcon = () => <IconThink size={14} />
const FinanceIcon = () => <IconDollar size={14} />
const GithubIcon = () => <IconGithub size={14} />
const NpmIcon = () => <IconPackage size={14} />

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
    // finance：全功能内嵌 FinanceCard，自带 4 页签（总览/连接/供应商/高级）
    // + 吸底保存行，无需 dock 子页。
    panes: [{ id: 'main', label: '总览', render: () => <FinanceEmbedPane /> }],
  },
  {
    id: 'github', label: 'GitHub', name: 'GitHub 连接',
    sub: '令牌 · 操作权限 · Git 身份与代理',
    accent: 'var(--acc-github, #8b5cf6)', icon: <GithubIcon />,
    panes: [{ id: 'main', label: '连接', render: () => <GithubEmbedPane /> }],
  },
  {
    id: 'npm', label: 'npm', name: 'npm 发布',
    sub: '细粒度 Token · 注册表与套件包状态',
    accent: 'var(--acc-npm, #cb3837)', icon: <NpmIcon />,
    panes: [{ id: 'main', label: '发布', render: () => <NpmEmbedPane /> }],
  },
]
