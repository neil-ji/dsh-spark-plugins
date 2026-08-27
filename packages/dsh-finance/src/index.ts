/**
 * First-party finance domain for DeepSeek Harness: balance endpoint access and
 * a cross-session cost ledger exposed as Typert Remote methods. The browser
 * finance-audit settings page consumes `finance.getBalance/getLedger/getOverview`.
 *
 * @module @deepseek-ai/dsh-finance
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-workspace'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { fetchFinanceBalance, FinanceBalanceError } from './balance.ts'
import { backfillFinanceHourly, buildFinanceLedger } from './ledger.ts'
import { financeUsageHourlyProjectionDefinition, financeUsageProjectionDefinition } from './projection.ts'
import { DEFAULT_PRICE, normalizeFinanceConfig } from './pricing.ts'
import type {
  FinanceBackfillProgress,
  FinanceBalanceView,
  FinanceConfig,
  FinanceConfigInput,
  FinanceLedger,
  FinanceOverview,
  FinancePriceRate,
} from './types.ts'

export type * from './types.ts'
export { financeUsageHourlyProjectionDefinition, financeUsageProjectionDefinition } from './projection.ts'
export { fetchFinanceBalance, FinanceBalanceError, microsFromDecimal } from './balance.ts'
export { backfillFinanceHourly } from './ledger.ts'
export {
  addFinanceBuckets,
  DEFAULT_PEAK_DAYS,
  DEFAULT_PEAK_HOURS,
  DEFAULT_UTC_OFFSET_MINUTES,
  emptyFinanceBuckets,
  financeBaseCostMicros,
  financeBaseRate,
  financeBillingMode,
  financeBucketCostMicros,
  financeCostByModelHour,
  financeEntryFor,
  financeHourTime,
  financeLocalDay,
  financeModelKey,
  financeModelOf,
  financeProviderDefault,
  financeProviderOf,
  financeRateAt,
  financeWindowedSince,
  financeWindowInfo,
  isPeakLocalDay,
  isPeakLocalHour,
  normalizeFinanceConfig,
  normalizeFinancePrices,
} from './pricing.ts'

/** Settings namespace for user-editable price and balance connection facts. */
const NS = settingsNamespace('finance')

/** One rate line in integer micros per million tokens. Cache fields optional. */
const priceRate: z<FinancePriceRate> = z.object({
  inputMicrosPerMtok: z.number().step(1).min(0).required(),
  cacheReadMicrosPerMtok: z.number().step(1).min(0),
  cacheWriteMicrosPerMtok: z.number().step(1).min(0),
  outputMicrosPerMtok: z.number().step(1).min(0).required(),
})

/** Flat 24/7 price entry (optionally era-scoped). Rate fields required so a windowed entry fails this schema in the union. */
const flatPriceEntry = z.object({
  effectiveFrom: z.union([z.string(), z.number()]),
  inputMicrosPerMtok: z.number().step(1).min(0).required(),
  cacheReadMicrosPerMtok: z.number().step(1).min(0),
  cacheWriteMicrosPerMtok: z.number().step(1).min(0),
  outputMicrosPerMtok: z.number().step(1).min(0).required(),
})

/** Peak/off-peak price entry (optionally era-scoped). offPeak/peak required for the same reason. */
const windowedPriceEntry = z.object({
  effectiveFrom: z.union([z.string(), z.number()]),
  offPeak: priceRate,
  peak: priceRate,
  peakHours: z.array(z.array(z.number())),
  peakDays: z.array(z.number().step(1).min(0).max(6)),
  utcOffsetMinutes: z.number().step(1),
})

/** A price entry, or an era history list of entries (ascending effectiveFrom). */
const priceEntries = z.union([
  z.union([flatPriceEntry, windowedPriceEntry]),
  z.array(z.union([flatPriceEntry, windowedPriceEntry])),
])

/** Service class exported for Cordis default loading; Typert generates the Remote face. */
export class FinanceService extends TypertRemoteService {
  static inject = ['sessionPersistence', 'sessionProjectionCache', 'workspaceRegistry', 'credentials']

  static Config: z<FinanceConfigInput> = z.object({
    currency: z.string().default('CNY'),
    balance: z.object({
      baseURL: z.string().default('https://api.deepseek.com'),
      apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
      timeoutMs: z.number().step(1).min(1).default(10_000),
    }),
    defaultPrice: priceRate.default(DEFAULT_PRICE),
    providerDefaults: z.dict(priceRate).default({}),
    billingModes: z.dict(z.union(['metered', 'plan'])).default({}),
    prices: z.dict(priceEntries).default({}),
  })

  private configSource: () => FinanceConfigInput
  private ledgerCache: { at: number; ledger: FinanceLedger } | undefined
  /** Single-flight auto-backfill of the hourly unit (see getLedger). */
  private hourlyBackfill: Promise<void> | undefined
  /** Live progress of the running backfill, polled by the loading UI. */
  private backfillProgress: FinanceBackfillProgress | undefined

  constructor(ctx: Context, config: FinanceConfigInput = {}) {
    super(ctx, 'finance')
    this.configSource = () => config
    installSettingsSection(ctx, NS, FinanceService.Config, config, {
      setSource: source => { this.configSource = source },
      onChange: () => { this.ledgerCache = undefined },
    })

    // Projection registration is optional: headless compositions without the
    // registry keep the service usable for balance-only callers.
    ctx.inject(['sessionProjections'], projectionCtx => {
      projectionCtx.sessionProjections.register(financeUsageProjectionDefinition)
      projectionCtx.sessionProjections.register(financeUsageHourlyProjectionDefinition)
    })
  }

  /** The resolved config: raw settings normalized into era-sorted price lists. */
  private currentConfig(): FinanceConfig {
    return normalizeFinanceConfig(this.configSource())
  }

  /** Fetch the first-party balance now. The API key never leaves the host. */
  @Remote
  async getBalance(signal?: AbortSignal): Promise<FinanceBalanceView> {
    const config = this.currentConfig()
    const ref = credentialRef(config.balance.apiKeyEnv)
    const credential = await this.ctx.credentials.resolve(ref)
    if (credential === undefined) {
      return { status: 'missing-credential', updatedAt: Date.now() }
    }
    try {
      return await fetchFinanceBalance(config, credential.value, signal)
    } catch (error) {
      if (error instanceof FinanceBalanceError) {
        return { status: 'error', code: error.code, message: error.message, updatedAt: Date.now() }
      }
      throw error
    }
  }

  /**
   * One-time, idempotent hourly backfill: before the first ledger build,
   * replay the logs of every persisted session whose cached cut lacks
   * `financeUsageHourly` (sessions that predate the unit or the plugin). This
   * is the automatic initialization that turns coarse historical estimates
   * into per-hour era pricing — sessions before the windowed era price flat,
   * from the era on they get peak/off-peak rates. The scan is cheap and
   * re-runs on later cache-missed builds (replaying nothing once every
   * session carries the unit, and self-healing sessions whose replay failed);
   * a failure only degrades those sessions back to the estimate.
   */
  private ensureHourlyBackfilled(signal?: AbortSignal): Promise<void> {
    let pending = this.hourlyBackfill
    if (pending === undefined) {
      const progress: FinanceBackfillProgress = { phase: 'backfill', scanned: 0, total: 0, rescanned: 0, startedAt: Date.now() }
      this.backfillProgress = progress
      pending = backfillFinanceHourly(this.ctx, signal, progress)
        .then(
          () => { progress.phase = 'done' },
          (error: unknown) => {
            this.ctx.logger?.warn?.('finance: hourly backfill failed, sessions stay estimated', error)
            progress.phase = 'done'
          },
        )
        .finally(() => { this.hourlyBackfill = undefined })
      this.hourlyBackfill = pending
    }
    return pending
  }

  /** Live progress of the one-time hourly backfill for the loading UI. */
  @Remote
  async getBackfillProgress(): Promise<FinanceBackfillProgress> {
    return this.backfillProgress ?? { phase: 'idle', scanned: 0, total: 0, rescanned: 0, startedAt: Date.now() }
  }

  /** Cold aggregate of every persisted session, cached for a short TTL. */
  @Remote
  async getLedger(signal?: AbortSignal): Promise<FinanceLedger> {
    const now = Date.now()
    if (this.ledgerCache !== undefined && now - this.ledgerCache.at < 5_000) {
      return this.ledgerCache.ledger
    }
    await this.ensureHourlyBackfilled(signal)
    const ledger = await buildFinanceLedger(this.ctx, this.currentConfig(), signal)
    this.ledgerCache = { at: now, ledger }
    return ledger
  }

  /** Dashboard entry point: balance + ledger in one request. */
  @Remote
  async getOverview(signal?: AbortSignal): Promise<FinanceOverview> {
    const [balance, ledger] = await Promise.all([
      this.getBalance(signal),
      this.getLedger(signal),
    ])
    return { balance, ledger }
  }
}

export default FinanceService