/**
 * npm 的 dock 模块（ADR-003 / P3）：本包自己装配注入面，并注册进 dock 声明的
 * `spark.dock.module` 子槽 —— dock 不再 import 本包的 embed 产物。
 *
 * 装配口径与改造前 dock 内嵌版（`dsh-spark-dock/src/client/npm/NpmEmbed.tsx`）完全一致：
 * `$mount NPM_REMOTE_CONTRIBUTION` → `reflect.get('remote.npm')` → `NpmUiStore` +
 * `bindSnapshotSelector` + 凭据/设置失效推送。差别只是「谁拥有这段装配」——
 * 从 app 包（dock）搬回了插件自己。
 */
import { createElement, type ReactNode } from 'react'
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import {
  bindSnapshotSelector,
  registerDockModule,
  type DockModuleOwnerProps,
  type SnapshotSelectorHook,
} from 'dsh-spark-plugin-kit/client'
import { IconPackage } from 'dsh-ui-kit'
import { NpmSection } from './NpmSection.tsx'
import { NpmUiStore, type NpmUiState, type NpmNamespace } from './store.ts'
import type { NpmKey } from './locales.ts'

/** 装配成功的注入面。 */
export interface NpmInjected {
  controller: NpmUiStore
  useSnapshot: SnapshotSelectorHook<NpmUiState>
  t: (key: NpmKey) => string
}

/** 装配失败的注入面：面板显示明确的失败态，而不是永远转圈。 */
export interface NpmInjectedFailed {
  failed: true
}

export type NpmDockInject = NpmInjected | NpmInjectedFailed

const isReady = (injected: NpmDockInject): injected is NpmInjected => (injected as NpmInjectedFailed).failed !== true

/** 模块内容：dock 只在 variant === 'pane' 且本模块激活时渲染它。 */
export function NpmDockModule(props: NpmDockInject & DockModuleOwnerProps): ReactNode {
  if (!isReady(props)) {
    return createElement('div', { className: 'dock-empty dock-embed-failed' },
      'npm 连接模块装配失败：宿主未提供 remote.npm。重载插件或检查连接器宿主后重试。')
  }
  return createElement('div', { className: 'dock-embed dock-embed-connector' },
    createElement(NpmSection, { controller: props.controller, useSnapshot: props.useSnapshot, t: props.t }))
}

/**
 * 装配 npm 的 dock 模块：构造 store → 注册槽位。
 *
 * **不在这里 `$mount`**：remote 命名空间的挂载归插件自己 client 入口的 `apply()`
 * 负责（一次且仅一次）。真宿主上重复 `$mount` 同一 contribution 会抛
 * `direct method npm/status.get is already mounted`（实测），
 * 那正是评审 F6「同一命名空间被挂两次、靠容忍」的现场。
 *
 * @param ctx - 插件 client 根上下文（`inject` 必须含 `slots`）。
 * @returns 注入面（供调用方诊断；槽位注册的 disposer 由 ctx.effect 管理）。
 */
export async function startNpmDockModule(ctx: ClientContext): Promise<NpmDockInject> {
  let injected: NpmDockInject
  try {
    const npm = ctx.reflect.get('remote.npm') as NpmNamespace | undefined
    if (npm === undefined) {
      injected = { failed: true }
    } else {
      const controller = new NpmUiStore(ctx, npm)
      const useSnapshot = bindSnapshotSelector(controller.store)
      ctx.remote.$on('credentials/reference-updated', () => controller.refreshIfLoaded())
      ctx.remote.$on('settings/document-updated', () => controller.refreshIfLoaded())
      injected = { controller, useSnapshot, t: ctx.locale.bind('settings.npm') as (key: NpmKey) => string }
    }
  } catch (error) {
    console.warn('[dsh-connector-npm-ui] npm remote 装配失败:', error)
    injected = { failed: true }
  }

  const ready = injected
  const dispose = registerDockModule<NpmDockInject>(ctx, {
    id: 'npm',
    order: 50,
    label: () => ctx.locale.bind('settings.npm')('nav'),
    name: 'npm',
    sub: '细粒度 Token · 注册表与套件包状态',
    icon: createElement(IconPackage, { size: 14 }),
    accent: 'var(--spk-acc-npm, #cb3837)',
    accentFg: 'var(--spk-acc-npm-fg, #991b1b)',
    inject: () => ready,
    Content: NpmDockModule,
  })
  ctx.effect(() => dispose, 'npm-ui: dock module')
  return injected
}
