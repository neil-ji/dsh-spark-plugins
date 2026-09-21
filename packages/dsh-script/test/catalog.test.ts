/**
 * 脚本沉淀库的链路回归（Spec §8 A1/A3）。
 *
 * 覆盖三类"错了也不会有人发现"的地方：默认路径（ESM 裸 require 血案的守卫）、
 * 存储迁移（旧 storages/sparks 路径 → 新路径，含记录升级）、注入状态（指纹与裁剪）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scriptViewSchema } from 'dsh-script-wire'
import {
  JsonlScriptStorage,
  defaultScriptsFilePath,
  legacyScriptsFilePath,
  migrateLegacyScriptStore,
  upgradeLegacyRecord,
} from '../src/script-storage.ts'
import { catalogDigest, parseInjectState, pruneInjectState } from '../src/inject-state.ts'
import { ScriptService, findDuplicate, jaccard, normalizeName, stepsFingerprint, validateSteps } from '../src/script-service.ts'
import { isVisible, projectRoot, workspaceMatches } from '../src/scope.ts'
import { registerScriptHttpRoutes } from '../src/http.ts'
import type { ScriptService as ScriptServiceType } from '../src/script-service.ts'
import { seedDefaultScripts } from '../src/seed-scripts.ts'
import type { ScriptStep, ScriptView } from 'dsh-script-wire'

const NOW = 1_700_000_000_000

function step(payload: string, kind: ScriptStep['kind'] = 'instruction'): ScriptStep {
  return { kind, payload }
}

function record(overrides: Partial<ScriptView> = {}): ScriptView {
  return scriptViewSchema.parse({
    id: overrides.id ?? 's1',
    name: overrides.name ?? '跑全套闸门',
    description: overrides.description ?? '合并前跑一次 check:all',
    steps: overrides.steps ?? [step('在仓库根目录执行'), step('pnpm check:all', 'tool-call')],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  })
}

async function withTmp(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-script-test-'))
  return { dir, cleanup: async () => { await rm(dir, { recursive: true, force: true }) } }
}

/* ───────────────── 默认路径（ESM 裸 require 守卫） ───────────────── */

test('默认路径落在 storages/script/（旧 require 写法会在这里抛 Dynamic require）', () => {
  const previous = process.env['DSH_HOME']
  process.env['DSH_HOME'] = join('/tmp', 'dsh-home-probe')
  try {
    assert.equal(defaultScriptsFilePath(), join('/tmp', 'dsh-home-probe', 'storages', 'script', 'scripts.jsonl'))
    assert.equal(legacyScriptsFilePath(), join('/tmp', 'dsh-home-probe', 'storages', 'sparks', 'scripts.jsonl'))
  } finally {
    if (previous === undefined) delete process.env['DSH_HOME']
    else process.env['DSH_HOME'] = previous
  }
})

/* ───────────────── 记录升级与迁移 ───────────────── */

test('upgradeLegacyRecord：session → workspace、丢 sourceSparkId、补齐新字段默认值', () => {
  const upgraded = upgradeLegacyRecord<ScriptView>({
    id: 'legacy-1',
    name: '旧脚本',
    description: '来自 storages/sparks',
    steps: [{ kind: 'tool-call', payload: 'pnpm build' }],
    triggers: ['build'],
    scope: 'session',
    workspacePath: '/tmp/ws',
    invocationCount: 2,
    successCount: 1,
    failureCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
    lastInvokedAt: null,
    sourceSparkId: 'spark-1',
  }, value => scriptViewSchema.parse(value))
  assert.equal(upgraded.scope, 'workspace')
  assert.equal(upgraded.status, 'active')
  assert.equal(upgraded.revision, 1)
  assert.equal(upgraded.updatedBy, 'system')
  assert.deepEqual(upgraded.tags, [])
  assert.equal(upgraded.expiresAt, null)
  assert.equal('sourceSparkId' in upgraded, false, '火花耦合字段必须被丢弃')
})

test('migrateLegacyScriptStore：整体搬迁 + 旧文件改名 + 幂等', async (t) => {
  const { dir, cleanup } = await withTmp()
  t.after(cleanup)
  const legacy = join(dir, 'sparks', 'scripts.jsonl')
  const next = join(dir, 'script', 'scripts.jsonl')
  await mkdir(join(dir, 'sparks'), { recursive: true })
  await writeFile(legacy, JSON.stringify({
    id: 'legacy-1', name: '旧脚本', description: 'd', steps: [{ kind: 'instruction', payload: 'do the thing' }],
    triggers: [], scope: 'session', workspacePath: null, invocationCount: 0, successCount: 0, failureCount: 0,
    createdAt: NOW, updatedAt: NOW, lastInvokedAt: null, sourceSparkId: null,
  }) + '\n', 'utf8')

  const first = await migrateLegacyScriptStore<ScriptView>({ newPath: next, legacyPath: legacy, parse: value => scriptViewSchema.parse(value) })
  assert.deepEqual(first, { migrated: 1 })
  const moved = await new JsonlScriptStorage<ScriptView>(next).readAll()
  assert.equal(moved.length, 1)
  assert.equal(moved[0]!.scope, 'workspace')
  await stat(legacy + '.migrated')

  const second = await migrateLegacyScriptStore<ScriptView>({ newPath: next, legacyPath: legacy, parse: value => scriptViewSchema.parse(value) })
  assert.equal(second, undefined, '新文件非空即跳过（幂等）')
})

/* ───────────────── 注入状态 ───────────────── */

test('catalogDigest：同内容同指纹，任一条变化即变', () => {
  const a = [{ name: 'a', description: 'A' }, { name: 'b', description: 'B' }]
  const b = [{ name: 'b', description: 'B' }, { name: 'a', description: 'A' }]
  assert.equal(catalogDigest(a), catalogDigest(a))
  assert.notEqual(catalogDigest(a), catalogDigest(b), '顺序也是身份的一部分')
  assert.notEqual(catalogDigest(a), catalogDigest([{ name: 'a', description: 'A!' }, { name: 'b', description: 'B' }]))
})

test('parseInjectState / pruneInjectState：坏数据降级为空，超量按时间裁剪', () => {
  assert.deepEqual(parseInjectState('not json'), {})
  assert.deepEqual(parseInjectState('{"s1":{"digest":"d","publishedAt":1,"agentId":null,"suggested":["x"]}}'), {
    s1: { digest: 'd', publishedAt: 1, agentId: null, suggested: ['x'] },
  })
  const state = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
    's' + String(index), { digest: 'd', publishedAt: index, agentId: null, suggested: [] },
  ]))
  assert.deepEqual(Object.keys(pruneInjectState(state, 2)).sort(), ['s3', 's4'])
})

/* ───────────────── 沉淀质量与判重 ───────────────── */

test('validateSteps：空话与过短的 instruction 被拒，可执行步骤通过', () => {
  assert.deepEqual(validateSteps([step('处理一下')]), ['step 1: instruction 太短（<8 字）'])
  assert.deepEqual(validateSteps([step('优化  一下性能')]).length, 1)
  assert.deepEqual(validateSteps([step('在仓库根目录执行 pnpm check:all'), step('pnpm check:all', 'tool-call')]), [])
})

test('findDuplicate：同名判重；步骤指纹相同且 triggers 高度重叠也判重', () => {
  const existing = [record({ id: 'x1', name: '跑全套闸门', triggers: ['check:all', 'pnpm check'] })]
  assert.equal(findDuplicate({ name: ' 跑全套闸门 ', steps: [step('别的写法不同长度也够')], triggers: [] }, existing)?.id, 'x1')
  const same = findDuplicate({
    name: '另一个名字',
    steps: existing[0]!.steps,
    triggers: ['check:all', 'pnpm check'],
  }, existing)
  assert.equal(same?.id, 'x1', '步骤一致 + triggers Jaccard=1 → 判重')
  assert.equal(findDuplicate({ name: '新脚本', steps: [step('完全不同的步骤在这里')], triggers: ['nope'] }, existing), undefined)
})

test('jaccard / normalizeName / stepsFingerprint：口径可单测', () => {
  assert.equal(jaccard(['a', 'b'], ['a', 'b']), 1)
  assert.equal(jaccard([], []), 1)
  assert.equal(jaccard(['a'], ['b']), 0)
  assert.equal(normalizeName('  跑  全套闸门 '), '跑 全套闸门')
  assert.equal(stepsFingerprint([step('a')]), stepsFingerprint([step('a')]))
  assert.notEqual(stepsFingerprint([step('a')]), stepsFingerprint([step('b')]))
})

test('successRate 口径单源：未调用记 0', () => {
  assert.equal(ScriptService.successRate({ successCount: 0, invocationCount: 0 }), 0)
  assert.equal(ScriptService.successRate({ successCount: 3, invocationCount: 4 }), 0.75)
})

/* ───────────────── 作用域可见性 ───────────────── */

test('projectRoot：最近的含 .git 祖先；没有则回退自身', () => {
  const hasMarker = (dir: string): boolean => dir === '/repo'
  assert.equal(projectRoot('/repo/packages/a/src', hasMarker), '/repo')
  assert.equal(projectRoot('/elsewhere/a', hasMarker), '/elsewhere/a')
})

test('可见性：未绑定全可见；workspace 精确匹配；project 按项目根；非 active/已过期不可见', () => {
  const hasMarker = (dir: string): boolean => dir === '/repo'
  const bound = record({ scope: 'workspace', workspacePath: '/repo/packages/a' })
  assert.equal(workspaceMatches(bound, '/repo/packages/a', hasMarker), true)
  assert.equal(workspaceMatches(bound, '/repo/packages/b', hasMarker), false)
  const projectScoped = record({ scope: 'project', workspacePath: '/repo/packages/a' })
  assert.equal(workspaceMatches(projectScoped, '/repo/packages/b', hasMarker), true, 'project 按项目根匹配')
  const unbound = record({ scope: 'workspace', workspacePath: null })
  assert.equal(isVisible(unbound, '/anywhere', NOW), true)
  assert.equal(isVisible(record({ status: 'archived' }), '/anywhere', NOW), false)
  assert.equal(isVisible(record({ expiresAt: NOW - 1 }), '/anywhere', NOW), false)
})

/* ───────────────── HTTP 前缀归属 ───────────────── */

test('registerScriptHttpRoutes 只注册 /scripts（同前缀只能有一个注册者）', () => {
  const paths: string[] = []
  const ctx = {
    effect: (callback: () => unknown) => callback(),
    webServer: {
      register: (route: { kind: string; path: string }) => {
        if (paths.includes(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
        paths.push(route.path)
        return () => {}
      },
    },
  }
  registerScriptHttpRoutes(ctx as never, {} as never)
  assert.deepEqual(paths, ['/scripts'])
})

/* ───────────────── 种子 ───────────────── */

test('种子：空库写入 3 条，非空不覆盖', async () => {
  const created: unknown[] = []
  const empty = {
    async list(): Promise<ScriptView[]> { return [] },
    async save(input: unknown): Promise<{ kind: 'created'; record: ScriptView }> {
      created.push(input)
      return { kind: 'created', record: record({ id: 'seed-' + String(created.length) }) }
    },
  } as unknown as ScriptServiceType
  assert.equal(await seedDefaultScripts(empty, NOW), 3)
  assert.equal(created.length, 3)

  const nonEmpty = {
    async list(): Promise<ScriptView[]> { return [record()] },
    async save(): Promise<never> { throw new Error('must not be called') },
  } as unknown as ScriptServiceType
  assert.equal(await seedDefaultScripts(nonEmpty, NOW), 0)
})

test('种子读得到：storages/script 下的 JSONL 可被解析回记录', async (t) => {
  const { dir, cleanup } = await withTmp()
  t.after(cleanup)
  const file = join(dir, 'scripts.jsonl')
  const storage = new JsonlScriptStorage<ScriptView>(file)
  await storage.append(record({ id: 'a' }))
  const text = await readFile(file, 'utf8')
  assert.match(text, /"status":"active"/)
  assert.equal((await storage.readAll()).length, 1)
})
