/**
 * Spark module panes: 火花流（捕获+列表）/ 涌现提议 / 脚本目录。Graph 子页
 * 留占位（后端暂无 graph 查询 API）。
 *
 * 2026-09 UX 深度重构：
 *  - 所有异步行内操作带 per-action busy 态（防双击 + loading 反馈）
 *  - 捕获表单可见标签 + 捕获成功反馈（消除 silent success）
 *  - 字符图标 ✦ → SVG 火花；空态加视觉锚点
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { SparkView, ProposalView, ScriptView } from 'dsh-spark-wire'
import { createDockSparksApi, type DockSparksApi } from './sparkApi.ts'
import { subscribeStream } from '../streams.ts'

const api: DockSparksApi = createDockSparksApi()

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

/* ─────────── 火花流：捕获表单 + 列表 ─────────── */

export function SparksPane(): JSX.Element {
  const [status, setStatus] = useState<'active' | 'archived'>('active')
  const { data: sparks, error, reload } = useApiResource<SparkView[]>(() => api.list({ status, limit: 50 }), [status])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [captured, setCaptured] = useState(false)
  const capturedTimer = useRef(0)

  useEffect(() => subscribeStream('/sparks/events', () => reload()), [reload])
  useEffect(() => () => window.clearTimeout(capturedTimer.current), [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (title.trim().length === 0 || content.trim().length === 0 || busy) return
    setBusy(true); setFormError(null); setCaptured(false)
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
      await api.capture({ title: title.trim(), content: content.trim(), scope, tags: tagList })
      setTitle(''); setContent(''); setTags('')
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
      <form className="dock-card" onSubmit={submit}>
        <label className="dock-lab" htmlFor="spark-cap-title">标题</label>
        <input id="spark-cap-title" className="dock-field" placeholder="一句话（≤ 60 字）" value={title} maxLength={60}
          onChange={(e) => setTitle(e.target.value)} />
        <label className="dock-lab" htmlFor="spark-cap-content">灵感</label>
        <textarea id="spark-cap-content" className="dock-field" rows={2} placeholder="把灵感写下来…（一句或两句）" value={content}
          onChange={(e) => setContent(e.target.value)} />
        <div className="dock-fieldrow">
          <input className="dock-field grow" aria-label="标签（逗号分隔）" placeholder="标签（逗号分隔）" value={tags}
            onChange={(e) => setTags(e.target.value)} />
          <select className="dock-field sel" aria-label="作用域" value={scope} onChange={(e) => setScope(e.target.value as 'project' | 'global')}>
            <option value="project">项目</option>
            <option value="global">全局</option>
          </select>
          <button className="dock-btn" type="submit" disabled={busy} aria-busy={busy}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="btn-ico">
              <path d="M12 2.6c.7 5.2 4.2 8.7 9.4 9.4-5.2.7-8.7 4.2-9.4 9.4-.7-5.2-4.2-8.7-9.4-9.4 5.2-.7 8.7-4.2 9.4-9.4z" />
            </svg>
            {busy ? '捕获中…' : '捕获'}
          </button>
        </div>
        <ErrorNote error={formError} />
        {captured && <div className="dock-ok" role="status">已捕获 ✦ 可在下方列表找到它</div>}
      </form>

      <div className="dock-modbar" role="group" aria-label="火花筛选">
        <button className={status === 'active' ? 'dock-pill on' : 'dock-pill'} aria-pressed={status === 'active'} onClick={() => setStatus('active')} type="button">活跃</button>
        <button className={status === 'archived' ? 'dock-pill on' : 'dock-pill'} aria-pressed={status === 'archived'} onClick={() => setStatus('archived')} type="button">已归档</button>
      </div>
      <ErrorNote error={error} />
      {sparks === null
        ? <Empty text="加载中…" loading />
        : sparks.length === 0
          ? <Empty text="还没有火花" hint="想到什么就记下来，灵感会在这里沉淀。" />
          : (
            <SparkList sparks={sparks} reload={reload} />
          )}
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
    <div className="dock-card list">
      {sparks.map((s) => (
        <div key={s.id} className={s.status === 'archived' ? 'dock-row off' : 'dock-row'}>
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

/* ─────────── 涌现提议 ─────────── */

export function ProposalsPane(): JSX.Element {
  const { data: proposals, error, reload } = useApiResource<ProposalView[]>(() => api.listProposals({ status: 'pending', limit: 50 }), [])
  const [reflecting, setReflecting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  useEffect(() => subscribeStream('/proposals/events', () => reload()), [reload])

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
      <div className="dock-modbar">
        <button className="dock-btn" type="button" disabled={reflecting} aria-busy={reflecting}
          onClick={() => { void reflect() }}>
          {reflecting ? '涌现中…' : '跑一次涌现（Reflect）'}
        </button>
        <span className="dock-hint">从最近的火花里挖掘可沉淀的模式</span>
      </div>
      <ErrorNote error={error} />
      {proposals === null
        ? <Empty text="加载中…" loading />
        : proposals.length === 0
          ? <Empty text="没有待决议的涌现提议" hint="点上方按钮跑一次 Reflect，AI 会主动提议可结晶的模式。" />
          : (
            <div className="dock-card list">
              {proposals.map((p) => (
                <div key={p.id} className="dock-row">
                  <div className="grow">
                    <div className="ttl">{p.type} · {p.explanation}</div>
                    <div className="meta">{p.leverage} 杠杆 · 置信 {Math.round(p.confidence * 100)}% · {timeAgo(p.createdAt)}</div>
                  </div>
                  <RowAction label="接受" busyLabel="…" busy={busyId === p.id} onRun={() => resolve(p.id, 'accepted')} />
                  <RowAction label="驳回" busyLabel="…" busy={busyId === p.id} onRun={() => resolve(p.id, 'dismissed')} />
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

/* ─────────── 脚本目录 ─────────── */

export function ScriptsPane(): JSX.Element {
  const { data: scripts, error, reload } = useApiResource<ScriptView[]>(() => api.listScripts(), [])
  const [message, setMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const messageTimer = useRef(0)
  useEffect(() => subscribeStream('/scripts/events', () => reload()), [reload])
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
      {scripts === null
        ? <Empty text="加载中…" loading />
        : scripts.length === 0
          ? <Empty text="还没有脚本" hint="常见多步操作会被自动沉淀为可复用脚本。" />
          : (
            <div className="dock-card list">
              {scripts.map((sc) => (
                <div key={sc.id} className="dock-row">
                  <div className="grow">
                    <div className="ttl">{sc.name}</div>
                    <div className="meta">{sc.steps.length} 步 · 成功率 {sc.invocationCount > 0 ? Math.round((sc.successCount / sc.invocationCount) * 100) : 0}% · 调用 {sc.invocationCount}</div>
                  </div>
                  <RowAction label="调用" busyLabel="调用中…" busy={busyId === sc.id} onRun={() => invoke(sc)} />
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

/* ─────────── Graph：占位 ─────────── */

export function GraphPane(): JSX.Element {
  return <Empty text="Graph 视图待后端查询 API 就绪后接入" />
}
