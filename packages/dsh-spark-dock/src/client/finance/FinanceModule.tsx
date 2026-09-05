/**
 * Finance dock pane: per-provider balance glance (from the host finance
 * remote's listProviders snapshot) + optional refreshBalance action.
 */
import { useCallback, useEffect, useState } from 'react'
import { getFinanceRemote } from './financeRemote.ts'

interface Row {
  provider: string
  status: 'ok' | 'missing-credential' | 'unsupported' | 'error'
  amount: string | null
  message?: string | undefined
}

function formatAmount(micros: number | undefined, currency: string | undefined): string | null {
  if (micros === undefined) return null
  const value = micros / 1e6
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : ''
  return `${symbol ? symbol + ' ' : ''}${value.toFixed(2)}${currency && symbol === '' ? ' ' + currency : ''}`
}

export function FinancePane(): JSX.Element {
  const remote = getFinanceRemote()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (remote?.listProviders === undefined) return
    setBusy(true)
    try {
      const result = await remote.listProviders()
      if (!result.ok) throw new Error(result.error?.message ?? 'listProviders failed')
      const entries = result.value?.providers ?? []
      setRows(entries.map((e) => ({
        provider: e.provider,
        status: e.balance.status,
        amount: formatAmount(e.balance.totalMicros, e.balance.currency),
        message: e.balance.message,
      })))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [remote])

  useEffect(() => { void load() }, [load])

  if (remote?.listProviders === undefined) {
    return <div className="dock-empty">finance 插件未加载，无法显示余额。</div>
  }

  return (
    <div className="dock-stack">
      <div className="dock-modbar">
        <span className="dock-hint">余额快照来自宿主 finance 服务</span>
        <div className="grow-spacer" />
        <button className="dock-pill" type="button" disabled={busy}
          onClick={async () => {
            if (remote.refreshBalance === undefined) return
            setBusy(true)
            try {
              for (const r of rows ?? []) {
                if (r.status === 'ok' || r.status === 'missing-credential') continue
                await remote.refreshBalance({ provider: r.provider }).catch(() => {})
              }
            } finally { setBusy(false); void load() }
          }}>刷新余额</button>
      </div>
      {error !== null && <div className="dock-error">{error}</div>}
      {rows === null
        ? <div className="dock-empty">加载中…</div>
        : rows.length === 0
          ? <div className="dock-empty">还没有配置供应商。</div>
          : (
            <div className="dock-card list">
              {rows.map((r) => (
                <div key={r.provider} className="dock-row">
                  <i className={'dock-sdot ' + (r.status === 'ok' ? 'done' : r.status === 'error' ? 'error' : 'warn')} />
                  <div className="grow">
                    <div className="ttl">{r.provider}</div>
                    <div className="meta">
                      {r.status === 'ok' ? '余额正常'
                        : r.status === 'missing-credential' ? 'API key 未配置'
                        : r.status === 'unsupported' ? '不支持余额查询'
                        : (r.message ?? '查询失败')}
                    </div>
                  </div>
                  <b className="amount">{r.amount ?? (r.status === 'ok' ? '—' : '')}</b>
                </div>
              ))}
            </div>
          )}
    </div>
  )
}
