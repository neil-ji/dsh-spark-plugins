/**
 * 预览 fixture：三个 remote 型插件的假数据（hippomemo 走服务端 HTTP，见 fixtures/hippomemo.mjs）。
 *
 * 形状全部对照各包的 wire 类型手写，ok/empty/error 三档由 Scenario 切换，
 * 用于 UI 走查、空态/错误态回归。
 */
import type { GithubConfigView, GithubProxyTestValue, GithubWhoamiValue } from 'dsh-connector-wire'
import type { NpmPackageInfoView, NpmStatusView, NpmTokenStatusView, NpmTokenTestView } from 'dsh-connector-npm-wire'
import type { FinanceListProvidersResult } from 'dsh-spark-finance/types'
import type { FinanceLedger } from 'dsh-spark-finance/types'
import type { Scenario } from './ctx.ts'

const now = Date.now()
const DAY = 24 * 3600_000

/* ─────────────────────────── github ─────────────────────────── */

export const GITHUB_CONFIG: GithubConfigView = {
  apiBase: 'https://api.github.com',
  gitName: 'Neil Ji',
  gitEmail: 'neil@example.com',
  gitProxy: '',
  defaultVisibility: 'private',
  allowCreateRepo: true,
  allowPush: true,
  allowPull: true,
  allowPullRequest: true,
  allowReview: true,
  allowPages: false,
  allowActions: true,
  allowIssues: true,
  allowRelease: true,
}

export const GITHUB_WHOAMI: GithubWhoamiValue = {
  login: 'neil-ji',
  name: 'Neil Ji',
  htmlUrl: 'https://github.com/neil-ji',
  scopes: ['repo', 'workflow', 'read:org'],
  apiBase: 'https://api.github.com',
}

export const GITHUB_PROXY_TEST: GithubProxyTestValue = {
  ok: true,
  latencyMs: 138,
  host: 'github.com',
  error: null,
}

/* ──────────────────────────── npm ───────────────────────────── */

const NPM_PACKAGES = [
  'dsh-spark', 'dsh-spark-dock', 'dsh-spark-wire',
  'dsh-spark-finance', 'dsh-spark-finance-bundle', 'dsh-spark-finance-client',
  'dsh-connector-github', 'dsh-connector-github-ui', 'dsh-connector-wire',
  'dsh-connector-npm', 'dsh-connector-npm-ui', 'dsh-connector-npm-wire',
  'dsh-hippomemo', 'dsh-spark-plugin-kit', 'dsh-ui-kit',
]

export function npmStatus(scenario: Scenario): NpmStatusView {
  const packages: NpmPackageInfoView[] = scenario === 'empty' ? [] : NPM_PACKAGES.map((name, index) => ({
    name,
    exists: true,
    latest: index % 4 === 0 ? '0.2.0' : '0.1.' + (index % 6),
    description: index % 3 === 0 ? 'DSH 第三方插件（预览 fixture）' : null,
  }))
  return {
    ok: scenario !== 'error',
    registry: 'https://registry.npmjs.org',
    error: scenario === 'error' ? 'registry request failed: ETIMEDOUT (preview)' : null,
    packages,
  }
}

export function npmTokenStatus(scenario: Scenario): NpmTokenStatusView {
  const configured = scenario === 'ok'
  return {
    configured,
    source: 'NPM_TOKEN',
    login: configured ? 'neil-ji' : null,
    detail: configured ? 'granular token 已就绪：publish / dist-tag / deprecate / trust 可用' : '尚未配置 NPM_TOKEN，发布类动作不可用',
  }
}

export function npmTokenTest(scenario: Scenario, draftToken: string | undefined): NpmTokenTestView {
  if (scenario === 'error') return { ok: false, login: null, detail: 'E401 Unauthorized（预览故障注入）' }
  const token = (draftToken ?? '').trim()
  if (token === '') return { ok: false, login: null, detail: '请先粘贴 token' }
  if (token.startsWith('npm_bad')) return { ok: false, login: null, detail: 'E403 Forbidden：token 缺少 publish 权限' }
  return { ok: true, login: 'neil-ji', detail: 'token 有效，且具备 publish 权限' }
}

/* ────────────────────────── finance ─────────────────────────── */

const ZERO_BUCKETS = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }

function buckets(scale: number) {
  return {
    uncachedInputTokens: Math.round(184_320 * scale),
    cacheReadTokens: Math.round(1_238_400 * scale),
    cacheWriteTokens: Math.round(96_000 * scale),
    outputTokens: Math.round(42_880 * scale),
  }
}

/** 空账本骨架（字段与 dsh-finance-client 测试里的 ZERO_LEDGER 一致）。 */
export const ZERO_LEDGER: FinanceLedger = {
  generatedAt: now,
  currency: 'CNY',
  totals: { ...ZERO_BUCKETS },
  totalCostMicros: 0,
  meteredCostMicros: 0,
  planEquivalentCostMicros: 0,
  sessionCount: 0,
  workspaceCount: 0,
  taskCount: 0,
  windowedSinceMs: null,
  hourOfDayWindowStartMs: now - DAY,
  byDay: [],
  byModel: [],
  byProvider: [],
  byWorkspace: [],
  tasks: [],
  sessions: [],
  unreadableSessions: [],
  byHourOfDay: [],
  peakValley: {
    peakCostMicros: 0, offPeakCostMicros: 0, flatCostMicros: 0,
    unclassifiedCostMicros: 0, legacyCostMicros: 0, shiftSavingsMicros: 0,
  },
}

export function ledger(scenario: Scenario): FinanceLedger {
  if (scenario !== 'ok') return { ...ZERO_LEDGER, generatedAt: now }
  const days = 14
  const byDay = Array.from({ length: days }, (_, index) => {
    const date = new Date(now - (days - 1 - index) * DAY)
    const scale = 0.5 + Math.abs(Math.sin(index / 2.4)) * 1.6
    return {
      day: date.toISOString().slice(0, 10),
      usage: buckets(scale),
      costMicros: Math.round(6_400_000 * scale),
    }
  })
  // speed = 该模型的实测输出吞吐（tok/s）。deepseek-reasoner 故意由两家供应：
  // 预览画布因此能看到"同一模型跨供应商"的比价与时间成本比较。
  const models = [
    { modelKey: 'deepseek/deepseek-v4.1-flash', billingMode: 'metered' as const, scale: 2.4, speed: 92 },
    { modelKey: 'deepseek/deepseek-reasoner', billingMode: 'metered' as const, scale: 1.1, speed: 41 },
    { modelKey: 'tencent/deepseek-reasoner', billingMode: 'metered' as const, scale: 0.4, speed: 22 },
    { modelKey: 'tencent/hunyuan-4-preview', billingMode: 'metered' as const, scale: 0.6, speed: 28 },
    { modelKey: 'openai/gpt-5-codex', billingMode: 'plan' as const, scale: 0.35, speed: 120 },
  ]
  const byModel = models.map(({ modelKey, billingMode, scale, speed }) => ({
    modelKey,
    provider: modelKey.slice(0, modelKey.indexOf('/')),
    model: modelKey.slice(modelKey.indexOf('/') + 1),
    billingMode,
    usage: buckets(scale),
    costMicros: Math.round(5_200_000 * scale),
    shiftSavingsMicros: Math.round(410_000 * scale),
    // 10 分钟解码窗口，decodeTokens 由吞吐推出（rate 与 usage 相互独立）。
    rate: { decodeMs: 600_000, decodeTokens: Math.round(speed * 600), ttftMs: 40 * 320, ttftSteps: 40 },
    // 上下文分布（P2）：多数步在 32k 以内，少数落在 128k–1M 档
    context: [
      { maxPromptTokens: 32_000, usage: buckets(scale * 0.4), steps: Math.round(20 * scale) },
      { maxPromptTokens: 128_000, usage: buckets(scale * 0.3), steps: Math.round(12 * scale) },
      { maxPromptTokens: 200_000, usage: buckets(scale * 0.06), steps: Math.round(3 * scale) },
      { maxPromptTokens: 1_000_000, usage: buckets(scale * 0.05), steps: Math.round(2 * scale) },
      { maxPromptTokens: null, usage: buckets(0), steps: 0 },
    ],
  }))
  const byProvider = [
    { provider: 'deepseek', usage: buckets(3.5), costMicros: 18_240_000, modelCount: 2 },
    { provider: 'tencent', usage: buckets(1.0), costMicros: 4_200_000, modelCount: 2 },
    { provider: 'openai', usage: buckets(0.35), costMicros: 1_820_000, modelCount: 1, billingMode: 'plan' as const },
  ]
  const byHourOfDay = Array.from({ length: 24 }, (_, localHour) => {
    const peak = localHour >= 8 && localHour < 18
    const scale = peak ? 1.4 : 0.5
    return {
      localHour,
      hourStartMs: now - (24 - localHour) * 3600_000,
      usage: buckets(scale * 0.06),
      costMicros: Math.round(430_000 * scale),
      peakCostMicros: peak ? Math.round(430_000 * scale) : 0,
      flatCostMicros: 0,
      shiftSavingsMicros: peak ? Math.round(52_000 * scale) : 0,
    }
  })
  const totalCostMicros = byModel.reduce((sum, row) => sum + row.costMicros, 0)
  const totals = byModel.reduce((sum, row) => ({
    uncachedInputTokens: sum.uncachedInputTokens + row.usage.uncachedInputTokens,
    cacheReadTokens: sum.cacheReadTokens + row.usage.cacheReadTokens,
    cacheWriteTokens: sum.cacheWriteTokens + row.usage.cacheWriteTokens,
    outputTokens: sum.outputTokens + row.usage.outputTokens,
  }), { ...ZERO_BUCKETS })
  return {
    ...ZERO_LEDGER,
    generatedAt: now,
    totals,
    totalCostMicros,
    meteredCostMicros: Math.round(totalCostMicros * 0.86),
    planEquivalentCostMicros: Math.round(totalCostMicros * 0.14),
    sessionCount: 37,
    workspaceCount: 3,
    taskCount: 12,
    windowedSinceMs: now - days * DAY,
    byDay,
    byModel,
    byProvider,
    byWorkspace: [
      { workspaceId: 'ws-spark', title: 'dsh-spark-plugins', sessionCount: 24, usage: buckets(2.8), costMicros: Math.round(totalCostMicros * 0.62) },
      { workspaceId: 'ws-agent', title: 'AgentStudio', sessionCount: 9, usage: buckets(1.2), costMicros: Math.round(totalCostMicros * 0.27) },
      { workspaceId: 'ws-misc', title: '（无工作区）', sessionCount: 4, usage: buckets(0.5), costMicros: Math.round(totalCostMicros * 0.11) },
    ],
    tasks: Array.from({ length: 5 }, (_, index) => ({
      taskId: 'task-' + (index + 1),
      title: ['插件预览 harness', '设计系统对齐', 'finance 账本重构', 'npm 发布管线', 'hippomemo 脑区 UI'][index],
      createdAt: now - (index + 1) * DAY,
      sessionCount: 4 - (index % 3),
      usage: buckets(0.6 - index * 0.08),
      costMicros: Math.round(totalCostMicros * (0.3 - index * 0.05)),
    })),
    sessions: Array.from({ length: 6 }, (_, index) => ({
      provider: 'deepseek',
      sessionId: 'sess-preview-' + String(index + 1).padStart(3, '0'),
      title: ['零 dsh 预览 harness', 'dock 内嵌装配', '价格表同步', '设置页退位', '账本 TTL 缓存', '峰谷拆分'][index],
      createdAt: now - (index + 1) * 3600_000 * 7,
      cwd: 'F:\\AgentStudio\\dsh-spark-plugins',
      workspaceId: 'ws-spark',
      workspaceTitle: 'dsh-spark-plugins',
      taskId: 'task-1',
      delegationDepth: index % 2,
      modelKeys: ['deepseek/deepseek-v4.1-flash'],
      usage: buckets(0.4 - index * 0.04),
      costMicros: Math.round(totalCostMicros * (0.18 - index * 0.02)),
    })),
    byHourOfDay,
    peakValley: {
      peakCostMicros: Math.round(totalCostMicros * 0.34),
      offPeakCostMicros: Math.round(totalCostMicros * 0.41),
      flatCostMicros: Math.round(totalCostMicros * 0.12),
      unclassifiedCostMicros: Math.round(totalCostMicros * 0.13),
      legacyCostMicros: 0,
      shiftSavingsMicros: Math.round(totalCostMicros * 0.07),
    },
    // SPEC §10：额度触达与窗口归因的预览样本 —— 让卡片在 mock 通道可走查
    // （未命中时卡片不出、角标不显示，所以预览必须带命中数据才看得到）。
    quota: {
      rows: [{
        provider: 'zai',
        hits: 2,
        attempts: 11,
        lastHitAtMs: now - 3 * 3600_000,
        nextResetAtMs: now + 2 * 3600_000 + 12 * 60_000,
        windows: [
          { window: '5h', hits: 2, resetAtMs: now + 2 * 3600_000 + 12 * 60_000 },
        ],
      }],
      totalHits: 2,
      episodes: [
        {
          provider: 'zai', modelKey: 'zai/glm-5.3-flash', window: '5h',
          firstAtMs: now - 3 * 3600_000 - 60_000, lastAtMs: now - 3 * 3600_000,
          attempts: 6, final: true, resetAtMs: now + 2 * 3600_000 + 12 * 60_000,
          resetRaw: null, vendorCode: '1308',
        },
        {
          provider: 'zai', modelKey: 'zai/glm-5.3-flash', window: '5h',
          firstAtMs: now - 9 * 3600_000 - 30_000, lastAtMs: now - 9 * 3600_000,
          attempts: 5, final: true, resetAtMs: null,
          resetRaw: '2026-09-19 23:17:45', vendorCode: '1308',
        },
      ],
      monthStartMs: now - days * DAY,
    },
    windows: [
      { span: '5h', ms: 5 * 3600_000 },
      { span: 'week', ms: 7 * DAY },
      { span: 'month', ms: 30 * DAY },
    ].map(({ span, ms }) => {
      const scaled = span === '5h' ? 0.08 : span === 'week' ? 0.5 : 1
      const winModels = byModel.slice(0, 3).map((row) => ({
        modelKey: row.modelKey,
        provider: row.provider,
        usage: buckets(scaled * 0.3),
        costMicros: Math.round(row.costMicros * scaled),
        decodeMs: Math.round(600_000 * scaled),
        ttftMs: Math.round(12_000 * scaled),
        steps: Math.max(1, Math.round(40 * scaled)),
      }))
      return {
        span,
        startMs: now - ms,
        endMs: now,
        anchoredAtHit: false,
        usage: buckets(scaled * 0.9),
        costMicros: Math.round(totalCostMicros * scaled),
        decodeMs: Math.round(1_800_000 * scaled),
        ttftMs: Math.round(36_000 * scaled),
        steps: Math.max(1, Math.round(120 * scaled)),
        models: winModels,
        providerCount: new Set(winModels.map((row) => row.provider)).size,
      }
    }),
  }
}

export function providerList(scenario: Scenario): FinanceListProvidersResult {
  if (scenario !== 'ok') return { generatedAt: now, providers: [] }
  return {
    generatedAt: now,
    providers: [
      {
        provider: 'deepseek',
        sources: ['host-known', 'user-config', 'ledger-observed'],
        hostMeta: { defaultBillingMode: 'metered', defaultCurrency: 'CNY', supportsBalanceFetch: true, lockBillingModeAndCurrency: true },
        userEntry: { provider: 'deepseek', billingMode: 'metered', currency: 'CNY', totalPriceMicros: 0, autoFetchBalance: true },
        balance: { status: 'ok', provider: 'deepseek', totalMicros: 128_400_000, currency: 'CNY', fetchedAt: now - 60_000 },
      },
      {
        provider: 'tencent',
        sources: ['host-known', 'user-config'],
        hostMeta: { defaultBillingMode: 'metered', defaultCurrency: 'CNY', supportsBalanceFetch: true },
        userEntry: { provider: 'tencent', billingMode: 'metered', currency: 'CNY', totalPriceMicros: 0, autoFetchBalance: false },
        balance: { status: 'unsupported', provider: 'tencent', fetchedAt: now - 60_000 },
      },
      {
        provider: 'openai',
        sources: ['host-known'],
        hostMeta: { defaultBillingMode: 'plan', defaultCurrency: 'USD', supportsBalanceFetch: false, lockBillingModeAndCurrency: true },
        userEntry: undefined,
        balance: { status: 'missing-credential', provider: 'openai', fetchedAt: now - 60_000 },
      },
    ],
  }
}

export function refreshBalance(provider: string) {
  const total = 128_400_000 + Math.round(Math.random() * 4_000_000)
  return { status: 'ok' as const, provider, totalMicros: total, currency: 'CNY', fetchedAt: Date.now() }
}

export function syncStatus(scenario: Scenario) {
  if (scenario !== 'ok') return null
  return {
    source: 'models.dev',
    appliedAt: now - 6 * 3600_000,
    kept: 214,
    providers: ['deepseek', 'tencent', 'openai'],
    fx: 7.18,
  }
}

export function syncResult(scenario: Scenario) {
  if (scenario === 'error') return { ok: false as const, error: { message: 'models.dev 拉取失败（预览故障注入）' } }
  return {
    ok: true as const,
    value: {
      ok: true,
      source: 'models.dev',
      appliedAt: Date.now(),
      fx: 7.18,
      requestedProviders: ['deepseek', 'tencent', 'openai'],
      requestedMissing: [],
      kept: 214,
      droppedDated: 12,
      droppedNonToken: 3,
      droppedNoCost: 1,
      providers: ['deepseek', 'tencent', 'openai'],
    },
  }
}

/** finance 命名空间默认配置（settingsScope 的 base 层）。 */
export const FINANCE_BASE_CONFIG = {
  balance: { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 8000 },
  defaultPrice: { inputMicrosPerMtok: 2_000_000, cacheReadMicrosPerMtok: 200_000, cacheWriteMicrosPerMtok: 2_000_000, outputMicrosPerMtok: 8_000_000 },
  providerDefaults: { deepseek: { inputMicrosPerMtok: 2_000_000, cacheReadMicrosPerMtok: 200_000, cacheWriteMicrosPerMtok: 2_000_000, outputMicrosPerMtok: 8_000_000 } },
  prices: {},
  /**
   * context 阶梯价（P2，可选）：只给部分模型填 —— 预览画布因此能同时看到
   * 三种形态：
   * 1. 旧形状（裸数组）→ 给上限估算；
   * 2. 没填 → 「拆分不改变单价」；
   * 3. 新形状 + 币种不匹配（tencent 的模型按 USD 报价，账本按 CNY）→ 不换算、明说原因。
   */
  tiers: {
    'deepseek/deepseek-v4.1-flash': [
      { maxPromptTokens: 32_000, inputMicrosPerMtok: 2_000_000, cacheReadMicrosPerMtok: 200_000, outputMicrosPerMtok: 8_000_000 },
      { maxPromptTokens: 128_000, inputMicrosPerMtok: 4_000_000, cacheReadMicrosPerMtok: 400_000, outputMicrosPerMtok: 16_000_000 },
      { maxPromptTokens: 0, inputMicrosPerMtok: 8_000_000, cacheReadMicrosPerMtok: 800_000, outputMicrosPerMtok: 32_000_000 },
    ],
    // 新形状 + 错峰折扣：金额旁会带出「已按错峰折扣缩放」。
    'deepseek/deepseek-reasoner': {
      currency: 'CNY',
      offPeakDiscount: 0.5,
      tiers: [
        { maxPromptTokens: 128_000, inputMicrosPerMtok: 3_000_000, cacheReadMicrosPerMtok: 300_000, outputMicrosPerMtok: 12_000_000 },
        { maxPromptTokens: 0, inputMicrosPerMtok: 6_000_000, cacheReadMicrosPerMtok: 600_000, outputMicrosPerMtok: 24_000_000 },
      ],
    },
    // 币种不匹配：档位按 USD 计价，账本按 CNY → 面板不换算，只说明没计入。
    'tencent/deepseek-reasoner': {
      currency: 'USD',
      tiers: [{ maxPromptTokens: 128_000, inputMicrosPerMtok: 500_000, outputMicrosPerMtok: 2_000_000 }],
    },
  },
  providers: [
    { provider: 'deepseek', billingMode: 'metered', currency: 'CNY', totalPriceMicros: 0, autoFetchBalance: true },
  ],
}
