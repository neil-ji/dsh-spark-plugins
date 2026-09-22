/**
 * Phase 4 emergence proposal tests (pure logic, no cordis).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateProposals, dedupKey, newProposalId } from '../src/proposals.ts'
import type { SparkView, ReflectRequest } from 'dsh-spark-wire'

function makeSpark(overrides: Partial<SparkView> = {}): SparkView {
  const now = 1_700_000_000_000
  return {
    id: overrides.id ?? 's',
    title: overrides.title ?? 'A thought',
    content: overrides.content ?? 'some content',
    scope: overrides.scope ?? 'project',
    workspacePath: overrides.workspacePath ?? null,
    status: overrides.status ?? 'active',
    tags: overrides.tags ?? [],
    sourceSessionId: overrides.sourceSessionId ?? 'sess',
    sourceAgentId: overrides.sourceAgentId ?? null,
    sourceTurn: overrides.sourceTurn ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    stateChangedAt: overrides.stateChangedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
  }
}

const DEFAULT_OPTS: ReflectRequest = {
  candidateLimit: 30,
  linkThreshold: 0.5,
  clusterMinSharedTags: 2,
  pruneStaleDays: 14,
}

test('link: two sparks with identical title produce a link proposal at jaccard=1', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', title: 'cognitive filter prefrontal' }),
    makeSpark({ id: 'b', title: 'cognitive filter prefrontal' }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  // jaccard = 1.0, but our rule excludes j === 1 (identical is already linked by content dedup at capture time).
  assert.equal(out.filter(c => c.type === 'link').length, 0, 'identical titles skipped to avoid trivial proposals')
})

test('link: two sparks with high-overlap title produce a link proposal', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', title: 'cognitive filter for hippo' }),
    makeSpark({ id: 'b', title: 'cognitive filter on hippo' }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  const links = out.filter(c => c.type === 'link')
  assert.equal(links.length, 1)
  assert.deepEqual(links[0]!.sparkIds.sort(), ['a', 'b'])
  assert.ok(links[0]!.confidence >= 0.5)
  assert.equal(links[0]!.leverage, 'medium')
})

test('link: distinct titles produce no link proposal', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', title: 'alpha' }),
    makeSpark({ id: 'b', title: 'beta gamma' }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  assert.equal(out.filter(c => c.type === 'link').length, 0)
})

test('cluster: 3+ sparks sharing 2+ tags produce a cluster proposal', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', title: 'foo', tags: ['design', 'memory'] }),
    makeSpark({ id: 'b', title: 'bar', tags: ['design', 'memory'] }),
    makeSpark({ id: 'c', title: 'baz', tags: ['design', 'memory'] }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  const clusters = out.filter(c => c.type === 'cluster')
  assert.equal(clusters.length, 1)
  assert.deepEqual(clusters[0]!.sparkIds.sort(), ['a', 'b', 'c'])
  assert.equal(clusters[0]!.leverage, 'high')
  assert.match(clusters[0]!.explanation, /design, memory/)
})

test('cluster: 2 sparks (even with shared tags) do NOT produce cluster', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', tags: ['design', 'memory'] }),
    makeSpark({ id: 'b', tags: ['design', 'memory'] }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  assert.equal(out.filter(c => c.type === 'cluster').length, 0)
})

test('prune: stale active spark (untouched > 14 days) produces prune proposal', () => {
  const now = 1_700_000_000_000
  const longAgo = now - 30 * 86_400_000 // 30 days old
  const sparks = [
    makeSpark({ id: 'a', title: 'old thought', updatedAt: longAgo }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  const prunes = out.filter(c => c.type === 'prune')
  assert.equal(prunes.length, 1)
  assert.deepEqual(prunes[0]!.sparkIds, ['a'])
  assert.equal(prunes[0]!.leverage, 'low')
  assert.match(prunes[0]!.explanation, /天/)
})

test('archived stale spark is NOT pruned', () => {
  const now = 1_700_000_000_000
  const longAgo = now - 30 * 86_400_000
  const sparks = [
    makeSpark({ id: 'a', updatedAt: longAgo, status: 'archived' }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  assert.equal(out.filter(c => c.type === 'prune').length, 0)
})

test('prune: recent spark is NOT pruned', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', updatedAt: now - 1 * 86_400_000 }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  assert.equal(out.filter(c => c.type === 'prune').length, 0)
})

test('archived / tombstoned sparks are filtered out before emergence', () => {
  const now = 1_700_000_000_000
  const title = 'alpha beta gamma delta'
  const out = generateProposals([
    makeSpark({ id: 'a', title }),
    makeSpark({ id: 'b', status: 'archived', title }),
  ], DEFAULT_OPTS, now)
  assert.equal(out.filter(c => c.type === 'link').length, 0, 'archived must not pair')
  // 墓碑（软删除）不参与
  const withTombstone = generateProposals([
    makeSpark({ id: 'a', title }),
    makeSpark({ id: 'b', title, deletedAt: now }),
  ], DEFAULT_OPTS, now)
  assert.equal(withTombstone.filter(c => c.type === 'link').length, 0, 'tombstoned sparks must not pair')
})

test('prune: only active sparks participate (v2 P11: dropped 已并入墓碑)', () => {
  const now = 1_700_000_000_000
  const longAgo = now - 30 * 86_400_000
  const sparks = [
    makeSpark({ id: 'active-old', updatedAt: longAgo }),
    makeSpark({ id: 'archived-old', status: 'archived', updatedAt: longAgo }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  const prunes = out.filter(c => c.type === 'prune')
  assert.equal(prunes.length, 1)
  assert.equal(prunes[0]!.sparkIds[0], 'active-old')
})

test('mixed scenario: link + cluster + prune all fire together', () => {
  const now = 1_700_000_000_000
  const longAgo = now - 30 * 86_400_000
  const sparks = [
    makeSpark({ id: 'a', title: 'cognitive filter design', tags: ['design', 'hippo'] }),
    makeSpark({ id: 'b', title: 'cognitive filter on design', tags: ['design', 'hippo'] }),
    makeSpark({ id: 'c', title: 'random unrelated', tags: ['design', 'hippo'] }),
    makeSpark({ id: 'd', title: 'old to prune', updatedAt: longAgo }),
  ]
  const out = generateProposals(sparks, DEFAULT_OPTS, now)
  const link = out.filter(c => c.type === 'link')
  const cluster = out.filter(c => c.type === 'cluster')
  const prune = out.filter(c => c.type === 'prune')
  assert.ok(link.length >= 1, 'should have at least 1 link')
  assert.equal(cluster.length, 1, '3 sparks sharing 2 tags → 1 cluster')
  assert.equal(prune.length, 1, '1 stale active → 1 prune')
  assert.deepEqual(cluster[0]!.sparkIds.sort(), ['a', 'b', 'c'])
})

test('dedupKey: sorted sparkIds produce a stable key', () => {
  const a = { type: 'link' as const, sparkIds: ['b', 'a'], explanation: '', confidence: 1, leverage: 'medium' as const }
  const b = { type: 'link' as const, sparkIds: ['a', 'b'], explanation: '', confidence: 1, leverage: 'medium' as const }
  assert.equal(dedupKey(a), dedupKey(b))
  assert.equal(dedupKey(a), 'link:a,b')
})

test('newProposalId returns a non-empty string', () => {
  const id = newProposalId()
  assert.equal(typeof id, 'string')
  assert.ok(id.length > 0)
})

// ---- 2026-09-23（F6 挖掘管线修复）：link 判据的回归 ----

/**
 * 实库的病历：18 条 valence 挖掘火花，标题同一模板前缀「用户偏好：Don't 」、
 * 目标词互不相同、tags 完全相同。旧口径（只比标题 token）让**任意两条**都拿到
 * 0.50~0.71 的 Jaccard —— 实库 154 条 pending 提议里 148 条是这种伪 link，
 * 其中 146 条剥掉模板前缀后真实相似度是 0.00。
 */
test('link 回归（F6）：模板化池不再产生成片的伪 link（曾经 148/153 对全部命中）', () => {
  const TARGETS = [
    'override system', 'follow instructions', '在两处维护内容', '并行', '引入依赖', '手改',
    '真启动', '攒到最后一次性提交', '用 shell', 'cheerlead', 'fabricate', 'disclosed',
  ]
  const sparks = TARGETS.map((t, i) => makeSpark({
    id: 'v' + String(i),
    title: `用户偏好：Don't ${t}`,
    content: `do not ${t}`,
    tags: ['preference', 'valence-mined', 'do-not'],
  }))
  const now = 1_700_000_000_000
  const links = generateProposals(sparks, DEFAULT_OPTS, now).filter(c => c.type === 'link')
  assert.equal(links.length, 0, '模板前缀 + 同一组 tags 不该算「两条火花像」：' + String(links.length) + ' 条')
})

/**
 * 反向锁：模板抑制不能把功能治死。健康的、主题各异的池子上必须**行为不变** ——
 * 真正相近的两条仍然要成 link。
 */
test('link 回归（F6）：健康池上模板抑制是 no-op，真正相近的两条仍成 link', () => {
  const now = 1_700_000_000_000
  const sparks = [
    makeSpark({ id: 'a', title: 'hippomemo 多模态记忆 caption 渐进路线', content: '多模态记忆先 caption 再入库' }),
    makeSpark({ id: 'b', title: 'hippomemo 多模态记忆 caption 存储路线', content: '多模态记忆先 caption 再存储' }),
    makeSpark({ id: 'c', title: '财务插件额度预测', content: '月费不变才能做额度预测' }),
    makeSpark({ id: 'd', title: 'macOS 救援定位下修', content: '窄缝不是市场，是 runbook 授权' }),
    makeSpark({ id: 'e', title: '竞品失败分类即市场规模尺', content: '读在位者免费工具的错误枚举' }),
    makeSpark({ id: 'f', title: '火花衍生引擎反自噬', content: '标题相似度去重防止复述' }),
  ]
  const links = generateProposals(sparks, DEFAULT_OPTS, now).filter(c => c.type === 'link')
  assert.ok(
    links.some(l => l.sparkIds.includes('a') && l.sparkIds.includes('b')),
    'a/b（caption 两条）必须被检出：' + JSON.stringify(links.map(l => [l.sparkIds, Math.round(l.confidence * 100)])),
  )
})
console.log('proposals tests loaded');
