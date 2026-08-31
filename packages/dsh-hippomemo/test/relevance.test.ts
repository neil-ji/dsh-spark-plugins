/**
 * Phase 3 relevance scoring tests (pure logic, no cordis).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreRelevance, filterByRelevance } from '../src/relevance.ts'
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
console.log('relevance tests loaded');
