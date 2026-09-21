/**
 * JSONL backend for procedural scripts (Phase 5).
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ScriptView } from 'dsh-script-wire'
import { describeStorageError, ensureJsonlPath } from './jsonl-path.ts'

/**
 * 逐行解析 + **可选的读路径归一化**。
 *
 * `normalize` 不是装饰：JSONL 读出来的是**历史字节**，新增字段（如 `invokedWorkspaces`）
 * 在老记录里根本不存在，而 schema 默认值只在 `parse` 时才补。少了这一步，加一个带默认值的
 * 字段就会让审计/读模型在真宿主上抛 `Cannot read properties of undefined`——
 * 2026-09-22 实测（旧 seed 写的 3 条记录没有 `invokedWorkspaces`，`/scripts/audit` 直接 400）。
 *
 * 坏行与归一化失败的行都跳过（一条烂数据不该让整个库读不出来），与原先的容错口径一致。
 * @param text - JSONL 全文。
 * @param normalize - 每行的契约校验/默认值补齐；缺省只做 JSON 解析 + `id` 粗判。
 */
function parseLines<T>(text: string, normalize?: (raw: unknown) => T): T[] {
  const records: T[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (parsed === null || typeof parsed !== 'object' || !('id' in parsed)) continue
      records.push(normalize === undefined ? parsed as T : normalize(parsed))
    } catch {
      // ignore malformed line
    }
  }
  return records
}

export class JsonlScriptStorage<T = ScriptView> {
  private readonly filePath: string
  /** 读路径归一化（补 schema 默认值 / 校验）；缺省不加工。 */
  private readonly normalize: ((raw: unknown) => T) | undefined
  private chain: Promise<void> = Promise.resolve()

  constructor(filePath: string, normalize?: (raw: unknown) => T) {
    this.filePath = filePath
    this.normalize = normalize
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

  async readAll(): Promise<T[]> {
    let text: string
    try {
      // Guard first: heals the empty directory the old mkdir-the-file-path bug
      // left behind, and refuses a non-empty one with an actionable message.
      await ensureJsonlPath(this.filePath)
      text = await fs.readFile(this.filePath, 'utf8')
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') return []
      throw describeStorageError(error, this.filePath)
    }
    return parseLines(text, this.normalize)
  }

  async append(record: T): Promise<void> {
    await this.serialize(async () => {
      await ensureJsonlPath(this.filePath)
      const handle = await fs.open(this.filePath, 'a')
      try {
        await handle.write(JSON.stringify(record) + '\n')
        await handle.sync()
      } finally {
        await handle.close()
      }
    })
  }

  async writeAll(records: T[]): Promise<void> {
    await this.serialize(async () => {
      await ensureJsonlPath(this.filePath)
      const tmp = this.filePath + '.tmp'
      const text = records.map(r => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '')
      const handle = await fs.open(tmp, 'w')
      try {
        await handle.write(text)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(tmp, this.filePath)
    })
  }

  async get(id: string): Promise<T | null> {
    const all = await this.readAll()
    return all.find(record => (record as { id?: string }).id === id) ?? null
  }

  async patch(id: string, patch: Partial<T>, now: number): Promise<T | null> {
    return this.serialize(async () => {
      const all = await this.readAll()
      const idx = all.findIndex(record => (record as { id?: string }).id === id)
      if (idx < 0) return null
      const current = all[idx]!
      const next = { ...current, ...patch, updatedAt: now, id: (current as unknown as { id: string }).id, createdAt: (current as unknown as { createdAt: number }).createdAt } as T
      all[idx] = next
      await this.writeAllRaw(all)
      return next
    })
  }

  private async writeAllRaw(records: T[]): Promise<void> {
    await ensureJsonlPath(this.filePath)
    const tmp = this.filePath + '.tmp'
    const text = records.map(r => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '')
    const handle = await fs.open(tmp, 'w')
    try {
      await handle.write(text)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tmp, this.filePath)
  }

  async remove(id: string): Promise<boolean> {
    return this.serialize(async () => {
      const all = await this.readAll()
      const next = all.filter(record => (record as { id?: string }).id !== id)
      if (next.length === all.length) return false
      await this.writeAllRaw(next)
      return true
    })
  }
}

/**
 * Default storage path: `$DSH_HOME/storages/script/scripts.jsonl`.
 *
 * 2026-09-21 从 `storages/sparks/scripts.jsonl` 迁出（脚本不再是火花的一部分，
 * 见 `docs/SCRIPT-LIBRARY-SPEC.md`）。**静态 import，不要改成懒 require**：
 * 产物是 ESM，esbuild 会把裸 `require` 降级成 `__require`，运行时抛
 * `Dynamic require of "node:os" is not supported`（2026-09-21 血案，闸门 `esmrequire` 守着）。
 */
export function defaultScriptsFilePath(): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'script', 'scripts.jsonl')
}

/** 迁出前的旧路径（只读一次，迁移后改名为 `.migrated`）。 */
export function legacyScriptsFilePath(): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'sparks', 'scripts.jsonl')
}

/**
 * 记录升级（旧 → 新，Spec §4.3）：`session` 作用域收敛为 `workspace`，
 * 其余缺失字段由 schema 默认值补齐，`sourceSparkId` 就地丢弃。
 * @param raw - 旧文件里的一行解析结果。
 * @param parse - 新 schema 的解析函数（注入以便单测，避免本模块依赖 wire）。
 */
export function upgradeLegacyRecord<T>(raw: Record<string, unknown>, parse: (value: unknown) => T): T {
  const next: Record<string, unknown> = { ...raw }
  if (next['scope'] === 'session') next['scope'] = 'workspace'
  delete next['sourceSparkId']
  if (typeof next['updatedBy'] !== 'string') next['updatedBy'] = 'system'
  return parse(next)
}

/**
 * 一次性迁移：新存储不存在或为空，且旧文件有记录时，把旧记录升级写入新路径，
 * 并把旧文件改名为 `<旧路径>.migrated`（不删除）。幂等：新文件非空即跳过。
 * @param deps - 路径与解析函数（可注入，便于单测）。
 * @returns 迁移条数与结果说明；未迁移时为 undefined。
 */
export async function migrateLegacyScriptStore<T>(
  deps: {
    readonly newPath: string
    readonly legacyPath: string
    readonly parse: (value: unknown) => T
  },
): Promise<{ migrated: number } | undefined> {
  const current = new JsonlScriptStorage<T>(deps.newPath)
  const existing = await current.readAll().catch(() => [] as T[])
  if (existing.length > 0) return undefined
  const legacyRaw = await fs.readFile(deps.legacyPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return undefined
    throw error
  })
  if (legacyRaw === undefined) return undefined
  const upgraded: T[] = []
  for (const raw of parseLines<Record<string, unknown>>(legacyRaw)) {
    try {
      upgraded.push(upgradeLegacyRecord(raw, deps.parse))
    } catch {
      // 单条坏记录不该让整次迁移失败（旧文件保留为 .migrated，可人工取证）。
    }
  }
  if (upgraded.length === 0) return undefined
  await current.writeAll(upgraded)
  await fs.rename(deps.legacyPath, deps.legacyPath + '.migrated').catch(() => {})
  return { migrated: upgraded.length }
}
