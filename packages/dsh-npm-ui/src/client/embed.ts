/**
 * dsh-connector-npm-ui embed entry: library-shaped re-exports for
 * embedders (dsh-spark-dock 悬浮球内嵌完整 npm 设置页).
 *
 * 与 client.ts 入口的区别：无 window.__ModuleLoader__ banner/footer，也不碰
 * 任何插槽 —— 纯组件 + controller + 字典，由宿主（dock）自行 mount remote、
 * 构造 store 并注入 t。
 */
/**
 * **组件级预览专用 barrel（P4：不是产品入口）**。
 *
 * 只被 `dev-harness/preview` 的组件级画布引用（对齐 `…/embed` 这个历史 specifier）；
 * 不产出 `lib/embed.cjs`、不在 `package.json` 的 `exports` 里。产品路径只有
 * `client.js` 自注册（ADR-003）。
 */
export { NpmSection } from './NpmSection.tsx'
export type { NpmSectionInjected, NpmSectionProps } from './NpmSection.tsx'
export { NpmUiStore } from './store.ts'
export type { NpmUiState } from './store.ts'
export { zh, en, type NpmKey } from './locales.ts'
export { NPM_REMOTE_CONTRIBUTION } from 'dsh-connector-npm-wire'
