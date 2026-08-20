/**
 * dsh-plugin-kit client: DSH 插件 Web 设置页的公共样板。
 *
 * 把四个插件（hippomemo / finance / connector-github / connector-npm）里
 * 逐字重复的 settings.section 注册、locale 字典注册、CSS 注入收敛为一条
 * 调用；业务代码只保留 section 组件与 inject 面。
 *
 * 内部对 slots.register 的深层泛型约束做封装（类型细节收敛在包内），
 * 调用处仍保留组件的 props 类型检查。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComponentType } from 'react'

export interface SettingsSectionOptions<I extends object> {
  /** settings.section 条目 id（设置页导航 key，也是 CSS tag 默认值）。 */
  id: string
  /** 排序权重（与官方 sections 对齐，如 20/30）。 */
  order: number
  /** locale 命名空间（需先在 LocaleNamespaceMap 里 declare module 合并）。 */
  namespace: string
  /** 该命名空间下的字典表（如 { zh: {...}, en: {...} }）。 */
  dictionaries: Record<string, Record<string, string>>
  /** 导航 label 的字典 key（自动绑定到 namespace 的 t）。 */
  labelKey: string
  /** 业务注入面；组件 props 会额外获得绑定的 t。 */
  inject: () => I
  /** 可选：插件级 CSS（幂等注入，style[data-plugin-css=tag]）。 */
  css?: string
  /** CSS 注入标签，默认取 id。 */
  cssTag?: string
}

/**
 * 注册一个 settings.section 设置页：locale 字典注册 + 可选 CSS 注入 +
 * 插槽注册。返回 disposer（供 apply 的 cleanup 使用）。
 */
export function registerSettingsSection<I extends object, P extends object = I>(
  ctx: ClientContext,
  options: SettingsSectionOptions<I>,
  Section: ComponentType<P>,
): () => void {
  const { id, order, namespace, dictionaries, labelKey, inject, css, cssTag } = options
  if (css !== undefined) injectPluginStyle(css, cssTag ?? id, id)
  // slots/locale 的深层泛型（SlotMap 合并、LocaleNamespaceMap 合并）在此封装。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCtx = ctx as any
  anyCtx.effect(
    () => anyCtx.locale.register(namespace, dictionaries),
    namespace + ': dictionaries',
  )
  const t = anyCtx.locale.bind(namespace)
  const injected = (): unknown => ({ ...inject(), t })
  return anyCtx.slots.inject('settings.section', () =>
    anyCtx.slots.register({
      name: 'settings.section',
      id,
      order,
      label: () => t(labelKey),
      inject: injected,
    }, Section),
  )
}

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

export {
  booleanCardField,
  choiceCardField,
  numberCardField,
  StagedSettingsCard,
  textCardField,
} from './settings-card.ts'
export type {
  CardFieldSpec,
  CardFieldState,
  CardFieldWrite,
  CardShellState,
  StagedCardActions,
  StagedSettingsCardState,
} from './settings-card.ts'
export { bindSnapshotSelector } from './snapshot.ts'
export type { SnapshotSelectorHook } from './snapshot.ts'
