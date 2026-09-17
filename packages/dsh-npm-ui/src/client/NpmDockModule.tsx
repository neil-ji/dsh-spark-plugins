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

/** 带占位符替换的取词（平台 Translate 同形：{name} 由第二参数替换）。 */
type NpmTranslate = (key: NpmKey, params?: Record<string, string | number>) => string

/** 装配成功的注入面。 */
export interface NpmInjected {
  controller: NpmUiStore
  useSnapshot: SnapshotSelectorHook<NpmUiState>
  t: (key: NpmKey) => string
}

/** 装配失败的注入面：面板显示明确的失败态，而不是永远转圈。 */
/** 装配失败态的兜底取词：失败发生在能绑字典之前时，露出 key 而不是写死某种语言的文案。 */
const failT: NpmTranslate = (key) => String(key)

export interface NpmInjectedFailed {
  failed: true
  /** 装配失败时仍带上字典取词，让失败态文案可被翻译。 */
  t?: NpmTranslate
}

export type NpmDockInject = NpmInjected | NpmInjectedFailed

const isReady = (injected: NpmDockInject): injected is NpmInjected => (injected as NpmInjectedFailed).failed !== true

/** 模块内容：dock 只在 variant === 'pane' 且本模块激活时渲染它。 */
export function NpmDockModule(props: NpmDockInject & DockModuleOwnerProps): ReactNode {
  if (!isReady(props)) {
    // 装配失败态也要本地化（此前是硬编码中文；失败态是新用户最可能先看到的一屏）。
    const t = props.t ?? failT
    return createElement('div', { className: 'dock-empty dock-embed-failed' }, t('setupFailed'))
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
  // 模块 chrome 与失败态文案的取词（本包命名空间；与面板共用同一份字典）。
  const tr = ctx.locale.bind('settings.npm') as unknown as NpmTranslate
  try {
    const npm = ctx.reflect.get('remote.npm') as NpmNamespace | undefined
    if (npm === undefined) {
      injected = { failed: true, t: tr }
    } else {
      const controller = new NpmUiStore(ctx, npm)
      const useSnapshot = bindSnapshotSelector(controller.store)
      ctx.remote.$on('credentials/reference-updated', () => controller.refreshIfLoaded())
      ctx.remote.$on('settings/document-updated', () => controller.refreshIfLoaded())
      injected = { controller, useSnapshot, t: tr }
    }
  } catch (error) {
    console.warn('[dsh-connector-npm-ui] npm remote 装配失败:', error)
    injected = { failed: true, t: tr }
  }

  const ready = injected
  const dispose = registerDockModule<NpmDockInject>(ctx, {
    id: 'npm',
    order: 50,
    label: () => tr('dockLabel'),
    name: tr('dockName'),
    sub: tr('dockSub'),
    // 徽章整句（含标点）走字典：kit 不再拼死中文后缀。
    formatBadge: ({ count, label }) => ({
      label: tr('badgeLabel', { label, n: count }),
      title: tr('badgeTitle', { label, n: count }),
    }),
    icon: createElement(IconPackage, { size: 14 }),
    accent: 'var(--spk-acc-npm, #cb3837)',
    accentFg: 'var(--spk-acc-npm-fg, #991b1b)',
    inject: () => ready,
    Content: NpmDockModule,
  })
  ctx.effect(() => dispose, 'npm-ui: dock module')
  return injected
}
