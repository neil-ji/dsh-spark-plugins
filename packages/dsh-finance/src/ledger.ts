/**
 * Cross-session ledger aggregation over session projection checkpoints.
 * Balance is not fetched here; the caller composes balance + ledger into an
 * overview so one failing upstream never hides the other.
 *
 * Usage is read from the cached projection cut only, in priority order:
 *
 * 1. **financeUsageHourly** (per model × UTC hour) — the exact path: every
 *    hour is priced at its own peak/off-peak rate, so session, model, task,
 *    workspace, and day rows all carry time-of-day-correct costs.
 * 2. **financeUsage** (per model / per day totals, no hour detail) — sessions
 *    checkpointed before the hourly unit existed. Priced at each model's
 *    era-resolved base (off-peak) rate at session creation time; day rows stay
 *    a default-rate display trend (no hour split to do better).
 * 3. **tokenUsage** (harness core totals, checkpointed for every session
 *    including ones persisted before this plugin existed) — priced at the flat
 *    `defaultPrice`.
 *
 * This keeps the build O(session count) with zero event-log replay — replaying
 * every session's log on each build cost minutes because the projection cache
 * write-back cannot persist for sessions that predate the financeUsage unit.
 *
 * @module @deepseek-ai/dsh-spark-finance/ledger
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
// Type-only: merges the `title` projection key into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-session-title/types'
import type {} from '@deepseek-ai/dsh-workspace'
import { inspectPersistenceSession, listPersistenceSnapshots } from './session-source.ts'

/**
 * 全流程进度加权（0–100）：回填重放段占 0–70，账本冷聚合段占 70–100。
 * 权重按实测耗时比例估的常数——回填（逐会话重放+写盘）通常比聚合读略贵。
 */
const BACKFILL_WEIGHT = 70
const AGGREGATE_WEIGHT = 30

import {
  addFinanceBuckets,
  emptyFinanceBuckets,
  financeBaseCostMicros,
  financeBillingMode,
  financeBucketCostMicros,
  financeEntryFor,
  financeHourTime,
  financeModelOf,
  financeProviderOf,
  financeRateAt,
  financeWindowedSince,
  financeWindowInfo,
} from './pricing.ts'
import type {
  FinanceBackfillSink,
  FinanceBillingMode,
  FinanceConfig,
  FinanceDayRow,
  FinanceHourOfDayRow,
  FinanceHourlyProjection,
  FinanceLedger,
  FinanceModelRow,
  FinancePeakValleySplit,
  FinanceProviderRow,
  FinanceRescanResult,
  FinanceSessionRow,
  FinanceTaskRow,
  FinanceTokenBuckets,
  FinanceUnreadableSessionRow,
  FinanceContextBucket,
  FinanceContextProjection,
  FinanceQuotaEpisodeRow,
  FinanceQuotaProjection,
  FinanceQuotaProviderRow,
  FinanceQuotaSummary,
  FinanceQuotaWindow,
  FinanceQuotaWindowModelRow,
  FinanceQuotaWindowSpan,
  FinanceQuotaWindowSummary,
  FinanceRateHourlyProjection,
  FinanceRateProjection,
  FinanceRateStats,
  FinanceUsageProjection,
  FinanceWorkspaceRow,
} from './types.ts'

const UNASSIGNED_WORKSPACE_ID = '__unassigned__'
const UNASSIGNED_WORKSPACE_TITLE = 'Unassigned'

interface SessionRecord {
  row: FinanceSessionRow
  hourly: boolean
  legacy: boolean
  byModel: Record<string, FinanceTokenBuckets>
  byDay: Record<string, FinanceTokenBuckets>
  /** Exact per-day costs; null on the fallback path. */
  byDayExactCost: Record<string, number> | null
  /** Per-model costs (exact per-hour, or base-rate on the fallback path). */
  modelCosts: Record<string, number>
  /** Per-model × UTC hour buckets, empty on the fallback path. */
  byModelHour: Record<string, Record<string, FinanceTokenBuckets>>
  /** P1-B：每模型速率样本（旧会话为空）。 */
  rate: Record<string, FinanceRateStats>
  /** P2：每模型上下文长度分布（旧会话为空）。 */
  context: Record<string, readonly FinanceContextBucket[]>
  /** SPEC §10：额度触达 episode（旧会话为空数组）。 */
  quota: readonly FinanceQuotaEpisodeRow[]
  /** 窗口归因：每模型 × UTC 小时速率样本（旧会话为空对象）。 */
  rateHourly: Record<string, Record<string, FinanceRateStats>>
}

interface SessionProjectionRead {
  usage: FinanceTokenBuckets
  byModel: Record<string, FinanceTokenBuckets>
  byDay: Record<string, FinanceTokenBuckets>
  byModelHour: Record<string, Record<string, FinanceTokenBuckets>>
  /** P1-B：每模型速率样本；没有该投影键的会话（旧会话）为空。 */
  rate: Record<string, FinanceRateStats>
  /** P2：每模型的上下文长度分布；旧会话为空数组。 */
  context: Record<string, readonly FinanceContextBucket[]>
  /** SPEC §10：额度触达 episode；旧会话（无该投影键）为空数组。 */
  quota: readonly FinanceQuotaEpisodeRow[]
  /** 窗口归因：每模型 × UTC 小时的速率样本；旧会话为空对象。 */
  rateHourly: Record<string, Record<string, FinanceRateStats>>
  title: string | null
}

/**
 * Extract usage from one projection cut. financeUsageHourly wins (per-model
 * per-hour split), then financeUsage (per-model / per-day totals), then the
 * harness core tokenUsage totals — structurally identical buckets that the
 * token-meter checkpointed for every session. Sessions with neither read as
 * empty.
 */
function extractProjection(values: Partial<SessionProjectionMap>, title: string | null): SessionProjectionRead {
  // 速率是独立单元：无论用量走哪条腿，它都单独读（旧会话缺该键 -> 空对象）。
  const rate = (values.financeRate as FinanceRateProjection | undefined)?.byModel ?? {}
  const context = (values.financeContext as FinanceContextProjection | undefined)?.byModel ?? {}
  // 额度触达是独立单元：与用量走哪条腿无关，永远单独读（旧会话缺该键 -> 空数组）。
  const quota = (values.financeQuota as FinanceQuotaProjection | undefined)?.episodes ?? []
  // 窗口归因的时长口径，同样独立读（旧会话缺该键 -> 空对象，Card 不显示时长）。
  const rateHourly = (values.financeRateHourly as FinanceRateHourlyProjection | undefined)?.byModelHour ?? {}
  const hourly = values.financeUsageHourly as FinanceHourlyProjection | undefined
  if (hourly !== undefined) {
    const byModelHour = hourly.byModelHour
    let usage = emptyFinanceBuckets()
    const byModel: Record<string, FinanceTokenBuckets> = {}
    const byDay: Record<string, FinanceTokenBuckets> = {}
    for (const [modelKey, byHour] of Object.entries(byModelHour)) {
      let modelTotals = emptyFinanceBuckets()
      for (const [hour, buckets] of Object.entries(byHour)) {
        modelTotals = addFinanceBuckets(modelTotals, buckets)
        const day = hour.slice(0, 10)
        byDay[day] = addFinanceBuckets(byDay[day] ?? emptyFinanceBuckets(), buckets)
      }
      byModel[modelKey] = modelTotals
      usage = addFinanceBuckets(usage, modelTotals)
    }
    return { usage, byModel, byDay, byModelHour, rate, context, quota, rateHourly, title }
  }
  const finance = values.financeUsage as FinanceUsageProjection | undefined
  if (finance !== undefined) {
    return { usage: finance.totals, byModel: finance.byModel, byDay: finance.byDay, byModelHour: {}, rate, context, quota, rateHourly, title }
  }
  const token = values.tokenUsage
  if (token !== undefined) {
    return { usage: token, byModel: {}, byDay: {}, byModelHour: {}, rate, context, quota, rateHourly, title }
  }
  return { usage: emptyFinanceBuckets(), byModel: {}, byDay: {}, byModelHour: {}, rate, context, quota, rateHourly, title }
}

/**
 * 账本必须拿到的"新腿"投影键。
 *
 * 缓存切面是**按行**给的：某个键的行缺席、或被版本门（stateVersion 不匹配）跳过时，
 * 只要还有别的键有值，`cachedSnapshot` 照样返回一个切面 —— 于是 `extractProjection`
 * 只能读到空对象，面板永远显示 `—`。
 *
 * 2026-09-17 修 bug（P1-B 速率列没数据）的两条腿都要在这里点名：
 * `financeRate` 的 v1 行在 0.1.5 宿主上恒为空（只认 assistant/chunk，见 projection.ts），
 * 版本门会丢弃它们；不点名的会话就会一直用"错但存在"的旧值渲染。
 */
const REQUIRED_PROJECTION_KEYS = ['financeRate', 'financeContext'] as const

/** 缓存切面是否真的带齐了账本要的新腿（缺一个就退回 coldSnapshot 重折）。 */
function hasRequiredProjections(values: Partial<SessionProjectionMap>): boolean {
  return REQUIRED_PROJECTION_KEYS.every((key) => values[key] !== undefined)
}

async function readProjection(ctx: Context, header: SessionHeader, signal?: AbortSignal): Promise<SessionProjectionRead> {
  // 0.1.2: the cache identity needs the session's inherited-event count, which
  // only persistence metadata carries — inspect once, then cache-first fold.
  // `inspectPersistenceSession` maps both persistence API generations (0.1.2
  // `inspect` / 0.1.5 read handle) onto this one shape.
  const inspection = await inspectPersistenceSession(ctx, String(header.id), signal)
  const cached = ctx.sessionProjectionCache.cachedSnapshot(inspection.meta, inspection.inheritedEventCount)
  if (cached !== undefined && hasRequiredProjections(cached.values)) {
    return extractProjection(cached.values, typeof cached.values.title === 'string' ? cached.values.title : null)
  }
  // 缺腿就走冷折一次（照 `rescanSessions` 的先例）：`coldSnapshot` 会把重折出来的行
  // 写回缓存，所以这是**一次性**代价（旧会话第一次建账本时会跑回填进度）。
  // No cached rows at all (a session that never checkpointed): fold the core
  // projections — including tokenUsage — from the inspected log.
  const snapshot = ctx.sessionProjectionCache.coldSnapshot(inspection.meta, inspection.inheritedEventCount, inspection.events)
  return extractProjection(snapshot.values, typeof snapshot.values.title === 'string' ? snapshot.values.title : null)
}

/**
 * Cost one session. The exact path prices each (model, UTC hour) bucket at
 * that hour's own rate; the fallback prices each model's totals at the
 * era-resolved base (off-peak) rate at session creation, or the flat default
 * when no model split exists (tokenUsage).
 *
 * `priceAtMs` forces every hourly bucket to be priced at the era-resolved
 * rate of that single moment instead of its own hour — used for legacy
 * sessions (created before the windowed era), whose whole usage is billed at
 * the pre-era flat rate even if an hour falls after the era began.
 */
function costOf(config: FinanceConfig, read: SessionProjectionRead, createdAt: number, priceAtMs: number | null): {
  costMicros: number
  byDayExactCost: Record<string, number> | null
  modelCosts: Record<string, number>
} {
  const models = Object.entries(read.byModelHour)
  if (models.length > 0) {
    let costMicros = 0
    const byDayExactCost: Record<string, number> = {}
    const modelCosts: Record<string, number> = {}
    for (const [modelKey, byHour] of models) {
      let modelCost = 0
      for (const [hourKey, buckets] of Object.entries(byHour)) {
        const timeMs = priceAtMs ?? financeHourTime(hourKey)
        const cost = financeBucketCostMicros(buckets, financeRateAt(config, modelKey, timeMs))
        modelCost += cost
        costMicros += cost
        const day = hourKey.slice(0, 10)
        byDayExactCost[day] = (byDayExactCost[day] ?? 0) + cost
      }
      modelCosts[modelKey] = modelCost
    }
    return { costMicros, byDayExactCost, modelCosts }
  }

  const byModel = Object.entries(read.byModel)
  if (byModel.length === 0) {
    return { costMicros: financeBucketCostMicros(read.usage, config.defaultPrice), byDayExactCost: null, modelCosts: {} }
  }
  let costMicros = 0
  const modelCosts: Record<string, number> = {}
  for (const [modelKey, buckets] of byModel) {
    const cost = financeBaseCostMicros(config, modelKey, buckets, createdAt)
    modelCosts[modelKey] = cost
    costMicros += cost
  }
  return { costMicros, byDayExactCost: null, modelCosts }
}

function addInto(record: Record<string, FinanceTokenBuckets>, key: string, buckets: FinanceTokenBuckets): void {
  record[key] = addFinanceBuckets(record[key] ?? emptyFinanceBuckets(), buckets)
}

/**
 * 当前自然月起点（epoch ms，**本地时区**）。
 *
 * 月度口径与账本其余部分一致：面板说的"这月被挡了几次"就是本地自然月。
 * @param nowMs - 参考时刻（可注入以便测试）。
 */
export function quotaMonthStart(nowMs: number): number {
  const date = new Date(nowMs)
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

/**
 * 把各会话的额度触达 episode 聚合成账本口径（SPEC §10.4）。
 *
 * **INV-10：本函数只读 episode，不碰任何金额**——它的返回值与 `totalCostMicros`、
 * `byModel`、`byProvider`、`peakValley` 完全正交，绝不能参与计价。
 *
 * 两条过滤：
 *  1. 只收 `kind === 'quota'` 的 episode（投影已保证，但这里再挡一道——
 *     `capacity` / `throttle` 永远不该出现在账本里）；
 *  2. 只收当月（`>= monthStartMs`），让"这月被挡了几次"跨会话累计且与月度口径对齐。
 *
 * `attempts` 与 `hits` 分开：`hits` = 去重后的断供次数（用户看到的数），
 * `attempts` = 原始失败尝试数（解释构成）。实测两者相差 ~6 倍。
 *
 * @param records - 已建好的会话记录（含各自读到的 quota episode）。
 * @param nowMs - 参考时刻，用于确定当月起点。
 */
export function aggregateQuota(records: readonly SessionRecord[], nowMs: number): FinanceQuotaSummary {
  const monthStartMs = quotaMonthStart(nowMs)
  const episodes: FinanceQuotaEpisodeRow[] = []
  for (const record of records) {
    for (const episode of record.quota) {
      if (episode.lastAtMs < monthStartMs) continue
      episodes.push({ ...episode, provider: financeProviderOf(episode.modelKey) })
    }
  }
  episodes.sort((a, b) => b.lastAtMs - a.lastAtMs)

  const byProvider = new Map<string, {
    hits: number
    attempts: number
    lastHitAtMs: number
    windows: Map<FinanceQuotaWindow, { hits: number; resetAtMs: number | null }>
  }>()
  for (const episode of episodes) {
    const agg = byProvider.get(episode.provider) ?? {
      hits: 0,
      attempts: 0,
      lastHitAtMs: 0,
      windows: new Map(),
    }
    agg.hits += 1
    agg.attempts += episode.attempts
    agg.lastHitAtMs = Math.max(agg.lastHitAtMs, episode.lastAtMs)
    const win = agg.windows.get(episode.window) ?? { hits: 0, resetAtMs: null }
    win.hits += 1
    if (episode.resetAtMs !== null) {
      win.resetAtMs = win.resetAtMs === null ? episode.resetAtMs : Math.max(win.resetAtMs, episode.resetAtMs)
    }
    agg.windows.set(episode.window, win)
    byProvider.set(episode.provider, agg)
  }

  const rows: FinanceQuotaProviderRow[] = [...byProvider.entries()]
    .map(([provider, agg]) => {
      const windows = [...agg.windows.entries()]
        .map(([window, value]) => ({ window, hits: value.hits, resetAtMs: value.resetAtMs }))
        .sort((a, b) => b.hits - a.hits)
      // 下一个重置时刻 = 所有窗口里**未来最近**的那个（已经过去了的不算数）。
      const future = windows
        .map(value => value.resetAtMs)
        .filter((value): value is number => value !== null && value > nowMs)
      return {
        provider,
        hits: agg.hits,
        attempts: agg.attempts,
        lastHitAtMs: agg.lastHitAtMs,
        nextResetAtMs: future.length === 0 ? null : Math.min(...future),
        windows,
      }
    })
    .sort((a, b) => b.lastHitAtMs - a.lastHitAtMs)

  return { rows, totalHits: episodes.length, episodes, monthStartMs }
}

/**
 * 窗口长度（毫秒）。**名义长度，不是自然周期**（SPEC §10.8 决策 D1）：
 * 月 = 固定 30 天。理由是这些值最终会带上「估」角标，而"逐月不同天数"会让同一个
 * 5 小时窗口在不同月份给出不同数字，用户会以为算错了 —— 可解释性优先于虚假精度。
 */
const WINDOW_SPANS: readonly { span: FinanceQuotaWindowSpan; ms: number }[] = [
  { span: '5h', ms: 5 * 60 * 60 * 1000 },
  { span: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { span: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
]

/**
 * 把会话用量按时间窗切片归因（SPEC §10.8）。
 *
 * 机制与既有的滚动 24 小时 hour-of-day 聚合**完全同一套**：遍历每个会话的
 * `byModelHour`（模型 × UTC 小时桶），按窗口边界过滤，落进该窗口。区别只是
 * 窗口边界来自调用方（5h / 周 / 月），而不是硬编码的 24 小时。
 *
 * 时长来自 `financeRateHourly`（同键同时刻），旧会话缺该键时时长为 0 ——
 * 这不是错误，是 forward-only 的已知边界（UI 据此不显示时长列）。
 *
 * **INV-10：不参与任何金额口径的累加**——返回的是同一批观测的另一种切法。
 *
 * @param records - 已建好的会话记录。
 * @param config - 计价配置（用于把 token 折成目录价等价）。
 * @param nowMs - 参考时刻；默认作为每个窗口的 `endMs`。
 * @param anchors - 可选：把某窗口锚定在额度触达时刻上（`span -> 锚点 ms`）。
 */
export function aggregateQuotaWindows(
  records: readonly SessionRecord[],
  config: FinanceConfig,
  nowMs: number,
  anchors: Partial<Record<FinanceQuotaWindowSpan, number>> = {},
): FinanceQuotaWindowSummary[] {
  return WINDOW_SPANS.map(({ span, ms }) => {
    const anchor = anchors[span]
    const endMs = anchor ?? nowMs
    const startMs = endMs - ms

    const models = new Map<string, FinanceQuotaWindowModelRow>()
    let usage = emptyFinanceBuckets()
    let costMicros = 0
    let decodeMs = 0
    let ttftMs = 0
    let steps = 0

    for (const record of records) {
      for (const [modelKey, byHour] of Object.entries(record.byModelHour)) {
        const rateByHour = record.rateHourly[modelKey]
        for (const [hourKey, buckets] of Object.entries(byHour)) {
          const timeMs = financeHourTime(hourKey)
          if (timeMs < startMs || timeMs >= endMs) continue
          const rate = financeRateAt(config, modelKey, timeMs)
          const cost = financeBucketCostMicros(buckets, rate)
          const current = models.get(modelKey) ?? {
            modelKey,
            provider: financeProviderOf(modelKey),
            usage: emptyFinanceBuckets(),
            costMicros: 0,
            decodeMs: 0,
            ttftMs: 0,
            steps: 0,
          }
          const rateStat = rateByHour?.[hourKey]
          current.usage = addFinanceBuckets(current.usage, buckets)
          current.costMicros += cost
          if (rateStat !== undefined) {
            current.decodeMs += rateStat.decodeMs
            current.ttftMs += rateStat.ttftMs
            current.steps += rateStat.ttftSteps
            decodeMs += rateStat.decodeMs
            ttftMs += rateStat.ttftMs
            steps += rateStat.ttftSteps
          }
          models.set(modelKey, current)
          usage = addFinanceBuckets(usage, buckets)
          costMicros += cost
        }
      }
    }

    const rows = [...models.values()].sort((a, b) => b.costMicros - a.costMicros)
    return {
      span,
      startMs,
      endMs,
      anchoredAtHit: anchor !== undefined,
      usage,
      costMicros,
      decodeMs,
      ttftMs,
      steps,
      models: rows,
      providerCount: new Set(rows.map(row => row.provider)).size,
    }
  })
}

/**
 * Build the whole-ledger projection for the browser finance dashboard.
 *
 * The hour-of-day chart and the peak/off-peak split are aggregated over a
 * rolling 24-hour window (usage hour timestamps >= now - 24h), so the
 * dashboard's "last 24 hours" label matches the data. Legacy sessions
 * (created before the windowed era) and hour-less (unclassified) costs stay
 * full-ledger: they cannot be attributed to an hour, so they never enter the
 * windowed buckets either way. `nowMs` is injectable for deterministic tests.
 *
 * Fail-soft per session: one unreadable log (a legacy v0 artifact the host's
 * session-format migration refuses, a truncated file) is skipped and reported
 * in `unreadableSessions` instead of aborting the build — mirroring
 * `backfillFinanceHourly`, where one broken session never aborts the rest.
 */
export async function buildFinanceLedger(
  ctx: Context,
  config: FinanceConfig,
  signal?: AbortSignal,
  opts?: {
    nowMs?: number
    progress?: FinanceBackfillSink
    /** 把某个窗口锚定在额度触达时刻上（SPEC §10.8）。 */
    windowAnchors?: Partial<Record<FinanceQuotaWindowSpan, number>>
  },
): Promise<FinanceLedger> {
  const nowMs = opts?.nowMs ?? Date.now()
  // 全流程进度（0–100）：回填段占 0–70，聚合段占 70–100。仅首算（宿主把
  // 初始化 sink 传进来时）上报；后续 5s TTL 内的常规刷新不再发进度帧。
  const progress = opts?.progress
  if (progress !== undefined) {
    progress.phase = 'aggregate'
    progress.scanned = 0
    progress.line = 'ledger aggregate start'
    progress.percent = BACKFILL_WEIGHT
    progress.onProgress?.(progress)
  }
  const hourWindowStartMs = nowMs - 24 * 3_600_000
  const snapshots = await listPersistenceSnapshots(ctx, signal)
  if (progress !== undefined) {
    progress.total = snapshots.length
    progress.line = `ledger read ${snapshots.length} sessions`
    progress.onProgress?.(progress)
  }
  const workspaces = ctx.workspaceRegistry.list()
  const workspaceBySession = new Map<string, { id: string; title: string }>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      workspaceBySession.set(String(sessionId), { id: String(workspace.id), title: workspace.title })
    }
  }

  // Sessions created before the windowed era began are legacy: peak/valley
  // billing never applied to them, so their whole cost is priced at the
  // pre-era flat rate and kept out of the peak/off-peak split and hour chart.
  const windowedSinceMs = financeWindowedSince(config)

  const records: SessionRecord[] = []
  const unreadableSessions: FinanceUnreadableSessionRow[] = []
  let aggregated = 0
  for (const snapshot of snapshots) {
    const header = snapshot.header
    let read: SessionProjectionRead
    try {
      read = await readProjection(ctx, header, signal)
    } catch (error) {
      // One unreadable log must not blank the dashboard: skip this session,
      // keep every other row, and report it for the warning banner. Spend
      // belonging to it is simply missing from the totals. Cancellation still
      // propagates — an aborted build is not a broken session.
      if (signal?.aborted === true) throw error
      unreadableSessions.push({
        sessionId: String(header.id),
        createdAt: header.createdAt,
        reason: error instanceof Error ? error.message : String(error),
      })
      ctx.logger?.warn?.(`finance: session ${String(header.id)} is unreadable, skipped`, error)
      continue
    }
    aggregated += 1
    if (progress !== undefined) {
      progress.scanned = aggregated
      progress.percent = BACKFILL_WEIGHT + Math.round((AGGREGATE_WEIGHT * aggregated) / Math.max(1, snapshots.length))
      progress.line = `aggregate ${aggregated}/${snapshots.length} ${String(header.id)}`
      progress.onProgress?.(progress)
    }
    const workspace = workspaceBySession.get(String(header.id)) ?? null
    const legacy = windowedSinceMs !== null && header.createdAt < windowedSinceMs
    const priced = costOf(config, read, header.createdAt, legacy ? header.createdAt : null)
    const row: FinanceSessionRow = {
      sessionId: String(header.id),
      title: read.title,
      createdAt: header.createdAt,
      ...header.cwd === undefined ? {} : { cwd: header.cwd },
      workspaceId: workspace?.id ?? null,
      workspaceTitle: workspace?.title ?? null,
      taskId: String(header.id),
      ...header.parentSession === undefined ? {} : { parentSessionId: String(header.parentSession) },
      ...header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth },
      ...header.origin === undefined ? {} : { origin: header.origin },
      modelKeys: Object.keys(read.byModel).sort(),
      usage: read.usage,
      costMicros: priced.costMicros,
    }
    records.push({
      row,
      hourly: Object.keys(read.byModelHour).length > 0,
      legacy,
      byModel: read.byModel,
      byDay: read.byDay,
      byDayExactCost: priced.byDayExactCost,
      modelCosts: priced.modelCosts,
      byModelHour: read.byModelHour,
      rate: read.rate,
      context: read.context,
      quota: read.quota,
      rateHourly: read.rateHourly,
    })
  }

  const byId = new Map(records.map(record => [record.row.sessionId, record.row]))
  const rootOf = (id: string): string => {
    const seen = new Set<string>()
    let current = id
    while (true) {
      if (seen.has(current)) return current
      seen.add(current)
      const row = byId.get(current)
      const parent = row?.parentSessionId
      if (parent === undefined || !byId.has(parent)) return current
      current = parent
    }
  }
  for (const record of records) {
    record.row.taskId = rootOf(record.row.sessionId)
  }

  const totals = emptyFinanceBuckets()
  let totalCost = 0
  const byDayUsage: Record<string, FinanceTokenBuckets> = {}
  const byDayCost: Record<string, number> = {}
  const byModelUsage: Record<string, FinanceTokenBuckets> = {}
  const byModelCost: Record<string, number> = {}
  /** P1-B：每模型的速率样本合计（只有装了 financeRate 的会话贡献）。 */
  const byModelRate: Record<string, FinanceRateStats> = {}
  /** P2：每模型的上下文长度分布合计（只有装了 financeContext 的会话贡献）。 */
  const byModelContext: Record<string, FinanceContextBucket[]> = {}
  const byWorkspaceUsage: Record<string, FinanceTokenBuckets> = {}
  const byWorkspaceCost: Record<string, number> = {}
  const byTaskUsage: Record<string, FinanceTokenBuckets> = {}
  const byTaskCost: Record<string, number> = {}
  const workspaceMeta = new Map<string, string>()
  const taskMeta = new Map<string, { title: string | null; createdAt: number }>()
  const taskCount = new Map<string, number>()
  const workspaceCount = new Map<string, number>()

  // Peak/off-peak aggregation: 24 local hour-of-day buckets plus the cost
  // split across time bands (peak / off-peak / flat) and the potential
  // savings of shifting peak-hour usage off-peak.
  const byHourOfDayUsage: FinanceTokenBuckets[] = Array.from({ length: 24 }, () => emptyFinanceBuckets())
  const byHourOfDayCost = new Array<number>(24).fill(0)
  const byHourOfDayPeakCost = new Array<number>(24).fill(0)
  const byHourOfDayFlatCost = new Array<number>(24).fill(0)
  // The real hour (UTC epoch) each local-hour slot aggregates: within one
  // rolling 24h window every local hour appears exactly once, so this lets
  // the client lay the 24 buckets out in time order across the window.
  const byHourOfDayStartMs = new Array<number | undefined>(24).fill(undefined)
  // Per-hour shift savings (peak cost − same tokens at off-peak rates), so the
  // dashboard can point at the hours most worth shifting. Sums to the total.
  const byHourOfDayShiftSavings = new Array<number>(24).fill(0)
  // Per-model peak cost and its off-peak equivalent, for per-model savings.
  const modelPeakCost: Record<string, number> = {}
  const modelPeakOffPeakCost: Record<string, number> = {}
  const split: FinancePeakValleySplit = {
    peakCostMicros: 0,
    offPeakCostMicros: 0,
    flatCostMicros: 0,
    unclassifiedCostMicros: 0,
    legacyCostMicros: 0,
    shiftSavingsMicros: 0,
  }

  for (const record of records) {
    const { row, legacy, byModel, byDay, byDayExactCost, modelCosts, byModelHour, rate, context } = record
    const workspaceKey = row.workspaceId ?? UNASSIGNED_WORKSPACE_ID
    Object.assign(totals, addFinanceBuckets(totals, row.usage))
    totalCost += row.costMicros
    // Legacy sessions (created before the windowed era) never enter the
    // peak/off-peak analysis: the whole cost is flat and stays in its own
    // bucket, outside the hour-of-day chart and the four-band split.
    if (legacy) {
      split.legacyCostMicros += row.costMicros
    } else {
      // Exact path: fold each (model, UTC hour) bucket into its local
      // hour-of-day slot and time band, priced at that hour's own rate.
      // Fallback path: no hour detail, so the whole cost is unclassified.
      const hourEntries = Object.entries(byModelHour)
      if (hourEntries.length === 0) {
        // Hour-less sessions: no timestamp to attribute, kept full-ledger.
        split.unclassifiedCostMicros += row.costMicros
      } else {
        for (const [modelKey, byHour] of hourEntries) {
          for (const [hourKey, buckets] of Object.entries(byHour)) {
            const timeMs = financeHourTime(hourKey)
            // Rolling 24-hour window: only usage that occurred in the last
            // day enters the hour-of-day chart and the peak/off-peak split;
            // future hours (bucket start beyond now) are excluded too.
            if (timeMs < hourWindowStartMs || timeMs > nowMs) continue
            const info = financeWindowInfo(config, modelKey, timeMs)
            const cost = financeBucketCostMicros(buckets, info.rate)
            byHourOfDayUsage[info.localHour] = addFinanceBuckets(byHourOfDayUsage[info.localHour], buckets)
            byHourOfDayCost[info.localHour] += cost
            byHourOfDayStartMs[info.localHour] ??= timeMs
            if (info.band === 'peak') {
              split.peakCostMicros += cost
              byHourOfDayPeakCost[info.localHour] += cost
              const entry = financeEntryFor(config, modelKey, timeMs)
              if (entry !== undefined && entry.kind === 'windowed') {
                const offPeakCost = financeBucketCostMicros(buckets, entry.rate.offPeak)
                byHourOfDayShiftSavings[info.localHour] += cost - offPeakCost
                modelPeakCost[modelKey] = (modelPeakCost[modelKey] ?? 0) + cost
                modelPeakOffPeakCost[modelKey] = (modelPeakOffPeakCost[modelKey] ?? 0) + offPeakCost
              }
            } else if (info.band === 'offpeak') {
              split.offPeakCostMicros += cost
            } else {
              split.flatCostMicros += cost
              byHourOfDayFlatCost[info.localHour] += cost
            }
          }
        }
      }
    }
    addInto(byTaskUsage, row.taskId, row.usage)
    addInto(byWorkspaceUsage, workspaceKey, row.usage)
    workspaceMeta.set(workspaceKey, row.workspaceTitle ?? UNASSIGNED_WORKSPACE_TITLE)
    taskMeta.set(row.taskId, { title: row.title, createdAt: row.createdAt })
    taskCount.set(row.taskId, (taskCount.get(row.taskId) ?? 0) + 1)
    workspaceCount.set(workspaceKey, (workspaceCount.get(workspaceKey) ?? 0) + 1)
    byTaskCost[row.taskId] = (byTaskCost[row.taskId] ?? 0) + row.costMicros
    byWorkspaceCost[workspaceKey] = (byWorkspaceCost[workspaceKey] ?? 0) + row.costMicros
    for (const [modelKey, buckets] of Object.entries(byModel)) {
      addInto(byModelUsage, modelKey, buckets)
      byModelCost[modelKey] = (byModelCost[modelKey] ?? 0) + (modelCosts[modelKey] ?? 0)
    }
    for (const [modelKey, buckets] of Object.entries(context)) {
      const current = byModelContext[modelKey] ?? buckets.map((bucket) => ({
        maxPromptTokens: bucket.maxPromptTokens,
        usage: emptyFinanceBuckets(),
        steps: 0,
      }))
      byModelContext[modelKey] = current.map((bucket, index) => {
        const incoming = buckets[index]
        if (incoming === undefined) return bucket
        return {
          maxPromptTokens: bucket.maxPromptTokens,
          usage: addFinanceBuckets(bucket.usage, incoming.usage),
          steps: bucket.steps + incoming.steps,
        }
      })
    }
    for (const [modelKey, sample] of Object.entries(rate)) {
      const current = byModelRate[modelKey] ?? { decodeMs: 0, decodeTokens: 0, ttftMs: 0, ttftSteps: 0 }
      byModelRate[modelKey] = {
        decodeMs: current.decodeMs + sample.decodeMs,
        decodeTokens: current.decodeTokens + sample.decodeTokens,
        ttftMs: current.ttftMs + sample.ttftMs,
        ttftSteps: current.ttftSteps + sample.ttftSteps,
      }
    }
    for (const [day, buckets] of Object.entries(byDay)) {
      addInto(byDayUsage, day, buckets)
      // Exact path: per-hour costs already carry the peak/off-peak split.
      // Fallback path: no hour detail, so the day trend stays a flat
      // default-rate approximation (a display trend, not a billing source).
      byDayCost[day] = (byDayCost[day] ?? 0)
        + (byDayExactCost === null ? financeBucketCostMicros(buckets, config.defaultPrice) : (byDayExactCost[day] ?? 0))
    }
  }

  const modelRows: FinanceModelRow[] = Object.entries(byModelUsage)
    .map(([modelKey, usage]) => ({
      modelKey,
      provider: financeProviderOf(modelKey),
      model: financeModelOf(modelKey),
      billingMode: financeBillingMode(config, modelKey),
      usage,
      costMicros: byModelCost[modelKey] ?? 0,
      shiftSavingsMicros: Math.max(0, (modelPeakCost[modelKey] ?? 0) - (modelPeakOffPeakCost[modelKey] ?? 0)),
      // 只在真的有速率样本时带上该字段：旧会话缺席 -> 客户端不显示速率列，
      // 而不是把 0 当成"这个模型 0 tok/s"。
      ...(byModelRate[modelKey] !== undefined ? { rate: byModelRate[modelKey] } : {}),
      // 上下文分布同理：只有真的有该投影的会话才带这个字段。
      ...(byModelContext[modelKey] !== undefined ? { context: byModelContext[modelKey] } : {}),
    }))
    .sort((a, b) => b.costMicros - a.costMicros)
  // Wallet math stays honest under plan subscriptions: plan rows are
  // list-price equivalents, never cash flow. Sessions whose projections
  // carry no model split (legacy tokenUsage) can't be classified either way
  // — they stay in the metered bucket so the two shares always reconcile
  // exactly to totalCostMicros.
  let planEquivalentCostMicros = 0
  let freeCostMicros = 0
  for (const row of modelRows) {
    if (row.billingMode === 'plan') planEquivalentCostMicros += row.costMicros
    else if (row.billingMode === 'free') freeCostMicros += row.costMicros
  }
  // free 单列：既不是现金支出也不是订阅等价，混进按量桶会做出一笔假账。
  const meteredCostMicros = totalCost - planEquivalentCostMicros - freeCostMicros
  // Per-provider rollup: fold the model rows by their provider part, keeping
  // the distinct model count so the dashboard can show how spread the spend is.
  // A provider mixing plan and metered models rolls up as 'mixed'.
  const providerRows: FinanceProviderRow[] = Object.entries(
    modelRows.reduce<Record<string, { usage: FinanceTokenBuckets; costMicros: number; models: Set<string>; modes: Set<FinanceBillingMode> }>>((acc, row) => {
      const agg = acc[row.provider] ?? { usage: emptyFinanceBuckets(), costMicros: 0, models: new Set<string>(), modes: new Set<FinanceBillingMode>() }
      agg.usage = addFinanceBuckets(agg.usage, row.usage)
      agg.costMicros += row.costMicros
      agg.models.add(row.model)
      agg.modes.add(row.billingMode ?? 'metered')
      acc[row.provider] = agg
      return acc
    }, {}),
  ).map(([provider, agg]) => ({
    provider,
    usage: agg.usage,
    costMicros: agg.costMicros,
    modelCount: agg.models.size,
    ...agg.modes.size > 1 ? { billingMode: 'mixed' as const } : agg.modes.has('plan') ? { billingMode: 'plan' as const } : {},
  })).sort((a, b) => b.costMicros - a.costMicros)
  const dayRows: FinanceDayRow[] = Object.entries(byDayUsage)
    .map(([day, usage]) => ({ day, usage, costMicros: byDayCost[day] ?? 0 }))
    .sort((a, b) => a.day.localeCompare(b.day))
  const workspaceRows: FinanceWorkspaceRow[] = [...workspaceMeta.entries()]
    .map(([workspaceKey, title]) => ({
      workspaceId: workspaceKey === UNASSIGNED_WORKSPACE_ID ? null : workspaceKey,
      title,
      sessionCount: workspaceCount.get(workspaceKey) ?? 0,
      usage: byWorkspaceUsage[workspaceKey] ?? emptyFinanceBuckets(),
      costMicros: byWorkspaceCost[workspaceKey] ?? 0,
    }))
    .sort((a, b) => b.costMicros - a.costMicros)
  const taskRows: FinanceTaskRow[] = [...taskMeta.entries()]
    .map(([taskId, meta]) => ({
      taskId,
      title: meta.title,
      createdAt: meta.createdAt,
      sessionCount: taskCount.get(taskId) ?? 0,
      usage: byTaskUsage[taskId] ?? emptyFinanceBuckets(),
      costMicros: byTaskCost[taskId] ?? 0,
    }))
    .sort((a, b) => b.costMicros - a.costMicros)

  // Peak cost minus the same tokens at off-peak rates: the extra paid for
  // running in peak hours. Computed per hour (rounding is monotonic, so this
  // is never negative) so the 24 rows sum to the ledger-wide total.
  split.shiftSavingsMicros = Math.max(0, byHourOfDayShiftSavings.reduce((sum, value) => sum + value, 0))

  const byHourOfDay: FinanceHourOfDayRow[] = Array.from({ length: 24 }, (_, localHour) => ({
    localHour,
    hourStartMs: byHourOfDayStartMs[localHour],
    usage: byHourOfDayUsage[localHour],
    costMicros: byHourOfDayCost[localHour],
    peakCostMicros: byHourOfDayPeakCost[localHour],
    flatCostMicros: byHourOfDayFlatCost[localHour],
    shiftSavingsMicros: byHourOfDayShiftSavings[localHour],
  }))

  if (progress !== undefined) {
    progress.phase = 'done'
    progress.percent = 100
    progress.line = `ledger done · ${records.length} sessions`
    progress.onProgress?.(progress)
  }
  return {
    generatedAt: nowMs,
    currency: config.currency,
    totals,
    totalCostMicros: totalCost,
    meteredCostMicros,
    planEquivalentCostMicros,
    freeCostMicros,
    sessionCount: records.length,
    workspaceCount: workspaceMeta.size,
    taskCount: taskMeta.size,
    windowedSinceMs,
    hourOfDayWindowStartMs: hourWindowStartMs,
    byDay: dayRows,
    byModel: modelRows,
    byProvider: providerRows,
    byWorkspace: workspaceRows,
    tasks: taskRows,
    sessions: records.map(record => record.row).sort((a, b) => b.createdAt - a.createdAt),
    unreadableSessions,
    byHourOfDay,
    peakValley: split,
    // SPEC §10 / INV-10：额度触达与上面每个金额口径正交，只读不参与计价。
    quota: aggregateQuota(records, nowMs),
    // 窗口归因：同一批观测按 5h / 周 / 月切片的另一种切法（同样不参与金额累加）。
    windows: aggregateQuotaWindows(records, config, nowMs, opts?.windowAnchors),
  }
}

/**
 * Automatic hourly backfill, run by the service before the first ledger build:
 * replay the event log of every session whose cached cut lacks the
 * `financeUsageHourly` unit and write the refolded checkpoint back (the
 * projection cache's cold-read write-back). The restore floor drops to 0 for a
 * session missing any registered unit, so the cold read re-reads the FULL log
 * from seq 0 — this is what recovers per-model per-hour data for sessions that
 * predate the hourly unit (including ones persisted before the finance plugin
 * existed, which had only tokenUsage totals and no model split at all). After
 * the backfill the ledger build stays O(session count); the replay cost is
 * paid once. The scan is idempotent: sessions already carrying the unit are
 * skipped, so re-running it on later builds replays nothing (and retries any
 * session whose earlier replay failed). Failures are per-session and
 * fail-soft: one broken session never aborts the rest of the backfill.
 */
export async function backfillFinanceHourly(
  ctx: Context,
  signal?: AbortSignal,
  progress?: FinanceBackfillSink,
): Promise<FinanceRescanResult> {
  const snapshots = await listPersistenceSnapshots(ctx, signal)
  if (progress !== undefined) {
    progress.total = snapshots.length
    progress.phase = 'backfill'
    progress.line = `backfill scan ${snapshots.length} sessions`
    progress.onProgress?.(progress)
  }
  let scanned = 0
  let rescanned = 0
  for (const snapshot of snapshots) {
    if (signal?.aborted) break
    const header = snapshot.header
    let replayed = false
    try {
      const inspection = await inspectPersistenceSession(ctx, String(header.id), signal)
      const cached = ctx.sessionProjectionCache.cachedSnapshot(inspection.meta, inspection.inheritedEventCount)
      if (cached === undefined || cached.values.financeUsageHourly === undefined) {
        ctx.sessionProjectionCache.coldSnapshot(inspection.meta, inspection.inheritedEventCount, inspection.events)
        rescanned += 1
        replayed = true
      }
    } catch (error) {
      ctx.logger?.warn?.(`finance rescan: session ${String(header.id)} replay failed`, error)
    }
    // 2026-09 订阅估价修订：scanned 在会话**处理完成后**才 +1 —— 进度条反映真实
    // 完成量，不再「先满后等」（最后一个会话的重放最慢，旧实现让条提前走满）。
    scanned += 1
    if (progress !== undefined) {
      progress.scanned = scanned
      progress.rescanned = rescanned
      progress.percent = Math.round((BACKFILL_WEIGHT * scanned) / Math.max(1, snapshots.length))
      progress.line = `backfill ${scanned}/${snapshots.length}${replayed ? ' replay' : ' cached'} ${String(header.id)}`
      progress.onProgress?.(progress)
    }
  }
  return { sessionCount: snapshots.length, rescanned }
}

