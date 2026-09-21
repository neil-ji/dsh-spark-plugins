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
import { ProposalsPane, SparksPane } from './SparkModule.tsx'
import { GraphPane } from './GraphPane.tsx'
import { SPARK_EVENTS_STREAM, type SparkEventChannel } from './remote.ts'
import type { SparkDockLocaleKey, SparkT } from './locales.ts'

/** 本包模块取词签名（`spark.dock` 命名空间，支持 {n} / {label} 占位符）。 */
type SparkTranslate = (key: SparkDockLocaleKey, params?: Record<string, string | number>) => string

export interface SparkModuleInject {
  channel: SparkEventChannel | null
  t: SparkT
}

const PANES = [
  { id: 'sparks', key: 'paneSparks' },
  { id: 'proposals', key: 'paneProposals' },
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
 *
 * 2026-09-16 加徽章 + 动态 sub：模块内部维护一份 stats（订阅 `spark/events` 帧触发
 * reload），把 `pending + pendingProposals` 暴露给面板标题行的 sub（角标已退役）。
 * 计数取自 `/sparks/stats`（与 SparksPane 同源），事件驱动刷新而非轮询。
 *
 * @param ctx - dock 的 client 根上下文。
 * @param inject - 注入面（事件通道 + 取词函数；apply 里已装配好）。
 */
export function registerSparkDockModule(ctx: ClientContext, inject: SparkModuleInject): void {
  // 模块内的 stats store：所有 tab 渲染都从这里读，确保 sub 与 tab 数字同源。
  let pending = 0
  let pendingProposals = 0
  const loadStats = (): void => {
    fetch('/sparks/stats', { headers: { accept: 'application/json' } })
      .then((res) => res.ok ? res.json() as Promise<{ ok: boolean; value?: { pending?: number; pendingProposals?: number } }> : null)
      .then((body) => {
        if (body === null || body.ok !== true || body.value === undefined) return
        pending = typeof body.value.pending === 'number' ? body.value.pending : 0
        pendingProposals = typeof body.value.pendingProposals === 'number' ? body.value.pendingProposals : 0
      })
      .catch(() => { /* 接口暂未注册视为 0 */ })
  }
  loadStats()
  // channel 可用时订阅事件流；事件触发时再 reload stats，与 dock ball 共用一条流。
  if (inject.channel !== null) {
    const stopStatsRefresh = subscribeFrames<SparkStreamFrame>(inject.channel.remote, {
      name: SPARK_EVENTS_STREAM,
      open: (signal) => inject.channel!.events.events(signal),
      kinds: ['spark', 'proposal', 'ready'],
      onFrame: () => loadStats(),
      onReady: () => loadStats(),
    })
    ctx.effect(() => stopStatsRefresh, 'spark-dock: stats refresh subscription')
  }
  // 模块取词（含带占位符的形式）：label 仍是闭包，name/sub 在注册时求值（原形制）。
  const tm = inject.t as unknown as SparkTranslate
  const dispose = registerDockModule<SparkModuleInject>(ctx, {
    id: 'spark',
    order: 10,
    label: () => inject.t('moduleLabel'),
    name: inject.t('moduleName'),
    // 动态 sub：把待处理数拼到副标题里，让面板标题行也传达"有几条等你处理"。
    // 0 条时回退到静态描述（不显示 N=0）。
    sub: (() => {
      const total = pending + pendingProposals
      if (total === 0) return tm('moduleSub')
      return createElement('span', null,
        tm('moduleSub'),
        ' · ',
        createElement('strong', { 'data-pending': String(pending), 'data-proposals': String(pendingProposals) },
          tm('pendingLabel', { n: total })),
      )
    })(),
    icon: createElement(IconSparkles, { size: 14 }),
    accent: 'var(--spk-acc-spark, #d97706)',
    accentFg: 'var(--spk-acc-spark-fg, #92400e)',
    inject: () => inject,
    Content: SparkDockModule,
  })
  ctx.effect(() => dispose, 'spark-dock: spark module')
}
