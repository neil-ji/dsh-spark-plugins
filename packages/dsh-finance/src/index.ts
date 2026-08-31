/**
 * First-party finance domain for DeepSeek Harness: balance endpoint access and
 * a cross-session cost ledger exposed as Typert Remote methods. The browser
 * finance-audit settings page consumes `finance.getBalance/getLedger/getOverview`.
 *
 * @module @deepseek-ai/dsh-spark-finance
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
import { DEFAULT_PRICE, mergePriceLayers, normalizeFinanceConfig } from './pricing.ts'
import {
  DEFAULT_FX as COMMUNITY_SYNC_DEFAULT_FX,
  DEFAULT_PROVIDERS as COMMUNITY_SYNC_DEFAULT_PROVIDERS,
  SOURCE_URL as COMMUNITY_SYNC_SOURCE_URL,
  fetchCommunityPrices,
} from './sync/community-prices.ts'
import type { CommunityPriceRow } from './sync/community-prices.ts'
import {
  financeCommunitySyncResultSchema,
  financeSyncStatusSchema,
} from './typert.schemas.ts'
import { hostProviderMeta } from './provider-meta.ts'
import type {
  FinanceBackfillProgress,
  FinanceBalanceView,
  FinanceCommunitySyncResult,
  FinanceConfig,
  FinanceConfigInput,
  FinanceLedger,
  FinanceOverview,
  FinancePriceEntryInput,
  FinancePriceRate,
  FinanceProviderBalance,
  FinanceProviderEntry,
  FinanceSyncStatus,
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

/** Settings namespace for user-editable price and base/balance connection facts. */
const NS = settingsNamespace('finance')

/**
 * Pull `prices` out of one side (base / user) of the active settings
 * descriptor for our namespace. Returns `{}` when the settings service has
 * not yet been installed, when the descriptor has no entry for `ns`, or when
 * the side carries no `prices` field.
 *
 * Detached — never returns the live object the descriptor holds, so a caller
 * can mutate the result without aliasing the settings store.
 */
function readDescriptorPrices(
  ctx: Context,
  ns: ReturnType<typeof settingsNamespace>,
  side: 'base' | 'user',
): FinanceConfigInput['prices'] {
  const settings = (ctx as { settings?: { describe: () => Array<{ ns: typeof ns; base?: unknown; user?: unknown }> } }).settings
  if (settings === undefined || typeof settings.describe !== 'function') return {}
  const descriptor = settings.describe().find(d => d.ns === ns)
  if (descriptor === undefined) return {}
  const sideValue = descriptor[side]
  if (sideValue === undefined || sideValue === null || typeof sideValue !== 'object' || !('prices' in sideValue)) return {}
  const prices = (sideValue as { prices?: unknown }).prices
  if (prices === undefined || prices === null || typeof prices !== 'object') return {}
  return prices as FinanceConfigInput['prices']
}

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

/**
 * One row in the per-provider configuration list (commit 11, additive).
 * Mirrors `FinanceProviderEntry` from types.ts. The schemastery validator
 * rejects unknown fields via its default 'remove' mode; nothing here has
 * non-trivial coercion so the shape stays flat.
 */
const providerEntry = z.object({
  provider: z.string().required(),
  billingMode: z.union(['metered', 'plan', 'free']).required(),
  totalPriceMicros: z.number().step(1).min(0).max(100_000_000_000).required(),
  currency: z.union(['CNY', 'USD']).required(),
  autoFetchBalance: z.boolean().required(),
  validity: z.object({
    startMs: z.number().step(1),
    endMs: z.number().step(1),
  }),
})

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
    /**
     * Per-provider configuration list (commit 11, additive). Empty by default
     * — host-known metadata seeds it from `cordis.patch.yml` once commit 12
     * lands the `provider-meta.ts` registry. The user overlay is the same
     * shape and wins on key-by-key merge.
     */
    providers: z.array(providerEntry).default([]),
  })

  private configSource: () => FinanceConfigInput
  private ledgerCache: { at: number; ledger: FinanceLedger } | undefined
  /** Single-flight auto-backfill of the hourly unit (see getLedger). */
  private hourlyBackfill: Promise<void> | undefined
  /** Live progress of the running backfill, polled by the loading UI. */
  private backfillProgress: FinanceBackfillProgress | undefined
  /**
   * Composition-layer `prices` captured at registration: the cordis.patch.yml
   * defaults the host installed (`FinanceService.Config`'s `entry`). Read by
   * `currentConfig` to anchor the three-tier merge.
   */
  private compositionPrices: FinanceConfigInput['prices'] = {}
  /**
   * User-layer `prices` read from the settings descriptor (`descriptor.user`).
   * Refreshed on `setSource` and `onChange` so a write at any other surface
   * surfaces into the next ledger build.
   */
  private userPrices: FinanceConfigInput['prices'] = {}
  /**
   * In-memory community-prices layer populated by `@Remote syncCommunityPrices`.
   * Empty by default (no override). Cleared by setting to `{}`; absent on the
   * settings document so a restart means bundle defaults take over until the
   * next sync (or auto-sync).
   */
  private communityPrices: FinanceConfigInput['prices'] = {}
  /**
   * Result of the last sync (success or failure). Distinct from the per-call
   * return value: stored here so the dashboard can poll it without re-firing
   * the upstream fetch. Updated by `syncCommunityPrices`; surfaced via
   * `getSyncStatus`.
   */
  private lastSyncStatus: FinanceCommunitySyncResult | null = null

  constructor(ctx: Context, config: FinanceConfigInput = {}) {
    super(ctx, 'finance')
    this.configSource = () => config
    this.compositionPrices = config.prices ?? {}
    installSettingsSection(ctx, NS, FinanceService.Config, config, {
      setSource: source => {
        this.configSource = source
        this.refreshLayerCaches()
      },
      onChange: () => {
        this.ledgerCache = undefined
        this.refreshLayerCaches()
      },
    })

    // Projection registration is optional: headless compositions without the
    // registry keep the service usable for balance-only callers.
    ctx.inject(['sessionProjections'], projectionCtx => {
      projectionCtx.sessionProjections.register(financeUsageProjectionDefinition)
      projectionCtx.sessionProjections.register(financeUsageHourlyProjectionDefinition)
    })
  }

  /**
   * Replace the in-memory community-prices layer. Empty `{}` clears it
   * (composition + user layers are untouched). Used by `@Remote
   * syncCommunityPrices` after a successful fetch, but kept as a regular
   * method so tests and plugins can populate it directly.
   */
  setCommunityPrices(prices: FinanceConfigInput['prices']): void {
    this.communityPrices = prices ?? {}
    this.ledgerCache = undefined
  }

  /**
   * Latest community-prices snapshot, detached from the live map. Returns an
   * empty object when no sync has populated the layer yet.
   */
  getCommunityPrices(): FinanceConfigInput['prices'] {
    return { ...this.communityPrices }
  }

  /**
   * Pull the user-overlay `prices` out of the active settings descriptor.
   * Needed because `installSettingsSection`'s resolved view folds user into
   * composition, hiding which keys the user explicitly set.
   */
  private refreshLayerCaches(): void {
    this.userPrices = readDescriptorPrices(this.ctx, NS, 'user')
    // `descriptor.base` is the composition entry; re-capture too in case the
    // settings section was re-registered with a different entry.
    this.compositionPrices = readDescriptorPrices(this.ctx, NS, 'base')
  }

  /**
   * The resolved config: raw settings normalized into era-sorted price lists.
   * Price tables are merged across three tiers (composition ⊆ community ⊆ user)
   * before normalization so the ledger sees the right rate for every model.
   */
  private currentConfig(): FinanceConfig {
    const raw = this.configSource()
    const compositionPrices = this.compositionPrices
    const communityPrices = this.communityPrices
    const userPrices = this.userPrices
    const mergedPrices = mergePriceLayers(compositionPrices, communityPrices, userPrices)
    return normalizeFinanceConfig({ ...raw, prices: mergedPrices })
  }

  /** Fetch the first-party balance now. The API key never leaves the host. */
  @Remote
  async getBalance(signal?: AbortSignal): Promise<FinanceBalanceView> {
    const config = this.currentConfig()
    const entries = config.providers
    const fetchedAt = Date.now()
    const providers: Record<string, FinanceProviderBalance> = {}

    // Resolve the deepseek-official slot up-front: empty providers list keeps
    // the legacy behavior (auto-fetch, as if autoFetchBalance=true); an
    // explicit entry respects its `autoFetchBalance` + `billingMode`. Other
    // entries populate below with `status: 'unsupported'`.
    const dsEntry = entries.find(e => e.provider === 'deepseek-official')
    const shouldFetchDeepseek = entries.length === 0
      || (dsEntry !== undefined
        && dsEntry.billingMode !== 'free'
        && dsEntry.autoFetchBalance
        && (hostProviderMeta(dsEntry.provider)?.supportsBalanceFetch ?? false))

    let legacyResult: FinanceBalanceView
    if (shouldFetchDeepseek) {
      legacyResult = await this.fetchDeepSeekBalance(config, signal)
      providers['deepseek-official'] = this.deepSeekSlot(legacyResult, fetchedAt)
    } else {
      legacyResult = { status: 'missing-credential', updatedAt: fetchedAt }
      if (dsEntry !== undefined) {
        providers['deepseek-official'] = dsEntry.billingMode === 'free'
          ? this.unsupportedSlot(dsEntry, fetchedAt, 'free-provider', 'free providers do not track a balance')
          : this.unsupportedSlot(dsEntry, fetchedAt, 'auto-fetch-disabled', 'balance fetch is disabled for this entry')
      }
    }

    // Populate every other configured entry. The host can only fetch
    // deepseek-official today; everything else lands as 'unsupported' with a
    // stable code (commit 12's contract — future commits add more providers
    // to the host-known registry as their APIs land).
    for (const entry of entries) {
      if (entry.provider === 'deepseek-official') continue
      const meta = hostProviderMeta(entry.provider)
      if (entry.billingMode === 'free') {
        providers[entry.provider] = this.unsupportedSlot(entry, fetchedAt, 'free-provider', 'free providers do not track a balance')
      } else if (meta === undefined) {
        providers[entry.provider] = this.unsupportedSlot(entry, fetchedAt, 'unsupported-provider', `host has no balance endpoint registered for ${entry.provider}`)
      } else if (!meta.supportsBalanceFetch) {
        providers[entry.provider] = this.unsupportedSlot(entry, fetchedAt, 'no-balance-fetch', `host does not support balance fetch for ${entry.provider} yet`)
      } else {
        // Host CAN fetch but the user disabled autoFetchBalance for this entry.
        providers[entry.provider] = this.unsupportedSlot(entry, fetchedAt, 'auto-fetch-disabled', 'balance fetch is disabled for this entry')
      }
    }

    return { ...legacyResult, providers }
  }

  /**
   * Core DeepSeek balance fetch — pure function on the resolved config + key.
   * Factored out of `getBalance` so the legacy single-provider view and the
   * new `providers.deepseek-official` slot share one implementation.
   */
  private async fetchDeepSeekBalance(
    config: FinanceConfig,
    signal?: AbortSignal,
  ): Promise<FinanceBalanceView> {
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

  /** Map a legacy `FinanceBalanceView` into the per-provider slot. */
  private deepSeekSlot(view: FinanceBalanceView, fetchedAt: number): FinanceProviderBalance {
    if (view.status === 'ok') {
      return {
        status: 'ok',
        provider: 'deepseek-official',
        ...view.totalMicros !== undefined ? { totalMicros: view.totalMicros } : {},
        ...view.currency !== undefined && (view.currency === 'CNY' || view.currency === 'USD')
          ? { currency: view.currency }
          : {},
        fetchedAt,
      }
    }
    if (view.status === 'missing-credential') {
      return { status: 'missing-credential', provider: 'deepseek-official', fetchedAt }
    }
    return {
      status: 'error',
      provider: 'deepseek-official',
      ...view.code !== undefined ? { code: view.code } : {},
      ...view.message !== undefined ? { message: view.message } : {},
      fetchedAt,
    }
  }

  /** Build an `unsupported` provider slot with a stable code + message. */
  private unsupportedSlot(
    entry: FinanceProviderEntry,
    fetchedAt: number,
    code: string,
    message: string,
  ): FinanceProviderBalance {
    return { status: 'unsupported', provider: entry.provider, code, message, fetchedAt }
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

  /**
   * Options forwarded to the community sync; kept loose because the underlying
   * `collectRows` accepts the same shape. `providers` defaults to the same set
   * as the bundle-side `pnpm finance:sync-prices` script. `fx` overrides the
   * CNY-USD rate applied during conversion (default `COMMUNITY_SYNC_DEFAULT_FX`).
   */
  private defaultSyncOptions(): { providers: readonly string[]; fx: number } {
    return { providers: [...COMMUNITY_SYNC_DEFAULT_PROVIDERS], fx: COMMUNITY_SYNC_DEFAULT_FX }
  }

  /**
   * Resolve the `{provider}/{model}` rows from a sync result into the
   * `FinanceConfig['prices']` raw shape (`Record<modelKey, singleEntry>`). Each
   * flat rate becomes one entry with `effectiveFrom = 0` (always-applies era)
   * so a later community re-sync overrides it without leaving an era history.
   * The result feeds straight into `mergePriceLayers`/`normalizeFinanceConfig`
   * upstream — the inner entries are READ-WRITE (just like what the user
   * hand-edits in advanced), not normalized yet.
   */
  private rowsToPrices(rows: readonly CommunityPriceRow[]): FinanceConfigInput['prices'] {
    const out: Record<string, FinancePriceEntryInput> = {}
    for (const { modelKey, rate } of rows) {
      out[modelKey] = {
        effectiveFrom: 0,
        inputMicrosPerMtok: rate.inputMicrosPerMtok,
        outputMicrosPerMtok: rate.outputMicrosPerMtok,
        ...(rate.cacheReadMicrosPerMtok !== undefined ? { cacheReadMicrosPerMtok: rate.cacheReadMicrosPerMtok } : {}),
        ...(rate.cacheWriteMicrosPerMtok !== undefined ? { cacheWriteMicrosPerMtok: rate.cacheWriteMicrosPerMtok } : {}),
      }
    }
    return out
  }

  /**
   * Pull the latest upstream price table from `models.dev/api.json`, convert
   * to finance rates, and replace the in-memory community-prices layer.
   *
   * Failure is reported as `ok: false` and never touches the layer: the prior
   * status stays current so the dashboard keeps showing the last good sync.
   * Concretely: HTTP non-2xx, JSON parse failure, and abort signals all flow
   * through the same path. The optional `signal` lets the client cancel a
   * hanging `fetch` when the user closes the dialog.
   */
  @Remote
  async syncCommunityPrices(
    options?: { providers?: readonly string[]; fx?: number },
    signal?: AbortSignal,
  ): Promise<FinanceCommunitySyncResult> {
    const requested = options?.providers ?? this.defaultSyncOptions().providers
    const fx = options?.fx ?? this.defaultSyncOptions().fx
    try {
      const { rows, stats } = await fetchCommunityPrices(
        { providers: requested, fx },
        fetch,
        signal,
      )
      const prices = this.rowsToPrices(rows)
      const appliedAt = Date.now()
      this.setCommunityPrices(prices)
      const result: FinanceCommunitySyncResult = {
        ok: true,
        source: COMMUNITY_SYNC_SOURCE_URL,
        appliedAt,
        fx,
        requestedProviders: [...requested],
        requestedMissing: [...stats.requestedMissing],
        kept: stats.kept,
        droppedDated: stats.droppedDated,
        droppedNonToken: stats.droppedNonToken,
        droppedNoCost: stats.droppedNoCost,
        providers: [...stats.providers],
      }
      this.lastSyncStatus = result
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        source: COMMUNITY_SYNC_SOURCE_URL,
        fx,
        requestedProviders: [...requested],
        requestedMissing: [],
        kept: 0,
        droppedDated: 0,
        droppedNonToken: 0,
        droppedNoCost: 0,
        providers: [],
        error: { message },
      }
    }
  }

  /**
   * Snapshot of the last successful community sync (independent of the result
   * returned by an individual `syncCommunityPrices` call). The host retains
   * `null` until the user (or auto-sync) runs at least one successful sync,
   * so the client can distinguish "never synced yet" from "synced at T".
   */
  @Remote
  async getSyncStatus(): Promise<FinanceSyncStatus | null> {
    return this.lastSyncStatus
      ? {
          source: this.lastSyncStatus.source,
          appliedAt: this.lastSyncStatus.appliedAt ?? 0,
          kept: this.lastSyncStatus.kept,
          providers: [...this.lastSyncStatus.providers],
          fx: this.lastSyncStatus.fx,
        }
      : null
  }
}

export default FinanceService