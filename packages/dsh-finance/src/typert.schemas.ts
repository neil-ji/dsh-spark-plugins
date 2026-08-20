/**
 * Shared strict boundary schemas for the dsh-finance Typert artifacts.
 * Hand-authored mirror of the @deepseek-ai/dsh-typert-generator output shape;
 * keeps the host reflection and the client Remote contribution on one codec.
 *
 * @module dsh-finance/typert-schemas
 */

import { z } from 'zod'

export const financeTokenBucketsSchema = z.object({
  uncachedInputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  outputTokens: z.number(),
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
    usage: financeTokenBucketsSchema,
    costMicros: z.number(),
    shiftSavingsMicros: z.number().optional().default(0),
  })),
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