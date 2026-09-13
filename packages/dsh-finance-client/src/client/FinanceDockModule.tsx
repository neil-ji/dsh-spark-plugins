/**
 * 财务的 dock 模块（ADR-003）：本包自己装配注入面并注册进 dock 声明的
 * `spark.dock.module` 子槽 —— dock 不 import 本包的产物。
 *
 * 重建后模块内容只有一个面板（四个决策视图），没有配置面：注入面因此收敛为
 * `FinancePanelController` 一个快照源 + 取词 + 刷新 + 单 provider 余额刷新。
 */

import { createElement, type ReactNode } from 'react'
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import {
  bindSnapshotSelector,
  registerDockModule,
  subscribeFrames,
  type DockModuleOwnerProps,
  type SnapshotSelectorHook,
  type StreamRemote,
} from 'dsh-spark-plugin-kit/client'
import { IconDollar } from 'dsh-ui-kit'
import { FinancePanel, type FinancePanelInjected } from './FinancePanel.tsx'
import { FinancePanelController, type FinancePanelState } from './controller.ts'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { FinanceBackfillStreamFrame } from 'dsh-spark-finance/types'
import type { FinanceKey } from './locales.ts'

export interface FinanceInjected {
  panel: FinancePanelInjected
}

export interface FinanceInjectedFailed {
  failed: true
}

export type FinanceDockInject = FinanceInjected | FinanceInjectedFailed

const isReady = (injected: FinanceDockInject): injected is FinanceInjected => (injected as FinanceInjectedFailed).failed !== true

/**
 * 客户端侧的 finance 事件通道（`remote.finance.events()` 的客户端面）。
 *
 * 平台的两条规则（真宿主验收实测，与 dsh-hippomemo / dsh-spark 一致）：
 *  1. `remote.finance` 是本包 `$mount` 之后才存在的命名空间服务，**不能写进
 *     inject**（会死锁），只能 `ctx.reflect.get('remote.finance')`。
 *  2. `$stream` 在 `ctx.remote` 上，不需要命名空间。
 */
interface FinanceEventsFace {
  events(signal?: AbortSignal): AsyncIterable<FinanceBackfillStreamFrame>
}
interface FinanceEventChannel {
  readonly remote: StreamRemote
  readonly events: FinanceEventsFace
}
/** 逻辑流名：与宿主方法同名，kit 内部用它做引用计数复用键。 */
export const FINANCE_EVENTS_STREAM = 'finance/events'

function financeChannelOf(remote: StreamRemote, reflect: { get(id: string): unknown }): FinanceEventChannel | null {
  const namespace = reflect.get('remote.finance') as FinanceEventsFace | undefined
  if (namespace === undefined || namespace === null || typeof namespace.events !== 'function') return null
  return { remote, events: namespace }
}

/** 模块内容：dock 只在 variant === 'pane' 且本模块激活时渲染它。 */
export function FinanceDockModule(props: FinanceDockInject & DockModuleOwnerProps): ReactNode {
  if (!isReady(props)) {
    return createElement('div', { className: 'dock-empty dock-embed-failed' }, '财务模块装配失败：宿主未提供 remote.finance')
  }
  return createElement('div', { className: 'dock-embed' }, createElement(FinancePanel, props.panel))
}

/**
 * 装配财务的 dock 模块并注册进子槽（remote 挂载由调用方的 apply 负责）。
 * @param ctx - 插件 client 根上下文（`inject` 需含 slots / remote / locale）。
 */
export function startFinanceDockModule(ctx: ClientContext): FinanceDockInject {
  let injected: FinanceDockInject
  let disposeStream: (() => void) | undefined
  try {
    const finance = ctx.reflect.get('remote.finance')
    if (finance === undefined) {
      injected = { failed: true }
    } else {
      const controller = new FinancePanelController(finance as ClientRemote['finance'])
      const useSnapshot = bindSnapshotSelector(controller.store) as SnapshotSelectorHook<FinancePanelState>
      const t = ctx.locale.bind('settings.finance') as (key: FinanceKey) => string
      injected = {
        panel: {
          useSnapshot,
          t: t as FinancePanelInjected['t'],
          refresh: (): void => { void controller.load() },
          refreshProvider: (provider: string): Promise<void> => controller.refreshProvider(provider),
        },
      }

      // 首次回填进度走 finance/events typert stream（不轮询）。引用计数订阅归
      // UI 挂载层所有，卸载时 dispose。
      const channel = financeChannelOf(ctx.remote, ctx.reflect)
      if (channel !== null) {
        disposeStream = subscribeFrames<FinanceBackfillStreamFrame>(channel.remote, {
          name: FINANCE_EVENTS_STREAM,
          open: (signal) => channel.events.events(signal),
          kinds: ['progress'],
          onFrame: (frame) => {
            if (frame.kind === 'progress') controller.setProgress(frame.payload)
          },
        })
      } else {
        console.warn('[dsh-spark-finance-client] finance 事件通道不可用，面板将失去实时 backfill 进度')
      }
      void controller.load()
    }
  } catch (error) {
    console.warn('[dsh-spark-finance-client] finance remote 装配失败:', error)
    injected = { failed: true }
  }
  const ready = injected
  const dispose = registerDockModule<FinanceDockInject>(ctx, {
    id: 'finance',
    order: 30,
    label: () => '财务',
    name: '财务 Finance',
    sub: '花了多少 · 该用谁 · 怎么更省',
    icon: createElement(IconDollar, { size: 14 }),
    accent: 'var(--spk-acc-finance, #16a34a)',
    accentFg: 'var(--spk-acc-finance-fg, #166534)',
    inject: () => ready,
    Content: FinanceDockModule,
  })
  ctx.effect(() => () => {
    disposeStream?.()
    dispose()
  }, 'finance-client: dock module + finance/events stream')
  return injected
}
