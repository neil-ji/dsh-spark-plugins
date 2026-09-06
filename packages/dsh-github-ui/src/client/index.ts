/**
 * dsh-github-ui client half: registers the github dictionaries and mounts the
 * github Remote namespace into the web client shell.
 *
 * 入口退位（2026-09）：完整设置页与插件配置卡片均已由 dsh-spark-dock 悬浮球
 * 内嵌（dock import 本包 ./embed 的 GithubSection 并自行 mount remote），
 * 这里不再注册 settings.section / settings.plugin.item。
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
// Type-only: pulls ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ctx.remote (api-remotes re-declares it for consumers).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { GITHUB_REMOTE_CONTRIBUTION } from 'dsh-connector-wire'
import { en, zh, type GithubKey } from './locales.ts'

export type { GithubSectionInjected, GithubSectionProps } from './GithubSection.tsx'
export type { GithubConfigView, GithubWhoamiValue } from 'dsh-connector-wire'
export type { GithubKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.github': GithubKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.github'

/** Required client services. */
export const inject = ['locale', 'remote']

/**
 * Mount the github Remote namespace and register dictionaries.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  // 0.1.2 locale.register 按语言逐条注册。
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, 'zh', zh)
    const offEn = ctx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'github-ui: copy')

  // Keep the github Remote namespace mounted in the shell; the dock embed
  // mounts its own, duplicate $mount of the same contribution is tolerated.
  await ctx.remote.$mount(GITHUB_REMOTE_CONTRIBUTION)
}
