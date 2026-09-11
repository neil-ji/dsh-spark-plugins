/**
 * dsh-github-ui client half: registers the github dictionaries, mounts the github
 * Remote namespace and contributes its dock module.
 *
 * ADR-003（2026-09-11）：功能 UI 不再由 dock 静态 import 本包的 embed 产物，
 * 而是本入口自己装配好注入面后注册进 dock 声明的 `spark.dock.module` 子槽。
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
// Type-only: pulls ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ctx.remote (api-remotes re-declares it for consumers).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { GITHUB_REMOTE_CONTRIBUTION } from 'dsh-connector-wire'
import { en, zh, type GithubKey } from './locales.ts'
import { startGithubDockModule, type GithubDockInject } from './GithubDockModule.tsx'

export type { GithubSectionInjected, GithubSectionProps } from './GithubSection.tsx'
export type { GithubConfigView, GithubWhoamiValue } from 'dsh-connector-wire'
export type { GithubDockInject } from './GithubDockModule.tsx'
export type { GithubKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.github': GithubKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.github'

/** Required client services（ADR-003 后含 slots 与 remote.credentials）。 */
export const inject = ['locale', 'remote', 'remote.credentials', 'slots']

/**
 * Mount the github Remote namespace, register dictionaries, contribute the dock module.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  // 0.1.2 locale.register 按语言逐条注册。
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, 'zh', zh)
    const offEn = ctx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'github-ui: copy')

  // Keep the github Remote namespace mounted in the shell, then contribute the module.
  await ctx.remote.$mount(GITHUB_REMOTE_CONTRIBUTION)
  const injected: GithubDockInject = startGithubDockModule(ctx)
  if ('failed' in injected) console.warn('[dsh-connector-github-ui] dock 模块以失败态注册（remote.github 不可用）')
}
