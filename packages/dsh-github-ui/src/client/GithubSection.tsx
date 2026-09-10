/**
 * Github settings section: token management (credential seam), connection
 * test, and operation-permission configuration through the github Remote
 * namespace. Reuses dsh client primitives so the page matches the shell theme.
 *
 * 布局形制（2026-09 统一）：
 *  - 页面不再自带 <h2> 标题 + 无边框分组：每个功能分组就是一张 ui-kit Card，
 *    分组标题写在 Card 头上（title），状态/动作走 Card 的 actions 槽位；
 *  - 字段一律「标签在上、控件在下」的纵向堆叠 —— 横排标签在 dock 的窄面板
 *    （616px 面板 → 内容区 ~486px，窄窗口更小）里会把输入压成几十像素；
 *  - 令牌行显式 flex-wrap + min-width：窄容器换行而不是让 input 溢出压住按钮。
 */
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Card, Checkbox, Input, Menu, Pill, StateDot } from 'dsh-ui-kit'
import type { SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
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
  return <Checkbox checked={checked} disabled={disabled} onChange={onChange} label={label} />
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
  const [visibilityOpen, setVisibilityOpen] = useState(false)
  const visibilityRef = useRef<HTMLButtonElement | null>(null)

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
        <Card title={t('cardConnectionTitle')}>
          <p className={styles.error}>{t('loadFailed') + ': ' + (state.error ?? '')}</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => { void controller.load() }}>{t('retry')}</Button>
          </div>
        </Card>
      </div>
    )
  }

  const credentialConfigured = state.credential?.configured === true

  return (
    <div className={styles.section}>
      {/* 访问令牌（只写凭据缝） */}
      <Card
        title={t('tokenTitle')}
        actions={<StateDot status={credentialConfigured ? 'live' : 'error'} />}
      >
        <p className={styles.muted}>
          {credentialConfigured ? t('tokenConfigured') : t('tokenMissing')}
          {state.credential?.source !== undefined
            ? ' · ' + t('tokenSource') + ': ' + state.credential.source
            : ''}
        </p>
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
      </Card>

      {/* 连接状态 */}
      <Card
        title={t('cardConnectionTitle')}
        actions={(
          <StateDot status={state.whoami !== undefined ? 'live' : credentialConfigured ? 'idle' : 'error'} />
        )}
      >
        <div className={styles.row}>
          <span className={styles.strong}>
            {state.whoami !== undefined ? t('connectedAs') : t('notConnected')}
          </span>
          {state.whoami !== undefined
            ? (
              <>
                <Pill>{state.whoami.login}</Pill>
                {state.whoami.name !== null ? <span className={styles.muted}>{state.whoami.name}</span> : null}
              </>
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
        <p className={styles.muted}>{t('testConnectionHint')}</p>
        <div className={styles.actions}>
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
      </Card>

      {/* 操作权限与 Git 身份共用同一份 config 草稿 → 页级保存行统一提交 */}
      <Card title={t('permissions')}>
        <div className={styles.permGrid}>
          <PermissionRow label={t('allowCreateRepo')} checked={config?.allowCreateRepo ?? false} onChange={(v) => { if (config !== undefined) setConfigDraft({ ...config, allowCreateRepo: v }) }} />
          <PermissionRow label={t('allowPush')} checked={config?.allowPush ?? false} onChange={(v) => { if (config !== undefined) setConfigDraft({ ...config, allowPush: v }) }} />
          <PermissionRow label={t('allowPull')} checked={config?.allowPull ?? false} onChange={(v) => { if (config !== undefined) setConfigDraft({ ...config, allowPull: v }) }} />
          <PermissionRow label={t('allowPullRequest')} checked={config?.allowPullRequest ?? false} onChange={(v) => { if (config !== undefined) setConfigDraft({ ...config, allowPullRequest: v }) }} />
          <PermissionRow label={t('allowReview')} checked={config?.allowReview ?? false} onChange={(v) => { if (config !== undefined) setConfigDraft({ ...config, allowReview: v }) }} />
          <PermissionRow label={t('allowPages')} checked={config?.allowPages ?? false} onChange={(v) => { if (config !== undefined) setConfigDraft({ ...config, allowPages: v }) }} />
          <PermissionRow label={t('allowActions')} checked={config?.allowActions ?? false} onChange={(v) => { if (config !== undefined) setConfigDraft({ ...config, allowActions: v }) }} />
          <PermissionRow label={t('allowIssues')} checked={config?.allowIssues ?? false} onChange={(v) => { if (config !== undefined) setConfigDraft({ ...config, allowIssues: v }) }} />
          <PermissionRow label={t('allowRelease')} checked={config?.allowRelease ?? false} onChange={(v) => { if (config !== undefined) setConfigDraft({ ...config, allowRelease: v }) }} />
        </div>
        <p className={styles.muted}>{t('workflowScopeNote')}</p>
        <p className={styles.muted}>{t('forcePush')} · {t('deleteOperations')} — {t('notAvailable')}</p>
      </Card>

      {config !== undefined
        ? (
          <Card title={t('identity')}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="github-git-name">{t('gitName')}</label>
              <Input id="github-git-name" className={styles.fieldInput} value={config.gitName} onChange={(event) => { setConfigDraft({ ...config, gitName: (event.currentTarget as HTMLInputElement).value }) }} />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="github-git-email">{t('gitEmail')}</label>
              <Input id="github-git-email" className={styles.fieldInput} value={config.gitEmail} onChange={(event) => { setConfigDraft({ ...config, gitEmail: (event.currentTarget as HTMLInputElement).value }) }} />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('defaultVisibility')}</span>
              <div className={styles.actions}>
                <Menu
                  open={visibilityOpen}
                  portal
                  side="bottom"
                  anchor={(
                    <Button
                      ref={visibilityRef}
                      variant="secondary"
                      size="sm"
                      aria-label={t('defaultVisibility')}
                      onClick={() => { setVisibilityOpen(v => !v) }}
                    >
                      {config.defaultVisibility === 'private' ? t('private') : t('public')}
                    </Button>
                  )}
                  items={[
                    { id: 'private', label: t('private') },
                    { id: 'public', label: t('public') },
                  ]}
                  selectedId={config.defaultVisibility}
                  onSelect={(id) => { setConfigDraft({ ...config, defaultVisibility: id as 'private' | 'public' }); setVisibilityOpen(false) }}
                  onClose={() => { setVisibilityOpen(false) }}
                />
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="github-git-proxy">{t('gitProxy')}</label>
              <div className={styles.row}>
                <Input
                  id="github-git-proxy"
                  placeholder={t('gitProxyPlaceholder')}
                  value={config.gitProxy}
                  onChange={(event) => { setConfigDraft({ ...config, gitProxy: (event.currentTarget as HTMLInputElement).value }) }}
                  className={styles.grow}
                />
                <Button
                  variant="secondary"
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
                  <p className={proxyTest.ok ? styles.notice : styles.error} role={proxyTest.ok ? 'status' : 'alert'}>
                    {proxyTest.ok
                      ? t('proxyOk') + ' · ' + t('proxyTarget') + ' ' + proxyTest.host + ' · ' + proxyTest.latencyMs + 'ms'
                      : t('proxyFail') + ': ' + (proxyTest.error ?? '')}
                  </p>
                )
                : null}
            </div>
          </Card>
        )
        : null}

      {/* 保存行：权限与身份共用同一份 config 草稿，所以是页级动作（与财务面板同形）。 */}
      {configDirty
        ? (
          <div className={styles.footer}>
            <Button variant="secondary" disabled={busy} onClick={() => { setConfigDraft(undefined) }}>{t('discardChanges')}</Button>
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
          </div>
        )
        : null}
      {notice !== undefined ? <p className={styles.notice} role="status">{notice}</p> : null}
    </div>
  )
}
