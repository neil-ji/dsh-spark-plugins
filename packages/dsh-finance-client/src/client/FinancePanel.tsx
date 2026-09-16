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
import type { FinancePlanEntry } from 'dsh-spark-finance/types'
import type { FinancePanelState } from './controller.ts'
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
  /** 价格表：一键更新（拉最新目录价）与还原（丢弃用户侧覆盖，回到发版快照）。 */
  updatePrices: () => Promise<void>
  restorePrices: () => Promise<void>
}

const VIEWS: readonly FinanceView[] = ['thisMonth', 'whoToUse', 'saveMore', 'projects']

/** 首开加载态：回填进度来自宿主推的 finance/events 帧，不轮询。 */
function LoadingState({ progress, t }: { progress: FinancePanelState['progress']; t: FinanceTranslate }): ReactNode {
  const total = progress?.total ?? 0
  const scanned = progress?.scanned ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0
  return (
    <div className={css.state} role="status" aria-live="polite" data-testid="finance-loading">
      <p className={css.stateTitle}>{t('loadingTitle')}</p>
      <p className={css.stateBody}>{t('loadingDetail')}</p>
      <div
        className={css.progressTrack}
        role="progressbar"
        aria-label={t('loadingProgress', { scanned, total })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={css.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <p className={css.stateNote}>{t('loadingProgress', { scanned, total })} · {t('loadingReassure')}</p>
    </div>
  )
}

function ErrorState({ message, t, onRetry }: { message: string | null; t: FinanceTranslate; onRetry: () => void }): ReactNode {
  return (
    <div className={css.state} role="status" aria-live="polite" data-testid="finance-error">
      <p className={css.stateTitle}>{t('errorTitle')}</p>
      {message === null ? null : <p className={`${css.stateBody} ${css.error}`}>{message}</p>}
      <Button onClick={onRetry}>{t('retry')}</Button>
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
          : <LoadingState progress={state.progress} t={t} />}
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
              refreshing={state.status === 'loading'}
              onRefresh={props.refresh}
              lastSyncAppliedAt={state.lastSyncAppliedAt}
              priceTable={state.priceTable}
              priceBusy={state.priceBusy}
              priceError={state.priceError}
              onUpdatePrices={props.updatePrices}
              onRestorePrices={props.restorePrices}
            />
          )
          : null}
        {view === 'whoToUse' ? <WhoToUseView ledger={ledger} t={t} /> : null}
        {view === 'saveMore' ? <SaveMoreView ledger={ledger} tiers={state.tiers} t={t} /> : null}
        {view === 'projects' ? <ProjectsView ledger={ledger} t={t} /> : null}
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
