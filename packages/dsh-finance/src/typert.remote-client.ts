/**
 * Generated-style client Remote contribution for dsh-spark-finance, hand-authored to
 * the exact shape @deepseek-ai/dsh-typert-generator emits (see
 * dsh-goal/lib/typert.remote-client.js). The dsh-spark-finance-client browser bundle
 * inlines this artifact, so the browser never resolves dsh-spark-finance at runtime.
 *
 * @module dsh-spark-finance/remote
 */

import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  FinanceBackfillProgress,
  FinanceBalanceView,
  FinanceCommunitySyncResult,
  FinanceLedger,
  FinanceListProvidersResult,
  FinanceOverview,
  FinanceProviderBalance,
  FinanceRefreshBalanceRequest,
  FinanceSyncOptions,
  FinanceSyncStatus,
} from './types.ts'
import {
  financeBackfillProgressSchema,
  financeBalanceViewSchema,
  financeCommunitySyncResultSchema,
  financeLedgerSchema,
  financeListProvidersResultSchema,
  financeOverviewSchema,
  financeProviderBalanceSchema,
  financeRefreshBalanceRequestSchema,
  financeSyncOptionsSchema,
  financeSyncStatusSchema,
} from './typert.schemas.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$66696e616e6365 {
    getBalance: () => Promise<RemoteResult<FinanceBalanceView>>
    getLedger: () => Promise<RemoteResult<FinanceLedger>>
    getOverview: () => Promise<RemoteResult<FinanceOverview>>
    getBackfillProgress: () => Promise<RemoteResult<FinanceBackfillProgress>>
    syncCommunityPrices: (options?: FinanceSyncOptions) => Promise<RemoteResult<FinanceCommunitySyncResult>>
    getSyncStatus: () => Promise<RemoteResult<FinanceSyncStatus | null>>
    listProviders: () => Promise<RemoteResult<FinanceListProvidersResult>>
    refreshBalance: (request: FinanceRefreshBalanceRequest) => Promise<RemoteResult<FinanceProviderBalance>>
  }
  interface TypertRemoteMap {
    'finance/getBalance': () => Promise<RemoteResult<FinanceBalanceView>>
    'finance/getLedger': () => Promise<RemoteResult<FinanceLedger>>
    'finance/getOverview': () => Promise<RemoteResult<FinanceOverview>>
    'finance/getBackfillProgress': () => Promise<RemoteResult<FinanceBackfillProgress>>
    'finance/syncCommunityPrices': (options?: FinanceSyncOptions) => Promise<RemoteResult<FinanceCommunitySyncResult>>
    'finance/getSyncStatus': () => Promise<RemoteResult<FinanceSyncStatus | null>>
    'finance/listProviders': () => Promise<RemoteResult<FinanceListProvidersResult>>
    'finance/refreshBalance': (request: FinanceRefreshBalanceRequest) => Promise<RemoteResult<FinanceProviderBalance>>
  }
  interface TypertRemoteNamespaceMap {
    'finance': TypertRemoteNamespace$66696e616e6365
  }
}

/** The dsh-spark-finance Remote contribution mounted by dsh-spark-finance-client. */
export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: 'dsh-spark-finance',
  descriptors: [
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
        schema: financeSyncStatusSchema.nullable(),
      },
      sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 433, column: 5 },
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
      sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 999, column: 5 },
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
      sourceLocation: { file: 'packages/dsh-finance/src/index.ts', line: 999, column: 5 },
    },
  ],
}

export default TYPERT_REMOTE