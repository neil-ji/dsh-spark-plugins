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
import { createPlanSeam, type FinanceSettingsSection } from './plans.ts'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { FinanceBackfillStreamFrame } from 'dsh-spark-finance/types'
import type { FinanceKey } from './locales.ts'

/** 带占位符替换的取词（平台 Translate 同形：{name} 由第二参数替换）。 */
type FinanceT = (key: FinanceKey, params?: Record<string, string | number>) => string

export interface FinanceInjected {
  panel: FinancePanelInjected
}

/** 装配失败态的兜底取词：失败发生在能绑字典之前时，露出 key 而不是写死某种语言的文案。 */
const failT: FinanceT = (key) => String(key)

export interface FinanceInjectedFailed {
  failed: true
  /** 装配失败时仍带上字典取词，让失败态文案可被翻译。 */
  t?: FinanceT
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
    // 装配失败态也要本地化：文案本来就住在字典里（finance.setupFailed），
    // 以前这里绕开字典写了另一份中文（2026-09-17 英文语言验收抓到）。
    const t = props.t ?? failT
    return createElement('div', { className: 'dock-empty dock-embed-failed' }, t('setupFailed'))
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
  let disposeController: (() => void) | undefined
  // 模块 chrome 与失败态文案的取词（本包命名空间；与面板共用同一份字典）。
  const tr = ctx.locale.bind('settings.finance') as unknown as FinanceT
  try {
    const finance = ctx.reflect.get('remote.finance')
    if (finance === undefined) {
      injected = { failed: true, t: tr }
    } else {
      // P1：套餐（月费）走 settings 的 `finance.plans`——面板只读 + 行内写回，
      // 没有独立配置页；候选 provider 由账本里真正用过的厂商决定。
      const scope = ctx.settingsScope.bind({ namespace: 'finance' }) as SettingsScope<FinanceSettingsSection>
      const controller = new FinancePanelController(finance as ClientRemote['finance'], createPlanSeam(scope))
      disposeController = () => controller.dispose()
      const useSnapshot = bindSnapshotSelector(controller.store) as SnapshotSelectorHook<FinancePanelState>
      injected = {
        panel: {
          useSnapshot,
          t: tr as unknown as FinancePanelInjected['t'],
          refresh: (): void => { void controller.load() },
          refreshProvider: (provider: string): Promise<void> => controller.refreshProvider(provider),
          savePlan: (plan) => controller.savePlan(plan),
          removePlan: (provider) => controller.removePlan(provider),
  setBillingMode: (provider, mode) => controller.setBillingMode(provider, mode),
  tagPendingProvider: (provider, patch, plan) => controller.tagPendingProvider(provider, patch, plan),
  updatePrices: () => controller.updatePrices(),
  restorePrices: () => controller.restorePrices(),
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
    injected = { failed: true, t: tr }
  }
  const ready = injected
  const dispose = registerDockModule<FinanceDockInject>(ctx, {
    id: 'finance',
    order: 30,
    label: () => tr('dockLabel'),
    name: tr('dockName'),
    sub: tr('dockSub'),
    // 徽章整句（含标点）走字典：kit 不再拼死中文后缀。
    formatBadge: ({ count, label }) => ({
      label: tr('badgeLabel', { label, n: count }),
      title: tr('badgeTitle', { label, n: count }),
    }),
    icon: createElement(IconDollar, { size: 14 }),
    accent: 'var(--spk-acc-finance, #16a34a)',
    accentFg: 'var(--spk-acc-finance-fg, #166534)',
    inject: () => ready,
    Content: FinanceDockModule,
  })
  ctx.effect(() => () => {
    disposeStream?.()
    // 套餐设置订阅归控制器所有：卸载时一并释放。
    disposeController?.()
    dispose()
  }, 'finance-client: dock module + finance/events stream')
  return injected
}
