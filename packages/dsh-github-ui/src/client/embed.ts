/**
 * dsh-connector-github-ui embed entry: library-shaped re-exports for
 * embedders (dsh-spark-dock 悬浮球内嵌完整 GitHub 设置页).
 *
 * 与 client.ts 入口的区别：无 window.__ModuleLoader__ banner/footer，也不碰
 * 任何插槽 —— 纯组件 + controller + 字典，由宿主（dock）自行 mount remote、
 * 构造 store 并注入 t。
 */
/**
 * **组件级预览专用 barrel（P4：不是产品入口）**。
 *
 * 本文件只被 `dev-harness/preview` 的组件级单渲染画布引用，对齐 `…/embed` 这个
 * 历史 specifier；它**不产出** `lib/embed.cjs`，也不在 `package.json` 的 `exports`
 * 里（P4 已删除第二产物）。产品路径只有一条：`client.js` 在自己的 `apply()` 里
 * 用 `registerDockModule()` 自注册（ADR-003）。
 */
export { GithubSection } from './GithubSection.tsx'
export type { GithubSectionInjected, GithubSectionProps } from './GithubSection.tsx'
export { GithubSettingsStore } from './store.ts'
export type { GithubSettingsState } from './store.ts'
export { zh, en, type GithubKey } from './locales.ts'
export { GITHUB_REMOTE_CONTRIBUTION } from 'dsh-connector-wire'
