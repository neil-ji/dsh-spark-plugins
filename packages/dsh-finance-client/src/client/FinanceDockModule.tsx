/**
 * 财务的 dock 模块（ADR-003）：本包自己装配注入面并注册进 dock 声明的
 * `spark.dock.module` 子槽 —— dock 不再 import 本包的 embed 产物。
 *
 * 装配口径与改造前 dock 内嵌版（`dsh-spark-dock/src/client/finance/FinanceEmbed.tsx`）
 * 完全一致：`$mount(remote.finance)` 由本包 client 入口的 `apply()` 负责（一次），
 * 这里负责 `FinanceAuditController` + `FinanceCardController`（`settingsScope('finance')`）
 * → 拼装 `FinanceCard` 的注入面。内嵌页自带 4 个页签与吸底保存行，模块内容不再包壳。
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
import { FinanceCard, type FinanceCardInjected } from './FinanceCard.tsx'
import { FinanceAuditController, type FinanceAuditState } from './controller.ts'
import type { FinanceAuditInjected } from './FinanceAuditSection.tsx'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { FinanceBackfillStreamFrame } from 'dsh-spark-finance/types'
import { FinanceCardController, type FinanceRemote } from './FinanceCardController.ts'
import type { FinanceKey } from './locales.ts'

export interface FinanceInjected {
  card: FinanceCardInjected & FinanceAuditInjected
}

export interface FinanceInjectedFailed {
  failed: true
}

export type FinanceDockInject = FinanceInjected | FinanceInjectedFailed

const isReady = (injected: FinanceDockInject): injected is FinanceInjected => (injected as FinanceInjectedFailed).failed !== true

/**
 * 客户端侧的 finance 事件通道（`remote.finance.events()` 的客户端面）。
 *
 * 平台的两条规则（真宿主验收实测，与 dsh-hippomemo / dsh-spark 完全一致）：
 *
 *  1. `remote.finance` 是本包 `$mount` 之后才存在的命名空间服务，**不能写
 *     进 inject**（会死锁），只能 `ctx.reflect.get('remote.finance')`。
 *  2. `$stream` 在 `ctx.remote` 上，不需要命名空间。
 *
 * 所以下方的 `financeChannelOf` 一次组装 `{ $stream 拥有者 + 命名空间 }`
 * 两件东西，再交给 `subscribeFrames` 引用计数订阅 —— 同一个逻辑流名
 * `finance/events` 只占一条物理载波。
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
function financeChannelOf(
  remote: StreamRemote,
  reflect: { get(id: string): unknown },
): FinanceEventChannel | null {
  const namespace = reflect.get('remote.finance') as FinanceEventsFace | undefined
  if (namespace === undefined || namespace === null || typeof namespace.events !== 'function') return null
  return { remote, events: namespace }
}

/** 模块内容：dock 只在 variant === 'pane' 且本模块激活时渲染它。 */
export function FinanceDockModule(props: FinanceDockInject & DockModuleOwnerProps): ReactNode {
  if (!isReady(props)) {
    return createElement('div', { className: 'dock-empty dock-embed-failed' },
      '财务审计模块装配失败：宿主未提供 remote.finance。重载插件或检查宿主后重试。')
  }
  return createElement('div', { className: 'dock-embed' },
    // embedded：dock 模块头已给出「财务 Finance + 一句话说明」，
    // 总览仪表盘自己的大标题/副标题不再渲染（而不是渲染后 CSS 压掉）。
    createElement(FinanceCard, { ...props.card, embedded: true }))
}

/**
 * 装配财务的 dock 模块并注册进子槽（remote 挂载由调用方的 apply 负责）。
 * @param ctx - 插件 client 根上下文（`inject` 需含 slots / remote / settingsScope）。
 */
export function startFinanceDockModule(ctx: ClientContext): FinanceDockInject {
  let injected: FinanceDockInject
  let disposeStream: (() => void) | undefined
  try {
    const finance = ctx.reflect.get('remote.finance')
    if (finance === undefined) {
      injected = { failed: true }
    } else {
      const controller = new FinanceAuditController(finance as ClientRemote['finance'])
      const useSnapshot = bindSnapshotSelector(controller.store) as SnapshotSelectorHook<FinanceAuditState>
      const t = ctx.locale.bind('settings.finance') as (key: FinanceKey) => string
      const refresh = (): void => { void controller.load() }
      const refreshProvider = (provider: string): Promise<void> => controller.refreshProvider(provider)

      const cardController = new FinanceCardController(
        ctx.settingsScope.bind({ namespace: 'finance' }),
        finance as unknown as FinanceRemote,
      )
      cardController.ensureAutoSync()
      const cardFace = cardController.inject()
      const cardInjected: FinanceCardInjected = {
        ...cardFace,
        useFinanceCard: bindSnapshotSelector(cardFace.hooks.financeCard) as FinanceCardInjected['useFinanceCard'],
        dashboardRefresh: refresh,
        refreshProvider,
        useSnapshot,
      }
      injected = { card: { ...cardInjected, useSnapshot, t, refresh, refreshProvider } }

      // F11 commit: subscribe to the `finance/events` typert stream so the
      // dashboard's loading UI gets live backfill progress instead of
      // polling `finance/getBackfillProgress` every 600 ms. The stream's
      // `subscribeFrames` is reference-counted on the kit side, so even
      // though we only have one consumer today, future panes that want
      // the same notifications share the same physical carrier.
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
        console.warn('[dsh-spark-finance-client] finance 事件通道不可用，dashboard 将失去实时 backfill 进度')
      }
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
    sub: '余额 · Token 用量与成本总览',
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
