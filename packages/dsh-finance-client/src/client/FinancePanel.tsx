/**
 * 财务面板（重建版）：子导航是面板内容的第一件东西。
 *
 * 形制与 hippomemo MemorySection 一致：`<子页签栏>` 紧贴面板内容开头，**上面不放任何
 * 指标/操作**；四态（加载/错误/空/就绪）与所有卡片、脚注都归各自的 tab 所有。
 * 嵌进 dock 时模块名与一句话说明由 dock 模块头提供，这里不再画大标题。
 */

import { useState, type ReactNode } from 'react'
import { Button, SegmentedControl } from 'dsh-ui-kit'
import type { SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import type { FinancePlanEntry, FinanceProviderBillingMode } from 'dsh-spark-finance/types'
import type { FinancePanelState } from './controller.ts'
import type { FinanceProviderEntryPatch } from './plans.ts'
import type { FinanceTranslate } from './locales.ts'
import { ProjectsView } from './views/ProjectsView.tsx'
import { SaveMoreView } from './views/SaveMoreView.tsx'
import { ThisMonthView } from './views/ThisMonthView.tsx'
import { WhoToUseView } from './views/WhoToUseView.tsx'
import css from './panel.module.css'

export type FinanceView = 'thisMonth' | 'whoToUse' | 'saveMore' | 'projects'

export interface FinancePanelInjected {
  useSnapshot: SnapshotSelectorHook<FinancePanelState>
  t: FinanceTranslate
  refresh: () => void
  refreshProvider: (provider: string) => Promise<void>
  /** P1：套餐（月费）写回 settings 的 `finance.plans`。 */
  savePlan: (plan: FinancePlanEntry) => Promise<void>
  removePlan: (provider: string) => Promise<void>
  /** 计费方式标记：订阅 / 按量 / 免费（provider 级）。 */
  setBillingMode: (provider: string, mode: FinanceProviderBillingMode) => Promise<void>
  /** 打标（SPEC §5.4 两池）：计费方式 + 手动余额 / autoFetch + 可选月费条目。 */
  tagProvider: (
    provider: string,
    patch: FinanceProviderEntryPatch,
    plan?: FinancePlanEntry,
  ) => Promise<void>
  /** 价格表：一键更新（拉最新目录价）与还原（丢弃用户侧覆盖，回到发版快照）。 */
  updatePrices: () => Promise<void>
  restorePrices: () => Promise<void>
}

const VIEWS: readonly FinanceView[] = ['thisMonth', 'whoToUse', 'saveMore', 'projects']

/**
 * 首开初始化态：全流程 0–100% 进度条（回填重放 + 账本聚合两段加权）+
 * 宿主推送的后台动作小字日志。不放帮助/提示文案 —— 日志本身就是表意。
 */
function LoadingState({ progress, lines, t }: {
  progress: FinancePanelState['progress']
  lines: readonly string[]
  t: FinanceTranslate
}): ReactNode {
  const pct = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)))
  const tail = lines.slice(-6)
  return (
    <div className={css.state} role="status" aria-live="polite" data-testid="finance-loading">
      <p className={css.stateTitle}>{t('loadingTitle')}</p>
      <div
        className={css.progressTrack}
        role="progressbar"
        aria-label={t('loadingTitle')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={css.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <p className={css.stateNote}>{pct}%</p>
      {/* 后台动作日志：等宽小字逐行打印（宿主结构化数据，不进 locale）。 */}
      <div className={css.initLog} data-testid="finance-init-log">
        {tail.map((line, index) => (
          <p key={`${index}-${line}`} className={css.initLogLine}>{line}</p>
        ))}
      </div>
    </div>
  )
}

function ErrorState({ message, t, onRetry }: { message: string | null; t: FinanceTranslate; onRetry: () => void }): ReactNode {
  return (
    <div className={css.state} role="status" aria-live="polite" data-testid="finance-error">
      <p className={css.stateTitle}>{t('errorTitle')}</p>
      {message === null ? null : <p className={`${css.stateBody} ${css.error}`}>{message}</p>}
      {/* 整面板错误态里唯一可点的动作 —— UI-UX-SPEC §4.4「行内 error 文案 + 重试主按钮」，
          显式写成 primary 是为了让「面板里不出现隐式 primary」这条口径可 grep。 */}
      <Button variant="primary" onClick={onRetry}>{t('retry')}</Button>
    </div>
  )
}

/** 面板本体：加载/错误态之外，内容一律是「子页签栏 + 当前 tab」。 */
export function FinancePanel(props: FinancePanelInjected): ReactNode {
  // SnapshotSelectorHook 是「选择器 → 值」形态（kit 的 uSES 绑定），因此显式传选择器。
  const state = props.useSnapshot<FinancePanelState>((snapshot) => snapshot)
  const { t } = props
  const [view, setView] = useState<FinanceView>('thisMonth')
  const ledger = state.ledger

  if (ledger === undefined) {
    return (
      <div className={css.panel} data-testid="finance-panel">
        {state.status === 'error'
          ? <ErrorState message={state.error} t={t} onRetry={props.refresh} />
          : <LoadingState progress={state.progress} lines={state.progressLines} t={t} />}
      </div>
    )
  }

  const options = VIEWS.map((value) => ({ value, label: t(viewKey(value)) }))

  return (
    <div className={css.panel} data-testid="finance-panel">
      {/* 面板内容的第一件东西：子导航。指标、操作、脚注都归各自的 tab。 */}
      <div className={css.tabs} data-testid="finance-tabs">
        <SegmentedControl<FinanceView>
          options={options}
          value={view}
          onChange={setView}
          ariaLabel={t('cardTabsLabel')}
          fullWidth
        />
      </div>

      <div className={css.view} data-testid={`finance-view-${view}`}>
        {view === 'thisMonth'
          ? (
            <ThisMonthView
              ledger={ledger}
              providerList={state.providerList}
              t={t}
              refreshProvider={props.refreshProvider}
              plans={state.plans}
              plansWritable={state.plansWritable}
              savePlan={props.savePlan}
              removePlan={props.removePlan}
              onSetBillingMode={props.setBillingMode}
              onTagProvider={props.tagProvider}
              refreshing={state.refreshing === true}
              onRefresh={props.refresh}
              lastSyncAppliedAt={state.lastSyncAppliedAt}
              priceTable={state.priceTable}
              priceAction={state.priceAction}
              priceError={state.priceError}
              onUpdatePrices={props.updatePrices}
              onRestorePrices={props.restorePrices}
            />
          )
          : null}
        {view === 'whoToUse' ? <WhoToUseView ledger={ledger} t={t} /> : null}
        {view === 'saveMore'
          ? <SaveMoreView ledger={ledger} tiers={state.tiers} shadowedTierKeys={state.shadowedTierKeys} t={t} />
          : null}
        {view === 'projects' ? <ProjectsView ledger={ledger} plans={state.plans} t={t} /> : null}
      </div>
    </div>
  )
}

function viewKey(view: FinanceView): 'tabThisMonth' | 'tabWhoToUse' | 'tabSaveMore' | 'tabProjects' {
  if (view === 'thisMonth') return 'tabThisMonth'
  if (view === 'whoToUse') return 'tabWhoToUse'
  if (view === 'saveMore') return 'tabSaveMore'
  return 'tabProjects'
}
