/**
 * Spark module panes: 灵感收件箱（捕获 + 收件箱视图）/ 涌现提议 / 脚本目录。Graph 子页
 * 留占位（后端暂无 graph 查询 API）。
 *
 * 2026-09-14 收件箱化（设计 docs/spark-inbox-design-2026-09-14.md §4.1/§8）：
 *  - 列表从「活跃 / 已归档」两态改为四级收件箱 + 墓碑视图，计数来自 `/sparks/stats`；
 *  - 动作按状态给：待处理→结晶/归档/丢弃，已沉淀→归档，归档/丢弃→移回收件箱，已删除→恢复；
 *  - 丢弃是破坏性动作，走 Modal 二次确认（UI-UX-SPEC §4.2 危险区口径）；
 *  - **文案全部走 locale 字典**（此前是硬编码中文，违反 AGENTS.md §3.4）。
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Card, Disclosure, Input, Modal, SegmentedControl, Textarea } from 'dsh-ui-kit'
import { useFrames } from 'dsh-spark-plugin-kit/client'
import type { SparkView, SparkInboxState, SparkStats, ProposalView, ScriptView } from 'dsh-spark-wire'
import { createDockSparksApi, type DockSparksApi } from './sparkApi.ts'
import { SPARK_EVENTS_STREAM, type SparkEventChannel } from './remote.ts'
import type { SparkT } from './locales.ts'

const api: DockSparksApi = createDockSparksApi()

/** 子页依赖面：事件通道 + 取词函数，都由 dock 通过插槽 inject 面下发。 */
export interface SparkPaneDeps {
  channel: SparkEventChannel | null
  t: SparkT
}

/**
 * 子页实时刷新：订阅统一事件流（ADR-001），只对关心的主题生效；`ready` 基线帧同样要重取
 * —— 世代之间的窗口不回放，基线即「从现在开始不会丢」。
 */
function useSparkTopicRefresh(channel: SparkEventChannel | null, kinds: readonly string[], reload: () => void): void {
  useFrames({
    remote: channel?.remote ?? null,
    name: SPARK_EVENTS_STREAM,
    open: (signal) => (channel as SparkEventChannel).events.events(signal),
    kinds,
    onFrame: () => reload(),
    onReady: () => reload(),
  })
}

function timeAgo(ts: number, t: SparkT): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  // 本包的字典值是**无占位符的纯单位**（'秒前' / 's ago'），数值由这里前置拼接 ——
  // `SparkT` 也不接受第二参数。不要照搬 finance 的 `t('timeSeconds', { n })` 写法：
  // 那边的值是 "{n} 秒前"（自带占位符），两包同名不同形。
  if (s < 60) return `${s} ${t('timeSeconds')}`
  if (s < 3600) return `${Math.floor(s / 60)} ${t('timeMinutes')}`
  if (s < 86400) return `${Math.floor(s / 3600)} ${t('timeHours')}`
  return `${Math.floor(s / 86400)} ${t('timeDays')}`
}

function useApiResource<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => {
    let alive = true
    loader().then(
      (d) => { if (alive) { setData(d); setError(null) } },
      (e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, error, reload }
}

function ErrorNote({ error }: { error: string | null }) {
  if (error === null) return null
  return <div className="dock-error">{error}</div>
}

/** 空态/加载态：视觉锚点（火花线稿）+ 主文案 + 可选提示。 */
function Empty({ text, hint, loading }: { text: string; hint?: string; loading?: boolean }) {
  return (
    <div className={'dock-empty' + (loading === true ? ' loading' : '')}>
      <svg className="empty-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <path d="M12 3.2c.6 4.4 3.6 7.4 8 8-4.4.6-7.4 3.6-8 8-.6-4.4-3.6-7.4-8-8 4.4-.6 7.4-3.6 8-8z" strokeLinejoin="round" />
      </svg>
      <div className="empty-txt">{text}</div>
      {hint !== undefined && <div className="empty-hint">{hint}</div>}
    </div>
  )
}

/** 行内异步操作钮：busy 时禁用并显示省略，防双击重复提交。 */
function RowAction({ label, busyLabel, busy, onRun, danger }: { label: string; busyLabel?: string; busy: boolean; onRun: () => Promise<void>; danger?: boolean }) {
  return (
    <button className={'dock-pill' + (danger === true ? ' danger' : '')} type="button" disabled={busy} aria-busy={busy}
      onClick={() => { if (!busy) void onRun() }}>
      {busy ? (busyLabel ?? '…') : label}
    </button>
  )
}

/** 计量条：宽度即数值，配文本说明（不只靠颜色传义）。 */
function Meter({ pct, tone }: { pct: number; tone?: 'good' | 'warn' | undefined }) {
  const w = Math.max(0, Math.min(100, Math.round(pct * 100) / 1))
  return (
    <span className={'dock-meter' + (tone !== undefined ? ' tone-' + tone : '')} aria-hidden="true">
      <span className="dock-meter-fill" style={{ width: w + '%' }} />
    </span>
  )
}

/* ─────────── 灵感收件箱：一条输入流 + 收件箱视图 ─────────── */

type InboxFilter = Extract<SparkInboxState, 'pending' | 'crystallized' | 'archived' | 'dropped'>

const FILTERS: readonly { id: InboxFilter; key: 'filterPending' | 'filterCrystallized' | 'filterArchived' | 'filterDropped' }[] = [
  { id: 'pending', key: 'filterPending' },
  { id: 'crystallized', key: 'filterCrystallized' },
  { id: 'archived', key: 'filterArchived' },
  { id: 'dropped', key: 'filterDropped' },
]

const EMPTY_KEYS: Record<InboxFilter, { text: 'emptyPending' | 'emptyCrystallized' | 'emptyArchived' | 'emptyDropped'; hint: 'emptyPendingHint' | 'emptyCrystallizedHint' | 'emptyArchivedHint' | 'emptyDroppedHint' }> = {
  pending: { text: 'emptyPending', hint: 'emptyPendingHint' },
  crystallized: { text: 'emptyCrystallized', hint: 'emptyCrystallizedHint' },
  archived: { text: 'emptyArchived', hint: 'emptyArchivedHint' },
  dropped: { text: 'emptyDropped', hint: 'emptyDroppedHint' },
}

function countOf(stats: SparkStats | null, filter: InboxFilter): number | null {
  if (stats === null) return null
  return stats[filter]
}

export function SparksPane({ channel, t }: SparkPaneDeps): JSX.Element {
  const [filter, setFilter] = useState<InboxFilter>('pending')
  const [showDeleted, setShowDeleted] = useState(false)
  const stats = useApiResource<SparkStats>(() => api.stats(), [])
  const { data: sparks, error, reload } = useApiResource<SparkView[]>(
    () => api.list({ inboxState: filter, includeDeleted: showDeleted, limit: 50 }),
    [filter, showDeleted],
  )
  const [draft, setDraft] = useState('')
  const [tags, setTags] = useState('')
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [captured, setCaptured] = useState(false)
  const [confirmDrop, setConfirmDrop] = useState<SparkView | null>(null)
  const capturedTimer = useRef(0)

  const reloadStats = stats.reload
  const refresh = useCallback(() => { reload(); reloadStats() }, [reload, reloadStats])
  useSparkTopicRefresh(channel, ['spark'], refresh)
  useEffect(() => () => window.clearTimeout(capturedTimer.current), [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (text.length === 0 || busy) return
    setBusy(true); setFormError(null); setCaptured(false)
    try {
      // 第一行即标题（≤60 字），全文作为内容——先写，后整理
      const nl = text.indexOf('\n')
      const title = (nl === -1 ? text : text.slice(0, nl)).trim().slice(0, 60) || text.slice(0, 60)
      const tagList = tags.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0)
      await api.capture({ title, content: text, scope, tags: tagList })
      setDraft(''); setTags('')
      setCaptured(true)
      setFilter('pending')
      window.clearTimeout(capturedTimer.current)
      capturedTimer.current = window.setTimeout(() => setCaptured(false), 2600)
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const emptyKeys = showDeleted
    ? { text: 'emptyDeleted' as const, hint: 'emptyDeletedHint' as const }
    : EMPTY_KEYS[filter]
  const shown = sparks?.length ?? null

  return (
    <div className="dock-stack">
      {/* 可见的标题/副标题条退役（2026-09 用户裁决）：Card 自身的 title 已表意，
          一图两名。未处理计数的 live 通告保留为屏下状态区（读屏仍可感知，视觉零占位）；
          视觉上的 pending 数在 Card actions 的 pill 计数里。 */}
      <div role="status" aria-live="polite" className="dock-sr-only"
        aria-label={t('inboxTitle') + ': ' + String(stats.data?.pending ?? 0) + ' ' + t('filterPending')}>
        {t('inboxTitle')}: {String(stats.data?.pending ?? 0)} {t('filterPending')}
      </div>

      <Card
        title={t('inboxTitle')}
        actions={(
          <>
            {/* 过滤器从 pill 组改 SegmentedControl（2026-09 用户裁决「与其他 Card
                保持一致」——财务的窗口切换就是它）。「已删除」由开关并入第 5 个
                互斥 tab，单选语义更干净。计数保留在 tab 文案里。 */}
            <SegmentedControl
              aria-label={t('inboxTitle')}
              value={showDeleted ? 'deleted' : filter}
              onChange={(value) => {
                if (value === 'deleted') { setShowDeleted(true); return }
                setShowDeleted(false); setFilter(value as InboxFilter)
              }}
              options={[
                ...FILTERS.map((entry) => {
                  const count = countOf(stats.data, entry.id)
                  return {
                    value: entry.id,
                    label: t(entry.key) + (count === null ? '' : ' ' + String(count)),
                  }
                }),
                {
                  value: 'deleted',
                  label: t('filterDeleted')
                    + (stats.data !== null && stats.data.deleted > 0 ? ' ' + String(stats.data.deleted) : ''),
                },
              ]}
            />
            {shown !== null && <span className="dock-hint">{String(shown)} {t('unitItems')}</span>}
          </>
        )}
      >
        <ErrorNote error={error ?? stats.error} />
        {sparks === null
          ? <Empty text={t('loading')} loading />
          : sparks.length === 0
            ? <Empty text={t(emptyKeys.text)} hint={t(emptyKeys.hint)} />
            : <SparkList sparks={sparks} reload={refresh} t={t} confirmDrop={setConfirmDrop} />}
      </Card>

      {/* 捕获表单升级为 ui-kit Card 形制（2026-09 用户裁决「与其他页面观感一致」）：
          Card title 做表头；可选字段收 Disclosure（仓库规范：折叠统一 Disclosure，
          details/summary 已退役）；scope 只有两档用 SegmentedControl；底部
          操作行 = 原因提示在左 + 主按钮在右（同进化页页头行结构）。 */}
      <Card title={t('captureLabel')}>
        <form className="dock-capture" onSubmit={submit}>
          <Textarea rows={3} aria-label={t('captureLabel')}
            placeholder={t('capturePlaceholder')}
            value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Disclosure name={t('detailsSummary')}>
            <Input aria-label={t('tagsLabel')} placeholder={t('tagsLabel')} value={tags}
              onChange={(e) => setTags(e.target.value)} />
            <SegmentedControl
              aria-label={t('scopeLabel')}
              value={scope}
              onChange={(value) => setScope(value as 'project' | 'global')}
              options={[
                { value: 'project', label: t('scopeProject') },
                { value: 'global', label: t('scopeGlobal') },
              ]}
            />
          </Disclosure>
          <div className="dock-capture-bar">
            {/* PCQA-014：按钮禁用时必须说清原因（UI-UX-SPEC §3.1 Don't：disabled 提交不解释）。
                输入为空时这一行给的就是「为什么点不了」；非空时退回字数计数。 */}
            <span className="dock-hint" id="spark-capture-hint" aria-live="polite">
              {busy ? t('capturing')
                : captured ? t('captured')
                  : draft.trim().length === 0 ? t('captureNeedText')
                    : `${draft.length} ${t('charsUnit')}`}
            </span>
            <span className="grow-spacer" />
            <Button type="submit" variant="primary" disabled={busy || draft.trim().length === 0} aria-busy={busy}
              aria-describedby="spark-capture-hint"
              icon={(
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2.6c.7 5.2 4.2 8.7 9.4 9.4-5.2.7-8.7 4.2-9.4 9.4-.7-5.2-4.2-8.7-9.4-9.4 5.2-.7 8.7-4.2 9.4-9.4z" />
                </svg>
              )}>
              {busy ? t('capturing') : t('capture')}
            </Button>
          </div>
          <ErrorNote error={formError} />
        </form>
      </Card>

      <Modal
        open={confirmDrop !== null}
        onClose={() => setConfirmDrop(null)}
        title={t('dropConfirmTitle')}
        closeLabel={t('cancel')}
        // 关闭钮的可访问名也走字典（ui-kit 只提供中文缺省值，见 ModalProps.closeAriaLabel）
        closeAriaLabel={t('closeDialog')}
        footer={(
          <>
            <button className="dock-btn ghost" type="button" onClick={() => setConfirmDrop(null)}>{t('cancel')}</button>
            <button className="dock-btn" type="button" data-variant="danger"
              onClick={() => { const target = confirmDrop; setConfirmDrop(null); if (target !== null) void api.drop(target.id).then(refresh, refresh) }}>
              {t('confirm')}
            </button>
          </>
        )}
      >
        <p>{t('dropConfirmBody')}</p>
        {confirmDrop !== null && <p className="dock-hint">{confirmDrop.title}</p>}
      </Modal>
    </div>
  )
}

const STATE_KEYS: Record<SparkView['inboxState'], 'statePending' | 'stateCrystallized' | 'stateDropped' | 'stateArchived'> = {
  pending: 'statePending',
  crystallized: 'stateCrystallized',
  dropped: 'stateDropped',
  archived: 'stateArchived',
}

function SparkList({ sparks, reload, t, confirmDrop }: {
  sparks: SparkView[]
  reload: () => void
  t: SparkT
  confirmDrop: (spark: SparkView) => void
}): JSX.Element {
  const [busyId, setBusyId] = useState<string | null>(null)
  const run = async (id: string, fn: () => Promise<unknown>) => {
    if (busyId !== null) return
    setBusyId(id)
    try { await fn() } finally { setBusyId(null); reload() }
  }
  return (
    <div className="dock-list">
      {sparks.map((s) => {
        const deleted = s.deletedAt !== null
        return (
          <div key={s.id} className={'dock-row' + (deleted || s.inboxState === 'archived' || s.inboxState === 'dropped' ? ' off' : '')}>
            {s.crystallized !== null && <span className="dock-row-dot cryst" title={t('crystallizedBadge')} aria-label={t('crystallizedBadge')} />}
            <div className="grow">
              <div className="ttl">{s.title}</div>
              <div className="meta">
                {deleted ? t('stateDeleted') : t(STATE_KEYS[s.inboxState])} · {s.scope} · {timeAgo(s.updatedAt, t)}
                {s.crystallized !== null && !deleted && <span className="cryst"> · {t('crystallizedBadge')}</span>}
              </div>
            </div>
            {deleted
              ? (
                <RowAction label={t('actionRestore')} busyLabel={t('restoring')} busy={busyId === s.id}
                  onRun={() => run(s.id, async () => { await api.restore(s.id) })} />
              )
              : s.inboxState === 'pending'
                ? (
                  <>
                    <RowAction label={t('actionCrystallize')} busyLabel={t('crystallizing')} busy={busyId === s.id}
                      onRun={() => run(s.id, async () => { await api.crystallize(s.id) })} />
                    <RowAction label={t('actionArchive')} busyLabel={t('archiving')} busy={busyId === s.id}
                      onRun={() => run(s.id, async () => { await api.archive(s.id) })} />
                    <RowAction danger label={t('actionDrop')} busyLabel={t('dropping')} busy={busyId === s.id}
                      onRun={async () => { confirmDrop(s) }} />
                  </>
                )
                : s.inboxState === 'crystallized'
                  ? (
                    <RowAction label={t('actionArchive')} busyLabel={t('archiving')} busy={busyId === s.id}
                      onRun={() => run(s.id, async () => { await api.archive(s.id) })} />
                  )
                  : (
                    <RowAction label={t('actionToInbox')} busyLabel={t('toInboxing')} busy={busyId === s.id}
                      onRun={() => run(s.id, async () => { await api.setInboxState(s.id, 'pending') })} />
                  )}
          </div>
        )
      })}
    </div>
  )
}

/* ─────────── 涌现提议：提议卡 ─────────── */

export function ProposalsPane({ channel, t }: SparkPaneDeps): JSX.Element {
  const { data: proposals, error, reload } = useApiResource<ProposalView[]>(() => api.listProposals({ status: 'pending', limit: 50 }), [])
  const [reflecting, setReflecting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  useSparkTopicRefresh(channel, ['proposal'], reload)

  const reflect = async () => {
    if (reflecting) return
    setReflecting(true)
    try { await api.reflect() } finally { setReflecting(false); reload() }
  }
  const resolve = async (id: string, action: 'accepted' | 'dismissed') => {
    if (busyId !== null) return
    setBusyId(id)
    try { await api.resolveProposal(id, action) } finally { setBusyId(null); reload() }
  }

  return (
    <div className="dock-stack">
      <ErrorNote error={error} />
      <Card
        title={t('proposalsTitle')}
        actions={(
          <>
            <span className="dock-hint">{t('proposalsHint')}</span>
            <button className="dock-pill" type="button" disabled={reflecting} aria-busy={reflecting}
              onClick={() => { void reflect() }}>
              {reflecting ? t('reflecting') : t('reflect')}
            </button>
          </>
        )}
      >
        {proposals === null
          ? <Empty text={t('loading')} loading />
          : proposals.length === 0
            ? <Empty text={t('proposalsEmpty')} hint={t('proposalsEmptyHint')} />
            : (
              <div className="dock-stack">
                {proposals.map((p) => {
                  const conf = Math.round(p.confidence * 100)
                  return (
                    <div key={p.id} className="dock-prop">
                      <div className="dock-prop-head">
                        <span className="dock-prop-type">{p.type}</span>
                        <span className="grow-spacer" />
                        <span className="dock-hint">{timeAgo(p.createdAt, t)}</span>
                      </div>
                      <div className="dock-prop-text">{p.explanation}</div>
                      <div className="dock-prop-meter">
                        <Meter pct={p.confidence} tone={conf >= 70 ? 'good' : conf >= 40 ? 'warn' : undefined} />
                        <span className="dock-hint">{t('confidenceLabel')} {conf}% · {p.leverage} {t('leverageLabel')}</span>
                      </div>
                      <div className="dock-prop-actions">
                        <button className="dock-btn" type="button" disabled={busyId === p.id}
                          onClick={() => { void resolve(p.id, 'accepted') }}>
                          {busyId === p.id ? '…' : t('accept')}
                        </button>
                        <button className="dock-btn ghost" type="button" disabled={busyId === p.id}
                          onClick={() => { void resolve(p.id, 'dismissed') }}>{t('dismiss')}</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
      </Card>
    </div>
  )
}

/* ─────────── 脚本目录：计量可视化 ─────────── */

export function ScriptsPane({ channel, t }: SparkPaneDeps): JSX.Element {
  const { data: scripts, error, reload } = useApiResource<ScriptView[]>(() => api.listScripts(), [])
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const messageTimer = useRef(0)
  useSparkTopicRefresh(channel, ['script'], reload)
  useEffect(() => () => window.clearTimeout(messageTimer.current), [])

  const invoke = async (sc: ScriptView) => {
    if (busyId !== null) return
    setBusyId(sc.id)
    try {
      await api.invokeScript(sc.id)
      setFailed(false)
      setMessage(`${t('invokedScript')} "${sc.name}"`)
    } catch (e) {
      setFailed(true)
      setMessage(`${t('invokeFailed')}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusyId(null)
      reload()
      window.clearTimeout(messageTimer.current)
      messageTimer.current = window.setTimeout(() => setMessage(null), 4000)
    }
  }

  return (
    <div className="dock-stack">
      <ErrorNote error={error} />
      {message !== null && <div className={failed ? 'dock-error' : 'dock-ok'} role="status">{message}</div>}
      <Card
        title={t('scriptsTitle')}
        actions={scripts !== null ? <span className="dock-hint">{String(scripts.length)} {t('unitScripts')}</span> : null}
      >
        {scripts === null
          ? <Empty text={t('loading')} loading />
          : scripts.length === 0
            ? <Empty text={t('scriptsEmpty')} hint={t('scriptsEmptyHint')} />
            : (
              <div className="dock-list">
                {scripts.map((sc) => {
                  const rate = sc.invocationCount > 0 ? sc.successCount / sc.invocationCount : null
                  return (
                    <div key={sc.id} className="dock-row">
                      <div className="grow">
                        <div className="ttl">{sc.name}</div>
                        <div className="meta">
                          {String(sc.steps.length)} {t('stepUnit')} · {t('invokeCountUnit')} {String(sc.invocationCount)} {t('invokeCountSuffix')}
                        </div>
                        {rate !== null && (
                          <div className="dock-row-meter">
                            <Meter pct={rate} tone={rate >= 0.9 ? 'good' : rate >= 0.6 ? 'warn' : undefined} />
                            <span className="dock-hint">{t('successRate')} {String(Math.round(rate * 100))}%</span>
                          </div>
                        )}
                      </div>
                      <RowAction label={t('invoke')} busyLabel={t('invoking')} busy={busyId === sc.id} onRun={() => invoke(sc)} />
                    </div>
                  )
                })}
              </div>
            )}
      </Card>
    </div>
  )
}

/* ─────────── Graph：占位 ─────────── */

export function GraphPane({ t }: { t: SparkT }): JSX.Element {
  return (
    <Empty
      text={t('graphEmpty')}
      hint={t('graphHint')}
    />
  )
}
