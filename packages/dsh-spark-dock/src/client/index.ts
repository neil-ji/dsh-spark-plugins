/**
 * dsh-spark-dock client entry: mounts the floating ball + panel into the
 * web client's frame-wide `shell.overlay` slot (list kind, root scope,
 * click-through layer — the overlay root opts back into pointer events).
 * Registration mirrors dsh-client-ui-commands' popup entry.
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import { injectPluginStyle } from 'dsh-spark-plugin-kit/client'
import { en as ghEn, zh as ghZh } from 'dsh-connector-github-ui/embed'
import { en, HIPPOMEMO_CSS, zh } from 'dsh-hippomemo/embed'
import { DockOverlay } from './DockOverlay.tsx'
import { setHippoT } from './hippo/HippoEmbed.tsx'
import { startGithubEmbed } from './github/GithubEmbed.tsx'
import { DOCK_CSS } from './style.ts'
import { setFinanceRemoteGetter } from './finance/financeRemote.ts'
import { setReflectGetter } from './reflect.ts'

export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'settingsScope'] as const

/** 幂等注入插件级 CSS（与 registerSettingsSection 的 injectPluginStyle 同形）。 */
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
export function apply(ctx: ClientContext): void {
  const removeStyle = injectDockStyle()
  // hippomemo 全功能内嵌：注册其 locale 字典 + 注入其插件 CSS（幂等 tag 同
  // 原插件，重复加载时良性跳过），再绑定 t 交给 HippoEmbedPane。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCtx = ctx as any
  // hippomemo 插件同场加载时已注册过同一命名空间；register 对重复会抛错，
  // 字典内容一致，静默容忍即可（dock 单飞时由我们注册）。
  for (const [lang, dict] of [['zh', zh], ['en', en]] as const) {
    try { anyCtx.locale.register('hippomemo.settings', lang, dict) } catch { /* already registered */ }
  }
  // tsdown 产物里 HIPPOMEMO_CSS 已被折叠为 join 好的字符串；源码形态是
  // string[]，两种都兼容。
  const hippoCss = Array.isArray(HIPPOMEMO_CSS) ? HIPPOMEMO_CSS.join('\n') : HIPPOMEMO_CSS
  const removeHippoCss = injectPluginStyle(hippoCss, 'hippomemo', 'dsh-hippomemo')
  void removeHippoCss
  setHippoT(anyCtx.locale.bind('hippomemo.settings'))
  // github 内嵌：注册其字典（重复容忍）+ 异步装配 remote/controller 注入面。
  for (const [lang, dict] of [['zh', ghZh], ['en', ghEn]] as const) {
    try { anyCtx.locale.register('settings.github', lang, dict) } catch { /* already registered */ }
  }
  startGithubEmbed(ctx)
  // finance 余额数据源：remote.finance 由 finance-client 异步 $mount，
  // 必须惰性读取（面板加载时再取），不能在 apply 时同步缓存。
  setFinanceRemoteGetter(() => (ctx as unknown as { reflect: { get(id: string): unknown } }).reflect.get('remote.finance'))
  setReflectGetter((id) => (ctx as unknown as { reflect: { get(id: string): unknown } }).reflect.get(id))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots = (ctx as any).slots as {
    inject(name: string, register: () => unknown): unknown
    register(entry: Record<string, unknown>, component: unknown): unknown
  }
  slots.inject('shell.overlay', () => slots.register({
    name: 'shell.overlay',
    id: 'spark-dock',
    order: 10,
    inject: () => ({}),
  }, DockOverlay))
  ctx.effect(() => () => removeStyle())
}
