/**
 * Dock 悬浮球画布：模拟真实 dsh web 端 —— 底下是仿真的会话外壳，右下角是**真的**
 * dsh-spark-dock 悬浮球，点一下展开真面板（模块栏 / 模块头 / 各插件完整 UI）。
 *
 * ADR-003 之后，五个模块全部走**真插件路径**：预览依次调用每个插件 client 入口的
 * `apply()`（真宿主里由 client-modules 加载同一份产物），由它们各自 mount remote /
 * 注册字典 / 注册 `spark.dock.module` 子槽；假宿主只提供 `ctx.slots` 的 ledger 与订阅，
 * dock 通过 `renderSlot` 渲染。预览不再复刻任何装配逻辑（旧版的 starters 已删除）。
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { DockOverlay, type DockRenderSlot } from 'dsh-spark-dock/DockOverlay'
import { DOCK_CSS } from 'dsh-spark-dock/style'
import { createMockCtx, type Lang, type MockCtx, type Scenario } from '../mock/ctx.ts'
import { buildFinanceInjected, buildGithubInjected, buildNpmInjected } from '../mock/plugins.ts'

/** 幂等注入 dock 的全局样式（真宿主由 dock apply 注入；spark 模块的 tab 也用它）。 */
function injectDockStyle(): void {
  const tag = 'dsh-spark-dock'
  if (document.querySelector('style[data-plugin-css="' + tag + '"]') !== null) return
  const style = document.createElement('style')
  style.setAttribute('data-plugin-css', tag)
  style.dataset.plugin = 'dsh-spark-dock'
  style.textContent = DOCK_CSS
  document.head.appendChild(style)
}

/** 假宿主：注册 mock remote 命名空间（各插件的 apply 会 reflect 取它们）。 */
function bootstrapCtx(lang: Lang, scenario: Scenario): ReturnType<typeof createMockCtx> {
  const ctx = createMockCtx({ lang: () => lang, scenario: () => scenario })
  injectDockStyle()
  buildGithubInjected(ctx, scenario)
  buildNpmInjected(ctx, scenario)
  buildFinanceInjected(ctx, scenario)
  return ctx
}

/** 已经跑过真插件 apply 的假 ctx（apply 是异步且非幂等，单飞）。 */
const applied = new WeakSet<MockCtx>()

/**
 * 假宿主的子槽渲染面：订阅 ledger（引用稳定的快照），把每个注册项渲染成
 * `{...inject(), ...owner}`。`only` 过滤、`fallback` 兜底与平台 `RenderOpts` 同义。
 */
function useDockRenderSlot(ctx: MockCtx): DockRenderSlot {
  const entries = useSyncExternalStore(
    useCallback((listener: () => void) => ctx.slots.subscribe(listener), [ctx]),
    useCallback(() => ctx.slots.snapshot('spark.dock.module'), [ctx]),
  )
  return useCallback((_key, owner, opts) => {
    const rows = opts?.only === undefined ? entries : entries.filter((entry) => entry.id === opts.only)
    if (rows.length === 0) return opts?.fallback ?? null
    return rows.map((row) => {
      const Component = row.component as ComponentType<Record<string, unknown>>
      return <Component key={row.id} {...row.inject()} {...owner} />
    })
  }, [entries])
}

/** 仿真的 dsh web 会话外壳（只为给悬浮球一个真实的背景与层级）。 */
function MockDshShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="shell">
      <aside className="shell-side">
        <div className="shell-brand">DeepSeek Harness</div>
        <button type="button" className="shell-new">＋ 新会话</button>
        <nav className="shell-list">
          <div className="shell-item active">插件预览 harness</div>
          <div className="shell-item">dock 面板自测</div>
          <div className="shell-item">价格表同步</div>
          <div className="shell-item">hippomemo 脑区 UI</div>
        </nav>
        <div className="shell-user">
          <span className="shell-avatar">N</span>
          <span>neil-ji</span>
        </div>
      </aside>

      <main className="shell-main">
        <header className="shell-head">
          <div className="shell-title">插件预览 harness</div>
          <div className="shell-badge">F:\AgentStudio\dsh-spark-plugins</div>
        </header>

        <div className="shell-thread">
          <div className="shell-msg user">右下角悬浮球点开看看，五个插件的 UI 都在里面。</div>
          <div className="shell-msg">
            <div className="shell-who">Assistant</div>
            已经装配好了：dock 是真组件，模块由各插件**自己注册**（ADR-003），数据来自预览服务器的 fixture。
          </div>
          <div className="shell-tool">
            <span className="shell-tool-name">pnpm preview</span>
            <span className="shell-tool-line">esbuild → 127.0.0.1:5180 · 零 dsh 进程</span>
          </div>
          <div className="shell-msg">
            提示：拖动悬浮球可以吸附到四角，位置会记在 localStorage；双击复位用工具栏的
            「复位悬浮球」。
          </div>
        </div>

        <div className="shell-composer">
          <div className="shell-composer-inner">输入你的问题…</div>
        </div>
      </main>
      {children}
    </div>
  )
}

/** 单飞装配构件：ctx 只建一次（真宿主由 applier 建一次并保持引用稳定）。 */
interface Booted {
  ctx: MockCtx
  channel: { remote: MockCtx['remote']; events: MockCtx['remote']['spark'] }
}

let booted: Booted | null = null
function ensureBooted(lang: Lang, scenario: Scenario): Booted {
  if (booted !== null) return booted
  const ctx = bootstrapCtx(lang, scenario)
  booted = { ctx, channel: { remote: ctx.remote, events: ctx.remote.spark } }
  return booted
}

/** 依次跑五个插件的真 apply（dock 自己也会注册 spark 模块）。 */
async function applyPlugins(ctx: MockCtx): Promise<void> {
  const [dock, github, npm, finance, hippomemo] = await Promise.all([
    import('dsh-spark-dock/client'),
    import('dsh-connector-github-ui/client'),
    import('dsh-connector-npm-ui/client'),
    import('dsh-spark-finance-client/client'),
    import('dsh-hippomemo/client'),
  ])
  // dock 第一个：它声明 shell.overlay 与 `spark.dock.module` 子槽，并注册 spark 模块。
  await dock.apply(ctx as never)
  await github.apply(ctx as never)
  await npm.apply(ctx as never)
  await finance.apply(ctx as never)
  await hippomemo.apply(ctx as never)
}

export function DockPane({ lang, scenario }: { lang: Lang; scenario: Scenario }): JSX.Element {
  const { ctx, channel } = ensureBooted(lang, scenario)
  const renderSlot = useDockRenderSlot(ctx)
  const [, bump] = useState(0)
  useEffect(() => {
    if (applied.has(ctx)) return
    applied.add(ctx)
    void applyPlugins(ctx).catch((error: unknown) => {
      console.warn('[preview] 插件 apply 失败:', error)
    }).finally(() => { bump((n) => n + 1) })
  }, [ctx])
  return (
    <MockDshShell>
      <DockOverlay channel={channel} renderSlot={renderSlot} />
    </MockDshShell>
  )
}
