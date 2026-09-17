/**
 * **壳文案字典**（AGENTS.md §3.4 / F7：壳只呈现，模块文案归模块）。
 *
 * 为什么与 `spark/locales.ts` 分开：那份是 **spark 模块自己的**功能文案
 * （收件箱 / 结晶 / 涌现…），由 spark 模块通过注入面消费；这里放的是
 * **dock 壳**的 chrome —— 悬浮球、模块栏、关闭钮、兜底提示。两者用户群、变更节奏与
 * 归属都不同，混在一份字典里会让「壳不许写死模块文案」这条约束失去边界。
 * 注册流程同形（同一次 apply 的 ctx.effect 里一次注册 zh + en）。
 *
 * 交接约定：**模块名不进这份字典**。dock 的兜底提示只说模块 id —— 模块的显示名归
 * 模块自己的字典（壳去翻译模块名就是 F7 的复发）。
 */
export const DOCK_SHELL_NS = 'spark.dock.shell'

export const zh = {
  /** 悬浮球可访问名（无待处理）。 */
  ballOpen: '打开 Spark Dock',
  /** 悬浮球可访问名（有 N 项待处理）：{n} 是计数。 */
  ballOpenPending: '打开 Spark Dock，{n} 项待处理',
  /** 悬浮球 title（hover 提示）。 */
  ballTitle: '打开 Spark Dock',
  ballTitlePending: '打开 Spark Dock · {n} 项待处理',
  /** 指挥舱 dialog 的可访问名。 */
  panelAria: 'Spark Dock',
  /** 模块栏 tablist 的可访问名。 */
  railAria: '插件模块',
  /** 关闭钮。 */
  collapse: '收起面板',
  /** 模块栏空态（一个模块都没注册）。 */
  railEmpty: '没有已加载的插件模块',
  /** header / pane 兜底：记着某个模块 id 但对应插件没加载（{id} = 模块 id）。 */
  moduleNotLoaded: '模块 {id} 未加载：对应插件的 client 半边未激活。',
} as const

export type DockShellLocaleKey = keyof typeof zh

/** 壳取词函数（支持 {n} / {id} 占位符）。 */
export type DockShellT = (key: DockShellLocaleKey, params?: Record<string, string | number>) => string

export const en: Record<DockShellLocaleKey, string> = {
  ballOpen: 'Open Spark Dock',
  ballOpenPending: 'Open Spark Dock, {n} pending',
  ballTitle: 'Open Spark Dock',
  ballTitlePending: 'Open Spark Dock · {n} pending',
  panelAria: 'Spark Dock',
  railAria: 'Plugin modules',
  collapse: 'Collapse panel',
  railEmpty: 'No plugin modules loaded',
  moduleNotLoaded: 'Module {id} is not loaded: the plugin\'s client half is inactive.',
}
