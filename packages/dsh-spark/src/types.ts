/**
 * dsh-spark host-side types.
 *
 * Wire-facing schemas live in dsh-spark-wire so the client bundle can use
 * them too. This module adds internal types the host needs (storage
 * interface, change-event payload) that never cross the wire.
 */
import type { SparkScope, SparkStatus, SparkView, SparkCapture, SparkPatch, SparkId } from 'dsh-spark-wire'

export type { SparkScope, SparkStatus, SparkView, SparkCapture, SparkPatch, SparkId }

/** Strongly-typed id branded at construction time. */
export type SparkRecordId = SparkId

/**
 * Internal change-event payload emitted by SparkService after every mutation.
 * Phase 1: only the host cordis event needs to carry this; Phase 4 will
 * forward it to the SSE stream so the Web UI updates without polling.
 */
export interface SparkChangedEvent {
  operation: 'capture' | 'patch' | 'archive' | 'delete'
  id: SparkRecordId
  record: SparkView | null
  at: number
}

/**
 * Storage backend interface. The Phase 1 implementation is JsonlSparkStorage;
 * later phases can swap in SQLite or another backend without touching the service.
 */
export interface SparkStorage {
  append(record: SparkView): Promise<void>
  readAll(): Promise<SparkView[]>
  /**
   * Apply a patch by id. Returns the new record, or null if not found.
   * Implementations must be atomic (read-modify-write under a lock).
   */
  patch(id: SparkRecordId, patch: SparkPatch, now: number): Promise<SparkView | null>
  /**
   * Remove by id. Returns true if removed, false if not found.
   */
  remove(id: SparkRecordId): Promise<boolean>
}

/** Helper: derive the auto title from content if the caller did not supply one. */
export function deriveTitle(content: string, max: number = 60): string {
  const trimmed = content.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return '(empty)'
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + '…'
}
