/**
 * HippoMemo dock panes: 总览（stats + 旁白）/ 记忆（搜索 + 列表）/
 * 偏好 / 进化（待处理候选 + 预演）。
 */
import { useCallback, useEffect, useState } from 'react'
import { createDockHippomemoApi, type DockHippomemoApi, type MemoryRow, type PendingCandidate } from './hippoApi.ts'
import { subscribeStream } from '../streams.ts'

const api: DockHippomemoApi = createDockHippomemoApi()

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

/* ─────────── 总览 ─────────── */

export function HippoOverviewPane(): JSX.Element {
  const [stats, setStats] = useState<{ total: number; active: number; candidate: number } | null>(null)
  const [narrative, setNarrative] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, n] = await Promise.all([api.stats(), api.narrative().catch(() => null)])
      setStats({ total: s.total, active: s.active, candidate: s.candidate })
      setNarrative(n?.text ?? null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
    return subscribeStream('/hippomemo/events', () => { void load() })
  }, [load])

  return (
    <div className="dock-stack">
      {error !== null && <div className="dock-error">{error}</div>}
      {stats === null
        ? <div className="dock-empty">加载中…</div>
        : (
          <div className="dock-card">
            <div className="dock-statrow">
              <div className="dock-stat"><div className="k">全部</div><div className="v">{stats.total}</div></div>
              <div className="dock-stat"><div className="k">活跃</div><div className="v">{stats.active}</div></div>
              <div className="dock-stat"><div className="k">候选</div><div className="v">{stats.candidate}</div></div>
            </div>
            {narrative !== null && <div className="dock-narr"><span className="lab">旁白</span>{narrative}</div>}
          </div>
        )}
    </div>
  )
}

/* ─────────── 记忆 ─────────── */

export function HippoMemoriesPane(): JSX.Element {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<MemoryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (query: string) => {
    try {
      const result = await api.list(query.length > 0 ? { q: query, limit: 20 } : { limit: 20 })
      setRows(result.items as unknown as MemoryRow[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { void load(q) }, 250)
    return () => clearTimeout(t)
  }, [q, load])

  useEffect(() => subscribeStream('/hippomemo/events', () => { void load(q) }), [load, q])

  return (
    <div className="dock-stack">
      <input className="dock-field" placeholder="搜索记忆..." value={q}
        onChange={(e) => setQ(e.target.value)} />
      {error !== null && <div className="dock-error">{error}</div>}
      {rows === null
        ? <div className="dock-empty">加载中…</div>
        : rows.length === 0
          ? <div className="dock-empty">{q.length > 0 ? '没有匹配的记忆。' : '还没有记忆。'}</div>
          : (
            <div className="dock-card list">
              {rows.map((m) => (
                <div key={m.id} className={m.status === 'active' ? 'dock-row' : 'dock-row off'}>
                  <div className="grow">
                    <div className="ttl">{m.title}</div>
                    <div className="meta"><span className="dock-pill mini">{m.kind}</span> {m.scope} · 重要性 {m.importance.toFixed(2)} · {timeAgo(m.updatedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

/* ─────────── 偏好 ─────────── */

export function HippoPrefsPane(): JSX.Element {
  const [rows, setRows] = useState<{ id: string; title: string; source: string; hitCount: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.preferences().then(
      (r) => setRows(r.items.map((i) => ({ id: i.id, title: i.title, source: i.source, hitCount: i.hitCount }))),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  return (
    <div className="dock-stack">
      {error !== null && <div className="dock-error">{error}</div>}
      {rows === null
        ? <div className="dock-empty">加载中…</div>
        : rows.length === 0
          ? <div className="dock-empty">还没有偏好记录。</div>
          : (
            <div className="dock-card list">
              {rows.map((p) => (
                <div key={p.id} className="dock-row">
                  <span className={'dock-pill mini' + (p.source === 'auto' ? ' accent' : '')}>{p.source === 'auto' ? '自动' : '手敲'}</span>
                  <div className="grow">
                    <div className="ttl">{p.title}</div>
                    <div className="meta">命中 {p.hitCount}×</div>
                  </div>
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

/* ─────────── 进化 ─────────── */

const ACTION_LABEL: Record<string, string> = {
  archive: '归档', merge: '合并', confirm: '确认', delete: '删除', auto: '自动', observe: '观察中',
}

export function HippoEvolutionPane(): JSX.Element {
  const [items, setItems] = useState<PendingCandidate[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.candidates()
      setItems(r.items)
      setTotal(r.total)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="dock-stack">
      <div className="dock-modbar">
        <span className="dock-hint">需要我处理 · {total} 项</span>
        <div className="grow-spacer" />
        <button className="dock-pill" type="button" disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const report = await api.evolveRun(true)
              const count = Array.isArray(report.actions) ? report.actions.length : 0
              setMessage(`预演完成：{count} 个动作（未写入）`.replace('{count}', String(count)))
              void load()
            } catch (err) {
              setMessage(`预演失败：${err instanceof Error ? err.message : String(err)}`)
            } finally { setBusy(false) }
          }}>预演检查</button>
      </div>
      {message !== null && <div className="dock-ok">{message}</div>}
      {error !== null && <div className="dock-error">{error}</div>}
      {items === null
        ? <div className="dock-empty">加载中…</div>
        : items.length === 0
          ? <div className="dock-empty">没有待处理的候选。</div>
          : (
            <div className="dock-card list">
              {items.map((c) => (
                <div key={c.id} className="dock-row">
                  <i className={'dock-sdot ' + (c.kind === 'error' ? 'error' : 'warn')} />
                  <div className="grow">
                    <div className="ttl">{c.title}</div>
                    <div className="meta">{c.reason}</div>
                  </div>
                  <span className="dock-pill mini">{ACTION_LABEL[c.suggestedAction] ?? c.suggestedAction}</span>
                </div>
              ))}
            </div>
          )}
    </div>
  )
}
