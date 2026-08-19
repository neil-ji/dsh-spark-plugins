/**
 * dsh-hippomemo client entry: registers the "Memory" settings section.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { registerSettingsSection } from 'dsh-plugin-kit/client'
import { createHippomemoApi } from './api.ts'
import { MemorySection } from './MemorySection.tsx'
import { HIPPOMEMO_CSS } from './style.ts'
import { en, zh, type HippomemoLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'hippomemo.settings': HippomemoLocaleKey
  }
}

const NS = 'hippomemo.settings'

export const inject = ['slots', 'locale']

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
}
