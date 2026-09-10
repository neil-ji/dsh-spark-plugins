/**
 * Spark module panes: 火花流（捕获+列表）/ 涌现提议 / 脚本目录。Graph 子页
 * 留占位（后端暂无 graph 查询 API）。
 *
 * 2026-09 深度重做：
 *  - 捕获 = 一条输入流（第一行即标题），标签/作用域收进渐进披露——先写，后整理
 *  - 涌现提议 = 提议卡（类型徽章 + 置信度计量条 + 主/次操作），决策一眼可读
 *  - 脚本目录 = 行内成功率/调用量计量可视化
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Card, Pill } from 'dsh-ui-kit'
import { useFrames } from 'dsh-spark-plugin-kit/client'
import type { SparkView, ProposalView, ScriptView } from 'dsh-spark-wire'
import { createDockSparksApi, type DockSparksApi } from './sparkApi.ts'
import { SPARK_EVENTS_STREAM, type SparkEventChannel } from './remote.ts'

const api: DockSparksApi = createDockSparksApi()

/** 子页依赖面：事件通道由 dock 通过插槽 inject 面下发（不再用模块级单例）。 */
export interface SparkPaneDeps {
  channel: SparkEventChannel | null
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

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
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
function RowAction({ label, busyLabel, busy, onRun }: { label: string; busyLabel?: string; busy: boolean; onRun: () => Promise<void> }) {
  return (
    <button className="dock-pill" type="button" disabled={busy} aria-busy={busy}
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

/* ─────────── 火花流：一条输入流 + 列表 ─────────── */

export function SparksPane({ channel }: SparkPaneDeps): JSX.Element {
  const [status, setStatus] = useState<'active' | 'archived'>('active')
  const { data: sparks, error, reload } = useApiResource<SparkView[]>(() => api.list({ status, limit: 50 }), [status])
  const [draft, setDraft] = useState('')
  const [tags, setTags] = useState('')
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [captured, setCaptured] = useState(false)
  const capturedTimer = useRef(0)

  useSparkTopicRefresh(channel, ['spark'], reload)
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
      const tagList = tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
      await api.capture({ title, content: text, scope, tags: tagList })
      setDraft(''); setTags('')
      setCaptured(true)
      window.clearTimeout(capturedTimer.current)
      capturedTimer.current = window.setTimeout(() => setCaptured(false), 2600)
      reload()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dock-stack">
      {/* Card 头 = 「这一组是什么」，容器里的字段不再重复写一遍组名。
          筛选用 ui-kit Pill 的语义胶囊，计数作为头部的状态位。 */}
      <Card
        title="火花列表"
        actions={(
          <>
            <Pill active={status === 'active'} onClick={() => setStatus('active')}>{'活跃'}</Pill>
            <Pill active={status === 'archived'} onClick={() => setStatus('archived')}>{'已归档'}</Pill>
            {sparks !== null ? <span className="dock-hint">{sparks.length} 条</span> : null}
          </>
        )}
      >
        <ErrorNote error={error} />
        {sparks === null
          ? <Empty text="加载中…" loading />
          : sparks.length === 0
            ? <Empty text={status === 'active' ? '还没有火花' : '没有已归档的火花'} hint="想到什么就记下来，灵感会在这里沉淀。" />
            : <SparkList sparks={sparks} reload={reload} />}
      </Card>

      <form className="dock-capture" onSubmit={submit}>
        <label className="dock-lab" htmlFor="spark-draft">捕获火花</label>
        <textarea id="spark-draft" className="dock-field" rows={3}
          placeholder={'想到什么就写下来…\n第一行会作为标题。'}
          value={draft} onChange={(e) => setDraft(e.target.value)} />
        <details className="dock-details">
          <summary>标签与作用域（可选）</summary>
          <div className="dock-details-body">
            <input className="dock-field" aria-label="标签（逗号分隔）" placeholder="标签（逗号分隔）" value={tags}
              onChange={(e) => setTags(e.target.value)} />
            <select className="dock-field" aria-label="作用域" value={scope} onChange={(e) => setScope(e.target.value as 'project' | 'global')}>
              <option value="project">项目作用域</option>
              <option value="global">全局作用域</option>
            </select>
          </div>
        </details>
        <div className="dock-capture-bar">
          <span className="dock-hint" aria-live="polite">{busy ? '捕获中…' : captured ? '已捕获 ✦' : `${draft.length} 字`}</span>
          <span className="grow-spacer" />
          <button className="dock-btn" type="submit" disabled={busy || draft.trim().length === 0} aria-busy={busy}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="btn-ico">
              <path d="M12 2.6c.7 5.2 4.2 8.7 9.4 9.4-5.2.7-8.7 4.2-9.4 9.4-.7-5.2-4.2-8.7-9.4-9.4 5.2-.7 8.7-4.2 9.4-9.4z" />
            </svg>
            {busy ? '捕获中…' : '捕获'}
          </button>
        </div>
        <ErrorNote error={formError} />
      </form>
    </div>
  )
}

function SparkList({ sparks, reload }: { sparks: SparkView[]; reload: () => void }): JSX.Element {
  const [busyId, setBusyId] = useState<string | null>(null)
  const run = async (id: string, fn: () => Promise<void>) => {
    if (busyId !== null) return
    setBusyId(id)
    try { await fn() } finally { setBusyId(null); reload() }
  }
  return (
    <div className="dock-list">
      {sparks.map((s) => (
        <div key={s.id} className={s.status === 'archived' ? 'dock-row off' : 'dock-row'}>
          {s.crystallized !== null && <span className="dock-row-dot cryst" title="已结晶" aria-label="已结晶" />}
          <div className="grow">
            <div className="ttl">{s.title}</div>
            <div className="meta">
              {s.status === 'archived' ? '已归档' : '活跃'} · {s.scope} · {timeAgo(s.updatedAt)}
              {s.crystallized !== null && <span className="cryst"> · 已结晶</span>}
            </div>
          </div>
          {s.status === 'active' && (
            <>
              {s.crystallized === null && (
                <RowAction label="结晶" busyLabel="结晶中…" busy={busyId === s.id}
                  onRun={() => run(s.id, async () => { await api.crystallize(s.id) })} />
              )}
              <RowAction label="归档" busyLabel="归档中…" busy={busyId === s.id}
                onRun={() => run(s.id, async () => { await api.archive(s.id) })} />
            </>
          )}
        </div>
      ))}
    </div>
  )
}

/* ─────────── 涌现提议：提议卡 ─────────── */

export function ProposalsPane({ channel }: SparkPaneDeps): JSX.Element {
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
        title="待决议提议"
        actions={(
          <>
            <span className="dock-hint">从最近的火花里挖掘可沉淀的模式</span>
            <button className="dock-pill" type="button" disabled={reflecting} aria-busy={reflecting}
              onClick={() => { void reflect() }}>
              {reflecting ? '涌现中…' : '跑一次涌现（Reflect）'}
            </button>
          </>
        )}
      >
        {proposals === null
          ? <Empty text="加载中…" loading />
          : proposals.length === 0
            ? <Empty text="没有待决议的涌现提议" hint="点上方按钮跑一次 Reflect，AI 会主动提议可结晶的模式。" />
            : (
              <div className="dock-stack">
                {proposals.map((p) => {
                  const conf = Math.round(p.confidence * 100)
                  return (
                    <div key={p.id} className="dock-prop">
                      <div className="dock-prop-head">
                        <span className="dock-prop-type">{p.type}</span>
                        <span className="grow-spacer" />
                        <span className="dock-hint">{timeAgo(p.createdAt)}</span>
                      </div>
                      <div className="dock-prop-text">{p.explanation}</div>
                      <div className="dock-prop-meter">
                        <Meter pct={p.confidence} tone={conf >= 70 ? 'good' : conf >= 40 ? 'warn' : undefined} />
                        <span className="dock-hint">置信 {conf}% · {p.leverage} 杠杆</span>
                      </div>
                      <div className="dock-prop-actions">
                        <button className="dock-btn" type="button" disabled={busyId === p.id}
                          onClick={() => { void resolve(p.id, 'accepted') }}>
                          {busyId === p.id ? '…' : '接受'}
                        </button>
                        <button className="dock-btn ghost" type="button" disabled={busyId === p.id}
                          onClick={() => { void resolve(p.id, 'dismissed') }}>驳回</button>
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

export function ScriptsPane({ channel }: SparkPaneDeps): JSX.Element {
  const { data: scripts, error, reload } = useApiResource<ScriptView[]>(() => api.listScripts(), [])
  const [message, setMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const messageTimer = useRef(0)
  useSparkTopicRefresh(channel, ['script'], reload)
  useEffect(() => () => window.clearTimeout(messageTimer.current), [])

  const invoke = async (sc: ScriptView) => {
    if (busyId !== null) return
    setBusyId(sc.id)
    try {
      await api.invokeScript(sc.id)
      setMessage(`已调用「${sc.name}」`)
    } catch (e) {
      setMessage(`调用失败：${e instanceof Error ? e.message : String(e)}`)
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
      {message !== null && <div className={message.startsWith('调用失败') ? 'dock-error' : 'dock-ok'} role="status">{message}</div>}
      <Card
        title="脚本目录"
        actions={scripts !== null ? <span className="dock-hint">{scripts.length} 个</span> : null}
      >
        {scripts === null
          ? <Empty text="加载中…" loading />
          : scripts.length === 0
            ? <Empty text="还没有脚本" hint="常见多步操作会被自动沉淀为可复用脚本。" />
            : (
              <div className="dock-list">
                {scripts.map((sc) => {
                  const rate = sc.invocationCount > 0 ? sc.successCount / sc.invocationCount : null
                  return (
                    <div key={sc.id} className="dock-row">
                      <div className="grow">
                        <div className="ttl">{sc.name}</div>
                        <div className="meta">{sc.steps.length} 步 · 调用 {sc.invocationCount} 次</div>
                        {rate !== null && (
                          <div className="dock-row-meter">
                            <Meter pct={rate} tone={rate >= 0.9 ? 'good' : rate >= 0.6 ? 'warn' : undefined} />
                            <span className="dock-hint">成功率 {Math.round(rate * 100)}%</span>
                          </div>
                        )}
                      </div>
                      <RowAction label="调用" busyLabel="调用中…" busy={busyId === sc.id} onRun={() => invoke(sc)} />
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

export function GraphPane(): JSX.Element {
  return <Empty text="Graph 视图待后端查询 API 就绪后接入" />
}
