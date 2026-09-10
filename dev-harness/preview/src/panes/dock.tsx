/**
 * Dock 悬浮球画布：模拟真实 dsh web 端 —— 底下是仿真的会话外壳，右下角是**真的**
 * dsh-spark-dock 悬浮球，点一下展开真面板（模块栏 / 子页 / 四个插件的完整 UI）。
 *
 * 装配方式镜像 packages/dsh-spark-dock/src/client/index.ts 的 apply()：
 *   locale 字典注册 → 插件 CSS 注入 → setHippoT → 三个 embed starter
 *   → setReflectGetter → 渲染 <DockOverlay />（真组件，非复刻稿）。
 *
 * 与真宿主的唯一差别：ctx 是假宿主（src/mock/ctx.ts），不注册 shell.overlay 槽位
 * ——预览直接把 DockOverlay 挂在页面里，它的根节点自带 pointer-events: auto。
 */
import type { ReactNode } from 'react'
import { DockOverlay } from 'dsh-spark-dock/DockOverlay'
import { DOCK_CSS } from 'dsh-spark-dock/style'
import { setReflectGetter } from 'dsh-spark-dock/reflect'
import { startGithubEmbed } from 'dsh-spark-dock/github'
import { startNpmEmbed } from 'dsh-spark-dock/npm'
import { startFinanceEmbed } from 'dsh-spark-dock/finance'
import { setHippoT } from 'dsh-spark-dock/hippo'
import { HIPPOMEMO_CSS, en as hippoEn, zh as hippoZh } from 'dsh-hippomemo/embed'
import { en as githubEn, zh as githubZh } from 'dsh-connector-github-ui/embed'
import { en as npmEn, zh as npmZh } from 'dsh-connector-npm-ui/embed'
import { en as financeEn, zh as financeZh } from 'dsh-spark-finance-client/embed'
import { createMockCtx, type Lang, type Scenario } from '../mock/ctx.ts'
import { buildFinanceInjected, buildGithubInjected, buildNpmInjected } from '../mock/plugins.ts'

/** 幂等注入插件级 CSS（等价 plugin-kit 的 injectPluginStyle）。 */
function injectStyle(css: string, tag: string, plugin: string): void {
  if (document.querySelector('style[data-plugin-css="' + tag + '"]') !== null) return
  const style = document.createElement('style')
  style.setAttribute('data-plugin-css', tag)
  style.dataset.plugin = plugin
  style.textContent = css
  document.head.appendChild(style)
}

/** 复刻 dock client 入口的装配（真宿主里由 cordis apply 调用）。 */
function bootstrapDock(lang: Lang, scenario: Scenario): void {
  const ctx = createMockCtx({ lang: () => lang, scenario: () => scenario })
  const dictionaries: Array<[string, Record<string, string>, Record<string, string>]> = [
    ['hippomemo.settings', hippoZh, hippoEn],
    ['settings.github', githubZh, githubEn],
    ['settings.npm', npmZh, npmEn],
    ['settings.finance', financeZh, financeEn],
  ]
  for (const [namespace, zh, en] of dictionaries) {
    ctx.locale.register(namespace, 'zh', zh)
    ctx.locale.register(namespace, 'en', en)
  }
  injectStyle(Array.isArray(HIPPOMEMO_CSS) ? HIPPOMEMO_CSS.join('\n') : HIPPOMEMO_CSS, 'hippomemo', 'dsh-hippomemo')
  injectStyle(DOCK_CSS, 'dsh-spark-dock', 'dsh-spark-dock')
  setHippoT(ctx.locale.bind('hippomemo.settings'))

  // 先注册 mock remote 命名空间（remote.github/npm/finance + settingsScope base），
  // 再跑 embed starter：starter 装配完会 reflect.get 这些 id，缺了会永远卡加载态。
  buildGithubInjected(ctx, scenario)
  buildNpmInjected(ctx, scenario)
  buildFinanceInjected(ctx, scenario)

  // 三个 embed starter 是模块级单飞：首次调用后注入面常驻，重挂画布不会重跑。
  startGithubEmbed(ctx)
  startNpmEmbed(ctx)
  startFinanceEmbed(ctx)

  setReflectGetter((id) => ctx.reflect.get(id))
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
          <div className="shell-msg user">右下角悬浮球点开看看，四个插件的设置页都在里面。</div>
          <div className="shell-msg">
            <div className="shell-who">Assistant</div>
            已经装配好了：dock 是真组件，数据来自预览服务器的 fixture。面板里可以切模块、子页，
            也能真的改财务卡的配置（内存态，刷新即复原）。
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

/** 单飞装配：真宿主里 apply() 在挂载前调用，预览等价地在首帧渲染前装配好。 */
let booted = false
function ensureBooted(lang: Lang, scenario: Scenario): void {
  if (booted) return
  booted = true
  bootstrapDock(lang, scenario)
}

export function DockPane({ lang, scenario }: { lang: Lang; scenario: Scenario }): JSX.Element {
  ensureBooted(lang, scenario)
  return (
    <MockDshShell>
      <DockOverlay />
    </MockDshShell>
  )
}
