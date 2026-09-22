/**
 * dsh-spark host-side types.
 *
 * Wire-facing schemas live in dsh-spark-wire so the client bundle can use
 * them too. **事件载荷也属于 wire**（ADR-002）：`SparkChangedEvent` 由
 * `dsh-spark-wire` 的 zod schema 定义并在此转出，不再在本模块另立一份
 * 声明 —— 之前的版本在这里写着 "never cross the wire"，而它实际就是
 * SSE 的载荷格式，客户端只能手抄一遍且没有校验。
 */
import type { SparkScope, SparkStatus, SparkView, SparkCapture, SparkPatch, SparkId, SparkStats } from 'dsh-spark-wire'

export type { SparkScope, SparkStatus, SparkView, SparkCapture, SparkPatch, SparkId, SparkStats }
/** 火花变更事件（= `sparks/changed` 载荷，契约在 wire 包）。 */
export type { SparkChangedEvent } from 'dsh-spark-wire'

/** Strongly-typed id branded at construction time. */
export type SparkRecordId = SparkId

/** Storage backend interface. */
export interface SparkStorage {
  append(record: SparkView): Promise<void>
  readAll(): Promise<SparkView[]>
  /** 幂等格式迁移：读到老版本就按新形状重写一次，返回迁移后的版本号。 */
  ensureVersion(): Promise<number>
  /** Apply a user-facing patch (title/content/tags/scope/inboxState). */
  patch(id: SparkRecordId, patch: SparkPatch, now: number): Promise<SparkView | null>
  /**
   * 原子读-改-写。**唯一**允许的原地更新入口 —— 服务层不得自己 readAll + writeAll
   * （那样读改写不在同一临界区，实测丢过数据）。
   */
  update(id: SparkRecordId, mutate: (current: SparkView) => SparkView): Promise<SparkView | null>
  /** Replace the entire store. System use only (迁移). */
  writeAll(records: SparkView[]): Promise<void>
  /** 软删除（墓碑）：写 deletedAt，可由 restore 复原。 */
  remove(id: SparkRecordId, now?: number): Promise<boolean>
  /** 物理删除（压实专用，不可恢复）。 */
  purge(id: SparkRecordId): Promise<boolean>
  /** 物理清除过期墓碑。 */
  purgeTombstones(olderThanMs: number, now?: number): Promise<number>
}

/** Derive a short title from content when the caller did not supply one. */
export function deriveTitle(content: string, max: number = 60): string {
  const trimmed = content.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return '(empty)'
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + '…'
}
