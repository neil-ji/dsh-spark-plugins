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
import type { GithubTranslate } from './locales.ts'
import {
  HOST_MISSING_TOKEN_ERROR, describeActionFailure, describeConnectionFailure, succeeded,
  type Feedback,
} from './connectionFailure.ts'
import styles from './GithubSection.module.css'

/** Injected dependencies of {@link GithubSection} (slot inject). */
export interface GithubSectionInjected {
  controller: GithubSettingsStore
  useSnapshot: SnapshotSelectorHook<GithubSettingsState>
  t: GithubTranslate
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
  // 反馈是**一条**本地化文案（不再是宿主原始英文串），且是成功/失败二选一的联合
  // —— 同屏不可能出现「错误 + 已保存」两条互相矛盾的播报（PCQA-013）。
  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined)
  const [configDraft, setConfigDraft] = useState<GithubConfigView | undefined>(undefined)
  const [proxyTest, setProxyTest] = useState<GithubProxyTestValue | undefined>(undefined)
  const [visibilityOpen, setVisibilityOpen] = useState(false)
  const visibilityRef = useRef<HTMLButtonElement | null>(null)

  if (state.status === 'idle') void controller.load()
  const config = configDraft ?? state.config
  const configDirty = configDraft !== undefined && configDraft !== state.config
  /** 「默认可见性」按钮的可见文本（也是可访问名 `{默认可见性}：{值}` 的值部）。 */
  const visibilityLabel = config?.defaultVisibility === 'private' ? t('private') : t('public')

  /**
   * 页面级动作骨架：成功播报「已保存」，失败就地显示本地化文案。
   * 结果**整体替换**那一条反馈 —— 之前用 notice + testError 两个 state，
   * 「测试连接」失败会走成 notice='已保存' 与错误行同时上屏（PCQA-013 的根因）。
   */
  const run = async (action: () => Promise<string | undefined>): Promise<void> => {
    setBusy(true)
    setFeedback(undefined)
    const raw = await action()
    setBusy(false)
    setFeedback(raw !== undefined ? describeActionFailure(raw, t) : succeeded(t('saved')))
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
            ? ' · ' + t('tokenSource') + state.credential.source
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
            aria-describedby={tokenDraft === '' ? 'github-save-hint' : undefined}
            onClick={() => { void run(() => controller.saveToken(tokenDraft).then((f) => { if (f === undefined) setTokenDraft(''); return f })) }}
          >
            {t('saveToken')}
          </Button>
          {credentialConfigured
            ? <Button variant="secondary" disabled={busy} onClick={() => { void run(() => controller.removeToken()) }}>{t('removeToken')}</Button>
            : null}
        </div>
        {tokenDraft === ''
          ? <p id='github-save-hint' className={styles.muted}>{t('saveTokenHint')}</p>
          : null}
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
        {/* 失败文案自己就是动态状态区（PCQA-013）：role=status + aria-live=polite。
            反馈只有一条（成功 / 失败二选一），所以这里与页面底部的成功播报不可能同屏。
            title 保留原始宿主串，未知错误仍可追查。 */}
        {feedback !== undefined && !feedback.ok
          ? (
            <p
              className={styles.error}
              role="status"
              aria-live="polite"
              title={feedback.detail}
              data-testid="github-connection-error"
            >
              {feedback.text}
            </p>
          )
          : null}
        <p className={styles.muted}>{t('testConnectionHint')}</p>
        <div className={styles.actions}>
          {/* 连接页模板（UI-UX-SPEC §4.2）：`测试连接` 是 secondary，本屏 primary 只留给
              「保存令牌」——之前两个实心主按钮同屏（PCQA-019）。 */}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                setFeedback(undefined)
                try {
                  // 前置判空（PCQA-003）：未填且未保存令牌时本地化文案直出，不发无谓请求；
                  // 走的仍是宿主 MISSING_CREDENTIAL 的同一条映射，说法不会两样。
                  if (tokenDraft === '' && !credentialConfigured) {
                    setFeedback(describeConnectionFailure(HOST_MISSING_TOKEN_ERROR, t))
                    return
                  }
                  const raw = await controller.testConnection(tokenDraft === '' ? undefined : tokenDraft)
                  setFeedback(raw !== undefined ? describeConnectionFailure(raw, t) : succeeded(t('saved')))
                } finally {
                  setBusy(false)
                }
              })()
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
                      // WCAG 2.5.3 Label in Name：可访问名必须含可见文本（「私有」/「公开」）。
                      // 取词走 `{value}` 占位符，值不拼进 JSX 字面量。
                      aria-label={t('defaultVisibilityAria', { value: visibilityLabel })}
                      // 展开语义：ui-kit Menu 的浮层是 role=listbox + role=option。
                      // 当前发布的 ui-kit 产物（0.6.1 dist）不在 anchor 上注入 haspopup/expanded，
                      // 所以本包显式设置——值同源（同一个 visibilityOpen），
                      // 将来 ui-kit 在 Menu 里 cloneElement 注入同值时这里的声明会被同值覆盖，不冲突。
                      aria-haspopup="listbox"
                      aria-expanded={visibilityOpen}
                      onClick={() => { setVisibilityOpen(v => !v) }}
                    >
                      {visibilityLabel}
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
                  aria-describedby={config.gitProxy === '' ? 'github-proxy-hint' : undefined}
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
              {config.gitProxy === ''
                ? <p id='github-proxy-hint' className={styles.muted}>{t('testProxyHint')}</p>
                : null}
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

      {/* 保存行：权限与身份共用同一份 config 草稿，所以是页级动作（与财务面板同形）。
          形制：本面板唯一 primary 归「连接」卡的保存令牌（UI-UX-SPEC §4.2 连接页模板），
          这条草稿结算行取 secondary —— 否则草稿脏时同屏两个实心主按钮（复核口径 §4.2 的遗留 #1）。 */}
      {configDirty
        ? (
          <div className={styles.footer}>
            <Button variant="secondary" disabled={busy} onClick={() => { setConfigDraft(undefined) }}>{t('discardChanges')}</Button>
            <Button
              variant="secondary"
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
      {/* 页级成功播报。反馈是二选一的联合，失败时这条根本不渲染（PCQA-013）。 */}
      {feedback !== undefined && feedback.ok
        ? <p className={styles.notice} role="status" data-testid="github-section-notice">{feedback.text}</p>
        : null}
    </div>
  )
}
