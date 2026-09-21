/**
 * JSONL backend for procedural scripts (Phase 5).
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ScriptView } from 'dsh-spark-wire'
import { describeStorageError, ensureJsonlPath } from './jsonl-path.ts'

function parseLines(text: string): ScriptView[] {
  const records: ScriptView[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (parsed !== null && typeof parsed === 'object' && 'id' in parsed) {
        records.push(parsed as ScriptView)
      }
    } catch {
      // ignore malformed line
    }
  }
  return records
}

export class JsonlScriptStorage {
  private readonly filePath: string
  private chain: Promise<void> = Promise.resolve()

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

  async readAll(): Promise<ScriptView[]> {
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
    return parseLines(text)
  }

  async append(record: ScriptView): Promise<void> {
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

  async writeAll(records: ScriptView[]): Promise<void> {
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

  async get(id: string): Promise<ScriptView | null> {
    const all = await this.readAll()
    return all.find(s => s.id === id) ?? null
  }

  async patch(id: string, patch: Partial<ScriptView>, now: number): Promise<ScriptView | null> {
    return this.serialize(async () => {
      const all = await this.readAll()
      const idx = all.findIndex(s => s.id === id)
      if (idx < 0) return null
      const current = all[idx]!
      const next: ScriptView = { ...current, ...patch, updatedAt: now, id: current.id, createdAt: current.createdAt }
      all[idx] = next
      await this.writeAllRaw(all)
      return next
    })
  }

  private async writeAllRaw(records: ScriptView[]): Promise<void> {
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
      const next = all.filter(s => s.id !== id)
      if (next.length === all.length) return false
      await this.writeAllRaw(next)
      return true
    })
  }
}

/**
 * Default storage path: `$DSH_HOME/storages/sparks/scripts.jsonl`.
 *
 * **静态 import，不要改成懒 require（2026-09-21 血案）**：这里曾经是
 * `require('node:os')`「懒加载避免与 spark-service.ts 的循环依赖」，但本包产物是
 * ESM（build.mjs: `format: 'esm'`），esbuild 把裸 `require` 原样降级成 `__require`，
 * 而 ESM 里没有 `require`，运行时抛 `Dynamic require of "node:os" is not supported`。
 * 两个调用方都包在 try/catch 里（ScriptService 落默认路径、SeedDefaultScripts 落
 * best-effort），于是失败**完全静默**：`scripts.jsonl` 从未被创建，脚本目录永远空。
 * 三个 storage（sparks / proposals / scripts）的模块图里本来就没有环，静态 import
 * 是唯一正确写法。
 */
export function defaultScriptsFilePath(): string {
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'sparks', 'scripts.jsonl')
}
