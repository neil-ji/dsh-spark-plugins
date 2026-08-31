/**
 * Emergence service (Phase 4 DMN).
 *
 * Runs rule-based emergence over the active spark set, persists
 * proposals (dedup'd), and emits cordis events for the Web UI.
 *
 * Phase 4 MVP: manual trigger via spark_reflect tool + reflect HTTP endpoint.
 * Phase 4.5+ will add: periodic scheduler (intervalMs), LLM-backed
 * proposal generation (semantic similarity + contradict detection).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  proposalViewSchema,
  reflectRequestSchema,
  type ProposalView,
  type ReflectRequest,
  type SparkView,
} from 'dsh-spark-wire'
import type { SparkChangedEvent } from './types.ts'
import { JsonlProposalStorage } from './proposal-storage.ts'
import { generateProposals, dedupKey, newProposalId } from './proposals.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    emerge: EmergeService
  }
  interface Events {
    'proposals/changed'(change: { at: number; newProposals: ProposalView[]; resolvedProposal: ProposalView | null }): void
  }
}

export interface EmergeConfig {
  /** Path to the proposals JSONL file. Defaults to $DSH_HOME/storages/sparks/proposals.jsonl. */
  filePath?: string
}

function defaultFilePath(): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'sparks', 'proposals.jsonl')
}

/**
 * Sorted-key stable serializer for the dedup key so the same candidate set
 * always produces the same key string.
 */
export interface EmergeRunResult {
  /** New proposals persisted (already dedup'd against existing pending ones). */
  newProposals: ProposalView[]
  /** Total candidates considered (before dedup). */
  candidatesGenerated: number
  /** How many were skipped because a pending proposal already exists. */
  skippedDuplicate: number
}

export class EmergeService extends Service {
  static inject = ['spark'] as const

  private readonly filePath: string
  private storage: JsonlProposalStorage
  private running = false

  constructor(ctx: Context, config: EmergeConfig = {}) {
    super(ctx, 'emerge')
    this.filePath = config.filePath ?? defaultFilePath()
    this.storage = new JsonlProposalStorage(this.filePath)
    this.ensureDir()
      .catch(error => { ctx.logger?.error?.('emerge: init failed: ' + String(error)) })
  }

  private async ensureDir(): Promise<void> {
    const dir = this.filePath.replace(/[/][^/]+$/, '')
    await fs.mkdir(dir, { recursive: true })
  }

  /** Read all proposals. */
  async list(): Promise<ProposalView[]> {
    const all = await this.storage.readAll()
    return all.sort((a, b) => {
      // leverage desc, then confidence desc, then createdAt asc (oldest first)
      const ld = leverageRank(b.leverage) - leverageRank(a.leverage)
      if (ld !== 0) return ld
      const cd = b.confidence - a.confidence
      if (Math.abs(cd) > 1e-9) return cd
      return a.createdAt - b.createdAt
    })
  }

  /** Mark a proposal accepted or dismissed. Returns null if id is unknown. */
  async resolve(id: string, status: 'accepted' | 'dismissed', now: number = Date.now()): Promise<ProposalView | null> {
    if (status !== 'accepted' && status !== 'dismissed') {
      throw new TypeError('emerge.resolve: status must be accepted or dismissed')
    }
    const updated = await this.storage.patch(id, status, now)
    if (updated !== null) {
      this.ctx.emit('proposals/changed', { at: now, newProposals: [], resolvedProposal: updated })
      // Accept side-effect: archive prune-target sparks so the proposal has bite.
      if (status === 'accepted' && updated.type === 'prune') {
        for (const sparkId of updated.sparkIds) {
          await this.ctx.spark.archive(sparkId as Parameters<typeof this.ctx.spark.archive>[0], now).catch(() => {})
        }
      }
    }
    return updated
  }

  /**
   * Run emergence now (manual reflect trigger).
   * Returns the new proposals persisted (dedup'd against existing pending ones).
   */
  async reflect(input: unknown, now: number = Date.now()): Promise<EmergeRunResult> {
    if (this.running) {
      return { newProposals: [], candidatesGenerated: 0, skippedDuplicate: 0 }
    }
    this.running = true
    try {
      return await this.doReflect(input, now)
    } finally {
      this.running = false
    }
  }

  private async doReflect(input: unknown, now: number): Promise<EmergeRunResult> {
    const opts: ReflectRequest = reflectRequestSchema.parse(input)
    const sparks = await this.ctx.spark.list({ status: 'active', limit: opts.candidateLimit * 2 })
    const candidates = generateProposals(sparks as SparkView[], opts, now)
    const existing = await this.storage.readAll()
    const pendingKeys = new Set(
      existing.filter(p => p.status === 'pending').map(p => dedupKeyForView(p)),
    )
    const toPersist: ProposalView[] = []
    let skippedDuplicate = 0
    for (const c of candidates) {
      const key = dedupKey(c)
      if (pendingKeys.has(key)) {
        skippedDuplicate += 1
        continue
      }
      const record: ProposalView = proposalViewSchema.parse({
        id: newProposalId(),
        type: c.type,
        sparkIds: c.sparkIds,
        explanation: c.explanation,
        confidence: c.confidence,
        leverage: c.leverage,
        status: 'pending',
        createdAt: now,
        resolvedAt: null,
      })
      pendingKeys.add(key)
      toPersist.push(record)
    }
    if (toPersist.length === 0) {
      return { newProposals: [], candidatesGenerated: candidates.length, skippedDuplicate }
    }
    const next = [...existing, ...toPersist]
    await this.storage.writeAll(next)
    this.ctx.emit('proposals/changed', { at: now, newProposals: toPersist, resolvedProposal: null })
    return { newProposals: toPersist, candidatesGenerated: candidates.length, skippedDuplicate }
  }

  /** Test-only: swap the storage backend. */
  setStorageForTest(storage: JsonlProposalStorage): void {
    this.storage = storage
  }
}

function leverageRank(l: ProposalView['leverage']): number {
  if (l === 'high') return 2
  if (l === 'medium') return 1
  return 0
}

function dedupKeyForView(p: ProposalView): string {
  const ids = [...p.sparkIds].sort()
  return p.type + ':' + ids.join(',')
}

/** Reserved: explicit hook so future LLM-backed proposals can subscribe to sparks/changed. */
type _Reserved = SparkChangedEvent
