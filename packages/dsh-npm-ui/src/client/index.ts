/**
 * dsh-npm-ui client half: registers the npm dictionaries and mounts the npm
 * Remote namespace into the web client shell.
 *
 * 入口退位（2026-09）：完整设置页与插件配置卡片均已由 dsh-spark-dock 悬浮球
 * 内嵌（dock import 本包 ./embed 的 NpmSection 并自行 mount remote），
 * 这里不再注册 settings.section / settings.plugin.item。
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
// Type-only: pulls ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ctx.remote (api-remotes re-declares it for consumers).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { NPM_REMOTE_CONTRIBUTION } from 'dsh-connector-npm-wire'
import { en, zh, type NpmKey } from './locales.ts'

export type { NpmSectionInjected, NpmSectionProps } from './NpmSection.tsx'
export type {
  NpmStatusView, NpmTokenStatusView, NpmTokenTestView,
} from 'dsh-connector-npm-wire'
export type { NpmKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.npm': NpmKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.npm'

/** Required client services. */
export const inject = ['locale', 'remote']

/**
 * Mount the npm Remote namespace and register dictionaries.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  // 0.1.2 locale.register 按语言逐条注册。
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, 'zh', zh)
    const offEn = ctx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'npm-ui: copy')

  // Keep the npm Remote namespace mounted in the shell; the dock embed
  // mounts its own, duplicate $mount of the same contribution is tolerated.
  await ctx.remote.$mount(NPM_REMOTE_CONTRIBUTION)
}
