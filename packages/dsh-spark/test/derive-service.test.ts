/**
 * 衍生引擎的**编排**测试：假模型 + 假落库，跑 `runDerivationRound`（生产同一条路径）。
 *
 * 为什么必须这样测：真宿主的沙箱 profile 没有模型凭据（`ctx.llm` 在、route 也在，
 * 但流是空的），端到端跑不通真模型；而这条编排正是"能不能生成、生成的东西对不对"
 * 的全部逻辑所在 —— 用假模型把它钉住，真宿主只需验收注册面与降级路径。
 *
 * 覆盖：完整链路 / provenance 落库（origin=derived、generation、expiresAt）/
 * 复述被拒 / 未知父被 provenance 闸拒 / 降级四态（无 llm、无 route、调用抛错、空输出）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { runDerivationRound, type DeriveDeps } from '../src/derive-service.ts'
import { resolveProvenance, SparkProvenanceError } from '../src/types.ts'
import type { SparkOrigin, SparkView } from 'dsh-spark-wire'

const NOW = 1_700_000_000_000
const TTL_MS = 14 * 86_400_000

function spark(overrides: Partial<SparkView> = {}): SparkView {
  return {
    id: overrides.id ?? 's1',
    title: overrides.title ?? 'a spark',
    content: overrides.content ?? 'body',
    scope: overrides.scope ?? 'project',
    workspacePath: overrides.workspacePath ?? null,
    status: 'active',
    tags: overrides.tags ?? [],
    origin: (overrides.origin ?? 'human') as SparkOrigin,
    derivedFrom: overrides.derivedFrom ?? [],
    generation: overrides.generation ?? 0,
    recalledCount: 0,
    lastRecalledAt: null,
    expiresAt: overrides.expiresAt ?? null,
    sourceSessionId: 'sess',
    sourceAgentId: null,
    sourceTurn: null,
    createdAt: NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    stateChangedAt: null,
    deletedAt: null,
  }
}

/** 两两可成对的池子（标题共享部分 token，落在中段相似度）。 */
const POOL = [
  spark({ id: 'p1', title: 'preview mock channel transport' }),
  spark({ id: 'p2', title: 'preview mock probe layout' }),
]

/**
 * 假模型：吐一个 `text-delta` chunk（**这是 BlockAssembler 唯一接受的文本形状** ——
 * `{type:'text'}` 会抛 "unreachable variant in BlockAssembler.push"，实测）。
 */
function fakeLlm(text: string | (() => never)): DeriveDeps['llm'] {
  return {
    stream: () => {
      if (typeof text === 'function') text()
      return (async function* () {
        yield { type: 'text-delta', text }
      })()
    },
  }
}

/** 假落库：走真实 provenance 解算 + 记录调用（与 SparkService.capture 同语义）。 */
function fakeCapture(records: SparkView[], now: number = NOW) {
  return async (input: unknown): Promise<SparkView> => {
    const req = input as {
      title: string; content: string; tags: string[]; scope: SparkView['scope']
      derivedFrom: string[]; origin: SparkOrigin
    }
    const provenance = resolveProvenance(
      { origin: req.origin, sourceAgentId: null, derivedFrom: req.derivedFrom },
      records.filter(r => req.derivedFrom.includes(r.id)),
    )
    const created = spark({
      ...req,
      id: 'derived-' + String(records.length + 1),
      ...provenance,
      expiresAt: now + TTL_MS,
    })
    records.push(created)
    return created
  }
}

const ROUTE = { provider: 'test', model: 'fake' }
const REQUEST = { maxPairs: 4, minSimilarity: 0.1, maxSimilarity: 0.9, maxResults: 2, dryRun: false }

test('完整链路：提示词 → 解析 → 复述过滤 → 落库（origin=derived + generation + expiresAt）', async () => {
  const records = [...POOL]
  const output = JSON.stringify({
    sparks: [
      { title: 'preview transport probe hybrid', content: 'combine the two', tags: ['combo'], derivedFrom: ['p1', 'p2'], reason: 'distant but related' },
      { title: 'preview mock channel transport', content: 'restating p1', derivedFrom: ['p1'], reason: 'should be rejected' },
    ],
  })
  const result = await runDerivationRound(REQUEST, {
    pool: POOL,
    llm: fakeLlm(output),
    route: ROUTE,
    capture: fakeCapture(records),
  }, NOW)

  assert.equal(result.skipped, null)
  assert.equal(result.created.length, 1, JSON.stringify(result))
  assert.equal(result.rejected.length, 1)
  assert.equal(result.rejected[0]!.reason, 'restatement')
  const created = result.created[0]!
  assert.equal(created.origin, 'derived')
  assert.equal(created.generation, 1, 'generation = max(父) + 1')
  assert.deepEqual(created.derivedFrom.sort(), ['p1', 'p2'])
  assert.equal(created.expiresAt, NOW + TTL_MS, '衍生即带过期时间（用过期代替审批）')
  assert.equal(created.status, 'active')
})

test('generation 上限：以 generation=2 的原创父本再衍生会被 provenance 闸拒（记录原因，不炸整轮）', async () => {
  const deepParents = [
    spark({ id: 'g2a', title: 'preview mock channel transport', generation: 2 }),
    spark({ id: 'g2b', title: 'preview mock probe layout' }),
  ]
  const records = [...deepParents]
  const output = JSON.stringify({ sparks: [{ title: 'third generation idea', content: 'x', derivedFrom: ['g2a', 'g2b'] }] })
  const result = await runDerivationRound(REQUEST, {
    pool: deepParents,
    llm: fakeLlm(output),
    route: ROUTE,
    capture: fakeCapture(records),
  }, NOW)
  assert.equal(result.created.length, 0)
  assert.equal(result.rejected.length, 1)
  assert.match(result.rejected[0]!.reason, /provenance:/)
  assert.equal(result.skipped, 'all candidates rejected')
})

test('反自噬：模型编造父代 id 会被解析层丢掉（不落库）', async () => {
  const records = [...POOL]
  const output = JSON.stringify({ sparks: [{ title: 'ghost idea', content: 'x', derivedFrom: ['ghost-id'] }] })
  const result = await runDerivationRound(REQUEST, {
    pool: POOL, llm: fakeLlm(output), route: ROUTE, capture: fakeCapture(records),
  }, NOW)
  assert.equal(result.created.length, 0)
  assert.equal(result.skipped, 'no usable output (unparseable, ' + String(output.length) + ' chars via test/fake)')
  assert.equal(records.length, POOL.length, '库里没有多出任何东西')
})

test('降级四态：无 LLM / 无 route / 调用抛错 / 空输出都必须 skipped 而不是报错', async () => {
  const base = { pool: POOL, capture: fakeCapture([...POOL]) }
  const noLlm = await runDerivationRound(REQUEST, { ...base }, NOW)
  assert.equal(noLlm.skipped, 'llm service unavailable')
  const noRoute = await runDerivationRound(REQUEST, { ...base, llm: fakeLlm('{}') }, NOW)
  assert.equal(noRoute.skipped, 'no model route')
  const failing = await runDerivationRound(REQUEST, {
    ...base, route: ROUTE, llm: fakeLlm(() => { throw new Error('401 unauthorized') }),
  }, NOW)
  assert.equal(failing.skipped, 'llm call failed')
  const empty = await runDerivationRound(REQUEST, { ...base, route: ROUTE, llm: fakeLlm('') }, NOW)
  assert.match(String(empty.skipped), /no usable output \(empty, 0 chars via test\/fake\)/)
})

test('dryRun：只选候选对，绝不调模型（零成本断言面）', async () => {
  let called = 0
  const llm = {
    stream: () => {
      called += 1
      return (async function* () { yield { type: 'text-delta', text: '{}' } })()
    },
  }
  const result = await runDerivationRound({ ...REQUEST, dryRun: true }, {
    pool: POOL, llm, route: ROUTE, capture: fakeCapture([...POOL]),
  }, NOW)
  assert.equal(called, 0, 'dryRun 不得触达模型')
  assert.ok((result.pairsConsidered ?? 0) > 0)
  assert.equal(result.skipped, 'dry run')
})

test('无候选对：skipped 说明原因，且不调模型', async () => {
  const result = await runDerivationRound(REQUEST, {
    pool: [spark({ id: 'solo', title: 'lonely idea' })],
    llm: fakeLlm('{}'),
    route: ROUTE,
    capture: fakeCapture([]),
  }, NOW)
  assert.equal(result.pairsConsidered, 0)
  assert.equal(result.skipped, 'no candidate pairs')
})

test('SparkProvenanceError 仍可被上层区分（编排把闸门错误转成 rejected 而不是静默）', () => {
  assert.throws(
    () => resolveProvenance({ origin: 'derived', sourceAgentId: null, derivedFrom: ['x'] }, []),
    SparkProvenanceError,
  )
})
