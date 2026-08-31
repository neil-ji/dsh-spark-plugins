/**
 * JSONL backend for emergence proposals (Phase 4).
 *
 * Separate file from sparks.jsonl so proposals don't dilute the spark stream
 * and the user can inspect/grep them independently.
 */
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ProposalView, ProposalStatus } from 'dsh-spark-wire'
import type { SparkRecordId } from './types.ts'

function parseLines(text: string): ProposalView[] {
  const records: ProposalView[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (parsed !== null && typeof parsed === 'object' && 'id' in parsed) {
        records.push(parsed as ProposalView)
      }
    } catch {
      // ignore malformed line
    }
  }
  return records
}

export class JsonlProposalStorage {
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

  async readAll(): Promise<ProposalView[]> {
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

  async writeAll(records: ProposalView[]): Promise<void> {
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

  /** Patch a proposal by id (only mutable fields: status + resolvedAt). */
  async patch(id: SparkRecordId, status: ProposalStatus, now: number): Promise<ProposalView | null> {
    return this.serialize(async () => {
      const all = await this.readAll()
      const idx = all.findIndex(r => r.id === id)
      if (idx < 0) return null
      const current = all[idx]!
      if (current.status !== 'pending') return current
      const next: ProposalView = { ...current, status, resolvedAt: now }
      all[idx] = next
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      const tmp = this.filePath + '.tmp'
      const text = all.map(r => JSON.stringify(r)).join('\n') + '\n'
      const handle = await fs.open(tmp, 'w')
      try {
        await handle.write(text)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(tmp, this.filePath)
      return next
    })
  }
}
