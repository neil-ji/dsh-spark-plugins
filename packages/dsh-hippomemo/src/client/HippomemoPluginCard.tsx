/**
 * HippoMemo plugin configuration card for the Plugins settings section
 * ("设置 → 插件 → 插件配置页"). One disclosure card like the finance /
 * shell / agent-loop cards: the header names the plugin; the body stages the
 * hippomemo namespace edits (capacity + recall parameters) until save.
 *
 * State model comes from dsh-plugin-kit's StagedSettingsCard (shared staged
 * form over the settings scope); this file is pure presentation.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Pill } from 'dsh-ui-kit'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { StagedSettingsCardState, StagedCardActions } from 'dsh-plugin-kit/client'
import type { HippomemoLocaleKey } from './locales.ts'

/** Card fields edited by this plugin (hippomemo settings namespace). */
export type HippomemoCardFieldName = 'maxMemories' | 'defaultRecallLimit' | 'maxRecallChars'

/** Selector hook the slot renderer synthesizes from the injected store. */
export type HippomemoCardHook = <S>(selector: (snapshot: StagedSettingsCardState) => S) => S

/**
 * The registration-side face the card's slot entry injects. The inject face
 * carries hooks.hippomemoCard (the store); the slot renderer synthesizes
 * useHippomemoCard from it, so the component props type spells the hook
 * instead of the raw store.
 */
export interface HippomemoPluginCardInjected extends StagedCardActions {
  useHippomemoCard: HippomemoCardHook
}

/** Props delivered by the slot outlet (inject face spread flat + locale). */
export interface HippomemoPluginCardProps extends HippomemoPluginCardInjected {
  t: (key: HippomemoLocaleKey) => string
}

/** One labelled number control: input + override/invalid badges + reset. */
function NumberField({ id, label, hint, state, disabled, invalidLabel, overriddenLabel, resetLabel, onEdit, onReset }: {
  id: string
  label: string
  hint: string
  state: { text: string; overridden: boolean; invalid: boolean }
  disabled: boolean
  invalidLabel: string
  overriddenLabel: string
  resetLabel: string
  onEdit: (text: string) => void
  onReset: () => void
}): ReactNode {
  return (
    <div className="hippomemo-card-field">
      <div className="hippomemo-card-field-head">
        <label className="hippomemo-card-field-label" htmlFor={id}>{label}</label>
        <span className="hippomemo-card-field-badges">
          {state.overridden ? <Pill>{overriddenLabel}</Pill> : null}
          {state.invalid ? <Pill>{invalidLabel}</Pill> : null}
        </span>
      </div>
      <Input id={id} className="hippomemo-card-field-input" type="text" inputMode="numeric" value={state.text} disabled={disabled} onChange={(event) => onEdit(event.currentTarget.value)} />
      <div className="hippomemo-card-field-foot">
        <p className="hippomemo-card-hint">{hint}</p>
        {state.overridden
          ? <button type="button" className="hippomemo-card-reset" disabled={disabled} onClick={onReset}>{resetLabel}</button>
          : null}
      </div>
    </div>
  )
}

/** The card's open body: the three capacity/recall fields and the save row. */
function HippomemoCardBody({ t, state, onEdit, onReset, onSave, onDiscard }: {
  t: (key: HippomemoLocaleKey) => string
  state: StagedSettingsCardState
  onEdit: (field: HippomemoCardFieldName, text: string) => void
  onReset: (field: HippomemoCardFieldName) => void
  onSave: () => void
  onDiscard: () => void
}): ReactNode {
  const shell = state.shell
  const disabled = !shell.writable
  const blocked = !shell.dirty || shell.invalid || shell.saving
  const field = (name: HippomemoCardFieldName) => state.fields[name]

  return (
    <div className="hippomemo-card-body">
      {!shell.writable ? <p className="hippomemo-card-readonly" role="status">{t('cardReadOnly')}</p> : null}

      <NumberField
        id="plugin-config-hippomemo-max-memories"
        label={t('cardMaxMemories')}
        hint={t('cardMaxMemoriesHint')}
        state={field('maxMemories')}
        disabled={disabled}
        invalidLabel={t('cardInvalidNumber')}
        overriddenLabel={t('cardOverridden')}
        resetLabel={t('cardReset')}
        onEdit={(text) => onEdit('maxMemories', text)}
        onReset={() => onReset('maxMemories')}
      />
      <NumberField
        id="plugin-config-hippomemo-recall-limit"
        label={t('cardRecallLimit')}
        hint={t('cardRecallLimitHint')}
        state={field('defaultRecallLimit')}
        disabled={disabled}
        invalidLabel={t('cardInvalidNumber')}
        overriddenLabel={t('cardOverridden')}
        resetLabel={t('cardReset')}
        onEdit={(text) => onEdit('defaultRecallLimit', text)}
        onReset={() => onReset('defaultRecallLimit')}
      />
      <NumberField
        id="plugin-config-hippomemo-max-recall-chars"
        label={t('cardMaxRecallChars')}
        hint={t('cardMaxRecallCharsHint')}
        state={field('maxRecallChars')}
        disabled={disabled}
        invalidLabel={t('cardInvalidNumber')}
        overriddenLabel={t('cardOverridden')}
        resetLabel={t('cardReset')}
        onEdit={(text) => onEdit('maxRecallChars', text)}
        onReset={() => onReset('maxRecallChars')}
      />

      <div className="hippomemo-card-footer">
        {shell.failed ? <p className="hippomemo-card-failed" role="status">{t('cardSaveFailed')}</p> : null}
        <Button variant="outline" disabled={!shell.dirty || shell.saving} onClick={onDiscard}>{t('cardDiscard')}</Button>
        <Button variant="primary" disabled={blocked} onClick={onSave}>{t(shell.saving ? 'cardSaving' : 'cardSave')}</Button>
      </div>
    </div>
  )
}

/** Render the card, or nothing while the namespace is not served. */
export function HippomemoPluginCard(props: HippomemoPluginCardProps): ReactNode {
  const { t } = props
  const state = props.useHippomemoCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (state.shell.available === false) return null

  return (
    <li className={open ? 'hippomemo-card hippomemo-card-open' : 'hippomemo-card'}>
      <button
        type="button"
        className="hippomemo-card-header"
        aria-expanded={open}
        aria-label={(open ? t('cardCollapse') : t('cardExpand')) + ': ' + t('cardTitle')}
        onClick={() => setOpen(!open)}
      >
        <span className="hippomemo-card-head-text">
          <span className="hippomemo-card-name">{t('cardTitle')}</span>
          <span className="hippomemo-card-description">{t('cardDescription')}</span>
        </span>
        {state.shell.dirty ? <span className="hippomemo-card-pending">{t('cardUnsaved')}</span> : null}
        <span className={open ? 'hippomemo-card-chevron hippomemo-card-chevron-open' : 'hippomemo-card-chevron'} aria-hidden="true" />
      </button>
      {!open ? null : (
        <HippomemoCardBody
          t={t}
          state={state}
          onEdit={props.edit}
          onReset={props.resetField}
          onSave={props.save}
          onDiscard={props.discard}
        />
      )}
    </li>
  )
}
