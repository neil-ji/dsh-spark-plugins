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
 *
 * 按钮形制（docs/UI-UX-SPEC.md §3.1 + §4.2 连接页模板，2026-09-17 收编）：
 *  - 一屏一个 primary —— 本面板唯一实心主操作是令牌卡的「保存」(primary/md)；
 *  - 「测试连接」按连接页模板是次操作 = secondary；与同卡的「移除 token」同尺寸
 *    （md = h32，与 32px 的 Input 同标度），令牌卡内不存在 32/26 混高；
 *  - Card 头 actions 里的次按钮（注册表「重试」）走 sm = h26，与 StateDot/Pill 同标度，
 *    且那张卡里只有它一个按钮 —— 同卡同尺寸的前提不被破坏。
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
 * 面板里的异步动作（同一时刻至多一个在飞）。
 *
 * 2026-09-21：与 GitHub 连接器同规 —— 只置 disabled 会让「保存 / 移除 / 测试连接 /
 * 重试」四枚按钮在动作期间全部看起来失灵；改成动作 id 后**只有那一个**按钮走
 * loading 形制（ui-kit Button 的 spinner + aria-busy + 锁点击）。
 */
type NpmBusyAction = 'saveToken' | 'removeToken' | 'testConnection' | 'reload'

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
  /** 在飞的异步动作 id（undefined = 空闲）；按钮据此只让**自己**进 loading 态。 */
  const [busyAction, setBusyAction] = useState<NpmBusyAction | undefined>(undefined)
  const busy = busyAction !== undefined
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  if (state.status === 'idle') void controller.load()
  const statusView = state.statusView
  const credentialConfigured = state.credential?.configured === true
  const tokenLogin = state.token?.login

  /** 动作骨架：期间只有 `action` 那枚按钮 busy；finally 复位，抛错也不卡在 busy。 */
  const run = async (action: NpmBusyAction, act: () => Promise<string | undefined>): Promise<void> => {
    setBusyAction(action)
    setError(undefined)
    setNotice(undefined)
    try {
      const failure = await act()
      if (failure !== undefined) setError(failure)
      else setNotice(t('saved'))
    } finally {
      setBusyAction(undefined)
    }
  }

  if (state.status === 'error') {
    return (
      <div className={styles.section}>
        <Card title={t('registry')}>
          <p className={styles.error}>{t('loadFailed') + ': ' + (state.error ?? '')}</p>
          <div className={styles.actions}>
            <Button
            variant="secondary"
            loading={busyAction === 'reload'}
            disabled={busy}
            onClick={() => { void run('reload', async () => { await controller.load(); return undefined }) }}
          >
            {t('retry')}
          </Button>
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
            ? <span className={styles.muted}>{t('tokenSource') + state.token.source}</span>
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
            loading={busyAction === 'saveToken'}
            disabled={busy || tokenDraft === ''}
            aria-describedby={tokenDraft === '' ? 'npm-save-hint' : undefined}
            onClick={() => { void run('saveToken', () => controller.saveToken(tokenDraft).then((f) => { if (f === undefined) setTokenDraft(''); return f })) }}
          >
            {t('saveToken')}
          </Button>
          {credentialConfigured
            ? (
              <Button
                variant="secondary"
                loading={busyAction === 'removeToken'}
                disabled={busy}
                onClick={() => { void run('removeToken', () => controller.removeToken()) }}
              >
                {t('removeToken')}
              </Button>
            )
            : null}
        </div>

        {tokenDraft === ''
          ? <p id='npm-save-hint' className={styles.muted}>{t('saveTokenHint')}</p>
          : null}

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
            loading={busyAction === 'testConnection'}
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusyAction('testConnection')
                setError(undefined)
                setNotice(undefined)
                try {
                  const failure = await controller.testConnection(tokenDraft === '' ? undefined : tokenDraft)
                  if (failure !== undefined) setError(failure)
                  else setNotice(t('testDone'))
                } finally {
                  setBusyAction(undefined)
                }
              })()
            }}
          >
            {busyAction === 'testConnection' ? t('testing') : t('testConnection')}
          </Button>
        </div>

        {state.tokenError !== null && state.tokenError !== undefined
          ? (
            <p className={styles.error} role="status">
              {t('tokenStatusFailed') + ': ' + state.tokenError}
            </p>
          )
          : null}

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
            <Button
              variant="secondary"
              size="sm"
              loading={busyAction === 'reload'}
              disabled={busy}
              onClick={() => { void run('reload', async () => { await controller.load(); return undefined }) }}
            >
              {t('retry')}
            </Button>
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
