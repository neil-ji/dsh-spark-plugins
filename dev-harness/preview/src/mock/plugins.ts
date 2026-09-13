/**
 * 四个插件的假装配：镜像 dsh-spark-dock 里各 EmbedPane 的注入面拼装方式，
 * 但把 ctx.remote.$mount + reflect.get 换成直接注册的假命名空间。
 *
 * 真装配见 packages/dsh-spark-dock/src/client/{github,npm,finance,hippo}/*.tsx。
 */
import {
  GithubSection,
  GithubSettingsStore,
  en as githubEn,
  zh as githubZh,
} from 'dsh-connector-github-ui/embed'
import {
  NpmSection,
  NpmUiStore,
  en as npmEn,
  zh as npmZh,
} from 'dsh-connector-npm-ui/embed'
import {
  FinancePanel,
  FinancePanelController,
  WhoToUseView,
  createPlanSeam,
  en as financeEn,
  zh as financeZh,
} from 'dsh-spark-finance-client/embed'
import { bindSnapshotSelector } from './snapshot.ts'
import { err, ok, type MockCtx, type Scenario } from './ctx.ts'
import {
  GITHUB_CONFIG,
  GITHUB_PROXY_TEST,
  GITHUB_WHOAMI,
  ledger,
  npmStatus,
  npmTokenStatus,
  npmTokenTest,
  providerList,
  refreshBalance,
  syncResult,
  syncStatus,
} from './fixtures.ts'

export { GithubSection, NpmSection, FinancePanel, WhoToUseView }

/* ─────────────────────────── github ─────────────────────────── */

export function makeGithubNamespace(scenario: Scenario) {
  let config = { ...GITHUB_CONFIG }
  return {
    async 'config.get'() {
      if (scenario === 'error') return err('github/config.get failed (preview error scenario)')
      return ok(config)
    },
    async 'config.set'(request: { patch: Record<string, unknown> }) {
      if (scenario === 'error') return err('github/config.set failed (preview error scenario)')
      config = { ...config, ...request.patch }
      return ok(config)
    },
    async whoami(request: { draftToken?: string }) {
      if (scenario === 'empty') return err('no credential configured (preview empty scenario)')
      if (request.draftToken !== undefined && request.draftToken.trim() === '') return err('empty draft token')
      if (request.draftToken !== undefined && request.draftToken.startsWith('ghp_bad')) {
        return err('Bad credentials (401)')
      }
      return ok(GITHUB_WHOAMI)
    },
    async 'proxy.test'(request: { proxy?: string }) {
      if (scenario === 'error') return ok({ ...GITHUB_PROXY_TEST, ok: false, latencyMs: 0, error: 'connect ETIMEDOUT' })
      return ok({ ...GITHUB_PROXY_TEST, host: request.proxy === undefined || request.proxy === '' ? 'github.com' : request.proxy })
    },
  }
}

/** 装配 GithubSection 的注入面（controller + useSnapshot + t）。 */
export function buildGithubInjected(ctx: MockCtx, scenario: Scenario) {
  ctx.__preview.dictionary('settings.github', 'zh', githubZh)
  ctx.__preview.dictionary('settings.github', 'en', githubEn)
  const namespace = makeGithubNamespace(scenario)
  ctx.__preview.namespace('remote.github', namespace)
  const controller = new GithubSettingsStore(ctx as never, namespace as never)
  return {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    t: ctx.locale.bind('settings.github'),
  }
}

/* ───────────────────────────── npm ──────────────────────────── */

export function makeNpmNamespace(scenario: Scenario) {
  return {
    async 'status.get'() {
      if (scenario === 'error') return err('npm/status.get failed (preview error scenario)')
      return ok(npmStatus(scenario))
    },
    async 'token.status'() {
      if (scenario === 'error') return err('npm/token.status failed (preview error scenario)')
      return ok(npmTokenStatus(scenario))
    },
    async 'token.test'(request: { draftToken?: string }) {
      return ok(npmTokenTest(scenario, request.draftToken))
    },
  }
}

export function buildNpmInjected(ctx: MockCtx, scenario: Scenario) {
  ctx.__preview.dictionary('settings.npm', 'zh', npmZh)
  ctx.__preview.dictionary('settings.npm', 'en', npmEn)
  const namespace = makeNpmNamespace(scenario)
  ctx.__preview.namespace('remote.npm', namespace)
  const controller = new NpmUiStore(ctx as never, namespace as never)
  return {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    t: ctx.locale.bind('settings.npm'),
  }
}

/* ─────────────────────────── finance ────────────────────────── */

export function makeFinanceNamespace(scenario: Scenario) {
  let list = providerList(scenario)
  return {
    async listProviders() {
      if (scenario === 'error') return err('finance/listProviders failed (preview error scenario)')
      list = providerList(scenario)
      return ok(list)
    },
    async getLedger() {
      if (scenario === 'error') return err('finance/getLedger failed (preview error scenario)')
      return ok(ledger(scenario))
    },
    async refreshBalance(request: { provider: string }) {
      const slot = refreshBalance(request.provider)
      list = {
        ...list,
        providers: list.providers.map((row) => (row.provider === request.provider ? { ...row, balance: slot } : row)),
      }
      return ok(slot)
    },
    async getSyncStatus() {
      return ok(syncStatus(scenario))
    },
    async syncCommunityPrices() {
      return syncResult(scenario)
    },
    async getBackfillProgress() {
      return ok({ phase: 'done' as const, scanned: 37, total: 37, rescanned: 0, startedAt: Date.now() - 1200 })
    },
  }
}

/**
 * 财务面板的假装配：重建后面板只有一条数据通路（FinancePanelController），
 * 没有任何配置面，所以这里不再需要 settingsScope 的 base 层。
 */
export function buildFinanceInjected(ctx: MockCtx, scenario: Scenario) {
  ctx.__preview.dictionary('settings.finance', 'zh', financeZh)
  ctx.__preview.dictionary('settings.finance', 'en', financeEn)
  const namespace = makeFinanceNamespace(scenario)
  ctx.__preview.namespace('remote.finance', namespace)

  // 套餐走 settings 命名空间（假宿主实现 getSnapshot/subscribe/set），
  // 与真宿主同形：面板只读 + 行内写回。
  const scope = ctx.settingsScope.bind({ namespace: 'finance' }) as never
  const controller = new FinancePanelController(namespace as never, createPlanSeam(scope))
  return {
    panel: {
      useSnapshot: bindSnapshotSelector(controller.store),
      t: ctx.locale.bind('settings.finance'),
      refresh: (): void => { void controller.load() },
      refreshProvider: (provider: string): Promise<void> => controller.refreshProvider(provider),
      savePlan: (plan: never) => controller.savePlan(plan),
      removePlan: (provider: string) => controller.removePlan(provider),
    },
    controller,
    scope,
  }
}
