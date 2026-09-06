/**
 * Finance audit plugin, browser half. Registers the finance dictionaries and
 * mounts the generated finance Remote into the web client shell.
 *
 * 入口退位（2026-09）：设置页入口（dashboard + 连接/同步/provider 配置卡）
 * 已完全由 dsh-spark-dock 悬浮球内嵌（dock import 本包 ./embed 的
 * FinanceCard 并自行 mount remote + bind settingsScope），这里不再注册
 * settings.plugin.item。
 */

import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import financeRemote from 'dsh-spark-finance/remote'
// Type-only: merges `ctx.remote.finance` and the locale Context merge.
import type {} from 'dsh-spark-finance/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type FinanceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.finance': FinanceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.finance'

/** Required client services: locale dictionaries + remote $mount. */
export const inject = ['locale', 'remote'] as const

/**
 * Mount the finance Remote and register dictionaries.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  // 0.1.2 locale.register 按语言逐条注册。
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, 'zh', zh)
    const offEn = ctx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'ui-finance: dictionaries')

  // Keep the finance Remote namespace mounted in the shell; the dock embed
  // mounts its own, duplicate $mount of the same contribution is tolerated.
  const disposeRemote = await ctx.remote.$mount(financeRemote)

  return async () => {
    await disposeRemote()
  }
}
