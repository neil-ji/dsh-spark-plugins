/**
 * dsh-hippomemo client entry: dictionary + plugin CSS injection + dock module.
 *
 * ADR-003（2026-09-11）：功能 UI 不再由 dock 静态 import 本包的 embed 产物，
 * 而是本入口注册字典 / 注入 CSS（幂等）后，把模块注册进 dock 声明的
 * `spark.dock.module` 子槽。
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
import { registerHippoDockModule } from './HippoDockModule.tsx'
import { startHippomemoAnnouncements } from './announce.ts'
import { en, zh, type HippomemoLocaleKey } from './locales.ts'

/** 本包取词签名（`hippomemo.settings` 命名空间）。 */
type HippomemoTranslate = (key: HippomemoLocaleKey, params?: Record<string, string | number>) => string

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'hippomemo.settings': HippomemoLocaleKey
  }
}

const NS = 'hippomemo.settings'

/** Required client services（ADR-003 后含 slots）。 */
export const inject = ['locale', 'remote', 'slots'] as const

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
  // F7：本模块自己的播报（文案与情绪住在这里，壳只订阅总线呈现）。
  // 取词在 apply 里绑定一次后传入 —— 播报文案同样归本包字典。
  const tAnnounce = anyCtx.locale.bind(NS) as HippomemoTranslate
  const stopAnnouncements = startHippomemoAnnouncements(tAnnounce)
  ctx.effect(() => stopAnnouncements, 'hippomemo: announcements')
  // ADR-003：注册 dock 模块（面板 UI 归插件自己）。
  registerHippoDockModule(ctx)
}
