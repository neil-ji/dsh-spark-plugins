/**
 * Finance plugin configuration card for the Plugins settings section
 * ("设置 → 插件 → 插件配置页"). One disclosure card like the shell/agent-loop
 * cards: the header names the plugin and what its settings govern; the body
 * stages the finance namespace edits (balance connection + plan/metered route
 * tags) until save, and exposes the community-price sync block
 * (autoSync toggle + Sync now button + last-sync badge + data-source link).
 *
 * The three price-shape JSON forms (defaultPrice / providerDefaults / prices)
 * live behind a collapsed <details> called "高级配置（JSON）" so regular users
 * never see them — they're for power users who really want to maintain the
 * table by hand. The dashboard view prefs always stay visible at the bottom.
 */

import { useEffect, useState } from 'react'
import type { SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import { Button, Input, Pill, SegmentedControl, SettingsCardHeader, Textarea } from 'dsh-ui-kit'
import { ProviderDefaultsEditor, PriceTableEditor, RateFields } from './PriceEditors.tsx'
import { ProviderListView } from './ProviderListView.tsx'
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

export interface FinanceCardInjected extends Omit<FinanceCardFace, 'hooks'> {
  useFinanceCard: SnapshotSelectorHook<FinanceCardState>
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
          <p className={css.syncError} role="status">
            {lastError} · {t('cardSyncRetryHint')}
          </p>
        )
        : null}
      <p className={css.syncMeta}>{t('cardPriceSyncSourceAt')}</p>
    </div>
  )
}

/** The card's open body: connection + provider list + sync + plan/metered tags + advanced JSON + dashboard prefs + save row. */
export function FinanceCardBody({ t, state, onEdit, onReset, onSave, onDiscard, onSetDefaultPrice, onSetProviderDefaults, onSetPriceTable, onSetLayout, onToggleChart, onSyncNow, onSetAutoSync, onSetDshProviderOverride, onClearDshProviderOverride }: {
  t: (key: FinanceKey) => string
  state: FinanceCardState
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
}) {
  const disabled = !state.writable
  const blocked = !state.dirty || state.invalid || state.saving
  const prefs = state.prefs
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

      <div className={css.section}>
        <div className={css.sectionTitle}>{t('cardDeepseekConnectionTitle')}</div>
        <p className={css.sectionHint}>{t('cardDeepseekConnectionHint')}</p>
        <Field
          id="plugin-config-finance-currency"
          label={t('cardCurrency')}
          hint={t('cardCurrencyHint')}
          state={state.currency}
          disabled={disabled}
          invalidLabel={t('invalidText')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          onEdit={(text) => onEdit('currency', text)}
          onReset={() => onReset('currency')}
        />
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

      <div className={css.section}>
        <div className={css.sectionTitle}>{t('cardProvidersTitle')}</div>
        <p className={css.sectionHint}>{t('cardProvidersHint')}</p>
        <ProviderListView
          rows={state.dshProviderRows}
          disabled={disabled}
          t={t}
          onSave={onSetDshProviderOverride}
          onClear={onClearDshProviderOverride}
        />
      </div>

      <details className={css.advancedDetails}>
          <summary className={css.advancedSummary}>{t('cardAdvancedTitle')}</summary>
          <p className={css.advancedHint}>{t('cardAdvancedHint')}</p>
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
        </details>

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

      <div className={css.footer}>
        {state.failed ? <p className={css.failed} role="status">{t('saveFailed')}</p> : null}
        <Button variant="outline" disabled={!state.dirty || state.saving} onClick={onDiscard}>{t('discard')}</Button>
        <Button variant="primary" disabled={blocked} onClick={onSave}>{t(state.saving ? 'saving' : 'save')}</Button>
      </div>
    </div>
  )
}

export function FinanceCard(props: FinanceCardProps) {
  const { t } = props
  const state = props.useFinanceCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  // Commit 21 followup: the dashboard's empty-state "open config" action dispatches
  // this window event. We catch it, expand the card, and scroll it into view
  // so the user lands on the provider form.
  useEffect(() => {
    const handler = (): void => {
      setOpen(true)
    }
    window.addEventListener('dsh-finance-open-config', handler)
    return () => { window.removeEventListener('dsh-finance-open-config', handler) }
  }, [])
  if (!state.available) return null

  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <SettingsCardHeader
        title={t('cardTitle')}
        description={t('cardDescription')}
        open={open}
        onToggle={() => setOpen(!open)}
        trailing={state.dirty ? <span className={css.pending}>{t('unsaved')}</span> : null}
        expandLabel={t('cardExpand')}
        collapseLabel={t('cardCollapse')}
      />
      {!open ? null : (
        <FinanceCardBody
          t={t}
          state={state}
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
        />
      )}
    </li>
  )
}
