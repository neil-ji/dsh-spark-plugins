/**
 * `ctx.sessionPersistence` access across two DSH API generations.
 *
 * DSH 0.1.5 replaced the flat read surface with per-session handles:
 *
 * | 0.1.2 (flat)                          | 0.1.5 (handle-based)                          |
 * | ------------------------------------- | --------------------------------------------- |
 * | `listSnapshots(signal)`               | `list({ signal })`                            |
 * | `inspect(id, signal)` → `{meta, …}`   | `open(id,'read')` → `handle.read(0)`          |
 *
 * The plugin's peer range (`^0.1.2-rc.1`) admits both, so a build pinned to
 * today's types must still run on tomorrow's host: a hard call to
 * `listSnapshots`/`inspect` throws `... is not a function` on 0.1.5, which is
 * exactly the finance-overview crash. Both shapes are therefore probed at
 * runtime, and the flat API keeps working for older hosts and for the existing
 * unit tests.
 *
 * @module dsh-spark-finance/session-source
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'

/** The two fields of a persistence snapshot the ledger actually consumes. */
export interface PersistenceSnapshotLike {
  header: SessionHeader
  /** Opaque change token; unused by the ledger, kept for shape fidelity. */
  revision?: unknown
}

/**
 * The projection-cache identity cut a **listed** snapshot proves on its own.
 *
 * The cache identity is `(formatVersion, createdAt, cwd, isSeeded,
 * inheritedEventCount)`. An unseeded Session has an exact inherited cut of `0`
 * — the platform's `identityOf` refuses any other value for it — so the whole
 * identity follows from the listed header with no log read. A seeded fork
 * carries a cut only its storage handle knows, so the caller must read.
 *
 * This lets a caller consult the cache **before** opening a session. Reading a
 * multi-megabyte log only to discover that the checkpoint already covers the
 * rotation is the 2026-09-23 real-host CPU incident: 24 sessions / 1.2G
 * re-decoded per ledger build, `parseJson` at 24.9% of a core, the event loop
 * stalled and the Web UI froze.
 *
 * @param snapshot - one `listSnapshots()` / `list()` entry.
 * @returns the exact cut, or `undefined` when only a read can supply it.
 */
export function listedSnapshotInheritedCut(snapshot: PersistenceSnapshotLike): SessionLogOffset | undefined {
  // `0` is the very number the platform validates; the brand is compile-time
  // only, so this stays type-only — no new runtime import, no pin change.
  return snapshot.header.isSeeded === true ? undefined : (0 as SessionLogOffset)
}

/** Storage metadata + complete log, the fold input the projection cache wants. */
export interface PersistenceInspectionLike {
  meta: SessionHeader
  inheritedEventCount: SessionLogOffset
  events: readonly SessionEvent[]
}

/** A handle-shaped read surface (DSH ≥ 0.1.5 `SessionPersistence.open`). */
interface SessionHandleLike {
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogOffset
  read(offset?: number, length?: number, options?: { signal?: AbortSignal }): Promise<{ events: readonly SessionEvent[] }>
  close(): Promise<void>
}

/**
 * The union of both persistence generations, structurally typed so the module
 * compiles against the oldest supported peer types while still calling the
 * newer methods at runtime.
 */
interface SessionPersistenceLike {
  listSnapshots?(signal?: AbortSignal): Promise<readonly PersistenceSnapshotLike[]>
  list?(options?: { signal?: AbortSignal }): Promise<readonly PersistenceSnapshotLike[]>
  inspect?(id: string, signal?: AbortSignal): Promise<PersistenceInspectionLike>
  open?(id: string, access: 'read' | 'write', options?: { signal?: AbortSignal }): Promise<SessionHandleLike>
}

function persistenceOf(ctx: Context): SessionPersistenceLike {
  const service = (ctx as unknown as { sessionPersistence?: SessionPersistenceLike }).sessionPersistence
  if (service === undefined || service === null) {
    throw new Error('finance: ctx.sessionPersistence is unavailable; the session-persistence plugin must be mounted')
  }
  return service
}

/**
 * List every stored session's lightweight snapshot.
 *
 * @param ctx - host context carrying `ctx.sessionPersistence`.
 * @param signal - optional cancellation.
 * @throws when neither API generation is present (a peer-version mismatch).
 */
export async function listPersistenceSnapshots(
  ctx: Context,
  signal?: AbortSignal,
): Promise<readonly PersistenceSnapshotLike[]> {
  const service = persistenceOf(ctx)
  if (typeof service.listSnapshots === 'function') return await service.listSnapshots(signal)
  if (typeof service.list === 'function') return await service.list(signal === undefined ? undefined : { signal })
  throw new Error(
    'finance: unsupported ctx.sessionPersistence API — expected listSnapshots() (DSH ≤ 0.1.2) or list() (DSH ≥ 0.1.5)',
  )
}

/**
 * Read one stored session's header, inherited-event cut, and complete log.
 *
 * On a handle-based host the read handle is always closed again, so the
 * ledger's one-inspection-per-session walk never leaks ownership.
 *
 * @param ctx - host context carrying `ctx.sessionPersistence`.
 * @param id - the stored session to read.
 * @param signal - optional cancellation.
 * @throws when neither API generation is present (a peer-version mismatch).
 */
export async function inspectPersistenceSession(
  ctx: Context,
  id: string,
  signal?: AbortSignal,
): Promise<PersistenceInspectionLike> {
  const service = persistenceOf(ctx)
  if (typeof service.inspect === 'function') return await service.inspect(id, signal)
  if (typeof service.open === 'function') {
    const handle = await service.open(id, 'read', signal === undefined ? undefined : { signal })
    try {
      const read = await handle.read(0, undefined, signal === undefined ? undefined : { signal })
      return {
        meta: handle.header,
        inheritedEventCount: handle.inheritedEventCount,
        events: read.events,
      }
    } finally {
      await handle.close()
    }
  }
  throw new Error(
    'finance: unsupported ctx.sessionPersistence API — expected inspect() (DSH ≤ 0.1.2) or open() (DSH ≥ 0.1.5)',
  )
}
