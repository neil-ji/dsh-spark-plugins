/**
 * Phase 5 script tests (pure logic).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JsonlScriptStorage } from '../src/script-storage.ts'
import type { ScriptView, ScriptStep } from 'dsh-spark-wire'

function makeStep(overrides: Partial<ScriptStep> = {}): ScriptStep {
  const out: ScriptStep = { kind: overrides.kind ?? 'instruction', payload: overrides.payload ?? 'do the thing' }
  if (overrides.note !== undefined) out.note = overrides.note
  return out
}

function makeScript(overrides: Partial<ScriptView> = {}): ScriptView {
  const now = 1_700_000_000_000
  return {
    id: overrides.id ?? 'script-1',
    name: overrides.name ?? 'Build and deploy',
    description: overrides.description ?? 'Build the project and deploy to staging',
    steps: overrides.steps ?? [makeStep(), makeStep({ kind: 'tool-call', payload: 'pnpm build' })],
    triggers: overrides.triggers ?? ['deploy', 'release'],
    scope: overrides.scope ?? 'project',
    workspacePath: overrides.workspacePath ?? null,
    invocationCount: overrides.invocationCount ?? 0,
    successCount: overrides.successCount ?? 0,
    failureCount: overrides.failureCount ?? 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    lastInvokedAt: overrides.lastInvokedAt ?? null,
    sourceSparkId: overrides.sourceSparkId ?? null,
  }
}

async function withTmp(): Promise<{ storage: JsonlScriptStorage; cleanup: () => Promise<void> }> {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-script-test-'))
  const file = join(dir, 'scripts.jsonl')
  const storage = new JsonlScriptStorage(file)
  return {
    storage,
    cleanup: async () => { await rm(dir, { recursive: true, force: true }) },
  }
}

test('append + readAll round-trips a script', async (t) => {
  const { storage, cleanup } = await withTmp()
  t.after(cleanup)
  const s = makeScript({ id: 'a' })
  await storage.append(s)
  const all = await storage.readAll()
  assert.equal(all.length, 1)
  assert.deepEqual(all[0]!, s)
})

test('readAll on missing file returns []', async (t) => {
  const { storage, cleanup } = await withTmp()
  t.after(cleanup)
  const all = await storage.readAll()
  assert.deepEqual(all, [])
})

test('get by id finds the script', async (t) => {
  const { storage, cleanup } = await withTmp()
  t.after(cleanup)
  await storage.append(makeScript({ id: 'a' }))
  await storage.append(makeScript({ id: 'b' }))
  assert.equal((await storage.get('a'))?.id, 'a')
  assert.equal((await storage.get('b'))?.id, 'b')
  assert.equal(await storage.get('c'), null)
})

test('patch updates fields and bumps updatedAt', async (t) => {
  const { storage, cleanup } = await withTmp()
  t.after(cleanup)
  await storage.append(makeScript({ id: 'a' }))
  const next = await storage.patch('a', { invocationCount: 5, lastInvokedAt: 1_700_000_001_000 }, 1_700_000_002_000)
  assert.ok(next !== null)
  assert.equal(next.invocationCount, 5)
  assert.equal(next.lastInvokedAt, 1_700_000_001_000)
  assert.equal(next.updatedAt, 1_700_000_002_000)
  assert.equal(next.createdAt, 1_700_000_000_000, 'createdAt must not change')
  assert.equal(next.id, 'a')
})

test('patch returns null for unknown id', async (t) => {
  const { storage, cleanup } = await withTmp()
  t.after(cleanup)
  await storage.append(makeScript({ id: 'a' }))
  assert.equal(await storage.patch('zzz', {}, 1), null)
})

test('remove deletes by id and is idempotent', async (t) => {
  const { storage, cleanup } = await withTmp()
  t.after(cleanup)
  await storage.append(makeScript({ id: 'a' }))
  await storage.append(makeScript({ id: 'b' }))
  assert.equal(await storage.remove('a'), true)
  assert.equal(await storage.remove('a'), false)
  const all = await storage.readAll()
  assert.equal(all.length, 1)
  assert.equal(all[0]!.id, 'b')
})

test('writeAll replaces the store', async (t) => {
  const { storage, cleanup } = await withTmp()
  t.after(cleanup)
  await storage.append(makeScript({ id: 'a' }))
  await storage.append(makeScript({ id: 'b' }))
  await storage.writeAll([makeScript({ id: 'c' })])
  const all = await storage.readAll()
  assert.equal(all.length, 1)
  assert.equal(all[0]!.id, 'c')
})

test('concurrent appends are serialized (no lost writes)', async (t) => {
  const { storage, cleanup } = await withTmp()
  t.after(cleanup)
  const N = 30
  await Promise.all(
    Array.from({ length: N }, (_, i) => storage.append(makeScript({ id: 's' + i, name: 'n' + i }))),
  )
  const all = await storage.readAll()
  assert.equal(all.length, N)
  const ids = new Set(all.map(s => s.id))
  assert.equal(ids.size, N)
})
console.log('scripts tests loaded');
