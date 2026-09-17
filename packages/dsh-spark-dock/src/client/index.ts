/**
 * dsh-spark-dock client entry: mounts the floating ball + panel into the
 * web client's frame-wide `shell.overlay` slot (list kind, root scope,
 * click-through layer — the overlay root opts back into pointer events).
 * Registration mirrors dsh-client-ui-commands' popup entry.
 *
 * ADR-003（2026-09-11）：dock 不再静态 import 任何插件 UI。它只做三件事：
 *   1. 声明自己的子槽 `spark.dock.module`（`children`），并把平台的 `renderSlot`
 *      渲染面交给 `DockOverlay`（rail / header / pane 三个位）；
 *   2. 装配自己的 spark 模块（spark 的功能 UI 一直住在本包）并经同一个
 *      `registerDockModule` 注册 —— 与其它插件走完全同一条路径；
 *   3. 注入悬浮球/面板的样式。
 * 插件（github / npm / finance / hippomemo）在各自的 client `apply()` 里自注册。
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import { injectPluginStyle } from 'dsh-spark-plugin-kit/client'
import { SPARK_REMOTE_CONTRIBUTION } from 'dsh-spark-wire'
import { sparkChannelOf, type SparkEventChannel } from './spark/remote.ts'
import { registerSparkDockModule, startSparkAnnouncements } from './spark/SparkDockModule.tsx'
import { SPARK_DOCK_NS, en, zh, type SparkT } from './spark/locales.ts'
import { DOCK_SHELL_NS, en as shellEn, zh as shellZh, type DockShellT } from './shell/locales.ts'
import { DockOverlay } from './DockOverlay.tsx'
import { DOCK_CSS } from './style.ts'

/**
 * 客户端服务依赖。**注意不要把 `remote.spark` 写进来**：该服务由下面的
 * `$mount(SPARK_REMOTE_CONTRIBUTION)` 才提供，注入它会死锁（fiber 永远等不到，
 * 悬浮球整个不挂载）。动态命名空间一律走 `ctx.reflect.get('remote.spark')`。
 */
export const inject = ['slots', 'locale', 'remote'] as const

/** 幂等注入插件级 CSS（与 plugin-kit 的 injectPluginStyle 同形，此处自带一份
 *  以便在 kit CSS 注入之前就能落样式）。 */
function injectDockStyle(): () => void {
  const tag = 'dsh-spark-dock'
  const existing = document.head.querySelector(`style[data-plugin-css="${tag}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-plugin-css', tag)
  style.textContent = DOCK_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

/**
 * Mount the Spark Dock overlay.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  injectDockStyle()
  // 文案字典（AGENTS.md §3.4）：dock 的 spark 模块此前是硬编码中文，这里补上
  // zh/en 两份；`t` 只 bind 一次后复用，避免每次渲染返回新函数身份（槽位 effect 会重跑）。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const localeCtx = ctx as any
  localeCtx.effect(() => {
    const offZh = localeCtx.locale.register(SPARK_DOCK_NS, 'zh', zh)
    const offEn = localeCtx.locale.register(SPARK_DOCK_NS, 'en', en)
    return () => { offZh(); offEn() }
  }, SPARK_DOCK_NS + ': dictionaries')
  const t = localeCtx.locale.bind(SPARK_DOCK_NS) as SparkT
  // 壳文案（悬浮球 / 模块栏 / 关闭钮 / 兜底）：与 spark 模块文案分开一份字典，
  // 同一注册流程（同上一次 effect 里注册 zh + en）。
  localeCtx.effect(() => {
    const offZh = localeCtx.locale.register(DOCK_SHELL_NS, 'zh', shellZh)
    const offEn = localeCtx.locale.register(DOCK_SHELL_NS, 'en', shellEn)
    return () => { offZh(); offEn() }
  }, DOCK_SHELL_NS + ': dictionaries')
  const tShell = localeCtx.locale.bind(DOCK_SHELL_NS) as DockShellT
  injectPluginStyle(DOCK_CSS, 'dsh-spark-dock', 'dsh-spark-dock')
  // 统一事件通道（ADR-001）：先 mount spark 的 stream 描述符并**等它完成**，
  // 再经 reflect 取回动态命名空间组装通道（`remote.spark` 不能写进 inject，见上）。
  let channel: SparkEventChannel | null = null
  try {
    await ctx.remote.$mount(SPARK_REMOTE_CONTRIBUTION)
    channel = sparkChannelOf(ctx.remote, ctx.reflect)
    if (channel === null) console.warn('[dsh-spark-dock] 未取到 remote.spark 命名空间，实时刷新将不可用')
  } catch (error) {
    console.warn('[dsh-spark-dock] spark 事件流描述符 mount 失败，实时刷新将不可用：', error)
  }
  // 1) 自己的模块走同一条自注册路径（spark 的 UI 与播报文案都住在本包）。
  registerSparkDockModule(ctx, { channel, t })
  // 1b) spark 的播报（F7）：模块自己订阅统一事件流并把帧翻成气泡文案；
  //     壳只订阅 kit 的播报总线（见 fairy/FairyFace.tsx）。
  if (channel !== null) {
    const stopAnnouncements = startSparkAnnouncements(channel, t)
    ctx.effect(() => stopAnnouncements, 'spark-dock: announcements')
  }
  // 2) 声明 shell.overlay 里的悬浮球，并声明 dock 的子槽 —— 插件据此自注册。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots = (ctx as any).slots as {
    inject(name: string, register: () => unknown): unknown
    register(entry: Record<string, unknown>, component: unknown): unknown
  }
  // 注入面取稳定引用：槽位组件每次渲染都会调 inject，
  // 若返回新对象则 props 身份每次都变 → 订阅 effect 反复重跑（预览走查抓到过一次悬空）。
  const injected = { channel, t: tShell }
  slots.inject('shell.overlay', () => slots.register({
    name: 'shell.overlay',
    id: 'spark-dock',
    order: 10,
    // ADR-003：dock 只声明自己的子槽；插件 UI 在自己的 apply 里注册进
    // `spark.dock.module`（契约类型在 dsh-spark-plugin-kit/client），
    // 平台会把 renderSlot 作为组件 props 下发给 DockOverlay。
    children: { 'spark.dock.module': { kind: 'list', scope: 'root' } },
    // 通过插槽 inject 面把事件通道交给组件（取代模块级单例）。
    inject: () => injected,
  }, DockOverlay))
}
