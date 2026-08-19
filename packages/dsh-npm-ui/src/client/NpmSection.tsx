/**
 * npm release settings section: registry + kit package status panel, package
 * name check, OIDC trust status query, and first-release human script
 * generation (with copy). Read-only UI — no token input, no write actions.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Pill, StateDot } from 'dsh-ui-kit'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
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
  const [checkDraft, setCheckDraft] = useState('')
  const [repoDraft, setRepoDraft] = useState('')
  const [checking, setChecking] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  if (state.status === 'idle') void controller.load()
  const statusView = state.statusView

  const run = async (action: () => Promise<string | undefined>): Promise<void> => {
    setError(undefined)
    setNotice(undefined)
    const failure = await action()
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

  const copyScript = async (): Promise<void> => {
    const script = state.script?.script
    if (script === undefined) return
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 2000)
    } catch {
      setError('clipboard unavailable')
    }
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>{t('title')}</h2>
      <p className={styles.intro}>{t('intro')}</p>

      {/* Registry + kit packages */}
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

      {/* Package name check + trust status */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>{t('checkPackage')}</h3>
        <div className={styles.row}>
          <Input
            placeholder={t('checkPlaceholder')}
            value={checkDraft}
            onChange={(event) => { setCheckDraft((event.currentTarget as HTMLInputElement).value) }}
            className={styles.grow}
          />
          <Button
            variant="primary"
            disabled={checking || checkDraft === ''}
            onClick={() => {
              void (async () => {
                setChecking(true)
                await run(() => controller.checkPackage(checkDraft))
                setChecking(false)
              })()
            }}
          >
            {checking ? t('checking') : t('check')}
          </Button>
        </div>
        {state.check !== undefined
          ? (
            <div className={styles.row}>
              <Pill>{state.check.exists ? t('nameTaken') : t('nameAvailable')}</Pill>
              {state.check.exists && state.check.latest !== null
                ? <span className={styles.muted}>{t('latest') + ' ' + state.check.latest}</span>
                : null}
            </div>
          )
          : null}

        {state.check !== undefined && state.check.exists
          ? (
            <>
              <div className={styles.row}>
                <Button
                  variant="outline"
                  onClick={() => { void run(() => controller.queryTrust(state.check!.name)) }}
                >
                  {t('queryTrust')}
                </Button>
              </div>
              {state.trust !== undefined && state.trust.pkg === state.check.name
                ? (
                  <div className={styles.row}>
                    <span className={styles.muted}>{t('trustNotVerifiable')}</span>
                    <a href={state.trust.checkUrl} target="_blank" rel="noreferrer">{t('verifyAt')} ↗</a>
                  </div>
                )
                : null}
            </>
          )
          : null}
      </div>

      {/* First-release script */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>{t('launchScript')}</h3>
        <p className={styles.intro}>{t('scriptIntro')}</p>
        <ol className={styles.nextSteps}>
          <li>{t('scriptStepTag')}</li>
        </ol>
        <div className={styles.row}>
          <Input
            placeholder={t('repositoryPlaceholder')}
            value={repoDraft}
            onChange={(event) => { setRepoDraft((event.currentTarget as HTMLInputElement).value) }}
            className={styles.grow}
          />
          <Button
            variant="primary"
            disabled={repoDraft === ''}
            onClick={() => {
              void (async () => {
                setCopied(false)
                const pkg = state.check?.name
                if (pkg === undefined) { setError('check a package name first'); return }
                await run(() => controller.generateScript({ pkg, repository: repoDraft }))
              })()
            }}
          >
            {t('generateScript')}
          </Button>
        </div>
        {state.script !== undefined
          ? (
            <>
              <pre className={styles.script}><code>{state.script.script}</code></pre>
              <div className={styles.row}>
                <Button variant="outline" onClick={() => { void copyScript() }}>
                  {copied ? t('copied') : t('copy')}
                </Button>
              </div>
            </>
          )
          : null}
      </div>
    </div>
  )
}
