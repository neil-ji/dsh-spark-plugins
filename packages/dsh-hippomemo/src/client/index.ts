/**
 * dsh-hippomemo client entry: dictionary + plugin CSS injection only.
 *
 * 入口退位（2026-09）：完整设置页已由 dsh-spark-dock 悬浮球内嵌
 * （dock import 本包 ./embed 的 MemorySection）——本入口只保留字典 + CSS
 * 注入（dock 内嵌也用同一份，幂等），不注册任何插槽。
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { injectPluginStyle } from 'dsh-spark-plugin-kit/client'
// 显式拉取 Spark token CSS 字符串并走 injectPluginStyle 注入。hippomemo 用 tsdown/rolldown 打包，
// ui-kit 自注入的 .mjs 副作用会被 rolldown 判"可能纯"而整棵剪掉；sparkTokenCss 作为"已用值"
// 导入不会被剪，此处显式注入保证 --spk-*/--dsw-* token 层落到页面（否则组件被冲淡成低对比灰）。
import { sparkTokenCss } from 'dsh-ui-kit'
import { HIPPOMEMO_CSS } from './style.ts'
import { startHippomemoEvents } from './start.ts'
import { en, zh, type HippomemoLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'hippomemo.settings': HippomemoLocaleKey
  }
}

const NS = 'hippomemo.settings'

export const inject = ['locale', 'remote'] as const

export async function apply(ctx: ClientContext): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCtx = ctx as any
  anyCtx.effect(() => {
    const offZh = anyCtx.locale.register(NS, 'zh', zh)
    const offEn = anyCtx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, NS + ': dictionaries')
  // tsdown/esbuild 产物形态可能是 join 好的 string 或源码 string[]，双态兼容。
  const hippoCss = Array.isArray(HIPPOMEMO_CSS) ? HIPPOMEMO_CSS.join('\n') : HIPPOMEMO_CSS
  injectPluginStyle(hippoCss, 'hippomemo', 'hippomemo')
  // 注入 Spark token 层（幂等：同一 style id 只注入一次；即便 ui-kit 自注入已存在也安全）。
  injectPluginStyle(sparkTokenCss, 'dsh-ui-kit/tokens', 'dsh-ui-kit')
  // 统一事件通道（ADR-001）：standalone 路径也要装配，否则记忆面板失去实时刷新。
  await startHippomemoEvents(ctx)
}
