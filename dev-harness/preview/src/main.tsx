/**
 * 零 dsh 预览壳。
 *
 * 默认画布 = **Dock 悬浮球**：仿真的 dsh web 外壳 + 真 dsh-spark-dock（点击展开面板）。
 * 其余画布是组件级单渲染（github / npm / finance / hippomemo / ui-kit），便于逐个走查。
 *
 * 语言与场景会持久化到 localStorage 后**整页重载**：dock 的 embed starter 是模块级单飞，
 * 只有重载才能让它们用新的语言/场景重新装配（等价于宿主重载插件）。
 * 主题不需要重载（只是切 body[data-theme]）。
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DockPane } from './panes/dock.tsx'
import { GithubPane } from './panes/github.tsx'
import { NpmPane } from './panes/npm.tsx'
import { FinancePane } from './panes/finance.tsx'
import { HippomemoPane } from './panes/hippomemo.tsx'
import { UiKitPane } from './panes/uikit.tsx'
import type { Lang, Scenario } from './mock/ctx.ts'

type PaneId = 'dock' | 'github' | 'npm' | 'finance' | 'hippomemo' | 'uikit'

interface PaneSpec {
  id: PaneId
  label: string
  entry: string
  accent: string
  /** 全幅画布（模拟宿主界面用）。 */
  full?: boolean
}

const PANES: readonly PaneSpec[] = [
  { id: 'dock', label: 'Dock 悬浮球', entry: 'dsh-spark-dock（模拟 dsh web 外壳）', accent: 'var(--spk-acc-spark)', full: true },
  { id: 'github', label: 'GitHub 连接器', entry: 'dsh-connector-github-ui/embed', accent: 'var(--spk-acc-github)' },
  { id: 'npm', label: 'npm 发布管线', entry: 'dsh-connector-npm-ui/embed', accent: 'var(--spk-acc-npm)' },
  { id: 'finance', label: '财务审计', entry: 'dsh-spark-finance-client/embed', accent: 'var(--spk-acc-finance)' },
  { id: 'hippomemo', label: '记忆（HippoMemo）', entry: 'dsh-hippomemo/embed', accent: 'var(--spk-acc-hippomemo)' },
  { id: 'uikit', label: 'UI Kit 组件', entry: 'dsh-ui-kit', accent: 'var(--spk-acc-spark)' },
]

const SCENARIOS: readonly { value: Scenario; label: string }[] = [
  { value: 'ok', label: 'ok 正常数据' },
  { value: 'empty', label: 'empty 空态' },
  { value: 'error', label: 'error 失败态' },
]

const UI_KEY = 'dsh.preview:ui'

interface UiState {
  pane: PaneId
  lang: Lang
  theme: 'dark' | 'light'
  scenario: Scenario
}

const DEFAULT_UI: UiState = { pane: 'dock', lang: 'zh', theme: 'dark', scenario: 'ok' }

function loadUi(): UiState {
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (raw === null) return DEFAULT_UI
    const parsed = JSON.parse(raw) as Partial<UiState>
    return {
      pane: PANES.some((pane) => pane.id === parsed.pane) ? parsed.pane as PaneId : DEFAULT_UI.pane,
      lang: parsed.lang === 'en' ? 'en' : 'zh',
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      scenario: SCENARIOS.some((item) => item.value === parsed.scenario) ? parsed.scenario as Scenario : 'ok',
    }
  } catch {
    return DEFAULT_UI
  }
}

function saveUi(next: UiState): void {
  try { localStorage.setItem(UI_KEY, JSON.stringify(next)) } catch { /* ignore */ }
}

const initial = loadUi()

/** 悬浮球位置/开合状态也在这里复位（与 dock 自己用的 key 一致）。 */
function resetDockPosition(): void {
  for (const key of ['dsh.spark-dock:pos', 'dsh.spark-dock:open', 'dsh.spark-dock:active']) {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  }
  location.reload()
}

function App(): JSX.Element {
  const [ui, setUi] = useState<UiState>(initial)
  const [probe, setProbe] = useState<{ mode?: string; watch?: boolean; buildVersion?: number; scenario?: string } | null>(null)
  const [nonce, setNonce] = useState(0)

  // 主题即时生效（不重载）。
  useEffect(() => { document.body.dataset.theme = ui.theme }, [ui.theme])

  // 构建产物变更 → 自动整页刷新。
  useEffect(() => {
    const source = new EventSource('/__preview/events')
    let seen = 0
    source.onmessage = () => {
      seen += 1
      if (seen > 1) location.reload()
    }
    return () => source.close()
  }, [])

  useEffect(() => {
    void fetch('/__preview/probe')
      .then((response) => response.json())
      .then((value) => setProbe(value))
      .catch(() => setProbe(null))
  }, [nonce])

  const spec = PANES.find((pane) => pane.id === ui.pane) ?? PANES[0]

  /** 语言 / 场景：落盘 + 重载（让 dock 的模块级单飞重新装配）。 */
  const restartWith = (patch: Partial<UiState>): void => {
    saveUi({ ...ui, ...patch })
    location.reload()
  }

  const body = (): JSX.Element => {
    switch (spec.id) {
      case 'dock': return <DockPane lang={ui.lang} scenario={ui.scenario} />
      case 'github': return <GithubPane lang={ui.lang} scenario={ui.scenario} />
      case 'npm': return <NpmPane lang={ui.lang} scenario={ui.scenario} />
      case 'finance': return <FinancePane lang={ui.lang} scenario={ui.scenario} />
      case 'hippomemo': return <HippomemoPane lang={ui.lang} scenario={ui.scenario} />
      default: return <UiKitPane />
    }
  }

  return (
    <div className="pv-shell">
      <aside className="pv-rail">
        <div className="pv-brand">
          Spark Plugins 预览
          <small>零 dsh · 真产物 · 假宿主</small>
        </div>
        {PANES.map((item) => (
          <button
            key={item.id}
            type="button"
            className="pv-tab"
            aria-current={item.id === spec.id}
            style={{ ['--pv-acc' as string]: item.accent }}
            onClick={() => { saveUi({ ...ui, pane: item.id }); setUi({ ...ui, pane: item.id }); setNonce((value) => value + 1) }}
          >
            <span className="pv-dot" />
            {item.label}
          </button>
        ))}
        <div className="pv-rail-foot">
          {probe === null ? '探针不可用' : (
            <>
              模式 {probe.mode} · 构建 #{probe.buildVersion}
              <br />
              {probe.watch === true ? '监听中（改码自动刷新）' : '未监听'}
              <br />
              <a href="/__preview/probe" target="_blank" rel="noreferrer">/__preview/probe</a>
            </>
          )}
        </div>
      </aside>

      <main className="pv-main">
        <header className="pv-bar">
          <span className="pv-bar-title">{spec.label}</span>
          <span className="pv-bar-meta">{spec.entry}</span>
          <span className="pv-bar-spacer" />
          {spec.id === 'dock' && (
            <button type="button" className="pv-action" onClick={resetDockPosition}>复位悬浮球</button>
          )}
          <label className="pv-field">
            语言
            <select value={ui.lang} onChange={(event) => restartWith({ lang: event.target.value as Lang })}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="pv-field">
            主题
            <select value={ui.theme} onChange={(event) => setUi({ ...ui, theme: event.target.value as 'dark' | 'light' })}>
              <option value="dark">暗色</option>
              <option value="light">亮色</option>
            </select>
          </label>
          <label className="pv-field">
            场景
            <select value={ui.scenario} onChange={(event) => restartWith({ scenario: event.target.value as Scenario })}>
              {SCENARIOS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" className="pv-reload" onClick={() => location.reload()}>重载</button>
        </header>
        <div className={spec.full === true ? 'pv-canvas pv-canvas-full' : 'pv-canvas'}>
          <div key={`${spec.id}:${nonce}`} style={{ height: '100%' }}>{body()}</div>
        </div>
      </main>
    </div>
  )
}

/** 首屏前把场景同步给预览服务器（hippomemo / spark 的 fixture 按它返回数据）。 */
async function bootstrap(): Promise<void> {
  try {
    await fetch('/__preview/scenario', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: initial.scenario }),
    })
  } catch { /* 服务器没起来时照常渲染，页面会显示探针不可用 */ }
  const container = document.getElementById('root')
  if (container === null) throw new Error('#root missing')
  createRoot(container).render(<App />)
}

void bootstrap()
