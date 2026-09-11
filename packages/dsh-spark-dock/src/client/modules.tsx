/**
 * Dock 模块注册表（**过渡态**）：ADR-003 迁移期间 dock 仍自带 spark/hippo/github/finance
 * 四格的元数据；npm 已改为插件自注册（`dsh-connector-npm-ui` 的 `spark.dock.module`），
 * 由 DockOverlay 通过 `renderSlot` 渲染。四格陆续迁完后本文件删除。
 */
import type { ReactNode } from 'react'
import type { SparkEventChannel } from './spark/remote.ts'
import { SparksPane, ProposalsPane, ScriptsPane, GraphPane } from './spark/SparkModule.tsx'
import { FinanceEmbedPane } from './finance/FinanceEmbed.tsx'
import { HippoEmbedPane } from './hippo/HippoEmbed.tsx'
import { GithubEmbedPane } from './github/GithubEmbed.tsx'

export interface DockPane {
  id: string
  label: string
  /**
   * 渲染子页。`deps` 是 dock 通过插槽 inject 面下发的依赖（不再是模块级单例）：
   * 目前只有事件通道 `channel`；其余模块自带装配（后续 ADR-003 会一并收进贡献点）。
   */
  render: (deps: DockPaneDeps) => ReactNode
}

/** 子页依赖面（dock → 模块）。 */
export interface DockPaneDeps {
  channel: SparkEventChannel | null
}

export interface DockModule {
  id: string
  label: string
  name: string
  sub: string
  /** 模块强调色实色档（css color 值）：驱动指示条 / 计量条 / 图表等图形对象。 */
  accent: string
  /** 模块强调色的文字态档：驱动图标 / 胶囊文字 / 实底芯片，保证 AA 对比度。 */
  accentFg: string
  icon: ReactNode
  panes: DockPane[]
}

/* 模块图标：统一走 dsh-ui-kit 图标层（lucide），CSS `.dock-tab svg` 控制渲染尺寸。
 * 强调色经 currentColor 继承（tab active 态 color = --accent）。 */
import { IconDollar, IconGithub, IconSparkles, IconThink } from 'dsh-ui-kit'

const SparkIcon = () => <IconSparkles size={14} />
const HippoIcon = () => <IconThink size={14} />
const FinanceIcon = () => <IconDollar size={14} />
const GithubIcon = () => <IconGithub size={14} />

/** 子页占位（后续阶段逐个替换为真实数据渲染）。 */
const placeholder = (moduleLabel: string, paneLabel: string, phase: string) => () => (
  <div className="dock-empty">{moduleLabel} · {paneLabel} — 真实数据接入于 {phase}。</div>
)

/** spark：真实数据（dsh-spark http api + 统一事件流）。 */
const sparkPanes = [
  { id: 'sparks', label: '火花流', render: (deps: DockPaneDeps) => <SparksPane {...deps} /> },
  { id: 'proposals', label: '涌现提议', render: (deps: DockPaneDeps) => <ProposalsPane {...deps} /> },
  { id: 'scripts', label: '脚本目录', render: (deps: DockPaneDeps) => <ScriptsPane {...deps} /> },
  { id: 'graph', label: 'Graph', render: () => <GraphPane /> },
]

/** hippomemo：全功能内嵌官方 MemorySection（dock 取代设置页入口）。
 *  组件自带 4 tab 总览/记忆/偏好/进化 + CRUD + SSE，无需 dock 子页。 */
const hippoPanes = [
  { id: 'memories', label: '记忆', render: () => <HippoEmbedPane /> },
]

/**
 * 插件显示名规范化（2026-09 统一）：
 *   认知层三件套 = 「中文名 + 英文产品名」——火花 Spark / 记忆 HippoMemo / 财务 Finance；
 *   连接器 = 产品名的规范拼写本身——GitHub（大写 H）、npm（官方全小写）。
 * `label` 是左侧活动栏的 aria-label/title（窄，只放中文名或产品名），
 * `name` 是面板标题（完整显示名），`sub` 才是功能说明 —— 三者不要互相重复。
 */
export const DOCK_MODULES: DockModule[] = [
  {
    id: 'spark', label: '火花', name: '火花 Spark',
    sub: '手动捕获 · 结晶 · 涌现提议 · 脚本目录 · Graph',
    accent: 'var(--spk-acc-spark, #d97706)', accentFg: 'var(--spk-acc-spark-fg, #92400e)', icon: <SparkIcon />,
    panes: sparkPanes,
  },
  {
    id: 'hippomemo', label: '记忆', name: '记忆 HippoMemo',
    sub: '四脑区总览 · 记忆 CRUD · 我的偏好 · 进化引擎',
    accent: 'var(--spk-acc-hippomemo, #3b82f6)', accentFg: 'var(--spk-acc-hippomemo-fg, #1d4ed8)', icon: <HippoIcon />,
    panes: hippoPanes,
  },
  {
    id: 'finance', label: '财务', name: '财务 Finance',
    sub: '余额 · Token 用量与成本总览',
    accent: 'var(--spk-acc-finance, #16a34a)', accentFg: 'var(--spk-acc-finance-fg, #166534)', icon: <FinanceIcon />,
    // finance：全功能内嵌 FinanceCard，自带 4 页签（总览/连接/供应商/高级）
    // + 吸底保存行，无需 dock 子页。
    panes: [{ id: 'main', label: '总览', render: () => <FinanceEmbedPane /> }],
  },
  {
    id: 'github', label: 'GitHub', name: 'GitHub',
    sub: '令牌 · 操作权限 · Git 身份与代理',
    accent: 'var(--spk-acc-github, #8b5cf6)', accentFg: 'var(--spk-acc-github-fg, #5b21b6)', icon: <GithubIcon />,
    panes: [{ id: 'main', label: '连接', render: () => <GithubEmbedPane /> }],
  },
]
