/**
 * Phase 1 tests for dsh-spark core: JSONL storage round-trip, atomic rewrite,
 * patch and remove semantics. The SparkService class itself is exercised via
 * the storage interface here; cordis integration is covered by real-host checks.
 * (v2 P10：spark→memory 映射已随解耦删除，相关测试一并移除。)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlSparkStorage } from '../src/storage.ts'
import { JsonlProposalStorage } from '../src/proposal-storage.ts'
import { ensureJsonlPath } from '../src/jsonl-path.ts'
import { applyRecall, deriveTitle, orderForPanel, resolveProvenance, SparkProvenanceError, SPARK_MAX_GENERATION } from '../src/types.ts'
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
    origin: 'human', derivedFrom: [], generation: 0,
    recalledCount: overrides.recalledCount ?? 0, lastRecalledAt: overrides.lastRecalledAt ?? null,
    tags: overrides.tags ?? ['design', 'idea'],
    sourceSessionId: overrides.sourceSessionId ?? 'sess-1',
    sourceAgentId: overrides.sourceAgentId ?? 'agent-1',
    sourceTurn: overrides.sourceTurn ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    stateChangedAt: overrides.stateChangedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
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

test('append + readAll round-trips records verbatim (incl. status)', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  const a = makeRecord({ id: 'a' })
  const b = makeRecord({ id: 'b', status: 'archived' })
  await storage.append(a)
  await storage.append(b)
  const all = await storage.readAll()
  assert.equal(all.length, 2)
  assert.equal(all[0]!.status, 'active')
  assert.equal(all[1]!.status, 'archived')
})

test('writeAll replaces the entire store (used by migrations)', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  await storage.append(makeRecord({ id: 'a' }))
  await storage.append(makeRecord({ id: 'b' }))
  await storage.writeAll([
    makeRecord({ id: 'a', status: 'archived' }),
    makeRecord({ id: 'b' }),
  ])
  const all = await storage.readAll()
  assert.equal(all.length, 2)
  assert.equal(all.find(r => r.id === 'a')!.status, 'archived')
})

// ----- EISDIR regression: the file path must never be created as a directory -----

test('ensureJsonlPath uses path.dirname, not a forward-slash pattern (Windows EISDIR)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-spark-eisdir-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const file = join(dir, 'nested', 'deeper', 'sparks.jsonl')
  await ensureJsonlPath(file)
  // The parent chain exists; the file path itself must NOT exist as a directory.
  const storage = new JsonlSparkStorage(file)
  await storage.append(makeRecord({ id: 'a' }))
  const all = await storage.readAll()
  assert.equal(all.length, 1, 'append+read must work on a fresh nested path')
})

test('JSONL backends self-heal the empty directory the old mkdir bug created', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-spark-heal-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })

  // sparks: append must succeed and round-trip once the path is healed.
  const sparkFile = join(dir, 'sparks.jsonl')
  await mkdir(sparkFile, { recursive: true })
  const sparks = new JsonlSparkStorage(sparkFile)
  assert.deepEqual(await sparks.readAll(), [], 'damaged path reads as empty')
  await sparks.append(makeRecord({ id: 'a' }))
  assert.equal((await sparks.readAll()).length, 1, 'sparks path is a usable file location again')

  // proposals: the write path heals the same way（脚本存储已迁到 dsh-script，其
  // 自愈行为在该包的 test/storage.test.ts 里覆盖）。
  for (const [name, storage] of [
    ['proposals.jsonl', new JsonlProposalStorage(join(dir, 'proposals.jsonl'))],
  ] as const) {
    const file = join(dir, name)
    await mkdir(file, { recursive: true })
    assert.deepEqual(await storage.readAll(), [], name + ': damaged path reads as empty')
    await storage.writeAll([])
    assert.deepEqual(await storage.readAll(), [], name + ': path is a usable file location again')
  }
})

test('a NON-empty directory at the JSONL path is refused, never destroyed', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-spark-refuse-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const file = join(dir, 'sparks.jsonl')
  await mkdir(join(file, 'user-data'), { recursive: true })
  const assertRefused = (error: Error): boolean => {
    assert.match(error.message, /is a non-empty directory, not a JSONL file/)
    assert.ok(error.message.includes(file), 'message must name the offending path')
    return true
  }
  await assert.rejects(() => ensureJsonlPath(file), assertRefused)
  // The read path goes through the same guard, so the UI gets the actionable
  // message instead of Node's bare `EISDIR: illegal operation on a directory`.
  await assert.rejects(() => new JsonlSparkStorage(file).readAll(), assertRefused)
})

// ----- resolveProvenance (v2 P12 pure logic) -----

test('resolveProvenance: 无 agentId → human；有 → agent', () => {
  assert.equal(resolveProvenance({ sourceAgentId: null }, []).origin, 'human')
  assert.equal(resolveProvenance({ sourceAgentId: 'ag-1' }, []).origin, 'agent')
  assert.equal(resolveProvenance({ sourceAgentId: null, origin: 'agent' }, []).origin, 'agent', '显式声明优先')
})

test('resolveProvenance: derived 取 max(父代)+1，不变式成立', () => {
  const out = resolveProvenance({ sourceAgentId: null, derivedFrom: ['a', 'b'] }, [
    { origin: 'human', generation: 0 },
    { origin: 'agent', generation: 1 },
  ])
  assert.equal(out.origin, 'derived')
  assert.equal(out.generation, 2)
  assert.deepEqual(out.derivedFrom, ['a', 'b'])
})

test('resolveProvenance: 未知父 / derived 父 / 超上限都被拒（AC-4）', () => {
  assert.throws(() => resolveProvenance({ sourceAgentId: null, derivedFrom: ['x'] }, []), SparkProvenanceError)
  assert.throws(() => resolveProvenance({ sourceAgentId: null, derivedFrom: ['d'] }, [
    { origin: 'derived', generation: 1 },
  ]), /derived spark cannot be a parent/)
  assert.throws(() => resolveProvenance({ sourceAgentId: null, derivedFrom: ['a', 'b'] }, [
    { origin: 'human', generation: 2 },
    { origin: 'human', generation: 2 },
  ]), /generation cap exceeded/)
  assert.equal(SPARK_MAX_GENERATION, 2)
})

// ----- applyRecall / orderForPanel (v2 P14 pure logic) -----

test('applyRecall: 计数 +1 且打点 lastRecalledAt，但**不动 updatedAt**（召回不是编辑）', () => {
  const before = makeRecord({ id: 'a', recalledCount: 2, updatedAt: 111 })
  const after = applyRecall(before, 999)
  assert.equal(after.recalledCount, 3)
  assert.equal(after.lastRecalledAt, 999)
  assert.equal(after.updatedAt, 111, 'bump updatedAt 会让 prune / 脏标记把召回误当成改动')
})

test('orderForPanel: 空 lastRecalledAt 退化 createdAt；同分按 id 定序（判据确定）', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeRecord({ id: 'never-old', createdAt: now - 1000, recalledCount: 0, lastRecalledAt: null }),
    makeRecord({ id: 'never-new', createdAt: now, recalledCount: 0, lastRecalledAt: null }),
    makeRecord({ id: 'recalled-once', createdAt: now - 5000, recalledCount: 1, lastRecalledAt: now - 10 }),
  ]
  const ordered = orderForPanel(sparks).map(r => r.id)
  assert.deepEqual(ordered, ['recalled-once', 'never-new', 'never-old'])
  assert.deepEqual(orderForPanel(sparks).map(r => r.id), ordered, '同输入同输出')
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
  await storage.purge('a')
  const text = await readFile(file, 'utf8')
  // 首行是版本头，其余每行一条记录（`.tmp` + rename，绝不会读到半截文件）。
  const lines = text.split('\n').filter(Boolean)
  assert.match(lines[0]!, /^\{"__sparkStore":\d+\}$/)
  assert.equal(lines.length, 2)
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

test('patch updates fields, bumps updatedAt, and stamps stateChangedAt on a state change', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  await storage.append(makeRecord({ id: 'a', title: 'old' }))
  const next = await storage.patch('a', { title: 'new', status: 'archived' }, 1_700_000_000_999)
  assert.ok(next !== null)
  assert.equal(next.title, 'new')
  assert.equal(next.status, 'archived')
  assert.equal(next.updatedAt, 1_700_000_000_999)
  assert.equal(next.stateChangedAt, 1_700_000_000_999)
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

test('remove is a tombstone (soft delete): true once, false on repeat, record still readable', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  await storage.append(makeRecord({ id: 'a' }))
  await storage.append(makeRecord({ id: 'b' }))
  assert.equal(await storage.remove('a', 1_700_000_000_500), true)
  assert.equal(await storage.remove('a'), false, 'second remove is a no-op')
  const all = await storage.readAll()
  assert.equal(all.length, 2, 'soft delete keeps the record in the file (auditable)')
  const tomb = all.find(r => r.id === 'a')!
  assert.equal(tomb.deletedAt, 1_700_000_000_500)
  await storage.update('a', r => ({ ...r, deletedAt: null }))
  assert.equal((await storage.readAll()).find(r => r.id === 'a')!.deletedAt, null, 'restorable')
})

test('purgeTombstones physically drops only tombstones past the retention window', async (t) => {
  const { storage, cleanup } = await withTmpStorage()
  t.after(cleanup)
  const now = 1_700_000_000_000
  await storage.append(makeRecord({ id: 'fresh', deletedAt: now - 1000 }))
  await storage.append(makeRecord({ id: 'old', deletedAt: now - 10 * 86_400_000 }))
  await storage.append(makeRecord({ id: 'live', deletedAt: null }))
  const purged = await storage.purgeTombstones(30 * 86_400_000, now)
  assert.equal(purged, 0, 'nothing has passed the 30-day window yet')
  const purged2 = await storage.purgeTombstones(5 * 86_400_000, now)
  assert.equal(purged2, 1)
  assert.deepEqual((await storage.readAll()).map(r => r.id).sort(), ['fresh', 'live'])
})

console.log('spark-core tests loaded');