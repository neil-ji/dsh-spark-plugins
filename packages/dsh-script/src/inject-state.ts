/**
 * 目录注入状态（Spec §5.3）：按会话记住"上次发布的目录指纹"与"已建议过的脚本"。
 *
 * 为什么不是内存：宿主重启 / 会话恢复后不能重复发布同一份目录（Spec INV-5）。
 * 为什么不是平台 `ctx.skills` 那套"读会话事件日志重建"：我们的注入 source 是通用
 * `plugin` kind（自造 kind 会被会话格式迁移白名单拒绝，见 Spec §5.2），无法可靠区分
 * 哪条才是自己的目录帧；自有 sidecar 更简单且方向安全（分叉会话多发一次完整目录）。
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

/** 目录条目（指纹只认这两个字段，与平台同构）。 */
export interface CatalogEntry {
  readonly name: string
  readonly description: string
}

export interface SessionInjectState {
  /** 上次发布的目录指纹（sha256）。 */
  digest: string
  publishedAt: number
  agentId: string | null
  /** 本会话已经建议过的脚本 id（避免反复推荐同一条）。 */
  suggested: string[]
}

export type InjectState = Record<string, SessionInjectState>

/** 目录指纹：对 `(name, description)` 有序列表做 sha256。 */
export function catalogDigest(entries: readonly CatalogEntry[]): string {
  const canonical = entries.map(entry => JSON.stringify([entry.name, entry.description])).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

/** 解析 sidecar（坏文件按空状态处理：宁可多发一次目录，也不要因此让每步都抛错）。 */
export function parseInjectState(text: string): InjectState {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: InjectState = {}
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object') continue
      const entry = value as Record<string, unknown>
      if (typeof entry['digest'] !== 'string' || typeof entry['publishedAt'] !== 'number') continue
      out[sessionId] = {
        digest: entry['digest'],
        publishedAt: entry['publishedAt'],
        agentId: typeof entry['agentId'] === 'string' ? entry['agentId'] : null,
        suggested: Array.isArray(entry['suggested']) ? entry['suggested'].filter((id): id is string => typeof id === 'string') : [],
      }
    }
    return out
  } catch {
    return {}
  }
}

/** 只保留最近 `keep` 个会话（按 publishedAt 倒序）。 */
export function pruneInjectState(state: InjectState, keep = 200): InjectState {
  const entries = Object.entries(state)
  if (entries.length <= keep) return state
  entries.sort((a, b) => b[1].publishedAt - a[1].publishedAt)
  return Object.fromEntries(entries.slice(0, keep))
}

/** sidecar 路径：与脚本存储同目录。 */
export function defaultInjectStatePath(scriptsFilePath: string): string {
  return join(dirname(scriptsFilePath), 'inject-state.json')
}

/** 极小的 sidecar 读写（原子替换，串行化由调用点保证）。 */
export class InjectStateStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async read(): Promise<InjectState> {
    const text = await fs.readFile(this.filePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    return text === undefined ? {} : parseInjectState(text)
  }

  async write(state: InjectState): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const tmp = this.filePath + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(state, null, 0) + '\n', 'utf8')
    await fs.rename(tmp, this.filePath)
  }
}
