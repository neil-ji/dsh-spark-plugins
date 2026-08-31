/**
 * Shared wire contract for the dsh-spark cognitive-layer plugin.
 */
import { z } from 'zod'

export const sparkScopeSchema = z.enum(['session', 'project', 'global'])
export const sparkStatusSchema = z.enum(['active', 'archived'])
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
  status: sparkStatusSchema,
  tags: z.array(z.string().min(1).max(50)).max(32),
  sourceSessionId: z.string(),
  sourceAgentId: z.string().nullable(),
  sourceTurn: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().nullable().default(null),
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
  status: sparkStatusSchema.optional(),
  scope: sparkScopeSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100),
})

export const sparkPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(20_000).optional(),
  tags: z.array(z.string().min(1).max(50)).max(32).optional(),
  scope: sparkScopeSchema.optional(),
  status: sparkStatusSchema.optional(),
})

export const sparkCrystallizeSchema = z.object({
  kind: z.enum(['insight', 'decision', 'fact', 'preference', 'constraint']).default('insight'),
  importance: z.number().min(0).max(1).default(0.5),
  scope: sparkScopeSchema.optional(),
  globalProven: z.boolean().default(false),
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

export type SparkScope = z.infer<typeof sparkScopeSchema>
export type SparkStatus = z.infer<typeof sparkStatusSchema>
export type SparkId = z.infer<typeof sparkIdSchema>
export type SparkView = z.infer<typeof sparkViewSchema>
export type SparkCapture = z.infer<typeof sparkCaptureSchema>
export type SparkListQuery = z.infer<typeof sparkListQuerySchema>
export type SparkPatch = z.infer<typeof sparkPatchSchema>
export type SparkCrystallized = z.infer<typeof sparkCrystallizedSchema>
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
