/**
 * **组件级预览专用 barrel（P4：不是产品入口）**。
 *
 * 只被 `dev-harness/preview` 的组件级画布引用（对齐 `…/embed` 这个历史 specifier）；
 * 不产出 `lib/embed.cjs`、不在 `package.json` 的 `exports` 里。产品路径只有
 * `client.js` 自注册（ADR-003）。
 */
export { FinancePanel, type FinancePanelInjected, type FinanceView } from './FinancePanel.tsx'
export { WhoToUseView, type WhoToUseViewProps } from './views/WhoToUseView.tsx'
export { ThisMonthView, type ThisMonthViewProps } from './views/ThisMonthView.tsx'
export { SaveMoreView, type SaveMoreViewProps } from './views/SaveMoreView.tsx'
export { FinancePanelController, type FinancePanelState, type FinancePlanSeam } from './controller.ts'
export { createPlanSeam, normalizePlanList, majorToMicros, microsToMajor, type FinanceSettingsSection, type FinanceProviderEntryPatch } from './plans.ts'
export { en, zh, type FinanceKey, type FinanceTranslate } from './locales.ts'
export { FINANCE_REMOTE_CONTRIBUTION as financeRemoteContribution } from 'dsh-spark-finance-wire'
