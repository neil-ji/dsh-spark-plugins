/**
 * `financeUsage` and `financeUsageHourly` session projections:
 * provider-reported token buckets folded by model / UTC day (financeUsage) and
 * by model / UTC hour (financeUsageHourly). Usage chunk + assembled assistant
 * message last-wins rules mirror the token-meter projection so the same step
 * is never double counted.
 *
 * The two units are separate on purpose: the hourly unit is what lets the
 * ledger price each usage hour at its own peak/off-peak rate, and adding it as
 * a NEW unit key (instead of growing `financeUsage` and bumping its
 * `stateVersion`) keeps every existing checkpoint valid — the projection
 * cache discards rows on version mismatch, never migrates them, so a version
 * bump would replay every session log on the next ledger build.
 *
 * @module @deepseek-ai/dsh-spark-finance/projection
 */

import { z } from 'zod'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { addFinanceBuckets, emptyFinanceBuckets, financeModelKey } from './pricing.ts'
import type { FinanceHourlyProjection, FinanceTokenBuckets, FinanceUsageProjection } from './types.ts'

interface UsageSample {
  turn: number
  step: number
  modelKey: string
  day: string
  buckets: FinanceTokenBuckets
}

interface FinanceUsageState {
  currentModel: string | null
  totals: FinanceTokenBuckets
  byModel: Record<string, FinanceTokenBuckets>
  byDay: Record<string, FinanceTokenBuckets>
  last: UsageSample | null
}

interface HourlyUsageSample {
  turn: number
  step: number
  modelKey: string
  hour: string
  buckets: FinanceTokenBuckets
}

interface FinanceHourlyState {
  currentModel: string | null
  byModelHour: Record<string, Record<string, FinanceTokenBuckets>>
  last: HourlyUsageSample | null
}

/**
 * rc.2+（dsh-session-projection）把投影 key 拆成两张表：`SessionProjectionStateMap`（host 折叠状态）与
 * `SessionProjectionMap`（客户端可见值）。finance 的两个单位都是 client-visible，两个表都要声明合并。
 */
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    financeUsage: FinanceUsageState
    financeUsageHourly: FinanceHourlyState
  }
}

const bucketsSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
}).strict()

const projectionSchema = z.object({
  byModel: z.record(z.string(), bucketsSchema),
  byDay: z.record(z.string(), bucketsSchema),
  totals: bucketsSchema,
}).strict()

const hourlySchema = z.object({
  byModelHour: z.record(z.string(), z.record(z.string(), bucketsSchema)),
}).strict()

function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

/** UTC hour key `YYYY-MM-DDTHH` — the granularity the ledger prices peak/off-peak with. */
function hourKey(time: number): string {
  return new Date(time).toISOString().slice(0, 13)
}

/** Extract the provider usage sample from a usage event; null for everything else. */
function usageSampleFromEvent(event: { type: string; data: unknown }): { turn: number; step: number; usage: TokenUsage } | null {
  if (event.type === 'assistant/chunk') {
    const data = event.data as { turn?: number; step?: number; chunk?: { type?: string; usage?: TokenUsage } }
    if (data.chunk?.type === 'usage' && data.chunk.usage !== undefined) {
      return { turn: data.turn ?? -1, step: data.step ?? -1, usage: data.chunk.usage }
    }
  }
  if (event.type === 'assistant/message') {
    const data = event.data as { turn?: number; step?: number; usage?: TokenUsage }
    if (data.usage !== undefined) {
      return { turn: data.turn ?? -1, step: data.step ?? -1, usage: data.usage }
    }
  }
  return null
}

function bucketsFrom(usage: TokenUsage): FinanceTokenBuckets {
  return {
    uncachedInputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens,
  }
}

function bucketsEqual(left: FinanceTokenBuckets, right: FinanceTokenBuckets): boolean {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
    && left.outputTokens === right.outputTokens
}

function isEmpty(buckets: FinanceTokenBuckets): boolean {
  return buckets.uncachedInputTokens === 0
    && buckets.cacheReadTokens === 0
    && buckets.cacheWriteTokens === 0
    && buckets.outputTokens === 0
}

function adjusted(current: FinanceTokenBuckets, previous: FinanceTokenBuckets | undefined, next: FinanceTokenBuckets): FinanceTokenBuckets {
  return addFinanceBuckets(
    previous === undefined ? current : {
      uncachedInputTokens: current.uncachedInputTokens - previous.uncachedInputTokens,
      cacheReadTokens: current.cacheReadTokens - previous.cacheReadTokens,
      cacheWriteTokens: current.cacheWriteTokens - previous.cacheWriteTokens,
      outputTokens: current.outputTokens - previous.outputTokens,
    },
    next,
  )
}

function writeBucket(
  record: Record<string, FinanceTokenBuckets>,
  key: string,
  previous: FinanceTokenBuckets | undefined,
  next: FinanceTokenBuckets,
): Record<string, FinanceTokenBuckets> {
  const value = adjusted(record[key] ?? emptyFinanceBuckets(), previous, next)
  if (isEmpty(value)) {
    const { [key]: _removed, ...rest } = record
    return rest
  }
  return { ...record, [key]: value }
}

/** The `financeUsage` projection unit registered on `ctx.sessionProjections`. */
export const financeUsageProjectionDefinition = {
  key: 'financeUsage',
  stateSchema: z.any(),
  init: () => ({
    currentModel: null,
    totals: emptyFinanceBuckets(),
    byModel: {},
    byDay: {},
    last: null,
  }),
  apply: (state, event) => {
    if (event.type === 'request/header') {
      const modelKey = financeModelKey(event.data.header.config.provider, event.data.header.config.model)
      return state.currentModel === modelKey ? state : { ...state, currentModel: modelKey }
    }

    const sample = usageSampleFromEvent(event)
    if (sample === null) return state
    if (state.currentModel === null) return state
    const { turn, step, usage } = sample
    const buckets = bucketsFrom(usage)
    const previous = state.last !== null && state.last.turn === turn && state.last.step === step
      ? state.last
      : undefined
    if (previous !== undefined
      && previous.modelKey === state.currentModel
      && previous.day === dayKey(event.time)
      && bucketsEqual(previous.buckets, buckets)) {
      return state
    }

    const day = dayKey(event.time)
    return {
      ...state,
      totals: adjusted(state.totals, previous?.buckets, buckets),
      byModel: writeBucket(
        state.byModel,
        state.currentModel,
        previous?.modelKey === state.currentModel ? previous.buckets : undefined,
        buckets,
      ),
      byDay: writeBucket(
        state.byDay,
        day,
        previous?.day === day ? previous.buckets : undefined,
        buckets,
      ),
      last: { turn, step, modelKey: state.currentModel, day, buckets },
    }
  },
  wire: {
    viewSchema: projectionSchema,
    view: (state): FinanceUsageProjection => ({
      byModel: state.byModel,
      byDay: state.byDay,
      totals: state.totals,
    }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'financeUsage', FinanceUsageState>

/**
 * The `financeUsageHourly` projection unit: the same fold as
 * `financeUsage` but keyed by UTC hour instead of day, giving the ledger the
 * per-hour detail it needs for peak/off-peak pricing. Sessions checkpointed
 * before this unit existed simply lack the key and fall back to
 * `financeUsage` totals at the base rate.
 */
export const financeUsageHourlyProjectionDefinition = {
  key: 'financeUsageHourly',
  stateSchema: z.any(),
  init: () => ({
    currentModel: null,
    byModelHour: {},
    last: null,
  }),
  apply: (state, event) => {
    if (event.type === 'request/header') {
      const modelKey = financeModelKey(event.data.header.config.provider, event.data.header.config.model)
      return state.currentModel === modelKey ? state : { ...state, currentModel: modelKey }
    }

    const sample = usageSampleFromEvent(event)
    if (sample === null) return state
    if (state.currentModel === null) return state
    const { turn, step, usage } = sample
    const buckets = bucketsFrom(usage)
    const hour = hourKey(event.time)
    const previous = state.last !== null && state.last.turn === turn && state.last.step === step
      ? state.last
      : undefined
    if (previous !== undefined
      && previous.modelKey === state.currentModel
      && previous.hour === hour
      && bucketsEqual(previous.buckets, buckets)) {
      return state
    }

    return {
      ...state,
      byModelHour: {
        ...state.byModelHour,
        [state.currentModel]: writeBucket(
          state.byModelHour[state.currentModel] ?? {},
          hour,
          previous?.modelKey === state.currentModel && previous?.hour === hour ? previous.buckets : undefined,
          buckets,
        ),
      },
      last: { turn, step, modelKey: state.currentModel, hour, buckets },
    }
  },
  wire: {
    viewSchema: hourlySchema,
    view: (state): FinanceHourlyProjection => ({ byModelHour: state.byModelHour }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'financeUsageHourly', FinanceHourlyState>