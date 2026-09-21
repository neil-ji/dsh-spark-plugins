/**
 * 脚本沉淀库 browser 半边：字典 + `script/events` Remote + dock 模块自注册（ADR-003）。
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SCRIPT_REMOTE_CONTRIBUTION } from 'dsh-script-wire'
import { en, zh, type ScriptKey } from './locales.ts'
import { startScriptDockModule, type ScriptDockInject } from './ScriptDockModule.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.script': ScriptKey
  }
}

/** 需要的客户端服务：字典 + remote + 槽位（缺 slots 会让整条 loader entry 失败）。 */
export const inject = ['locale', 'remote', 'slots'] as const

/** 注册字典、mount Remote 命名空间、贡献 dock 模块。 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  ctx.effect(() => {
    const offZh = ctx.locale.register('settings.script', 'zh', zh)
    const offEn = ctx.locale.register('settings.script', 'en', en)
    return () => { offZh(); offEn() }
  }, 'script-client: dictionaries')

  const disposeRemote = await ctx.remote.$mount(SCRIPT_REMOTE_CONTRIBUTION)
  startScriptDockModule(ctx)

  return async () => { await disposeRemote() }
}

export type { ScriptDockInject, ScriptTranslate } from './ScriptDockModule.tsx'
export type { ScriptsPaneProps, ScriptEventsFace } from './ScriptsPane.tsx'
export type { ScriptKey } from './locales.ts'
export { ScriptsPane } from './ScriptsPane.tsx'
export { scriptApi } from './api.ts'
export type { ScriptsApi } from './api.ts'
