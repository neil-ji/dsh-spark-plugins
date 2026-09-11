/**
 * dsh-spark-plugin-kit client：五个插件的客户端公共层。
 *
 * 2026-09 起插件功能 UI 只走 dsh-spark-dock 悬浮球（`shell.overlay` 插槽），
 * 设置页入口（`settings.section`）与 `settings.plugin.item` 配置卡随退役世代
 * `dsh-spark-ui` 一并删除 —— 本包因此不再提供插槽注册样板，只保留三件事：
 *
 * - `injectPluginStyle`：插件级 CSS 幂等注入（dock 与各内嵌模块共用）；
 * - `bindSnapshotSelector`：SnapshotStore → useSyncExternalStore 绑定；
 * - `events.ts`：**插件共享的事件订阅运行时**（ADR-001/004）—— 平台 `$stream`
 *   之上补扇出 / 引用计数 / 基线重同步。此前唯一正确的实现（refcount 注册表）
 *   长在 dsh-spark-dock 这个 app 包里，插件复不到，于是 hippomemo 只能自己
 *   `new EventSource`。
 */
import type { ClientContext } from './context.ts'

/** 注入插件级 CSS（幂等：同 tag 只注入一次，样式挂在宿主 document）。 */
export function injectPluginStyle(css: string, tag: string, plugin: string): void {
  if (typeof document === 'undefined') return
  const selector = 'style[data-plugin-css="' + tag + '"]'
  if (document.querySelector(selector) !== null) return
  const style = document.createElement('style')
  style.dataset.plugin = plugin
  style.dataset.pluginCss = tag
  style.textContent = css
  document.head.appendChild(style)
}

export { bindSnapshotSelector } from './snapshot.ts'
export type { SnapshotSelectorHook } from './snapshot.ts'
export {
  DockModuleHeader,
  DockModuleTab,
  registerDockModule,
} from './dock-module.ts'
export type {
  DockModuleLedgerRow,
  DockModuleOwnerProps,
  DockModuleSpec,
} from './dock-module.ts'
export { subscribeFrames, useFrames, openStreamNames } from './events.ts'
export type {
  FramedEvent,
  StreamRemote,
  StreamOptions,
  SubscribeFramesOptions,
  SupervisedStream,
  SupervisedStreamItem,
  UseFramesOptions,
} from './events.ts'
export type { ClientContext } from './context.ts'
