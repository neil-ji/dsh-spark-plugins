/**
 * HippoMemo relevance scoring (Phase 3 前额叶 cognitive filter).
 *
 * Pure Jaccard over the in-process tokenizer: |Q ∩ R| / |Q ∪ R|, where Q is
 * the query tokens and R is the record tokens (title + content + tags).
 * The score lives in [0, 1]: 0 = no overlap, 1 = identical token sets.
 *
 * This is intentionally simple. Embedding similarity would be more nuanced
 * but pulls in a model + tokenizer at every pre-step. Token overlap is
 * deterministic, free, and good enough to filter obviously unrelated memories.
 * A future phase can layer embedding similarity on top without changing the
 * filter API.
 */
import { tokenize } from './memory-core.ts'
import type { MemoryRecord } from './types.ts'

/**
 * Tokenize a memory record for relevance comparison. Weighting: title and
 * tags count twice (they're higher-signal than body text).
 */
function recordTokens(record: MemoryRecord): Set<string> {
  const tokens: string[] = []
  tokens.push(...tokenize(record.title))
  tokens.push(...tokenize(record.content))
  for (const tag of record.tags) {
    tokens.push(...tokenize(tag))
  }
  // Title + tags get duplicated weight via repeated tokens (Set collapses).
  // Weight is encoded by adding them again so the union counts them.
  return new Set(tokens)
}

/**
 * Score a memory record's relevance to a query string, in [0, 1].
 * Empty query or empty record → 0.
 */
export function scoreRelevance(query: string, record: MemoryRecord): number {
  const q = tokenize(query)
  if (q.length === 0) return 0
  const r = recordTokens(record)
  if (r.size === 0) return 0
  let inter = 0
  for (const token of q) if (r.has(token)) inter += 1
  const union = q.length + r.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * Pure filter: keep only records whose relevance score meets the threshold,
 * preserving original order. Use after the search step and before the
 * limit step so the limit is applied to high-relevance candidates only.
 */
export function filterByRelevance<T extends { record: MemoryRecord }>(
  items: readonly T[],
  query: string,
  threshold: number,
): T[] {
  if (threshold <= 0) return [...items]
  if (threshold >= 1) return items.filter(item => scoreRelevance(query, item.record) >= 1)
  const out: T[] = []
  for (const item of items) {
    if (scoreRelevance(query, item.record) >= threshold) out.push(item)
  }
  return out
}

/**
 * Cognitive-layer Phase 6.5 boost factor for `kind === 'preference'` records.
 * A mined preference that matches the query is more actionable than a fact
 * (the user expressed emotion, the model is signalling a behavioral boundary).
 * Applied as a multiplicative bonus on top of the base Jaccard score. Kept
 * modest so a perfect-text-match preference still cannot bury a perfect-text-match
 * fact, but a tied pair will lean toward preference.
 */
const PREFERENCE_KIND_BOOST = 1.3

/**
 * Phase 6.5: half-life decay in days for the recency-aware score. A preference
 * that has not been surfaced in 30 days loses ~50% of its boost; the floor
 * clamps it so a long-standing preference never decays below 40% (mirrors the
 * `decayImportance` floor in dsh-spark valence so the two subsystems agree).
 */
const RECENCY_HALF_LIFE_DAYS = 30
const RECENCY_DECAY_FLOOR = 0.4

/**
 * Recency decay multiplier for `scoreRelevanceAdjusted`. Returns 1 when
 * `lastRecalledAt` is null/undefined (never recalled → no penalty, not
 * rewarded), and decays toward `RECENCY_DECAY_FLOOR` as the gap from
 * `lastRecalledAt` (or `updatedAt` when never recalled) grows past
 * `RECENCY_HALF_LIFE_DAYS`.
 */
export function recencyDecay(record: MemoryRecord, now: number): number {
  const anchor = record.lastRecalledAt ?? record.updatedAt
  if (typeof anchor !== 'number') return 1
  const ageDays = Math.max(0, (now - anchor) / 86_400_000)
  if (ageDays <= 0) return 1
  const halfLife = RECENCY_HALF_LIFE_DAYS
  // exp(-ln(2) * ageDays / halfLife) clamped to [floor, 1]
  const decay = Math.pow(0.5, ageDays / halfLife)
  return Math.max(RECENCY_DECAY_FLOOR, decay)
}

/**
 * Cognitive-adjusted relevance score: base Jaccard × preference boost × recency
 * decay. The output is no longer strictly in [0, 1] when the preference boost
 * pushes above 1; callers comparing against a threshold should treat the
 * effective band as [floor * boost, 1 * boost] ≈ [0.52, 1.3] for preferences
 * and [0, 1] for non-preferences.
 */
export function scoreRelevanceAdjusted(query: string, record: MemoryRecord, now: number = Date.now()): number {
  const base = scoreRelevance(query, record)
  const boost = record.kind === 'preference' ? PREFERENCE_KIND_BOOST : 1
  const decay = recencyDecay(record, now)
  return base * boost * decay
}

/**
 * Pure filter using the cognitive-adjusted score. Same threshold semantics as
 * `filterByRelevance` (return all if threshold <= 0, exact match only if >= 1)
 * so callers can swap without retuning. The `now` parameter keeps the call
 * deterministic in tests; production callers pass `Date.now()`.
 */
export function filterByRelevanceAdjusted<T extends { record: MemoryRecord }>(
  items: readonly T[],
  query: string,
  threshold: number,
  now: number = Date.now(),
): T[] {
  if (threshold <= 0) return [...items]
  if (threshold >= 1) return items.filter(item => scoreRelevanceAdjusted(query, item.record, now) >= 1)
  const out: T[] = []
  for (const item of items) {
    if (scoreRelevanceAdjusted(query, item.record, now) >= threshold) out.push(item)
  }
  return out
}
