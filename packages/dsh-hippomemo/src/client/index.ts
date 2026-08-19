/**
 * dsh-hippomemo client entry: registers the "Memory" settings section.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'hippomemo.settings: dictionaries')

  injectStyle()
  const t = ctx.locale.bind(NS)
  const api = createHippomemoApi()
  const injected = (): { api: ReturnType<typeof createHippomemoApi>; t: typeof t } => ({ api, t })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'hippomemo',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, MemorySection))
}

function injectStyle(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="hippomemo"]') !== null) return
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-hippomemo'
  style.dataset.pluginCss = 'hippomemo'
  style.textContent = HIPPOMEMO_CSS
  document.head.appendChild(style)
}
