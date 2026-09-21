/**
 * 治理引擎与审计面回归（Spec §8 A7/A8）。
 *
 * 这里守的是 F3 的四条新不变量：
 *   - 四类建议的**触发与不触发**都按 Spec §6.2 的阈值（多一条、少一条都要红）；
 *   - INV-13 结算幂等：第二次结算返回 0 且**一个字节都不写**；
 *   - INV-14 建议不定罪：`audit` / `advices` / `stats` 调用前后 JSONL 逐字节相同；
 *   - INV-7/D10 读模型：`GET /scripts` 不含 steps，且 `successRate` 与口径函数恒等。
 *
 * 服务级用**假 ctx + 临时文件**驱动真实实现（与 seed/注入测试同一手法）：
 * cordis `Service` 构造只需要 `ctx.reflect.provide`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { scriptViewSchema, type ScriptAdvice, type ScriptView } from 'dsh-script-wire'
import { ScriptService } from '../src/script-service.ts'
import { registerScriptHttpRoutes } from '../src/http.ts'
import { successRate, toSummary } from '../src/metrics.ts'
import {
  MS_PER_DAY,
  RETIRE_MIN_INVOCATIONS,
  ZOMBIE_IDLE_DAYS,
  auditStats,
  duplicatePairs,
  expiredIds,
  governanceAdvices,
  hasAcceptanceStep,
  invokedWorkspacesPatch,
  isZombie,
} from '../src/governance.ts'
import { assertPureModule } from './helpers/pure-module.ts'
import { NOW, appendRaw, harness, record, seed, snapshot, type Harness } from './helpers/service-harness.ts'

const kindsOf = (advices: readonly ScriptAdvice[]): string[] => advices.map(advice => advice.kind)
const idsOf = (advices: readonly ScriptAdvice[]): string[] => advices.map(advice => advice.id)

/* ───────────────────────── 建议：触发与不触发 ───────────────────────── */

test('退役建议：调用够多且成功率 < 0.5 才提；边界两侧都不提', () => {
  const retiring = record({ id: 'low', invocationCount: RETIRE_MIN_INVOCATIONS, successCount: 2, failureCount: 3 })
  assert.equal(successRate(retiring), 0.4)
  const [advice] = governanceAdvices([retiring], NOW)
  assert.equal(advice?.kind, 'retire')
  assert.equal(advice.action, 'archive')
  assert.equal(advice.id, 'retire:low')
  assert.deepEqual(advice.evidence, { invocationCount: 5, successRate: 0.4, idleDays: null, workspaces: 0 })

  // 调用数差 1 → 不提（样本不够，结论不可信）
  const fewCalls = record({ id: 'few', name: '少样本', invocationCount: RETIRE_MIN_INVOCATIONS - 1, successCount: 1, failureCount: 3 })
  // 成功率正好 0.5 → 不提（阈值是 `< 0.5`，不是 `≤`）
  const halfOk = record({ id: 'half', name: '一半成功', invocationCount: 6, successCount: 3, failureCount: 3 })
  assert.deepEqual(kindsOf(governanceAdvices([fewCalls, halfOk], NOW)), [])
})

test('僵尸建议：活跃 + 从未调用 + 超过 30 天没被碰过；三个条件缺一不可', () => {
  const stale = record({ id: 'stale', name: '陈旧无人用', invocationCount: 0, updatedAt: NOW - (ZOMBIE_IDLE_DAYS + 1) * MS_PER_DAY })
  const [advice] = governanceAdvices([stale], NOW)
  assert.equal(advice?.kind, 'zombie')
  assert.equal(advice.action, 'archive')
  assert.equal(advice.evidence.idleDays, ZOMBIE_IDLE_DAYS + 1)

  const fresh = record({ id: 'fresh', name: '刚写的', invocationCount: 0, updatedAt: NOW - 1 * MS_PER_DAY })
  const used = record({ id: 'used', name: '用过的', invocationCount: 1, successCount: 1, updatedAt: NOW - 100 * MS_PER_DAY })
  const archivedStale = record({ id: 'arch', name: '已归档的', invocationCount: 0, status: 'archived', updatedAt: NOW - 100 * MS_PER_DAY })
  assert.deepEqual(kindsOf(governanceAdvices([fresh, used, archivedStale], NOW)), [])
  assert.equal(isZombie(fresh, NOW), false)
  assert.equal(isZombie(stale, NOW), true)
})

test('降级建议：声称 global 却只在一个工作区被调用过；0 个或 ≥2 个都不提', () => {
  const oneWs = record({ id: 'g1', name: '单工作区全局脚本', scope: 'global', workspacePath: '/repo', invokedWorkspaces: ['/repo'] })
  const [advice] = governanceAdvices([oneWs], NOW)
  assert.equal(advice?.kind, 'downgrade-scope')
  assert.equal(advice.action, 'set-scope-workspace')
  assert.equal(advice.evidence.workspaces, 1)

  const twoWs = record({ id: 'g2', name: '双工作区全局脚本', scope: 'global', invokedWorkspaces: ['/repo', '/other'] })
  const noWs = record({ id: 'g3', name: '零证据全局脚本', scope: 'global', invokedWorkspaces: [] })
  // 工作区脚本只有一个工作区是**正常**的，不该被建议
  const workspaceScoped = record({ id: 'w1', name: '工作区脚本', scope: 'workspace', invokedWorkspaces: ['/repo'] })
  assert.deepEqual(kindsOf(governanceAdvices([twoWs, noWs, workspaceScoped], NOW)), [])
})

test('合并建议：同名两条时对**较新**的一条提建议，留存者是较早的那条', () => {
  const older = record({ id: 'old', name: '跑全套闸门', createdAt: NOW - 10 * MS_PER_DAY })
  const newer = record({ id: 'new', name: '  跑全套闸门  ', createdAt: NOW - 1 * MS_PER_DAY })
  assert.deepEqual(duplicatePairs([newer, older]), [{ scriptId: 'new', targetId: 'old' }])

  const advices = governanceAdvices([newer, older], NOW)
  assert.deepEqual(kindsOf(advices), ['merge-duplicate'])
  assert.equal(advices[0]?.targetId, 'old')
  assert.equal(advices[0]?.id, 'merge-duplicate:new->old')
  assert.equal(advices[0]?.action, 'merge')
})

test('合并建议：步骤指纹相同 + triggers 高度重叠也算重复（与写入判重同一套规则）', () => {
  const steps = [{ kind: 'tool-call' as const, payload: 'pnpm check:all' }]
  // Jaccard = 4/5 = 0.8，正好压线通过（规则是 ≥ 0.8）
  const a = record({ id: 'a', name: '发版前检查', steps, triggers: ['发版', 'check', '闸门', '归档', '发布'], createdAt: NOW - 5 * MS_PER_DAY })
  const b = record({ id: 'b', name: '合并前检查', steps, triggers: ['发版', 'check', '闸门', '归档'], createdAt: NOW - 2 * MS_PER_DAY })
  assert.deepEqual(duplicatePairs([a, b]), [{ scriptId: 'b', targetId: 'a' }])

  // 差一点（3/5 = 0.6）就不算重复：宁可漏判，也不要把不相干的脚本并掉
  const c = record({ id: 'c', name: '另一个检查', steps, triggers: ['发版', 'check', '闸门'], createdAt: NOW - 1 * MS_PER_DAY })
  assert.deepEqual(duplicatePairs([a, c]), [])
})

test('已归档 / 已取代条目不产生任何建议（已出库，再建议是噪音）', () => {
  const retired: ScriptView[] = [
    record({ id: 'a1', status: 'archived', invocationCount: 9, successCount: 0, updatedAt: NOW - 90 * MS_PER_DAY }),
    record({ id: 's1', status: 'superseded', supersededBy: 'x', scope: 'global', invokedWorkspaces: ['/repo'] }),
  ]
  assert.deepEqual(governanceAdvices(retired, NOW), [])
  assert.deepEqual(duplicatePairs([record({ id: 'd1', status: 'archived' }), record({ id: 'd2' })]), [])
})

test('建议排序稳定：按处置紧迫度（退役 → 僵尸 → 降级 → 合并），同类别按 id', () => {
  const records = [
    record({ id: 'zz', invocationCount: 0, updatedAt: NOW - 100 * MS_PER_DAY, name: '僵尸' }),
    record({ id: 'rr', invocationCount: 6, successCount: 1, failureCount: 5, name: '退役' }),
    record({ id: 'gg', scope: 'global', workspacePath: '/repo', invokedWorkspaces: ['/repo'], name: '降级' }),
    record({ id: 'aa', invocationCount: 0, updatedAt: NOW - 100 * MS_PER_DAY, name: '僵尸2' }),
  ]
  assert.deepEqual(idsOf(governanceAdvices(records, NOW)), [
    'retire:rr',
    'zombie:aa',
    'zombie:zz',
    'downgrade-scope:gg',
  ])
  // 同一输入两次调用结果全等（纯函数，无隐藏状态）
  assert.deepEqual(governanceAdvices(records, NOW), governanceAdvices(records, NOW))
})

test('INV-14：引擎模块是纯的（源码里没有文件系统 / 存储 / ctx 的可写面）', async () => {
  await assertPureModule(new URL('../src/governance.ts', import.meta.url), ['node:fs', 'storage', 'ctx.emit', 'ctx.logger'])
})

/* ───────────────────────── 审计统计 ───────────────────────── */

test('审计统计：全库看状态/作用域，只有 active 进成功率分档、验收占比与僵尸数', () => {
  const records: ScriptView[] = [
    record({ id: 'a', name: '全成功', invocationCount: 4, successCount: 4 }),                                     // high
    record({ id: 'b', name: '多数成功', invocationCount: 4, successCount: 3 }),                                   // mid
    record({ id: 'c', name: '多数失败', invocationCount: 4, successCount: 1 }),                                   // low
    record({ id: 'd', name: '从没调用', invocationCount: 0, updatedAt: NOW - 100 * MS_PER_DAY }),                 // untested + 僵尸
    record({ id: 'e', name: '已归档', status: 'archived', invocationCount: 0, scope: 'global', updatedAt: NOW - 100 * MS_PER_DAY }),
    record({ id: 'f', name: '被取代', status: 'superseded', invocationCount: 9, successCount: 0, scope: 'project' }),
    record({
      id: 'g',
      name: '带验收步骤',
      scope: 'global',
      updatedAt: NOW - 100 * MS_PER_DAY,
      steps: [{ kind: 'instruction', payload: '开头' }, { kind: 'instruction', payload: '验收：pnpm check:all 全绿' }],
    }),
  ]
  const stats = auditStats(records, NOW)
  assert.equal(stats.total, 7)
  assert.deepEqual(stats.byStatus, { active: 5, archived: 1, superseded: 1, candidate: 0 })
  assert.deepEqual(stats.byScope, { global: 2, workspace: 4, project: 1 })
  // 分档只数 active 的 5 条（含步骤里带验收的那条）
  assert.deepEqual(stats.rateBuckets, { untested: 2, low: 1, mid: 1, high: 1 })
  assert.deepEqual(stats.acceptance, { withAcceptanceStep: 1, total: 5, ratio: 0.2 })
  assert.equal(stats.zombies, 2, 'active 且从未调用且陈旧的两条（d 与 g）')
})

test('审计统计：空库不产生 NaN（ratio 0，各计数齐全）', () => {
  const stats = auditStats([], NOW)
  assert.equal(stats.total, 0)
  assert.equal(stats.acceptance.ratio, 0)
  assert.deepEqual(stats.rateBuckets, { untested: 0, low: 0, mid: 0, high: 0 })
})

test('验收步骤判定：末步 instruction 以「验收：」/「验收:」开头；tool-call 不算', () => {
  assert.equal(hasAcceptanceStep(record({ steps: [{ kind: 'instruction', payload: '验收：退出码 0' }] })), true)
  assert.equal(hasAcceptanceStep(record({ steps: [{ kind: 'instruction', payload: '验收: 页面能开' }] })), true)
  assert.equal(hasAcceptanceStep(record({ steps: [{ kind: 'tool-call', payload: '验收：退出码 0' }] })), false)
  assert.equal(hasAcceptanceStep(record({
    steps: [{ kind: 'instruction', payload: '验收：退出码 0' }, { kind: 'tool-call', payload: 'pnpm build' }],
  })), false, '验收必须是末步')
})

/* ───────────────────────── 结算幂等（INV-13） ───────────────────────── */

test('过期结算只挑 active 的过期条目，所以第二次结算必然是空集（INV-13 的机制面）', () => {
  const records = [
    record({ id: 'expired', expiresAt: NOW - 1 }),
    record({ id: 'future', expiresAt: NOW + 1 }),
    record({ id: 'never', expiresAt: null }),
    record({ id: 'already', expiresAt: NOW - 1, status: 'archived' }),
    record({ id: 'candidate', expiresAt: NOW - 1, status: 'candidate' }),
  ]
  const ids = expiredIds(records, NOW)
  assert.deepEqual(ids, ['expired'])
  const after = records.map(item => ids.includes(item.id) ? { ...item, status: 'archived' as const } : item)
  assert.deepEqual(expiredIds(after, NOW), [], '结算过的条目不再入选')
})

/* ───────────────────────── 服务级（真实实现 + 临时文件） ───────────────────────── */

test('INV-13（服务级）：第一次结算归档过期条目，第二次返回 0 且不改一个字节', async () => {
  const h = await harness()
  try {
    await seed(h.service, { expiresAt: NOW - 1 })
    const first = await h.service.audit(NOW, { settle: true })
    assert.equal(first.archived, 1)
    assert.equal(first.stats.byStatus.archived, 1)
    const before = await snapshot(h.filePath)
    const second = await h.service.audit(NOW, { settle: true })
    assert.equal(second.archived, 0)
    assert.equal(await snapshot(h.filePath), before, '重复结算不得产生任何写入')
  } finally {
    await h.cleanup()
  }
})

test('INV-14（服务级）：只读审计 / 建议 / 统计调用前后 JSONL 逐字节相同', async () => {
  const h = await harness()
  try {
    await appendRaw(h.filePath, record({
      id: 'retiring',
      name: '退役候选',
      invocationCount: 6,
      successCount: 1,
      failureCount: 5,
    }))
    const before = await snapshot(h.filePath)
    const audit = await h.service.readAudit(NOW)
    await h.service.advices(NOW)
    await h.service.stats(NOW)
    assert.equal(await snapshot(h.filePath), before, '建议只是读：不写库、不改状态')
    assert.deepEqual(idsOf(audit.advices), ['retire:retiring'])
    assert.equal(audit.archived, 0, '只读审计不结算')
  } finally {
    await h.cleanup()
  }
})

test('调用证据：只有给了工作区才记，重复不重复记，封顶 32 条', async () => {
  const h = await harness()
  try {
    const created = await seed(h.service)
    await h.service.invoke(created.id, NOW, '/ws/a')
    const again = await h.service.invoke(created.id, NOW, '/ws/a')
    assert.deepEqual(again.script.invokedWorkspaces, ['/ws/a'], '同一工作区只记一次')
    const elsewhere = await h.service.invoke(created.id, NOW, '/ws/b')
    assert.deepEqual(elsewhere.script.invokedWorkspaces, ['/ws/a', '/ws/b'])
    const noWorkspace = await h.service.invoke(created.id, NOW)
    assert.deepEqual(noWorkspace.script.invokedWorkspaces, ['/ws/a', '/ws/b'], '未知工作区不写字段')
    assert.equal(noWorkspace.script.invocationCount, 4)

    const crowded = Array.from({ length: 40 }, (_, index) => `/ws/${String(index)}`)
    assert.equal(invokedWorkspacesPatch(crowded, '/ws/new')?.length, 32)
    assert.equal(invokedWorkspacesPatch(crowded, '/ws/1'), undefined, '已在集合里 → 不写')
    assert.equal(invokedWorkspacesPatch([], null), undefined)
  } finally {
    await h.cleanup()
  }
})

test('读模型（A8）：summary 带宿主算的 successRate 与 stepCount，且**不含 steps**', async () => {
  const h = await harness()
  try {
    const created = await seed(h.service, { name: '读模型探针' })
    await h.service.invoke(created.id, NOW, '/ws/a')
    await h.service.recordResult(created.id, true, NOW)
    const [summary] = await h.service.listSummaries({ limit: 10 })
    assert.ok(summary !== undefined)
    assert.equal(summary.stepCount, 1)
    assert.equal(summary.successRate, 1)
    assert.equal(summary.successRate, successRate((await h.service.get(created.id))!))
    assert.equal('steps' in summary, false, '读模型不得夹带全文（否则人面有机会自己算）')
    assert.equal(toSummary(created).successRate, successRate(created))
  } finally {
    await h.cleanup()
  }
})

test('读路径归一化：缺新增字段的老记录按 schema 默认值补齐（2026-09-22 真宿主回归）', async () => {
  const h = await harness()
  try {
    // 旧版本写下的记录：没有 invokedWorkspaces（本次新增字段）。
    // 读路径若不归一化，审计会在 `record.invokedWorkspaces.length` 上抛 undefined，
    // 表现为真宿主 `/scripts/audit` 400 —— 预览（内存夹具）永远抓不到这类字节级兼容问题。
    const legacy = record({ id: 'legacy', name: '老版本写的脚本' }) as unknown as Record<string, unknown>
    delete legacy['invokedWorkspaces']
    await appendRaw(h.filePath, legacy)

    const [summary] = await h.service.listSummaries({ limit: 10 })
    assert.equal(summary?.id, 'legacy')
    assert.deepEqual(summary?.invokedWorkspaces, [], '缺字段 → schema 默认值')

    const audit = await h.service.readAudit(NOW)
    assert.equal(audit.stats.total, 1)
    assert.deepEqual(governanceAdvices([scriptViewSchema.parse({ ...legacy, invokedWorkspaces: [] })], NOW), [])
  } finally {
    await h.cleanup()
  }
})

/* ───────────────────────── HTTP 面（治理端点 + 读模型） ───────────────────────── */

interface FakeResponse {
  status: number
  body: { ok: boolean; value?: unknown; error?: { code: string; message: string } }
}

/** 走注册进 fake webServer 的真实 handler，断言路由与信封（不 mock 业务）。 */
async function call(h: Harness, method: string, url: string, payload?: unknown): Promise<FakeResponse> {
  const route = h.routes.find(entry => entry.path === '/scripts')
  assert.ok(route !== undefined, '路由必须已注册')
  const raw = payload === undefined ? '' : JSON.stringify(payload)
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json', host: '127.0.0.1:1' },
    on(event: string, listener: (chunk?: unknown) => void) {
      if (event === 'data' && raw.length > 0) listener(Buffer.from(raw))
      if (event === 'end') listener()
      return this
    },
    destroy: () => {},
  }
  const captured: FakeResponse = { status: 0, body: { ok: false } }
  let settle: (value: FakeResponse) => void = () => {}
  const responded = new Promise<FakeResponse>(resolve => { settle = resolve })
  const res = {
    headersSent: false,
    writeHead(status: number) { captured.status = status },
    end(text: string) {
      captured.body = JSON.parse(text) as FakeResponse['body']
      settle(captured)
    },
  }
  route.handler(req, res)
  // 处理是 async 的（handler 内部 void 掉了 promise）：等响应真正落地，而不是猜一个 tick。
  return await responded
}

test('HTTP：GET /scripts 返回读模型（无 steps、带 successRate），GET /scripts/audit 只读', async () => {
  const h = await harness()
  try {
    await seed(h.service, { name: 'HTTP 探针' })
    const list = await call(h, 'GET', '/scripts?limit=10')
    assert.equal(list.status, 200)
    const items = list.body.value as { name: string; stepCount: number; successRate: number; steps?: unknown }[]
    assert.equal(items.length, 1)
    assert.equal(items[0]?.stepCount, 1)
    assert.equal(typeof items[0]?.successRate, 'number')
    assert.equal(items[0]?.steps, undefined, '读模型不带全文 steps（A8）')

    const audit = await call(h, 'GET', '/scripts/audit')
    assert.equal(audit.status, 200)
    const payload = audit.body.value as { archived: number; stats: { total: number }; advices: unknown[] }
    assert.equal(payload.archived, 0, 'GET 只读，不结算')
    assert.equal(payload.stats.total, 1)
    assert.deepEqual(payload.advices, [])
  } finally {
    await h.cleanup()
  }
})

test('HTTP：POST /scripts/sweep 结算过期并返回审计负载；POST /scripts/:id/status 取代链要带 supersededBy', async () => {
  const h = await harness()
  try {
    await seed(h.service, { name: '会过期的', expiresAt: NOW - 1 })
    const swept = await call(h, 'POST', '/scripts/sweep', {})
    assert.equal(swept.status, 200)
    assert.equal((swept.body.value as { archived: number }).archived, 1)

    const keeper = await seed(h.service, { name: '留存者', steps: [{ kind: 'tool-call', payload: 'pnpm keep' }] })
    const loser = await seed(h.service, { name: '重复者', steps: [{ kind: 'tool-call', payload: 'pnpm lose' }] })
    const bad = await call(h, 'POST', '/scripts/' + loser.id + '/status', { status: 'superseded' })
    assert.equal(bad.status, 400, 'superseded 不带 supersededBy 必须被拒（取代链不能断）')
    const ok = await call(h, 'POST', '/scripts/' + loser.id + '/status', { status: 'superseded', supersededBy: keeper.id })
    assert.equal(ok.status, 200)
    assert.equal((ok.body.value as ScriptView).supersededBy, keeper.id)

    const scoped = await call(h, 'POST', '/scripts/' + keeper.id + '/scope', { scope: 'global' })
    assert.equal(scoped.status, 200)
    assert.equal((scoped.body.value as ScriptView).scope, 'global')
    const badScope = await call(h, 'POST', '/scripts/' + keeper.id + '/scope', { scope: 'session' })
    assert.equal(badScope.status, 400, 'session 作用域已退役（Spec D1）')
  } finally {
    await h.cleanup()
  }
})

test('HTTP：动作端点只认已归档的物理删除（INV-11），并且拒绝跨站写请求', async () => {
  const h = await harness()
  try {
    const active = await seed(h.service, { name: '活跃的' })
    const rejected = await call(h, 'DELETE', '/scripts/' + active.id)
    assert.equal(rejected.status, 409)
    assert.equal((rejected.body.value as { removed: boolean }).removed, false)

    const archived = await call(h, 'POST', '/scripts/' + active.id + '/status', { status: 'archived' })
    assert.equal(archived.status, 200)
    const removed = await call(h, 'DELETE', '/scripts/' + active.id)
    assert.equal(removed.status, 200)
    assert.equal((removed.body.value as { removed: boolean }).removed, true)
  } finally {
    await h.cleanup()
  }
})

test('HTTP：跨站写请求 403（与 spark/finance 同口径）', async () => {
  const h = await harness()
  try {
    const route = h.routes.find(entry => entry.path === '/scripts')!
    const statuses: number[] = []
    let settle: () => void = () => {}
    const responded = new Promise<void>(resolve => { settle = resolve })
    const res = {
      headersSent: false,
      writeHead(status: number) { statuses.push(status) },
      end() { settle() },
    }
    route.handler({
      method: 'POST',
      url: '/scripts',
      headers: { 'sec-fetch-site': 'cross-site', host: '127.0.0.1:1' },
      on() { return this },
      destroy: () => {},
    }, res)
    await responded
    assert.deepEqual(statuses, [403])
  } finally {
    await h.cleanup()
  }
})
