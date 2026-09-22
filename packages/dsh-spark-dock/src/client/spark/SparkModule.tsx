/**
 * Spark module panes: 灵感（捕获 + 想法列表）/ 涌现提议 / Graph。
 *
 * 2026-09-21：脚本目录 pane 随脚本沉淀库迁到独立插件 `dsh-script-client`
 * （ADR-003 自注册模块），本文件不再持有任何脚本 UI。
 *
 * 2026-09-21 v2 收件箱回退（docs/spark-v2-design-2026-09-21.md §4.2/§6，P11/P16）：
 *  - 状态回退 `active | archived` + 墓碑；筛选位 = 活跃 / 已归档 / 已删除；
 *  - 结晶动作与徽标删除（spark → memory 零直连）；动作 = 归档 / 删除 / 重新激活；
 *  - 文案朴素化，全部走 locale 字典。
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Card, Disclosure, Input, Modal, SegmentedControl, Textarea } from 'dsh-ui-kit'
import { useFrames } from 'dsh-spark-plugin-kit/client'
import type { SparkView, SparkStatus, SparkStats, ProposalView } from 'dsh-spark-wire'
import { api } from './sparkApi.ts'
import { useApiResource } from './useApiResource.ts'
import { SPARK_EVENTS_STREAM, type SparkEventChannel } from './remote.ts'
import type { SparkT } from './locales.ts'



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

/* ─────────── 灵感：一条输入流 + 想法列表 ─────────── */

type SparkFilter = Extract<SparkStatus, 'active' | 'archived'>

const FILTERS: readonly { id: SparkFilter; key: 'filterActive' | 'filterArchived' }[] = [
  { id: 'active', key: 'filterActive' },
  { id: 'archived', key: 'filterArchived' },
]

const EMPTY_KEYS: Record<SparkFilter, { text: 'emptyActive' | 'emptyArchived'; hint: 'emptyActiveHint' | 'emptyArchivedHint' }> = {
  active: { text: 'emptyActive', hint: 'emptyActiveHint' },
  archived: { text: 'emptyArchived', hint: 'emptyArchivedHint' },
}

function countOf(stats: SparkStats | null, filter: SparkFilter): number | null {
  if (stats === null) return null
  return stats[filter]
}

export function SparksPane({ channel, t }: SparkPaneDeps): JSX.Element {
  const [filter, setFilter] = useState<SparkFilter>('active')
  const [showDeleted, setShowDeleted] = useState(false)
  const stats = useApiResource<SparkStats>(() => api.stats(), [])
  const { data: sparks, error, reload } = useApiResource<SparkView[]>(
    () => api.list({ status: filter, includeDeleted: showDeleted, limit: 50 }),
    [filter, showDeleted],
  )
  const [draft, setDraft] = useState('')
  const [tags, setTags] = useState('')
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [captured, setCaptured] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SparkView | null>(null)
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
      setFilter('active')
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
        aria-label={t('inboxTitle') + ': ' + String(stats.data?.active ?? 0) + ' ' + t('filterActive')}>
        {t('inboxTitle')}: {String(stats.data?.active ?? 0)} {t('filterActive')}
      </div>

      <Card
        title={t('inboxTitle')}
        actions={(
          <>
            {/* 过滤器 = SegmentedControl（与财务窗口切换同形制）。「已删除」由开关
                并入互斥 tab，单选语义更干净。计数保留在 tab 文案里。 */}
            <SegmentedControl
              aria-label={t('inboxTitle')}
              value={showDeleted ? 'deleted' : filter}
              onChange={(value) => {
                if (value === 'deleted') { setShowDeleted(true); return }
                setShowDeleted(false); setFilter(value as SparkFilter)
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
            : <SparkList sparks={sparks} reload={refresh} t={t} confirmDelete={setConfirmDelete} />}
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
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t('deleteConfirmTitle')}
        closeLabel={t('cancel')}
        // 关闭钮的可访问名也走字典（ui-kit 只提供中文缺省值，见 ModalProps.closeAriaLabel）
        closeAriaLabel={t('closeDialog')}
        footer={(
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>{t('cancel')}</Button>
            <Button variant="danger" size="sm"
              onClick={() => { const target = confirmDelete; setConfirmDelete(null); if (target !== null) void api.drop(target.id).then(refresh, refresh) }}>
              {t('confirm')}
            </Button>
          </>
        )}
      >
        <p>{t('deleteConfirmBody')}</p>
        {confirmDelete !== null && <p className="dock-hint">{confirmDelete.title}</p>}
      </Modal>
    </div>
  )
}

const STATE_KEYS: Record<SparkView['status'], 'stateActive' | 'stateArchived'> = {
  active: 'stateActive',
  archived: 'stateArchived',
}

function SparkList({ sparks, reload, t, confirmDelete }: {
  sparks: SparkView[]
  reload: () => void
  t: SparkT
  confirmDelete: (spark: SparkView) => void
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
          <div key={s.id} className={'dock-row' + (deleted || s.status === 'archived' ? ' off' : '')}>
            <div className="grow">
              <div className="ttl">{s.title}</div>
              <div className="meta">
                {deleted ? t('stateDeleted') : t(STATE_KEYS[s.status])} · {s.scope} · {timeAgo(s.updatedAt, t)}
                {s.origin !== undefined && s.origin !== 'human' && (
                  <span className="origin-badge" title={s.generation >= 2 ? t('derivedTwiceHint') : undefined}>
                    {' · '}{t(s.origin === 'agent' ? 'originAgent' : 'originDerived')}{s.generation >= 2 ? '²' : ''}
                  </span>
                )}
              </div>
            </div>
            {deleted
              ? (
                <RowAction label={t('actionRestore')} busyLabel={t('restoring')} busy={busyId === s.id}
                  onRun={() => run(s.id, async () => { await api.restore(s.id) })} />
              )
              : s.status === 'active'
                ? (
                  <>
                    {/* 动作（v2 §6）：归档（可恢复）/ 删除（物理删，走二次确认）。 */}
                    <RowAction label={t('actionArchive')} busyLabel={t('archiving')} busy={busyId === s.id}
                      onRun={() => run(s.id, async () => { await api.archive(s.id) })} />
                    <RowAction danger label={t('actionDelete')} busyLabel={t('deleting')} busy={busyId === s.id}
                      onRun={async () => { confirmDelete(s) }} />
                  </>
                )
                : (
                  <RowAction label={t('actionReactivate')} busyLabel={t('reactivating')} busy={busyId === s.id}
                    onRun={() => run(s.id, async () => { await api.setStatus(s.id, 'active') })} />
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
  const [confirmReflect, setConfirmReflect] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  useSparkTopicRefresh(channel, ['proposal'], reload)

  const reflect = async () => {
    if (reflecting) return
    setConfirmReflect(false)
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
          <Button variant="secondary" size="sm" disabled={reflecting} aria-busy={reflecting}
            onClick={() => { setConfirmReflect(true) }}>
            {reflecting ? t('reflecting') : t('reflect')}
          </Button>
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

      {/* 涌现会写库（扫描火花 → 生成/更新提议），不是只读查询 → 二次确认，
          并在确认框里交代作用与后果（2026-09 用户裁决）。 */}
      <Modal
        open={confirmReflect}
        onClose={() => setConfirmReflect(false)}
        title={t('reflectConfirmTitle')}
        closeAriaLabel={t('closeDialog')}
        footer={(
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmReflect(false)}>{t('cancel')}</Button>
            <Button variant="primary" size="sm" loading={reflecting} disabled={reflecting}
              onClick={() => { void reflect() }}>
              {t('reflectConfirmAction')}
            </Button>
          </>
        )}
      >
        <p>{t('reflectConfirmBody')}</p>
      </Modal>
    </div>
  )
}

/* ─────────── Graph：实现在 GraphPane.tsx（口径在宿主 graph.ts） ─────────── */
