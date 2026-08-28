/**
 * npm connector configuration card for the Plugins settings section
 * ("设置 → 插件 → 插件配置页"). One disclosure card editing the npm settings
 * namespace (registry root). State model comes from dsh-spark-plugin-kit's
 * StagedSettingsCard; this file is pure presentation.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Pill } from 'dsh-ui-kit'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { textCardField } from 'dsh-spark-plugin-kit/client'
import type { CardFieldSpec, StagedSettingsCardState, StagedCardActions } from 'dsh-spark-plugin-kit/client'
import type { NpmKey } from './locales.ts'
import styles from './NpmPluginCard.module.css'

/** Card fields edited by this plugin (npm settings namespace). */
export type NpmCardFieldName = 'registry'

/** Field specs for the npm settings namespace. */
export const NPM_CARD_SPECS: readonly CardFieldSpec[] = [
  textCardField('registry'),
]

/** Selector hook the slot renderer synthesizes from the injected store. */
export type NpmCardHook = <S>(selector: (snapshot: StagedSettingsCardState) => S) => S

/**
 * The registration-side face the card's slot entry injects. The inject face
 * carries hooks.npmCard (the store); the slot renderer synthesizes useNpmCard
 * from it, so the component props type spells the hook instead of the raw store.
 */
export interface NpmPluginCardInjected extends StagedCardActions {
  useNpmCard: NpmCardHook
}

/** Props delivered by the slot outlet (inject face spread flat + locale). */
export interface NpmPluginCardProps extends NpmPluginCardInjected {
  t: (key: NpmKey) => string
}

/** The card's open body: the registry field and the save row. */
function NpmCardBody({ t, state, onEdit, onReset, onSave, onDiscard }: {
  t: (key: NpmKey) => string
  state: StagedSettingsCardState
  onEdit: (field: NpmCardFieldName, text: string) => void
  onReset: (field: NpmCardFieldName) => void
  onSave: () => void
  onDiscard: () => void
}): ReactNode {
  const shell = state.shell
  const disabled = !shell.writable
  const blocked = !shell.dirty || shell.invalid || shell.saving
  const registry = state.fields.registry

  return (
    <div className={styles.body}>
      {!shell.writable ? <p className={styles.readOnly} role="status">{t('cardReadOnly')}</p> : null}

      <div className={styles.field}>
        <div className={styles.fieldHead}>
          <label className={styles.fieldLabel} htmlFor="plugin-config-npm-registry">{t('cardRegistry')}</label>
          <span className={styles.fieldBadges}>
            {registry.overridden ? <Pill>{t('cardOverridden')}</Pill> : null}
            {registry.invalid ? <Pill>{t('cardInvalidText')}</Pill> : null}
          </span>
        </div>
        <Input
          id="plugin-config-npm-registry"
          className={styles.fieldInput}
          type="text"
          value={registry.text}
          placeholder="https://registry.npmjs.org"
          disabled={disabled}
          onChange={(event) => onEdit('registry', event.currentTarget.value)}
        />
        <div className={styles.fieldFoot}>
          <p className={styles.hint}>{t('cardRegistryHint')}</p>
          {registry.overridden
            ? <button type="button" className={styles.reset} disabled={disabled} onClick={() => onReset('registry')}>{t('cardReset')}</button>
            : null}
        </div>
      </div>

      <div className={styles.footer}>
        {shell.failed ? <p className={styles.failed} role="status">{t('cardSaveFailed')}</p> : null}
        <Button variant="outline" disabled={!shell.dirty || shell.saving} onClick={onDiscard}>{t('cardDiscard')}</Button>
        <Button variant="primary" disabled={blocked} onClick={onSave}>{t(shell.saving ? 'cardSaving' : 'cardSave')}</Button>
      </div>
    </div>
  )
}

/** Render the card, or nothing while the namespace is not served. */
export function NpmPluginCard(props: NpmPluginCardProps): ReactNode {
  const { t } = props
  const state = props.useNpmCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (state.shell.available === false) return null

  return (
    <li className={open ? styles.card + ' ' + styles.cardOpen : styles.card}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={open}
        aria-label={(open ? t('cardCollapse') : t('cardExpand')) + ': ' + t('cardTitle')}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.headText}>
          <span className={styles.name}>{t('cardTitle')}</span>
          <span className={styles.description}>{t('cardDescription')}</span>
        </span>
        {state.shell.dirty ? <span className={styles.pending}>{t('cardUnsaved')}</span> : null}
        <span className={open ? styles.chevron + ' ' + styles.chevronOpen : styles.chevron} aria-hidden="true" />
      </button>
      {!open ? null : (
        <NpmCardBody
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
