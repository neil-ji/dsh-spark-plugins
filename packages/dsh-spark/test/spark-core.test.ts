/**
 * Phase 1+2 tests for dsh-spark core: JSONL storage round-trip, atomic rewrite,
 * patch and remove semantics, plus crystallize-input mapping. The SparkService
 * class itself is exercised via the storage interface here; cordis integration
 * is covered by 3999 dogfood.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlSparkStorage } from '../src/storage.ts'
import { buildHippoInputFromSpark, deriveTitle } from '../src/types.ts'
import type { SparkView } from 'dsh-spark-wire'

function makeRecord(overrides: Partial<SparkView> = {}): SparkView {
  const now = 1_700_000_000_000
  return {
    id: overrides.id ?? 'rec-1',
    title: overrides.title ?? 'a thought',
    content: overrides.content ?? 'I should remember this',
    scope: overrides.scope ?? 'project',
    workspacePath: overrides.workspacePath ?? '/tmp/proj',
    status: overrides.status ?? 'active',
    tags: overrides.tags ?? ['design', 'idea'],
    sourceSessionId: overrides.sourceSessionId ?? 'sess-1',
    sourceAgentId: overrides.sourceAgentId ?? 'agent-1',
    sourceTurn: overrides.sourceTurn ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    resolvedAt: overrides.resolvedAt ?? null,
    crystallized: overrides.crystallized ?? null,
  }
}

async function withTmpStorage(): Promise<{ storage: JsonlSparkStorage; file: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-spark-test-'))
  const file = join(dir, 'sparks.jsonl')
  const storage = new JsonlSparkStorage(file)
  return {
    storage,
    file,
    cleanup: async () => { await rm(dir, { recursive: true, force: true }) },
  }
}

// ----- storage tests -----

test('append + readAll round-trips records verbatim (incl. crystallized)', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  const a = makeRecord({ id: 'a' })
  const b = makeRecord({ id: 'b', crystallized: { hippoId: 'mem-1', kind: 'insight', at: 1 } })
  await storage.append(a)
  await storage.append(b)
  const all = await storage.readAll()
  assert.equal(all.length, 2)
  assert.equal(all[0]!.crystallized, null)
  assert.deepEqual(all[1]!.crystallized, { hippoId: 'mem-1', kind: 'insight', at: 1 })
})

test('writeAll replaces the entire store (used by crystallize)', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  const now = 1_700_000_000_000
  await storage.append(makeRecord({ id: 'a' }))
  await storage.append(makeRecord({ id: 'b' }))
  await storage.writeAll([
    makeRecord({ id: 'a', crystallized: { hippoId: 'mem-1', kind: 'fact', at: now } }),
    makeRecord({ id: 'b', crystallized: { hippoId: 'mem-2', kind: 'preference', at: now } }),
  ])
  const all = await storage.readAll()
  assert.equal(all.length, 2)
  for (const r of all) {
    assert.notEqual(r.crystallized, null, r.id + ' should be crystallized')
  }
})

// ----- buildHippoInputFromSpark (pure mapper) -----

test('buildHippoInputFromSpark: project spark + default opts', () => {
  const spark = makeRecord({ scope: 'project' })
  const out = buildHippoInputFromSpark(spark, { kind: 'insight', importance: 0.5, globalProven: false })
  assert.equal(out.kind, 'insight')
  assert.equal(out.title, spark.title)
  assert.equal(out.content, spark.content)
  assert.deepEqual(out.tags, spark.tags)
  assert.equal(out.scope, 'project')
  assert.equal(out.workspacePath, spark.workspacePath)
  assert.equal(out.importance, 0.5)
  assert.equal(out.globalProven, false)
  assert.equal(out.sourceSessionId, spark.sourceSessionId)
  assert.equal(out.sourceAgentId, spark.sourceAgentId)
})

test('buildHippoInputFromSpark: session-bound spark maps to project scope', () => {
  const spark = makeRecord({ scope: 'session' })
  const out = buildHippoInputFromSpark(spark, { kind: 'fact', importance: 0.7, globalProven: false })
  assert.equal(out.scope, 'project', 'session must fold to project in hippo')
})

test('buildHippoInputFromSpark: opts.scope=session folds to project', () => {
  const spark = makeRecord({ scope: 'project' })
  const out = buildHippoInputFromSpark(spark, { kind: 'preference', importance: 0.9, scope: 'session', globalProven: false })
  assert.equal(out.scope, 'project')
})

test('buildHippoInputFromSpark: opts.scope=global passes through and sets globalProven', () => {
  const spark = makeRecord({ scope: 'global' })
  const out = buildHippoInputFromSpark(spark, { kind: 'decision', importance: 0.6, scope: 'global', globalProven: true })
  assert.equal(out.scope, 'global')
  assert.equal(out.globalProven, true)
})

test('buildHippoInputFromSpark: spark.scope=global without opts.scope -> global', () => {
  const spark = makeRecord({ scope: 'global' })
  const out = buildHippoInputFromSpark(spark, { kind: 'insight', importance: 0.5, globalProven: false })
  assert.equal(out.scope, 'global')
})

test('buildHippoInputFromSpark: preserves sourceSessionId + agentId for traceability', () => {
  const spark = makeRecord({ sourceSessionId: 'sess-X', sourceAgentId: 'agent-Y' })
  const out = buildHippoInputFromSpark(spark, { kind: 'constraint', importance: 1, globalProven: false })
  assert.equal(out.sourceSessionId, 'sess-X')
  assert.equal(out.sourceAgentId, 'agent-Y')
})

test('buildHippoInputFromSpark: threads spark.id as the Phase 2 reverse link', () => {
  const spark = makeRecord({ id: 'sp-123' })
  const out = buildHippoInputFromSpark(spark, { kind: 'insight', importance: 0.5, globalProven: false })
  assert.equal(out.sourceSparkId, 'sp-123', 'hippo record will carry sourceSparkId for UI reverse link')
})

// ----- deriveTitle sanity -----

test('deriveTitle: short content unchanged', () => {
  assert.equal(deriveTitle('hello world'), 'hello world')
})

test('deriveTitle: long content truncated with ellipsis', () => {
  const long = 'x'.repeat(100)
  const title = deriveTitle(long)
  assert.ok(title.length <= 60)
  assert.ok(title.endsWith('…'))
})

test('rewrite is atomic via .tmp + rename (file never empty mid-write)', async (t) => {
  const { storage, file, cleanup } = await withTmpStorage()
  t.after(cleanup)
  await storage.append(makeRecord({ id: 'a' }))
  await storage.append(makeRecord({ id: 'b' }))
  await storage.remove('a')
  const text = await readFile(file, 'utf8')
  assert.match(text, /^\{.*\}\n?$/)
  const all = await storage.readAll()
  assert.equal(all.length, 1)
  assert.equal(all[0]!.id, 'b')
})

test('concurrent appends are serialized (no lost writes)', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  const N = 50
  await Promise.all(
    Array.from({ length: N }, (_, i) => storage.append(makeRecord({ id: 'r' + i, title: 't' + i }))),
  )
  const all = await storage.readAll()
  assert.equal(all.length, N)
  const ids = new Set(all.map(r => r.id))
  assert.equal(ids.size, N, 'all ids should be unique')
})

test('readAll on missing file returns []', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  const all = await storage.readAll()
  assert.deepEqual(all, [])
})

test('readAll skips malformed lines without throwing', async (t) => {
  const { storage, file, cleanup } = await withTmpStorage()
  t.after(cleanup)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(file, JSON.stringify(makeRecord({ id: 'ok' })) + '\n' + '{not json}\n' + JSON.stringify(makeRecord({ id: 'ok2' })) + '\n')
  const all = await storage.readAll()
  assert.equal(all.length, 2)
  assert.equal(all[0]!.id, 'ok')
  assert.equal(all[1]!.id, 'ok2')
})

test('patch updates fields, bumps updatedAt, and stamps resolvedAt on archive', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  await storage.append(makeRecord({ id: 'a', title: 'old' }))
  const next = await storage.patch('a', { title: 'new', status: 'archived' }, 1_700_000_000_999)
  assert.ok(next !== null)
  assert.equal(next.title, 'new')
  assert.equal(next.status, 'archived')
  assert.equal(next.updatedAt, 1_700_000_000_999)
  assert.equal(next.resolvedAt, 1_700_000_000_999)
  assert.equal(next.crystallized, null, 'patch should not touch crystallized')
  const all = await storage.readAll()
  assert.equal(all.length, 1)
  assert.equal(all[0]!.title, 'new')
})

test('patch returns null when id is unknown', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  await storage.append(makeRecord({ id: 'a' }))
  const result = await storage.patch('zzz', { title: 'nope' }, 1)
  assert.equal(result, null)
})

test('remove returns true once and false on second call', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  await storage.append(makeRecord({ id: 'a' }))
  await storage.append(makeRecord({ id: 'b' }))
  assert.equal(await storage.remove('a'), true)
  assert.equal(await storage.remove('a'), false)
  const all = await storage.readAll()
  assert.equal(all.length, 1)
  assert.equal(all[0]!.id, 'b')
})

console.log('spark-core tests loaded');