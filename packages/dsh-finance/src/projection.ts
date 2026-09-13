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
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { addFinanceBuckets, emptyFinanceBuckets, financeModelKey } from './pricing.ts'
import { FINANCE_CONTEXT_BOUNDARIES } from './types.ts'
import type {
  FinanceContextBucket,
  FinanceContextProjection,
  FinanceHourlyProjection,
  FinanceRateProjection,
  FinanceRateStats,
  FinanceTokenBuckets,
  FinanceUsageProjection,
} from './types.ts'

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
    financeRate: FinanceRateState
    financeContext: FinanceContextState
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

/* ───────────────── 速率（P1-B）：每模型的解码时长 / 输出 token / TTFT ───────────────── */

const EMPTY_RATE: FinanceRateStats = { decodeMs: 0, decodeTokens: 0, ttftMs: 0, ttftSteps: 0 }

interface FinanceRateState {
  currentModel: string | null
  byModel: Record<string, FinanceRateStats>
  /**
   * 打开中的步：与平台 `sessionStats` 同形，只是额外记住这一步属于哪个模型
   * —— 速率必须按模型分桶，全会话合计答不了"哪个厂商的这个模型更快"。
   */
  open: { turn: number; step: number; startTime: number; firstTokenTime: number | null; modelKey: string } | null
}

/**
 * 首个可见 delta（text / reasoning）——就是"开始出字"的那一刻。
 * 本仓库钉的平台版本没有 `assistant/attempt` 事件，所以首 token 从
 * `assistant/chunk` 的 delta 流里判定（新平台的 `sessionStats` 折叠的是同一件事）。
 */
function isVisibleDelta(chunk: StreamChunk): boolean {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text !== ''
  return false
}

/** 使用量事件里上报的输出 token；缺失/非法一律 null（不拿 0 冒充）。 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

const rateSchema = z.object({
  byModel: z.record(z.string(), z.object({
    decodeMs: z.number().nonnegative(),
    decodeTokens: z.number().nonnegative(),
    ttftMs: z.number().nonnegative(),
    ttftSteps: z.number().nonnegative(),
  }).strict()),
}).strict()

/**
 * The `financeRate` projection unit.
 *
 * 与平台 `sessionStats` 完全同一套事件语义（`step/start` → 首个非空 delta →
 * `assistant/message`；decode 只统计同时报了 output token 的步；被取消的步不计时），
 * 差别只有一个：按 `request/header` 的模型键分桶。这样"同一模型换供应商谁更快"
 * 才有数据支撑，而不是把整个会话的平均速率安到每个模型头上。
 */
export const financeRateProjectionDefinition = {
  key: 'financeRate',
  stateSchema: z.any(),
  init: () => ({
    currentModel: null,
    byModel: {},
    open: null,
  }),
  apply: (state, event) => {
    switch (event.type) {
      case 'request/header': {
        const modelKey = financeModelKey(event.data.header.config.provider, event.data.header.config.model)
        return state.currentModel === modelKey ? state : { ...state, currentModel: modelKey }
      }
      case 'step/start': {
        if (state.currentModel === null) return state
        return {
          ...state,
          open: {
            turn: event.data.turn,
            step: event.data.step,
            startTime: event.time,
            firstTokenTime: null,
            modelKey: state.currentModel,
          },
        }
      }
      case 'assistant/chunk': {
        const open = state.open
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        if (open.firstTokenTime !== null) return state
        if (!isVisibleDelta(event.data.chunk)) return state
        return { ...state, open: { ...open, firstTokenTime: event.time } }
      }
      case 'assistant/message': {
        const open = state.open
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        const firstToken = open.firstTokenTime
        if (firstToken === null) return { ...state, open: null }
        const current = state.byModel[open.modelKey] ?? EMPTY_RATE
        const outputTokens = usageOutputTokens(event.data.usage)
        const next: FinanceRateStats = {
          decodeMs: current.decodeMs + (outputTokens === null ? 0 : Math.max(0, event.time - firstToken)),
          decodeTokens: current.decodeTokens + (outputTokens ?? 0),
          ttftMs: current.ttftMs + Math.max(0, firstToken - open.startTime),
          ttftSteps: current.ttftSteps + 1,
        }
        return {
          ...state,
          byModel: { ...state.byModel, [open.modelKey]: next },
          open: null,
        }
      }
      case 'step/end':
        return state.open === null ? state : { ...state, open: null }
      default:
        return state
    }
  },
  wire: {
    viewSchema: rateSchema,
    view: (state): FinanceRateProjection => ({ byModel: state.byModel }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'financeRate', FinanceRateState>

/* ───────────────── 上下文长度分布（P2）：阶梯价与"拆分会话"的分析输入 ───────────────── */

interface FinanceContextState {
  currentModel: string | null
  /** 每模型一份定长桶数组（`FINANCE_CONTEXT_BOUNDARIES.length + 1` 个）。 */
  byModel: Record<string, FinanceContextBucket[]>
  /** 上一步样本（用于同一步 last-wins 替换；跨模型的同一步也会被正确撤销）。 */
  last: { turn: number; step: number; modelKey: string; bucketIndex: number; buckets: FinanceTokenBuckets } | null
}

/** 空桶数组：边界 + 一个无上界的兜底桶。 */
function emptyContextBuckets(): FinanceContextBucket[] {
  return [
    ...FINANCE_CONTEXT_BOUNDARIES.map((bound) => ({ maxPromptTokens: bound, usage: emptyFinanceBuckets(), steps: 0 })),
    { maxPromptTokens: null, usage: emptyFinanceBuckets(), steps: 0 },
  ]
}

/** 该 prompt 长度落在哪个桶：第一个 `prompt <= bound` 的边界，否则兜底桶。 */
function contextBucketIndex(promptTokens: number): number {
  for (let index = 0; index < FINANCE_CONTEXT_BOUNDARIES.length; index += 1) {
    if (promptTokens <= FINANCE_CONTEXT_BOUNDARIES[index]) return index
  }
  return FINANCE_CONTEXT_BOUNDARIES.length
}

function subtractBuckets(left: FinanceTokenBuckets, right: FinanceTokenBuckets): FinanceTokenBuckets {
  return {
    uncachedInputTokens: Math.max(0, left.uncachedInputTokens - right.uncachedInputTokens),
    cacheReadTokens: Math.max(0, left.cacheReadTokens - right.cacheReadTokens),
    cacheWriteTokens: Math.max(0, left.cacheWriteTokens - right.cacheWriteTokens),
    outputTokens: Math.max(0, left.outputTokens - right.outputTokens),
  }
}

/** 把 `delta`（+1 / -1，表示写入或撤销）应用到某个桶上。 */
function bumpContextBucket(
  buckets: readonly FinanceContextBucket[],
  index: number,
  sample: FinanceTokenBuckets,
  delta: 1 | -1,
): FinanceContextBucket[] {
  return buckets.map((bucket, at) => {
    if (at !== index) return bucket
    return {
      maxPromptTokens: bucket.maxPromptTokens,
      usage: delta === 1 ? addFinanceBuckets(bucket.usage, sample) : subtractBuckets(bucket.usage, sample),
      steps: Math.max(0, bucket.steps + delta),
    }
  })
}

function contextBucketsEmpty(buckets: readonly FinanceContextBucket[]): boolean {
  return buckets.every((bucket) => bucket.steps === 0 && isEmpty(bucket.usage))
}

const contextSchema = z.object({
  byModel: z.record(z.string(), z.array(z.object({
    maxPromptTokens: z.number().nullable(),
    usage: bucketsSchema,
    steps: z.number().int().nonnegative(),
  }).strict())),
}).strict()

/**
 * The `financeContext` projection unit.
 *
 * 记账本**没有**的东西：每一步的 prompt 有多长。阶梯价（有的厂商按上下文长度分档）
 * 与"把长会话拆开能省多少"都只能从这里算，而 `financeUsage`/`financeUsageHourly`
 * 已经按模型×小时聚合掉了这层信息。
 *
 * forward-only：只有装了本版本的会话才有该键；旧会话缺席时相关卡片不显示该模型。
 */
export const financeContextProjectionDefinition = {
  key: 'financeContext',
  stateSchema: z.any(),
  init: () => ({
    currentModel: null,
    byModel: {},
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
    const promptTokens = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
    const bucketIndex = contextBucketIndex(promptTokens)
    const previous = state.last !== null && state.last.turn === turn && state.last.step === step
      ? state.last
      : undefined
    if (previous !== undefined
      && previous.modelKey === state.currentModel
      && previous.bucketIndex === bucketIndex
      && bucketsEqual(previous.buckets, buckets)) {
      return state
    }

    // 同一步的旧样本先撤销（旧样本可能属于另一个模型），保证一步只落一个桶。
    const byModel: Record<string, FinanceContextBucket[]> = { ...state.byModel }
    if (previous !== undefined) {
      const previousBuckets = byModel[previous.modelKey] ?? emptyContextBuckets()
      const restored = bumpContextBucket(previousBuckets, previous.bucketIndex, previous.buckets, -1)
      if (contextBucketsEmpty(restored)) delete byModel[previous.modelKey]
      else byModel[previous.modelKey] = restored
    }
    const current = byModel[state.currentModel] ?? emptyContextBuckets()
    byModel[state.currentModel] = bumpContextBucket(current, bucketIndex, buckets, 1)

    return {
      ...state,
      byModel,
      last: { turn, step, modelKey: state.currentModel, bucketIndex, buckets },
    }
  },
  wire: {
    viewSchema: contextSchema,
    view: (state): FinanceContextProjection => ({ byModel: state.byModel }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'financeContext', FinanceContextState>