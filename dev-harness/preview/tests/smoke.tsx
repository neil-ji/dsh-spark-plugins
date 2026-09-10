/**
 * 零 dsh 预览的 Node 侧冒烟：用真 embed 产物 + 假宿主跑一遍数据流与首屏渲染。
 *
 * 为什么需要它：本机（或 CI）没有可用浏览器时，`preview.js` 是否真的能跑起来
 * 不能靠"能打包"证明。这里用 react-dom/server 做无 DOM 渲染 + 直接调用各包
 * 真 controller 的 load()，覆盖：
 *   - 模块加载（CSS 注入、字典、remote 命名空间）
 *   - 数据流（load/test/save/scope set-unset）
 *   - 首屏渲染输出里出现预期文案
 */
import { renderToString } from 'react-dom/server'
import type { ReactElement } from 'react'
import { createMockCtx, type Lang, type Scenario } from '../src/mock/ctx.ts'
import {
  FinanceCard,
  GithubSection,
  NpmSection,
  buildFinanceInjected,
  buildGithubInjected,
  buildNpmInjected,
} from '../src/mock/plugins.ts'
import { FINANCE_BASE_CONFIG } from '../src/mock/fixtures.ts'
import { DockOverlay } from 'dsh-spark-dock/DockOverlay'
import { DOCK_CSS } from 'dsh-spark-dock/style'

export interface Check {
  name: string
  ok: boolean
  detail: string
}

const checks: Check[] = []

function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail })
}

function expectContains(name: string, html: string, needle: string): void {
  check(name, html.includes(needle), html.includes(needle) ? '' : '未在渲染结果中找到 ' + JSON.stringify(needle))
}

async function flush(): Promise<void> {
  // 让 controller.load() 的 promise 链落定（mocks 里统一 120ms 延迟）。
  await new Promise((resolve) => setTimeout(resolve, 260))
}

/** DockOverlay 在渲染期读 window/localStorage（位置与开合状态），Node 侧补个最小壳。 */
function shimBrowserGlobals(): void {
  const scope = globalThis as unknown as Record<string, unknown>
  scope['window'] ??= {
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
    clearTimeout,
    setTimeout,
  }
  scope['localStorage'] ??= {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
}

export async function run(): Promise<{ checks: Check[] }> {
  const lang: Lang = 'zh'
  const scenario: Scenario = 'ok'

  /* ── dock（真悬浮球 + 真面板骨架）── */
  {
    shimBrowserGlobals()
    const html = renderToString(<DockOverlay /> as ReactElement)
    check('dock: DockOverlay 渲染不抛错', html.length > 0, html.length > 0 ? '' : '渲染结果为空')
    const hasBall = html.includes('dock-ball')
    check('dock: 渲染出悬浮球', hasBall, hasBall ? '' : '未找到 .dock-ball')
    const hasPanel = html.includes('dock-panel') && html.includes('dock-rail')
    check('dock: 渲染出面板骨架', hasPanel, hasPanel ? '' : '未找到面板/模块栏')
    const railLabels = ['火花', '记忆', '成本', 'GitHub', 'npm']
    const missing = railLabels.filter((label) => !html.includes('aria-label="' + label + '"'))
    check('dock: 五个模块 tab 都在', missing.length === 0, missing.length === 0 ? '' : '缺少 ' + missing.join('、'))
    const activeName = html.includes('火花流 Sparks')
    check('dock: 默认模块是火花流', activeName, activeName ? '' : '未找到默认模块标题')
    const hasCss = typeof DOCK_CSS === 'string' && DOCK_CSS.includes('.dock-ball')
    check('dock: DOCK_CSS 非空', hasCss, hasCss ? '' : 'DOCK_CSS 异常')
  }

  /* ── github ── */
  {
    const ctx = createMockCtx({
      lang: () => lang,
      scenario: () => scenario,
      credentials: { GITHUB_TOKEN: { configured: true, source: 'credentials', writable: true } },
    })
    const injected = buildGithubInjected(ctx, scenario)
    const first = renderToString(<GithubSection {...injected} /> as ReactElement)
    check('github: 首屏渲染不抛错', typeof first === 'string' && first.length > 0, '')
    await injected.controller.load()
    await flush()
    const state = injected.controller.store.getSnapshot()
    check('github: load() 拿到 config', state.config?.apiBase === 'https://api.github.com', JSON.stringify(state.status))
    check('github: load() 拿到凭据状态', state.credential?.configured === true, JSON.stringify(state.credential))
    const failure = await injected.controller.testConnection('ghp_bad-token')
    check('github: 坏 token 测试返回失败文案', failure !== undefined && failure.includes('401'), String(failure))
    const good = await injected.controller.testConnection()
    check('github: 连接测试成功', good === undefined && injected.controller.store.getSnapshot().whoami?.login === 'neil-ji', String(good))
    const saveFailure = await injected.controller.saveToken('ghp_preview_token')
    check('github: 保存 token 成功', saveFailure === undefined, String(saveFailure))
    const html = renderToString(<GithubSection {...injected} /> as ReactElement)
    expectContains('github: 渲染出 git 身份', html, 'neil@example.com')
    expectContains('github: 渲染出登录名', html, 'neil-ji')
  }

  /* ── npm ── */
  {
    const ctx = createMockCtx({
      lang: () => lang,
      scenario: () => scenario,
      credentials: { NPM_TOKEN: { configured: true, source: 'credentials', writable: true } },
    })
    const injected = buildNpmInjected(ctx, scenario)
    await injected.controller.load()
    await flush()
    const state = injected.controller.store.getSnapshot()
    check('npm: load() 拿到 registry 状态', (state.statusView?.packages.length ?? 0) > 0, JSON.stringify(state.status))
    check('npm: token 状态已配置', state.token?.configured === true, JSON.stringify(state.token))
    const bad = await injected.controller.testConnection('npm_bad-token')
    check('npm: 坏 token 测试返回失败文案', bad !== undefined && bad.includes('403'), String(bad))
    const okTest = await injected.controller.testConnection('npm_preview_token')
    check('npm: 连接测试成功', okTest === undefined, String(okTest))
    const html = renderToString(<NpmSection {...injected} /> as ReactElement)
    expectContains('npm: 渲染出包名', html, 'dsh-spark')
    expectContains('npm: 渲染出 registry', html, 'registry.npmjs.org')
  }

  /* ── finance ── */
  {
    const ctx = createMockCtx({ lang: () => lang, scenario: () => scenario })
    const injected = buildFinanceInjected(ctx, scenario, FINANCE_BASE_CONFIG)
    const first = renderToString(<FinanceCard {...injected.card} /> as ReactElement)
    check('finance: 首屏渲染不抛错', typeof first === 'string' && first.length > 0, '')
    await injected.audit.load()
    await flush()
    const audit = injected.audit.store.getSnapshot()
    check('finance: ledger 载入', (audit.ledger?.byModel.length ?? 0) > 0, JSON.stringify(audit.status))
    check('finance: provider 列表载入', (audit.providerList?.providers.length ?? 0) === 3, JSON.stringify(audit.providerList?.providers.length))
    const scope = injected.scope as unknown as {
      set(field: string, value: unknown): Promise<void>
      unset(field: string): Promise<void>
      getSnapshot(): { user: unknown }
    }
    await scope.set('balance.timeoutMs', 5000)
    check('finance: scope.set 写入 user 层', JSON.stringify(scope.getSnapshot().user).includes('5000'), JSON.stringify(scope.getSnapshot().user))
    await scope.unset('balance.timeoutMs')
    check('finance: scope.unset 清掉 user 层', !JSON.stringify(scope.getSnapshot().user).includes('5000'), JSON.stringify(scope.getSnapshot().user))
    const html = renderToString(<FinanceCard {...injected.card} /> as ReactElement)
    expectContains('finance: 默认页签是总览（dashboard）', html, 'finance-card-dashboard')
    expectContains('finance: 页签栏 role=tablist', html, 'role="tablist"')
    // 单页渲染：只有当前页签的面板在 DOM 里（折叠交互已移除）
    expectContains('finance: 当前页签面板存在', html, 'finance-tab-overview')
    check('finance: 未选中的页签不渲染', !html.includes('finance-tab-advanced'), '')
    expectContains('finance: 渲染出 provider 行', html, 'deepseek')
    expectContains('finance: 渲染出成本数字', html, 'CNY')
  }

  /* ── 空态 / 失败态 ── */
  {
    const ctx = createMockCtx({ lang: () => lang, scenario: () => 'error' })
    const injected = buildGithubInjected(ctx, 'error')
    await injected.controller.load()
    await flush()
    const state = injected.controller.store.getSnapshot()
    check('github: error 场景进入错误态', state.status === 'error', JSON.stringify(state.status))
    const html = renderToString(<GithubSection {...injected} /> as ReactElement)
    expectContains('github: 错误态有重试按钮文案', html, injected.t('retry'))
  }
  {
    const ctx = createMockCtx({ lang: () => lang, scenario: () => 'empty' })
    const injected = buildNpmInjected(ctx, 'empty')
    await injected.controller.load()
    await flush()
    const state = injected.controller.store.getSnapshot()
    check('npm: empty 场景 packages 为空', (state.statusView?.packages.length ?? -1) === 0, JSON.stringify(state.statusView?.packages.length))
  }

  return { checks }
}
