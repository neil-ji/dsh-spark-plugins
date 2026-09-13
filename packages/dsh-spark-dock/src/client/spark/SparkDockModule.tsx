/**
 * Spark 的 dock 模块（ADR-003）：spark 的功能 UI 一直住在 dock 包里（原
 * `modules.tsx` 的表格 + `DockOverlay` 的 SegmentedControl），现在改成和其它插件
 * **完全同一条路径**：dock 在自己的 apply 里用 `registerDockModule` 注册，
 * 元数据（图标/强调色/标题）与子页切换都归模块自己。
 *
 * 2026-09-14：文案全部改走 `spark.dock` locale 字典（此前是硬编码中文，违反
 * AGENTS.md §3.4）；取词函数由 dock 的 apply 绑定一次后经注入面下发。
 */
import { createElement, useState, type ReactNode } from 'react'
import { IconSparkles, SegmentedControl } from 'dsh-ui-kit'
import {
  publishAnnouncement,
  registerDockModule,
  subscribeFrames,
  type ClientContext,
  type DockModuleOwnerProps,
} from 'dsh-spark-plugin-kit/client'
import type { SparkChangedEvent, SparkStreamFrame } from 'dsh-spark-wire'
import { GraphPane, ProposalsPane, ScriptsPane, SparksPane } from './SparkModule.tsx'
import { SPARK_EVENTS_STREAM, type SparkEventChannel } from './remote.ts'
import type { SparkT } from './locales.ts'

/** 模块的注入面：统一事件流通道 + 取词函数（apply 里装配好后下发）。 */
export interface SparkModuleInject {
  channel: SparkEventChannel | null
  t: SparkT
}

const PANES = [
  { id: 'sparks', key: 'paneSparks' },
  { id: 'proposals', key: 'paneProposals' },
  { id: 'scripts', key: 'paneScripts' },
  { id: 'graph', key: 'paneGraph' },
] as const

/** 子页切换由模块自己持有（dock 不再为任何模块渲染子页条）。 */
export function SparkDockModule(props: SparkModuleInject & DockModuleOwnerProps): ReactNode {
  const [paneId, setPaneId] = useState<string>(PANES[0].id)
  const { channel, t } = props
  return createElement('div', { className: 'dock-embed' },
    createElement(SegmentedControl, {
      fullWidth: true,
      ariaLabel: t('moduleName'),
      options: PANES.map((pane) => ({ value: pane.id, label: t(pane.key) })),
      value: paneId,
      onChange: setPaneId,
    }),
    paneId === 'sparks' ? createElement(SparksPane, { channel, t })
      : paneId === 'proposals' ? createElement(ProposalsPane, { channel, t })
        : paneId === 'scripts' ? createElement(ScriptsPane, { channel, t })
          : createElement(GraphPane, { t })
  )
}

/**
 * spark 自己的播报（F7：**文案归模块**，dock 的 fairy 层不再含任何插件字符串）。
 *
 * 订阅统一事件流把 `sparks/changed` 翻成气泡文案；`sparks` 主题的帧由 wire 的
 * `SparkStreamFrame` 描述（类型与 zod 校验都在 `dsh-spark-wire`）。
 *
 * 这里**故意不做「只订阅一次」的闩锁**：闩锁 + effect 重跑（channel 身份变化）会
 * 出现「先退订、再拒绝重订」的悬空状态 —— 悬浮球从此收不到任何事件（预览走查抓到）。
 * 生命周期交给 kit 的引用计数：同名的逻辑流只开一条，最后一个订阅者离开才关闭。
 * @param channel - dock 组装好的 spark 事件通道（`$stream` + 命名空间）。
 * @param t - 取词函数（`spark.dock` 命名空间）。
 * @returns disposer。
 */
export function startSparkAnnouncements(channel: SparkEventChannel, t: SparkT): () => void {
  return subscribeFrames<SparkStreamFrame>(channel.remote, {
    name: SPARK_EVENTS_STREAM,
    open: (signal) => channel.events.events(signal),
    kinds: ['spark'],
    onFrame: (frame) => { if (frame.kind === 'spark') announceSparkChange(frame.payload, t) },
  })
}

/** `sparks/changed` → 播报（纯文本 + 情绪）。 */
function announceSparkChange(payload: SparkChangedEvent, t: SparkT): void {
  if (payload.operation === 'capture') {
    publishAnnouncement({ mood: 'happy', text: t('announceCapture'), src: 'Spark · capture' })
  } else if (payload.operation === 'crystallize') {
    publishAnnouncement({ mood: 'cheer', text: t('announceCrystallize'), src: 'Spark · crystallize' })
  } else if (payload.operation === 'delete') {
    publishAnnouncement({ mood: 'think', text: t('announceDrop'), src: 'Spark · delete' })
  } else if (payload.operation === 'restore') {
    publishAnnouncement({ mood: 'happy', text: t('announceRestore'), src: 'Spark · restore' })
  }
}

/**
 * 注册 Spark 的 dock 模块。
 * @param ctx - dock 的 client 根上下文。
 * @param inject - 注入面（事件通道 + 取词函数；apply 里已装配好）。
 */
export function registerSparkDockModule(ctx: ClientContext, inject: SparkModuleInject): void {
  const dispose = registerDockModule<SparkModuleInject>(ctx, {
    id: 'spark',
    order: 10,
    label: () => inject.t('moduleLabel'),
    name: inject.t('moduleName'),
    sub: inject.t('moduleSub'),
    icon: createElement(IconSparkles, { size: 14 }),
    accent: 'var(--spk-acc-spark, #d97706)',
    accentFg: 'var(--spk-acc-spark-fg, #92400e)',
    inject: () => inject,
    Content: SparkDockModule,
  })
  ctx.effect(() => dispose, 'spark-dock: spark module')
}
