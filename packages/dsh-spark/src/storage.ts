/**
 * JSONL backend for the dsh-spark cognitive-layer plugin.
 *
 * Storage shape: each line in the JSONL file is one full SparkView JSON object.
 * Writes are line-buffered and flushed; reads scan the whole file (Phase 1
 * assumption: one human user, low hundreds of records). Patch and remove are
 * atomic read-modify-write under a same-process mutex (Node is single-threaded
 * so the mutex is an in-process serialization guarantee, not a cross-process
 * one; cross-process safety is not a Phase 1 requirement).
 */
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { SparkPatch, SparkView } from 'dsh-spark-wire'
import type { SparkRecordId, SparkStorage } from './types.ts'

function parseLines(text: string): SparkView[] {
  const records: SparkView[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (parsed !== null && typeof parsed === 'object' && 'id' in parsed) {
        records.push(parsed as SparkView)
      }
    } catch {
      // ignore malformed line
    }
  }
  return records
}

export class JsonlSparkStorage implements SparkStorage {
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

  async append(record: SparkView): Promise<void> {
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

  async readAll(): Promise<SparkView[]> {
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

  async patch(id: SparkRecordId, patch: SparkPatch, now: number): Promise<SparkView | null> {
    return this.serialize(async () => {
      const all = await this.readAll()
      const index = all.findIndex(r => r.id === id)
      if (index < 0) return null
      const current = all[index]!
      const merged = applyPatch(current, patch, now)
      all[index] = merged
      await this.writeAllRaw(all)
      return merged
    })
  }

  async writeAll(records: SparkView[]): Promise<void> {
    await this.serialize(async () => {
      await this.writeAllRaw(records)
    })
  }

  private async writeAllRaw(records: SparkView[]): Promise<void> {
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

  async remove(id: SparkRecordId): Promise<boolean> {
    return this.serialize(async () => {
      const all = await this.readAll()
      const next = all.filter(r => r.id !== id)
      if (next.length === all.length) return false
      await this.writeAllRaw(next)
      return true
    })
  }
}

function applyPatch(current: SparkView, patch: SparkPatch, now: number): SparkView {
  const merged: SparkView = {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: now,
  }
  if (patch.status === 'archived' && current.status !== 'archived') {
    merged.resolvedAt = now
  }
  return merged
}
