/**
 * Generated-style host Typert reflection for dsh-spark-finance, hand-authored to the
 * shape @deepseek-ai/dsh-typert-loader validates (package, face: 'host',
 * schemas, model, invocations). The gateway also discovers the @Remote
 * methods from the live FinanceService via SRC markers, so this manifest only
 * upgrades the boundary to strict Zod validation.
 *
 * @module dsh-spark-finance/typert
 */

import {
  financeBackfillProgressSchema,
  financeBalanceViewSchema,
  financeCommunitySyncResultSchema,
  financeLedgerSchema,
  financeOverviewSchema,
  financeSyncStatusSchema,
} from './typert.schemas.ts'

/** Host reflection manifest consumed by @deepseek-ai/dsh-typert-loader. */
export const TYPERT: unknown = {
  package: 'dsh-spark-finance',
  face: 'host',
  schemas: [],
  model: {
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
        ],
        types: [
          { name: 'FinanceBalanceView', declaration: 'export interface FinanceBalanceView { status: FinanceBalanceStatus; updatedAt: number; isAvailable?: boolean; currency?: string; totalMicros?: number; grantedMicros?: number; toppedUpMicros?: number; code?: string; message?: string; }' },
          { name: 'FinanceCommunitySyncResult', declaration: 'export interface FinanceCommunitySyncResult { ok: boolean; source: string; appliedAt?: number; fx: number; requestedProviders: readonly string[]; requestedMissing: readonly string[]; kept: number; droppedDated: number; droppedNonToken: number; droppedNoCost: number; providers: readonly string[]; error?: { message: string }; }' },
          { name: 'FinanceSyncStatus', declaration: 'export interface FinanceSyncStatus { source: string; appliedAt: number; kept: number; providers: readonly string[]; fx: number; }' },
          { name: 'FinanceTokenBuckets', declaration: 'export interface FinanceTokenBuckets { uncachedInputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number; }' },
          { name: 'FinanceHourOfDayRow', declaration: 'export interface FinanceHourOfDayRow { localHour: number; usage: FinanceTokenBuckets; costMicros: number; peakCostMicros: number; flatCostMicros: number; shiftSavingsMicros: number; }' },
          { name: 'FinancePeakValleySplit', declaration: 'export interface FinancePeakValleySplit { peakCostMicros: number; offPeakCostMicros: number; flatCostMicros: number; unclassifiedCostMicros: number; legacyCostMicros: number; shiftSavingsMicros: number; }' },
          { name: 'FinanceBillingMode', declaration: "export type FinanceBillingMode = 'metered' | 'plan';" },
          { name: 'FinanceProviderRow', declaration: 'export interface FinanceProviderRow { provider: string; usage: FinanceTokenBuckets; costMicros: number; modelCount: number; billingMode?: FinanceBillingMode | \"mixed\"; }' },
          { name: 'FinanceLedger', declaration: 'export interface FinanceLedger { generatedAt: number; currency: string; totals: FinanceTokenBuckets; totalCostMicros: number; meteredCostMicros?: number; planEquivalentCostMicros?: number; sessionCount: number; workspaceCount: number; taskCount: number; windowedSinceMs: number | null; hourOfDayWindowStartMs: number; byDay: readonly FinanceDayRow[]; byModel: readonly FinanceModelRow[]; byProvider: readonly FinanceProviderRow[]; byWorkspace: readonly FinanceWorkspaceRow[]; tasks: readonly FinanceTaskRow[]; sessions: readonly FinanceSessionRow[]; byHourOfDay: readonly FinanceHourOfDayRow[]; peakValley: FinancePeakValleySplit; }' },
          { name: 'FinanceOverview', declaration: 'export interface FinanceOverview { balance: FinanceBalanceView; ledger: FinanceLedger; }' },
          { name: 'FinanceBackfillProgress', declaration: 'export interface FinanceBackfillProgress { phase: "idle" | "backfill" | "done"; scanned: number; total: number; rescanned: number; startedAt: number; }' },
        ],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: [
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
      sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 96, column: 3 },
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
      sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 117, column: 3 },
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
      sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 131, column: 3 },
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
      sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 131, column: 3 },
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
          codec: { mode: 'src-json' },
          acceptsUndefined: true,
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-spark-finance/types#FinanceCommunitySyncResult',
        schema: financeCommunitySyncResultSchema,
      },
      sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 378, column: 5 },
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
        schema: financeSyncStatusSchema,
      },
      sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 433, column: 5 },
    },
  ],
}