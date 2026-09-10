/**
 * Finance plugin panel — dock 财务审计模块（以及任何内嵌方）的完整配置面。
 *
 * 交互形制（2026-09 统一）：与 hippomemo 的 MemorySection 一致 —— 顶部一条
 * 全宽 SegmentedControl 页签栏，页面内容按「总览 / 连接 / 供应商 / 高级」四页
 * 拆分，同一时刻只渲染当前页。**没有折叠交互**：不再有 Disclosure 卡头、
 * 也不再有「高级配置」<details>；任何一段内容都只需一次点击（页签）即可到达。
 *
 * 页签划分（对齐页面里已有的分节标题）：
 *  - 总览：财务审计 dashboard（余额/用量/成本图表）+ 仪表盘视图偏好；
 *  - 连接：DeepSeek 余额接口三字段 + 社区价格同步（autoSync / 立即同步 / 数据源）；
 *  - 供应商：ProviderListView（每 provider 的价格与自动获取余额）；
 *  - 高级：power user 的三份价格 JSON 表单（统一默认价 / 供应商默认值 / 价格表）。
 *
 * 页签只切换可见性，草稿状态全部在 FinanceCardController 的 store 里，所以
 * 跨页签编辑同一份 draft，底部保存行（未保存徽标 + 放弃/保存）在四页都可见。
 */

import { useEffect, useRef, useState } from 'react'
import type { SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import { Button, Input, Pill, SegmentedControl, Textarea } from 'dsh-ui-kit'
import { ProviderDefaultsEditor, PriceTableEditor, RateFields } from './PriceEditors.tsx'
import { ProviderListView } from './ProviderListView.tsx'
import { FinanceAuditSection } from './FinanceAuditSection.tsx'
import type { FinanceAuditInjected } from './FinanceAuditSection.tsx'
import type { PriceTableDraft, ProviderDefaultsDraft, RateDraft } from './price-forms.ts'
import type {
  FinanceCardFace,
  FinanceCardFieldName,
  FinanceCardFieldState,
  FinanceCardState,
} from './FinanceCardController.ts'
import type { FinanceKey } from './locales.ts'
import type { DshProviderOverride, FinanceChartPrefs, FinanceLayout } from './persist.ts'
import css from './FinanceCard.module.css'

/** 面板页签：总览 / 连接 / 供应商 / 高级（定价 JSON）。 */
export type FinanceTab = 'overview' | 'connection' | 'providers' | 'advanced'

export interface FinanceCardInjected extends Omit<FinanceCardFace, 'hooks'> {
  useFinanceCard: SnapshotSelectorHook<FinanceCardState>
  /**
   * Dashboard inject props, threaded through from the apply() factory so the
   * overview tab can render `<FinanceAuditSection>` at the top of the panel.
   */
  useSnapshot: FinanceAuditInjected['useSnapshot']
  dashboardRefresh: FinanceAuditInjected['refresh']
  refreshProvider: FinanceAuditInjected['refreshProvider']
}

export interface FinanceCardProps extends FinanceCardInjected {
  t: (key: FinanceKey) => string
}

/** One labelled control: input/textarea + override/invalid badges + reset. */
function Field({ id, label, hint, state, multiline, disabled, invalidLabel, overriddenLabel, resetLabel, onEdit, onReset }: {
  id: string
  label: string
  hint: string
  state: FinanceCardFieldState
  multiline?: boolean
  disabled: boolean
  invalidLabel: string
  overriddenLabel: string
  resetLabel: string
  onEdit: (text: string) => void
  onReset: () => void
}) {
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <label className={css.fieldLabel} htmlFor={id}>{label}</label>
        <span className={css.fieldBadges}>
          {state.overridden ? <Pill>{overriddenLabel}</Pill> : null}
          {state.invalid ? <Pill>{invalidLabel}</Pill> : null}
        </span>
      </div>
      {multiline
        ? <Textarea id={id} className={css.textarea} rows={6} value={state.text} disabled={disabled} spellCheck={false} onChange={(event) => onEdit(event.currentTarget.value)} />
        : <Input id={id} className={css.fieldInput} type="text" value={state.text} disabled={disabled} onChange={(event) => onEdit(event.currentTarget.value)} />}
      <div className={css.fieldFoot}>
        <p className={css.hint}>{hint}</p>
        {state.overridden
          ? <button type="button" className={css.reset} disabled={disabled} onClick={onReset}>{resetLabel}</button>
          : null}
      </div>
    </div>
  )
}

/**
 * Format an epoch-ms moment as a short relative phrase so the "Last sync" badge
 * reads "3 min ago" instead of an absolute timestamp. Falls back to absolute
 * time once the gap passes a week.
 */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return 'just now'
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`
  if (diff < day) return `${Math.floor(diff / hour)} h ago`
  if (diff < 7 * day) return `${Math.floor(diff / day)} d ago`
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * The "价格同步" block. Replaces the three hand-edited price forms with
 * autoSync toggle + Sync now button + last-sync badge + data-source link.
 * Renders nothing when the host predates the sync Remote (syncAvailable=false).
 */
function PriceSyncSection({ t, state, disabled, onSyncNow, onSetAutoSync }: {
  t: (key: FinanceKey) => string
  state: FinanceCardState
  disabled: boolean
  onSyncNow: () => Promise<unknown>
  onSetAutoSync: (next: boolean) => void
}) {
  const { syncState, syncAvailable, prefs } = state
  if (!syncAvailable) return null
  const { lastSync, syncing, lastError } = syncState
  return (
    <div className={css.syncBlock}>
      <div className={css.syncStatusRow}>
        {syncing
          ? <span className={css.syncBadge}>{t('cardSyncing')}</span>
          : null}
        {!syncing && lastError !== null
          ? <span className={css.syncBadgeFailed}>{t('cardSyncFailed')}</span>
          : null}
        {!syncing && lastError === null && lastSync !== null
          ? (
            <span className={css.syncBadge}>
              {t('cardSyncLast')}: {relativeTime(lastSync.appliedAt)} · {lastSync.kept} {t('cardSyncModels')} · fx {lastSync.fx.toFixed(1)}
            </span>
          )
          : null}
        {!syncing && lastError === null && lastSync === null
          ? <span className={css.syncBadgeMuted}>{t('cardSyncNever')}</span>
          : null}
        <a
          className={css.syncLink}
          href="https://models.dev"
          target="_blank"
          rel="noopener noreferrer"
          title={t('cardSyncViewSourceHint')}
        >
          {t('cardSyncViewSource')}
        </a>
      </div>

      <div className={css.syncRow}>
        <label className={css.syncToggle}>
          <input
            type="checkbox"
            checked={prefs.autoSync}
            disabled={disabled}
            onChange={(e) => onSetAutoSync(e.currentTarget.checked)}
            aria-label={t('cardAutoSync')}
          />
          <span className={css.syncToggleLabel}>{t('cardAutoSync')}</span>
        </label>
        <Button
          variant="primary"
          disabled={disabled || syncing}
          onClick={() => { void onSyncNow() }}
          data-testid="finance-sync-now"
        >
          {syncing ? t('cardSyncing') : t('cardSyncNow')}
        </Button>
      </div>

      <p className={css.hint}>{t('cardPriceSyncHint')}</p>
      <p className={css.hint}>{t('cardAutoSyncHint')}</p>

      {lastError !== null
        ? (
          <p className={css.syncError} role="alert">
            {lastError} · {t('cardSyncRetryHint')}
          </p>
        )
        : null}
      <p className={css.syncMeta}>{t('cardPriceSyncSourceAt')}</p>
    </div>
  )
}

/**
 * The panel body: tab bar + the active tab's pane + the shared save row.
 *
 * `tab`/`onTabChange` are controlled so the four panes are individually
 * renderable in tests and so embedders can deep-link a tab.
 */
export function FinanceCardBody({
  t, state, tab, onTabChange,
  useSnapshot, dashboardRefresh, refreshProvider,
  onEdit, onReset, onSave, onDiscard,
  onSetDefaultPrice, onSetProviderDefaults, onSetPriceTable,
  onSetLayout, onToggleChart,
  onSyncNow, onSetAutoSync,
  onSetDshProviderOverride, onClearDshProviderOverride,
  onRetryListProviders,
}: {
  t: (key: FinanceKey) => string
  state: FinanceCardState
  /** Active tab (controlled). */
  tab: FinanceTab
  /** Tab switch request from the SegmentedControl. */
  onTabChange: (tab: FinanceTab) => void
  /** Dashboard inject props — used to mount `<FinanceAuditSection>` in the overview tab. */
  useSnapshot: FinanceAuditInjected['useSnapshot']
  dashboardRefresh: FinanceAuditInjected['refresh']
  refreshProvider: FinanceAuditInjected['refreshProvider']
  onEdit: (field: FinanceCardFieldName, text: string) => void
  onReset: (field: FinanceCardFieldName) => void
  onSave: () => void
  onDiscard: () => void
  onSetDefaultPrice: (draft: RateDraft) => void
  onSetProviderDefaults: (draft: ProviderDefaultsDraft) => void
  onSetPriceTable: (draft: PriceTableDraft) => void
  onSetLayout: (layout: FinanceLayout) => void
  onToggleChart: (key: keyof FinanceChartPrefs) => void
  onSyncNow: () => Promise<unknown>
  onSetAutoSync: (next: boolean) => void
  /** Persist one provider's business fields (localStorage; never touches dsh). */
  onSetDshProviderOverride: (provider: string, override: DshProviderOverride) => void
  /** Drop one provider's business fields, reverting to the dsh snapshot defaults. */
  onClearDshProviderOverride: (provider: string) => void
  /** Retry `listProviders` after a load error. */
  onRetryListProviders: () => void
}) {
  const disabled = !state.writable
  const blocked = !state.dirty || state.invalid || state.saving
  const prefs = state.prefs

  // Cross-controller signal from ProviderListView (dispatched on save/clear of a
  // provider's business fields). While the 总览 tab is active the dashboard
  // listens for it itself; on any other tab the dashboard is unmounted, so the
  // body forwards the signal to the audit controller — otherwise editing
  // autoFetch on the 供应商 tab would leave the balance rows stale until the
  // dashboard's own 30-minute timer or a manual refresh.
  useEffect(() => {
    if (tab === 'overview') return
    const handler = (): void => { dashboardRefresh() }
    window.addEventListener('dsh-finance-dsh-override-changed', handler)
    return () => { window.removeEventListener('dsh-finance-dsh-override-changed', handler) }
  }, [tab, dashboardRefresh])

  const chartToggles: Array<[keyof FinanceChartPrefs, string]> = [
    ['gauge', t('chartGauge')],
    ['kpis', t('chartKpis')],
    ['split', t('chartSplit')],
    ['hourOfDay', t('chartHourOfDay')],
    ['byProvider', t('chartByProvider')],
    ['byModel', t('chartByModel')],
    ['byWorkspace', t('chartByWorkspace')],
    ['byDay', t('chartByDay')],
  ]
  const layoutOptions: Array<[FinanceLayout, string]> = [
    ['compact', t('layoutCompact')],
    ['standard', t('layoutStandard')],
  ]

  return (
    <div className={css.body}>
      {!state.writable ? <p className={css.readOnly} role="status">{t('cardReadOnly')}</p> : null}

      <SegmentedControl<FinanceTab>
        className={css.tabs}
        fullWidth
        ariaLabel={t('cardTabsLabel')}
        options={[
          { value: 'overview', label: t('tabOverview') },
          { value: 'connection', label: t('tabConnection') },
          { value: 'providers', label: t('tabProviders') },
          { value: 'advanced', label: t('tabAdvanced') },
        ]}
        value={tab}
        onChange={onTabChange}
      />

      {tab === 'overview' ? (
        <div className={css.tabPanel} data-testid="finance-tab-overview">
          {/*
            Inline dashboard. The panel hosts the same component that used to
            live at the standalone `settings.section` entry. The dashboard's own
            loading / error / stale-sync paths are unchanged — only the surface
            moves. View preferences (`仪表盘视图偏好`) sit right below it in the
            same tab; toggling a chart re-renders the section above.
          */}
          <div className={css.dashboard} data-testid="finance-card-dashboard">
            <FinanceAuditSection
              useSnapshot={useSnapshot}
              t={t}
              refresh={dashboardRefresh}
              refreshProvider={refreshProvider}
              // No-op close: the dashboard is no longer a sibling section, so
              // there's no parent to close. The section's own header renders a
              // refresh button instead.
              close={(): void => {}}
            />
          </div>

          <div className={css.section}>
            <div className={css.sectionTitle}>{t('cardViewsTitle')}</div>
            <p className={css.sectionHint}>{t('cardViewsHint')}</p>
            <div className={css.prefsRow}>
              <span className={css.prefsLabel}>{t('layout')}</span>
              <SegmentedControl
                options={layoutOptions.map(([value, label]) => ({ value, label }))}
                value={prefs.layout}
                onChange={onSetLayout}
                ariaLabel={t('layout')}
              />
            </div>
            <div className={css.prefsRow}>
              <span className={css.prefsLabel}>{t('charts')}</span>
              {chartToggles.map(([key, label]) => (
                <Pill key={key} active={prefs.charts[key]} onClick={() => onToggleChart(key)}>{label}</Pill>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'connection' ? (
        <div className={css.tabPanel} data-testid="finance-tab-connection">
          <div className={css.section}>
            <div className={css.sectionTitle}>{t('cardDeepseekConnectionTitle')}</div>
            <p className={css.sectionHint}>{t('cardDeepseekConnectionHint')}</p>
            <Field
              id="plugin-config-finance-balance-url"
              label={t('cardBalanceURL')}
              hint={t('cardBalanceURLHint')}
              state={state.balanceBaseURL}
              disabled={disabled}
              invalidLabel={t('invalidText')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              onEdit={(text) => onEdit('balance.baseURL', text)}
              onReset={() => onReset('balance.baseURL')}
            />
            <Field
              id="plugin-config-finance-balance-key"
              label={t('cardBalanceApiKeyEnv')}
              hint={t('cardBalanceApiKeyEnvHint')}
              state={state.balanceApiKeyEnv}
              disabled={disabled}
              invalidLabel={t('invalidText')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              onEdit={(text) => onEdit('balance.apiKeyEnv', text)}
              onReset={() => onReset('balance.apiKeyEnv')}
            />
            <Field
              id="plugin-config-finance-balance-timeout"
              label={t('cardBalanceTimeoutMs')}
              hint={t('cardBalanceTimeoutMsHint')}
              state={state.balanceTimeoutMs}
              disabled={disabled}
              invalidLabel={t('invalidNumber')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              onEdit={(text) => onEdit('balance.timeoutMs', text)}
              onReset={() => onReset('balance.timeoutMs')}
            />
          </div>

          {state.syncAvailable ? (
            <div className={css.section}>
              <div className={css.sectionTitle}>{t('cardPriceSyncTitle')}</div>
              <PriceSyncSection
                t={t}
                state={state}
                disabled={disabled}
                onSyncNow={onSyncNow}
                onSetAutoSync={onSetAutoSync}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'providers' ? (
        <div className={css.tabPanel} data-testid="finance-tab-providers">
          <div className={css.section}>
            <div className={css.sectionTitle}>{t('cardProvidersTitle')}</div>
            <p className={css.sectionHint}>{t('cardProvidersHint')}</p>
            <ProviderListView
              rows={state.dshProviderRows}
              loadError={state.providerListError}
              disabled={disabled}
              t={t}
              onSave={onSetDshProviderOverride}
              onClear={onClearDshProviderOverride}
              onRetry={onRetryListProviders}
            />
          </div>
        </div>
      ) : null}

      {tab === 'advanced' ? (
        <div className={css.tabPanel} data-testid="finance-tab-advanced">
          <div className={css.section}>
            <div className={css.sectionTitle}>{t('cardAdvancedTitle')}</div>
            <p className={css.sectionHint}>{t('cardAdvancedHint')}</p>
            <div className={css.field}>
              <div className={css.fieldHead}>
                <label className={css.fieldLabel} htmlFor="plugin-config-finance-default-price">{t('cardDefaultPriceTitle')}</label>
                <span className={css.fieldBadges}>{state.defaultPrice.overridden ? <Pill>{t('overridden')}</Pill> : null}</span>
              </div>
              <RateFields
                rate={state.defaultPriceDraft}
                idPrefix="plugin-config-finance-default-price"
                t={t}
                onChange={onSetDefaultPrice}
              />
              <div className={css.fieldFoot}>
                <p className={css.hint}>{t('cardDefaultPriceHint')}</p>
                {state.defaultPrice.overridden
                  ? <button type="button" className={css.reset} disabled={disabled} onClick={() => onReset('defaultPrice')}>{t('reset')}</button>
                  : null}
              </div>
            </div>
            <div className={css.field}>
              <div className={css.fieldHead}>
                <label className={css.fieldLabel} htmlFor="plugin-config-finance-provider-defaults">{t('cardProviderDefaultsTitle')}</label>
                <span className={css.fieldBadges}>{state.providerDefaults.overridden ? <Pill>{t('overridden')}</Pill> : null}</span>
              </div>
              <ProviderDefaultsEditor
                value={state.providerDefaultsDraft}
                disabled={disabled}
                t={t}
                onChange={onSetProviderDefaults}
              />
              <div className={css.fieldFoot}>
                <p className={css.hint}>{t('cardProviderDefaultsHint')}</p>
                {state.providerDefaults.overridden
                  ? <button type="button" className={css.reset} disabled={disabled} onClick={() => onReset('providerDefaults')}>{t('reset')}</button>
                  : null}
              </div>
            </div>
            <div className={css.field}>
              <div className={css.fieldHead}>
                <label className={css.fieldLabel} htmlFor="plugin-config-finance-prices">{t('cardPricingTierTitle')}</label>
                <span className={css.fieldBadges}>{state.prices.overridden ? <Pill>{t('overridden')}</Pill> : null}</span>
              </div>
              <PriceTableEditor
                value={state.priceTableDraft}
                disabled={disabled}
                t={t}
                onChange={onSetPriceTable}
              />
              <div className={css.fieldFoot}>
                <p className={css.hint}>{t('cardPricesHint')}</p>
                {state.prices.overridden
                  ? <button type="button" className={css.reset} disabled={disabled} onClick={() => onReset('prices')}>{t('reset')}</button>
                  : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 保存行：跨页签共享（draft 在 controller store 里），所以四页都在底部可见。 */}
      <div className={css.footer}>
        {state.failed ? <p className={css.failed} role="status">{t('saveFailed')}</p> : <span className={css.footerSpacer} />}
        {state.dirty ? <span className={css.pending}>{t('unsaved')}</span> : null}
        <Button variant="secondary" disabled={!state.dirty || state.saving} onClick={onDiscard}>{t('discard')}</Button>
        <Button variant="primary" disabled={blocked} onClick={onSave}>{t(state.saving ? 'saving' : 'save')}</Button>
      </div>
    </div>
  )
}

export function FinanceCard(props: FinanceCardProps) {
  const { t } = props
  const state = props.useFinanceCard(snapshot => snapshot)
  const [tab, setTab] = useState<FinanceTab>('overview')
  const rootRef = useRef<HTMLDivElement | null>(null)
  // The dashboard's empty-state "open provider config" action (ByModelTable)
  // dispatches this window event. We jump to the 供应商 tab and scroll the
  // panel into view so the user lands on the provider forms — no expansion
  // step exists any more (the panel has no collapsed state).
  useEffect(() => {
    const handler = (): void => {
      setTab('providers')
      // rAF defers one frame so the newly active pane has a layout to scroll
      // into (otherwise scrollIntoView measures the previous tab).
      requestAnimationFrame(() => {
        rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
    window.addEventListener('dsh-finance-open-config', handler)
    return () => { window.removeEventListener('dsh-finance-open-config', handler) }
  }, [])
  if (!state.available) return null

  return (
    <div ref={rootRef} className={css.card}>
      <FinanceCardBody
        t={t}
        state={state}
        tab={tab}
        onTabChange={setTab}
        useSnapshot={props.useSnapshot}
        dashboardRefresh={props.dashboardRefresh}
        refreshProvider={props.refreshProvider}
        onEdit={props.edit}
        onReset={props.resetField}
        onSave={props.save}
        onDiscard={props.discard}
        onSetDefaultPrice={props.setDefaultPrice}
        onSetProviderDefaults={props.setProviderDefaults}
        onSetPriceTable={props.setPriceTable}
        onSetLayout={props.setLayout}
        onToggleChart={props.toggleChart}
        onSyncNow={props.syncNow}
        onSetAutoSync={props.setAutoSync}
        onSetDshProviderOverride={props.setDshProviderOverride}
        onClearDshProviderOverride={props.clearDshProviderOverride}
        onRetryListProviders={props.retryListProviders}
      />
    </div>
  )
}
