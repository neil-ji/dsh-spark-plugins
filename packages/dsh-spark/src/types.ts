/**
 * dsh-spark host-side types.
 *
 * Wire-facing schemas live in dsh-spark-wire so the client bundle can use
 * them too. This module adds internal types the host needs (storage
 * interface, change-event payload, hippo-bridge helper) that never cross
 * the wire.
 */
import type { SparkScope, SparkStatus, SparkView, SparkCapture, SparkPatch, SparkId, SparkCrystallize, SparkCrystallized } from 'dsh-spark-wire'

export type { SparkScope, SparkStatus, SparkView, SparkCapture, SparkPatch, SparkId, SparkCrystallized, SparkCrystallize }

/** Strongly-typed id branded at construction time. */
export type SparkRecordId = SparkId

/** Internal change-event payload emitted by SparkService after every mutation. */
export interface SparkChangedEvent {
  operation: 'capture' | 'patch' | 'archive' | 'delete' | 'crystallize'
  id: SparkRecordId
  record: SparkView | null
  at: number
}

/** Storage backend interface. */
export interface SparkStorage {
  append(record: SparkView): Promise<void>
  readAll(): Promise<SparkView[]>
  /** Apply a user-facing patch (title/content/tags/scope/status). */
  patch(id: SparkRecordId, patch: SparkPatch, now: number): Promise<SparkView | null>
  /** Replace the entire store. System use only (crystallize, enforceLimit). */
  writeAll(records: SparkView[]): Promise<void>
  remove(id: SparkRecordId): Promise<boolean>
}

/** Derive a short title from content when the caller did not supply one. */
export function deriveTitle(content: string, max: number = 60): string {
  const trimmed = content.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return '(empty)'
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + '…'
}

/**
 * Pure mapper: build a HippoMemo-style put input from a spark + crystallize opts.
 * The shape is intentionally minimal (no hard import of dsh-hippomemo) so the
 * spark plugin stays a peer of hippomemo, not a transitive dependency.
 */
export interface HippoPutInput {
  kind: SparkCrystallized['kind']
  title: string
  content: string
  tags: string[]
  scope: 'global' | 'workspace' | 'project'
  workspacePath: string | null
  globalProven: boolean
  importance: number
  sourceSessionId: string
  sourceAgentId: string | null
}

export function buildHippoInputFromSpark(spark: SparkView, opts: SparkCrystallize): HippoPutInput {
  // Hippo has no session scope; fold both 'session' (caller choice) and
  // 'session'-bound sparks into 'project'.
  const scope: 'global' | 'workspace' | 'project' =
    opts.scope !== undefined
      ? (opts.scope === 'session' ? 'project' : opts.scope)
      : spark.scope === 'global' ? 'global' : 'project'
  return {
    kind: opts.kind,
    title: spark.title,
    content: spark.content,
    tags: spark.tags,
    scope,
    workspacePath: spark.workspacePath,
    globalProven: opts.globalProven,
    importance: opts.importance,
    sourceSessionId: spark.sourceSessionId,
    sourceAgentId: spark.sourceAgentId,
  }
}
