/**
 * dsh-script-wire —— 脚本沉淀库的契约唯一声明处（含域词汇）。
 *
 * 规范源：`docs/SCRIPT-LIBRARY-SPEC.md`（实现与 Spec 冲突时先改 Spec）。
 * 本包只允许 zod + typert 协议类型（禁 cordis / react / 平台 client），
 * 因为 host 与 client 两半都要 import 它。
 *
 * 域词汇（与 HippoMemo 同义，见 Spec §2.2）：
 *   - 作用域 `global | workspace | project`（无 `session`；临时性用 `expiresAt`）
 *   - 生命周期 `active | archived | superseded | candidate`
 *   - 作者 `human | agent | system`
 * 这三组字面量由闸门 `check:domain-vocabulary` 与 HippoMemo 逐字面比对，
 * 任何一侧单独改动都会红。
 *
 * @module dsh-script-wire
 */
import { z } from 'zod'
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'

/* ────────────────────────────── 域词汇 ────────────────────────────── */

/** 作用域（与 HippoMemo 的 `MemoryScope` 逐字相同；禁止新增 `session`）。 */
export const SCRIPT_SCOPES = ['global', 'workspace', 'project'] as const
export const scriptScopeSchema = z.enum(SCRIPT_SCOPES)

/** 生命周期（与 HippoMemo 的 `MemoryStatus` 逐字相同）。 */
export const SCRIPT_STATUSES = ['active', 'archived', 'superseded', 'candidate'] as const
export const scriptStatusSchema = z.enum(SCRIPT_STATUSES)

/** 写入者（与 HippoMemo 的 `MemoryAuthor` 逐字相同）。 */
export const SCRIPT_AUTHORS = ['human', 'agent', 'system'] as const
export const scriptAuthorSchema = z.enum(SCRIPT_AUTHORS)

/* ────────────────────────────── 记录 ────────────────────────────── */

/** 步骤种类：`instruction` 是给模型的话，`tool-call` 是工具名/命令。 */
export const scriptStepKindSchema = z.enum(['instruction', 'tool-call'])

export const scriptStepSchema = z.object({
  kind: scriptStepKindSchema,
  /** For 'instruction': the directive text. For 'tool-call': the tool name or command. */
  payload: z.string().min(1).max(2_000),
  /** Optional human note shown alongside this step in the catalog. */
  note: z.string().max(500).optional(),
})

export const scriptViewSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  /** 也是目录里给模型看的那一行；「何时用得上」必须写在这里（没有 whenToUse 通道）。 */
  description: z.string().min(1).max(2_000),
  steps: z.array(scriptStepSchema).min(1).max(50),
  /** 路由用：与最近工具调用做子串匹配（主动建议）。 */
  triggers: z.array(z.string().min(1).max(80)).max(16).default([]),
  /** 检索用（与记忆同义）。 */
  tags: z.array(z.string().min(1).max(50)).max(32).default([]),
  /** 写入时生成的双语同义词（与记忆同形，索引方式同 tags）。 */
  searchTerms: z.array(z.string().min(1).max(50)).max(32).optional(),
  scope: scriptScopeSchema.default('workspace'),
  /** = 写入时的 session cwd；project 作用域按项目根解析（Spec §2.3）。 */
  workspacePath: z.string().nullable().default(null),
  status: scriptStatusSchema.default('active'),
  /** 内容修订即 +1（取代链见 supersedes/supersededBy）。 */
  revision: z.number().int().positive().default(1),
  supersedes: z.string().max(64).nullable().default(null),
  supersededBy: z.string().max(64).nullable().default(null),
  updatedBy: scriptAuthorSchema.default('system'),
  /** 溯源：谁在哪个会话沉淀的（种子/系统写入为 null）。 */
  sourceSessionId: z.string().max(200).nullable().default(null),
  sourceAgentId: z.string().max(200).nullable().default(null),
  sourceTurn: z.number().int().nonnegative().nullable().default(null),
  /** 计量：successRate = successCount / invocationCount，只由宿主计算。 */
  invocationCount: z.number().int().nonnegative().default(0),
  successCount: z.number().int().nonnegative().default(0),
  failureCount: z.number().int().nonnegative().default(0),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** 临时性表达（替代已退役的 `session` 作用域）；null = 不过期。 */
  expiresAt: z.number().int().nonnegative().nullable().default(null),
  lastInvokedAt: z.number().int().nonnegative().nullable().default(null),
})

/** 写入输入（id / 计量 / 时间戳一律由宿主生成）。 */
export const scriptSaveInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2_000),
  steps: z.array(scriptStepSchema).min(1).max(50),
  triggers: z.array(z.string().min(1).max(80)).max(16).default([]),
  tags: z.array(z.string().min(1).max(50)).max(32).default([]),
  searchTerms: z.array(z.string().min(1).max(50)).max(32).optional(),
  scope: scriptScopeSchema.default('workspace'),
  workspacePath: z.string().nullable().default(null),
  expiresAt: z.number().int().nonnegative().nullable().default(null),
  supersedes: z.string().max(64).nullable().default(null),
  sourceSessionId: z.string().max(200).nullable().default(null),
  sourceAgentId: z.string().max(200).nullable().default(null),
  sourceTurn: z.number().int().nonnegative().nullable().default(null),
})

export const scriptListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  scope: scriptScopeSchema.optional(),
  status: scriptStatusSchema.optional(),
  tag: z.string().max(50).optional(),
  // 缺省 100：list 也被宿主内部用作"全库枚举"，不会传参。
  limit: z.number().int().min(1).max(500).default(100),
})

/** 列表/目录用的紧凑视图（不带全文 steps，省 token）。 */
export const scriptSummarySchema = scriptViewSchema.omit({ steps: true, searchTerms: true }).extend({
  stepCount: z.number().int().nonnegative(),
})

export const scriptInvokeResultSchema = z.object({
  script: scriptViewSchema,
  /** 本次调用后（已计量）的成功率，0..1。 */
  successRate: z.number().min(0).max(1),
})

/* ────────────────────────────── 事件与流 ────────────────────────────── */

/** `scripts/changed` 的载荷（宿主每次变更后 emit）。 */
export const scriptsChangedEventSchema = z.object({
  at: z.number().int().nonnegative(),
  operation: z.enum(['save', 'revision', 'invoke', 'result', 'status', 'delete', 'expire']),
  id: z.string().max(64).nullable(),
})

export const scriptReadyFrameSchema = z.object({
  kind: z.literal('ready'),
  at: z.number().int().nonnegative(),
})

export const scriptStreamFrameSchema = z.discriminatedUnion('kind', [
  scriptReadyFrameSchema,
  z.object({ kind: z.literal('changed'), payload: scriptsChangedEventSchema }),
])

export type ScriptStepKind = z.infer<typeof scriptStepKindSchema>
export type ScriptStep = z.infer<typeof scriptStepSchema>
export type ScriptScope = z.infer<typeof scriptScopeSchema>
export type ScriptStatus = z.infer<typeof scriptStatusSchema>
export type ScriptAuthor = z.infer<typeof scriptAuthorSchema>
export type ScriptView = z.infer<typeof scriptViewSchema>
export type ScriptSaveInput = z.infer<typeof scriptSaveInputSchema>
export type ScriptListQuery = z.infer<typeof scriptListQuerySchema>
export type ScriptSummary = z.infer<typeof scriptSummarySchema>
export type ScriptInvokeResult = z.infer<typeof scriptInvokeResultSchema>
export type ScriptsChangedEvent = z.infer<typeof scriptsChangedEventSchema>
export type ScriptStreamFrame = z.infer<typeof scriptStreamFrameSchema>
/** 变更帧的 kind（= 事件主题），供订阅侧路由。 */
export type ScriptTopic = Exclude<ScriptStreamFrame['kind'], 'ready'>

/* ────────────────────────────── remote 契约 ────────────────────────────── */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    /** 一条流下发脚本域的全部变更（readiness 基线 + 变更帧），signal 由传输注入。 */
    'script/events': (signal?: AbortSignal) => AsyncIterable<ScriptStreamFrame>
  }
  interface TypertRemoteNamespaceMap {
    script: {
      events: (signal?: AbortSignal) => AsyncIterable<ScriptStreamFrame>
    }
  }
}

/** 事件流方法描述符：`mode: 'stream'` + 取消参数 + 逐项 codec（每个产出项都校验）。 */
export const SCRIPT_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-script#script/events',
    service: 'scriptEvents',
    namespace: 'script',
    method: 'events',
    mode: 'stream',
    invocation: { kind: 'direct' },
    parameters: [],
    // signal 不进 wire 参数，由传输层在业务参数之后注入（见 typert InvocationDescriptor.cancellation）。
    cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: 'dsh-script#ScriptStreamFrame', schema: scriptStreamFrameSchema },
  },
]

/** 宿主侧贡献：`ctx.typert.register(SCRIPT_HOST_CONTRIBUTION)`。 */
export const SCRIPT_HOST_CONTRIBUTION: TypertContribution = {
  package: 'dsh-script',
  face: 'host',
  schemas: [
    { name: 'ScriptView', schema: scriptViewSchema },
    { name: 'ScriptSummary', schema: scriptSummarySchema },
    { name: 'ScriptInvokeResult', schema: scriptInvokeResultSchema },
    { name: 'ScriptsChangedEvent', schema: scriptsChangedEventSchema },
    { name: 'ScriptStreamFrame', schema: scriptStreamFrameSchema },
  ],
  model: { services: [], events: [], objects: [] },
  invocations: [...SCRIPT_INVOCATIONS],
}

/** 客户端侧贡献：`ctx.remote.$mount(SCRIPT_REMOTE_CONTRIBUTION)`。 */
export const SCRIPT_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-script',
  descriptors: [...SCRIPT_INVOCATIONS],
}
