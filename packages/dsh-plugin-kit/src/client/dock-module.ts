/**
 * Dock 模块贡献点（ADR-003 / P3）：把「dock 编译期聚合插件」换成平台原生的
 * 「声明子槽 + 插件自注册」。
 *
 * 改造前：dock 在 `modules.tsx` 硬编码 5 个模块，并静态 import 4 个插件的 embed
 * 产物 —— 新增第 6 个插件要改 dock 源码、bump dock 版本、重装重启，dock 的 bundle
 * 还依赖所有插件 UI（评审 F4 / F6）。
 *
 * 改造后：
 *   - dock 注册 `shell.overlay` 时声明子槽
 *     `children: { 'spark.dock.module': { kind: 'list', scope: 'root' } }`；
 *   - 插件 UI 在自己的 client `apply()` 里调 `registerDockModule(ctx, spec)`；
 *   - dock 用 `renderSlot` 渲染三个位：模块栏（rail）/ 面板标题行（header）/ 内容（pane）。
 *
 * 为什么 owner props 里传的是 `activeId` 而不是 `active`：owner props 是**所有条目共享**
 * 的同一次 renderSlot 调用参数，不能按条目下发；每个条目自己判 `activeId === id`。
 *
 * 契约类型住在本包（dock 与全部插件 UI 的共同依赖），双方不互相 import —— 这正是
 * 平台 `settings.plugins.tab` 的做法（"the type lives here so inventory and
 * configuration plugins collaborate without depending on one another"）。
 */
import { createElement, type ComponentType, type ReactNode } from 'react'
// Type-only：声明 `spark.dock.module` 契约需要本模块可达（SlotMap 声明合并）。
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from './context.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * dock 指挥舱里的一格插件模块。注册方自带图标 / 强调色 / 标题 / 内容，
     * dock 只提供三个渲染位与选中态，因此新增插件不需要 dock 侧任何改动。
     */
    'spark.dock.module': { kind: 'list'; scope: 'root'; owner: DockModuleOwnerProps }
  }
}

/** owner props：dock 在三个渲染位下发给每个模块。 */
export interface DockModuleOwnerProps {
  /** 渲染位：模块栏按钮 / 面板标题行 / 内容。 */
  variant: 'rail' | 'header' | 'pane'
  /** 当前选中的模块 id（所有条目共享，各条目自行比较）。 */
  activeId: string
  /** 模块栏被点击时回调（选中态由 dock 持有）。 */
  onSelect: (id: string) => void
}

/** 一个 dock 模块的完整声明：chrome（图标/标题/强调色）与内容都在注册方手里。 */
export interface DockModuleSpec<I extends object> {
  /** 模块 id（同时是 localStorage 里记住的选中键）。 */
  id: string
  /** 模块栏顺序（平台按 order 排序 list 槽）。 */
  order: number
  /** 模块栏可访问名（注册方本地化；平台 ledger 也据此投影导航行）。 */
  label: () => string
  /** 面板标题行主标题（如「npm」）。 */
  name: string
  /** 面板标题行副标题（功能说明）。 */
  sub: string
  /** 模块栏图标（16px 光学网格，SVG，禁 emoji）。 */
  icon: ReactNode
  /** 模块强调色（激活态图标色 / 指示点）。 */
  accent: string
  /** 强调色的前景档（实底芯片用）。 */
  accentFg: string
  /** 注入面：组件 props 会额外获得 `{...inject(), variant, activeId, onSelect}`。 */
  inject: () => I
  /** 内容组件（只在 variant === 'pane' 且该模块激活时被 dock 渲染）。 */
  Content: ComponentType<I & DockModuleOwnerProps>
}

/**
 * 模块栏按钮。结构与类名由本包固定（dock 注入的全局样式表按这些类名着色），
 * 是 kit ↔ dock 之间唯一的 chrome 契约。
 */
export function DockModuleTab(props: {
  id: string
  active: boolean
  label: string
  icon: ReactNode
  accent: string
  accentFg: string
  onSelect: () => void
}): ReactNode {
  return createElement('button', {
    type: 'button',
    role: 'tab',
    // dock 的 rail 用 DOM 顺序做方向键导航（自注册模块不在 dock 的表格里），
    // 所以每条 tab 必须带自己的 module id。
    'data-module-id': props.id,
    'aria-selected': props.active,
    'aria-label': props.label,
    title: props.label,
    tabIndex: props.active ? 0 : -1,
    className: props.active ? 'dock-tab active' : 'dock-tab',
    style: { '--accent': props.accent, '--accent-fg': props.accentFg },
    onClick: props.onSelect,
  }, props.icon)
}

/** 面板标题行（dock 的 `.dock-head` 里只放这一格，关闭钮等 chrome 仍归 dock）。 */
export function DockModuleHeader(props: { name: string; sub: string; accent: string; accentFg: string }): ReactNode {
  return createElement('div', {
    className: 'titles',
    style: { '--accent': props.accent, '--accent-fg': props.accentFg },
  },
  createElement('div', { className: 'name' }, props.name),
  createElement('div', { className: 'sub' }, props.sub))
}

/**
 * 把一格模块注册进 dock 声明的 `spark.dock.module` 子槽。
 *
 * 与 `settings.section` 的注册同形（`slots.inject` + `slots.register`），因此
 * 加载序无关：dock 先渲染、插件后注册，平台 ledger 变更会让它重新渲染。
 *
 * @param ctx - 插件 client 根上下文。
 * @param spec - 模块声明（chrome + inject 面 + 内容组件）。
 * @returns disposer（交给 apply 的 cleanup / ctx.effect）。
 */
export function registerDockModule<I extends object>(ctx: ClientContext, spec: DockModuleSpec<I>): () => void {
  const Module: ComponentType<DockModuleOwnerProps & I> = (props) => {
    if (props.variant === 'rail') {
      return DockModuleTab({
        id: spec.id,
        active: props.activeId === spec.id,
        label: spec.label(),
        icon: spec.icon,
        accent: spec.accent,
        accentFg: spec.accentFg,
        onSelect: () => props.onSelect(spec.id),
      })
    }
    if (props.variant === 'header') {
      return DockModuleHeader({ name: spec.name, sub: spec.sub, accent: spec.accent, accentFg: spec.accentFg })
    }
    return createElement(spec.Content, props)
  }
  // slots 的深层泛型（SlotMap 合并 + 组合 props 交集）在包内收敛，调用点保持简单。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCtx = ctx as any
  return anyCtx.slots.inject('spark.dock.module', () =>
    anyCtx.slots.register({
      name: 'spark.dock.module',
      id: spec.id,
      order: spec.order,
      label: spec.label,
      inject: spec.inject,
    }, Module),
  )
}

/** dock 侧读取 ledger 用的最小形状（诊断/兜底渲染用，不参与 chrome）。 */
export interface DockModuleLedgerRow {
  id: string
  order: number
  label: string
}
