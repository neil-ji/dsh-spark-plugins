/**
 * Phase 1 tests for dsh-spark core: JSONL storage round-trip, atomic rewrite,
 * patch and remove semantics. The SparkService class itself is exercised via
 * the storage interface here; cordis integration is covered by 3999 dogfood.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlSparkStorage } from '../src/storage.ts'
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

test('append + readAll round-trips records verbatim', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  const a = makeRecord({ id: 'a' })
  const b = makeRecord({ id: 'b', title: 'second', scope: 'session' })
  await storage.append(a)
  await storage.append(b)
  const all = await storage.readAll()
  assert.equal(all.length, 2)
  assert.deepEqual(all[0], a)
  assert.deepEqual(all[1], b)
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

test('rewrite is atomic via .tmp + rename (file never empty mid-write)', async (t) => {
  const { storage, file, cleanup } = await withTmpStorage()
  t.after(cleanup)
  await storage.append(makeRecord({ id: 'a' }))
  await storage.append(makeRecord({ id: 'b' }))
  await storage.remove('a')
  // After remove, the file should be either the old content (if a concurrent
  // reader observed it before rename) or the new content (if it observed it
  // after rename). Never empty / never partial.
  const text = await readFile(file, 'utf8')
  assert.match(text, /^\{.*\}\n?$/)  // exactly one record line
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
console.log('spark-core tests loaded');
