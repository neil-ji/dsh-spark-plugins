/**
 * HippoMemo 的 dock 模块（ADR-003）：本包自己装配并注册进 dock 声明的
 * `spark.dock.module` 子槽 —— dock 不再 import 本包的 embed 产物。
 *
 * 与改造前 dock 内嵌版（`dsh-spark-dock/src/client/hippo/HippoEmbed.tsx`）等价：
 * - api：本包官方工厂（HTTP 同 `/hippomemo/*`）；
 * - t：插件自己的 locale 命名空间（本包 apply 注入字典，t 在注册时绑定）；
 * - CSS：HIPPOMEMO_CSS 全部 scoped 在 `[data-plugin="dsh-hippomemo"]`，
 *   由本组件根节点提供该属性（设置壳平时提供，dock 里由我们自己补）。
 */
import { createElement, type ReactNode } from 'react'
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import { registerDockModule, type DockModuleOwnerProps } from 'dsh-spark-plugin-kit/client'
import { IconThink } from 'dsh-ui-kit'
import { MemorySection, type MemorySectionProps } from './MemorySection.tsx'
import type { HippomemoLocaleKey } from './locales.ts'
import { createHippomemoApi, type HippomemoApi } from './api.ts'

/** 本包取词签名（`hippomemo.settings` 命名空间）。 */
type HippomemoTranslate = (key: HippomemoLocaleKey, params?: Record<string, string | number>) => string

/** 单例 api：与事件通道无关（HTTP 同源），跨渲染复用。 */
const api: HippomemoApi = createHippomemoApi()

export interface HippoInjected {
  t: MemorySectionProps['t']
}

/** 模块内容：dock 只在 variant === 'pane' 且本模块激活时渲染它。 */
export function HippoDockModule(props: HippoInjected & DockModuleOwnerProps): ReactNode {
  return createElement('div', { 'data-plugin': 'dsh-hippomemo', className: 'dock-embed hippomemo-dock-scope' },
    // embedded：dock 模块头已给出「记忆 HippoMemo + 一句说明」，
    // 页级 h2/intro 在这里是第二层同名 chrome —— 不渲染，而不是渲染后 CSS 压掉。
    createElement(MemorySection, { api, t: props.t, embedded: true }))
}

/**
 * 注册 HippoMemo 的 dock 模块。
 * @param ctx - 插件 client 根上下文（`inject` 需含 slots）。
 */
export function registerHippoDockModule(ctx: ClientContext): void {
  // 模块 chrome（模块栏名 / 面板标题 / 副标题 / 徽章格式）一律走本包字典 ——
  // 此前是硬编码中文，英文语言下模块栏与标题行整块仍是中文（2026-09-17 验收未覆盖项）。
  // label 保持「闭包求值」原形制：平台在渲染/投影时调它，语言切换后取到的是新词。
  const t = ctx.locale.bind('hippomemo.settings') as HippomemoTranslate
  const dispose = registerDockModule<HippoInjected>(ctx, {
    id: 'hippomemo',
    order: 20,
    label: () => t('dockLabel'),
    name: t('dockName'),
    sub: t('dockSub'),
    icon: createElement(IconThink, { size: 14 }),
    accent: 'var(--spk-acc-hippomemo, #3b82f6)',
    accentFg: 'var(--spk-acc-hippomemo-fg, #1d4ed8)',
    inject: () => ({ t: t as MemorySectionProps['t'] }),
    Content: HippoDockModule,
  })
  ctx.effect(() => dispose, 'hippomemo: dock module')
}
