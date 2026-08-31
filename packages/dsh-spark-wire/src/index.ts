/**
 * Shared wire contract for the dsh-spark cognitive-layer plugin.
 * */
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
 * Phase 4: emergence proposals. The DMN engine generates these periodically
 * or on-demand; the user accepts or dismisses them in the Web UI inbox.
 */
/** Proposal types. contradict is reserved for the LLM-backed engine (Phase 4.5+). */
export const proposalTypeSchema = z.enum(['link', 'cluster', 'prune'])

/** Proposal leverage — drives display order and inbox triage. */
export const proposalLeverageSchema = z.enum(['high', 'medium', 'low'])

/** Proposal lifecycle status. */
export const proposalStatusSchema = z.enum(['pending', 'accepted', 'dismissed'])

/** Wire view of one emergence proposal. */
export const proposalViewSchema = z.object({
  id: z.string().min(1).max(64),
  type: proposalTypeSchema,
  /** The spark ids this proposal concerns. 2 for link, 3+ for cluster, 1 for prune. */
  sparkIds: z.array(sparkIdSchema).min(1).max(32),
  /** Human-readable reason this proposal was generated (one short sentence). */
  explanation: z.string().min(1).max(1_000),
  /** Rule-based or LLM confidence in [0, 1]. */
  confidence: z.number().min(0).max(1),
  leverage: proposalLeverageSchema,
  status: proposalStatusSchema,
  createdAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().nullable().default(null),
})

/** Reflect request (HTTP POST /proposals/reflect body) — optional tuning. */
export const reflectRequestSchema = z.object({
  /** Cap on how many candidate sparks to consider. Defaults to 30. */
  candidateLimit: z.number().int().min(2).max(200).default(30),
  /** Min token Jaccard for link proposals. Defaults to 0.5. */
  linkThreshold: z.number().min(0).max(1).default(0.5),
  /** Min shared tags for cluster proposals. Defaults to 2. */
  clusterMinSharedTags: z.number().int().min(2).max(10).default(2),
  /** Days untouched for prune proposals. Defaults to 14. */
  pruneStaleDays: z.number().int().min(1).max(365).default(14),
})

export const proposalListQuerySchema = z.object({
  status: proposalStatusSchema.optional(),
  type: proposalTypeSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100),
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
