/**
 * Shared wire contract for the dsh-spark cognitive-layer plugin.
 *
 * This package is dependency-free of Node-only modules (only zod + Typert
 * types) so BOTH the host bundle and the browser client bundle can import
 * it. The host uses the schemas to validate captures and persists records;
 * the client uses the same schemas to typecheck fetched payloads.
 *
 * Phase 1 surface: just the data-shape schemas. Phase 2+ will add Typert
 * descriptors for in-session synchronous operations.
 */
import { z } from 'zod'

export const sparkScopeSchema = z.enum(['session', 'project', 'global'])
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
  resolvedAt: z.number().int().nonnegative().nullable(),
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

export type SparkScope = z.infer<typeof sparkScopeSchema>
export type SparkStatus = z.infer<typeof sparkStatusSchema>
export type SparkId = z.infer<typeof sparkIdSchema>
export type SparkView = z.infer<typeof sparkViewSchema>
export type SparkCapture = z.infer<typeof sparkCaptureSchema>
export type SparkListQuery = z.infer<typeof sparkListQuerySchema>
export type SparkPatch = z.infer<typeof sparkPatchSchema>

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
