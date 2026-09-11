/**
 * Spark 的 dock 模块（ADR-003）：spark 的功能 UI 一直住在 dock 包里（原
 * `modules.tsx` 的表格 + `DockOverlay` 的 SegmentedControl），现在改成和其它插件
 * **完全同一条路径**：dock 在自己的 apply 里用 `registerDockModule` 注册，
 * 元数据（图标/强调色/标题）与子页切换都归模块自己。
 *
 * 这样 `modules.tsx` 的编译期模块表可以整体删除，dock 侧只剩「声明子槽 + 渲染三个位」。
 */
import { createElement, useState, type ReactNode } from 'react'
import { IconSparkles, SegmentedControl } from 'dsh-ui-kit'
import { registerDockModule, type ClientContext, type DockModuleOwnerProps } from 'dsh-spark-plugin-kit/client'
import { GraphPane, ProposalsPane, ScriptsPane, SparksPane } from './SparkModule.tsx'
import type { SparkEventChannel } from './remote.ts'

/** 模块的注入面：统一事件流通道（apply 里装配好后下发）。 */
export interface SparkModuleInject {
  channel: SparkEventChannel | null
}

const PANES = [
  { id: 'sparks', label: '火花流' },
  { id: 'proposals', label: '涌现提议' },
  { id: 'scripts', label: '脚本目录' },
  { id: 'graph', label: 'Graph' },
] as const

/** 子页切换由模块自己持有（dock 不再为任何模块渲染子页条）。 */
export function SparkDockModule(props: SparkModuleInject & DockModuleOwnerProps): ReactNode {
  const [paneId, setPaneId] = useState<string>(PANES[0].id)
  const channel = props.channel
  return createElement('div', { className: 'dock-embed' },
    createElement(SegmentedControl, {
      fullWidth: true,
      ariaLabel: '火花 Spark 子页',
      options: PANES.map((pane) => ({ value: pane.id, label: pane.label })),
      value: paneId,
      onChange: setPaneId,
    }),
    paneId === 'sparks' ? createElement(SparksPane, { channel })
      : paneId === 'proposals' ? createElement(ProposalsPane, { channel })
        : paneId === 'scripts' ? createElement(ScriptsPane, { channel })
          : createElement(GraphPane))
}

/**
 * 注册 Spark 的 dock 模块。
 * @param ctx - dock 的 client 根上下文。
 * @param inject - 注入面（事件通道；apply 里已 mount 描述符）。
 */
export function registerSparkDockModule(ctx: ClientContext, inject: SparkModuleInject): void {
  const dispose = registerDockModule<SparkModuleInject>(ctx, {
    id: 'spark',
    order: 10,
    label: () => '火花',
    name: '火花 Spark',
    sub: '手动捕获 · 结晶 · 涌现提议 · 脚本目录 · Graph',
    icon: createElement(IconSparkles, { size: 14 }),
    accent: 'var(--spk-acc-spark, #d97706)',
    accentFg: 'var(--spk-acc-spark-fg, #92400e)',
    inject: () => inject,
    Content: SparkDockModule,
  })
  ctx.effect(() => dispose, 'spark-dock: spark module')
}
