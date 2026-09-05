/**
 * Spark module panes: 火花流（捕获+列表）/ 涌现提议 / 脚本目录。Graph 子页
 * 留占位（后端暂无 graph 查询 API）。
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { SparkView, ProposalView, ScriptView } from 'dsh-spark-wire'
import { createDockSparksApi, type DockSparksApi } from './sparkApi.ts'

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

function Empty({ text }: { text: string }) {
  return <div className="dock-empty">{text}</div>
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

  useEffect(() => api.subscribe(reload), [reload])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (title.trim().length === 0 || content.trim().length === 0 || busy) return
    setBusy(true); setFormError(null)
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
      await api.capture({ title: title.trim(), content: content.trim(), scope, tags: tagList })
      setTitle(''); setContent(''); setTags('')
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
        <input className="dock-field" placeholder="一句话标题（≤ 60 字）" value={title} maxLength={60}
          onChange={(e) => setTitle(e.target.value)} />
        <textarea className="dock-field" rows={2} placeholder="把灵感写下来…（一句或两句）" value={content}
          onChange={(e) => setContent(e.target.value)} />
        <div className="dock-fieldrow">
          <input className="dock-field grow" placeholder="标签（逗号分隔）" value={tags}
            onChange={(e) => setTags(e.target.value)} />
          <select className="dock-field sel" value={scope} onChange={(e) => setScope(e.target.value as 'project' | 'global')}>
            <option value="project">项目</option>
            <option value="global">全局</option>
          </select>
          <button className="dock-btn" type="submit" disabled={busy}>✦ 捕获</button>
        </div>
        <ErrorNote error={formError} />
      </form>

      <div className="dock-modbar">
        <button className={status === 'active' ? 'dock-pill on' : 'dock-pill'} onClick={() => setStatus('active')} type="button">活跃</button>
        <button className={status === 'archived' ? 'dock-pill on' : 'dock-pill'} onClick={() => setStatus('archived')} type="button">已归档</button>
      </div>
      <ErrorNote error={error} />
      {sparks === null
        ? <Empty text="加载中…" />
        : sparks.length === 0
          ? <Empty text="还没有火花，捕获第一个吧。" />
          : (
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
                        <button className="dock-pill" type="button"
                          onClick={async () => { await api.crystallize(s.id); reload() }}>结晶</button>
                      )}
                      <button className="dock-pill" type="button"
                        onClick={async () => { await api.archive(s.id); reload() }}>归档</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

/* ─────────── 涌现提议 ─────────── */

export function ProposalsPane(): JSX.Element {
  const { data: proposals, error, reload } = useApiResource<ProposalView[]>(() => api.listProposals({ status: 'pending', limit: 50 }), [])
  const [busy, setBusy] = useState(false)
  return (
    <div className="dock-stack">
      <div className="dock-modbar">
        <button className="dock-btn" type="button" disabled={busy}
          onClick={async () => { setBusy(true); try { await api.reflect() } finally { setBusy(false); reload() } }}>
          Reflect（跑涌现）
        </button>
      </div>
      <ErrorNote error={error} />
      {proposals === null
        ? <Empty text="加载中…" />
        : proposals.length === 0
          ? <Empty text="没有待决议的涌现提议。" />
          : (
            <div className="dock-card list">
              {proposals.map((p) => (
                <div key={p.id} className="dock-row">
                  <div className="grow">
                    <div className="ttl">{p.type} · {p.explanation}</div>
                    <div className="meta">{p.leverage} 杠杆 · 置信 {Math.round(p.confidence * 100)}% · {timeAgo(p.createdAt)}</div>
                  </div>
                  <button className="dock-pill" type="button"
                    onClick={async () => { await api.resolveProposal(p.id, 'accepted'); reload() }}>接受</button>
                  <button className="dock-pill" type="button"
                    onClick={async () => { await api.resolveProposal(p.id, 'dismissed'); reload() }}>驳回</button>
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
  return (
    <div className="dock-stack">
      <ErrorNote error={error} />
      {message !== null && <div className="dock-ok">{message}</div>}
      {scripts === null
        ? <Empty text="加载中…" />
        : scripts.length === 0
          ? <Empty text="还没有脚本。" />
          : (
            <div className="dock-card list">
              {scripts.map((sc) => (
                <div key={sc.id} className="dock-row">
                  <div className="grow">
                    <div className="ttl">{sc.name}</div>
                    <div className="meta">{sc.steps.length} 步 · 成功率 {sc.invocationCount > 0 ? Math.round((sc.successCount / sc.invocationCount) * 100) : 0}% · 调用 {sc.invocationCount}</div>
                  </div>
                  <button className="dock-pill" type="button"
                    onClick={async () => {
                      try { await api.invokeScript(sc.id); setMessage(`已调用「${sc.name}」`) } catch (e) { setMessage(`调用失败：${e instanceof Error ? e.message : String(e)}`) }
                      reload()
                    }}>调用</button>
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

/* ─────────── Graph：占位 ─────────── */

export function GraphPane(): JSX.Element {
  return <Empty text="Graph 视图待后端查询 API 就绪后接入。" />
}
