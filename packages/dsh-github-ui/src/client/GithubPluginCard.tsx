/**
 * GitHub connector configuration card for the Plugins settings section
 * ("设置 → 插件 → 插件配置页"). One disclosure card like the finance /
 * shell / agent-loop cards: the header names the plugin; the body stages the
 * github settings namespace edits (connection, git identity, operation
 * permissions) until save.
 *
 * State model comes from dsh-spark-plugin-kit's StagedSettingsCard (shared staged
 * form over the settings scope); this file is pure presentation. The token
 * VALUE itself is managed through the credential seam on the Github section
 * page — here only the env-style reference name is a setting.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Checkbox, Input, Pill, SegmentedControl, SettingsCardHeader } from 'dsh-ui-kit'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { booleanCardField, choiceCardField, textCardField } from 'dsh-spark-plugin-kit/client'
import type { CardFieldSpec, StagedSettingsCardState, StagedCardActions } from 'dsh-spark-plugin-kit/client'
import type { GithubKey } from './locales.ts'
import styles from './GithubPluginCard.module.css'

/** Card fields edited by this plugin (github settings namespace). */
export type GithubCardFieldName =
  | 'tokenEnv'
  | 'apiBase'
  | 'gitName'
  | 'gitEmail'
  | 'gitProxy'
  | 'defaultVisibility'
  | 'allowCreateRepo'
  | 'allowPush'
  | 'allowPull'
  | 'allowPullRequest'
  | 'allowReview'
  | 'allowPages'
  | 'allowActions'
  | 'allowIssues'
  | 'allowRelease'

/** Field specs for the github settings namespace (mirror of the host Config). */
export const GITHUB_CARD_SPECS: readonly CardFieldSpec[] = [
  textCardField('tokenEnv'),
  textCardField('apiBase'),
  textCardField('gitName'),
  textCardField('gitEmail'),
  textCardField('gitProxy'),
  choiceCardField('defaultVisibility', ['private', 'public']),
  booleanCardField('allowCreateRepo'),
  booleanCardField('allowPush'),
  booleanCardField('allowPull'),
  booleanCardField('allowPullRequest'),
  booleanCardField('allowReview'),
  booleanCardField('allowPages'),
  booleanCardField('allowActions'),
  booleanCardField('allowIssues'),
  booleanCardField('allowRelease'),
]

/** Selector hook the slot renderer synthesizes from the injected store. */
export type GithubCardHook = <S>(selector: (snapshot: StagedSettingsCardState) => S) => S

/**
 * The registration-side face the card's slot entry injects. The inject face
 * carries hooks.githubCard (the store); the slot renderer synthesizes
 * useGithubCard from it, so the component props type spells the hook instead
 * of the raw store.
 */
export interface GithubPluginCardInjected extends StagedCardActions {
  useGithubCard: GithubCardHook
}

/** Props delivered by the slot outlet (inject face spread flat + locale). */
export interface GithubPluginCardProps extends GithubPluginCardInjected {
  t: (key: GithubKey) => string
}

const PERMISSION_FIELDS: readonly GithubCardFieldName[] = [
  'allowCreateRepo', 'allowPush', 'allowPull', 'allowPullRequest', 'allowReview',
  'allowPages', 'allowActions', 'allowIssues', 'allowRelease',
]

/** One labelled text control: input + override/invalid badges + reset. */
function TextField({ id, label, hint, state, disabled, invalidLabel, overriddenLabel, resetLabel, onEdit, onReset, placeholder }: {
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
  placeholder?: string
}): ReactNode {
  return (
    <div className={styles.field}>
      <div className={styles.fieldHead}>
        <label className={styles.fieldLabel} htmlFor={id}>{label}</label>
        <span className={styles.fieldBadges}>
          {state.overridden ? <Pill>{overriddenLabel}</Pill> : null}
          {state.invalid ? <Pill>{invalidLabel}</Pill> : null}
        </span>
      </div>
      <Input id={id} className={styles.fieldInput} type="text" value={state.text} placeholder={placeholder} disabled={disabled} onChange={(event) => onEdit(event.currentTarget.value)} />
      <div className={styles.fieldFoot}>
        <p className={styles.hint}>{hint}</p>
        {state.overridden
          ? <button type="button" className={styles.reset} disabled={disabled} onClick={onReset}>{resetLabel}</button>
          : null}
      </div>
    </div>
  )
}

/** The card's open body: connection / identity / permissions and the save row. */
function GithubCardBody({ t, state, onEdit, onReset, onSave, onDiscard }: {
  t: (key: GithubKey) => string
  state: StagedSettingsCardState
  onEdit: (field: GithubCardFieldName, text: string) => void
  onReset: (field: GithubCardFieldName) => void
  onSave: () => void
  onDiscard: () => void
}): ReactNode {
  const shell = state.shell
  const disabled = !shell.writable
  const blocked = !shell.dirty || shell.invalid || shell.saving
  const field = (name: GithubCardFieldName) => state.fields[name]

  return (
    <div className={styles.body}>
      {!shell.writable ? <p className={styles.readOnly} role="status">{t('cardReadOnly')}</p> : null}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('cardConnectionTitle')}</div>
        <TextField
          id="plugin-config-github-api-base"
          label={t('cardApiBase')}
          hint={t('cardApiBaseHint')}
          state={field('apiBase')}
          disabled={disabled}
          invalidLabel={t('cardInvalidText')}
          overriddenLabel={t('cardOverridden')}
          resetLabel={t('cardReset')}
          onEdit={(text) => onEdit('apiBase', text)}
          onReset={() => onReset('apiBase')}
        />
        <TextField
          id="plugin-config-github-token-env"
          label={t('cardTokenEnv')}
          hint={t('cardTokenEnvHint')}
          state={field('tokenEnv')}
          disabled={disabled}
          invalidLabel={t('cardInvalidText')}
          overriddenLabel={t('cardOverridden')}
          resetLabel={t('cardReset')}
          onEdit={(text) => onEdit('tokenEnv', text)}
          onReset={() => onReset('tokenEnv')}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('identity')}</div>
        <TextField
          id="plugin-config-github-git-name"
          label={t('gitName')}
          hint={t('cardGitNameHint')}
          state={field('gitName')}
          disabled={disabled}
          invalidLabel={t('cardInvalidText')}
          overriddenLabel={t('cardOverridden')}
          resetLabel={t('cardReset')}
          onEdit={(text) => onEdit('gitName', text)}
          onReset={() => onReset('gitName')}
        />
        <TextField
          id="plugin-config-github-git-email"
          label={t('gitEmail')}
          hint={t('cardGitEmailHint')}
          state={field('gitEmail')}
          disabled={disabled}
          invalidLabel={t('cardInvalidText')}
          overriddenLabel={t('cardOverridden')}
          resetLabel={t('cardReset')}
          onEdit={(text) => onEdit('gitEmail', text)}
          onReset={() => onReset('gitEmail')}
        />
        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <span className={styles.fieldLabel}>{t('defaultVisibility')}</span>
          </div>
          <SegmentedControl
            options={[{ value: 'private', label: t('private') }, { value: 'public', label: t('public') }]}
            value={field('defaultVisibility').text === 'public' ? 'public' : 'private'}
            onChange={(value) => onEdit('defaultVisibility', value)}
            ariaLabel={t('defaultVisibility')}
          />
          <p className={styles.hint}>{t('cardVisibilityHint')}</p>
        </div>
        <TextField
          id="plugin-config-github-git-proxy"
          label={t('gitProxy')}
          hint={t('cardGitProxyHint')}
          state={field('gitProxy')}
          disabled={disabled}
          invalidLabel={t('cardInvalidText')}
          overriddenLabel={t('cardOverridden')}
          resetLabel={t('cardReset')}
          placeholder={t('gitProxyPlaceholder')}
          onEdit={(text) => onEdit('gitProxy', text)}
          onReset={() => onReset('gitProxy')}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('permissions')}</div>
        {PERMISSION_FIELDS.map(name => (
          <Checkbox
            key={name}
            checked={field(name).text === 'true'}
            disabled={disabled}
            onChange={(next) => onEdit(name, next ? 'true' : 'false')}
            label={t(name as GithubKey)}
          />
        ))}
        <div className={styles.muted}>{t('workflowScopeNote')}</div>
        <div className={styles.muted}>{t('forcePush')} — {t('notAvailable')}</div>
        <div className={styles.muted}>{t('deleteOperations')} — {t('notAvailable')}</div>
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
export function GithubPluginCard(props: GithubPluginCardProps): ReactNode {
  const { t } = props
  const state = props.useGithubCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (state.shell.available === false) return null

  return (
    <li className={open ? styles.card + ' ' + styles.cardOpen : styles.card}>
      <SettingsCardHeader
        title={t('cardTitle')}
        description={t('cardDescription')}
        open={open}
        onToggle={() => setOpen(!open)}
        trailing={state.shell.dirty ? <span className={styles.pending}>{t('cardUnsaved')}</span> : null}
        expandLabel={t('cardExpand')}
        collapseLabel={t('cardCollapse')}
      />
      {!open ? null : (
        <GithubCardBody
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
