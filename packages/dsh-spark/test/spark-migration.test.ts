/**
 * 存储格式迁移与「丢失更新」防线的回归测试（设计 §7.1）。
 *
 * 背景：真实环境实测丢过 2 条火花 —— 备份快照 4 条，重写后只剩 2 条，且幸存记录的
 * updatedAt 停在更早的时间，说明某个写入者手里的快照早于另外两条的创建时间。
 * 成因有两处：① crystallize 的 read→writeAll 不在同一个临界区；② 跨进程全量重写
 * 用陈旧快照覆盖。这里把两处都变成可断言的失败模式。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlSparkStorage, SPARK_STORE_VERSION, migrateSparkRecord } from '../src/storage.ts'
import type { SparkView } from 'dsh-spark-wire'

const NOW = 1_700_000_000_000

async function withTmp(): Promise<{ dir: string; file: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-spark-migrate-'))
  return { dir, file: join(dir, 'sparks.jsonl'), cleanup: async () => { await rm(dir, { recursive: true, force: true }) } }
}

function makeRecord(overrides: Partial<SparkView> = {}): SparkView {
  return {
    id: overrides.id ?? 'r1',
    title: overrides.title ?? 't',
    content: overrides.content ?? 'c',
    scope: overrides.scope ?? 'project',
    workspacePath: null,
    inboxState: overrides.inboxState ?? 'pending',
    tags: [],
    sourceSessionId: 'sess',
    sourceAgentId: null,
    sourceTurn: null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    stateChangedAt: overrides.stateChangedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    crystallized: overrides.crystallized ?? null,
  }
}

test('migrateSparkRecord: active + no crystallization -> pending', () => {
  const out = migrateSparkRecord({ id: 'a', status: 'active', crystallized: null, updatedAt: 5, resolvedAt: null })!
  assert.equal(out.inboxState, 'pending')
  assert.equal(out.stateChangedAt, 5)
  assert.equal(out.deletedAt, null)
  assert.equal('status' in out, false, 'legacy status must be dropped')
  assert.equal('resolvedAt' in out, false)
})

test('migrateSparkRecord: active + crystallized -> crystallized; archived -> archived', () => {
  const crystal = migrateSparkRecord({ id: 'b', status: 'active', crystallized: { hippoId: 'm', kind: 'insight', at: 1 }, updatedAt: 7, resolvedAt: null })!
  assert.equal(crystal.inboxState, 'crystallized')
  const archived = migrateSparkRecord({ id: 'c', status: 'archived', crystallized: null, updatedAt: 9, resolvedAt: 42 })!
  assert.equal(archived.inboxState, 'archived')
  assert.equal(archived.stateChangedAt, 42, 'resolvedAt wins as the state-change timestamp')
})

test('migrateSparkRecord: idempotent on an already-v2 record, null on junk', () => {
  const v2 = makeRecord({ stateChangedAt: 3 })
  assert.deepEqual(migrateSparkRecord(v2), v2)
  assert.equal(migrateSparkRecord(null), null)
  assert.equal(migrateSparkRecord({ title: 'no id' }), null)
})

test('ensureVersion: upgrades a legacy file exactly once (idempotent)', async (t) => {
  const { file, cleanup } = await withTmp()
  t.after(cleanup)
  // v1 文件：没有版本头，字段是老形状
  const legacy = { id: 'a', title: 'old', content: 'c', scope: 'project', workspacePath: null, status: 'archived', tags: [], sourceSessionId: 's', sourceAgentId: null, sourceTurn: null, createdAt: NOW, updatedAt: NOW, resolvedAt: NOW + 1, crystallized: null }
  await writeFile(file, JSON.stringify(legacy) + '\n')

  const storage = new JsonlSparkStorage(file)
  assert.equal(await storage.ensureVersion(), SPARK_STORE_VERSION)
  const afterFirst = await readFile(file, 'utf8')
  assert.match(afterFirst, /^\{"__sparkStore":2\}/)
  const migrated = (await storage.readAll())[0]!
  assert.equal(migrated.inboxState, 'archived')
  assert.equal(migrated.stateChangedAt, NOW + 1)

  assert.equal(await storage.ensureVersion(), SPARK_STORE_VERSION)
  assert.equal(await readFile(file, 'utf8'), afterFirst, 'second run must not rewrite the file')
})

test('a stale full rewrite is refused (this is how 2 sparks were silently lost)', async (t) => {
  const { file, cleanup } = await withTmp()
  t.after(cleanup)
  const a = new JsonlSparkStorage(file)
  const b = new JsonlSparkStorage(file)
  await a.append(makeRecord({ id: 'x' }))
  await b.append(makeRecord({ id: 'y' }))
  const staleSnapshot = await a.readAll()            // A 认为库里只有 x、y
  await b.append(makeRecord({ id: 'z' }))            // B 又追加了一条，A 不知情
  await assert.rejects(
    () => a.writeAll(staleSnapshot),
    (error: Error & { code?: string }) => error.code === 'SPARK_STORE_CONFLICT',
  )
  assert.equal((await b.readAll()).length, 3, 'the third spark survives')
})

test('update re-reads and retries once, so a concurrent append is not clobbered', async (t) => {
  const { file, cleanup } = await withTmp()
  t.after(cleanup)
  const a = new JsonlSparkStorage(file)
  const b = new JsonlSparkStorage(file)
  await a.append(makeRecord({ id: 'x', title: 'before' }))
  await a.readAll()                                   // A 的基线
  await b.append(makeRecord({ id: 'y' }))             // 并发写入者
  const next = await a.update('x', r => ({ ...r, title: 'after' }))
  assert.equal(next?.title, 'after')
  const all = await a.readAll()
  assert.equal(all.length, 2, 'y survived the read-modify-write')
  assert.equal(all.find(r => r.id === 'y')?.id, 'y')
})
