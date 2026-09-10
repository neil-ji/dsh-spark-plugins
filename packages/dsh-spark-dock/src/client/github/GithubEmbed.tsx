/**
 * Github embed: renders the FULL dsh-github-ui settings section inside the
 * dock panel (定位：dock 完全取代设置页入口).
 *
 * 依赖装配（原 github-ui apply 的内嵌版）：
 *  - ctx.remote.$mount(GITHUB_REMOTE_CONTRIBUTION) 完成后才能取 remote.github；
 *  - GithubSettingsStore(ctx, github) + bindSnapshotSelector 构造注入面；
 *  - token 保存走 credential seam（remote.credentials），与设置页无关。
 * mount 是异步的，完成前 GithubSection 按 Partial props 返回 null →
 * 本组件显示加载态。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { bindSnapshotSelector, type SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import {
  GITHUB_REMOTE_CONTRIBUTION,
  GithubSection,
  GithubSettingsStore,
  type GithubKey,
  type GithubSettingsState,
} from 'dsh-connector-github-ui/embed'

interface GithubInjected {
  controller: GithubSettingsStore
  useSnapshot: SnapshotSelectorHook<GithubSettingsState>
  t: (key: GithubKey) => string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let injected: GithubInjected | undefined
let started = false
let failed = false
const listeners = new Set<() => void>()

/** 由 client 入口在 apply 时调用：异步装配注入面，完成后通知 pane 重渲染。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function startGithubEmbed(ctx: any): void {
  if (started) return
  started = true
  void Promise.resolve(ctx.remote.$mount(GITHUB_REMOTE_CONTRIBUTION)).catch(() => {
    // 原 github-ui 插件同场加载时已 mount 过同一 contribution → 直接复用
  }).then(() => {
    // mounted namespace 是动态 cordis 服务（remote.github），走 reflect 读取
    const github = ctx.reflect.get('remote.github')
    if (github === undefined) {
      failed = true // 连接器宿主未加载：pane 显示明确的失败态（区别于加载中）
      for (const l of listeners) l()
      return
    }
    const controller = new GithubSettingsStore(ctx, github)
    const useSnapshot = bindSnapshotSelector(controller.store)
    injected = { controller, useSnapshot, t: ctx.locale.bind('settings.github') }
    // 与原设置页一致的推送失效
    ctx.remote.$on('credentials/reference-updated', () => controller.refreshIfLoaded())
    ctx.remote.$on('settings/document-updated', () => controller.refreshIfLoaded())
    for (const l of listeners) l()
  }).catch((err: unknown) => {
    console.warn('[dsh-spark-dock] github remote mount failed:', err)
  })}

export function GithubEmbedPane(): ReactNode {
  const [, bump] = useState(0)
  useEffect(() => {
    const off = (): void => { listeners.delete(remount) }
    function remount(): void { bump((n) => n + 1) }
    listeners.add(remount)
    return off
  }, [])
  if (injected === undefined) {
    return failed
      ? <div className="dock-empty dock-embed-failed">GitHub 连接模块装配失败：宿主未提供 remote.github。重载插件或检查连接器宿主后重试。</div>
      : <div className="dock-empty"><span className="dock-spin" aria-hidden="true" /> GitHub 连接模块加载中…</div>
  }
  return (
    <div className="dock-embed dock-embed-connector">
      <GithubSection controller={injected.controller} useSnapshot={injected.useSnapshot} t={injected.t} />
    </div>
  )
}
