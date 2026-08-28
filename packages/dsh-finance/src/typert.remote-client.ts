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
  FinanceLedger,
  FinanceOverview,
} from './types.ts'
import {
  financeBackfillProgressSchema,
  financeBalanceViewSchema,
  financeLedgerSchema,
  financeOverviewSchema,
} from './typert.schemas.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$66696e616e6365 {
    getBalance: () => Promise<RemoteResult<FinanceBalanceView>>
    getLedger: () => Promise<RemoteResult<FinanceLedger>>
    getOverview: () => Promise<RemoteResult<FinanceOverview>>
    getBackfillProgress: () => Promise<RemoteResult<FinanceBackfillProgress>>
  }
  interface TypertRemoteMap {
    'finance/getBalance': () => Promise<RemoteResult<FinanceBalanceView>>
    'finance/getLedger': () => Promise<RemoteResult<FinanceLedger>>
    'finance/getOverview': () => Promise<RemoteResult<FinanceOverview>>
    'finance/getBackfillProgress': () => Promise<RemoteResult<FinanceBackfillProgress>>
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
  ],
}

export default TYPERT_REMOTE