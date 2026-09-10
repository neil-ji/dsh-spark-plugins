/**
 * dsh-spark-finance-client embed entry: library-shaped re-exports for
 * embedders (dsh-spark-dock 悬浮球内嵌完整财务审计卡).
 *
 * 与 index.ts 入口的区别：无 ModuleLoader banner、不注册 settings.plugin.item
 * —— 纯组件 + controller + remote contribution + 字典，由宿主（dock）自行
 * mount remote、bind settingsScope 并注入 t。
 */
export { FinanceCard } from './FinanceCard.tsx'
export type { FinanceCardInjected, FinanceTab } from './FinanceCard.tsx'
export { FinanceCardController, type FinanceRemote } from './FinanceCardController.ts'
export { FinanceAuditController } from './controller.ts'
export type { FinanceAuditState } from './controller.ts'
export type { FinanceAuditInjected } from './FinanceAuditSection.tsx'
export { en, zh, type FinanceKey } from './locales.ts'
export { default as financeRemoteContribution } from 'dsh-spark-finance/remote'
