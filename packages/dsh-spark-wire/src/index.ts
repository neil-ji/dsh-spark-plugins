/**
 * Shared wire contract for the dsh-spark cognitive-layer plugin.
 *
 * 2026-09 事件层收敛（ADR-001/002）：**事件契约与 view 契约一样只在这里声明一次**。
 * 宿主侧 cordis 事件（`sparks/changed` 等）经 `spark.events()` 这条 typert stream
 * 方法下发，每个产出项按 `sparkStreamFrameSchema` 校验；客户端订阅的类型来自
 * 下面的 `TypertRemoteNamespaceMap` 增强 —— host 的 emit 与 client 的订阅引用
 * 同一份声明，不可能漂移（此前 host 的事件 union 在 `dsh-spark/src/types.ts` 里
 * 明写 "never cross the wire"，却正是 SSE 的载荷格式，客户端只能手抄一遍）。
 */
import { z } from 'zod'
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'

export const sparkScopeSchema = z.enum(['session', 'project', 'global'])
/**
 * 火花状态（v2 设计：docs/spark-v2-design-2026-09-21.md §4.2，P11）。
 *
 * 回退为两个值 + 墓碑：`crystallized` 的唯一进入路径（spark_crystallize）已随 P10
 * 删除，`dropped` 与墓碑 `deletedAt` 是同一意图的两级摩擦。显式枚举、不留推导规则
 * （v1 P1 教训）：改状态只动这一处。
 */
export const sparkStatusSchema = z.enum(['active', 'archived'])
export const sparkIdSchema = z.string().min(1).max(64)

export const sparkViewSchema = z.object({
  id: sparkIdSchema,
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000),
  scope: sparkScopeSchema,
  workspacePath: z.string().nullable(),
  status: sparkStatusSchema,
  tags: z.array(z.string().min(1).max(50)).max(32),
  sourceSessionId: z.string(),
  sourceAgentId: z.string().nullable(),
  sourceTurn: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** 状态最后一次变更的时间。 */
  stateChangedAt: z.number().int().nonnegative().nullable().default(null),
  /** 墓碑：软删除时间。非 null 的记录默认不出现在列表里，可由 restore 复原。 */
  deletedAt: z.number().int().nonnegative().nullable().default(null),
})

export const sparkCaptureSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000),
  scope: sparkScopeSchema.default('project'),
  tags: z.array(z.string().min(1).max(50)).max(32).default([]),
  workspacePath: z.string().nullable().default(null),
  sourceSessionId: z.string().min(1),
  sourceAgentId: z.string().nullable().default(null),
  sourceTurn: z.number().int().nonnegative().nullable().default(null),
})

export const sparkListQuerySchema = z.object({
  status: sparkStatusSchema.optional(),
  scope: sparkScopeSchema.optional(),
  /** 默认隐藏墓碑；true 时把软删除的记录也带出来（"最近删除"视图）。 */
  includeDeleted: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
})

export const sparkPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(20_000).optional(),
  tags: z.array(z.string().min(1).max(50)).max(32).optional(),
  scope: sparkScopeSchema.optional(),
  status: sparkStatusSchema.optional(),
})

/**
 * 收件箱统计（设计 §4.2）。三个消费方共用同一份形状：
 *   ① `GET /sparks/stats`；② 会话首步注入的计数；③ dock 模块 header 的未处理数。
 * **不要**让这些路径去 list 全量再过滤——那是 O(n) 且有预算风险。
 */
export const sparkStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  /** 墓碑（软删除）数量，默认不出现在列表里。 */
  deleted: z.number().int().nonnegative(),
  /** 最老的活跃火花的创建时间；无活跃火花时为 null。 */
  oldestActiveAt: z.number().int().nonnegative().nullable(),
  /** 待决提议数（来自 emerge 服务；不可用时为 0）。 */
  pendingProposals: z.number().int().nonnegative(),
})

/**
 * Phase 4: emergence proposals.
 */
export const proposalTypeSchema = z.enum(['link', 'cluster', 'prune'])
export const proposalLeverageSchema = z.enum(['high', 'medium', 'low'])
export const proposalStatusSchema = z.enum(['pending', 'accepted', 'dismissed'])

export const proposalViewSchema = z.object({
  id: z.string().min(1).max(64),
  type: proposalTypeSchema,
  sparkIds: z.array(sparkIdSchema).min(1).max(32),
  explanation: z.string().min(1).max(1_000),
  confidence: z.number().min(0).max(1),
  leverage: proposalLeverageSchema,
  status: proposalStatusSchema,
  createdAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().nullable().default(null),
})

export const reflectRequestSchema = z.object({
  candidateLimit: z.number().int().min(2).max(200).default(30),
  linkThreshold: z.number().min(0).max(1).default(0.5),
  clusterMinSharedTags: z.number().int().min(2).max(10).default(2),
  pruneStaleDays: z.number().int().min(1).max(365).default(14),
})

export const proposalListQuerySchema = z.object({
  status: proposalStatusSchema.optional(),
  type: proposalTypeSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100),
})

/**
 * 关联图谱（Graph 子页）：纯火花域（v2 P10/E5：记忆节点与 crystallized 边已删）。
 *
 * 单一来源：host 侧 `buildSparkGraph` 是唯一计算者，客户端只渲染 —— 关联口径
 * 不允许在 UI 里再算一遍（与窗口归因同一原则）。节点 id 带类型前缀（`spark:<id>`）。
 */
export const sparkGraphNodeKindSchema = z.enum(['spark'])

/** 边的语义：tag=共享标签；proposal=涌现提议判定的关联。 */
export const sparkGraphEdgeKindSchema = z.enum(['tag', 'proposal'])

export const sparkGraphNodeSchema = z.object({
  /** `spark:<sparkId>`。 */
  id: z.string().min(1).max(120),
  kind: sparkGraphNodeKindSchema,
  label: z.string().min(1).max(200),
  /** spark 节点专属。 */
  status: sparkStatusSchema.nullable().default(null),
  scope: sparkScopeSchema.nullable().default(null),
  tags: z.array(z.string().min(1).max(50)).max(32).default([]),
  /** 节点度（连边数）—— 客户端据此定节点尺寸，不再自算。 */
  degree: z.number().int().nonnegative().default(0),
})

export const sparkGraphEdgeSchema = z.object({
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  kind: sparkGraphEdgeKindSchema,
  /** 强度：tag=共享标签数；proposal=同现提议条数。 */
  weight: z.number().int().positive().default(1),
})

export const sparkGraphSchema = z.object({
  generatedAt: z.number().int().nonnegative(),
  nodes: z.array(sparkGraphNodeSchema).max(500),
  edges: z.array(sparkGraphEdgeSchema).max(2_000),
  /** 节点数触及上限被裁剪（图只呈现最近活跃的那批火花）。 */
  truncated: z.boolean().default(false),
})

export const sparkGraphQuerySchema = z.object({
  limit: z.number().int().min(5).max(200).default(60),
  /** 共享标签达到几条才算一条 tag 边。 */
  tagMinShared: z.number().int().min(1).max(10).default(2),
})

export type SparkGraphNodeKind = z.infer<typeof sparkGraphNodeKindSchema>
export type SparkGraphEdgeKind = z.infer<typeof sparkGraphEdgeKindSchema>
export type SparkGraphNode = z.infer<typeof sparkGraphNodeSchema>
export type SparkGraphEdge = z.infer<typeof sparkGraphEdgeSchema>
export type SparkGraph = z.infer<typeof sparkGraphSchema>
export type SparkGraphQuery = z.infer<typeof sparkGraphQuerySchema>

export type SparkScope = z.infer<typeof sparkScopeSchema>
export type SparkStatus = z.infer<typeof sparkStatusSchema>
export type SparkId = z.infer<typeof sparkIdSchema>
export type SparkView = z.infer<typeof sparkViewSchema>
export type SparkCapture = z.infer<typeof sparkCaptureSchema>
export type SparkListQuery = z.infer<typeof sparkListQuerySchema>
export type SparkPatch = z.infer<typeof sparkPatchSchema>
export type SparkStats = z.infer<typeof sparkStatsSchema>
export type ProposalType = z.infer<typeof proposalTypeSchema>
export type ProposalLeverage = z.infer<typeof proposalLeverageSchema>
export type ProposalStatus = z.infer<typeof proposalStatusSchema>
export type ProposalView = z.infer<typeof proposalViewSchema>
export type ReflectRequest = z.infer<typeof reflectRequestSchema>
export type ProposalListQuery = z.infer<typeof proposalListQuerySchema>
export interface SparkResult<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string }
}

export function okResult<T>(value: T): SparkResult<T> {
  return { ok: true, value }
}

export function errResult(code: string, message: string): SparkResult<never> {
  return { ok: false, error: { code, message } }
}

/* ────────────────────────── 事件契约（唯一声明处） ────────────────────────── */

/** `sparks/changed` 的载荷：宿主每次火花变更后 emit。 */
export const sparkChangedEventSchema = z.object({
  operation: z.enum(['capture', 'patch', 'state', 'delete', 'restore', 'purge']),
  id: sparkIdSchema,
  record: sparkViewSchema.nullable(),
  at: z.number().int().nonnegative(),
})

/** `proposals/changed` 的载荷。 */
export const proposalsChangedEventSchema = z.object({
  at: z.number().int().nonnegative(),
  newProposals: z.array(proposalViewSchema),
  resolvedProposal: proposalViewSchema.nullable(),
})

/**
 * 一帧流数据（`spark.events()` 的产出项）。
 *
 * `ready` 是每个物理世代的**基线帧**：客户端收到它意味着「从现在起的事件不会丢」，
 * 因此必须在此刻重新拉取一次状态（世代之间的空白窗口不回放）——这与平台
 * `RemoteStreamItem.accept()` 的基线语义一致（参考第一方 `workspaceFiles/changes`）。
 */
export const sparkReadyFrameSchema = z.object({
  kind: z.literal('ready'),
  at: z.number().int().nonnegative(),
})

export const sparkStreamFrameSchema = z.discriminatedUnion('kind', [
  sparkReadyFrameSchema,
  z.object({ kind: z.literal('spark'), payload: sparkChangedEventSchema }),
  z.object({ kind: z.literal('proposal'), payload: proposalsChangedEventSchema }),
])

export type SparkChangedEvent = z.infer<typeof sparkChangedEventSchema>
export type ProposalsChangedEvent = z.infer<typeof proposalsChangedEventSchema>
export type SparkStreamFrame = z.infer<typeof sparkStreamFrameSchema>
/** 变更帧的 kind（= 事件主题），供订阅侧按主题路由。 */
export type SparkTopic = Exclude<SparkStreamFrame['kind'], 'ready'>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    /** 一条流下发全部 spark 领域事件（readiness 基线 + 变更帧），signal 由传输注入。 */
    'spark/events': (signal?: AbortSignal) => AsyncIterable<SparkStreamFrame>
  }
  interface TypertRemoteNamespaceMap {
    spark: {
      events: (signal?: AbortSignal) => AsyncIterable<SparkStreamFrame>
    }
  }
}

/** 事件流方法描述符：`mode: 'stream'` + 取消参数 + 逐项 codec（每个产出项都校验）。 */
export const SPARK_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-spark#spark/events',
    service: 'sparkEvents',
    namespace: 'spark',
    method: 'events',
    mode: 'stream',
    invocation: { kind: 'direct' },
    parameters: [],
    // signal 不进 wire 参数，由传输层在业务参数之后注入（见 typert InvocationDescriptor.cancellation）。
    cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: 'dsh-spark#SparkStreamFrame', schema: sparkStreamFrameSchema },
  },
]

/** 宿主侧贡献：`ctx.typert.register(SPARK_HOST_CONTRIBUTION)`。 */
export const SPARK_HOST_CONTRIBUTION: TypertContribution = {
  package: 'dsh-spark',
  face: 'host',
  schemas: [
    { name: 'SparkView', schema: sparkViewSchema },
    { name: 'SparkStats', schema: sparkStatsSchema },
    { name: 'ProposalView', schema: proposalViewSchema },
    { name: 'SparkChangedEvent', schema: sparkChangedEventSchema },
    { name: 'ProposalsChangedEvent', schema: proposalsChangedEventSchema },
    { name: 'SparkStreamFrame', schema: sparkStreamFrameSchema },
  ],
  model: { services: [], events: [], objects: [] },
  invocations: [...SPARK_INVOCATIONS],
}

/** 客户端侧贡献：`ctx.remote.$mount(SPARK_REMOTE_CONTRIBUTION)`。 */
export const SPARK_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-spark',
  descriptors: [...SPARK_INVOCATIONS],
}
