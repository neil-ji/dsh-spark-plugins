/** 调度元数据 sidecar：往返、容错、原子更新。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SparkMetaStore, defaultMetaPath, emptyMeta, parseMeta } from '../src/meta-store.ts'

const NOW = 1_700_000_000_000

async function withStore(): Promise<{ store: SparkMetaStore; file: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-spark-meta-'))
  const file = join(dir, 'sparks', 'meta.json')
  return { store: new SparkMetaStore(file), file, cleanup: async () => { await rm(dir, { recursive: true, force: true }) } }
}

test('defaultMetaPath sits next to the sparks file', () => {
  assert.match(defaultMetaPath('F:\\\\home\\storages\\sparks.jsonl'), /sparks[\\\\/]meta\.json$/)
})

test('missing file reads as empty meta; update creates it atomically', async (t) => {
  const { store, file, cleanup } = await withStore()
  t.after(cleanup)
  assert.deepEqual(await store.read(), emptyMeta())
  const written = await store.update(meta => ({ ...meta, lastReflectAt: NOW }))
  assert.equal(written.lastReflectAt, NOW)
  const onDisk = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(onDisk.lastReflectAt, NOW)
  assert.deepEqual(await store.read(), { lastReflectAt: NOW, commandFailures: {} })
})

test('mutate returning null leaves the file untouched', async (t) => {
  const { store, file, cleanup } = await withStore()
  t.after(cleanup)
  await store.update(meta => ({ ...meta, lastReflectAt: NOW }))
  const before = await readFile(file, 'utf8')
  await store.update(() => null)
  assert.equal(await readFile(file, 'utf8'), before)
})

test('corrupt or malformed content degrades to empty meta instead of throwing', async (t) => {
  const { store, file, cleanup } = await withStore()
  t.after(cleanup)
  await store.update(meta => ({ ...meta, lastReflectAt: NOW }))
  await writeFile(file, '{ this is not json')
  assert.deepEqual(await store.read(), emptyMeta())
  assert.deepEqual(parseMeta(null), emptyMeta())
  assert.deepEqual(parseMeta({ lastReflectAt: 'nope', commandFailures: { bad: { modelKey: 1 } } }), emptyMeta())
  assert.equal(parseMeta({ lastReflectAt: 5 }).lastReflectAt, 5)
})

test('concurrent updates serialize (no lost write)', async (t) => {
  const { store, cleanup } = await withStore()
  t.after(cleanup)
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.update(meta => ({ ...meta, lastReflectAt: i }))))
  const final = await store.read()
  assert.equal(typeof final.lastReflectAt, 'number')
  assert.ok(final.lastReflectAt !== null && final.lastReflectAt >= 0)
})
