
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'probe.ns': 'a' }
}
export function probe(ctx: ClientContext): void {
  const t = ((k: string) => k)
  const injected = (): { x: number } => ({ x: 1 })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'probe',
    order: 20,
    label: () => t('a'),
    locale: 'probe.ns',
    inject: injected,
  }, function ProbeSection() { return null }))
}
