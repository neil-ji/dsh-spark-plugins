/**
 * Shared wire contract for the dsh-spark cognitive-layer plugin.
 *
 * This package is dependency-free of Node-only modules (only zod + Typert
 * types) so BOTH the host bundle and the browser client bundle can import
 * it. The host uses the schemas to validate captures and persists records;
 * the client uses the same schemas to typecheck fetched payloads.
 *
 * Phase 2 surface: SparkView.crystallized + sparkCrystallizeSchema (bridges a
 * spark into a HippoMemo MemoryRecord). Future phases add Typert descriptors.
 */
import { z } from 'zod'

/** Spark scope: session-bound, project-bound, or cross-project global. */
export const sparkScopeSchema = z.enum(['session', 'project', 'global'])

/** Spark lifecycle status. */
export const sparkStatusSchema = z.enum(['active', 'archived'])

/** A spark id is a 26-64 char string. */
export const sparkIdSchema = z.string().min(1).max(64)

/**
 * Once a spark has been crystallized into a HippoMemo memory record, this
 * field carries the bridge so the UI can deep-link from spark to memory and
 * the agent can answer "did I already crystallize this?" with a constant-time
 * lookup. Idempotent: re-crystallizing returns the same hippoId.
 */
export const sparkCrystallizedSchema = z.object({
  hippoId: z.string().min(1),
  /** Which HippoMemo kind the spark became (insight / fact / preference / etc). */
  kind: z.enum(['insight', 'decision', 'fact', 'preference', 'constraint']),
  at: z.number().int().nonnegative(),
})

/** Wire view of one spark record. The host emits this on the read path. */
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

/** Capture request payload (HTTP POST /sparks body). */
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

/** List query (HTTP GET /sparks). */
export const sparkListQuerySchema = z.object({
  status: sparkStatusSchema.optional(),
  scope: sparkScopeSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100),
})

/** Update request payload (HTTP PATCH /sparks/:id body). All fields optional. */
export const sparkPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(20_000).optional(),
  tags: z.array(z.string().min(1).max(50)).max(32).optional(),
  scope: sparkScopeSchema.optional(),
  status: sparkStatusSchema.optional(),
})

/**
 * Crystallize request payload (HTTP POST /sparks/:id/crystallize body).
 * The host bridges this into a HippoMemo MemoryPutInput. `kind` defaults to
 * 'insight' if omitted; the agent can override based on the spark's nature.
 */
export const sparkCrystallizeSchema = z.object({
  kind: z.enum(['insight', 'decision', 'fact', 'preference', 'constraint']).default('insight'),
  importance: z.number().min(0).max(1).default(0.5),
  scope: sparkScopeSchema.optional(),
  globalProven: z.boolean().default(false),
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
