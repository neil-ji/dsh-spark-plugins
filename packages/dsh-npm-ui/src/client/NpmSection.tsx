/**
 * npm release settings section: token management (credential seam: paste ->
 * test connection -> save) plus a read-only registry/kit status panel.
 * Token-first: the UI only handles credentials and passive status — every
 * query/action (package name check, trust status, publish, launch) is done
 * by the agent through its tools (npm_package_check / npm_trust_list /
 * npm_trust_status / npm_launch ...).
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Pill, StateDot } from 'dsh-ui-kit'
import type { SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import type { NpmUiState, NpmUiStore } from './store.ts'
import type { NpmKey } from './locales.ts'
import styles from './NpmSection.module.css'

/** Injected dependencies of {@link NpmSection} (slot inject). */
export interface NpmSectionInjected {
  controller: NpmUiStore
  useSnapshot: SnapshotSelectorHook<NpmUiState>
  t: (key: NpmKey) => string
}

/** Props delivered by the slot outlet (inject face spread flat). */
export type NpmSectionProps = Partial<NpmSectionInjected>

/**
 * Render the section, or null while the shell has not injected yet.
 * @param props - slot-delivered injected dependencies.
 */
export function NpmSection(props: NpmSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

function Loaded({ injected }: { injected: NpmSectionInjected }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [tokenDraft, setTokenDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  if (state.status === 'idle') void controller.load()
  const statusView = state.statusView
  const credentialConfigured = state.credential?.configured === true
  const tokenLogin = state.token?.login

  const run = async (action: () => Promise<string | undefined>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    const failure = await action()
    setBusy(false)
    if (failure !== undefined) setError(failure)
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

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>{t('title')}</h2>
      <p className={styles.intro}>{t('intro')}</p>

      {/* Connection status + token management */}
      <div className={styles.card}>
        <div className={styles.row}>
          <StateDot state={tokenLogin !== null && tokenLogin !== undefined ? 'done' : credentialConfigured ? 'warning' : 'error'} />
          <span className={styles.cardTitle}>
            {tokenLogin !== null && tokenLogin !== undefined ? t('connectedAs') : t('notConnected')}
          </span>
          {tokenLogin !== null && tokenLogin !== undefined
            ? <Pill>{tokenLogin}</Pill>
            : null}
          {state.token?.source !== undefined
            ? <span className={styles.muted}>{state.token.source}</span>
            : null}
        </div>
        {state.test !== undefined
          ? (
            <p className={state.test.ok ? styles.notice : styles.error} role="status">
              {state.test.ok
                ? t('testOk') + (state.test.login !== null ? ': ' + state.test.login : '')
                : t('testFail') + ': ' + (state.test.detail ?? '')}
            </p>
          )
          : null}
        <div className={styles.row}>
          <Input
            type="password"
            placeholder={t('tokenPlaceholder')}
            value={tokenDraft}
            onChange={(event) => { setTokenDraft((event.currentTarget as HTMLInputElement).value) }}
            className={styles.grow}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                setError(undefined)
                setNotice(undefined)
                const failure = await controller.testConnection(tokenDraft === '' ? undefined : tokenDraft)
                setBusy(false)
                if (failure !== undefined) setError(failure)
                else setNotice(t('testDone'))
              })()
            }}
          >
            {busy ? t('testing') : t('testConnection')}
          </Button>
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
        {state.credential?.source !== undefined
          ? <p className={styles.muted}>{t('tokenSource') + ': ' + state.credential.source + (state.credential.writable ? '' : ' (' + t('readOnly') + ')')}</p>
          : null}
        {state.token !== undefined
          ? <p className={styles.muted}>{state.token.configured ? t('tokenHintOk') : t('tokenHintMissing')}</p>
          : null}
      </div>

      {/* Registry + kit packages (read-only status) */}
      <div className={styles.card}>
        <div className={styles.row}>
          <StateDot state={statusView?.ok === true ? 'done' : statusView === undefined ? 'warning' : 'error'} />
          <span className={styles.cardTitle}>{t('registry')}</span>
          {statusView !== undefined
            ? (
              <Pill>{statusView.ok ? t('registryOk') : t('registryFail')}</Pill>
            )
            : null}
          {statusView?.registry !== undefined
            ? <span className={styles.muted}>{statusView.registry}</span>
            : null}
        </div>
        {statusView !== undefined && statusView.error !== null
          ? <p className={styles.error}>{statusView.error}</p>
          : null}
        {statusView !== undefined
          ? (
            <div className={styles.packageList}>
              {statusView.packages.map((pkg) => (
                <div key={pkg.name} className={styles.packageRow}>
                  <StateDot state={pkg.exists ? 'done' : 'error'} />
                  <code className={styles.packageName}>{pkg.name}</code>
                  <span className={styles.muted}>
                    {pkg.exists
                      ? t('published') + (pkg.latest !== null ? ' · ' + t('latest') + ' ' + pkg.latest : '')
                      : t('unpublished')}
                  </span>
                </div>
              ))}
            </div>
          )
          : null}
        {error !== undefined ? <p className={styles.error}>{error}</p> : null}
        {notice !== undefined ? <p className={styles.notice} role="status">{notice}</p> : null}
        <div className={styles.row}>
          <Button variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button>
        </div>
      </div>
    </div>
  )
}