/**
 * JSONL backend for the dsh-spark cognitive-layer plugin.
 *
 * 存储形状：首行是可选的版本头 `{"__sparkStore":N}`，其后每行一条完整 SparkView。
 *
 * 2026-09-14（设计 §7.1）三处修正 —— 此前实测丢过 2 条火花：
 *
 *  1. **版本头 + 幂等迁移**：老文件（无头）读出来按 `migrateSparkRecord` 就地升级，
 *     再由 `ensureVersion()` 重写一次，之后重复启动不再重写。
 *  2. **乐观并发**：全量重写前比对「上次读到的文件指纹（size+mtimeMs）」与当前指纹；
 *     不一致说明**另一个进程**在我们读之后写过文件，此时旧快照落盘会覆盖别人的数据
 *     （这正是当初 4 条变 2 条的成因）。冲突时抛 `SparkStoreConflictError`：
 *     `update`/`patch` 会**重新读取后重试一次**，其余路径 fail-loud 而不是静默丢数据。
 *  3. **墓碑删除**：`remove` 改为软删除（写 `deletedAt`），`purge` 才物理删除。
 *     删除因此可审计、可恢复；物理清除交给压实（`purgeTombstones`）。
 *
 * 仍未实现的：跨进程写锁（Phase 1 假设单进程权威）。乐观并发只能**发现**冲突，
 * 不能阻止两个进程同时写；同一 DSH_HOME 跑两个 dsh 实例时请勿同时写火花。
 */
import { promises as fs } from 'node:fs'
import type { SparkPatch, SparkView } from 'dsh-spark-wire'
import type { SparkRecordId, SparkStorage } from './types.ts'
import { describeStorageError, ensureJsonlPath } from './jsonl-path.ts'

/** 当前存储格式版本。老文件（无版本头）视为 1。 */
export const SPARK_STORE_VERSION = 4

const VERSION_KEY = '__sparkStore'

/** 全量重写前的乐观并发检查失败：文件被其它进程改过，写下去会覆盖别人的数据。 */
export class SparkStoreConflictError extends Error {
  readonly code = 'SPARK_STORE_CONFLICT'
  constructor(filePath: string) {
    super('sparks store changed on disk since it was read (another dsh process is writing it?): ' + filePath)
  }
}

interface Fingerprint {
  size: number
  mtimeMs: number
}

function sameFingerprint(a: Fingerprint | null, b: Fingerprint | null): boolean {
  if (a === null || b === null) return a === b
  return a.size === b.size && a.mtimeMs === b.mtimeMs
}

/**
 * 把一条 ≤v3 记录迁移成 v4（v2 §4.2 P11 + §4.3 P12）。
 *
 * v1（status/resolvedAt）与 v2（inboxState 四值 + crystallized）都收敛到
 * `status: 'active' | 'archived'` + 墓碑。幂等（已是 v3 的记录原样返回）。
 *
 * 迁移映射（设计 §4.2）：
 *   pending / v1 active      -> status='active'
 *   archived                 -> status='archived'
 *   dropped                  -> deletedAt=<迁移时刻>（墓碑，可恢复）
 *   crystallized / v1 active+crystallized -> status='archived'
 *   删除字段：inboxState / status(v1) / crystallized / resolvedAt
 *
 * @returns 迁移后的记录；不是合法记录时返回 null。
 */
export function migrateSparkRecord(raw: unknown, now: number = Date.now()): SparkView | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = { ...(raw as Record<string, unknown>) }
  if (typeof record.id !== 'string' || record.id.length === 0) return null

  // 推导旧状态：优先 v2 的 inboxState，退化到 v1 的 status+crystallized。
  let legacyState: string
  if (typeof record.inboxState === 'string') {
    legacyState = record.inboxState
  } else if (record.status === 'archived') {
    legacyState = 'archived'
  } else {
    const crystallized = record.crystallized
    legacyState = crystallized !== null && crystallized !== undefined ? 'crystallized' : 'pending'
  }

  delete record.inboxState
  delete record.status
  delete record.crystallized
  const legacyResolvedAt = record.resolvedAt
  delete record.resolvedAt

  record.status = legacyState === 'archived' || legacyState === 'crystallized' ? 'archived' : 'active'

  // P12 provenance 回填：存量按 sourceAgentId 判 origin（agent 写的记 agent，
  // 否则 human）；derivedFrom/generation 给中性默认。
  if (record.origin === undefined) record.origin = record.sourceAgentId !== null && record.sourceAgentId !== undefined ? 'agent' : 'human'
  if (record.derivedFrom === undefined) record.derivedFrom = []
  if (record.generation === undefined) record.generation = 0
  if (legacyState === 'dropped') {
    // dropped 与墓碑是同一意图的两级摩擦（设计原则 8）：并入墓碑，保留可恢复性。
    if (record.deletedAt === null || record.deletedAt === undefined) record.deletedAt = now
  }

  if (record.stateChangedAt === undefined || record.stateChangedAt === null) {
    if (typeof legacyResolvedAt === 'number') record.stateChangedAt = legacyResolvedAt
    else if (typeof record.updatedAt === 'number') record.stateChangedAt = record.updatedAt
    else record.stateChangedAt = null
  }

  if (record.deletedAt === undefined) record.deletedAt = null

  return record as unknown as SparkView
}

interface ParsedFile {
  version: number
  records: SparkView[]
}

function parseFile(text: string): ParsedFile {
  let version = 1
  const records: SparkView[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue // malformed line: skip rather than fail the whole store
    }
    if (parsed === null || typeof parsed !== 'object') continue
    const header = (parsed as Record<string, unknown>)[VERSION_KEY]
    if (typeof header === 'number') {
      version = header
      continue
    }
    const record = migrateSparkRecord(parsed)
    if (record !== null) records.push(record)
  }
  return { version, records }
}

function serializeFile(records: readonly SparkView[]): string {
  const head = JSON.stringify({ [VERSION_KEY]: SPARK_STORE_VERSION }) + '\n'
  if (records.length === 0) return head
  return head + records.map(r => JSON.stringify(r)).join('\n') + '\n'
}

export class JsonlSparkStorage implements SparkStorage {
  private readonly filePath: string
  private chain: Promise<void> = Promise.resolve()
  /** 上次读取观察到的文件指纹；`null` = 文件当时不存在。 */
  private observed: Fingerprint | null = null
  /** 上次读取观察到的格式版本；`null` = 还没读过。 */
  private observedVersion: number | null = null

  constructor(filePath: string) {
    this.filePath = filePath
  }

  private async serialize<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.chain
    let release: () => void = () => {}
    this.chain = new Promise<void>(resolve => { release = resolve })
    await previous.catch(() => {})
    try {
      return await work()
    } finally {
      release()
    }
  }

  private async fingerprint(): Promise<Fingerprint | null> {
    try {
      const stat = await fs.stat(this.filePath)
      return { size: stat.size, mtimeMs: stat.mtimeMs }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw describeStorageError(error, this.filePath)
    }
  }

  /** 读 + 记指纹（先 stat 后读，避免把"读之后别人又写过"的指纹当成自己的基线）。 */
  private async readWithFingerprint(): Promise<ParsedFile> {
    await ensureJsonlPath(this.filePath)
    let handle
    try {
      handle = await fs.open(this.filePath, 'r')
      const stat = await handle.stat()
      const text = await handle.readFile({ encoding: 'utf8' })
      this.observed = { size: stat.size, mtimeMs: stat.mtimeMs }
      const parsed = parseFile(text)
      this.observedVersion = parsed.version
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.observed = null
        this.observedVersion = null
        return { version: SPARK_STORE_VERSION, records: [] }
      }
      throw describeStorageError(error, this.filePath)
    } finally {
      await handle?.close()
    }
  }

  async append(record: SparkView): Promise<void> {
    await this.serialize(async () => {
      // 追加前先确保文件已带版本头：老文件直接 append 会让新记录混进 v1 文件。
      await this.ensureVersionLocked()
      await ensureJsonlPath(this.filePath)
      const handle = await fs.open(this.filePath, 'a')
      try {
        await handle.write(JSON.stringify(record) + '\n')
        await handle.sync()
      } finally {
        await handle.close()
      }
      this.observed = await this.fingerprint()
    })
  }

  async readAll(): Promise<SparkView[]> {
    try {
      return (await this.readWithFingerprint()).records
    } catch (error) {
      throw describeStorageError(error, this.filePath)
    }
  }

  /**
   * 幂等迁移：读到 v1（无版本头）就按新形状重写一次。
   * @returns 迁移后的版本号。
   */
  async ensureVersion(): Promise<number> {
    return this.serialize(() => this.ensureVersionLocked())
  }

  private async ensureVersionLocked(): Promise<number> {
    const parsed = await this.readWithFingerprint()
    if (parsed.version >= SPARK_STORE_VERSION) return parsed.version
    await this.writeAllRaw(parsed.records)
    return SPARK_STORE_VERSION
  }

  /** 原子读-改-写。冲突（别的进程写过）时重新读取并重试一次。 */
  async update(id: SparkRecordId, mutate: (current: SparkView) => SparkView): Promise<SparkView | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.serialize(async () => {
          const all = await this.readAll()
          const index = all.findIndex(r => r.id === id)
          if (index < 0) return null
          const next = mutate(all[index]!)
          all[index] = next
          await this.writeAllRaw(all)
          return next
        })
      } catch (error) {
        if (error instanceof SparkStoreConflictError && attempt === 0) continue
        throw error
      }
    }
    return null
  }

  async patch(id: SparkRecordId, patch: SparkPatch, now: number): Promise<SparkView | null> {
    return this.update(id, current => applyPatch(current, patch, now))
  }

  async writeAll(records: SparkView[]): Promise<void> {
    await this.serialize(async () => {
      await this.writeAllRaw(records)
    })
  }

  private async writeAllRaw(records: readonly SparkView[]): Promise<void> {
    await ensureJsonlPath(this.filePath)
    const current = await this.fingerprint()
    if (!sameFingerprint(current, this.observed)) throw new SparkStoreConflictError(this.filePath)
    const tmp = this.filePath + '.tmp'
    const text = serializeFile(records)
    const handle = await fs.open(tmp, 'w')
    try {
      await handle.write(text)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tmp, this.filePath)
    this.observed = await this.fingerprint()
    this.observedVersion = SPARK_STORE_VERSION
  }

  /** 软删除（墓碑）：记录保留在文件里，默认不出现在列表中，可由 restore 复原。 */
  async remove(id: SparkRecordId, now: number = Date.now()): Promise<boolean> {
    // `marked` 由闭包记录「这次调用真的改动了什么吗」；`update` 可能在冲突后重跑闭包，
    // 所以这里用赋值而不是累加。
    let marked = false
    const updated = await this.update(id, current => {
      marked = current.deletedAt === null
      return marked ? { ...current, deletedAt: now, updatedAt: now } : current
    })
    return updated !== null && marked
  }

  /** 物理删除（压实专用，不可恢复）。 */
  async purge(id: SparkRecordId): Promise<boolean> {
    return this.serialize(async () => {
      const all = await this.readAll()
      const next = all.filter(r => r.id !== id)
      if (next.length === all.length) return false
      await this.writeAllRaw(next)
      return true
    })
  }

  /** 物理清除过期墓碑。@returns 清除条数。 */
  async purgeTombstones(olderThanMs: number, now: number = Date.now()): Promise<number> {
    return this.serialize(async () => {
      const all = await this.readAll()
      const stale = all.filter(r => r.deletedAt !== null && now - r.deletedAt >= olderThanMs)
      if (stale.length === 0) return 0
      const drop = new Set(stale.map(r => r.id))
      await this.writeAllRaw(all.filter(r => !drop.has(r.id)))
      return stale.length
    })
  }

  /** 当前文件里的格式版本（未读过时为 null）。 */
  get version(): number | null {
    return this.observedVersion
  }
}

function applyPatch(current: SparkView, patch: SparkPatch, now: number): SparkView {
  const nextState = patch.status
  const stateChanged = nextState !== undefined && nextState !== current.status
  return {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
    ...(nextState !== undefined ? { status: nextState } : {}),
    ...(stateChanged ? { stateChangedAt: now } : {}),
    updatedAt: now,
  }
}
