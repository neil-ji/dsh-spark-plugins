/**
 * JSONL backend for procedural scripts (Phase 5).
 */
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ScriptView } from 'dsh-spark-wire'

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
      text = await fs.readFile(this.filePath, 'utf8')
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') return []
      throw error
    }
    return parseLines(text)
  }

  async append(record: ScriptView): Promise<void> {
    await this.serialize(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true })
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
      await fs.mkdir(dirname(this.filePath), { recursive: true })
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
    await fs.mkdir(dirname(this.filePath), { recursive: true })
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

/** Default storage path. */
export function defaultScriptsFilePath(): string {
  // Imported lazily to avoid circular deps with spark-service.ts (both modules
  // need each other at runtime).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { homedir } = require('node:os') as typeof import('node:os')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path')
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'sparks', 'scripts.jsonl')
}
