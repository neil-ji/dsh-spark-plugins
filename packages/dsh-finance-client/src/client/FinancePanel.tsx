/**
 * 财务面板（重建版）：四个决策视图共用一个壳。
 *
 * 组织轴是「采购与调度决策」，不是配置：本月值不值 / 该用谁 / 怎么调度更省 / 项目账。
 * 配置面（价格表、供应商覆盖层、视图偏好）已整页删除——预置兜底值只在后台参与计算，
 * 不出现在编辑面（见 docs/plans/2026-09-14-finance-rebuild-design.md）。
 */

import { useState, type ReactNode } from 'react'
import { Button, EmptyState, Money, SegmentedControl, Stat, StatGrid } from 'dsh-ui-kit'
import type { SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
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

function minutesSince(epochMs: number): number {
  return Math.max(0, Math.round((Date.now() - epochMs) / 60_000))
}

/**
 * 财务面板本体。dock 模块头已经给出模块名与一句话说明，这里只有内容：
 * 工具栏（更新时间 + 刷新）→ 四个总量数字 → 视图页签 → 视图内容 → 脚注。
 */
export function FinancePanel(props: FinancePanelInjected): ReactNode {
  // SnapshotSelectorHook 是「选择器 → 值」形态（kit 的 uSES 绑定），因此显式传选择器。
  const state = props.useSnapshot<FinancePanelState>((snapshot) => snapshot)
  const { t } = props
  const [view, setView] = useState<FinanceView>('thisMonth')
  const ledger = state.ledger

  if (ledger === undefined) {
    if (state.status === 'error') {
      return <div className={css.panel} data-testid="finance-panel"><ErrorState message={state.error} t={t} onRetry={props.refresh} /></div>
    }
    return <div className={css.panel} data-testid="finance-panel"><LoadingState progress={state.progress} t={t} /></div>
  }

  const currency = ledger.currency === '' ? 'CNY' : ledger.currency
  const options = VIEWS.map((value) => ({ value, label: t(viewKey(value)) }))

  return (
    <div className={css.panel} data-testid="finance-panel">
      <div className={css.toolbar}>
        <div className={css.toolbarMeta}>
          <span data-testid="finance-updated">
            {ledger.generatedAt > 0 ? t('lastUpdated', { minutes: minutesSince(ledger.generatedAt) }) : t('lastUpdatedNever')}
          </span>
        </div>
        <Button onClick={props.refresh} disabled={state.status === 'loading'} aria-label={t('refresh')}>
          {state.status === 'loading' ? t('refreshing') : t('refresh')}
        </Button>
      </div>

      <StatGrid className={css.stats}>
        <div data-testid="finance-stat-cost">
          <Stat label={t('metricCost')} value={<Money micros={ledger.totalCostMicros} currency={currency} />} />
        </div>
        <div data-testid="finance-stat-metered">
          <Stat
            label={t('metricMetered')}
            value={ledger.meteredCostMicros === undefined ? t('noData') : <Money micros={ledger.meteredCostMicros} currency={currency} />}
          />
        </div>
        <div data-testid="finance-stat-plan">
          <Stat
            label={t('metricPlan')}
            value={ledger.planEquivalentCostMicros === undefined ? t('noData') : <Money micros={ledger.planEquivalentCostMicros} currency={currency} />}
          />
        </div>
        <div data-testid="finance-stat-sessions">
          <Stat label={t('metricSessions')} value={ledger.sessionCount} />
        </div>
        <div data-testid="finance-stat-workspaces">
          <Stat label={t('metricWorkspaces')} value={ledger.workspaceCount} />
        </div>
      </StatGrid>

      <SegmentedControl<FinanceView>
        className={css.tabs}
        options={options}
        value={view}
        onChange={setView}
        ariaLabel={t('cardTabsLabel')}
        fullWidth
      />

      {ledger.sessionCount === 0
        ? (
          <div data-testid="finance-empty">
            <EmptyState message={t('emptyTitle')} hint={t('emptyHint')} />
          </div>
        )
        : (
          <div className={css.view} data-testid={`finance-view-${view}`}>
            {view === 'thisMonth' ? <ThisMonthView ledger={ledger} providerList={state.providerList} t={t} refreshProvider={props.refreshProvider} /> : null}
            {view === 'whoToUse' ? <WhoToUseView ledger={ledger} t={t} /> : null}
            {view === 'saveMore' ? <SaveMoreView ledger={ledger} t={t} /> : null}
            {view === 'projects' ? <ProjectsView ledger={ledger} t={t} /> : null}
          </div>
        )}

      <div className={css.footer}>
        <p className={css.footerNote}>{priceNote(state.lastSyncAppliedAt, t)}</p>
        <p className={css.footerNote}>{t('estimateNote')}</p>
        {ledger.unreadableSessions.length > 0
          ? <p className={css.footerNote}>{t('unreadableNote', { count: ledger.unreadableSessions.length })}</p>
          : null}
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

const STALE_MS = 24 * 60 * 60 * 1000

/** 价格来源脚注：说清账本用的是哪一层价格，以及新鲜度。 */
export function priceNote(lastSyncAppliedAt: number | undefined, t: FinanceTranslate): string {
  if (lastSyncAppliedAt === undefined) {
    return `${t('priceNoteNever')} · ${t('priceStale')}`
  }
  const minutes = minutesSince(lastSyncAppliedAt)
  const when = t('lastUpdated', { minutes })
  if (Date.now() - lastSyncAppliedAt > STALE_MS) return `${t('priceNote', { when })} · ${t('priceStale')}`
  return t('priceNote', { when })
}
