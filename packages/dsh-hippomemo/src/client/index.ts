/**
 * dsh-hippomemo client entry: registers the "Memory" settings section and the
 * plugin configuration card (设置 → 插件 → 插件配置页).
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: brings the `settings.plugin.item` slot declaration into the program.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { choiceCardField, injectPluginStyle, numberCardField, StagedSettingsCard } from 'dsh-spark-plugin-kit/client'
import { createHippomemoApi } from './api.ts'
import { HippomemoPluginCard } from './HippomemoPluginCard.tsx'
import { HIPPOMEMO_CSS } from './style.ts'
import { en, zh, type HippomemoLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'hippomemo.settings': HippomemoLocaleKey
  }
}

const NS = 'hippomemo.settings'

/** hippomemo 设置命名空间（宿主 MemoryService 注册）。 */
const SETTINGS_NAMESPACE = 'hippomemo'

export const inject = ['slots', 'locale', 'settingsScope']

export function apply(ctx: ClientContext): void {
  // 入口退位（2026-09）：完整设置页已由 dsh-spark-dock 悬浮球内嵌
  // （dock import 本包 ./embed 的 MemorySection），这里不再注册
  // settings.section。保留字典 + CSS 注入（dock 内嵌也用同一份，幂等）。
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

  // 插件配置卡片：绑定 hippomemo 设置命名空间，编辑容量与召回参数。
  const card = new StagedSettingsCard(
    ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }),
    [
      numberCardField('maxMemories'),
      numberCardField('defaultRecallLimit'),
      numberCardField('maxRecallChars'),
      choiceCardField('recallMode', ['firehose', 'cognitive']),
      numberCardField('cognitiveRelevanceThreshold'),
      numberCardField('cognitiveRecallMultiplier'),
    ],
  )
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'hippomemo',
    locale: NS,
    inject: () => ({ ...card.actions(), hooks: { hippomemoCard: card.store } }),
  }, HippomemoPluginCard))
}
