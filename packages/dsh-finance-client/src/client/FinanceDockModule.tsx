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
  type DockModuleOwnerProps,
  type SnapshotSelectorHook,
} from 'dsh-spark-plugin-kit/client'
import { IconDollar } from 'dsh-ui-kit'
import { FinanceCard, type FinanceCardInjected } from './FinanceCard.tsx'
import { FinanceAuditController, type FinanceAuditState } from './controller.ts'
import type { FinanceAuditInjected } from './FinanceAuditSection.tsx'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
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
  ctx.effect(() => dispose, 'finance-client: dock module')
  return injected
}
