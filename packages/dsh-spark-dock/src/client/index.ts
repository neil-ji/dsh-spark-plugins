/**
 * dsh-spark-dock client entry: mounts the floating ball + panel into the
 * web client's frame-wide `shell.overlay` slot (list kind, root scope,
 * click-through layer — the overlay root opts back into pointer events).
 * Registration mirrors dsh-client-ui-commands' popup entry.
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import { DockOverlay } from './DockOverlay.tsx'
import { DOCK_CSS } from './style.ts'
import { setFinanceRemoteGetter } from './finance/financeRemote.ts'
import { setReflectGetter } from './reflect.ts'

export const inject = ['slots'] as const

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
