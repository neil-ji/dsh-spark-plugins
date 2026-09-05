/**
 * Finance audit plugin, browser half. Mounts the generated finance Remote and
 * registers the finance configuration card into the shared Plugins settings
 * section (`settings.plugin.item`). The dashboard lives at the top of the
 * card body, so a single `设置 → 插件 → 财务审计` entry holds both the
 * balance/KPI/chart view and the connection / sync / provider configuration
 * — the same shape as GitHub / hippomemo / npm connector cards.
 *
 * (Pre-2026-09 the dashboard was a separate `settings.section` item. Two
 * entry points for the same content is a UX trap: power users see one and
 * ordinary users see the other, and the dashboard's 1-2 minute first-load
 * backfill blocks the side the user happened to click.)
 */

import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ctx.remote (api-remotes re-declares it for consumers).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from 'dsh-spark-plugin-kit/client'
import type { SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import financeRemote from 'dsh-spark-finance/remote'
// Type-only: merges `ctx.remote.finance` and the locale Context merge.
import type {} from 'dsh-spark-finance/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: brings the `settings.plugin.item` slot declaration into the
// program. The card chrome is deliberately NOT imported at runtime — this
// package renders its own card, so bundling the section package would only
// duplicate it.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { FinanceAuditController } from './controller.ts'
import type { FinanceAuditState } from './controller.ts'
import type { FinanceAuditInjected } from './FinanceAuditSection.tsx'
import { FinanceCardController, type FinanceRemote } from './FinanceCardController.ts'
import { FinanceCard, type FinanceCardInjected } from './FinanceCard.tsx'
import { en, zh, type FinanceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.finance': FinanceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.finance'

/** Required services for slot registration, locale, remote, and the settings scope.
 * The nested finance Remote namespace is intentionally NOT injected: declaring
 * it would make this plugin wait for a service it mounts itself. After
 * `$mount` resolves, `ctx.reflect.get('remote.finance')` reads the namespace
 * without the inject requirement. */
export const inject = ['slots', 'locale', 'remote', 'settingsScope']

/**
 * Mount the finance Remote and register the plugin configuration card once
 * the shell's slot declarations are on the ledger. The card body hosts both
 * the dashboard view and the editor — see FinanceCard.tsx for the layout.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  // 0.1.2 locale.register 按语言逐条注册。
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, 'zh', zh)
    const offEn = ctx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'ui-finance: dictionaries')
  const disposeRemote = await ctx.remote.$mount(financeRemote)

  // Cordis rejects `ctx.remote.finance` without an inject declaration, and
  // declaring it would deadlock (the service only exists after our own
  // $mount above). Reflect reads it without the inject requirement.
  const finance = ctx.reflect.get('remote.finance') as ClientRemote['finance']
  const controller = new FinanceAuditController(finance)

  const useSnapshot = bindSnapshotSelector(controller.store) as SnapshotSelectorHook<FinanceAuditState>
  const t = ctx.locale.bind(NS) as (key: FinanceKey) => string
  const refresh = (): void => { void controller.load() }
  const refreshProvider = (provider: string): Promise<void> => controller.refreshProvider(provider)

  const auditInjected = (): FinanceAuditInjected => ({
    useSnapshot,
    t,
    refresh,
    refreshProvider,
  })

  // Plugin configuration card in 设置 → 插件 → 插件配置页. Bound to the
  // `finance` settings namespace the host service registers; rendered only
  // while that namespace is served to this client. Carries the finance
  // Remote too so the price-sync section reaches `syncCommunityPrices` and
  // the new read-only Provider configuration section reaches
  // `listProviders`. `FinanceRemote` accepts any subset of those four
  // methods, so a legacy host without `listProviders` keeps working (the
  // section falls back to a loading slot).
  const cardController = new FinanceCardController(
    ctx.settingsScope.bind({ namespace: 'finance' }),
    finance as unknown as FinanceRemote,
  )
  cardController.ensureAutoSync()
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'finance',
    locale: NS,
    // Card body now also receives the dashboard inject props so the body's
    // top half can render the dashboard inline. The card owns the section
    // since commit folded the standalone settings.section item away.
    inject: (): FinanceCardInjected & FinanceAuditInjected => {
      const cardFace = cardController.inject()
      // FinanceCardInjected expects `useFinanceCard` (a selector hook) —
      // cardFace exposes the underlying SnapshotStore instead, so wrap once
      // here and forward the rest of the card surface verbatim.
      const cardInjected: FinanceCardInjected = {
        ...cardFace,
        useFinanceCard: bindSnapshotSelector(cardFace.hooks.financeCard) as FinanceCardInjected['useFinanceCard'],
        // The audit dashboard refreshes share the same shape, so rename
        // for the card-level type clarity.
        dashboardRefresh: refresh,
        refreshProvider,
        useSnapshot,
      }
      return { ...cardInjected, ...auditInjected() }
    },
  }, FinanceCard))

  return async () => {
    controller.dispose()
    await disposeRemote()
  }
}
