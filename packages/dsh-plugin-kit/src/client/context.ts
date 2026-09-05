/**
 * 插件 client 根上下文类型（dsh-spark-plugin-kit client）。
 *
 * 0.1.2 起 client-runtime 聚合包被移除，ctx 上的服务面由各归属包分别声明，
 * 且同一成员的 host/client 声明不同——用 declare module 合并会 TS2717 冲突。
 * 这里按 better-sidebar 的做法取「结构镜像 + 交集」：只镜像本仓库插件真正
 * 消费的服务面（slots / locale / remote / settingsScope / reflect），
 * effect/get/inject 等基础能力直接继承 cordis Context。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'

/** ctx.slots：插槽注册面（settings.section / settings.plugin.item 等契约由
 *  client-ui-slots 的 SlotMap 声明合并提供，这里只约束我们调用的形状）。 */
export interface ClientSlotsService {
  inject(name: string, register: () => unknown): unknown
  register<I extends object, P extends object>(
    entry: {
      name: string
      /** settings.section 用 id；settings.plugin.item（keyed）用 key。 */
      id?: string
      order?: number
      key?: string
      locale?: string
      label?: () => string
      inject: () => I
    },
    component: unknown,
  ): unknown
}

/** ctx.locale：0.1.2 按语言逐条注册，返回 disposer。 */
export interface ClientLocaleService {
  register(namespace: string, lang: string, dictionary: Record<string, string>): () => void
  bind(namespace: string): (key: string) => string
}

/** ctx.remote：$mount/$on 管理与事件订阅；业务命名空间走 reflect 取回。 */
export interface ClientRemoteService {
  $mount(contribution: unknown): Promise<unknown>
  $on(event: string, listener: () => void): () => void
}

/** ctx.reflect：绕过 inject 声明读取动态服务（$mount 后的 remote.<ns>）。 */
export interface ClientReflectService {
  get(id: string): unknown
}

/** 插件 client 根上下文：cordis Context + 本仓库插件消费的客户端服务面。 */
export type ClientContext = Context & {
  slots: ClientSlotsService
  locale: ClientLocaleService
  remote: ClientRemoteService
  settingsScope: SettingsScopeBinder
  reflect: ClientReflectService
}
