/**
 * 脚本目录（Phase 5）链路回归 —— 2026-09-21「脚本目录从来没生效过」的三条根因。
 *
 * 现场（真宿主探针实测）：`GET /scripts` 恒为 `[]`，`$DSH_HOME/storages/sparks/scripts.jsonl`
 * 从未被创建。三层各自都能让它恒空，而且都在 try/catch 兜底里**静默**：
 *
 *  1. `defaultScriptsFilePath()` 用裸 `require('node:os')` 取路径 —— 本包产物是 ESM
 *     （build.mjs `format: 'esm'`），esbuild 把它降级成 `__require`，运行时抛
 *     `Dynamic require of "node:os" is not supported`；
 *  2. 种子的「空判定」自己 new 了一个 `JsonlScriptStorage(defaultScriptsFilePath())`，
 *     于是第 1 条直接把整段种子炸掉（只留一行 console.warn）；
 *  3. ScriptService 与 SparkService **各自**调一次旧的三合一注册函数，平台 webserver
 *     对同前缀硬失败：`webserver: duplicate prefix route "/sparks"`。后注册的那次抛错
 *     落在 `SparkService.init` 的 try 里，init 在种子**之前**中断。
 *
 * 这三条一起决定「目录是否真的被种上并被服务出去」，所以放在同一个文件里守住。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { defaultScriptsFilePath } from '../src/script-storage.ts'
import { seedDefaultScripts } from '../src/seed-scripts.ts'
import { registerSparkHttpRoutes, registerScriptHttpRoutes } from '../src/http.ts'
import type { ScriptService } from '../src/script-service.ts'
import type { ScriptCapture, ScriptView } from 'dsh-spark-wire'

/* ───────────────────────── 1. 默认路径（ESM require 雷区） ───────────────────────── */

test('defaultScriptsFilePath 在 ESM 下解析默认路径（不靠 require）', () => {
  const previous = process.env['DSH_HOME']
  process.env['DSH_HOME'] = join('/tmp', 'dsh-home-probe')
  try {
    // 裸 require 版本在这里会抛 `Dynamic require of "node:os" is not supported`。
    assert.equal(
      defaultScriptsFilePath(),
      join('/tmp', 'dsh-home-probe', 'storages', 'sparks', 'scripts.jsonl'),
    )
  } finally {
    if (previous === undefined) delete process.env['DSH_HOME']
    else process.env['DSH_HOME'] = previous
  }
})

test('defaultScriptsFilePath 无 DSH_HOME 时落在 ~/.dsh 下', () => {
  const previous = process.env['DSH_HOME']
  delete process.env['DSH_HOME']
  try {
    const path = defaultScriptsFilePath()
    assert.ok(
      path.endsWith(join('storages', 'sparks', 'scripts.jsonl')),
      `unexpected default path: ${path}`,
    )
  } finally {
    if (previous !== undefined) process.env['DSH_HOME'] = previous
  }
})

/* ───────────────────────── 2. 种子：空则种、非空不覆盖 ───────────────────────── */

interface FakeScriptService {
  service: ScriptService
  created: ScriptCapture[]
}

function fakeScriptService(existing: ScriptView[] = []): FakeScriptService {
  const created: ScriptCapture[] = []
  const service = {
    async list(): Promise<ScriptView[]> {
      return existing
    },
    async create(input: ScriptCapture): Promise<ScriptView> {
      created.push(input)
      return {
        ...input,
        id: 'seed-' + String(created.length),
        invocationCount: 0,
        successCount: 0,
        failureCount: 0,
        createdAt: 0,
        updatedAt: 0,
        lastInvokedAt: null,
      } as ScriptView
    },
  }
  return { service: service as unknown as ScriptService, created }
}

function existingScript(): ScriptView {
  return {
    id: 'user-owned',
    name: '用户自己的脚本',
    description: '不该被种子覆盖',
    steps: [{ kind: 'instruction', payload: 'echo mine' }],
    triggers: ['mine'],
    scope: 'project',
    workspacePath: null,
    invocationCount: 0,
    successCount: 0,
    failureCount: 0,
    createdAt: 1,
    updatedAt: 1,
    lastInvokedAt: null,
    sourceSparkId: null,
  }
}

test('种子：存储为空时写入开箱即用脚本，且每条都有 triggers', async () => {
  const fake = fakeScriptService()
  await seedDefaultScripts(fake.service)
  assert.ok(fake.created.length >= 3, `expected >= 3 seeds, got ${fake.created.length}`)
  for (const capture of fake.created) {
    // triggers 是 C 档「最近工具序列命中现成脚本」的唯一检索键，空了等于没种。
    assert.ok(capture.triggers !== undefined && capture.triggers.length > 0, `no triggers: ${capture.name}`)
    assert.ok(capture.steps.length > 0, `no steps: ${capture.name}`)
  }
})

test('种子：存储非空时绝不覆盖用户脚本', async () => {
  const fake = fakeScriptService([existingScript()])
  await seedDefaultScripts(fake.service)
  assert.equal(fake.created.length, 0)
})

test('种子：create 抛错时只跳过那一条，不炸 plugin 启动', async () => {
  const created: ScriptCapture[] = []
  const boom = {
    async list(): Promise<ScriptView[]> { return [] },
    async create(input: ScriptCapture): Promise<ScriptView> {
      if (created.length === 0) {
        created.push(input)
        throw new Error('disk full')
      }
      created.push(input)
      return { ...input, id: 'x' } as ScriptView
    },
  } as unknown as ScriptService
  await seedDefaultScripts(boom)
  assert.ok(created.length >= 3, 'best-effort should keep seeding after a failure')
})

/* ───────────────────────── 3. 路由归属：同前缀只能注册一次 ───────────────────────── */

interface FakeRoute { kind: string; path: string }

/** 复刻平台 webserver 的重复前缀硬失败（dsh-host-webserver: duplicate route）。 */
function fakeCtx(): { ctx: Parameters<typeof registerSparkHttpRoutes>[0]; paths: string[] } {
  const paths: string[] = []
  const ctx = {
    effect: (callback: () => unknown) => callback(),
    webServer: {
      register: (route: FakeRoute) => {
        if (paths.includes(route.path)) {
          throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
        }
        paths.push(route.path)
        return () => {}
      },
    },
  }
  return { ctx: ctx as unknown as Parameters<typeof registerSparkHttpRoutes>[0], paths }
}

test('两个服务各自的注册入口前缀不重叠（合并注册不再抛 duplicate prefix）', () => {
  const { ctx, paths } = fakeCtx()
  registerSparkHttpRoutes(ctx, {} as never)
  registerScriptHttpRoutes(ctx, {} as never)
  assert.deepEqual(paths, ['/sparks', '/proposals', '/scripts'])
})
