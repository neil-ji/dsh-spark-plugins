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
import type { ReactElement, ReactNode } from 'react'
import { createMockCtx, withInjectGate, type Lang, type MockCtx, type Scenario } from '../src/mock/ctx.ts'
import { registerDockModule } from 'dsh-spark-plugin-kit/client'
import { createSparkStore } from '../fixtures/sparks.mjs'
import {
  FinancePanel,
  GithubSection,
  SaveMoreView,
  WhoToUseView,
  NpmSection,
  buildFinanceInjected,
  buildGithubInjected,
  buildNpmInjected,
} from '../src/mock/plugins.ts'
import { DockOverlay, type DockRenderSlot } from 'dsh-spark-dock/DockOverlay'
import { DOCK_CSS } from 'dsh-spark-dock/style'

/**
 * ── en 渲染通道（语言验收）──
 *
 * 背景：外部 PC 端验收（verification-dsh-spark-plugins-20260917-2210）把「英文语言下的
 * 插件 UI」列为**未覆盖项**（复核者切不动宿主语言菜单）。这里把它变成可验证：
 * 用 locale = en 渲染每个模块的 dock 元数据（label / name / sub）与面板内容，
 * 再断言**用户可见文本里没有 CJK 字符**。
 *
 * 判定口径（三条，都有理由）：
 *  1. 覆盖区：文本节点 + `aria-label` / `title` / `alt` 三类**可访问名**——它们同样是
 *     用户可见文案（屏幕阅读器会念、hover 会显示），硬编码中文一样是问题。
 *  2. 不覆盖区：`class` / `style` / `data-*` / SVG 几何属性（`d` / `viewBox`…）。
 *     它们不是文案，且 `d` 里的路径数据可能正好落进 CJK 码位区间（误报源）。
 *  3. 范围：U+3400–U+9FFF（含 CJK 扩展 A）、U+F900–U+FAFF（兼容表意）、U+FF00–U+FFEF
 *     （全角形式——**中日韩文里的全角标点（，：；）算问题**，它是中文排版的痕迹）。
 *     刻意**不含** U+3000–U+303F：那里是全角空格与中文标点，但 U+3000/3001 是 CJK 排版
 *     符号；本仓库文案里的 `·`（U+00B7）不在任何区间内，故中点分隔符不会被误报。
 */
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/

/** HTML 实体解码（React SSR 会把中文引号/尖括号转义；不需要完整 character reference 支持）。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** 抽出渲染结果里的「用户可见文本」：文本节点 + aria-label / title / alt。 */
function visibleTexts(html: string): Array<{ text: string, source: string }> {
  const out: Array<{ text: string, source: string }> = []
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>([^<]*)/g)) {
    const tag = m[1]
    const attrs = m[2] ?? ''
    const bodyRaw = m[3] ?? ''
    const body = decodeEntities(bodyRaw).replace(/[\s\u00a0]+/g, ' ').trim()
    if (body !== '') out.push({ text: body, source: '<' + tag + '> 文本' })
    for (const attr of ['aria-label', 'title', 'alt']) {
      const hit = attrs.match(new RegExp(attr + '="([^"]*)"'))
      if (hit === null) continue
      const value = decodeEntities(hit[1]).replace(/[\s\u00a0]+/g, ' ').trim()
      if (value !== '') out.push({ text: value, source: '<' + tag + ' ' + attr + '>' })
    }
  }
  return out
}

/** visibleTexts 里第一个命中 CJK 的片段。 */
function findCjk(html: string): { text: string, source: string } | null {
  for (const entry of visibleTexts(html)) {
    if (CJK_RE.test(entry.text)) return entry
  }
  return null
}

/** 断言渲染结果里没有硬编码中文；失败时 detail 指明「哪个字符串 / 哪个位置」。 */
function checkNoCjk(name: string, html: string): void {
  const hit = findCjk(html)
  check(name, hit === null, hit === null ? '' : hit.source + ' 命中 CJK：' + JSON.stringify(hit.text))
}

/** 渲染后立刻断言「非空 + 无 CJK」，渲染异常也留一条明细（而不是整块抛掉）。 */
function checkRenderNoCjk(name: string, render: () => string): void {
  let html = ''
  try {
    html = render()
  } catch (error) {
    check(name, false, '渲染抛错：' + String(error))
    return
  }
  if (html.length === 0) {
    check(name, false, '渲染结果为空（断言无从下手，不当作通过）')
    return
  }
  checkNoCjk(name, html)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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
    // 假 slot 的模块名按 zh 字典给（这条断言测的是「dock 只呈现子槽内容」，
    // 不是语言）；en 渲染通道那一段走真 ledger，不经过这里。
    const MODULES: Array<{ id: string; label: string }> = [
      { id: 'spark', label: '火花' },
      { id: 'hippomemo', label: '记忆' },
      { id: 'finance', label: '财务' },
      { id: 'github', label: 'GitHub' },
      { id: 'npm', label: 'npm' },
      { id: 'script', label: '脚本' },
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
    check('dock: 子槽的六个模块都出现在模块栏', missing.length === 0, missing.length === 0 ? '' : '缺少 ' + missing.join('、'))
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
    // 形制回归线：子页签栏是面板内容的第一件东西（指标/操作都归各自的 tab，不置顶）
    check(
      'finance: 子导航在指标之前（与 hippomemo MemorySection 同形）',
      html.indexOf('finance-tabs') > -1 && html.indexOf('finance-tabs') < html.indexOf('finance-stat-cost'),
      'tabs@' + html.indexOf('finance-tabs') + ' stats@' + html.indexOf('finance-stat-cost'),
    )
    // 供应商总表（订阅/按量合并为一张表，付费类型用 Tag 区分）；deepseek 走按量。
    expectContains('finance: 余额行按已接入 provider 渲染', html, 'finance-provider-deepseek')
    expectContains('finance: 四个决策视图页签（zh 字典）', html, '节省分析')
    expectContains('finance: 供应商总表存在', html, 'finance-provider-table')
    // 2026-09-21 供应商总表布局不变量（用户裁决「table 布局混乱」的确定性回归线）。
    // 预览夹具带配额数据（zai 命中），所以这里能真正跑起来；真宿主沙箱账本常为空、
    // 表格走空态，那边只能做补充抽样 —— 主判据在这里 + dom-audit 的重叠/溢出/折行。
    {
      const tableHtml = /data-testid="finance-provider-table"[\s\S]*?(?=<section|$)/.exec(html)?.[0] ?? ''
      check('finance: 表内无额度触达 testid（已移进详情弹窗）', !tableHtml.includes('finance-quota-'), '')
      check('finance: 表内无「超值」tag', !tableHtml.includes('超值'), '')
      check('finance: 表内无「手填」角标', !tableHtml.includes('手填'), '')
    }
    // 写回路径真的通：给有用量、无显式标记的 openai 填一次月费 → 落到 settings 的
    // plans，并推出「省了多少」结论（deepseek/tencent 已显式标记为按量，不进订阅卡）。
    await injected.controller.savePlan({ provider: 'openai', monthlyMicros: 1, currency: 'CNY', periodLabel: 'month', effectiveFrom: 0 })
    const afterPlan = renderToString(<FinancePanel {...injected.panel} /> as ReactElement)
    expectContains('finance: 填过月费的厂商进总表并标订阅', afterPlan, 'finance-provider-openai')
    // 2026-09-21 用户裁决：非付费类型列的 tag 一律移除（列窄，tag 挤金额）。
    // 省额降级为悬浮提示，表格里只剩金额与付费类型 Tag。
    check('finance: 填月费后不再渲染「超值」tag（改悬浮提示）', !afterPlan.includes('超值'), '')
    check('finance: 付费类型 Tag 仍在（表格唯一合法 tag）', afterPlan.includes('按量') || afterPlan.includes('订阅'), '')
    // P1-B：该用谁 —— 输出速率列 + 同一模型跨供应商的时间成本比较。
    check('finance: 账本带上了速率样本', state.ledger?.byModel.some((row) => row.rate !== undefined) === true, '')
    const whoHtml = renderToString(
      <WhoToUseView ledger={state.ledger!} t={ctx.locale.bind('settings.finance')} /> as ReactElement,
    )
    expectContains('finance: 该用谁有输出速率列', whoHtml, '输出速率')
    expectContains('finance: 速率渲染为 tok/s', whoHtml, 'tok/s')
    expectContains('finance: 同一模型跨供应商给出时间成本比较', whoHtml, 'finance-time-compare')
    // 2026-09-21 用户裁决：模型一多就"全展开平铺"读不动 → 改手风琴，默认只展开首项；
    // 手风琴已起分割作用 → 移除原先每个组的嵌套 inset Card。
    {
      const heads = (whoHtml.match(/<button[^>]*aria-expanded=/g) ?? []).length
      const openHeads = (whoHtml.match(/<button[^>]*aria-expanded="true"/g) ?? []).length
      check('finance: 该用谁改手风琴（每组一个折叠头）', heads >= 1, 'heads=' + heads)
      check('finance: 手风琴默认只展开首项（不是全展开）', openHeads === 1, 'open=' + openHeads + '/' + heads)
      check('finance: 该用谁不再嵌套 inset 卡（手风琴已起分割作用）', !whoHtml.includes('_inset'), '')
    }
    // P2：拆分会话 —— 上下文分布 + 按阶梯价的上限估算（估算必须标注）。
    // 走与真面板同一条路：seam 归一化后的 `state.tiers`（分组形状），不是 settings 里的
    // 原始值 —— 两者的形状差异正是 S1 归一化契约所在，这里顺带把它也冒烟了。
    const saveHtml = renderToString(
      <SaveMoreView ledger={state.ledger!} tiers={state.tiers} t={ctx.locale.bind('settings.finance')} /> as ReactElement,
    )
    expectContains('finance: 拆分卡有上下文分布', saveHtml, 'finance-context-card')
    // 2026-09-21：空数据下省额卡给 EmptyState 占位，不留"一行光标题"（用户截图实测：
    // 空数据时缓存卡只有 48px 高、正文仅 8 字符 = 标题本身，看起来像渲染坏了）。
    // 预览夹具是有数据的，所以这里断言的是"有数据时不误报空态"这一侧；
    // 真空侧的判据在 panel.test.tsx（三张卡各自的空夹具）。
    check('finance: 有数据时省额卡不误报空占位', !saveHtml.includes('cacheEmpty') && !saveHtml.includes('peakEmpty'), '')
    // 注意：本冒烟跑的是**真 zh 字典**，标题渲染成中文而不是 key 字面量。
    check('finance: 三张省额卡的卡壳始终在（标题不随数据消失）',
      ['错峰执行节省估算', '缓存复用节省估算', '会话拆分节省估算'].every((k) => saveHtml.includes(k)), '')
    expectContains('finance: 有阶梯价的模型给出上限估算', saveHtml, '压进最小档可省')
    // 2026-09-21 用户裁决：「上限可省，无法明确表意」→ 列头改成可自解释的说法；
    // 「128K 太小了」→ 分界线改为**各模型自己的最小档**，不再写死 128k
    // （预览夹具里 deepseek-v4.1-flash 的最小档是 32k，所以这里断言 32K 出现）。
    expectContains('finance: 列头改成可表意的说法（压进最小档可省）', saveHtml, '超出最小档的输入')
    check('finance: 分界线取该模型自己的最小档（不写死 128k）', saveHtml.includes('超过 32K'), '')
    // 仅渲染命中阶梯价的模型：没命中的（hunyuan-4-preview / gpt-5-codex）不出现 ——
    // 它们原先各占一行、除了模型名就是一个「—」，纯噪声（用户截图 5 行有 4 行是破折号）。
    {
      const noTier = ['hunyuan-4-preview', 'gpt-5-codex'].filter((m) => saveHtml.includes(`finance-context-${m}`))
      check('finance: 没命中阶梯价的模型不进这张表', noTier.length === 0, noTier.join(','))
    }
    expectContains('finance: 拆分口径写明是估算上限', saveHtml, '估算口径')
    // S2/S3：币种不匹配的档位不参与估算（宁可不算，不可硬换汇）。
    expectContains('finance: 币种不匹配的阶梯价不参与估算', saveHtml, '币种不匹配')
    // 新形状的错峰折扣在金额旁标注，且确实把金额缩了。
    expectContains('finance: 错峰折扣在金额旁标注', saveHtml, '错峰')
    // 2026-09-21 用户裁决「没有标货币」：错峰卡的堆叠条图例曾渲染成裸数字
    // （8.57 / 10.34 / 3.03），而同屏表格金额都是 ¥… —— 一屏两种货币表达。
    // 这里直接断言图例数值带符号（图例是 legendValue，与表格的 Money 是两条渲染路径）。
    {
      const bareLegend = (saveHtml.match(/legendValue[^>]*>\s*[\d,]+(\.\d+)?\s*</g) ?? [])
      check('finance: 图表图例的金额都带货币符号（不裸数字）', bareLegend.length === 0, bareLegend.join(' | '))
      check('finance: 错峰卡图例确实渲染了带 ¥ 的金额', saveHtml.includes('¥'), '')
    }
    // S4 / INV-1：releaseBase 是唯一结构源。预览夹具把 tiers 放在 scope 的 `base` 层
    // （= 真宿主里 cordis.patch.yml 的位置），用户层为空 → 不该报"被取代"。
    check('finance: releaseBase 的阶梯价不被误报为被用户覆盖', !saveHtml.includes('已被发行版官方表取代'), '')
    check(
      'finance: 套餐写回 settings 的 plans 字段',
      JSON.stringify((injected.scope as unknown as { getSnapshot(): { user: unknown } }).getSnapshot().user).includes('monthlyMicros'),
      '',
    )
    // 产品原则回归线：配置面（供应商默认价 / 视图偏好）必须不存在。
    // 价格表「操作」（更新 / 还原，SPEC §5.1）是脚注里的动作而非配置表单，允许存在。
    check(
      'finance: 已无配置面（供应商默认价 / 视图偏好全部删除），价格表只剩脚注操作',
      !html.includes('供应商默认价') && !html.includes('仪表盘视图') && html.includes('价格表操作'),
      html.includes('供应商默认价') ? 'still has 供应商默认价' : '',
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
    // 2026-09-14 收件箱化：`status` 已被 `inboxState` 取代，非法枚举值必须被拒。
    const badPatch = store.patch(valid.value.id, { inboxState: 'nonsense' })
    check('spark: 非法 inboxState 被拒（schema 枚举）', badPatch.ok === false && badPatch.error?.code === 'BAD_REQUEST', JSON.stringify(badPatch).slice(0, 160))
    // 旧字段 `status` 不再有任何语义：被 schema 剥离，绝不能静默改状态（否则老客户端
    // 会在不知情的情况下把火花挪走）。这条断言就是"破坏性变更已生效"的护栏。
    const legacyPatch = store.patch(valid.value.id, { status: 'archived' })
    check('spark: 旧 status 字段被剥离而不是静默归档', legacyPatch.ok === true && legacyPatch.value?.inboxState === 'pending', JSON.stringify(legacyPatch).slice(0, 200))
    const dropped = store.patch(valid.value.id, { inboxState: 'dropped' })
    check('spark: inboxState 变更被接受并打点 stateChangedAt', dropped.ok === true && dropped.value?.inboxState === 'dropped' && typeof dropped.value?.stateChangedAt === 'number', JSON.stringify(dropped).slice(0, 200))
    const stats = store.stats()
    check('spark: /sparks/stats 形状与真宿主同源', stats.ok === true && typeof stats.value?.pending === 'number' && typeof stats.value?.pendingProposals === 'number', JSON.stringify(stats).slice(0, 220))
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

  /* ── W4 保真：六个插件的真 apply + inject 门（无浏览器也能抓到注册回归）── */
  {
    shimBrowserGlobals()
    const ctx = createMockCtx({ lang: () => lang, scenario: () => scenario })
    buildGithubInjected(ctx, scenario)
    buildNpmInjected(ctx, scenario)
    buildFinanceInjected(ctx, scenario)
    const [dock, github, npm, finance, hippomemo, script] = await Promise.all([
      import('dsh-spark-dock/client'),
      import('dsh-connector-github-ui/client'),
      import('dsh-connector-npm-ui/client'),
      import('dsh-spark-finance-client/client'),
      import('dsh-hippomemo/client'),
      import('dsh-script-client/client'),
    ])
    let applyError = ''
    try {
      for (const mod of [dock, github, npm, finance, hippomemo, script]) {
        await mod.apply(withInjectGate(ctx, (mod.inject ?? []) as readonly string[]) as never)
      }
    } catch (error) {
      applyError = String(error)
    }
    check('dock: 六个插件真 apply 全部通过 inject 门', applyError === '', applyError)
    const entries = ctx.slots.snapshot('spark.dock.module')
    const ids = entries.map((entry) => entry.id)
    check(
      'dock: 六个模块自注册且按 order 排序',
      ids.join(',') === 'spark,hippomemo,finance,github,npm,script',
      JSON.stringify(ids),
    )
    ctx.__preview.teardown()
    check('dock: teardown 后模块全部注销', ctx.slots.snapshot('spark.dock.module').length === 0, JSON.stringify(ctx.slots.snapshot('spark.dock.module').map((entry) => entry.id)))
  }

  /* ── en 渲染通道：英文语言下不得出现硬编码中文（验收未覆盖项 → 可验证断言）──
   *
   * 这是「英文 locale 下插件 UI」的机械口径：locale = en 时把每个模块的 dock 元数据
   * （label / name / sub）与 pane 内容各渲染一次，可见文本里出现任何 CJK 即失败，
   * detail 指出是哪个字符串落在哪个位置。它抓的是「文案没进字典」，不是「英文翻得好不好」。
   */
  {
    shimBrowserGlobals()
    // 模块注册期与 pane 首屏都会打 /sparks/stats（真宿主同源）；Node 侧给个空 stats。
    const globals = globalThis as unknown as { fetch?: unknown }
    const originalFetch = globals.fetch
    globals.fetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, value: { pending: 0, pendingProposals: 0 } }),
    })
    try {
      const ctx = createMockCtx({ lang: () => 'en', scenario: () => scenario })
      // 与「五个插件真 apply」同一份装配，只是语言换成 en。
      buildGithubInjected(ctx, scenario)
      buildNpmInjected(ctx, scenario)
      buildFinanceInjected(ctx, scenario)
      const plugins = await Promise.all([
        import('dsh-spark-dock/client'),
        import('dsh-connector-github-ui/client'),
        import('dsh-connector-npm-ui/client'),
        import('dsh-spark-finance-client/client'),
        import('dsh-hippomemo/client'),
        import('dsh-script-client/client'),
      ])
      let applyError = ''
      try {
        for (const mod of plugins) {
          await mod.apply(withInjectGate(ctx, (mod.inject ?? []) as readonly string[]) as never)
        }
      } catch (error) {
        applyError = String(error)
      }
      check('en: 六个插件真 apply（en 字典）通过', applyError === '', applyError)

      // 真槽位渲染：与平台把 renderSlot 交给 DockOverlay 的形态一致（ledger 驱动）。
      const renderSlot: DockRenderSlot = (_key, owner, opts) => {
        const rows = ctx.slots.snapshot('spark.dock.module')
          .filter((row) => opts?.only === undefined || row.id === opts.only)
        if (rows.length === 0) return opts?.fallback ?? null
        return rows.map((row) => {
          const injected = row.inject() as Record<string, unknown>
          const Component = row.component as (props: Record<string, unknown>) => ReactNode
          const props = { ...injected, variant: owner.variant, activeId: owner.activeId, onSelect: owner.onSelect }
          if (owner.variant === 'rail') {
            return (
              <button key={row.id} type="button" role="tab" data-module-id={row.id}
                aria-label={row.label?.() ?? row.id} aria-selected={row.id === owner.activeId} />
            )
          }
          if (owner.variant === 'header') return <div key={row.id} className="titles-slot">{Component(props)}</div>
          return <div key={row.id} className="slot-pane">{Component(props)}</div>
        })
      }

      // ① dock 壳自己的文案（球 / rail / 收起 / 兜底）。
      checkRenderNoCjk('en: dock 壳文案无 CJK（球 aria-label/title、rail 名、收起钮）', () =>
        renderToString(<DockOverlay renderSlot={renderSlot} /> as ReactElement))
      // 「没有已加载模块」空态：平台在无匹配条目时才把 fallback 交回 dock 渲染，
      // 所以这里不能用「返回 null」的假 renderSlot —— 那等于把 dock 的兜底文案整个跳过。
      checkRenderNoCjk('en: dock 壳「没有已加载模块」空态无 CJK', () =>
        renderToString(
          <DockOverlay renderSlot={(_key, _owner, opts) => opts?.fallback ?? null} /> as ReactElement,
        ))
      checkRenderNoCjk('en: dock 壳「模块未加载」兜底无 CJK（未知 activeId）', () => {
        const holder = globalThis as unknown as { localStorage: unknown }
        const original = holder.localStorage
        holder.localStorage = {
          getItem: (key: string) => (key === 'dsh.spark-dock:active' ? 'not-loaded' : null),
          setItem: () => {},
          removeItem: () => {},
        }
        try {
          return renderToString(<DockOverlay renderSlot={renderSlot} /> as ReactElement)
        } finally {
          holder.localStorage = original
        }
      })

      const entries = ctx.slots.snapshot('spark.dock.module')
      check(
        'en: 六个模块都注册进子槽（en 渲染的前置条件）',
        entries.map((entry) => entry.id).join(',') === 'spark,hippomemo,finance,github,npm,script',
        JSON.stringify(entries.map((entry) => entry.id)),
      )
      for (const entry of entries) {
        // ② dock 元数据：label 走注册时的求值（闭包或字符串都在这里体现）。
        const label = entry.label?.()
        check(
          'en: 模块 ' + entry.id + ' 的 dock label 无 CJK',
          typeof label === 'string' && label.length > 0 && !CJK_RE.test(label),
          label === undefined ? 'label() 返回 undefined' : JSON.stringify(label),
        )
        const injected = entry.inject() as Record<string, unknown>
        const Component = entry.component as (props: Record<string, unknown>) => ReactNode
        // ③ header 位：name + sub（注册期求值，含动态计数拼接）。
        checkRenderNoCjk('en: 模块 ' + entry.id + ' 的 dock header（name/sub）无 CJK', () =>
          renderToString(
            <div>{Component({ ...injected, variant: 'header', activeId: entry.id, onSelect: () => {} })}</div>,
          ))
        // ④ pane 位：模块面板至少渲染一次。
        checkRenderNoCjk('en: 模块 ' + entry.id + ' 的 pane 内容无 CJK', () =>
          renderToString(
            <div>{Component({ ...injected, variant: 'pane', activeId: entry.id, onSelect: () => {} })}</div>,
          ))
      }
      // ⑤ 装配失败态：宿主没给 remote.<ns> 时模块的失败态文案同样不得是中文
      //    （失败态是新用户最可能先看到的一屏，此前 GitHub / npm / finance 三处
      //    都在组件里写死了中文）。
      const brokenCtx = createMockCtx({ lang: () => 'en', scenario: () => scenario })
      let brokenError = ''
      try {
        for (const mod of plugins) {
          await mod.apply(withInjectGate(brokenCtx, (mod.inject ?? []) as readonly string[]) as never)
        }
      } catch (error) {
        brokenError = String(error)
      }
      check('en: 无 remote 命名空间时五个插件仍能 apply', brokenError === '', brokenError)
      for (const id of ['github', 'npm', 'finance']) {
        const broken = brokenCtx.slots.snapshot('spark.dock.module').find((row) => row.id === id)
        if (broken === undefined) {
          check('en: 模块 ' + id + ' 在无 remote 时也注册（失败态可渲染）', false, '子槽里没有 ' + id)
          continue
        }
        const injected = broken.inject() as Record<string, unknown>
        const Component = broken.component as (props: Record<string, unknown>) => ReactNode
        let failHtml = ''
        checkRenderNoCjk('en: 模块 ' + id + ' 的装配失败态无 CJK', () => {
          failHtml = renderToString(
            <div>{Component({ ...injected, variant: 'pane', activeId: id, onSelect: () => {} })}</div>,
          )
          return failHtml
        })
        // 正向锚点：这一屏真的渲染了东西（否则「无 CJK」会因为渲染成空而假通过）。
        // github / npm 的失败态文案含 "failed to assemble"；finance 的控制器不校验
        // remote 命名空间（它构造得起来），走的是面板自己的错误态，因此只断言「非空 +
        // 英文错误态节点」—— 不为了凑锚点去伪造一个它走不到的路径。
        const anchored = id === 'finance'
          ? failHtml.includes('finance-error')
          : failHtml.includes('failed to assemble')
        check(
          'en: 模块 ' + id + ' 的 pane 走的是本地化失败/错误态（非空）',
          anchored,
          failHtml.slice(0, 200),
        )
      }
      brokenCtx.__preview.teardown()

      // ⑥ 待处理角标已退役（2026-09-20 用户裁决「移除这个 badge」）。
      //    反转为**反向断言**：模块栏 tab 上不得再出现 `.dock-tab-badge`，
      //    a11y 名也不再带 pending 后缀（否则屏幕阅读器仍会念"3 pending"）。
      const probeCtx = createMockCtx({ lang: () => 'en', scenario: () => scenario })
      const probeDispose = registerDockModule(probeCtx as never, {
        id: 'probe-badge',
        order: 99,
        label: () => 'Probe',
        name: 'Probe',
        sub: 'probe',
        icon: null,
        accent: 'var(--spk-brand)',
        accentFg: 'var(--spk-on-brand)',
        inject: () => ({}),
        Content: () => null,
      })
      const probeRow = probeCtx.slots.snapshot('spark.dock.module')[0]
      const probeHtml = renderToString(
        <div>{probeRow?.component
          ? (probeRow.component as (props: Record<string, unknown>) => ReactNode)(
              { variant: 'rail', activeId: 'x', onSelect: () => {} },
            )
          : null}</div>,
      )
      check(
        'en: 模块栏 tab 不再渲染待处理角标',
        !probeHtml.includes('dock-tab-badge') && !probeHtml.includes('data-count'),
        probeHtml.slice(0, 220),
      )
      check(
        'en: 模块栏 tab 的可访问名就是模块名（不再附加 pending 文案）',
        probeHtml.includes('aria-label="Probe"') && probeHtml.includes('title="Probe"'),
        probeHtml.slice(0, 220),
      )
      probeDispose()
      probeCtx.__preview.teardown()

      ctx.__preview.teardown()
    } finally {
      globals.fetch = originalFetch
    }
  }

  return { checks }
}
