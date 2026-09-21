/**
 * Graph 子页的关联口径单测（纯函数，无 cordis）。
 *
 * 锁的是三件容易悄悄腐坏的事：
 *  1. 裁剪判据必须**确定**（同输入同输出）—— 否则图会随渲染抖动；
 *  2. 三类边的语义边界（结晶谱系 / 标签亲和阈值 / 提议关联），
 *     尤其「共享标签数没到阈值就不连」这条阈值语义；
 *  3. 墓碑与 dropped 不参与（判过死刑的记录不该出现在图里）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSparkGraph, memoryNodeId, selectGraphSparks, sparkNodeId } from '../src/graph.ts'
import type { ProposalView, SparkView } from 'dsh-spark-wire'

const NOW = 1_700_000_000_000

function spark(overrides: Partial<SparkView> = {}): SparkView {
  return {
    id: overrides.id ?? 's1',
    title: overrides.title ?? 'a spark',
    content: overrides.content ?? 'body',
    scope: overrides.scope ?? 'project',
    workspacePath: overrides.workspacePath ?? '/tmp/proj',
    inboxState: overrides.inboxState ?? 'pending',
    tags: overrides.tags ?? [],
    sourceSessionId: overrides.sourceSessionId ?? 'sess',
    sourceAgentId: overrides.sourceAgentId ?? null,
    sourceTurn: overrides.sourceTurn ?? null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    stateChangedAt: overrides.stateChangedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    crystallized: overrides.crystallized ?? null,
  }
}

function proposal(overrides: Partial<ProposalView> = {}): ProposalView {
  return {
    id: overrides.id ?? 'p1',
    type: overrides.type ?? 'link',
    sparkIds: overrides.sparkIds ?? [],
    explanation: overrides.explanation ?? 'why',
    confidence: overrides.confidence ?? 0.8,
    leverage: overrides.leverage ?? 'high',
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? NOW,
    resolvedAt: overrides.resolvedAt ?? null,
  }
}

test('selectGraphSparks 排除墓碑与 dropped，并按状态→更新时间排序截断', () => {
  const sparks = [
    spark({ id: 'arch', inboxState: 'archived', updatedAt: NOW + 500 }),
    spark({ id: 'dead', deletedAt: NOW }),
    spark({ id: 'gone', inboxState: 'dropped' }),
    spark({ id: 'new1', inboxState: 'pending', updatedAt: NOW + 10 }),
    spark({ id: 'new2', inboxState: 'pending', updatedAt: NOW + 20 }),
    spark({ id: 'cryst', inboxState: 'crystallized', updatedAt: NOW + 999 }),
  ]
  const { picked, truncated } = selectGraphSparks(sparks, 3)
  assert.deepEqual(picked.map(s => s.id), ['new2', 'new1', 'cryst'], '活跃度优先，其次新近')
  assert.equal(truncated, true)

  const again = selectGraphSparks(sparks, 3)
  assert.deepEqual(again.picked.map(s => s.id), picked.map(s => s.id), '判据确定（同输入同输出）')
})

test('结晶谱系：结晶火花带出 memory 节点与一条 crystallized 边', () => {
  const graph = buildSparkGraph(
    [spark({ id: 's1', crystallized: { hippoId: 'h1', kind: 'insight', at: NOW } })],
    [],
    { now: NOW },
  )
  assert.deepEqual(graph.nodes.map(n => n.id).sort(), [memoryNodeId('h1'), sparkNodeId('s1')].sort())
  const memory = graph.nodes.find(n => n.kind === 'memory')!
  assert.equal(memory.label, 'a spark', '记忆节点沿用火花标题（不额外查 hippo）')
  assert.equal(memory.inboxState, null)
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0]!.kind, 'crystallized')
  assert.equal(graph.edges[0]!.weight, 1)
  assert.equal(graph.nodes.find(n => n.id === sparkNodeId('s1'))!.degree, 1, '度由宿主算好')
})

test('标签亲和：共享数达到阈值才连，权重=共享标签数', () => {
  const sparks = [
    spark({ id: 'a', tags: ['ui', 'kit', 'dsh'] }),
    spark({ id: 'b', tags: ['ui', 'kit'] }),
    spark({ id: 'c', tags: ['ui', 'other'] }),
  ]
  const graph = buildSparkGraph(sparks, [], { tagMinShared: 2, now: NOW })
  const tagEdges = graph.edges.filter(e => e.kind === 'tag')
  assert.equal(tagEdges.length, 1, '只有 a-b 达到 2 个共享标签')
  assert.deepEqual([tagEdges[0]!.source, tagEdges[0]!.target].sort(), [sparkNodeId('a'), sparkNodeId('b')].sort())
  assert.equal(tagEdges[0]!.weight, 2)

  const loose = buildSparkGraph(sparks, [], { tagMinShared: 1, now: NOW })
  assert.equal(loose.edges.filter(e => e.kind === 'tag').length, 3, '阈值降到 1 时三对两两相连')
})

test('提议关联：同一对火花在多条提议里同现时权重累加，且只连图内的火花', () => {
  const sparks = [spark({ id: 'a' }), spark({ id: 'b' }), spark({ id: 'c' })]
  const proposals = [
    proposal({ id: 'p1', sparkIds: ['a', 'b', 'zzz'] }),
    proposal({ id: 'p2', sparkIds: ['a', 'b'] }),
    proposal({ id: 'p3', sparkIds: ['b', 'c'] }),
  ]
  const graph = buildSparkGraph(sparks, proposals, { now: NOW })
  const proposalEdges = graph.edges.filter(e => e.kind === 'proposal')
  assert.equal(proposalEdges.length, 2, 'a-b 与 b-c；跨出图外的 zzz 不连')
  const ab = proposalEdges.find(e => e.source === sparkNodeId('a') || e.target === sparkNodeId('a'))!
  assert.equal(ab.weight, 2, '两条提议同现 → 权重 2')
})

test('无关联时给出完整的空图而不是报错（前端据此走空态）', () => {
  const graph = buildSparkGraph([spark({ id: 'solo' })], [], { now: NOW })
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.nodes[0]!.degree, 0)
  assert.equal(graph.edges.length, 0)
  assert.equal(graph.truncated, false)
  assert.equal(graph.generatedAt, NOW)
})

test('裁剪时 truncated 置位，且被裁掉的火花不会以悬空边出现', () => {
  const sparks = Array.from({ length: 5 }, (_, i) => spark({ id: 's' + String(i), tags: ['x', 'y'] }))
  const graph = buildSparkGraph(sparks, [proposal({ sparkIds: ['s0', 's4'] })], { limit: 2, tagMinShared: 2, now: NOW })
  assert.equal(graph.truncated, true)
  assert.equal(graph.nodes.length, 2)
  const ids = new Set(graph.nodes.map(n => n.id))
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.source) && ids.has(edge.target), '边两端必须在图内:' + JSON.stringify(edge))
  }
  assert.equal(graph.edges.filter(e => e.kind === 'proposal').length, 0, 's4 被裁掉 → 该提议不产边')
})
