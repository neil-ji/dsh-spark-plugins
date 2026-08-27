/**
 * Finance plugin configuration card for the Plugins settings section
 * ("设置 → 插件 → 插件配置页"). One disclosure card like the shell/agent-loop
 * cards: the header names the plugin and what its settings govern; the body
 * stages the finance namespace edits (balance connection + price facts) until
 * save, and applies the dashboard view preferences immediately. Pure
 * presentation over the controller's snapshot; the body is a separate export
 * so tests can render it directly.
 */

import { useState } from 'react'
import type { SnapshotSelectorHook } from 'dsh-plugin-kit/client'
import { Button, Input, Pill, SegmentedControl, Textarea } from 'dsh-ui-kit'
import { billingModesToRows } from './billing-modes.ts'
import type { BillingModeRow } from './billing-modes.ts'
import type {
  FinanceCardFace,
  FinanceCardFieldName,
  FinanceCardFieldState,
  FinanceCardState,
} from './FinanceCardController.ts'
import type { FinanceKey } from './locales.ts'
import type { FinanceChartPrefs, FinanceLayout } from './persist.ts'
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

/** The card's open body: connection/pricing fields, view-preferences, and the save row. */
export function FinanceCardBody({ t, state, onEdit, onReset, onSave, onDiscard, onSetBillingModes, onSetLayout, onToggleChart }: {
  t: (key: FinanceKey) => string
  state: FinanceCardState
  onEdit: (field: FinanceCardFieldName, text: string) => void
  onReset: (field: FinanceCardFieldName) => void
  onSave: () => void
  onDiscard: () => void
  onSetBillingModes: (rows: readonly BillingModeRow[]) => void
  onSetLayout: (layout: FinanceLayout) => void
  onToggleChart: (key: keyof FinanceChartPrefs) => void
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
        <div className={css.sectionTitle}>{t('cardConnectionTitle')}</div>
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
        <Field
          id="plugin-config-finance-default-price"
          label={t('cardDefaultPrice')}
          hint={t('cardDefaultPriceHint')}
          state={state.defaultPrice}
          multiline
          disabled={disabled}
          invalidLabel={t('invalidJson')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          onEdit={(text) => onEdit('defaultPrice', text)}
          onReset={() => onReset('defaultPrice')}
        />
        <Field
          id="plugin-config-finance-provider-defaults"
          label={t('cardProviderDefaults')}
          hint={t('cardProviderDefaultsHint')}
          state={state.providerDefaults}
          multiline
          disabled={disabled}
          invalidLabel={t('invalidJson')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          onEdit={(text) => onEdit('providerDefaults', text)}
          onReset={() => onReset('providerDefaults')}
        />
        <div className={css.field}>
          <div className={css.fieldHead}>
            <label className={css.fieldLabel} htmlFor="plugin-config-finance-billing-modes">{t('cardBillingModes')}</label>
            <span className={css.fieldBadges}>{state.billingModes.overridden ? <Pill>{t('overridden')}</Pill> : null}</span>
          </div>
          <BillingModesEditor
            rows={billingModesToRows(state.billingModes.text)}
            disabled={disabled}
            t={t}
            onChange={onSetBillingModes}
          />
          <div className={css.fieldFoot}>
            <p className={css.hint}>{t('cardBillingModesHint')}</p>
            {state.billingModes.overridden
              ? <button type="button" className={css.reset} disabled={disabled} onClick={() => onReset('billingModes')}>{t('reset')}</button>
              : null}
          </div>
        </div>
        <Field
          id="plugin-config-finance-prices"
          label={t('cardPrices')}
          hint={t('cardPricesHint')}
          state={state.prices}
          multiline
          disabled={disabled}
          invalidLabel={t('invalidJson')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          onEdit={(text) => onEdit('prices', text)}
          onReset={() => onReset('prices')}
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

      <div className={css.footer}>
        {state.failed ? <p className={css.failed} role="status">{t('saveFailed')}</p> : null}
        <Button variant="outline" disabled={!state.dirty || state.saving} onClick={onDiscard}>{t('discard')}</Button>
        <Button variant="primary" disabled={blocked} onClick={onSave}>{t(state.saving ? 'saving' : 'save')}</Button>
      </div>
    </div>
  )
}

/**
 * Form-based editor for billing-mode tags: one row per route with a
 * metered/plan switch and a remove button, plus an add-row button. Fully
 * controlled over the staged JSON text — every edit re-serializes, so the
 * existing save/clear/dirty pipeline stays untouched.
 */
function BillingModesEditor({ rows, disabled, t, onChange }: {
  rows: readonly BillingModeRow[]
  disabled: boolean
  t: (key: FinanceKey) => string
  onChange: (rows: readonly BillingModeRow[]) => void
}) {
  const update = (index: number, next: Partial<BillingModeRow>): void => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)))
  }
  return (
    <div id="plugin-config-finance-billing-modes" className={css.billingEditor}>
      {rows.map((row, index) => (
        <div key={`${row.route}-${index}`} className={css.billingRow}>
          <Input
            className={css.billingRouteInput}
            type="text"
            value={row.route}
            disabled={disabled}
            spellCheck={false}
            placeholder="provider | provider/model"
            aria-label={t('billingRouteLabel')}
            onChange={(event) => update(index, { route: event.currentTarget.value })}
          />
          <SegmentedControl
            options={[
              { value: 'metered', label: t('modeMetered') },
              { value: 'plan', label: t('modePlan') },
            ]}
            value={row.mode}
            ariaLabel={`${t('billingModeFor')} ${row.route}`}
            disabled={disabled}
            onChange={(mode) => update(index, { mode })}
          />
          <button
            type="button"
            className={css.billingRemove}
            disabled={disabled}
            aria-label={`${t('removeBillingRoute')}: ${row.route}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={css.billingAdd}
        disabled={disabled}
        onClick={() => onChange([...rows, { route: '', mode: 'plan' }])}
      >
        {t('addBillingRoute')}
      </button>
    </div>
  )
}

export function FinanceCard(props: FinanceCardProps) {
  const { t } = props
  const state = props.useFinanceCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null

  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'cardCollapse' : 'cardExpand')}: ${t('cardTitle')}`}
        onClick={() => setOpen(!open)}
      >
        <span className={css.headText}>
          <span className={css.name}>{t('cardTitle')}</span>
          <span className={css.description}>{t('cardDescription')}</span>
        </span>
        {state.dirty ? <span className={css.pending}>{t('unsaved')}</span> : null}
        <span className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} aria-hidden="true" />
      </button>
      {!open ? null : (
        <FinanceCardBody
          t={t}
          state={state}
          onEdit={props.edit}
          onReset={props.resetField}
          onSave={props.save}
          onDiscard={props.discard}
          onSetBillingModes={props.setBillingModes}
          onSetLayout={props.setLayout}
          onToggleChart={props.toggleChart}
        />
      )}
    </li>
  )
}
