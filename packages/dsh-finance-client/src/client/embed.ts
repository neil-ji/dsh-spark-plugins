/**
 * dsh-spark-finance-client embed entry: library-shaped re-exports for
 * embedders (dsh-spark-dock 悬浮球内嵌完整财务审计卡).
 *
 * 与 index.ts 入口的区别：无 ModuleLoader banner、不碰任何插槽 —— 纯组件 +
 * controller + remote contribution + 字典，由宿主（dock）自行 mount remote、
 * bind settingsScope 并注入 t。
 */
/**
 * **组件级预览专用 barrel（P4：不是产品入口）**。
 *
 * 只被 `dev-harness/preview` 的组件级画布引用（对齐 `…/embed` 这个历史 specifier）；
 * 不产出 `lib/embed.cjs`、不在 `package.json` 的 `exports` 里。产品路径只有
 * `client.js` 自注册（ADR-003）。
 */
export { FinanceCard } from './FinanceCard.tsx'
export type { FinanceCardInjected, FinanceTab } from './FinanceCard.tsx'
export { FinanceCardController, type FinanceRemote } from './FinanceCardController.ts'
export { FinanceAuditController } from './controller.ts'
export type { FinanceAuditState } from './controller.ts'
export type { FinanceAuditInjected } from './FinanceAuditSection.tsx'
export { en, zh, type FinanceKey } from './locales.ts'
export { default as financeRemoteContribution } from 'dsh-spark-finance/remote'
