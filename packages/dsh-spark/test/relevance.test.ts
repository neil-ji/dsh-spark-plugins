/**
 * 语义召回单测（v2 §4.4 P13，纯函数）。
 *
 * 锁三件事：① tokenize/jaccard 是**召回与涌现共用的单一真源**（口径漂移只有用户
 * 能发现）；② selectRelevant 的排序判据确定（同输入同输出）；③ 阈值语义 ——
 * 不相关的候选必须被挡掉，否则注入面会被噪声淹没（召回 ≠ 多注入）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { jaccard, selectRelevant, tokenize } from '../src/relevance.ts'
import type { SparkView } from 'dsh-spark-wire'

const NOW = 1_700_000_000_000

function spark(overrides: Partial<SparkView> = {}): SparkView {
  return {
    id: overrides.id ?? 's1',
    title: overrides.title ?? 'a spark',
    content: overrides.content ?? 'body',
    scope: 'project',
    workspacePath: null,
    status: overrides.status ?? 'active',
    tags: overrides.tags ?? [],
    origin: 'human',
    derivedFrom: [],
    generation: 0,
    sourceSessionId: 'sess',
    sourceAgentId: null,
    sourceTurn: null,
    createdAt: NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    stateChangedAt: null,
    deletedAt: overrides.deletedAt ?? null,
  }
}

test('tokenize: latin 词小写化 + CJK 滑窗 bigram（v1 累积 bug 的回归）', () => {
  assert.deepEqual(tokenize('Hello World'), ['hello', 'world'])
  const cjk = tokenize('火花召回路')
  assert.deepEqual(cjk, ['火花', '花召', '召回', '回路'], '必须是滑窗 bigram，不是一整个长 token')
  assert.deepEqual(tokenize('火'), ['火'], '单字 run 兜底为 unigram')
})

test('tokenize: 标点与空白不产生空 token', () => {
  assert.deepEqual(tokenize('  a,,b  '), ['a', 'b'])
  assert.deepEqual(tokenize('   '), [])
})

test('jaccard: 相同=1、无交集=0、空集=0', () => {
  assert.equal(jaccard(['a', 'b'], ['a', 'b']), 1)
  assert.equal(jaccard(['a'], ['b']), 0)
  assert.equal(jaccard([], ['a']), 0)
})

test('selectRelevant: 相关火花召回、无关火花被阈值挡掉', () => {
  const pool = [
    spark({ id: 'hit', title: 'preview mock channel', content: 'zero-dsh component preview' }),
    spark({ id: 'miss', title: 'finance ledger', content: 'monthly balance' }),
  ]
  const out = selectRelevant(pool, 'preview mock channel', { limit: 5 })
  assert.equal(out.length, 1, JSON.stringify(out))
  assert.equal(out[0]!.spark.id, 'hit')
  assert.ok(out[0]!.score > 0)
})

test('selectRelevant: 空查询 / limit 0 返回空（不猜）', () => {
  const pool = [spark({ id: 'a' })]
  assert.deepEqual(selectRelevant(pool, '   ', {}), [])
  assert.deepEqual(selectRelevant(pool, 'a spark', { limit: 0 }), [])
})

test('selectRelevant: 排序确定（分数 → 更新时间 → id）', () => {
  const pool = [
    spark({ id: 'b', title: 'dock overlay', updatedAt: NOW }),
    spark({ id: 'a', title: 'dock overlay', updatedAt: NOW }),
    spark({ id: 'newer', title: 'dock overlay', updatedAt: NOW + 1 }),
  ]
  const first = selectRelevant(pool, 'dock overlay', { limit: 3 })
  assert.deepEqual(first.map(e => e.spark.id), ['newer', 'a', 'b'])
  const second = selectRelevant(pool, 'dock overlay', { limit: 3 })
  assert.deepEqual(second.map(e => e.spark.id), first.map(e => e.spark.id), '同输入同输出')
})

test('selectRelevant: limit 生效，返回按分数降序', () => {
  const pool = [
    spark({ id: 'full', title: 'recall ranking', content: 'recall ranking' }),
    spark({ id: 'partial', title: 'recall only', content: 'other words' }),
    spark({ id: 'weak', title: 'recall', content: 'a b c d e f' }),
  ]
  const out = selectRelevant(pool, 'recall ranking', { limit: 2 })
  assert.equal(out.length, 2)
  assert.equal(out[0]!.spark.id, 'full', '重合度最高排前')
  assert.ok(out[0]!.score >= out[1]!.score)
})

test('selectRelevant: CJK 查询能召回中文火花', () => {
  const pool = [
    spark({ id: 'zh', title: '火花语义召回', content: '按查询注入相关火花' }),
    spark({ id: 'other', title: '财务台账', content: '月度结余' }),
  ]
  const out = selectRelevant(pool, '火花召回', { limit: 5 })
  assert.equal(out.length, 1)
  assert.equal(out[0]!.spark.id, 'zh')
})

test('selectRelevant: minScore 可调（严格挡噪声）', () => {
  const pool = [spark({ id: 'weak', title: 'dock', content: 'panel' })]
  assert.equal(selectRelevant(pool, 'dock overlay unrelated finance ledger', { minScore: 0.2 }).length, 0)
  assert.equal(selectRelevant(pool, 'dock overlay unrelated finance ledger', { minScore: 0.01 }).length, 1)
})

test('selectRelevant: minScore=0 也不返回零重合候选（不是全量兜底）', () => {
  const pool = [spark({ id: 'irrelevant', title: 'finance ledger', content: 'monthly balance' })]
  assert.deepEqual(selectRelevant(pool, 'zzzznomatchzzz', { limit: 5, minScore: 0 }), [])
})

test('selectRelevant: 墓碑由调用方过滤（本函数不做生命周期判断）', () => {
  const pool = [spark({ id: 'dead', title: 'dock overlay', deletedAt: NOW })]
  assert.equal(selectRelevant(pool, 'dock overlay', {}).length, 1, '纯函数只管相似度，生命周期归 service')
})
