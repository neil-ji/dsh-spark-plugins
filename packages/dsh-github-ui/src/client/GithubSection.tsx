/**
 * Github settings section: token management (credential seam), connection
 * test, and operation-permission configuration through the github Remote
 * namespace. Reuses dsh client primitives so the page matches the shell theme.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Pill, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { GithubSettingsState, GithubSettingsStore } from './store.ts'
import type { GithubConfigView, GithubProxyTestValue } from 'dsh-connector-wire'
import type { GithubKey } from './locales.ts'
import styles from './GithubSection.module.css'

/** Injected dependencies of {@link GithubSection} (slot inject). */
export interface GithubSectionInjected {
  controller: GithubSettingsStore
  useSnapshot: SnapshotSelectorHook<GithubSettingsState>
  t: (key: GithubKey) => string
}

/** Props delivered by the slot outlet (inject face spread flat). */
export type GithubSectionProps = Partial<GithubSectionInjected>

/** One boolean permission row. */
function PermissionRow({ label, checked, disabled, onChange }: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}): ReactNode {
  return (
    <label className={styles.permissionRow}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled === true}
        onChange={(event) => { onChange((event.currentTarget as HTMLInputElement).checked) }}
      />
      <span>{label}</span>
    </label>
  )
}

/**
 * Render the section, or null while the shell has not injected yet.
 * @param props - slot-delivered injected dependencies.
 */
export function GithubSection(props: GithubSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

function Loaded({ injected }: { injected: GithubSectionInjected }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [tokenDraft, setTokenDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [testError, setTestError] = useState<string | undefined>(undefined)
  const [configDraft, setConfigDraft] = useState<GithubConfigView | undefined>(undefined)
  const [proxyTest, setProxyTest] = useState<GithubProxyTestValue | undefined>(undefined)

  if (state.status === 'idle') void controller.load()
  const config = configDraft ?? state.config
  const configDirty = configDraft !== undefined && configDraft !== state.config

  const run = async (action: () => Promise<string | undefined>): Promise<void> => {
    setBusy(true)
    setNotice(undefined)
    const failure = await action()
    setBusy(false)
    if (failure !== undefined) setTestError(failure)
    else setNotice(t('saved'))
  }

  if (state.status === 'error') {
    return (
      <div className={styles.section}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.error}>{t('loadFailed') + ': ' + (state.error ?? '')}</p>
        <Button variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button>
      </div>
    )
  }

  const credentialConfigured = state.credential?.configured === true

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>{t('title')}</h2>
      <p className={styles.intro}>{t('intro')}</p>

      {/* Connection status */}
      <div className={styles.card}>
        <div className={styles.row}>
          <StateDot state={state.whoami !== undefined ? 'done' : credentialConfigured ? 'warning' : 'error'} />
          <span className={styles.cardTitle}>
            {state.whoami !== undefined ? t('connectedAs') : t('notConnected')}
          </span>
          {state.whoami !== undefined
            ? (
              <span className={styles.identity}>
                <Pill>{state.whoami.login}</Pill>
                {state.whoami.name !== null ? <span>{state.whoami.name}</span> : null}
              </span>
            )
            : null}
        </div>
        {state.whoami !== undefined && state.whoami.scopes.length > 0
          ? (
            <div className={styles.scopes}>
              {state.whoami.scopes.map(scope => <Pill key={scope}>{scope}</Pill>)}
            </div>
          )
          : null}
        {testError !== undefined ? <p className={styles.error}>{testError}</p> : null}
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              setTestError(undefined)
              const failure = await controller.testConnection(tokenDraft === '' ? undefined : tokenDraft)
              if (failure !== undefined) { setTestError(failure); return undefined }
              setNotice(t('saved'))
              return undefined
            })
          }}
        >
          {t('testConnection')}
        </Button>
      </div>

      {/* Token (write-only credential) */}
      <div className={styles.card}>
        <div className={styles.row}>
          <StateDot state={credentialConfigured ? 'done' : 'error'} />
          <span className={styles.cardTitle}>
            {credentialConfigured ? t('tokenConfigured') : t('tokenMissing')}
          </span>
          {state.credential?.source !== undefined
            ? <span className={styles.muted}>{t('tokenSource') + ': ' + state.credential.source}</span>
            : null}
        </div>
        <div className={styles.row}>
          <Input
            type="password"
            placeholder={t('tokenPlaceholder')}
            value={tokenDraft}
            onChange={(event) => { setTokenDraft((event.currentTarget as HTMLInputElement).value) }}
            className={styles.grow}
          />
          <Button
            variant="primary"
            disabled={busy || tokenDraft === ''}
            onClick={() => { void run(() => controller.saveToken(tokenDraft).then((f) => { if (f === undefined) setTokenDraft(''); return f })) }}
          >
            {t('saveToken')}
          </Button>
          {credentialConfigured
            ? <Button variant="outline" disabled={busy} onClick={() => { void run(() => controller.removeToken()) }}>{t('removeToken')}</Button>
            : null}
        </div>
      </div>

      {/* Permissions + identity */}
      {config !== undefined
        ? (
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{t('permissions')}</h3>
            <PermissionRow label={t('allowCreateRepo')} checked={config.allowCreateRepo} onChange={(v) => { setConfigDraft({ ...config, allowCreateRepo: v }) }} />
            <PermissionRow label={t('allowPush')} checked={config.allowPush} onChange={(v) => { setConfigDraft({ ...config, allowPush: v }) }} />
            <PermissionRow label={t('allowPull')} checked={config.allowPull} onChange={(v) => { setConfigDraft({ ...config, allowPull: v }) }} />
            <PermissionRow label={t('allowPullRequest')} checked={config.allowPullRequest} onChange={(v) => { setConfigDraft({ ...config, allowPullRequest: v }) }} />
            <PermissionRow label={t('allowReview')} checked={config.allowReview} onChange={(v) => { setConfigDraft({ ...config, allowReview: v }) }} />
            <PermissionRow label={t('allowPages')} checked={config.allowPages} onChange={(v) => { setConfigDraft({ ...config, allowPages: v }) }} />
            <PermissionRow label={t('allowActions')} checked={config.allowActions} onChange={(v) => { setConfigDraft({ ...config, allowActions: v }) }} />
            <PermissionRow label={t('allowIssues')} checked={config.allowIssues} onChange={(v) => { setConfigDraft({ ...config, allowIssues: v }) }} />
            <PermissionRow label={t('allowRelease')} checked={config.allowRelease} onChange={(v) => { setConfigDraft({ ...config, allowRelease: v }) }} />
            <div className={styles.muted}>{t('workflowScopeNote')}</div>
            <div className={styles.muted}>{t('forcePush')} — {t('notAvailable')}</div>
            <div className={styles.muted}>{t('deleteOperations')} — {t('notAvailable')}</div>

            <h3 className={styles.cardTitle}>{t('identity')}</h3>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('gitName')}</span>
              <Input value={config.gitName} onChange={(event) => { setConfigDraft({ ...config, gitName: (event.currentTarget as HTMLInputElement).value }) }} />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('gitEmail')}</span>
              <Input value={config.gitEmail} onChange={(event) => { setConfigDraft({ ...config, gitEmail: (event.currentTarget as HTMLInputElement).value }) }} />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('defaultVisibility')}</span>
              <select
                value={config.defaultVisibility}
                onChange={(event) => { setConfigDraft({ ...config, defaultVisibility: (event.currentTarget as HTMLSelectElement).value as 'private' | 'public' }) }}
              >
                <option value="private">{t('private')}</option>
                <option value="public">{t('public')}</option>
              </select>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('gitProxy')}</span>
              <div className={styles.row}>
                <Input
                  placeholder={t('gitProxyPlaceholder')}
                  value={config.gitProxy}
                  onChange={(event) => { setConfigDraft({ ...config, gitProxy: (event.currentTarget as HTMLInputElement).value }) }}
                  className={styles.grow}
                />
                <Button
                  variant="outline"
                  disabled={busy || config.gitProxy === ''}
                  onClick={() => {
                    void (async () => {
                      setBusy(true)
                      const result = await controller.testProxy(config.gitProxy)
                      setBusy(false)
                      setProxyTest(result)
                    })()
                  }}
                >
                  {busy ? t('proxyTesting') : t('testProxy')}
                </Button>
              </div>
              {proxyTest !== undefined
                ? (
                  <p className={proxyTest.ok ? styles.notice : styles.error} role="status">
                    {proxyTest.ok
                      ? t('proxyOk') + ' · ' + t('proxyTarget') + ' ' + proxyTest.host + ' · ' + proxyTest.latencyMs + 'ms'
                      : t('proxyFail') + ': ' + (proxyTest.error ?? '')}
                  </p>
                )
                : null}
            </div>

            {configDirty
              ? (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      const failure = await controller.saveConfig(configDraft as unknown as Record<string, unknown>)
                      if (failure === undefined) setConfigDraft(undefined)
                      return failure
                    })
                  }}
                >
                  {t('saveConfig')}
                </Button>
              )
              : null}
            {notice !== undefined ? <p className={styles.notice} role="status">{notice}</p> : null}
          </div>
        )
        : null}
    </div>
  )
}
