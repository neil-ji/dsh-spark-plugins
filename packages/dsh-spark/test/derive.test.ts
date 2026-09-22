/**
 * 衍生引擎纯逻辑单测（v2 §5，P15 + P17）。
 *
 * 锁的是反自噬三条 + 「生成必须是熵增」这一条产品主张：
 *  - 太像的火花不成对（重复没意义），太不像的也不成对（硬凑是噪声）；
 *  - `derived` 不作父本；
 *  - 与输入/已有火花 Jaccard ≥ 0.85 的产出是**复述**，必须被拒并留下原因；
 *  - 模型输出是不可信外部数据：父代 id 必须在候选对里（防凭空编造）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RESTATEMENT_THRESHOLD,
  buildDerivePrompt,
  checkRestatement,
  parseDerivedCandidates,
  partitionCandidates,
  selectDerivationPairs,
} from '../src/derive.ts'
import type { SparkOrigin, SparkView } from 'dsh-spark-wire'

const NOW = 1_700_000_000_000

function spark(overrides: Partial<SparkView> = {}): SparkView {
  return {
    id: overrides.id ?? 's1',
    title: overrides.title ?? 'a spark',
    content: overrides.content ?? 'body',
    scope: overrides.scope ?? 'project',
    workspacePath: null,
    status: overrides.status ?? 'active',
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
    deletedAt: overrides.deletedAt ?? null,
  }
}

test('selectDerivationPairs: 只取中段相似度（太像=重复、太不像=无关都不成对）', () => {
  const pool = [
    spark({ id: 'base', title: 'preview mock channel transport' }),
    // 完全重合 → 落在 maxSimilarity 之上，不成对（那是重复）
    spark({ id: 'dup', title: 'preview mock channel transport' }),
    // 中段：共享 2 个 token
    spark({ id: 'mid', title: 'preview mock probe' }),
    // 完全无关
    spark({ id: 'far', title: 'finance ledger balance' }),
  ]
  const pairs = selectDerivationPairs(pool, { minSimilarity: 0.15, maxSimilarity: 0.7 })
  const ids = pairs.map(p => [p.a.id, p.b.id].sort().join('+'))
  assert.ok(ids.includes('base+mid'), JSON.stringify(ids))
  assert.ok(!ids.includes('base+dup'), '完全重复不该被当成组合素材')
  assert.ok(!ids.some(id => id.includes('far')), '无关火花不硬凑')
})

test('selectDerivationPairs: derived 不作父本，归档/墓碑不参与', () => {
  const pool = [
    spark({ id: 'human1', title: 'preview mock channel transport' }),
    spark({ id: 'human2', title: 'preview mock probe layout' }),
    spark({ id: 'derived1', title: 'preview mock recombination', origin: 'derived', generation: 1 }),
    spark({ id: 'archived1', title: 'preview mock archived', status: 'archived' }),
    spark({ id: 'dead1', title: 'preview mock tombstone', deletedAt: NOW }),
  ]
  const pairs = selectDerivationPairs(pool, { minSimilarity: 0.1, maxSimilarity: 0.9 })
  for (const pair of pairs) {
    assert.notEqual(pair.a.origin, 'derived')
    assert.notEqual(pair.b.origin, 'derived')
    assert.equal(pair.a.status, 'active')
    assert.equal(pair.a.deletedAt, null)
  }
})

test('selectDerivationPairs: seed 模式只出与种子成对的组合', () => {
  const pool = [
    spark({ id: 'seed', title: 'preview mock channel transport' }),
    spark({ id: 'a', title: 'preview mock probe' }),
    spark({ id: 'b', title: 'preview mock layout' }),
    spark({ id: 'c', title: 'mock channel dial' }),
  ]
  const pairs = selectDerivationPairs(pool, { seedId: 'seed', minSimilarity: 0.05, maxSimilarity: 0.95 })
  assert.ok(pairs.length > 0)
  for (const pair of pairs) {
    assert.ok(pair.a.id === 'seed' || pair.b.id === 'seed', JSON.stringify([pair.a.id, pair.b.id]))
  }
})

test('selectDerivationPairs: 判据确定（同输入同输出）', () => {
  const pool = [
    spark({ id: 'a', title: 'preview mock channel' }),
    spark({ id: 'b', title: 'preview mock probe' }),
    spark({ id: 'c', title: 'preview channel layout' }),
  ]
  const first = selectDerivationPairs(pool).map(p => p.a.id + p.b.id)
  const second = selectDerivationPairs(pool).map(p => p.a.id + p.b.id)
  assert.deepEqual(second, first)
})

test('checkRestatement: 与已有标题重合 ≥ 0.85 判为复述；空产出也拒', () => {
  const restated = { title: 'preview mock channel transport', content: 'x', tags: [], derivedFrom: ['a'] }
  const check = checkRestatement(restated, ['preview mock channel transport'])
  assert.equal(check.rejected, true)
  assert.equal(check.reason, 'restatement')
  assert.equal(RESTATEMENT_THRESHOLD, 0.85)
  const empty = checkRestatement({ title: '  ', content: '', tags: [], derivedFrom: ['a'] }, [])
  assert.equal(empty.reason, 'empty')
  const fresh = checkRestatement({ title: 'ondemand pricing for idea pools', content: 'y', tags: [], derivedFrom: ['a'] }, ['preview mock channel'])
  assert.equal(fresh.rejected, false)
})

test('partitionCandidates: 同一轮里自己复述自己也被拒（含本轮已接受项）', () => {
  const candidates = [
    { title: 'recombination of preview and dock', content: 'a', tags: [], derivedFrom: ['x'] },
    { title: 'recombination of preview and dock', content: 'b', tags: [], derivedFrom: ['y'] },
  ]
  const { accepted, rejected } = partitionCandidates(candidates, [])
  assert.equal(accepted.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0]!.reason, 'restatement')
})

test('parseDerivedCandidates: 父代 id 必须在候选对里（防凭空编造）+ 容忍围栏与解释文字', () => {
  const raw = [
    'Sure, here you go:',
    '```json',
    '{"sparks":[',
    '  {"title":"a new idea","content":"combine them","tags":["x"],"derivedFrom":["p1"],"reason":"because"},',
    '  {"title":"invented","content":"ghost parent","derivedFrom":["ghost"]},',
    '  {"title":"","content":"empty title","derivedFrom":["p1"]}',
    ']}',
    '```',
    'Hope that helps!',
  ].join('\n')
  const parsed = parseDerivedCandidates(raw, ['p1', 'p2'])
  assert.equal(parsed.length, 1, JSON.stringify(parsed))
  assert.equal(parsed[0]!.title, 'a new idea')
  assert.deepEqual(parsed[0]!.derivedFrom, ['p1'])
  assert.equal(parsed[0]!.reason, 'because')
})

test('parseDerivedCandidates: 非法输出一律返回空数组（生成失败不抛错）', () => {
  assert.deepEqual(parseDerivedCandidates('not json at all', ['p1']), [])
  assert.deepEqual(parseDerivedCandidates('{"sparks": "nope"}', ['p1']), [])
  assert.deepEqual(parseDerivedCandidates('{"sparks":[{"title":"t","content":"c","derivedFrom":[]}]}', ['p1']), [])
})

test('buildDerivePrompt: 明确禁止复述 + 要求 JSON + 列出候选对与已知标题', () => {
  const pairs = [{ a: spark({ id: 'a1', title: 'A' }), b: spark({ id: 'b1', title: 'B' }), similarity: 0.4, tagDistant: true }]
  const prompt = buildDerivePrompt(pairs, ['A', 'B'], 3)
  assert.match(prompt.system, /Reply with JSON only/)
  assert.match(prompt.system, /Restating an existing idea is failure/)
  assert.match(prompt.user, /do NOT restate these/)
  assert.match(prompt.user, /- A/)
  assert.match(prompt.user, /\[a1\] A/)
  assert.match(prompt.user, /at most 3 new ideas/)
})
