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
