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
 * 读模型（`ScriptSummary` / `ScriptAudit`）**自带宿主算好的业务口径**（`successRate`、
 * `acceptance.ratio`、`rateBuckets`）：跨边界只传结论，消费者不重算（Spec INV-7 / D10，
 * 闸门 `ratemetric` 守着）。
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
  /**
   * 调用证据：调用过这条脚本的工作区（去重，上限 32）。
   * 只由 agent 的 `script_invoke` 记录（人面不计量，Spec D9）；降级作用域建议的唯一病据。
   */
  invokedWorkspaces: z.array(z.string().min(1).max(512)).max(32).default([]),
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

/**
 * 列表/目录用的紧凑视图（不带全文 steps，省 token）。
 *
 * `successRate` 是**宿主算好下发的结论**（Spec INV-7 / D10）：把口径做进读模型，
 * 消费者（人面 pane / 目录注入 / 工具）就没有重算的机会，闸门 `ratemetric` 守着这条。
 */
export const scriptSummarySchema = scriptViewSchema.omit({ steps: true, searchTerms: true }).extend({
  stepCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
})

export const scriptInvokeResultSchema = z.object({
  script: scriptViewSchema,
  /** 本次调用后（已计量）的成功率，0..1。 */
  successRate: z.number().min(0).max(1),
})

/* ────────────────────────────── 治理（治理引擎 / 审计面） ────────────────────────────── */

/** 治理建议种类（Spec §6.2）：退役候选 / 僵尸 / 降级作用域 / 去重合并。 */
export const SCRIPT_ADVICE_KINDS = ['retire', 'zombie', 'downgrade-scope', 'merge-duplicate'] as const
export const scriptAdviceKindSchema = z.enum(SCRIPT_ADVICE_KINDS)

/** 建议动作：人面据此渲染按钮，点击后走对应 HTTP 端点（宿主绝不自动执行，INV-14）。 */
export const SCRIPT_ADVICE_ACTIONS = ['archive', 'set-scope-workspace', 'merge'] as const
export const scriptAdviceActionSchema = z.enum(SCRIPT_ADVICE_ACTIONS)

/**
 * 一条待裁决建议（只读结论，不写库）。
 *
 * **不下发句子**：宿主只给病据数字，文案由 pane 走 locale 字典渲染 —— 否则中文句子会
 * 泄漏到 `en` 面（AGENTS §3.4：文案归模块所有，宿主不写死用户可见文本）。
 */
export const scriptAdviceSchema = z.object({
  /** 稳定 id：`<kind>:<scriptId>`（合并带 `-><targetId>`），供 UI 做 key 与去重。 */
  id: z.string().min(1).max(200),
  kind: scriptAdviceKindSchema,
  action: scriptAdviceActionSchema,
  scriptId: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  /** 合并建议的留存者（其余动作恒 null）。 */
  targetId: z.string().max(64).nullable().default(null),
  /** 触发这条建议的病据（纯数字，UI 自己组织措辞）。 */
  evidence: z.object({
    invocationCount: z.number().int().nonnegative(),
    /** 未调用过为 null（与 `ScriptSummary.successRate` 的 0 不同：这里是"没有证据"）。 */
    successRate: z.number().min(0).max(1).nullable(),
    idleDays: z.number().nonnegative().nullable(),
    workspaces: z.number().int().nonnegative(),
  }),
})

/** 成功率分档（边界见 Spec §6.5：low < 0.5 ≤ mid < 0.9 ≤ high；untested 单列）。 */
export const scriptRateBucketsSchema = z.object({
  untested: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  mid: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
})

export const scriptStatusCountsSchema = z.object({
  active: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  superseded: z.number().int().nonnegative(),
  candidate: z.number().int().nonnegative(),
})

export const scriptScopeCountsSchema = z.object({
  global: z.number().int().nonnegative(),
  workspace: z.number().int().nonnegative(),
  project: z.number().int().nonnegative(),
})

/** 审计统计（全部由宿主算好，UI 不重算）。 */
export const scriptAuditStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  byStatus: scriptStatusCountsSchema,
  byScope: scriptScopeCountsSchema,
  rateBuckets: scriptRateBucketsSchema,
  /** 有验收步骤（末步为以「验收：」开头的 instruction）的脚本占比，0..1。 */
  acceptance: z.object({
    withAcceptanceStep: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    ratio: z.number().min(0).max(1),
  }),
  /** 僵尸脚本数（口径同 `zombie` 建议，Spec §6.2）。 */
  zombies: z.number().int().nonnegative(),
})

/** 审计负载：`POST /scripts/sweep`（含结算）与 `GET /scripts/audit`（只读）同形。 */
export const scriptAuditSchema = z.object({
  settledAt: z.number().int().nonnegative(),
  /** 本次结算自动归档的条数（唯一自动动作；重复结算恒为 0，INV-13）。 */
  archived: z.number().int().nonnegative(),
  stats: scriptAuditStatsSchema,
  advices: z.array(scriptAdviceSchema),
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
export type ScriptAdviceKind = z.infer<typeof scriptAdviceKindSchema>
export type ScriptAdviceAction = z.infer<typeof scriptAdviceActionSchema>
export type ScriptAdvice = z.infer<typeof scriptAdviceSchema>
export type ScriptRateBuckets = z.infer<typeof scriptRateBucketsSchema>
export type ScriptAuditStats = z.infer<typeof scriptAuditStatsSchema>
export type ScriptAudit = z.infer<typeof scriptAuditSchema>
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
    { name: 'ScriptAdvice', schema: scriptAdviceSchema },
    { name: 'ScriptAuditStats', schema: scriptAuditStatsSchema },
    { name: 'ScriptAudit', schema: scriptAuditSchema },
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
