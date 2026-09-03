/**
 * Tests for the v3 UI helpers exported from memory-evolve and memory-service.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { derivePendingCandidates } from '../src/memory-evolve.ts'
import type { MemoryRecord } from '../src/types.ts'

function makeRecord(over: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: over.id ?? 'r-' + Math.random().toString(36).slice(2),
    kind: over.kind ?? 'insight',
    title: over.title ?? 'untitled',
    content: over.content ?? 'body',
    tags: over.tags ?? [],
    scope: over.scope ?? 'workspace',
    workspacePath: over.workspacePath ?? null,
    globalProven: over.globalProven ?? false,
    seenWorkspaces: over.seenWorkspaces ?? [],
    importance: over.importance ?? 0.5,
    status: over.status ?? 'active',
    sourceSessionId: 'sess-1',
    revision: 1, updatedBy: 'human',
    supersedes: null, supersededBy: null,
    createdAt: over.createdAt ?? 1_000,
    updatedAt: over.updatedAt ?? 1_000,
    expiresAt: over.expiresAt ?? null,
    relatedIds: [], searchTerms: [],
    recallCount: over.recallCount ?? 0,
    lastRecalledAt: over.lastRecalledAt ?? null,
    citationCount: over.citationCount ?? 0,
    lastCitedAt: over.lastCitedAt ?? null,
    ...over,
  }
}

test('derivePendingCandidates returns no candidates for an empty corpus', () => {
  const result = derivePendingCandidates([], { now: 1_000_000 })
  assert.equal(result.items.length, 0)
  assert.equal(result.byKind.expired, 0)
  assert.equal(result.byKind['near-duplicate'], 0)
  assert.equal(result.byKind.observation, 0)
  assert.equal(result.byKind['preference-review'], 0)
})

test('derivePendingCandidates flags expired active records as expired candidates', () => {
  const expired = makeRecord({ id: 'a', kind: 'fact', expiresAt: 500, citationCount: 0 })
  const live = makeRecord({ id: 'b', kind: 'fact' })
  const result = derivePendingCandidates([expired, live], { now: 1_000 })
  const expiredCand = result.items.find(c => c.id === 'a')
  assert.ok(expiredCand, 'expected candidate for expired record')
  assert.equal(expiredCand.kind, 'expired')
  assert.equal(expiredCand.suggestedAction, 'archive')
  assert.equal(result.byKind.expired, 1)
})

test('derivePendingCandidates flags near-duplicate titles as near-duplicate candidates', () => {
  const a = makeRecord({ id: 'a', kind: 'fact', title: 'gitignore must include .env files' })
  const b = makeRecord({ id: 'b', kind: 'fact', title: 'gitignore must include .env local files', recallCount: 6 })
  const result = derivePendingCandidates([a, b], { now: 1_000_000 })
  const nearDups = result.items.filter(c => c.kind === 'near-duplicate')
  assert.equal(nearDups.length >= 1, true, 'expected at least one near-duplicate candidate')
  for (const cand of nearDups) {
    assert.equal(cand.suggestedAction === 'supersede' || cand.suggestedAction === 'link', true)
  }
  assert.equal(result.byKind['near-duplicate'] >= 1, true)
})

test('uncited recall-heavy records are NOT todos (engine-owned probation, no human step)', () => {
  const noisy = makeRecord({
    id: 'noisy', kind: 'insight',
    title: 'noise', content: 'noise',
    recallCount: 20, citationCount: 0,
    createdAt: 100, updatedAt: 100,
  })
  const result = derivePendingCandidates([noisy], { now: 1_000_000 })
  assert.equal(result.items.some(c => c.id === 'noisy'), false)
  assert.equal(result.byKind.observation, 0)
})

test('records already on observation surface as read-only status rows with deadline', () => {
  const onProbation = makeRecord({
    id: 'obs', kind: 'insight',
    title: 'under observation',
    recallCount: 20, citationCount: 0,
    createdAt: 100, updatedAt: 100,
    expiresAt: 1_000_000 + 7 * 86_400_000,
  })
  const result = derivePendingCandidates([onProbation], { now: 1_000_000 })
  const row = result.items.find(c => c.id === 'obs')
  assert.ok(row, 'expected read-only observation row')
  assert.equal(row.kind, 'observation')
  assert.equal(row.suggestedAction, 'cancel-probation')
  assert.equal(row.expiresAt, 1_000_000 + 7 * 86_400_000)
  assert.match(row.reason, /剩 7 天/)
  assert.equal(result.byKind.observation, 1)
})

test('derivePendingCandidates flags downgrade-scope for unproven global under-recall', () => {
  const global = makeRecord({
    id: 'g1', kind: 'preference', scope: 'global', globalProven: false,
    title: 'declared global', content: '...',
    recallCount: 12, seenWorkspaces: ['/workspace/a'],
    createdAt: 100, updatedAt: 100,
  })
  const result = derivePendingCandidates([global], { now: 1_000_000 })
  const cand = result.items.find(c => c.id === 'g1')
  assert.ok(cand, 'expected downgrade-scope candidate')
  assert.equal(cand.suggestedAction, 'downgrade-scope')
  assert.equal(cand.kind, 'preference-review')
})

test('derivePendingCandidates never surfaces cancel-probation as a candidate row', () => {
  const candidate = makeRecord({
    id: 'x', kind: 'fact', title: 'cited',
    recallCount: 5, citationCount: 1,
    expiresAt: 500,
  })
  const result = derivePendingCandidates([candidate], { now: 1_000 })
  const cancelRows = result.items.filter(c => c.suggestedAction === 'cancel-probation')
  assert.equal(cancelRows.length, 0, 'cancel-probation is informational, not a candidate')
})

test('derivePendingCandidates sorts importance-bearing metadata correctly', () => {
  const important = makeRecord({ id: 'i1', kind: 'fact', title: 'keep', expiresAt: 500, importance: 0.9 })
  const minor = makeRecord({ id: 'i2', kind: 'fact', title: 'minor', expiresAt: 500, importance: 0.2 })
  const result = derivePendingCandidates([important, minor], { now: 1_000 })
  const ids = result.items.map(c => c.id)
  assert.ok(ids.includes('i1') && ids.includes('i2'))
  for (const cand of result.items) assert.equal(typeof cand.importance, 'number')
})