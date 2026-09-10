/**
 * Npm embed: renders the FULL dsh-npm-ui settings section inside the dock
 * panel（定位：dock 完全取代设置页入口）。装配方式同 GithubEmbed：
 * 容错 mount NPM_REMOTE_CONTRIBUTION → NpmUiStore + bindSnapshotSelector →
 * credentials seam 推送失效。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { bindSnapshotSelector, type SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import {
  NPM_REMOTE_CONTRIBUTION,
  NpmSection,
  NpmUiStore,
  type NpmKey,
  type NpmUiState,
} from 'dsh-connector-npm-ui/embed'

interface NpmInjected {
  controller: NpmUiStore
  useSnapshot: SnapshotSelectorHook<NpmUiState>
  t: (key: NpmKey) => string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let injected: NpmInjected | undefined
let started = false
let failed = false
const listeners = new Set<() => void>()

/** 由 client 入口在 apply 时调用：异步装配注入面，完成后通知 pane 重渲染。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function startNpmEmbed(ctx: any): void {
  if (started) return
  started = true
  void Promise.resolve(ctx.remote.$mount(NPM_REMOTE_CONTRIBUTION)).catch(() => {
    // 原 npm-ui 插件同场加载时已 mount 过同一 contribution → 直接复用
  }).then(() => {
    const npm = ctx.reflect.get('remote.npm')
    if (npm === undefined) {
      failed = true // 连接器宿主未加载：pane 显示明确的失败态（区别于加载中）
      for (const l of listeners) l()
      return
    }
    const controller = new NpmUiStore(ctx, npm)
    const useSnapshot = bindSnapshotSelector(controller.store)
    injected = { controller, useSnapshot, t: ctx.locale.bind('settings.npm') }
    ctx.remote.$on('credentials/reference-updated', () => controller.refreshIfLoaded())
    ctx.remote.$on('settings/document-updated', () => controller.refreshIfLoaded())
    for (const l of listeners) l()
  }).catch((err: unknown) => {
    console.warn('[dsh-spark-dock] npm remote mount failed:', err)
  })
}

export function NpmEmbedPane(): ReactNode {
  const [, bump] = useState(0)
  useEffect(() => {
    function remount(): void { bump((n) => n + 1) }
    listeners.add(remount)
    return () => { listeners.delete(remount) }
  }, [])
  if (injected === undefined) {
    return failed
      ? <div className="dock-empty dock-embed-failed">npm 连接模块装配失败：宿主未提供 remote.npm。重载插件或检查连接器宿主后重试。</div>
      : <div className="dock-empty"><span className="dock-spin" aria-hidden="true" /> npm 连接模块加载中…</div>
  }
  return (
    <div className="dock-embed dock-embed-connector">
      <NpmSection controller={injected.controller} useSnapshot={injected.useSnapshot} t={injected.t} />
    </div>
  )
}
