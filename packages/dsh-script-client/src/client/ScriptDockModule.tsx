/**
 * 脚本沉淀库的 dock 模块（ADR-003）：本包自己装配注入面并注册进 dock 声明的
 * `spark.dock.module` 子槽 —— dock 不 import 本包的产物，也不为新增模块改一行代码。
 *
 * **事件通道的取法（真宿主实测，2026-09-22）**：`remote.script` 是 `$mount` 之后才存在的
 * 命名空间服务，**不能写进 `inject`**（会死锁），也**不能**在 `ctx.remote` 上直接点出来 ——
 * 那样会被平台的 inject 门拦下（`cannot get property "remote.script" without inject`，
 * 只在真宿主出现：预览的 mock remote 是普通对象，没有这道门）。
 * 唯一可行取法是 `ctx.reflect.get('remote.script')`，`$stream` 载体仍是 `ctx.remote`。
 * 范本：`dsh-hippomemo` 的 `hippomemoChannelOf` / `dsh-finance-client` 的 `financeChannelOf`。
 */
import { createElement, type ComponentType } from 'react'
import type { ClientContext, StreamRemote } from 'dsh-spark-plugin-kit/client'
import { registerDockModule, type DockModuleOwnerProps } from 'dsh-spark-plugin-kit/client'
import { IconPackage } from 'dsh-ui-kit'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ScriptsPane, type ScriptEventsFace, type ScriptsPaneProps } from './ScriptsPane.tsx'
import type { ScriptKey } from './locales.ts'

export type ScriptTranslate = (key: ScriptKey) => string

export interface ScriptDockInject {
  t: ScriptTranslate
  /** `ctx.remote`（提供 `$stream`）；null = remote 服务缺失（装配失败态）。 */
  remote: StreamRemote | null
  /** `ctx.reflect.get('remote.script')`；null = 命名空间不可用（降级为不订阅）。 */
  events: ScriptEventsFace | null
}

const NS = 'settings.script'

/** 逻辑流名（与宿主方法同名，同时是 kit 订阅运行时的复用键）。 */
export const SCRIPT_EVENTS_STREAM = 'script/events'

/**
 * 组装事件通道（`$mount` 之后调用）。
 * @param remote - `ctx.remote`（提供 `$stream`）。
 * @param reflect - `ctx.reflect`（取回动态命名空间）。
 * @returns 命名空间面；不可用时 null（UI 仍渲染，只是不实时刷新）。
 */
export function scriptEventsFaceOf(
  reflect: { get(id: string): unknown },
): ScriptEventsFace | null {
  const namespace = reflect.get('remote.script') as ScriptEventsFace | undefined
  if (namespace === undefined || namespace === null || typeof namespace.events !== 'function') return null
  return namespace
}

const Content: ComponentType<ScriptDockInject & DockModuleOwnerProps> = (props) =>
  createElement(ScriptsPane, { t: props.t, remote: props.remote, events: props.events } satisfies ScriptsPaneProps)

/**
 * 注册 dock 模块。
 * @param ctx - 插件 client 根上下文（`inject` 必须含 `slots` / `locale` / `remote`）。
 * @returns 注入面（调用方可用于诊断；disposer 归 ctx.effect）。
 */
export function startScriptDockModule(ctx: ClientContext): ScriptDockInject {
  const t = ctx.locale.bind(NS) as unknown as ScriptTranslate
  const remote = (ctx.reflect.get('remote') as StreamRemote | undefined) ?? null
  const events = scriptEventsFaceOf(ctx.reflect)

  const dispose = registerDockModule<ScriptDockInject>(ctx, {
    id: 'script',
    order: 60,
    label: () => t('dockLabel'),
    name: t('dockName'),
    sub: t('dockSub'),
    icon: createElement(IconPackage, { size: 14 }),
    accent: 'var(--spk-acc-script, #2dd4bf)',
    accentFg: 'var(--spk-acc-script-fg, #5eead4)',
    inject: () => ({ t, remote, events }),
    Content,
  })
  ctx.effect(() => dispose, 'script-client: dock module')
  return { t, remote, events }
}
