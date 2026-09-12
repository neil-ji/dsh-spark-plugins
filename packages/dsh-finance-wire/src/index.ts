/**
 * Shared wire contract for the dsh-spark-finance plugin.
 *
 * This package is dependency-free of Node-only modules (only zod + Typert
 * types) so BOTH the host bundle and the browser client bundle can import it.
 * The host registers FINANCE_HOST_CONTRIBUTION through ctx.typert.register;
 * the client mounts FINANCE_REMOTE_CONTRIBUTION through ctx.remote.$mount.
 * Keeping the Zod codecs, the invocation descriptors and the reflection model
 * in one file is what makes the two sides impossible to drift.
 *
 * Before ADR-005 / P5 the same eight-method manifest was hand-copied into
 * `dsh-spark-finance/src/typert.host.ts` and `.../typert.remote-client.ts`;
 * the copies had already drifted (their `sourceLocation` line numbers pointed
 * at the wrong lines). Descriptors here carry no `sourceLocation` on purpose:
 * that field is a generator artifact which cannot be maintained by hand.
 *
 * @module dsh-spark-finance-wire
 */
import { z } from 'zod'
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution, TypertPackageModel } from '@deepseek-ai/dsh-typert-registry/types'

/* ─────────────────────────── 边界 schema（单源） ─────────────────────────── */

export const financeTokenBucketsSchema = z.object({
  uncachedInputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  outputTokens: z.number(),
})

/**
 * Strict-boundary schema for one per-provider balance view. Mirrors
 * `FinanceProviderBalance` from the host types. The `status` union adds
 * `unsupported` (for providers the host cannot fetch) on top of the legacy
 * `FinanceBalanceStatus`. `code` is a stable lower-kebab tag (`auth`,
 * `http`, `unsupported-provider`, ...); `message` is human-readable copy.
 *
 * Declared BEFORE `financeBalanceViewSchema` so the balance view's `providers`
 * map can reference this schema directly without a lazy trampoline.
 */
export const financeProviderBalanceSchema = z.object({
  status: z.enum(['ok', 'missing-credential', 'unsupported', 'error']),
  provider: z.string(),
  totalMicros: z.number().optional(),
  currency: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  fetchedAt: z.number(),
})

export const financeBalanceViewSchema = z.object({
  status: z.enum(['ok', 'missing-credential', 'error']),
  updatedAt: z.number(),
  isAvailable: z.boolean().optional(),
  currency: z.string().optional(),
  totalMicros: z.number().optional(),
  grantedMicros: z.number().optional(),
  toppedUpMicros: z.number().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  // Rolling-upgrade allowance: older hosts omit the per-provider map. Clients
  // fall back to the legacy single-provider fields above as the DeepSeek view
  // until commit 12 starts populating this. Strict-zod shape mirrors
  // `FinanceBalanceView.providers`.
  providers: z.record(z.string(), financeProviderBalanceSchema).optional(),
})

/**
 * Strict-boundary schema for one row in the per-provider configuration list.
 * Mirrors `FinanceProviderEntry`. The schema range on `totalPriceMicros` is
 * 0..100_000_000_000 (i.e. 0..100,000 in major units), matching the documented
 * UI cap. `validity` is optional; both bounds inside it are independent and
 * optional (empty = 永久).
 */
export const financeProviderEntrySchema = z.object({
  provider: z.string(),
  billingMode: z.enum(['metered', 'plan', 'free']),
  totalPriceMicros: z.number().min(0).max(100_000_000_000),
  currency: z.string(),
  autoFetchBalance: z.boolean(),
  validity: z.object({
    startMs: z.number().optional(),
    endMs: z.number().optional(),
  }).optional(),
})

export const financeHourOfDayRowSchema = z.object({
  localHour: z.number(),
  usage: financeTokenBucketsSchema,
  costMicros: z.number(),
  peakCostMicros: z.number(),
  flatCostMicros: z.number(),
  // Rolling-upgrade allowance: old hosts omit the per-hour savings.
  shiftSavingsMicros: z.number().optional().default(0),
})

export const financePeakValleySplitSchema = z.object({
  peakCostMicros: z.number(),
  offPeakCostMicros: z.number(),
  flatCostMicros: z.number(),
  unclassifiedCostMicros: z.number(),
  // Optional for a rolling upgrade: a host still running the pre-legacy
  // ledger omits the field, and the client fills 0 until the host restarts.
  legacyCostMicros: z.number().optional().default(0),
  shiftSavingsMicros: z.number(),
})

export const financeLedgerSchema = z.object({
  generatedAt: z.number(),
  currency: z.string(),
  totals: financeTokenBucketsSchema,
  totalCostMicros: z.number(),
  // Billing-mode split; absent on hosts predating it.
  meteredCostMicros: z.number().optional().default(0),
  planEquivalentCostMicros: z.number().optional().default(0),
  sessionCount: z.number(),
  workspaceCount: z.number(),
  taskCount: z.number(),
  byDay: z.array(z.object({
    day: z.string(),
    usage: financeTokenBucketsSchema,
    costMicros: z.number(),
  })),
  byModel: z.array(z.object({
    modelKey: z.string(),
    // Rolling-upgrade allowance: hosts before the provider split omit them.
    provider: z.string().optional().default(''),
    model: z.string().optional().default(''),
    // Billing classification; absent on hosts predating it = 'metered'.
    billingMode: z.enum(['metered', 'plan']).optional(),
    usage: financeTokenBucketsSchema,
    costMicros: z.number(),
    shiftSavingsMicros: z.number().optional().default(0),
  })),
  // Rolling-upgrade allowance: old hosts omit the provider rollup entirely.
  byProvider: z.array(z.object({
    provider: z.string(),
    usage: financeTokenBucketsSchema,
    costMicros: z.number(),
    modelCount: z.number(),
    billingMode: z.enum(['metered', 'plan', 'mixed']).optional(),
  })).optional().default([]),
  byWorkspace: z.array(z.object({
    workspaceId: z.string().nullable(),
    title: z.string(),
    sessionCount: z.number(),
    usage: financeTokenBucketsSchema,
    costMicros: z.number(),
  })),
  tasks: z.array(z.object({
    taskId: z.string(),
    title: z.string().nullable(),
    createdAt: z.number(),
    sessionCount: z.number(),
    usage: financeTokenBucketsSchema,
    costMicros: z.number(),
  })),
  sessions: z.array(z.object({
    sessionId: z.string(),
    title: z.string().nullable(),
    createdAt: z.number(),
    cwd: z.string().optional(),
    workspaceId: z.string().nullable(),
    workspaceTitle: z.string().nullable(),
    taskId: z.string(),
    parentSessionId: z.string().optional(),
    delegationDepth: z.number().optional(),
    origin: z.literal('subagent').optional(),
    modelKeys: z.array(z.string()),
    usage: financeTokenBucketsSchema,
    costMicros: z.number(),
  })),
  byHourOfDay: z.array(financeHourOfDayRowSchema),
  peakValley: financePeakValleySplitSchema,
  // Sessions whose stored log could not be read and were skipped: they are
  // absent from `sessionCount` and every rollup above, and drive the
  // dashboard's warning banner. Old hosts omit the list entirely.
  unreadableSessions: z.array(z.object({
    sessionId: z.string(),
    createdAt: z.number(),
    reason: z.string(),
  })).optional().default([]),
  // Same rolling-upgrade allowance: old hosts send no cut-off date.
  windowedSinceMs: z.number().nullable().optional().default(null),
  hourOfDayWindowStartMs: z.number(),
})

export const financeOverviewSchema = z.object({
  balance: financeBalanceViewSchema,
  ledger: financeLedgerSchema,
})

export const financeBackfillProgressSchema = z.object({
  phase: z.enum(['idle', 'backfill', 'done']),
  scanned: z.number(),
  total: z.number(),
  rescanned: z.number(),
  startedAt: z.number(),
})

/**
 * Strict-boundary schema for the `finance.syncCommunityPrices` `options`
 * parameter. Mirrors `FinanceSyncOptions`; both keys optional, each validated
 * when present.
 */
export const financeSyncOptionsSchema = z.object({
  providers: z.array(z.string()).optional(),
  fx: z.number().optional(),
})

/**
 * Strict-boundary schema for the `finance.syncCommunityPrices` return shape.
 * Mirrors `FinanceCommunitySyncResult`; kept duplicate-on-purpose because the
 * @Remote browser face must not reach the host-only types file unchanged (it
 * gets serialized over the wire). Mirror drift is caught by tests asserting
 * structural equality.
 */
export const financeCommunitySyncResultSchema = z.object({
  ok: z.boolean(),
  source: z.string(),
  appliedAt: z.number().optional(),
  fx: z.number(),
  requestedProviders: z.array(z.string()),
  requestedMissing: z.array(z.string()),
  kept: z.number(),
  droppedDated: z.number(),
  droppedNonToken: z.number(),
  droppedNoCost: z.number(),
  providers: z.array(z.string()),
  error: z.object({ message: z.string() }).optional(),
})

/**
 * Strict-boundary schema for the `finance.getSyncStatus` return shape.
 * Mirrors `FinanceSyncStatus`.
 */
export const financeSyncStatusSchema = z.object({
  source: z.string(),
  appliedAt: z.number(),
  kept: z.number(),
  providers: z.array(z.string()),
  fx: z.number(),
})

/**
 * Commit 19: per-row source flag for the merged provider list. One entry can
 * carry several sources (e.g. `host-known` + `user-config` + `ledger-observed`).
 */
export const financeProviderSourceSchema = z.enum(['host-known', 'user-config', 'ledger-observed', 'llm-runtime'])

/**
 * Strict-boundary schema for one row in the merged provider list. Mirrors
 * `FinanceListProvidersEntry`. Both `hostMeta` and `userEntry` are optional
 * because not every provider has both surfaces (e.g. a brand new provider only
 * observed in the ledger has neither).
 */
export const financeListProvidersEntrySchema = z.object({
  provider: z.string(),
  sources: z.array(financeProviderSourceSchema),
  hostMeta: z.object({
    defaultBillingMode: z.enum(['metered', 'plan', 'free']),
    defaultCurrency: z.string(),
    supportsBalanceFetch: z.boolean(),
    lockBillingModeAndCurrency: z.boolean().optional(),
  }).optional(),
  userEntry: financeProviderEntrySchema.optional(),
  balance: financeProviderBalanceSchema,
})

/**
 * Strict-boundary schema for the `finance.listProviders` return shape.
 * Mirrors `FinanceListProvidersResult`.
 */
export const financeListProvidersResultSchema = z.object({
  providers: z.array(financeListProvidersEntrySchema),
  generatedAt: z.number(),
})

/**
 * Strict-boundary schema for the `finance.refreshBalance` argument. Mirrors
 * `FinanceRefreshBalanceRequest`.
 */
export const financeRefreshBalanceRequestSchema = z.object({
  provider: z.string(),
})

/* ───────────────────────── Remote 端点（单源描述符） ───────────────────────── */

/**
 * The eight Remote invocations shared by the host registration and the client
 * `$mount`. `implementation` is deliberately omitted everywhere: every host
 * method is decorated with a bare `@Remote`, so the gateway's
 * `descriptor.implementation ?? descriptor.method` resolves to the method name
 * itself.
 */
export const FINANCE_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-spark-finance#finance/getBalance',
    service: 'finance',
    namespace: 'finance',
    method: 'getBalance',
    invocation: { kind: 'direct' },
    parameters: [],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-spark-finance/types#FinanceBalanceView',
      schema: financeBalanceViewSchema,
    },
  },
  {
    id: 'dsh-spark-finance#finance/getLedger',
    service: 'finance',
    namespace: 'finance',
    method: 'getLedger',
    invocation: { kind: 'direct' },
    parameters: [],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-spark-finance/types#FinanceLedger',
      schema: financeLedgerSchema,
    },
  },
  {
    id: 'dsh-spark-finance#finance/getOverview',
    service: 'finance',
    namespace: 'finance',
    method: 'getOverview',
    invocation: { kind: 'direct' },
    parameters: [],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-spark-finance/types#FinanceOverview',
      schema: financeOverviewSchema,
    },
  },
  {
    id: 'dsh-spark-finance#finance/getBackfillProgress',
    service: 'finance',
    namespace: 'finance',
    method: 'getBackfillProgress',
    invocation: { kind: 'direct' },
    parameters: [],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-spark-finance/types#FinanceBackfillProgress',
      schema: financeBackfillProgressSchema,
    },
  },
  {
    id: 'dsh-spark-finance#finance/syncCommunityPrices',
    service: 'finance',
    namespace: 'finance',
    method: 'syncCommunityPrices',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'options',
        wire: 'options',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-spark-finance/types#FinanceSyncOptions',
          schema: financeSyncOptionsSchema,
        },
        acceptsUndefined: true,
      },
    ],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-spark-finance/types#FinanceCommunitySyncResult',
      schema: financeCommunitySyncResultSchema,
    },
  },
  {
    id: 'dsh-spark-finance#finance/getSyncStatus',
    service: 'finance',
    namespace: 'finance',
    method: 'getSyncStatus',
    invocation: { kind: 'direct' },
    parameters: [],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-spark-finance/types#FinanceSyncStatus',
      schema: financeSyncStatusSchema.nullable(),
    },
  },
  {
    id: 'dsh-spark-finance#finance/listProviders',
    service: 'finance',
    namespace: 'finance',
    method: 'listProviders',
    invocation: { kind: 'direct' },
    parameters: [],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-spark-finance/types#FinanceListProvidersResult',
      schema: financeListProvidersResultSchema,
    },
  },
  {
    id: 'dsh-spark-finance#finance/refreshBalance',
    service: 'finance',
    namespace: 'finance',
    method: 'refreshBalance',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: 'dsh-spark-finance/types#FinanceRefreshBalanceRequest',
          schema: financeRefreshBalanceRequestSchema,
        },
      },
    ],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-spark-finance/types#FinanceProviderBalance',
      schema: financeProviderBalanceSchema,
    },
  },
]

/* ─────────────────────────── 反射模型（单源） ─────────────────────────── */

/**
 * Business reflection for the `finance` Cordis service: the member signatures
 * the service publishes and the declarations of every type crossing the wire.
 * The `declaration` strings mirror the host's `types.ts`; they are what the
 * registry hands to schema/JSON-Schema tooling.
 */
export const FINANCE_REFLECTION: TypertPackageModel = {
  services: [
    {
      key: 'finance',
      exportName: 'finance',
      description: 'Finance audit Remote service: DeepSeek balance, cross-session ledger, and the combined overview.',
      summary: 'Finance audit Remote service.',
      jsDoc: '/** Finance audit Remote service. */',
      tags: [],
      members: [
        { name: 'getBalance', signature: 'getBalance(signal?: AbortSignal): Promise<FinanceBalanceView>', kind: 'method' },
        { name: 'getLedger', signature: 'getLedger(signal?: AbortSignal): Promise<FinanceLedger>', kind: 'method' },
        { name: 'getOverview', signature: 'getOverview(signal?: AbortSignal): Promise<FinanceOverview>', kind: 'method' },
        { name: 'getBackfillProgress', signature: 'getBackfillProgress(): Promise<FinanceBackfillProgress>', kind: 'method' },
        { name: 'syncCommunityPrices', signature: 'syncCommunityPrices(options?: { providers?: readonly string[]; fx?: number }, signal?: AbortSignal): Promise<FinanceCommunitySyncResult>', kind: 'method' },
        { name: 'getSyncStatus', signature: 'getSyncStatus(): Promise<FinanceSyncStatus | null>', kind: 'method' },
        { name: 'listProviders', signature: 'listProviders(signal?: AbortSignal): Promise<FinanceListProvidersResult>', kind: 'method' },
        { name: 'refreshBalance', signature: 'refreshBalance(request: FinanceRefreshBalanceRequest, signal?: AbortSignal): Promise<FinanceProviderBalance>', kind: 'method' },
      ],
      types: [
        { name: 'FinanceBalanceView', declaration: 'export interface FinanceBalanceView { status: FinanceBalanceStatus; updatedAt: number; isAvailable?: boolean; currency?: string; totalMicros?: number; grantedMicros?: number; toppedUpMicros?: number; code?: string; message?: string; }' },
        { name: 'FinanceCommunitySyncResult', declaration: 'export interface FinanceCommunitySyncResult { ok: boolean; source: string; appliedAt?: number; fx: number; requestedProviders: readonly string[]; requestedMissing: readonly string[]; kept: number; droppedDated: number; droppedNonToken: number; droppedNoCost: number; providers: readonly string[]; error?: { message: string }; }' },
        { name: 'FinanceSyncStatus', declaration: 'export interface FinanceSyncStatus { source: string; appliedAt: number; kept: number; providers: readonly string[]; fx: number; }' },
        { name: 'FinanceListProvidersResult', declaration: 'export interface FinanceListProvidersResult { providers: readonly FinanceListProvidersEntry[]; generatedAt: number; }' },
        { name: 'FinanceListProvidersEntry', declaration: 'export interface FinanceListProvidersEntry { provider: string; sources: readonly FinanceProviderSource[]; hostMeta?: { defaultBillingMode: FinanceProviderBillingMode; defaultCurrency: "CNY" | "USD"; supportsBalanceFetch: boolean; lockBillingModeAndCurrency?: boolean }; userEntry?: FinanceProviderEntry; balance: FinanceProviderBalance; }' },
        { name: 'FinanceRefreshBalanceRequest', declaration: 'export interface FinanceRefreshBalanceRequest { provider: string; }' },
        { name: 'FinanceProviderSource', declaration: 'export type FinanceProviderSource = "host-known" | "user-config" | "ledger-observed" | "llm-runtime";' },
        { name: 'FinanceTokenBuckets', declaration: 'export interface FinanceTokenBuckets { uncachedInputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number; }' },
        { name: 'FinanceHourOfDayRow', declaration: 'export interface FinanceHourOfDayRow { localHour: number; usage: FinanceTokenBuckets; costMicros: number; peakCostMicros: number; flatCostMicros: number; shiftSavingsMicros: number; }' },
        { name: 'FinancePeakValleySplit', declaration: 'export interface FinancePeakValleySplit { peakCostMicros: number; offPeakCostMicros: number; flatCostMicros: number; unclassifiedCostMicros: number; legacyCostMicros: number; shiftSavingsMicros: number; }' },
        { name: 'FinanceBillingMode', declaration: "export type FinanceBillingMode = 'metered' | 'plan';" },
        { name: 'FinanceProviderRow', declaration: 'export interface FinanceProviderRow { provider: string; usage: FinanceTokenBuckets; costMicros: number; modelCount: number; billingMode?: FinanceBillingMode | "mixed"; }' },
        { name: 'FinanceLedger', declaration: 'export interface FinanceLedger { generatedAt: number; currency: string; totals: FinanceTokenBuckets; totalCostMicros: number; meteredCostMicros?: number; planEquivalentCostMicros?: number; sessionCount: number; workspaceCount: number; taskCount: number; windowedSinceMs: number | null; hourOfDayWindowStartMs: number; byDay: readonly FinanceDayRow[]; byModel: readonly FinanceModelRow[]; byProvider: readonly FinanceProviderRow[]; byWorkspace: readonly FinanceWorkspaceRow[]; tasks: readonly FinanceTaskRow[]; sessions: readonly FinanceSessionRow[]; unreadableSessions: readonly FinanceUnreadableSessionRow[]; byHourOfDay: readonly FinanceHourOfDayRow[]; peakValley: FinancePeakValleySplit; }' },
        { name: 'FinanceUnreadableSessionRow', declaration: 'export interface FinanceUnreadableSessionRow { sessionId: string; createdAt: number; reason: string; }' },
        { name: 'FinanceOverview', declaration: 'export interface FinanceOverview { balance: FinanceBalanceView; ledger: FinanceLedger; }' },
        { name: 'FinanceBackfillProgress', declaration: 'export interface FinanceBackfillProgress { phase: "idle" | "backfill" | "done"; scanned: number; total: number; rescanned: number; startedAt: number; }' },
        // Per-provider configuration + balance. The host does not yet fill
        // these in `getBalance`, but the types are published now so the client
        // UI / future @Remote can consume them without a manifest bump.
        { name: 'FinanceProviderBillingMode', declaration: "export type FinanceProviderBillingMode = 'metered' | 'plan' | 'free';" },
        { name: 'FinanceProviderEntry', declaration: 'export interface FinanceProviderEntry { provider: string; billingMode: FinanceProviderBillingMode; totalPriceMicros: number; currency: "CNY" | "USD"; autoFetchBalance: boolean; validity?: { startMs?: number; endMs?: number }; }' },
        { name: 'FinanceProviderBalance', declaration: 'export interface FinanceProviderBalance { status: "ok" | "missing-credential" | "unsupported" | "error"; provider: string; totalMicros?: number; currency?: "CNY" | "USD"; code?: string; message?: string; fetchedAt: number; }' },
        // Client-side Form List uses this to seed defaults + lock fields.
        { name: 'FinanceHostProviderMeta', declaration: 'export interface FinanceHostProviderMeta { provider: string; defaultBillingMode: "metered" | "plan" | "free"; defaultCurrency: "CNY" | "USD"; supportsBalanceFetch: boolean; lockBillingModeAndCurrency?: boolean; }' },
      ],
    },
  ],
  events: [],
  objects: [],
}

/* ───────────────────────── 两份贡献（host / client） ───────────────────────── */

/** Host-side contribution: registered with ctx.typert.register in the host bundle. */
export const FINANCE_HOST_CONTRIBUTION: TypertContribution = {
  package: 'dsh-spark-finance',
  face: 'host',
  schemas: [
    { name: 'FinanceTokenBuckets', schema: financeTokenBucketsSchema },
    { name: 'FinanceProviderBalance', schema: financeProviderBalanceSchema },
    { name: 'FinanceBalanceView', schema: financeBalanceViewSchema },
    { name: 'FinanceProviderEntry', schema: financeProviderEntrySchema },
    { name: 'FinanceHourOfDayRow', schema: financeHourOfDayRowSchema },
    { name: 'FinancePeakValleySplit', schema: financePeakValleySplitSchema },
    { name: 'FinanceLedger', schema: financeLedgerSchema },
    { name: 'FinanceOverview', schema: financeOverviewSchema },
    { name: 'FinanceBackfillProgress', schema: financeBackfillProgressSchema },
    { name: 'FinanceSyncOptions', schema: financeSyncOptionsSchema },
    { name: 'FinanceCommunitySyncResult', schema: financeCommunitySyncResultSchema },
    { name: 'FinanceSyncStatus', schema: financeSyncStatusSchema },
    { name: 'FinanceProviderSource', schema: financeProviderSourceSchema },
    { name: 'FinanceListProvidersEntry', schema: financeListProvidersEntrySchema },
    { name: 'FinanceListProvidersResult', schema: financeListProvidersResultSchema },
    { name: 'FinanceRefreshBalanceRequest', schema: financeRefreshBalanceRequestSchema },
  ],
  model: FINANCE_REFLECTION,
  invocations: [...FINANCE_INVOCATIONS],
}

/** Client-side contribution: mounted with ctx.remote.$mount in the UI bundle. */
export const FINANCE_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-spark-finance',
  descriptors: [...FINANCE_INVOCATIONS],
}
