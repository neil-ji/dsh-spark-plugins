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
import { choiceCardField, numberCardField, registerSettingsSection, StagedSettingsCard } from 'dsh-spark-plugin-kit/client'
import { createHippomemoApi } from './api.ts'
import { HippomemoPluginCard } from './HippomemoPluginCard.tsx'
import { MemorySection } from './MemorySection.tsx'
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
  const api = createHippomemoApi()
  registerSettingsSection(ctx, {
    id: 'hippomemo',
    order: 20,
    namespace: NS,
    dictionaries: { zh, en },
    labelKey: 'nav',
    inject: () => ({ api }),
    css: HIPPOMEMO_CSS,
    cssTag: 'hippomemo',
  }, MemorySection)

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
