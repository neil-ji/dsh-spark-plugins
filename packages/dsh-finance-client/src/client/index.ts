/**
 * Finance audit plugin, browser half: dictionaries + finance Remote + dock module.
 *
 * ADR-003（2026-09-11）：功能 UI 不再由 dock 静态 import 本包的 embed 产物，
 * 而是本入口自己装配注入面（`settingsScope('finance')` + 两个 controller）后
 * 注册进 dock 声明的 `spark.dock.module` 子槽。
 */

import type { ClientContext } from 'dsh-spark-plugin-kit/client'
// The Remote descriptors + Zod codecs are declared once in the wire package
// (P5 / ADR-005); this bundle inlines that same source the host registers.
import { FINANCE_REMOTE_CONTRIBUTION } from 'dsh-spark-finance-wire'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type FinanceKey } from './locales.ts'
import { startFinanceDockModule, type FinanceDockInject } from './FinanceDockModule.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.finance': FinanceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.finance'

/** Required client services: locale dictionaries + remote + settingsScope + slots. */
export const inject = ['locale', 'remote', 'settingsScope', 'slots'] as const

/**
 * Mount the finance Remote, register dictionaries, contribute the dock module.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  // 0.1.2 locale.register 按语言逐条注册。
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, 'zh', zh)
    const offEn = ctx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'ui-finance: dictionaries')

  // Keep the finance Remote namespace mounted in the shell (once), then register.
  const disposeRemote = await ctx.remote.$mount(FINANCE_REMOTE_CONTRIBUTION)
  const injected: FinanceDockInject = startFinanceDockModule(ctx)
  if ('failed' in injected) console.warn('[dsh-spark-finance-client] dock 模块以失败态注册（remote.finance 不可用）')

  return async () => {
    await disposeRemote()
  }
}
