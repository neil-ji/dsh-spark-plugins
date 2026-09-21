/**
 * 脚本沉淀库的 dock 模块（ADR-003）：本包自己装配注入面并注册进 dock 声明的
 * `spark.dock.module` 子槽 —— dock 不 import 本包的产物，也不为新增模块改一行代码。
 */
import { createElement, type ComponentType } from 'react'
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import { registerDockModule, type DockModuleOwnerProps } from 'dsh-spark-plugin-kit/client'
import { IconPackage } from 'dsh-ui-kit'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ScriptsPane, type ScriptRemote } from './ScriptsPane.tsx'
import type { ScriptKey } from './locales.ts'

export type ScriptTranslate = (key: ScriptKey) => string

export interface ScriptDockInject {
  t: ScriptTranslate
  remote: ScriptRemote | null
}

const NS = 'settings.script'

const Content: ComponentType<ScriptDockInject & DockModuleOwnerProps> = (props) =>
  createElement(ScriptsPane, { t: props.t, remote: props.remote })

/**
 * 注册 dock 模块。
 * @param ctx - 插件 client 根上下文（`inject` 必须含 `slots` / `locale`）。
 * @returns 注入面（调用方可用于诊断；disposer 归 ctx.effect）。
 */
export function startScriptDockModule(ctx: ClientContext): ScriptDockInject {
  const t = ctx.locale.bind(NS) as unknown as ScriptTranslate
  const remote = (ctx.reflect.get('remote') as ScriptRemote | undefined) ?? null

  const dispose = registerDockModule<ScriptDockInject>(ctx, {
    id: 'script',
    order: 60,
    label: () => t('dockLabel'),
    name: t('dockName'),
    sub: t('dockSub'),
    icon: createElement(IconPackage, { size: 14 }),
    accent: 'var(--spk-acc-script, #2dd4bf)',
    accentFg: 'var(--spk-acc-script-fg, #5eead4)',
    inject: () => ({ t, remote }),
    Content,
  })
  ctx.effect(() => dispose, 'script-client: dock module')
  return { t, remote }
}
