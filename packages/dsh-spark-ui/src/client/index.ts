/**
 * dsh-spark-ui client entry: mounts the Sparks section into the Web
 * settings modal sidebar (设置 → 火花).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { registerSettingsSection } from 'dsh-spark-plugin-kit/client'
import { SparkSection, SparkController, bindSparkController } from './SparkSection.tsx'
import { createSparksApi } from './api.ts'
import { SPARK_CSS } from './style.ts'
import { zh, en, type SparkKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.spark': SparkKey
  }
}

const NS = 'settings.spark'

export const inject = ['slots', 'locale'] as const

/**
 * Mount the Sparks section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const api = createSparksApi()
  const controller = new SparkController(api)
  const { useSnapshot } = bindSparkController(controller)
  const t = ctx.locale.bind(NS) as (key: SparkKey) => string

  registerSettingsSection(ctx, {
    id: 'spark',
    order: 30,
    namespace: NS,
    dictionaries: { zh, en },
    labelKey: 'nav',
    inject: () => ({ api, controller, useSnapshot }),
    css: SPARK_CSS,
    cssTag: 'spark',
  }, SparkSection)
}

export type { SparkSectionInjected, SparkSectionProps, SparkState } from './SparkSection.tsx'
export type { SparkKey } from './locales.ts'
