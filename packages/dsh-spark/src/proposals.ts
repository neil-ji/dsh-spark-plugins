/**
 * Phase 4 emergence proposal generators.
 *
 * Pure functions: take a set of sparks, return a list of proposal candidates.
 * The EmergeService persists these as ProposalRecords; the user accepts
 * or dismisses them via the inbox UI.
 *
 * Phase 4 MVP covers three rule-based proposal types:
 *  - link     two sparks with high title-token overlap
 *  - cluster  N sparks sharing M+ tags
 *  - prune    one active spark untouched for K+ days
 *
 * Phase 4.5 will layer an LLM-backed engine on top for richer proposals
 * (semantic similarity, contradict detection, auto-cluster naming).
 */
import { randomUUID } from 'node:crypto'
import type { ProposalView, ProposalType, ProposalLeverage, ReflectRequest, SparkView } from 'dsh-spark-wire'

/** Jaccard over title tokens (latin words + CJK bigrams), reused from relevance. */
function tokenize(s: string): string[] {
  const out: string[] = []
  let buf = ''
  const flushWord = (): void => {
    const w = buf.toLowerCase().trim()
    buf = ''
    if (w.length > 0) out.push(w)
  }
  for (const ch of s) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      buf += ch
    } else {
      flushWord()
      // CJK bigram: emit the previous hanzi and the current as one token.
      const last = out[out.length - 1]
      if (last !== undefined && /[\u4e00-\u9fa5]/.test(last[last.length - 1] ?? '') && /[\u4e00-\u9fa5]/.test(ch)) {
        const prev = last + ch
        out[out.length - 1] = prev
      } else if (/[\u4e00-\u9fa5]/.test(ch)) {
        // Isolated hanzi still indexed (single-character fallback).
        out.push(ch)
      }
    }
  }
  flushWord()
  return out
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter += 1
  const union = A.size + B.size - inter
  return union === 0 ? 0 : inter / union
}

/** Find all unordered pairs (i, j) with i < j. */
function pairs<T>(arr: readonly T[]): Array<[T, T]> {
  const out: Array<[T, T]> = []
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      out.push([arr[i]!, arr[j]!])
    }
  }
  return out
}

/** Group sparks by tag-set intersection (set of tags shared by all members). */
function clusterBySharedTags(
  sparks: readonly SparkView[],
  minSharedTags: number,
): Array<{ sparkIds: string[]; tags: string[] }> {
  // For each candidate pair, count shared tags; if >= minSharedTags, they may cluster.
  // Simple greedy: union-find on pairs with >= minSharedTags overlap.
  const parent = new Map<string, string>()
  for (const s of sparks) parent.set(s.id, s.id)
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) {
      const p = parent.get(r)!
      parent.set(r, parent.get(p)!)
      r = parent.get(r)!
    }
    return r
  }
  const union = (a: string, b: string): void => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const [a, b] of pairs(sparks)) {
    const setA = new Set(a.tags)
    const shared: string[] = []
    for (const t of b.tags) if (setA.has(t)) shared.push(t)
    if (shared.length >= minSharedTags) union(a.id, b.id)
  }
  const groups = new Map<string, string[]>()
  for (const s of sparks) {
    const root = find(s.id)
    const arr = groups.get(root) ?? []
    arr.push(s.id)
    groups.set(root, arr)
  }
  const out: Array<{ sparkIds: string[]; tags: string[] }> = []
  for (const ids of groups.values()) {
    if (ids.length < 2) continue // need at least 2 sparks to cluster (link covers 2-spark case)
    // Compute the shared-tag set across all members.
    if (ids.length === 0) continue
    const tagCounts = new Map<string, number>()
    for (const id of ids) {
      const s = sparks.find(x => x.id === id)
      if (s === undefined) continue
      for (const t of s.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
    }
    const allShared: string[] = []
    for (const [t, c] of tagCounts) if (c === ids.length) allShared.push(t)
    out.push({ sparkIds: ids, tags: allShared })
  }
  return out
}

/**
 * Generate all rule-based proposals from a spark set. Pure: same input →
 * same output (modulo generated UUIDs, which we strip via a deterministic
 * key the caller can use for dedup).
 */
export function generateProposals(
  sparks: readonly SparkView[],
  opts: ReflectRequest,
  now: number = Date.now(),
): Omit<ProposalView, 'id' | 'status' | 'createdAt' | 'resolvedAt'>[] {
  const out: Omit<ProposalView, 'id' | 'status' | 'createdAt' | 'resolvedAt'>[] = []
  const candidates = sparks
    .filter(s => s.status === 'active')
    .slice(0, opts.candidateLimit)

  // link: pairs with high title-token Jaccard
  for (const [a, b] of pairs(candidates)) {
    const j = jaccard(tokenize(a.title), tokenize(b.title))
    if (j >= opts.linkThreshold && j < 1) {
      out.push({
        type: 'link' as ProposalType,
        sparkIds: [a.id, b.id],
        explanation: '标题 token 重叠 ' + Math.round(j * 100) + '%：' + truncate(a.title) + ' / ' + truncate(b.title),
        confidence: j,
        leverage: 'medium' as ProposalLeverage,
      })
    }
  }

  // cluster: 3+ sparks sharing minSharedTags tags
  for (const cluster of clusterBySharedTags(candidates, opts.clusterMinSharedTags)) {
    if (cluster.sparkIds.length >= 3) {
      out.push({
        type: 'cluster' as ProposalType,
        sparkIds: cluster.sparkIds,
        explanation: cluster.sparkIds.length + ' 条火花共同标签：' + cluster.tags.join(', '),
        confidence: Math.min(1, cluster.tags.length / Math.max(1, cluster.sparkIds.length)),
        leverage: 'high' as ProposalLeverage,
      })
    }
  }

  // prune: active sparks untouched for pruneStaleDays+ days (and not crystallized)
  const staleCutoff = now - opts.pruneStaleDays * 86_400_000
  for (const s of candidates) {
    if (s.updatedAt < staleCutoff && s.crystallized === null) {
      const days = Math.floor((now - s.updatedAt) / 86_400_000)
      out.push({
        type: 'prune' as ProposalType,
        sparkIds: [s.id],
        explanation: '活跃但 ' + days + ' 天未触碰，未结晶',
        confidence: Math.min(1, days / (opts.pruneStaleDays * 2)),
        leverage: 'low' as ProposalLeverage,
      })
    }
  }

  return out
}

function truncate(s: string, max: number = 30): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

/**
 * Deterministic dedup key for a candidate proposal. Used by the storage
 * layer to avoid persisting the same proposal twice across reflect runs.
 */
export function dedupKey(candidate: Omit<ProposalView, 'id' | 'status' | 'createdAt' | 'resolvedAt'>): string {
  const ids = [...candidate.sparkIds].sort()
  return candidate.type + ':' + ids.join(',')
}

export function newProposalId(): string {
  return randomUUID()
}

