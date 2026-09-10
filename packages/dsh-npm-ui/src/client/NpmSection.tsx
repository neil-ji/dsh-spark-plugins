/**
 * npm release settings section: token management (credential seam: paste ->
 * test connection -> save) plus a read-only registry/kit status panel.
 * Token-first: the UI only handles credentials and passive status — every
 * query/action (package name check, trust status, publish, launch) is done
 * by the agent through its tools (npm_package_check / npm_trust_list /
 * npm_trust_status / npm_launch ...).
 *
 * 布局形制（2026-09 统一，与 GitHub 连接器同规）：
 *  - 每个功能分组是一张 ui-kit Card，分组标题写在 Card 头；
 *  - 页级 <h2>/intro 已移除（dock 头与设置页侧栏已给出插件名）；
 *  - 令牌行 flex-wrap + min-width：窄面板换行，绝不让 input 溢出压住按钮。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Card, Input, Pill, StateDot } from 'dsh-ui-kit'
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
        <Card title={t('registry')}>
          <p className={styles.error}>{t('loadFailed') + ': ' + (state.error ?? '')}</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => { void controller.load() }}>{t('retry')}</Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      {/* npm token（granular）—— 凭据缝，只写不回显 */}
      <Card
        title={t('tokenTitle')}
        actions={(
          <StateDot status={tokenLogin !== null && tokenLogin !== undefined ? 'live' : credentialConfigured ? 'idle' : 'error'} />
        )}
      >
        <div className={styles.row}>
          <span className={styles.strong}>
            {tokenLogin !== null && tokenLogin !== undefined ? t('connectedAs') : t('notConnected')}
          </span>
          {tokenLogin !== null && tokenLogin !== undefined ? <Pill>{tokenLogin}</Pill> : null}
          {state.token?.source !== undefined
            ? <span className={styles.muted}>{t('tokenSource') + ': ' + state.token.source}</span>
            : null}
        </div>

        {/* 令牌：input 撑满剩余宽度，按钮换行兜底 —— 窄面板不会挤在一起。 */}
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
            ? <Button variant="secondary" disabled={busy} onClick={() => { void run(() => controller.removeToken()) }}>{t('removeToken')}</Button>
            : null}
        </div>

        {state.test !== undefined
          ? (
            <p className={state.test.ok ? styles.notice : styles.error} role={state.test.ok ? 'status' : 'alert'}>
              {state.test.ok
                ? t('testOk') + (state.test.login !== null ? ': ' + state.test.login : '')
                : t('testFail') + ': ' + (state.test.detail ?? '')}
            </p>
          )
          : null}

        <p className={styles.muted}>{t('testConnectionHint')}</p>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
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
        </div>

        {state.token !== undefined
          ? <p className={styles.muted}>{state.token.configured ? t('tokenHintOk') : t('tokenHintMissing')}</p>
          : null}
      </Card>

      {/* Registry 状态：可达性就是这一张卡的全部内容（URL + 结果 + 重试）。
          套件包清单是另一个逻辑组，拆成下一张卡 —— 一张 450px 的巨卡里塞两件事，
          卡头的「npm 注册表」就盖不住下半屏的包列表了。 */}
      <Card
        title={t('registry')}
        actions={(
          <>
            <StateDot status={statusView?.ok === true ? 'live' : statusView === undefined ? 'idle' : 'error'} />
            {statusView !== undefined
              ? <Pill>{statusView.ok ? t('registryOk') : t('registryFail')}</Pill>
              : null}
            <Button variant="secondary" size="sm" onClick={() => { void controller.load() }}>{t('retry')}</Button>
          </>
        )}
      >
        {statusView?.registry !== undefined
          ? <p className={styles.muted}>{statusView.registry}</p>
          : null}
        {statusView !== undefined && statusView.error !== null
          ? <p className={styles.error}>{statusView.error}</p>
          : null}
      </Card>

      {/* Kit 套件包状态（只读）*/}
      {statusView !== undefined && statusView.packages.length > 0
        ? (
          <Card
            title={t('packagesTitle')}
            actions={<span className={styles.muted}>{statusView.packages.length}</span>}
          >
            <div className={styles.packageList}>
              {statusView.packages.map((pkg) => (
                <div key={pkg.name} className={styles.packageRow}>
                  <StateDot status={pkg.exists ? 'live' : 'error'} />
                  <code className={styles.packageName}>{pkg.name}</code>
                  <span className={styles.muted}>
                    {pkg.exists
                      ? t('published') + (pkg.latest !== null ? ' · ' + t('latest') + ' ' + pkg.latest : '')
                      : t('unpublished')}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )
        : null}

      {/* Section-level feedback: token/credential 操作结果固定在页级，不再混入注册表卡 */}
      {error !== undefined ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice !== undefined ? <p className={styles.notice} role="status">{notice}</p> : null}
    </div>
  )
}
