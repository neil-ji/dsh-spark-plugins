/**
 * dsh-npm-ui client half: mounts the npm Remote namespace and registers the
 * npm release section into the Web settings modal sidebar.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the settings shell's SlotMap merge (settings.section).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the settings.plugin.item slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: pulls ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ctx.remote (api-remotes re-declares it for consumers).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from 'dsh-plugin-kit/client'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { NPM_REMOTE_CONTRIBUTION } from 'dsh-connector-npm-wire'
import { StagedSettingsCard } from 'dsh-plugin-kit/client'
import { NpmPluginCard } from './NpmPluginCard.tsx'
import { NPM_CARD_SPECS } from './NpmPluginCard.tsx'
import { NpmSection } from './NpmSection.tsx'
import type { NpmSectionInjected } from './NpmSection.tsx'
import { NpmUiStore } from './store.ts'
import { en, zh, type NpmKey } from './locales.ts'

export type { NpmSectionInjected, NpmSectionProps } from './NpmSection.tsx'
export type {
  NpmPackageInfoView, NpmStatusView, NpmTrustStatusView, NpmLaunchScriptView,
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
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Mount the npm release settings page.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'npm-ui: copy')

  const connection = ctx.get('connection') as ConnectionHandle

  // Mount the npm Remote namespace BEFORE the page can call it.
  await ctx.remote.$mount(NPM_REMOTE_CONTRIBUTION)

  // The mounted namespace is a dynamic cordis service (remote.npm):
  // read it through reflect to avoid a deadlock on its inject declaration.
  const npm = ctx.reflect.get('remote.npm') as TypertRemoteNamespaceMap['npm']

  const controller = new NpmUiStore(npm)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(NS)

  ctx.effect(() => {
    const refresh = (): void => { controller.refreshIfLoaded() }
    const disposers = [
      ctx.remote.$on('credentials/reference-updated', refresh),
      ctx.remote.$on('settings/document-updated', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'npm-ui: pushed invalidations')

  const injected = (): NpmSectionInjected => ({ controller, useSnapshot, t })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'npm',
    order: 30,
    label: () => t('nav'),
    inject: injected,
  }, NpmSection))

  // Plugin configuration card in the Plugins settings section (设置 → 插件 → 插件配置页).
  // Bound to the npm settings namespace the host service registers; rendered only
  // while that namespace is served to this client.
  const card = new StagedSettingsCard(
    ctx.settingsScope.bind({ namespace: 'npm' }),
    NPM_CARD_SPECS,
  )
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'npm',
    locale: NS,
    inject: () => ({ ...card.actions(), hooks: { npmCard: card.store } }),
  }, NpmPluginCard))
}