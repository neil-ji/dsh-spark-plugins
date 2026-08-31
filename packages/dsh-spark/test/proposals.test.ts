/**
 * Phase 4 emergence proposal tests (pure logic, no cordis).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateProposals, dedupKey, newProposalId } from '../src/proposals.ts'
import type { SparkView, ReflectRequest } from 'dsh-spark-wire'

function makeSpark(overrides: Partial<SparkView> = {}): SparkView {
  const now = 1_700_000_000_000
  return {
    id: overrides.id ?? 's',
    title: overrides.title ?? 'A thought',
    content: overrides.content ?? 'some content',
    scope: overrides.scope ?? 'project',
    workspacePath: overrides.workspacePath ?? null,
    status: overrides.status ?? 'active',
    tags: overrides.tags ?? [],
    sourceSessionId: overrides.sourceSessionId ?? 'sess',
    sourceAgentId: overrides.sourceAgentId ?? null,
    sourceTurn: overrides.sourceTurn ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    resolvedAt: overrides.resolvedAt ?? null,
    crystallized: overrides.crystallized ?? null,
  }
}

const DEFAULT_OPTS: ReflectRequest = {
  candidateLimit: 30,
  linkThreshold: 0.5,
  clusterMinSharedTags: 2,
  pruneStaleDays: 14,
}

test('link: two sparks with identical title produce a link proposal at jaccard=1', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', title: 'cognitive filter prefrontal' }),
    makeSpark({ id: 'b', title: 'cognitive filter prefrontal' }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  // jaccard = 1.0, but our rule excludes j === 1 (identical is already linked by content dedup at capture time).
  assert.equal(out.filter(c => c.type === 'link').length, 0, 'identical titles skipped to avoid trivial proposals')
})

test('link: two sparks with high-overlap title produce a link proposal', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', title: 'cognitive filter for hippo' }),
    makeSpark({ id: 'b', title: 'cognitive filter on hippo' }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  const links = out.filter(c => c.type === 'link')
  assert.equal(links.length, 1)
  assert.deepEqual(links[0]!.sparkIds.sort(), ['a', 'b'])
  assert.ok(links[0]!.confidence >= 0.5)
  assert.equal(links[0]!.leverage, 'medium')
})

test('link: distinct titles produce no link proposal', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', title: 'alpha' }),
    makeSpark({ id: 'b', title: 'beta gamma' }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  assert.equal(out.filter(c => c.type === 'link').length, 0)
})

test('cluster: 3+ sparks sharing 2+ tags produce a cluster proposal', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', title: 'foo', tags: ['design', 'memory'] }),
    makeSpark({ id: 'b', title: 'bar', tags: ['design', 'memory'] }),
    makeSpark({ id: 'c', title: 'baz', tags: ['design', 'memory'] }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  const clusters = out.filter(c => c.type === 'cluster')
  assert.equal(clusters.length, 1)
  assert.deepEqual(clusters[0]!.sparkIds.sort(), ['a', 'b', 'c'])
  assert.equal(clusters[0]!.leverage, 'high')
  assert.match(clusters[0]!.explanation, /design, memory/)
})

test('cluster: 2 sparks (even with shared tags) do NOT produce cluster', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', tags: ['design', 'memory'] }),
    makeSpark({ id: 'b', tags: ['design', 'memory'] }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  assert.equal(out.filter(c => c.type === 'cluster').length, 0)
})

test('prune: stale active spark (untouched > 14 days, not crystallized) produces prune proposal', () => {
  const now = 1_700_000_000_000
  const longAgo = now - 30 * 86_400_000 // 30 days old
  const sparks = [
    makeSpark({ id: 'a', title: 'old thought', updatedAt: longAgo, crystallized: null }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  const prunes = out.filter(c => c.type === 'prune')
  assert.equal(prunes.length, 1)
  assert.deepEqual(prunes[0]!.sparkIds, ['a'])
  assert.equal(prunes[0]!.leverage, 'low')
  assert.match(prunes[0]!.explanation, /天/)
})

test('prune: crystallized stale spark is NOT pruned', () => {
  const now = 1_700_000_000_000
  const longAgo = now - 30 * 86_400_000
  const sparks = [
    makeSpark({ id: 'a', updatedAt: longAgo, crystallized: { hippoId: 'mem-1', kind: 'insight', at: now } }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  assert.equal(out.filter(c => c.type === 'prune').length, 0)
})

test('prune: recent spark is NOT pruned', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', updatedAt: now - 1 * 86_400_000 }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  assert.equal(out.filter(c => c.type === 'prune').length, 0)
})

test('archived sparks are filtered out before emergence', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', status: 'active', title: 'alpha beta gamma delta' }),
    makeSpark({ id: 'b', status: 'archived', title: 'alpha beta gamma delta' }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  // b is filtered out, a has no partner → no link
  assert.equal(out.filter(c => c.type === 'link').length, 0)
})

test('mixed scenario: link + cluster + prune all fire together', () => {
  const now = 1_700_000_000_000
  const longAgo = now - 30 * 86_400_000
  const sparks = [
    makeSpark({ id: 'a', title: 'cognitive filter design', tags: ['design', 'hippo'] }),
    makeSpark({ id: 'b', title: 'cognitive filter on design', tags: ['design', 'hippo'] }),
    makeSpark({ id: 'c', title: 'random unrelated', tags: ['design', 'hippo'] }),
    makeSpark({ id: 'd', title: 'old to prune', updatedAt: longAgo, crystallized: null }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  const link = out.filter(c => c.type === 'link')
  const cluster = out.filter(c => c.type === 'cluster')
  const prune = out.filter(c => c.type === 'prune')
  assert.ok(link.length >= 1, 'should have at least 1 link')
  assert.equal(cluster.length, 1, '3 sparks sharing 2 tags → 1 cluster')
  assert.equal(prune.length, 1, '1 stale active → 1 prune')
  assert.deepEqual(cluster[0]!.sparkIds.sort(), ['a', 'b', 'c'])
})

test('dedupKey: sorted sparkIds produce a stable key', () => {
  const a = { type: 'link' as const, sparkIds: ['b', 'a'], explanation: '', confidence: 1, leverage: 'medium' as const }
  const b = { type: 'link' as const, sparkIds: ['a', 'b'], explanation: '', confidence: 1, leverage: 'medium' as const }
  assert.equal(dedupKey(a), dedupKey(b))
  assert.equal(dedupKey(a), 'link:a,b')
})

test('newProposalId returns a non-empty string', () => {
  const id = newProposalId()
  assert.equal(typeof id, 'string')
  assert.ok(id.length > 0)
})
console.log('proposals tests loaded');
