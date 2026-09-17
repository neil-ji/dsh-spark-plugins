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

export interface GithubInjectedFailed {
  failed: true
}

export type GithubDockInject = GithubInjected | GithubInjectedFailed

const isReady = (injected: GithubDockInject): injected is GithubInjected => (injected as GithubInjectedFailed).failed !== true

/** 模块内容：dock 只在 variant === 'pane' 且本模块激活时渲染它。 */
export function GithubDockModule(props: GithubDockInject & DockModuleOwnerProps): ReactNode {
  if (!isReady(props)) {
    return createElement('div', { className: 'dock-empty dock-embed-failed' },
      'GitHub 连接模块装配失败：宿主未提供 remote.github。重载插件或检查连接器宿主后重试。')
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
  try {
    const github = ctx.reflect.get('remote.github') as GithubNamespace | undefined
    if (github === undefined) {
      injected = { failed: true }
    } else {
      const controller = new GithubSettingsStore(ctx, github)
      const useSnapshot = bindSnapshotSelector(controller.store)
      ctx.remote.$on('credentials/reference-updated', () => controller.refreshIfLoaded())
      ctx.remote.$on('settings/document-updated', () => controller.refreshIfLoaded())
      injected = { controller, useSnapshot, t: ctx.locale.bind('settings.github') as GithubTranslate }
    }
  } catch (error) {
    console.warn('[dsh-connector-github-ui] github remote 装配失败:', error)
    injected = { failed: true }
  }
  const ready = injected
  const dispose = registerDockModule<GithubDockInject>(ctx, {
    id: 'github',
    order: 40,
    label: () => 'GitHub',
    name: 'GitHub',
    sub: '令牌 · 操作权限 · Git 身份与代理',
    icon: createElement(IconGithub, { size: 14 }),
    accent: 'var(--spk-acc-github, #8b5cf6)',
    accentFg: 'var(--spk-acc-github-fg, #5b21b6)',
    inject: () => ready,
    Content: GithubDockModule,
  })
  ctx.effect(() => dispose, 'github-ui: dock module')
  return injected
}
