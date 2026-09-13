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
import { createMockCtx, withInjectGate, type Lang, type MockCtx, type Scenario } from '../src/mock/ctx.ts'
import { createSparkStore } from '../fixtures/sparks.mjs'
import {
  FinancePanel,
  GithubSection,
  WhoToUseView,
  NpmSection,
  buildFinanceInjected,
  buildGithubInjected,
  buildNpmInjected,
} from '../src/mock/plugins.ts'
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

/** DockOverlay 在渲染期读 window/localStorage（位置与开合状态），Node 侧补个最小壳。
 *  插件的 apply 会走 `injectPluginStyle` / CSS Modules 内联注入 → 也要一个最小 document。 */
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
  scope['document'] ??= {
    head: { appendChild() {}, querySelector: () => null },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, remove() {}, appendChild() {} }),
  }
}

export async function run(): Promise<{ checks: Check[] }> {
  const lang: Lang = 'zh'
  const scenario: Scenario = 'ok'

  /* ── dock（真悬浮球 + 真面板骨架；模块全部来自子槽，ADR-003）── */
  {
    shimBrowserGlobals()
    const html = renderToString(<DockOverlay /> as ReactElement)
    check('dock: DockOverlay 渲染不抛错', html.length > 0, html.length > 0 ? '' : '渲染结果为空')
    const hasBall = html.includes('dock-ball')
    check('dock: 渲染出悬浮球', hasBall, hasBall ? '' : '未找到 .dock-ball')
    const hasPanel = html.includes('dock-panel') && html.includes('dock-rail')
    check('dock: 渲染出面板骨架', hasPanel, hasPanel ? '' : '未找到面板/模块栏')
    // ADR-003 后的不变量：dock 自己不再拥有任何模块（模块表已删）。
    check(
      'dock: 没有子槽就没有模块（模块表已删）',
      !html.includes('aria-label="火花"') && !html.includes('aria-label="npm"'),
      'dock 仍然自带模块 tab',
    )
    const hasCss = typeof DOCK_CSS === 'string' && DOCK_CSS.includes('.dock-ball')
    check('dock: DOCK_CSS 非空', hasCss, hasCss ? '' : 'DOCK_CSS 异常')

    // 子槽渲染位：给出等价于平台的 renderSlot（5 个模块，按 order），
    // 模块栏 / 标题行 / 内容三处都必须从它渲染。
    const seen: string[] = []
    const MODULES: Array<{ id: string; label: string }> = [
      { id: 'spark', label: '火花' },
      { id: 'hippomemo', label: '记忆' },
      { id: 'finance', label: '财务' },
      { id: 'github', label: 'GitHub' },
      { id: 'npm', label: 'npm' },
    ]
    const fakeSlot = (_key: string, owner: { variant: string, activeId: string }, opts?: { only?: string }) => {
      seen.push(owner.variant)
      const rows = opts?.only === undefined ? MODULES : MODULES.filter((m) => m.id === opts.only)
      if (rows.length === 0) return opts?.fallback ?? null
      if (owner.variant === 'rail') {
        return rows.map((m) => (
          <button key={m.id} type="button" role="tab" data-module-id={m.id} aria-label={m.label} aria-selected={m.id === owner.activeId} />
        ))
      }
      if (owner.variant === 'header') return <div className="name">{'fake header ' + owner.activeId}</div>
      return <div className="slot-pane">{'fake pane ' + owner.activeId}</div>
    }
    const slotHtml = renderToString(<DockOverlay renderSlot={fakeSlot} /> as ReactElement)
    const missing = MODULES.filter((m) => !slotHtml.includes('aria-label="' + m.label + '"')).map((m) => m.label)
    check('dock: 子槽的五个模块都出现在模块栏', missing.length === 0, missing.length === 0 ? '' : '缺少 ' + missing.join('、'))
    check('dock: 默认激活 spark（子槽 header/pane 位）', slotHtml.includes('fake header spark') && slotHtml.includes('fake pane spark'), '')
    check('dock: 三个渲染位都被调用', seen.includes('rail') && seen.includes('header') && seen.includes('pane'), 'variants=' + seen.join(','))

    // 激活的是别的模块（localStorage 记着 npm）时，header / pane 必须跟着切。
    const scope = globalThis as unknown as { localStorage: unknown }
    const original = scope.localStorage
    scope.localStorage = {
      getItem: (key: string) => (key === 'dsh.spark-dock:active' ? 'npm' : null),
      setItem: () => {},
      removeItem: () => {},
    }
    const activeSlotHtml = renderToString(<DockOverlay renderSlot={fakeSlot} /> as ReactElement)
    scope.localStorage = original
    check('dock: 切到 npm 后内容走子槽 pane 位', activeSlotHtml.includes('fake pane npm'), '')
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
    const injected = buildFinanceInjected(ctx, scenario)
    await injected.controller.load()
    await flush()
    const state = injected.controller.store.getSnapshot()
    check('finance: ledger 载入', (state.ledger?.byModel.length ?? 0) > 0, JSON.stringify(state.status))
    check('finance: provider 列表载入', (state.providerList?.providers.length ?? 0) === 3, JSON.stringify(state.providerList?.providers.length))
    const html = renderToString(<FinancePanel {...injected.panel} /> as ReactElement)
    check('finance: 面板渲染不抛错', typeof html === 'string' && html.length > 0, '')
    expectContains('finance: 默认视图是「本月值不值」', html, 'finance-view-thisMonth')
    expectContains('finance: 首屏有四个总量数字', html, 'finance-stat-cost')
    expectContains('finance: 余额行按已接入 provider 渲染', html, 'finance-balance-deepseek')
    expectContains('finance: 四个决策视图页签（zh 字典）', html, '怎么调度更省')
    expectContains('finance: 订阅 vs 按量卡存在', html, 'finance-plan-card')
    expectContains('finance: 套餐行只列用过的厂商', html, 'finance-plan-deepseek')
    // 写回路径真的通：填一次月费 → 落到 settings 的 plans，并推出「省了多少」结论。
    await injected.controller.savePlan({ provider: 'deepseek', monthlyMicros: 10_000_000, currency: 'CNY', periodLabel: 'month', effectiveFrom: 0 })
    const afterPlan = renderToString(<FinancePanel {...injected.panel} /> as ReactElement)
    expectContains('finance: 填月费后给出「比按量省」结论', afterPlan, '比按量省')
    // P1-B：该用谁 —— 输出速率列 + 同一模型跨供应商的时间成本比较。
    check('finance: 账本带上了速率样本', state.ledger?.byModel.some((row) => row.rate !== undefined) === true, '')
    const whoHtml = renderToString(
      <WhoToUseView ledger={state.ledger!} t={ctx.locale.bind('settings.finance')} /> as ReactElement,
    )
    expectContains('finance: 该用谁有输出速率列', whoHtml, '输出速率')
    expectContains('finance: 速率渲染为 tok/s', whoHtml, 'tok/s')
    expectContains('finance: 同一模型跨供应商给出时间成本比较', whoHtml, 'finance-time-compare')
    check(
      'finance: 套餐写回 settings 的 plans 字段',
      JSON.stringify((injected.scope as unknown as { getSnapshot(): { user: unknown } }).getSnapshot().user).includes('monthlyMicros'),
      '',
    )
    // 产品原则回归线：配置面（价格表 / 供应商默认价 / 视图偏好）必须不存在。
    check(
      'finance: 已无配置面（价格表 / 供应商默认价 / 视图偏好全部删除）',
      !html.includes('价格表') && !html.includes('供应商默认价') && !html.includes('仪表盘视图'),
      html.includes('价格表') ? 'still has 价格表' : '',
    )
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

  /* ── W4 保真：契约 schema 单源校验（F14）── */
  {
    // 真宿主 SparkService.capture() 会用 wire 的 sparkCaptureSchema 解析；
    // 预览 fixture 此前给 sourceSessionId 兜默认值，导致「漏传必填」静默通过。
    const store = createSparkStore()
    const missing = store.capture({ title: 'verify', content: '漏了 sourceSessionId' })
    check(
      'spark: 漏传必填 sourceSessionId 被拒（BAD_REQUEST，与真宿主同）',
      missing.ok === false && missing.error?.code === 'BAD_REQUEST' && String(missing.error?.message).includes('sourceSessionId'),
      JSON.stringify(missing).slice(0, 200),
    )
    const blank = store.capture({ title: '', content: 'x', sourceSessionId: 'sess' })
    check('spark: 空 title 也被拒（schema min(1)）', blank.ok === false && blank.error?.code === 'BAD_REQUEST', JSON.stringify(blank).slice(0, 160))
    const valid = store.capture({ title: 'verify', content: 'ok', sourceSessionId: 'sess-preview' })
    check('spark: 合法入参写入成功', valid.ok === true && valid.value?.sourceSessionId === 'sess-preview', JSON.stringify(valid).slice(0, 160))
    const badPatch = store.patch(valid.value.id, { status: 'nonsense' })
    check('spark: 非法 patch 状态被拒', badPatch.ok === false && badPatch.error?.code === 'BAD_REQUEST', JSON.stringify(badPatch).slice(0, 160))
  }

  /* ── W4 保真：inject 门（真宿主拒绝未声明服务的访问）── */
  {
    const ctx = createMockCtx({ lang: () => lang, scenario: () => scenario })
    const gated = withInjectGate(ctx, ['locale']) as unknown as MockCtx
    check('inject 门: 声明过的 locale 可访问', typeof gated.locale.register === 'function', '')
    let slotsError = ''
    try { void (gated as unknown as { slots: unknown }).slots } catch (error) { slotsError = String(error) }
    check('inject 门: 未声明的 slots 抛错（与真宿主同形）', slotsError.includes('cannot get property "slots" without inject'), slotsError)
    let credentialsError = ''
    const remoteGated = withInjectGate(ctx, ['locale', 'remote']) as unknown as MockCtx
    try { void (remoteGated.remote as unknown as { credentials: unknown }).credentials } catch (error) { credentialsError = String(error) }
    check('inject 门: 未声明的 remote.credentials 抛错', credentialsError.includes('cannot get property "remote.credentials" without inject'), credentialsError)
    check('inject 门: 声明过的 remote.$mount 可访问', typeof remoteGated.remote.$mount === 'function', '')
    let namespaceError = ''
    try { void (remoteGated.remote as unknown as { spark: unknown }).spark } catch (error) { namespaceError = String(error) }
    check('inject 门: 动态命名空间必须走 reflect（直接读抛错）', namespaceError.includes('cannot get property "remote.spark" without inject'), namespaceError)
  }

  /* ── W4 保真：服务生命周期（effect disposer 真的会清掉注册）── */
  {
    const ctx = createMockCtx({ lang: () => lang, scenario: () => scenario })
    let disposed = 0
    ctx.effect(() => () => { disposed += 1 })
    ctx.slots.register({ name: 'spark.dock.module', id: 'probe', order: 1 }, () => null)
    const before = ctx.slots.snapshot('spark.dock.module').length
    ctx.__preview.teardown()
    const after = ctx.slots.snapshot('spark.dock.module').length
    check('生命周期: teardown 跑掉 effect disposer', disposed === 1, 'disposed=' + disposed)
    check('生命周期: teardown 清空槽位 ledger', before === 1 && after === 0, 'before=' + before + ' after=' + after)
  }

  /* ── W4 保真：五个插件的真 apply + inject 门（无浏览器也能抓到注册回归）── */
  {
    shimBrowserGlobals()
    const ctx = createMockCtx({ lang: () => lang, scenario: () => scenario })
    buildGithubInjected(ctx, scenario)
    buildNpmInjected(ctx, scenario)
    buildFinanceInjected(ctx, scenario)
    const [dock, github, npm, finance, hippomemo] = await Promise.all([
      import('dsh-spark-dock/client'),
      import('dsh-connector-github-ui/client'),
      import('dsh-connector-npm-ui/client'),
      import('dsh-spark-finance-client/client'),
      import('dsh-hippomemo/client'),
    ])
    let applyError = ''
    try {
      for (const mod of [dock, github, npm, finance, hippomemo]) {
        await mod.apply(withInjectGate(ctx, (mod.inject ?? []) as readonly string[]) as never)
      }
    } catch (error) {
      applyError = String(error)
    }
    check('dock: 五个插件真 apply 全部通过 inject 门', applyError === '', applyError)
    const entries = ctx.slots.snapshot('spark.dock.module')
    const ids = entries.map((entry) => entry.id)
    check(
      'dock: 五个模块自注册且按 order 排序',
      ids.join(',') === 'spark,hippomemo,finance,github,npm',
      JSON.stringify(ids),
    )
    ctx.__preview.teardown()
    check('dock: teardown 后模块全部注销', ctx.slots.snapshot('spark.dock.module').length === 0, JSON.stringify(ctx.slots.snapshot('spark.dock.module').map((entry) => entry.id)))
  }

  return { checks }
}
