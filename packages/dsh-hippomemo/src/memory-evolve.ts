/**
 * HippoMemo automatic evolution.
 *
 * A deterministic hygiene engine that keeps the memory layer precise without
 * manual review. Every memory lives a lifecycle driven by its own usage data
 * (recall exposure vs citation), instead of accumulating forever:
 *
 *  1. expiry        — a memory whose expiresAt has passed is archived. If it was
 *                     cited during probation, the probation is lifted instead.
 *  2. probation     — an active memory that was surfaced many times but never
 *                     cited is put on probation: a probationary expiresAt is
 *                     set (recall ranking is untouched). If it is still uncited
 *                     when the expiry arrives, the sweep archives it (step 1);
 *                     if it is cited first, the probation is lifted.
 *  3. consolidation — near-duplicate active memories (same scope + workspace,
 *                     high title-token overlap) are merged: the unused copy is
 *                     superseded into the used one; if both were used, they are
 *                     only linked and reported for human review.
 *  4. write-time dedup — every put is checked against active records; a high
 *                     title overlap links relatedIds so duplicates stop
 *                     accumulating at the source.
 *
 * An optional LLM review pass (reviewEnabled) classifies probation candidates
 * before they are applied: "noise" candidates (completed milestones, transient
 * state) are put on probation; "keep" candidates (durable knowledge that is
 * simply never id-cited) are left untouched. If the review call fails, the
 * sweep falls back to the deterministic probation so hygiene never stalls.
 *
 * Actions are conservative and reversible (archived/superseded records can be
 * restored by PATCH), every run produces a report, and the whole sweep can be
 * run in dry-run mode before auto-apply is enabled.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from './memory-service.ts'
import { tokenize } from './memory-core.ts'
import { extractTextFromBlocks } from './memory-extract.ts'
import type { EvolveAction, EvolveActionType, EvolveReport, EvolveReviewVerdict, MemoryRecord } from './types.ts'

export const name = 'hippomemo-evolve'
export const inject = ['memory', 'webServer', 'llm', 'agentDefaultModel']

export interface HippomemoEvolveConfig {
  enabled?: boolean
  /** How often the sweep runs. */
  intervalMs?: number
  /** Report-only mode: plan the actions but do not apply them. */
  dryRun?: boolean
  /** A memory must have been surfaced at least this many times before it can be judged. */
  decayMinRecalls?: number
  /** A memory younger than this (createdAt) is never judged. */
  graceDays?: number
  /** Length of the probation window; expiry after it archives an uncited memory. */
  probationDays?: number
  /** Title-token Jaccard at/above which two memories count as near-duplicates. */
  dupTitleThreshold?: number
  /** Max consolidation actions per run (bounds the O(n²) pairing). */
  maxConsolidations?: number
  /** LLM review pass: classify probation candidates before applying them. */
  reviewEnabled?: boolean
  /** Provider/model for the review call; defaults to the agent-default model. */
  reviewProvider?: string
  reviewModel?: string
  reviewMaxTokens?: number
  reviewTimeoutMs?: number
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().step(1).min(60_000).default(6 * 3_600_000),
  dryRun: z.boolean().default(false),
  decayMinRecalls: z.number().step(1).min(1).default(5),
  graceDays: z.number().step(1).min(0).default(3),
  probationDays: z.number().step(1).min(1).default(30),
  dupTitleThreshold: z.number().min(0.1).max(1).default(0.7),
  maxConsolidations: z.number().step(1).min(1).default(20),
  reviewEnabled: z.boolean().default(true),
  reviewProvider: z.string(),
  reviewModel: z.string(),
  reviewMaxTokens: z.number().step(1).min(1).default(4096),
  reviewTimeoutMs: z.number().step(1).min(1).default(60_000),
})

interface ResolvedConfig {
  enabled: boolean
  intervalMs: number
  dryRun: boolean
  decayMinRecalls: number
  graceMs: number
  probationMs: number
  dupTitleThreshold: number
  maxConsolidations: number
  reviewEnabled: boolean
  reviewProvider?: string
  reviewModel?: string
  reviewMaxTokens: number
  reviewTimeoutMs: number
}

function resolveConfig(config: HippomemoEvolveConfig = {}): ResolvedConfig {
  return {
    enabled: config.enabled ?? true,
    intervalMs: config.intervalMs ?? 6 * 3_600_000,
    dryRun: config.dryRun ?? false,
    decayMinRecalls: config.decayMinRecalls ?? 5,
    graceMs: (config.graceDays ?? 3) * 86_400_000,
    probationMs: (config.probationDays ?? 30) * 86_400_000,
    dupTitleThreshold: config.dupTitleThreshold ?? 0.7,
    maxConsolidations: config.maxConsolidations ?? 20,
    reviewEnabled: config.reviewEnabled ?? true,
    reviewProvider: config.reviewProvider,
    reviewModel: config.reviewModel,
    reviewMaxTokens: config.reviewMaxTokens ?? 4096,
    reviewTimeoutMs: config.reviewTimeoutMs ?? 60_000,
  }
}

// ---------------------------------------------------------------------------
// Pure planning core (unit-testable without cordis or storage)
// ---------------------------------------------------------------------------

export interface EvolveOptions {
  now: number
  graceMs: number
  decayMinRecalls: number
  probationMs: number
  dupTitleThreshold: number
  maxConsolidations: number
}

/** Jaccard similarity over deduplicated title tokens (latin words + CJK bigrams). */
export function titleTokenJaccard(left: string, right: string): number {
  const a = new Set(tokenize(left))
  const b = new Set(tokenize(right))
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const token of a) if (b.has(token)) inter += 1
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function pickWinner(left: MemoryRecord, right: MemoryRecord): MemoryRecord {
  const byCitation = right.citationCount - left.citationCount
  if (byCitation !== 0) return byCitation > 0 ? right : left
  const byImportance = right.importance - left.importance
  if (byImportance !== 0) return byImportance > 0 ? right : left
  const byUpdate = right.updatedAt - left.updatedAt
  if (byUpdate !== 0) return byUpdate > 0 ? right : left
  return left.id < right.id ? left : right
}

/**
 * Compute the next evolution actions for a set of records (deterministic, no I/O).
 * Pass 1: expiry/probation lifecycle. Pass 2: near-duplicate consolidation among
 * the survivors. A record is claimed by at most one consolidation action per run.
 */
export function planEvolution(records: readonly MemoryRecord[], options: EvolveOptions): EvolveAction[] {
  const now = options.now
  const actions: EvolveAction[] = []
  const survivors: MemoryRecord[] = []

  // Pass A: expiry is a hard lifecycle rule — nothing else applies to an expired
  // record (author-set TTL or a lapsed probation).
  for (const record of records) {
    if (record.status !== 'active') continue
    if (record.expiresAt !== null && record.expiresAt !== undefined) {
      if (record.expiresAt <= now) {
        if (record.citationCount > 0) {
          actions.push({ id: record.id, action: 'cancel-probation', reason: 'cited before expiry, probation lifted' })
        } else {
          actions.push({ id: record.id, action: 'archive', reason: 'expired without citation' })
        }
      } else {
        survivors.push(record) // on probation or author-set TTL; not judged again
      }
      continue
    }
    survivors.push(record)
  }

  // Pass B: near-duplicate consolidation among survivors. Supersede is the most
  // decisive cleanup (the winner keeps the knowledge), so it outranks probation.
  const groups = new Map<string, MemoryRecord[]>()
  for (const record of survivors) {
    const key = record.scope + '|' + (record.workspacePath ?? '')
    let group = groups.get(key)
    if (group === undefined) {
      group = []
      groups.set(key, group)
    }
    group.push(record)
  }

  let consolidations = 0
  const claimed = new Set<string>()
  for (const group of groups.values()) {
    if (group.length < 2 || consolidations >= options.maxConsolidations) continue
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (consolidations >= options.maxConsolidations) break
        const left = group[i]!
        const right = group[j]!
        if (claimed.has(left.id) || claimed.has(right.id)) continue
        const overlap = titleTokenJaccard(left.title, right.title)
        if (overlap < options.dupTitleThreshold) continue
        const winner = pickWinner(left, right)
        const loser = winner === left ? right : left
        claimed.add(loser.id)
        consolidations += 1
        const pct = Math.round(overlap * 100) + '%'
        if (loser.citationCount > 0) {
          actions.push({
            id: loser.id,
            action: 'link',
            targetId: winner.id,
            reason: 'near-duplicate of cited memory (title overlap ' + pct + '), human review',
          })
        } else {
          actions.push({
            id: loser.id,
            action: 'supersede',
            targetId: winner.id,
            reason: 'near-duplicate of ' + winner.title.slice(0, 32) + ' (title overlap ' + pct + '), unused',
          })
        }
      }
    }
  }

  // Pass C1: a declared global that never earned cross-workspace evidence is
  // downgraded to workspace-bound (its workspacePath already carries the source).
  // Only fire when the memory was surfaced in exactly one distinct workspace
  // (its source) after enough recalls and age — a memory on its way to global
  // (>=2 distinct workspaces) or a legitimate legacy record (no evidence data)
  // is left alone. Downgrade under-recalls, which is the harmless direction.
  for (const record of survivors) {
    if (claimed.has(record.id)) continue
    if (record.scope !== 'global' || record.globalProven === true) continue
    if (record.expiresAt !== null && record.expiresAt !== undefined) continue
    if (record.recallCount < options.decayMinRecalls) continue
    if (now - record.createdAt < options.graceMs) continue
    const seen = record.seenWorkspaces ?? []
    if (seen.length !== 1) continue
    claimed.add(record.id)
    actions.push({ id: record.id, action: 'downgrade-scope', reason: 'declared global but surfaced only in its source workspace; no cross-workspace evidence' })
  }

  // Pass C: probation for uncited noise not already handled above. Records
  // with a future expiresAt (already on probation, or an author-set TTL) are
  // never re-judged — pass A put them in survivors as "not judged again", so
  // re-flagging here would endlessly extend their probation and they would
  // never reach expiry.
  for (const record of survivors) {
    if (claimed.has(record.id)) continue
    if (record.expiresAt !== null && record.expiresAt !== undefined) continue
    if (
      record.citationCount === 0
      && record.recallCount >= options.decayMinRecalls
      && now - record.createdAt >= options.graceMs
    ) {
      actions.push({ id: record.id, action: 'probation', reason: 'recalled ' + String(record.recallCount) + '× never cited' })
    }
  }

  return actions
}
// ---------------------------------------------------------------------------
// LLM review pass (pure framing/parsing; the model call itself lives in apply)
// ---------------------------------------------------------------------------

export interface ReviewCandidate {
  id: string
  kind: string
  title: string
  content: string
  recallCount: number
}

/** Frame the classification call for one sweep's probation candidates. */
export function buildReviewPrompt(candidates: readonly ReviewCandidate[]): { system: string; user: string } {
  return {
    system: [
      'You classify durable-memory candidates flagged by an automatic hygiene sweep.',
      'Each candidate was surfaced by search many times but never explicitly cited by an agent.',
      'Decide for each: "noise" means it is a completed milestone / transient state / stale detail that is safe to retire automatically; "keep" means it is durable knowledge still worth keeping (even if never id-cited).',
      'Return a JSON array only, one object per candidate, in the same order:',
      '  {"id": "<candidate id>", "verdict": "noise" | "keep", "reason": "<one short sentence>"}',
      'When unsure, prefer "keep" — archiving is irreversible without human review.',
    ].join('\n'),
    user: candidates.map(candidate => [
      'id: ' + candidate.id,
      'kind: ' + candidate.kind,
      'title: ' + candidate.title,
      'recalled: ' + String(candidate.recallCount) + '×, never cited',
      'content: ' + candidate.content.slice(0, 240),
    ].join('\n')).join('\n\n'),
  }
}

/** Parse the JSON array of verdicts, tolerating surrounding prose; unknown ids are skipped. */
export function parseReviewVerdicts(text: string, knownIds: readonly string[]): EvolveReviewVerdict[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start < 0 || end < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return []
  }
  if (Array.isArray(parsed) === false) return []
  const known = new Set(knownIds)
  const verdicts: EvolveReviewVerdict[] = []
  for (const item of parsed.slice(0, 64)) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = record.id
    const verdict = record.verdict
    if (typeof id !== 'string' || known.has(id) === false) continue
    if (verdict !== 'noise' && verdict !== 'keep') continue
    const reason = record.reason
    verdicts.push({
      id,
      verdict,
      ...(typeof reason === 'string' && reason.trim().length > 0 ? { reason: reason.trim().slice(0, 160) } : {}),
    })
  }
  return verdicts
}

/**
 * Fill missing verdicts with a safe default ('keep' — never archive on doubt).
 * Partial or truncated LLM output therefore never destroys durable knowledge.
 */
export function completeVerdicts(
  parsed: readonly EvolveReviewVerdict[],
  candidates: readonly ReviewCandidate[],
): EvolveReviewVerdict[] {
  const byId = new Map(parsed.map(verdict => [verdict.id, verdict] as const))
  return candidates.map(candidate => byId.get(candidate.id) ?? {
    id: candidate.id,
    verdict: 'keep',
    reason: 'no verdict from review — kept by default',
  })
}

// ---------------------------------------------------------------------------
// Cordis plugin: scheduled runs, manual trigger, write-time dedup, report
// ---------------------------------------------------------------------------

const MAX_ACTIVE_RECORDS = 10_000

export function apply(ctx: Context, config: HippomemoEvolveConfig = {}): void {
  const resolved = resolveConfig(config)
  if (resolved.enabled === false) return

  let lastReport: EvolveReport | null = null

  const run = async (dryRun: boolean): Promise<EvolveReport> => {
    const listed = ctx.memory.list({ status: 'active', limit: MAX_ACTIVE_RECORDS })
    const actions = planEvolution(listed.items, {
      now: Date.now(),
      graceMs: resolved.graceMs,
      decayMinRecalls: resolved.decayMinRecalls,
      probationMs: resolved.probationMs,
      dupTitleThreshold: resolved.dupTitleThreshold,
      maxConsolidations: resolved.maxConsolidations,
    })
    let review: EvolveReviewVerdict[] | undefined
    let finalActions = actions
    const probations = actions.filter(action => action.action === 'probation')
    if (resolved.reviewEnabled && probations.length > 0) {
      const verdicts = await reviewProbationCandidates(ctx, probations, listed.items, resolved)
      if (verdicts !== undefined) {
        review = verdicts
        const kept = new Set(verdicts.filter(v => v.verdict === 'keep').map(v => v.id))
        if (kept.size > 0) {
          finalActions = actions.filter(action => kept.has(action.id) === false)
          ctx.logger.info(
            'hippomemo-evolve: LLM review kept ' + kept.size + ' probation candidates',
          )
        }
      } else {
        // Review is enabled but could not produce verdicts (after a retry).
        // Defer probation this run instead of applying the deterministic
        // heuristic: probating durable knowledge is a false positive, while
        // doing nothing is always the safe status quo.
        finalActions = actions.filter(action => action.action !== 'probation')
        ctx.logger.warn(
          'hippomemo-evolve: review unavailable, deferred ' + probations.length + ' probation actions this run',
        )
      }
    }
    if (dryRun === false && finalActions.length > 0) {
      await applyActions(ctx, finalActions, resolved)
    }
    const report: EvolveReport = {
      runAt: Date.now(),
      dryRun,
      actions: finalActions,
      ...(review !== undefined ? { review } : {}),
    }
    lastReport = report
    ctx.logger.info(
      'hippomemo-evolve: ' + (dryRun ? 'dry-run' : 'run') + ' planned ' + finalActions.length + ' actions'
        + (review !== undefined ? ' (reviewed ' + review.length + ')' : ''),
    )
    return report
  }

  // Scheduled sweep.
  const timer = setInterval(() => {
    void run(resolved.dryRun).catch((error: unknown) => {
      ctx.logger.warn('hippomemo-evolve: scheduled sweep failed: ' + String(error))
    })
  }, resolved.intervalMs)
  // Initial self-healing sweep shortly after boot (never wait a full interval).
  const initial = setTimeout(() => {
    void run(resolved.dryRun).catch((error: unknown) => {
      ctx.logger.warn('hippomemo-evolve: initial sweep failed: ' + String(error))
    })
  }, Math.min(resolved.intervalMs, 5 * 60_000))
  ctx.effect(() => () => {
    clearInterval(timer)
    clearTimeout(initial)
  }, 'hippomemo.evolveTimers')

  // Write-time dedup: link high-overlap records at the source so duplicates stop
  // accumulating. Guarded by relatedIds emptiness, so the update cannot recurse.
  ctx.on('hippomemo/changed', (change) => {
    if (change.operation !== 'put') return
    const record = ctx.memory.get(change.id)
    if (record === undefined) return
    if (record.status !== 'active' && record.status !== 'candidate') return
    if (Array.isArray(record.relatedIds) && record.relatedIds.length > 0) return
    void dedupOnWrite(ctx, record, resolved).catch((error: unknown) => {
      ctx.logger.warn('hippomemo-evolve: write-time dedup failed: ' + String(error))
    })
  })

  // Manual trigger + last-report readout (exact routes win over the /hippomemo prefix).
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/hippomemo/evolve',
    handler: (req, res) => { void handleEvolveRun(req, res, run) },
  }), 'hippomemo.evolveRunRoute')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/hippomemo/evolve/last',
    handler: (_req, res) => { send(res, 200, okEnvelope(lastReport)) },
  }), 'hippomemo.evolveLastRoute')

}

async function dedupOnWrite(ctx: Context, record: MemoryRecord, resolved: ResolvedConfig): Promise<void> {
  const listed = ctx.memory.list({ status: 'active', limit: MAX_ACTIVE_RECORDS })
  let match: MemoryRecord | undefined
  for (const candidate of listed.items) {
    if (candidate.id === record.id) continue
    if (candidate.scope !== record.scope) continue
    if ((candidate.workspacePath ?? null) !== (record.workspacePath ?? null)) continue
    if (titleTokenJaccard(candidate.title, record.title) < resolved.dupTitleThreshold) continue
    match = candidate
    break
  }
  if (match === undefined) return
  const linked = [...new Set([...(record.relatedIds ?? []), match.id])].slice(0, 16)
  const mirrored = [...new Set([...(match.relatedIds ?? []), record.id])].slice(0, 16)
  await ctx.memory.update(record.id, { relatedIds: linked })
  if (mirrored.length > (match.relatedIds ?? []).length) {
    await ctx.memory.update(match.id, { relatedIds: mirrored })
  }
  ctx.logger.info(
    'hippomemo-evolve: write-time dedup linked ' + record.id.slice(0, 8) + ' ↔ ' + match.id.slice(0, 8),
  )
}

async function applyActions(ctx: Context, actions: readonly EvolveAction[], resolved: ResolvedConfig): Promise<void> {
  for (const action of actions) {
    try {
      switch (action.action) {
        case 'archive':
          await ctx.memory.update(action.id, { status: 'archived' })
          break
        case 'probation': {
          const record = ctx.memory.get(action.id)
          if (record === undefined) break
          await ctx.memory.update(action.id, { expiresAt: Date.now() + resolved.probationMs })
          break
        }
        case 'cancel-probation':
          await ctx.memory.update(action.id, { expiresAt: null })
          break
        case 'supersede': {
          if (action.targetId === undefined) break
          const winner = ctx.memory.get(action.targetId)
          const loser = ctx.memory.get(action.id)
          if (winner === undefined || loser === undefined) break
          await ctx.memory.update(winner.id, {
            relatedIds: [...new Set([...(winner.relatedIds ?? []), loser.id])].slice(0, 16),
            supersedes: winner.supersedes ?? loser.id,
          })
          await ctx.memory.update(loser.id, { status: 'superseded', supersededBy: winner.id })
          break
        }
        case 'link': {
          if (action.targetId === undefined) break
          const a = ctx.memory.get(action.id)
          const b = ctx.memory.get(action.targetId)
          if (a === undefined || b === undefined) break
          await ctx.memory.update(a.id, { relatedIds: [...new Set([...(a.relatedIds ?? []), b.id])].slice(0, 16) })
          await ctx.memory.update(b.id, { relatedIds: [...new Set([...(b.relatedIds ?? []), a.id])].slice(0, 16) })
          break
        }
        case 'downgrade-scope': {
          const record = ctx.memory.get(action.id)
          if (record === undefined) break
          if (record.scope !== 'global') break
          await ctx.memory.update(action.id, { scope: 'workspace', globalProven: false })
          break
        }
      }
    } catch (error) {
      ctx.logger.warn('hippomemo-evolve: action ' + action.action + ' on ' + action.id + ' failed: ' + String(error))
    }
  }
}


/**
 * Run one review stream and parse its verdicts. Returns undefined when the
 * model produced nothing usable (empty stream, unparseable output, or fewer
 * verdicts than candidates — missing ones default to keep, so partial output
 * is still safe).
 */
async function runReviewOnce(
  ctx: Context,
  options: GenerateOptions,
  candidates: readonly ReviewCandidate[],
): Promise<EvolveReviewVerdict[] | undefined> {
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    options.signal?.throwIfAborted()
    assembler.push(chunk)
  }
  options.signal?.throwIfAborted()
  const output = extractTextFromBlocks(assembler.blocks())
  if (output.trim().length === 0) return undefined
  const parsed = parseReviewVerdicts(output, candidates.map(candidate => candidate.id))
  if (parsed.length === 0) return undefined
  const verdicts = completeVerdicts(parsed, candidates)
  const noise = verdicts.filter(verdict => verdict.verdict === 'noise').length
  if (verdicts.some(verdict => verdict.reason === 'no verdict from review — kept by default')) {
    ctx.logger.warn('hippomemo-evolve: review output was partial; missing verdicts defaulted to keep')
  }
  ctx.logger.info('hippomemo-evolve: review classified ' + noise + '/' + verdicts.length + ' as noise')
  return verdicts
}

async function reviewProbationCandidates(
  ctx: Context,
  probations: readonly EvolveAction[],
  records: readonly MemoryRecord[],
  resolved: ResolvedConfig,
): Promise<EvolveReviewVerdict[] | undefined> {
  const byId = new Map(records.map(record => [record.id, record] as const))
  const candidates: ReviewCandidate[] = []
  for (const action of probations) {
    const record = byId.get(action.id)
    if (record === undefined) continue
    candidates.push({
      id: record.id,
      kind: record.kind,
      title: record.title,
      content: record.content,
      recallCount: record.recallCount,
    })
  }
  if (candidates.length === 0) return undefined

  const prompt = buildReviewPrompt(candidates)
  const route = resolved.reviewProvider !== undefined && resolved.reviewModel !== undefined
    ? { provider: resolved.reviewProvider, model: resolved.reviewModel }
    : ctx.agentDefaultModel.currentSelection()
  const callSignal = AbortSignal.timeout(resolved.reviewTimeoutMs)
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: prompt.user }],
      source: { kind: 'plugin', plugin: name, form: 'review' } as unknown as import('@deepseek-ai/dsh-llm').MessageSource,
    })],
    system: prompt.system,
    maxTokens: resolved.reviewMaxTokens,
    signal: callSignal,
  }
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const verdicts = await runReviewOnce(ctx, options, candidates)
      if (verdicts !== undefined) return verdicts
      if (attempt === 0) ctx.logger.warn('hippomemo-evolve: review attempt 1 produced no verdicts; retrying')
    }
    return undefined
  } catch (error) {
    ctx.logger.warn('hippomemo-evolve: review call failed, probations deferred: ' + String(error))
    return undefined
  }
}

async function handleEvolveRun(
  req: IncomingMessage,
  res: ServerResponse,
  run: (dryRun: boolean) => Promise<EvolveReport>,
): Promise<void> {
  if (req.method !== 'POST') {
    send(res, 405, errorEnvelope('METHOD_NOT_ALLOWED', 'POST required'))
    return
  }
  if (isTrustedBrowserRequest(req) === false) {
    send(res, 403, errorEnvelope('FORBIDDEN', 'cross-origin request rejected'))
    return
  }
  let dryRun = false
  if (req.headers['content-type']?.includes('application/json') === true) {
    const body = await readJsonBody(req).catch(() => undefined)
    if (body !== undefined && typeof body === 'object' && body !== null) {
      const flag = (body as { dryRun?: unknown }).dryRun
      if (typeof flag === 'boolean') dryRun = flag
    }
  }
  try {
    const report = await run(dryRun)
    send(res, 200, okEnvelope(report))
  } catch (error) {
    send(res, 500, errorEnvelope('EVOLVE_FAILED', error instanceof Error ? error.message : String(error)))
  }
}

function isTrustedBrowserRequest(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string') return true
  const host = req.headers.host
  if (typeof host !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 256 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function okEnvelope(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value }
}

function errorEnvelope(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}