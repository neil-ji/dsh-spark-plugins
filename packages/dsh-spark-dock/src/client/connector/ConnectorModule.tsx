/**
 * GitHub / npm connector dock panes: connection status glance via the
 * host remote namespaces (same access pattern as the connector UI bundles).
 */
import { useCallback, useEffect, useState } from 'react'
import { getNamespace } from '../reflect.ts'

interface WireResult<T> { ok: boolean; value?: T; error?: { message: string } }

interface GithubWhoami { login: string; name: string | null; scopes: string[] }

export function GithubPane(): JSX.Element {
  const github = getNamespace<{ whoami: (input?: { draftToken?: string }) => Promise<WireResult<GithubWhoami>> }>('remote.github')
  const [whoami, setWhoami] = useState<GithubWhoami | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const test = useCallback(async () => {
    if (github?.whoami === undefined) return
    setBusy(true)
    try {
      const result = await github.whoami({})
      if (!result.ok) { setError(result.error?.message ?? 'whoami failed'); setWhoami(null) }
      else { setWhoami(result.value ?? null); setError(null) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }, [github])

  useEffect(() => { void test() }, [test])

  if (github?.whoami === undefined) {
    return <div className="dock-empty">github 连接器未加载。</div>
  }

  return (
    <div className="dock-stack">
      <div className="dock-card">
        <div className="dock-row" style={{ paddingLeft: 0, paddingTop: 0 }}>
          <i className={'dock-sdot ' + (whoami !== null ? 'done' : 'warn')} />
          <div className="grow">
            <div className="ttl">{whoami !== null ? '已连接' : '未验证'}</div>
            <div className="meta">{whoami !== null ? `${whoami.login}${whoami.name !== null ? ' · ' + whoami.name : ''}` : '点击「测试连接」验证令牌'}</div>
          </div>
        </div>
        {whoami !== null && whoami.scopes.length > 0 && (
          <div className="dock-scopes">{whoami.scopes.join(' · ')}</div>
        )}
        <button className="dock-btn ghost" type="button" disabled={busy} onClick={() => { void test() }}>
          测试连接
        </button>
        {error !== null && <div className="dock-error">{error}</div>}
      </div>
    </div>
  )
}

interface NpmPackageInfo { name: string; exists: boolean; latest: string | null }

export function NpmPane(): JSX.Element {
  const npm = getNamespace<{ 'status.get': () => Promise<WireResult<{ ok: boolean; registry: string; error: string | null; packages: NpmPackageInfo[] }>> }>('remote.npm')
  const [registry, setRegistry] = useState<string | null>(null)
  const [registryOk, setRegistryOk] = useState<boolean | null>(null)
  const [packages, setPackages] = useState<NpmPackageInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (npm?.['status.get'] === undefined) return
    try {
      const result = await npm['status.get']()
      if (!result.ok) throw new Error(result.error?.message ?? 'status.get failed')
      setRegistry(result.value?.registry ?? null)
      setRegistryOk(result.value?.ok ?? null)
      setPackages(result.value?.packages ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [npm])

  useEffect(() => { void load() }, [load])

  if (npm?.['status.get'] === undefined) {
    return <div className="dock-empty">npm 连接器未加载。</div>
  }

  return (
    <div className="dock-stack">
      <div className="dock-card">
        <div className="dock-row" style={{ paddingLeft: 0, paddingTop: 0 }}>
          <i className={'dock-sdot ' + (registryOk === true ? 'done' : registryOk === false ? 'error' : 'warn')} />
          <div className="grow">
            <div className="ttl">npm 注册表</div>
            <div className="meta">{registry ?? '—'}</div>
          </div>
          <span className={'dock-pill mini' + (registryOk === true ? ' accent' : '')}>{registryOk === true ? '可达' : registryOk === false ? '不可达' : '未知'}</span>
        </div>
        {error !== null && <div className="dock-error">{error}</div>}
      </div>
      <div className="dock-hline"><b>套件包</b></div>
      <div className="dock-card list">
        {packages === null
          ? <div className="dock-empty">加载中…</div>
          : packages.map((p) => (
            <div key={p.name} className="dock-row">
              <i className={'dock-sdot ' + (p.exists ? 'done' : 'error')} />
              <div className="grow"><div className="ttl">{p.name}</div></div>
              <span className="dock-hint">{p.exists ? `已发布 · ${p.latest ?? '?'}` : '未发布'}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
