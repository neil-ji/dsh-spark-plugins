/**
 * JSONL backend for emergence proposals (Phase 4).
 *
 * Separate file from sparks.jsonl so proposals don't dilute the spark stream
 * and the user can inspect/grep them independently.
 */
import { promises as fs } from 'node:fs'
import { proposalViewSchema } from 'dsh-spark-wire'
import type { ProposalView, ProposalStatus } from 'dsh-spark-wire'
import type { SparkRecordId } from './types.ts'
import { describeStorageError, ensureJsonlPath } from './jsonl-path.ts'

/**
 * 读侧迁移（2026-09-23，v2 §2.3 F9）：契约把 `explanation: string` 换成了
 * `facts`（判别联合），所以**旧记录（只有 explanation、没有 facts）在这里被丢弃**。
 *
 * 为什么丢而不是回退：中文句子无法反推回结构化病据，而契约里装不下旧形状 ——
 * 留着它就得让 UI 分支渲染一句宿主拼的、没有 locale 键的中文，那正是本次要修的病。
 * 代价可接受：proposal 文件是**工作队列**（待裁决面），不是审计日志；pending 记录由
 * `generateProposals` 纯函数确定性重生，dismissed 记录本就不在面板上显示。
 * 2026-09-23 真机库只有 3 条这种记录（均 dismissed），已另行备份。
 */
function parseLines(text: string): ProposalView[] {
  const records: ProposalView[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(line)
      // 落库形状由契约唯一校验（旧 explanation 记录在这里被判不合法而丢弃，见上方说明）。
      const validated = proposalViewSchema.safeParse(parsed)
      if (validated.success) records.push(validated.data)
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

  async writeAll(records: ProposalView[]): Promise<void> {
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
      await ensureJsonlPath(this.filePath)
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
