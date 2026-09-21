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
 * 收件箱状态（2026-09-14 设计：docs/spark-inbox-design-2026-09-14.md §4.1）。
 *
 * 取代旧的 `status: 'active' | 'archived'` —— 旧的"待处理"只能靠
 * `status === 'active' && crystallized === null` 推导，同一个隐式规则要在
 * 面板、统计、注入三处各复写一遍。显式状态是单一真源。
 */
export const sparkInboxStateSchema = z.enum(['pending', 'crystallized', 'dropped', 'archived'])
export const sparkIdSchema = z.string().min(1).max(64)

export const sparkCrystallizedSchema = z.object({
  hippoId: z.string().min(1),
  kind: z.enum(['insight', 'decision', 'fact', 'preference', 'constraint']),
  at: z.number().int().nonnegative(),
})

export const sparkViewSchema = z.object({
  id: sparkIdSchema,
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000),
  scope: sparkScopeSchema,
  workspacePath: z.string().nullable(),
  inboxState: sparkInboxStateSchema,
  tags: z.array(z.string().min(1).max(50)).max(32),
  sourceSessionId: z.string(),
  sourceAgentId: z.string().nullable(),
  sourceTurn: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** 状态最后一次变更的时间（取代旧字段 resolvedAt —— 旧字段只在归档时打点，是个特例）。 */
  stateChangedAt: z.number().int().nonnegative().nullable().default(null),
  /** 墓碑：软删除时间。非 null 的记录默认不出现在列表里，可由 restore 复原。 */
  deletedAt: z.number().int().nonnegative().nullable().default(null),
  crystallized: sparkCrystallizedSchema.nullable().default(null),
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
  inboxState: sparkInboxStateSchema.optional(),
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
  inboxState: sparkInboxStateSchema.optional(),
})

export const sparkCrystallizeSchema = z.object({
  kind: z.enum(['insight', 'decision', 'fact', 'preference', 'constraint']).default('insight'),
  importance: z.number().min(0).max(1).default(0.5),
  scope: sparkScopeSchema.optional(),
  globalProven: z.boolean().default(false),
})

/**
 * 收件箱统计（设计 §4.2）。三个消费方共用同一份形状：
 *   ① `GET /sparks/stats`；② 会话首步注入的计数；③ dock 模块 header 的未处理数。
 * **不要**让这些路径去 list 全量再过滤——那是 O(n) 且有预算风险。
 */
export const sparkStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  crystallized: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  /** 墓碑（软删除）数量，默认不出现在列表里。 */
  deleted: z.number().int().nonnegative(),
  /** 最老的待处理火花的创建时间；无待处理时为 null。 */
  oldestPendingAt: z.number().int().nonnegative().nullable(),
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
 * Phase 5: procedural scripts (the striatum / cerebellum of the cognitive layer).
 *
 * A script is a named, ordered sequence of steps (instructions or tool calls).
 * Scripts live across sessions; invoking one returns the steps for the agent
 * to execute (Phase 5 MVP does not execute automatically — the agent does).
 */
/** Step kinds: 'instruction' is an LLM directive, 'tool-call' is a tool name to invoke with the captured payload. */
export const scriptStepKindSchema = z.enum(['instruction', 'tool-call'])

export const scriptStepSchema = z.object({
  kind: scriptStepKindSchema,
  /** For 'instruction': the directive text. For 'tool-call': the tool name. */
  payload: z.string().min(1).max(2_000),
  /** Optional human note shown alongside this step in the catalog. */
  note: z.string().max(500).optional(),
})

export const scriptScopeSchema = z.enum(['session', 'project', 'global'])

export const scriptViewSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2_000),
  steps: z.array(scriptStepSchema).min(1).max(50),
  /** Pattern tags for retrieval matching (Phase 5.5: tool auto-suggest when an agent's recent tool sequence matches). */
  triggers: z.array(z.string().min(1).max(80)).max(16).default([]),
  scope: scriptScopeSchema.default('project'),
  workspacePath: z.string().nullable().default(null),
  /** Feedback counters; successRate = successCount / invocationCount. */
  invocationCount: z.number().int().nonnegative().default(0),
  successCount: z.number().int().nonnegative().default(0),
  failureCount: z.number().int().nonnegative().default(0),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastInvokedAt: z.number().int().nonnegative().nullable().default(null),
  /** Which spark (if any) crystallized into this script. */
  sourceSparkId: sparkIdSchema.nullable().default(null),
})

export const scriptCaptureSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2_000),
  steps: z.array(scriptStepSchema).min(1).max(50),
  triggers: z.array(z.string().min(1).max(80)).max(16).default([]),
  scope: scriptScopeSchema.default('project'),
  workspacePath: z.string().nullable().default(null),
  sourceSparkId: sparkIdSchema.nullable().default(null),
})

export const scriptListQuerySchema = z.object({
  scope: scriptScopeSchema.optional(),
  q: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
})

export const scriptInvokeResultSchema = z.object({
  script: scriptViewSchema,
  /** Convenience field: successRate after this invocation, 0..1. */
  successRate: z.number().min(0).max(1),
})

/**
 * 关联图谱（Graph 子页）：火花之间、火花与结晶记忆之间的边。
 *
 * 单一来源：host 侧 `buildSparkGraph` 是唯一计算者，客户端只渲染 —— 关联口径
 * 不允许在 UI 里再算一遍（与窗口归因同一原则）。节点 id 带类型前缀
 * （`spark:<id>` / `memory:<hippoId>`），两类节点同图共存。
 */
export const sparkGraphNodeKindSchema = z.enum(['spark', 'memory'])

/** 边的语义：crystallized=结晶谱系；tag=共享标签；proposal=涌现提议判定的关联。 */
export const sparkGraphEdgeKindSchema = z.enum(['crystallized', 'tag', 'proposal'])

export const sparkGraphNodeSchema = z.object({
  /** `spark:<sparkId>` 或 `memory:<hippoId>`。 */
  id: z.string().min(1).max(120),
  kind: sparkGraphNodeKindSchema,
  label: z.string().min(1).max(200),
  /** spark 节点专属；memory 节点为 null。 */
  inboxState: sparkInboxStateSchema.nullable().default(null),
  scope: sparkScopeSchema.nullable().default(null),
  tags: z.array(z.string().min(1).max(50)).max(32).default([]),
  /** 节点度（连边数）—— 客户端据此定节点尺寸，不再自算。 */
  degree: z.number().int().nonnegative().default(0),
})

export const sparkGraphEdgeSchema = z.object({
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  kind: sparkGraphEdgeKindSchema,
  /** 强度：tag=共享标签数；proposal=同现提议条数；crystallized=1。 */
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
export type SparkInboxState = z.infer<typeof sparkInboxStateSchema>
export type SparkId = z.infer<typeof sparkIdSchema>
export type SparkView = z.infer<typeof sparkViewSchema>
export type SparkCapture = z.infer<typeof sparkCaptureSchema>
export type SparkListQuery = z.infer<typeof sparkListQuerySchema>
export type SparkPatch = z.infer<typeof sparkPatchSchema>
export type SparkCrystallized = z.infer<typeof sparkCrystallizedSchema>
export type SparkStats = z.infer<typeof sparkStatsSchema>
export type SparkCrystallize = z.infer<typeof sparkCrystallizeSchema>
export type ProposalType = z.infer<typeof proposalTypeSchema>
export type ProposalLeverage = z.infer<typeof proposalLeverageSchema>
export type ProposalStatus = z.infer<typeof proposalStatusSchema>
export type ProposalView = z.infer<typeof proposalViewSchema>
export type ReflectRequest = z.infer<typeof reflectRequestSchema>
export type ProposalListQuery = z.infer<typeof proposalListQuerySchema>
export type ScriptStepKind = z.infer<typeof scriptStepKindSchema>
export type ScriptStep = z.infer<typeof scriptStepSchema>
export type ScriptScope = z.infer<typeof scriptScopeSchema>
export type ScriptView = z.infer<typeof scriptViewSchema>
export type ScriptCapture = z.infer<typeof scriptCaptureSchema>
export type ScriptListQuery = z.infer<typeof scriptListQuerySchema>
export type ScriptInvokeResult = z.infer<typeof scriptInvokeResultSchema>

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
  operation: z.enum(['capture', 'patch', 'state', 'crystallize', 'delete', 'restore', 'purge']),
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

/** `scripts/changed` 的载荷。 */
export const scriptsChangedEventSchema = z.object({
  at: z.number().int().nonnegative(),
  operation: z.enum(['create', 'invoke', 'delete', 'result']),
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
  z.object({ kind: z.literal('script'), payload: scriptsChangedEventSchema }),
])

export type SparkChangedEvent = z.infer<typeof sparkChangedEventSchema>
export type ProposalsChangedEvent = z.infer<typeof proposalsChangedEventSchema>
export type ScriptsChangedEvent = z.infer<typeof scriptsChangedEventSchema>
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
    { name: 'ScriptsChangedEvent', schema: scriptsChangedEventSchema },
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
