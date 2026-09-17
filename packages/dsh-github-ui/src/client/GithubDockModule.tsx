/**
 * GitHub 的 dock 模块（ADR-003）：本包自己装配注入面并注册进 dock 声明的
 * `spark.dock.module` 子槽 —— dock 不再 import 本包的 embed 产物。
 *
 * 装配口径与改造前 dock 内嵌版（`dsh-spark-dock/src/client/github/GithubEmbed.tsx`）
 * 完全一致：`$mount` 由本包 client 入口的 `apply()` 负责（一次），这里只负责
 * `reflect` 取命名空间 → `GithubSettingsStore` + `bindSnapshotSelector` → 失效推送。
 */
import { createElement, type ReactNode } from 'react'
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import {
  bindSnapshotSelector,
  registerDockModule,
  type DockModuleOwnerProps,
  type SnapshotSelectorHook,
} from 'dsh-spark-plugin-kit/client'
import { IconGithub } from 'dsh-ui-kit'
import { GithubSection } from './GithubSection.tsx'
import { GithubSettingsStore, type GithubNamespace, type GithubSettingsState } from './store.ts'
import type { GithubTranslate } from './locales.ts'

export interface GithubInjected {
  controller: GithubSettingsStore
  useSnapshot: SnapshotSelectorHook<GithubSettingsState>
  t: GithubTranslate
}

/** 装配失败态的兜底取词：失败发生在能绑字典之前时，露出 key 而不是写死某种语言的文案。 */
const failT: GithubTranslate = (key) => String(key)

export interface GithubInjectedFailed {
  failed: true
  /** 装配失败时仍带上字典取词，让失败态文案可被翻译。 */
  t?: GithubTranslate
}

export type GithubDockInject = GithubInjected | GithubInjectedFailed

const isReady = (injected: GithubDockInject): injected is GithubInjected => (injected as GithubInjectedFailed).failed !== true

/** 模块内容：dock 只在 variant === 'pane' 且本模块激活时渲染它。 */
export function GithubDockModule(props: GithubDockInject & DockModuleOwnerProps): ReactNode {
  if (!isReady(props)) {
    // 装配失败态也要本地化（此前是硬编码中文；失败态是新用户最可能先看到的一屏）。
    const t = props.t ?? failT
    return createElement('div', { className: 'dock-empty dock-embed-failed' }, t('setupFailed'))
  }
  return createElement('div', { className: 'dock-embed dock-embed-connector' },
    createElement(GithubSection, { controller: props.controller, useSnapshot: props.useSnapshot, t: props.t }))
}

/**
 * 装配 GitHub 的 dock 模块并注册进子槽（remote 挂载由调用方的 apply 负责）。
 * @param ctx - 插件 client 根上下文（`inject` 需含 slots / remote / remote.credentials）。
 */
export function startGithubDockModule(ctx: ClientContext): GithubDockInject {
  let injected: GithubDockInject
  // 模块 chrome 与失败态文案的取词（本包命名空间；与面板共用同一份字典）。
  const tr = ctx.locale.bind('settings.github') as GithubTranslate
  try {
    const github = ctx.reflect.get('remote.github') as GithubNamespace | undefined
    if (github === undefined) {
      injected = { failed: true, t: tr }
    } else {
      const controller = new GithubSettingsStore(ctx, github)
      const useSnapshot = bindSnapshotSelector(controller.store)
      ctx.remote.$on('credentials/reference-updated', () => controller.refreshIfLoaded())
      ctx.remote.$on('settings/document-updated', () => controller.refreshIfLoaded())
      injected = { controller, useSnapshot, t: tr }
    }
  } catch (error) {
    console.warn('[dsh-connector-github-ui] github remote 装配失败:', error)
    injected = { failed: true, t: tr }
  }
  const ready = injected
  const dispose = registerDockModule<GithubDockInject>(ctx, {
    id: 'github',
    order: 40,
    label: () => tr('dockLabel'),
    name: tr('dockName'),
    sub: tr('dockSub'),
    // 徽章整句（含标点）走字典：kit 不再拼死中文后缀。
    formatBadge: ({ count, label }) => ({
      label: tr('badgeLabel', { label, n: count }),
      title: tr('badgeTitle', { label, n: count }),
    }),
    icon: createElement(IconGithub, { size: 14 }),
    accent: 'var(--spk-acc-github, #8b5cf6)',
    accentFg: 'var(--spk-acc-github-fg, #5b21b6)',
    inject: () => ready,
    Content: GithubDockModule,
  })
  ctx.effect(() => dispose, 'github-ui: dock module')
  return injected
}
