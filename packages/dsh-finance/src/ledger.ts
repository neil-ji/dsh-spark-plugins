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
 * @module @deepseek-ai/dsh-finance/ledger
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
// Type-only: merges the `title` projection key into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-session-title/types'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  addFinanceBuckets,
  emptyFinanceBuckets,
  financeBaseCostMicros,
  financeBucketCostMicros,
  financeEntryFor,
  financeHourTime,
  financeRateAt,
  financeWindowedSince,
  financeWindowInfo,
} from './pricing.ts'
import type {
  FinanceBackfillSink,
  FinanceConfig,
  FinanceDayRow,
  FinanceHourOfDayRow,
  FinanceHourlyProjection,
  FinanceLedger,
  FinanceModelRow,
  FinancePeakValleySplit,
  FinanceRescanResult,
  FinanceSessionRow,
  FinanceTaskRow,
  FinanceTokenBuckets,
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
}

interface SessionProjectionRead {
  usage: FinanceTokenBuckets
  byModel: Record<string, FinanceTokenBuckets>
  byDay: Record<string, FinanceTokenBuckets>
  byModelHour: Record<string, Record<string, FinanceTokenBuckets>>
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
    return { usage, byModel, byDay, byModelHour, title }
  }
  const finance = values.financeUsage as FinanceUsageProjection | undefined
  if (finance !== undefined) {
    return { usage: finance.totals, byModel: finance.byModel, byDay: finance.byDay, byModelHour: {}, title }
  }
  const token = values.tokenUsage
  if (token !== undefined) {
    return { usage: token, byModel: {}, byDay: {}, byModelHour: {}, title }
  }
  return { usage: emptyFinanceBuckets(), byModel: {}, byDay: {}, byModelHour: {}, title }
}

async function readProjection(ctx: Context, header: SessionHeader, signal?: AbortSignal): Promise<SessionProjectionRead> {
  const cached = ctx.sessionProjectionCache.cachedSnapshot(header)
  if (cached !== undefined) {
    return extractProjection(cached.values, typeof cached.values.title === 'string' ? cached.values.title : null)
  }
  // No cached rows at all (a session that never checkpointed): one cold read
  // refolds the core projections — including tokenUsage — from the log.
  const snapshot = await ctx.sessionProjectionCache.coldSnapshot(header.id, signal)
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

/** Build the whole-ledger projection for the browser finance dashboard. */
export async function buildFinanceLedger(ctx: Context, config: FinanceConfig, signal?: AbortSignal): Promise<FinanceLedger> {
  const snapshots = await ctx.sessionPersistence.listSnapshots(signal)
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
  for (const snapshot of snapshots) {
    const header = snapshot.header
    const read = await readProjection(ctx, header, signal)
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
    const { row, legacy, byModel, byDay, byDayExactCost, modelCosts, byModelHour } = record
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
        split.unclassifiedCostMicros += row.costMicros
      } else {
        for (const [modelKey, byHour] of hourEntries) {
          for (const [hourKey, buckets] of Object.entries(byHour)) {
            const timeMs = financeHourTime(hourKey)
            const info = financeWindowInfo(config, modelKey, timeMs)
            const cost = financeBucketCostMicros(buckets, info.rate)
            byHourOfDayUsage[info.localHour] = addFinanceBuckets(byHourOfDayUsage[info.localHour], buckets)
            byHourOfDayCost[info.localHour] += cost
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
      usage,
      costMicros: byModelCost[modelKey] ?? 0,
      shiftSavingsMicros: Math.max(0, (modelPeakCost[modelKey] ?? 0) - (modelPeakOffPeakCost[modelKey] ?? 0)),
    }))
    .sort((a, b) => b.costMicros - a.costMicros)
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
    usage: byHourOfDayUsage[localHour],
    costMicros: byHourOfDayCost[localHour],
    peakCostMicros: byHourOfDayPeakCost[localHour],
    flatCostMicros: byHourOfDayFlatCost[localHour],
    shiftSavingsMicros: byHourOfDayShiftSavings[localHour],
  }))

  return {
    generatedAt: Date.now(),
    currency: config.currency,
    totals,
    totalCostMicros: totalCost,
    sessionCount: records.length,
    workspaceCount: workspaceMeta.size,
    taskCount: taskMeta.size,
    windowedSinceMs,
    byDay: dayRows,
    byModel: modelRows,
    byWorkspace: workspaceRows,
    tasks: taskRows,
    sessions: records.map(record => record.row).sort((a, b) => b.createdAt - a.createdAt),
    byHourOfDay,
    peakValley: split,
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
  const snapshots = await ctx.sessionPersistence.listSnapshots(signal)
  if (progress !== undefined) progress.total = snapshots.length
  let scanned = 0
  let rescanned = 0
  for (const snapshot of snapshots) {
    if (signal?.aborted) break
    scanned += 1
    if (progress !== undefined) progress.scanned = scanned
    const header = snapshot.header
    const cached = ctx.sessionProjectionCache.cachedSnapshot(header)
    if (cached !== undefined && cached.values.financeUsageHourly !== undefined) continue
    try {
      await ctx.sessionProjectionCache.coldSnapshot(header.id, signal)
      rescanned += 1
      if (progress !== undefined) progress.rescanned = rescanned
    } catch (error) {
      ctx.logger?.warn?.(`finance rescan: session ${String(header.id)} replay failed`, error)
    }
  }
  return { sessionCount: snapshots.length, rescanned }
}

