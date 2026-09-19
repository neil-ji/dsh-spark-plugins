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
import { addFinanceBuckets, emptyFinanceBuckets, financeModelKey, financeProviderOf } from './pricing.ts'
import { classifyQuotaFailure, quotaEpisodeKey } from './quota.ts'
import type { QuotaFailureLike } from './quota.ts'
import { FINANCE_CONTEXT_BOUNDARIES } from './types.ts'
import type {
  FinanceContextBucket,
  FinanceContextProjection,
  FinanceHourlyProjection,
  FinanceQuotaEpisodeRow,
  FinanceQuotaProjection,
  FinanceQuotaWindow,
  FinanceRateHourlyProjection,
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
/**
 * 窗口归因 Card 的时长口径：每模型 × UTC 小时的速率样本。
 * 归属小时以 `step/start` 时刻为准（decode 跨小时时整步归到开始那一小时）。
 */
interface FinanceRateHourlyState {
  currentModel: string | null
  byModelHour: Record<string, Record<string, FinanceRateStats>>
  open: {
    turn: number
    step: number
    startTime: number
    firstTokenTime: number | null
    modelKey: string
    hour: string
  } | null
}

interface FinanceQuotaState {
  /** 归属用：`turn/end` 不带 provider，只能靠最近的 `request/header`。 */
  currentModel: string | null
  episodes: FinanceQuotaEpisodeRow[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    financeUsage: FinanceUsageState
    financeUsageHourly: FinanceHourlyState
    financeRate: FinanceRateState
    financeContext: FinanceContextState
    /** SPEC §10：额度触达 episode 的 host 折叠状态。 */
    financeQuota: FinanceQuotaState
    /** 窗口归因：每模型 × UTC 小时的速率样本。 */
    financeRateHourly: FinanceRateHourlyState
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
 * 首个可见 delta（text / reasoning）——0.1.2 语义：delta 以 `assistant/chunk`
 * **会话事件**出现，投影能看到。
 */
function isVisibleDelta(chunk: StreamChunk): boolean {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text !== ''
  return false
}

/** 投影 `apply` 收到的事件的最小面（只做字符串判别，形状按平台代次宽松处理）。 */
interface CommittedEvent {
  type: string
  /** 事件时刻（epoch ms）—— `financeQuota` 用它做 episode 的第一/最后时刻。 */
  time: number
  data?: unknown
}

/**
 * 首个 token 的时刻判两代平台（**这是 2026-09-17 那个"输出速率没数据"的根因**）：
 *
 *  - 0.1.2（本仓库 pin 的版本）：delta 是会话事件 `assistant/chunk`；
 *  - 0.1.5+（真宿主实测 0.1.5-rc.1）：整条流内嵌进 settlement 事件
 *    （`assistant/message.stream` / `assistant/attempt.stream`），日志里**根本不再有**
 *    `assistant/chunk`，投影也就一个 delta 都收不到。
 *
 * 只认 chunk 的折叠在 0.1.5 宿主上 `byModel` 恒为 `{}`，面板于是永远显示 `—`
 * （真宿主 session_projcache 实测：装了该单元的会话全部 `byModel:{}`）。
 *
 * 语义按平台 `assistantStreamFirstTokenTime`（= `isTokenDelta`）逐字对齐，但**不直接
 * import** 它：0.1.2 的 dsh-llm 没有这个导出，具名 import 会在宿主加载期直接
 * SyntaxError。内嵌记录既可能是原始 `{type:'chunk',time,chunk}`，也可能是打包行
 * （`text-chunks` / `reasoning-chunks` / `tool-call-chunks`），成员时间按 `time0 + Σdt` 还原。
 */
function isTokenDeltaChunk(chunk: unknown): boolean {
  if (typeof chunk !== 'object' || chunk === null) return false
  const candidate = chunk as { type?: unknown; text?: unknown; argumentsDelta?: unknown; name?: unknown }
  switch (candidate.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return candidate.text !== ''
    case 'tool-call-delta':
      return candidate.argumentsDelta !== '' || candidate.name !== undefined
    default:
      return false
  }
}

/**
 * 内嵌流里第一个 token 的时刻；流缺席/为空/形状不认识一律 null（不拿 0 冒充）。
 */
function firstTokenTimeFromStream(stream: unknown): number | null {
  if (!Array.isArray(stream)) return null
  for (const record of stream) {
    if (typeof record !== 'object' || record === null) continue
    const entry = record as {
      type?: unknown
      time?: unknown
      chunk?: unknown
      time0?: unknown
      dt?: unknown
      texts?: unknown
      args?: unknown
      name?: unknown
    }
    if (entry.type === 'chunk') {
      if (isTokenDeltaChunk(entry.chunk) && typeof entry.time === 'number') return entry.time
      continue
    }
    const fragments = entry.type === 'tool-call-chunks'
      ? entry.args
      : entry.type === 'text-chunks' || entry.type === 'reasoning-chunks' ? entry.texts : null
    if (!Array.isArray(fragments) || typeof entry.time0 !== 'number') continue
    // 带名字的 tool-call 打包行从第一个成员起算（平台 isTokenDelta 的同一规则）。
    if (entry.type === 'tool-call-chunks' && entry.name !== undefined) return entry.time0
    const gaps = Array.isArray(entry.dt) ? entry.dt : []
    let time = entry.time0
    for (let index = 0; index < fragments.length; index += 1) {
      if (index > 0) {
        const gap = gaps[index - 1]
        time += typeof gap === 'number' ? gap : 0
      }
      if (fragments[index] !== '') return time
    }
  }
  return null
}

/**
 * 0.1.5 的 `assistant/attempt`：提交不了 message 的失败/重试尝试。它只用来把
 * 首个 token 的时刻补进打开中的步（与平台 `sessionStats` 同规则）；没有 output token
 * 的尝试不会产生任何速率样本。
 */
function assistantAttempt(event: CommittedEvent): { turn: number | undefined; step: number | undefined; stream: unknown } | null {
  if (event.type !== 'assistant/attempt') return null
  const data = event.data as { turn?: unknown; step?: unknown; stream?: unknown } | undefined
  if (typeof data !== 'object' || data === null) return null
  return {
    turn: typeof data.turn === 'number' ? data.turn : undefined,
    step: typeof data.step === 'number' ? data.step : undefined,
    stream: data.stream,
  }
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
 * 与平台 `sessionStats` 完全同一套事件语义（`step/start` → 首个 token →
 * `assistant/message`；decode 只统计同时报了 output token 的步；被取消的步不计时），
 * 差别只有一个：按 `request/header` 的模型键分桶。这样"同一模型换供应商谁更快"
 * 才有数据支撑，而不是把整个会话的平均速率安到每个模型头上。
 *
 * 首个 token 跨两代平台取值（见 `firstTokenTimeFromStream`）：0.1.2 走
 * `assistant/chunk` 会话事件，0.1.5+ 走 settlement 事件内嵌的 `stream`。
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
    // 0.1.5 的失败/重试尝试只有内嵌流：先把首个 token 的时刻补进打开中的步。
    const attempt = assistantAttempt(event)
    if (attempt !== null) {
      const open = state.open
      if (open === null || open.firstTokenTime !== null) return state
      if (open.turn !== attempt.turn || open.step !== attempt.step) return state
      const first = firstTokenTimeFromStream(attempt.stream)
      if (first === null) return state
      return { ...state, open: { ...open, firstTokenTime: first } }
    }

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
        // 0.1.5+：消息自带整条流，首 token 直接从它里面取（chunk 事件已不存在）。
        const firstToken = open.firstTokenTime
          ?? firstTokenTimeFromStream((event.data as { stream?: unknown }).stream)
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
  // v2（2026-09-17 修 bug）：v1 在 0.1.5 宿主上恒为空（只认 assistant/chunk），
  // 落盘的行是**错的值**而不是缺的值 —— 追加新键救不了它，必须让版本门把旧行丢掉重折。
  // 代价是每会话一次全量重放（回填进度条覆盖它），一次性。
  stateVersion: 2,
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
/* ───────────────── 额度触达（SPEC §10，INV-10） ───────────────── */

/**
 * 每个会话最多保留的 episode 数。
 *
 * 有界是必须的：投影值会随会话日志 checkpoint 落盘，一个长期会话若被反复触达
 * 会无限增长。50 条足以覆盖"这个会话里被挡过哪些次"，且落盘体积可控。
 * 超出后**保留最新的**（诊断价值在近期，不在陈年旧账）。
 */
const MAX_QUOTA_EPISODES = 50

const FINANCE_QUOTA_WINDOWS = ['5h', 'week', 'month', 'balance', 'trial', 'unknown'] as const

const quotaSchema = z.object({
  episodes: z.array(z.object({
    provider: z.string(),
    modelKey: z.string(),
    window: z.enum(FINANCE_QUOTA_WINDOWS),
    firstAtMs: z.number().nonnegative(),
    lastAtMs: z.number().nonnegative(),
    attempts: z.number().int().nonnegative(),
    final: z.boolean(),
    resetAtMs: z.number().nonnegative().nullable(),
    resetRaw: z.string().nullable(),
    vendorCode: z.string().nullable(),
  }).strict()),
}).strict()

/** 从失败事件里取出 `{ failure, provider }`；非失败事件返回 null。 */
function quotaFailureOf(event: CommittedEvent): { failure: QuotaFailureLike; provider: string | null } | null {
  const data = event.data as Record<string, unknown> | undefined
  if (data === null || typeof data !== 'object') return null
  // 终态：整轮失败。
  if (event.type === 'turn/end') {
    const reason = data.reason as { kind?: unknown; error?: unknown } | undefined
    if (reason?.kind !== 'error' || reason.error === null || typeof reason.error !== 'object') return null
    return { failure: reason.error as QuotaFailureLike, provider: null }
  }
  // 过程：一次尝试失败、即将重试。自带 provider，比 turn/end 更可靠。
  if (event.type === 'llm/retry') {
    const failure = data.failure
    if (failure === null || typeof failure !== 'object') return null
    const provider = typeof data.provider === 'string' ? data.provider : null
    return { failure: failure as QuotaFailureLike, provider }
  }
  return null
}

/**
 * 把一次判定结果并进 episode 列表（**去重**）。
 *
 * 实测同一次断供 = `n× llm/retry + 1× turn/end`（典型 5+1），事件数比真实断供
 * 多约 6 倍。合并键见 `quotaEpisodeKey`；命中已有条目则累加 `attempts`、
 * 推进 `lastAtMs`、并合并 `final` / reset 信息（后到的补全先到的）。
 *
 * 导出仅供测试直接调用（纯函数，不改原数组）。
 */
export function mergeQuotaEpisode(
  episodes: readonly FinanceQuotaEpisodeRow[],
  modelKey: string,
  entry: { window: FinanceQuotaWindow; final: boolean; resetAtMs: number | null; resetRaw: string | null; vendorCode: string | null },
  atMs: number,
  message: string,
): FinanceQuotaEpisodeRow[] {
  const key = quotaEpisodeKey(modelKey, {
    kind: 'quota',
    window: entry.window,
    vendorCode: entry.vendorCode,
    resetAtMs: entry.resetAtMs,
    resetRaw: entry.resetRaw,
  }, message)
  const index = episodes.findIndex(existing => quotaEpisodeKey(existing.modelKey, {
    kind: 'quota',
    window: existing.window,
    vendorCode: existing.vendorCode,
    resetAtMs: existing.resetAtMs,
    resetRaw: existing.resetRaw,
  }, '') === key)

  if (index >= 0) {
    const previous = episodes[index]
    const merged: FinanceQuotaEpisodeRow = {
      ...previous,
      lastAtMs: Math.max(previous.lastAtMs, atMs),
      attempts: previous.attempts + 1,
      final: previous.final || entry.final,
      // 后到的 reset 信息补全先到的缺失（终态那条通常信息最全）。
      resetAtMs: previous.resetAtMs ?? entry.resetAtMs,
      resetRaw: previous.resetRaw ?? entry.resetRaw,
      vendorCode: previous.vendorCode ?? entry.vendorCode,
    }
    const next = [...episodes]
    next[index] = merged
    return next
  }

  const provider = financeProviderOf(modelKey)
  const created: FinanceQuotaEpisodeRow = {
    provider,
    modelKey,
    window: entry.window,
    firstAtMs: atMs,
    lastAtMs: atMs,
    attempts: 1,
    final: entry.final,
    resetAtMs: entry.resetAtMs,
    resetRaw: entry.resetRaw,
    vendorCode: entry.vendorCode,
  }
  const next = [...episodes, created]
  // 有界：超出时丢最旧的（诊断价值在近期）。
  return next.length > MAX_QUOTA_EPISODES
    ? next.slice(next.length - MAX_QUOTA_EPISODES)
    : next
}

/**
 * The `financeQuota` projection unit（SPEC §10.4）。
 *
 * **新 key、新 unit**：绝不动既有 `financeUsage` / `financeUsageHourly` /
 * `financeRate` / `financeContext` 的 `stateVersion` —— 投影缓存对版本不匹配是
 * **丢弃而非迁移**，一次 bump 会让每个会话全量重放（`projection.ts` 顶部已有该先例）。
 * 代价是旧会话没有该键 → 优雅退化为"无触达"（与 `financeRate` 同款 forward-only 边界）。
 *
 * 只折叠 `kind === 'quota'`：`capacity` / `throttle` / `other` 一律不写状态（INV-10 的
 * 前置条件——账本里不出现任何非额度噪声）。
 */
export const financeQuotaProjectionDefinition = {
  key: 'financeQuota',
  stateSchema: z.any(),
  init: (): FinanceQuotaState => ({ currentModel: null, episodes: [] }),
  apply: (state, event) => {
    if (event.type === 'request/header') {
      const modelKey = financeModelKey(event.data.header.config.provider, event.data.header.config.model)
      return state.currentModel === modelKey ? state : { ...state, currentModel: modelKey }
    }

    const hit = quotaFailureOf(event)
    if (hit === null) return state
    const result = classifyQuotaFailure(hit.failure, event.time)
    // 只有真正的额度触达进账本；容量繁忙/限流连状态都不写。
    if (result.kind !== 'quota') return state

    const message = typeof hit.failure.message === 'string' ? hit.failure.message : ''
    // 归属走 `request/header` 维护的 currentModel —— 与其余 finance 投影同一口径。
    // `llm/retry` 自带 provider 但**不带 model**，只有 header 能给完整 `provider/model`；
    // 两者都缺时放弃记这条（不造一个拼不出模型的假键）。
    const modelKey = state.currentModel
    if (modelKey === null || modelKey === '') return state

    return {
      ...state,
      episodes: mergeQuotaEpisode(state.episodes, modelKey, {
        window: result.window,
        final: event.type === 'turn/end',
        resetAtMs: result.resetAtMs,
        resetRaw: result.resetRaw,
        vendorCode: result.vendorCode,
      }, event.time, message),
    }
  },
  wire: {
    viewSchema: quotaSchema,
    view: (state): FinanceQuotaProjection => ({ episodes: state.episodes }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'financeQuota', FinanceQuotaState>

/* ───────────────── 每模型 × 小时的速率（窗口归因 Card 的时长来源） ───────────────── */


const rateHourlySchema = z.object({
  byModelHour: z.record(z.string(), z.record(z.string(), z.object({
    decodeMs: z.number().nonnegative(),
    decodeTokens: z.number().nonnegative(),
    ttftMs: z.number().nonnegative(),
    ttftSteps: z.number().nonnegative(),
  }).strict())),
}).strict()

/**
 * The `financeRateHourly` projection unit（窗口归因 Card 的时长口径）。
 *
 * 为什么不复用 `financeRate`：那个单元只有 `byModel`（无时间维度），
 * 于是"这 5 小时里解码了多久"根本算不出来 —— 只能给会话总量。
 * 这里加**小时维度**，让任意窗口（5h / 周 / 月）都能切出模型级时长。
 *
 * 独立 unit 的理由与 `financeUsageHourly` 完全一致：给既有单元加维度就必须 bump
 * `stateVersion`，而缓存对版本不匹配是丢弃而非迁移 —— 一次 bump = 每个会话全量重放。
 * 新 key 零代价，旧会话缺键时优雅退化（时长列不显示）。
 *
 * 事件语义与 `financeRate` 逐条相同（同一套 step/首个 token/assistant/message 规则），
 * 唯一差别是落桶多一个 UTC 小时维度。
 */
export const financeRateHourlyProjectionDefinition = {
  key: 'financeRateHourly',
  stateSchema: z.any(),
  init: (): FinanceRateHourlyState => ({ currentModel: null, byModelHour: {}, open: null }),
  apply: (state, event) => {
    const attempt = assistantAttempt(event)
    if (attempt !== null) {
      const open = state.open
      if (open === null || open.firstTokenTime !== null) return state
      if (open.turn !== attempt.turn || open.step !== attempt.step) return state
      const first = firstTokenTimeFromStream(attempt.stream)
      if (first === null) return state
      return { ...state, open: { ...open, firstTokenTime: first } }
    }

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
            hour: hourKey(event.time),
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
          ?? firstTokenTimeFromStream((event.data as { stream?: unknown }).stream)
        if (firstToken === null) return { ...state, open: null }
        const byHour = state.byModelHour[open.modelKey] ?? {}
        const current = byHour[open.hour] ?? EMPTY_RATE
        const outputTokens = usageOutputTokens(event.data.usage)
        const next: FinanceRateStats = {
          decodeMs: current.decodeMs + (outputTokens === null ? 0 : Math.max(0, event.time - firstToken)),
          decodeTokens: current.decodeTokens + (outputTokens ?? 0),
          ttftMs: current.ttftMs + Math.max(0, firstToken - open.startTime),
          ttftSteps: current.ttftSteps + 1,
        }
        return {
          ...state,
          byModelHour: { ...state.byModelHour, [open.modelKey]: { ...byHour, [open.hour]: next } },
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
    viewSchema: rateHourlySchema,
    view: (state): FinanceRateHourlyProjection => ({ byModelHour: state.byModelHour }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'financeRateHourly', FinanceRateHourlyState>
