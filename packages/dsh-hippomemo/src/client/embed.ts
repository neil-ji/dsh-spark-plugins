/**
 * dsh-hippomemo embed entry: library-shaped re-exports for embedders
 * (dsh-spark-dock 悬浮球内嵌完整设置面板).
 *
 * 与 client.ts 入口的区别：不带 window.__ModuleLoader__ banner/footer，
 * 不注册 settings.section —— 纯组件 + api 工厂 + CSS + 字典，由宿主
 * （dock）自行注入 api/t/css。与 client bundle 相同的内联规则
 * （dsh-spark-plugin-kit / dsh-ui-kit 内联，react 与平台模块 external），
 * 见 tsdown.config.mjs 的 client-embed 配置块。
 */
export { MemorySection, type MemorySectionProps } from './MemorySection.tsx'
export { createHippomemoApi, type HippomemoApi } from './api.ts'
export { HIPPOMEMO_CSS } from './style.ts'
export { zh, en, type HippomemoLocaleKey } from './locales.ts'
