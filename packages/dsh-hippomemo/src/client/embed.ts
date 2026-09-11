/**
 * **组件级预览专用 barrel（P4：不是产品入口）**。
 *
 * 只被 `dev-harness/preview` 的组件级画布引用（对齐 `…/embed` 这个历史 specifier）；
 * 不产出 `lib/embed.cjs`、不在 `package.json` 的 `exports` 里（tsdown 的
 * client-embed 配置块已删除）。产品路径只有 `client.js` 自注册（ADR-003）。
 */
export { MemorySection, type MemorySectionProps } from './MemorySection.tsx'
export { createHippomemoApi, type HippomemoApi, setHippomemoEventChannel } from './api.ts'
export { startHippomemoEvents } from './start.ts'
export { HIPPOMEMO_CSS } from './style.ts'
export { zh, en, type HippomemoLocaleKey } from './locales.ts'
