/**
 * 财务插件 browser 半边：字典 + finance Remote + dock 模块（四个决策视图）。
 *
 * ADR-003（2026-09-11）：功能 UI 由本入口自己装配注入面，再注册进 dock 声明的
 * `spark.dock.module` 子槽 —— dock 不 import 本包的产物。
 */

import type { ClientContext } from 'dsh-spark-plugin-kit/client'
// Remote 描述符 + Zod codec 只在 wire 包声明一次（P5 / ADR-005）；这里内联的
// 就是宿主注册的同一份源。
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

/** 本模块拥有的字典命名空间。 */
const NS = 'settings.finance'

/** 需要的客户端服务：字典 + remote + 槽位（settingsScope 留给套餐定义用）。 */
export const inject = ['locale', 'remote', 'settingsScope', 'slots'] as const

/** mount finance Remote、注册字典、贡献 dock 模块。 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  // 0.1.2 locale.register 按语言逐条注册。
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, 'zh', zh)
    const offEn = ctx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'ui-finance: dictionaries')

  // 让 finance Remote 命名空间在壳里挂载一次，然后注册 dock 模块。
  const disposeRemote = await ctx.remote.$mount(FINANCE_REMOTE_CONTRIBUTION)
  const injected: FinanceDockInject = startFinanceDockModule(ctx)
  if ('failed' in injected) console.warn('[dsh-spark-finance-client] dock 模块以失败态注册（remote.finance 不可用）')

  return async () => {
    await disposeRemote()
  }
}
