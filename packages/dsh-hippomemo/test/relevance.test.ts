/**
 * Phase 3 relevance scoring tests (pure logic, no cordis).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreRelevance, filterByRelevance, scoreRelevanceAdjusted, filterByRelevanceAdjusted, recencyDecay } from '../src/relevance.ts'
import type { MemoryRecord } from '../src/types.ts'

function makeRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: overrides.id ?? 'mem-1',
    kind: overrides.kind ?? 'insight',
    title: overrides.title ?? 'Default Title',
    content: overrides.content ?? 'Default content',
    tags: overrides.tags ?? [],
    scope: overrides.scope ?? 'project',
    workspacePath: overrides.workspacePath ?? null,
    globalProven: overrides.globalProven ?? false,
    seenWorkspaces: overrides.seenWorkspaces ?? [],
    importance: overrides.importance ?? 0.5,
    status: overrides.status ?? 'active',
    sourceSessionId: overrides.sourceSessionId ?? 'sess',
    sourceAgentId: overrides.sourceAgentId,
    sourceTurn: overrides.sourceTurn,
    revision: overrides.revision ?? 1,
    updatedBy: overrides.updatedBy ?? 'system',
    supersedes: overrides.supersedes ?? null,
    supersededBy: overrides.supersededBy ?? null,
    createdAt: overrides.createdAt ?? 1_700_000_000_000,
    updatedAt: overrides.updatedAt ?? 1_700_000_000_000,
    expiresAt: overrides.expiresAt ?? null,
    relatedIds: overrides.relatedIds ?? [],
    searchTerms: overrides.searchTerms ?? [],
    recallCount: overrides.recallCount ?? 0,
    lastRecalledAt: overrides.lastRecalledAt ?? null,
    citationCount: overrides.citationCount ?? 0,
    lastCitedAt: overrides.lastCitedAt ?? null,
  }
}

test('scoreRelevance: pure Jaccard value sanity', () => {
  // Q='cognitive filter hippo' tokens={cognitive, filter, hippo}
  // R='cognitive filter' + 'recall mode' + tags [hippo, memory] tokens (Set dedup)
  //   ={cognitive, filter, recall, mode, hippo, memory}
  // intersection=3, union=6, score=3/6=0.5
  const r = makeRecord({ title: 'cognitive filter', content: 'recall mode', tags: ['hippo', 'memory'] })
  assert.equal(scoreRelevance('cognitive filter hippo', r), 0.5)
})

test('scoreRelevance: empty query → 0', () => {
  assert.equal(scoreRelevance('', makeRecord()), 0)
})

test('scoreRelevance: empty record → 0', () => {
  const empty = makeRecord({ title: '', content: '', tags: [] })
  assert.equal(scoreRelevance('anything', empty), 0)
})

test('scoreRelevance: no overlap → 0', () => {
  const r = makeRecord({ title: 'alpha', content: 'beta gamma' })
  assert.equal(scoreRelevance('delta epsilon zeta', r), 0)
})

test('scoreRelevance: title match dominates content-only', () => {
  // Title has 'cognitive', content is unrelated
  const titled = makeRecord({ title: 'cognitive filter', content: 'random words here' })
  const untitled = makeRecord({ title: 'foo bar baz', content: 'cognitive words inside' })
  const tScore = scoreRelevance('cognitive test', titled)
  const uScore = scoreRelevance('cognitive test', untitled)
  assert.ok(tScore > uScore, 'titled should outscore untitled for same query: ' + tScore + ' vs ' + uScore)
})

test('scoreRelevance: tags contribute weight', () => {
  const withTags = makeRecord({ title: 'memory', content: 'x', tags: ['cognitive', 'prefrontal'] })
  const without = makeRecord({ title: 'memory', content: 'x', tags: [] })
  const q = 'cognitive filter'
  assert.ok(scoreRelevance(q, withTags) > scoreRelevance(q, without))
})

test('scoreRelevance: pure Jaccard value sanity', () => {
  // query: [a, b], record: [a, c, d]
  // intersection = {a} = 1, union = {a,b,c,d} = 4, score = 0.25
  const r = makeRecord({ title: 'a c d', content: '', tags: [] })
  assert.equal(scoreRelevance('a b', r), 0.25)
})

test('filterByRelevance: drops below threshold', () => {
  const relevant = makeRecord({ id: 'A', title: 'cognitive filter', content: 'recall mode' })
  const irrelevant = makeRecord({ id: 'B', title: 'banana split', content: 'ice cream' })
  const items = [{ record: relevant, matchedReason: ['q'] }, { record: irrelevant, matchedReason: ['q'] }]
  const kept = filterByRelevance(items, 'cognitive', 0.1)
  assert.equal(kept.length, 1)
  assert.equal(kept[0]!.record.id, 'A')
})

test('filterByRelevance: threshold 0 keeps all', () => {
  const items = [
    { record: makeRecord({ id: 'A', title: 'foo' }), matchedReason: [] },
    { record: makeRecord({ id: 'B', title: 'bar' }), matchedReason: [] },
  ]
  assert.equal(filterByRelevance(items, 'totally unrelated', 0).length, 2)
})

test('filterByRelevance: threshold 1 keeps only identical token sets', () => {
  const exact = makeRecord({ id: 'A', title: 'cognitive', content: 'cognitive' })
  const partial = makeRecord({ id: 'B', title: 'cognitive', content: 'other' })
  const items = [{ record: exact, matchedReason: [] }, { record: partial, matchedReason: [] }]
  // Exact match only when query token set == record token set (after dedup).
  // A: Q={cognitive}, R={cognitive} → score=1.0 kept.
  // B: Q={cognitive}, R={cognitive, other} → score=0.5 dropped.
  const kept = filterByRelevance(items, 'cognitive', 1)
  assert.equal(kept.length, 1, 'only A has identical token set')
  assert.equal(kept[0]!.record.id, 'A')
})

test('filterByRelevance: preserves input order', () => {
  const items = [
    { record: makeRecord({ id: 'A', title: 'cognitive alpha', content: '' }), matchedReason: [] },
    { record: makeRecord({ id: 'B', title: 'cognitive beta', content: '' }), matchedReason: [] },
    { record: makeRecord({ id: 'C', title: 'cognitive gamma', content: '' }), matchedReason: [] },
  ]
  const kept = filterByRelevance(items, 'cognitive', 0.1)
  assert.deepEqual(kept.map(item => item.record.id), ['A', 'B', 'C'])
})
console.log('relevance tests loaded')

// ---- Phase 6.5: cognitive-adjusted relevance (preference boost + recency decay) ----

test('recencyDecay: returns 1 when never recalled and updated now', () => {
  const now = 1_700_000_000_000
  const fresh = makeRecord({ lastRecalledAt: null, updatedAt: now })
  assert.equal(recencyDecay(fresh, now), 1)
})

test('recencyDecay: ~0.5 at 30-day half-life, floor 0.4 at 300 days', () => {
  const now = 1_700_000_000_000
  const day = 86_400_000
  const thirtyDays = makeRecord({ lastRecalledAt: now - 30 * day, updatedAt: now - 30 * day })
  const d30 = recencyDecay(thirtyDays, now)
  assert.ok(d30 > 0.45 && d30 < 0.55, '30d half-life ~0.5, got ' + d30)
  const ancient = makeRecord({ lastRecalledAt: now - 300 * day, updatedAt: now - 300 * day })
  assert.equal(recencyDecay(ancient, now), 0.4, 'floor 0.4 at long age')
})

test('scoreRelevanceAdjusted: preference kind gets multiplicative bonus', () => {
  const now = 1_700_000_000_000
  const fact = makeRecord({ kind: 'fact', title: 'hippo', content: 'memory system' })
  const pref = makeRecord({ id: 'mem-pref', kind: 'preference', title: 'hippo', content: 'memory system' })
  const scoreFact = scoreRelevance('hippo memory', fact, now)
  const scorePref = scoreRelevanceAdjusted('hippo memory', pref, now)
  assert.ok(scorePref > scoreFact * 1.2, 'preference boost expected ~1.3x; got fact=' + scoreFact + ' pref=' + scorePref)
})

test('scoreRelevanceAdjusted: non-preference records have no preference boost', () => {
  const now = 1_700_000_000_000
  const base = makeRecord({ kind: 'fact', title: 'hippo', content: 'memory' })
  assert.equal(scoreRelevanceAdjusted('hippo memory', base, now), scoreRelevance('hippo memory', base))
})

test('scoreRelevanceAdjusted: stale preference decays toward floor', () => {
  const day = 86_400_000
  const now = 1_700_000_000_000
  const fresh = makeRecord({ kind: 'preference', title: 'hippo', content: 'memory', lastRecalledAt: now - day, updatedAt: now - day })
  const stale = makeRecord({ kind: 'preference', title: 'hippo', content: 'memory', lastRecalledAt: now - 200 * day, updatedAt: now - 200 * day })
  const freshScore = scoreRelevanceAdjusted('hippo memory', fresh, now)
  const staleScore = scoreRelevanceAdjusted('hippo memory', stale, now)
  assert.ok(freshScore > staleScore, 'fresh > stale; fresh=' + freshScore + ' stale=' + staleScore)
  assert.ok(staleScore > scoreRelevance('hippo memory', stale) * 0.4, 'stale retains floor-40% preference boost')
})

test('filterByRelevanceAdjusted: drops below threshold under Phase 6.5 rules', () => {
  const items = [
    { record: makeRecord({ id: 'A', kind: 'fact', title: 'cognitive alpha', content: '' }), matchedReason: [] },
    { record: makeRecord({ id: 'P', kind: 'preference', title: 'cognitive beta', content: '' }), matchedReason: [] },
    { record: makeRecord({ id: 'C', kind: 'constraint', title: 'unrelated gamma', content: '' }), matchedReason: [] },
  ]
  const kept = filterByRelevanceAdjusted(items, 'cognitive beta', 0.1, 1_700_000_000_000)
  const ids = kept.map(item => item.record.id)
  assert.ok(ids.includes('P'), 'preference beta must be kept')
  assert.ok(!ids.includes('C'), 'unrelated gamma must be dropped')
})

test('filterByRelevanceAdjusted: threshold 0 keeps all, threshold 1 keeps only identical', () => {
  const items = [{ record: makeRecord({ title: 'x', content: '' }), matchedReason: [] }]
  assert.equal(filterByRelevanceAdjusted(items, 'whatever', 0, 1_700_000_000_000).length, 1)
  assert.equal(filterByRelevanceAdjusted(items, 'whatever', 1, 1_700_000_000_000).length, 0)
});
