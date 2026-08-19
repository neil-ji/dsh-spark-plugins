/**
 * dsh-github-ui client half: mounts the github Remote namespace and registers
 * the Github settings section into the Web settings modal sidebar.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the settings shell's SlotMap merge (settings.section).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ctx.remote (api-remotes re-declares it for consumers).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { GITHUB_REMOTE_CONTRIBUTION } from 'dsh-connector-wire'
import { GithubSection } from './GithubSection.tsx'
import type { GithubSectionInjected } from './GithubSection.tsx'
import { GithubSettingsStore } from './store.ts'
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
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Mount the Github settings page.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'github-ui: copy')

  const connection = ctx.get('connection') as ConnectionHandle

  // Mount the github Remote namespace BEFORE the page can call it (avoids
  // the section racing an unfinished $mount).
  await ctx.remote.$mount(GITHUB_REMOTE_CONTRIBUTION)

  // The mounted namespace is a dynamic cordis service (remote.github):
  // read it through reflect to avoid a deadlock on its inject declaration.
  const github = ctx.reflect.get('remote.github') as TypertRemoteNamespaceMap['github']

  const controller = new GithubSettingsStore(connection.api, github)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(NS)

  ctx.effect(() => {
    const refresh = (): void => { controller.refreshIfLoaded() }
    const disposers = [
      ctx.remote.$on('credentials/updated', refresh),
      ctx.remote.$on('settings/document-updated', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'github-ui: pushed invalidations')

  const injected = (): GithubSectionInjected => ({ controller, useSnapshot, t })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'github',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, GithubSection))
}
