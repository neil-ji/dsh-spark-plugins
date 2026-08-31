/**
 * Shared strict boundary schemas for the dsh-spark-finance Typert artifacts.
 * Hand-authored mirror of the @deepseek-ai/dsh-typert-generator output shape;
 * keeps the host reflection and the client Remote contribution on one codec.
 *
 * @module dsh-spark-finance/typert-schemas
 */

import { z } from 'zod'

export const financeTokenBucketsSchema = z.object({
  uncachedInputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  outputTokens: z.number(),
})

/**
 * Strict-boundary schema for one per-provider balance view. Mirrors
 * `FinanceProviderBalance` from types.ts. The `status` union adds
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
  currency: z.enum(['CNY', 'USD']).optional(),
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
  // `FinanceBalanceView.providers` from types.ts.
  providers: z.record(z.string(), financeProviderBalanceSchema).optional(),
})

/**
 * Strict-boundary schema for one row in the per-provider configuration list.
 * Mirrors `FinanceProviderEntry` from types.ts. The schema range on
 * `totalPriceMicros` is 0..100_000_000_000 (i.e. 0..100,000 in major units),
 * matching the documented UI cap. `validity` is optional; both bounds inside
 * it are independent and optional (empty = 永久).
 */
export const financeProviderEntrySchema = z.object({
  provider: z.string(),
  billingMode: z.enum(['metered', 'plan', 'free']),
  totalPriceMicros: z.number().min(0).max(100_000_000_000),
  currency: z.enum(['CNY', 'USD']),
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
 * Strict-boundary schema for the `finance.syncCommunityPrices` return shape.
 * Mirrors `FinanceCommunitySyncResult` from types.ts; kept duplicate-on-purpose
 * because the @Remote browser face must not reach the host-only types file
 * unchanged (it gets serialized over the wire). Mirror drift is caught by
 * tests asserting structural equality.
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
 * Mirrors `FinanceSyncStatus` from types.ts.
 */
export const financeSyncStatusSchema = z.object({
  source: z.string(),
  appliedAt: z.number(),
  kept: z.number(),
  providers: z.array(z.string()),
  fx: z.number(),
})