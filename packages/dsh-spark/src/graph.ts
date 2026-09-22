/**
 * 关联图谱（Graph 子页）的**唯一**计算者。
 *
 * 为什么在宿主而不是客户端：关联口径（哪些火花算相连、共享几个标签才算一条边）
 * 是领域结论，客户端重算就会出现第二份逻辑 —— 与窗口归因、统计口径同一原则。
 * 客户端只负责把 nodes/edges 画出来。
 *
 * 三类边（全部来自既有数据，不引入新存储）—— 纯火花域：
 *  1. `tag`：两条火花共享标签数 ≥ tagMinShared（默认 2），权重=共享数；
 *  2. `proposal`：涌现提议里被判为关联的火花对（`proposal.sparkIds`），
 *     权重=同现的提议条数 —— 这是「引擎认为它们相关」的证据，与标签相似度正交；
 *  3. `derived`：火花 → 它的父火花（`spark.derivedFrom`，v2 P12/F2），权重=1。
 *
 * 裁剪策略：只取最近活跃的 `limit` 条火花（archived 排在最后），避免图被历史
 * 库存淹没；`truncated` 告知前端「图不是全量」。墓碑（deletedAt）不参与。
 */
import type {
  ProposalView,
  SparkGraph,
  SparkGraphEdge,
  SparkGraphNode,
  SparkView,
} from 'dsh-spark-wire'

const SPARK_PREFIX = 'spark:'

/** 状态排序权重：越"活"越靠前（裁剪时优先保留）。 */
const STATE_RANK: Record<SparkView['status'], number> = {
  active: 0,
  archived: 1,
}

export interface BuildSparkGraphOptions {
  /** 最多纳入多少条火花。 */
  limit?: number
  /** 共享标签达到几条才算一条 tag 边。 */
  tagMinShared?: number
  now?: number
}

export function sparkNodeId(id: string): string {
  return SPARK_PREFIX + id
}

/**
 * 选入图的那批火花：先按「状态活跃度 → 更新时间」排序再截断。
 * 判据必须确定（同输入同输出），否则图会随渲染抖动。
 */
export function selectGraphSparks(
  sparks: readonly SparkView[],
  limit: number,
): { picked: SparkView[]; truncated: boolean } {
  const alive = sparks.filter((spark) => spark.deletedAt === null)
  const ordered = [...alive].sort((a, b) => {
    const rank = STATE_RANK[a.status] - STATE_RANK[b.status]
    if (rank !== 0) return rank
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    return a.id.localeCompare(b.id)
  })
  return { picked: ordered.slice(0, limit), truncated: ordered.length > limit }
}

export function buildSparkGraph(
  sparks: readonly SparkView[],
  proposals: readonly ProposalView[],
  options: BuildSparkGraphOptions = {},
): SparkGraph {
  const limit = options.limit ?? 60
  const tagMinShared = options.tagMinShared ?? 2
  const now = options.now ?? Date.now()

  const { picked, truncated } = selectGraphSparks(sparks, limit)
  const included = new Set(picked.map((spark) => spark.id))

  const nodes: SparkGraphNode[] = picked.map((spark) => ({
    id: sparkNodeId(spark.id),
    kind: 'spark' as const,
    label: spark.title,
    status: spark.status,
    scope: spark.scope,
    tags: [...spark.tags],
    degree: 0,
  }))

  const edges: SparkGraphEdge[] = []
  const seen = new Set<string>()
  const pushEdge = (source: string, target: string, kind: SparkGraphEdge['kind'], weight: number): void => {
    // 无向图的去重键：同一对节点同一语义只保留一条（权重累加在调用方完成）。
    const pair = source < target ? source + '\u0000' + target : target + '\u0000' + source
    const key = kind + '\u0000' + pair
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ source, target, kind, weight })
  }

  // 1) 标签亲和：共享 ≥ tagMinShared 个标签的火花两两相连。
  const tagIndex = new Map<string, string[]>()
  for (const spark of picked) {
    for (const tag of new Set(spark.tags)) {
      const bucket = tagIndex.get(tag)
      if (bucket === undefined) tagIndex.set(tag, [spark.id])
      else bucket.push(spark.id)
    }
  }
  const sharedCount = new Map<string, number>()
  for (const bucket of tagIndex.values()) {
    if (bucket.length < 2) continue
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i]!
        const b = bucket[j]!
        const key = a < b ? a + '\u0000' + b : b + '\u0000' + a
        sharedCount.set(key, (sharedCount.get(key) ?? 0) + 1)
      }
    }
  }
  for (const [key, count] of sharedCount) {
    if (count < tagMinShared) continue
    const [a, b] = key.split('\u0000') as [string, string]
    pushEdge(sparkNodeId(a), sparkNodeId(b), 'tag', count)
  }

  // 2) 衍生谱系：火花 → 父火花（只在父也在图内时连，避免悬空边）。
  const pickedIds = new Set(picked.map((spark) => spark.id))
  for (const spark of picked) {
    for (const parentId of spark.derivedFrom ?? []) {
      if (!pickedIds.has(parentId)) continue
      pushEdge(sparkNodeId(spark.id), sparkNodeId(parentId), 'derived', 1)
    }
  }

  // 3) 涌现提议：引擎判定的关联（只取两边都在图里的提议）。
  const proposalPairs = new Map<string, { a: string; b: string; count: number }>()
  for (const proposal of proposals) {
    const ids = proposal.sparkIds.filter((id) => included.has(id))
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i]!
        const b = ids[j]!
        const key = a < b ? a + '\u0000' + b : b + '\u0000' + a
        const found = proposalPairs.get(key)
        if (found === undefined) proposalPairs.set(key, { a, b, count: 1 })
        else found.count += 1
      }
    }
  }
  for (const { a, b, count } of proposalPairs.values()) {
    pushEdge(sparkNodeId(a), sparkNodeId(b), 'proposal', count)
  }

  // 4) 度：客户端据此定尺寸（不在 UI 里重算）。
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  for (const node of nodes) node.degree = degree.get(node.id) ?? 0

  return { generatedAt: now, nodes, edges, truncated }
}
