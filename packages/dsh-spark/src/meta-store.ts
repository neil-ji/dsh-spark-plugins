/**
 * 火花认知层的小型元数据 sidecar（设计 §5.3）。
 *
 * 为什么不塞进 sparks.jsonl：那是**记录**存储（每行一条 SparkView，迁移/压实都围绕它），
 * 而这里是**调度状态**（上次 reflect 时间、命令失败聚合游标）。混在一起会让"迁移一条
 * 记录"和"记一次运行时间"互相影响，也会让 `__sparkStore` 版本头的含义变模糊。
 *
 * 形状：`$DSH_HOME/storages/sparks/meta.json`，写入走 tmp + rename（原子），
 * 文件缺失/损坏一律降级成空元数据（调度状态不值得阻断启动）。
 */
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { describeStorageError } from './jsonl-path.ts'

export interface SparkMeta {
  /** 上次成功跑完涌现（reflect）的时间；null = 从未跑过。 */
  lastReflectAt: number | null
  /** 命令失败挖掘的聚合表（D 档）。键由 `failureKey()` 生成。 */
  commandFailures: Record<string, CommandFailureEntry>
}

/** 一条「模型 × 命令模式 × 错误签名」的复现记录（D 档）。 */
export interface CommandFailureEntry {
  modelKey: string
  cmdPattern: string
  errSig: string
  /** 复现的**不同会话** id（同一会话内重复不计数）。 */
  sessions: string[]
  firstSeenAt: number
  lastSeenAt: number
  /** 已经产出过（产出为一条火花）的时间；null = 还没产出。 */
  promotedAt: number | null
  /** 自愈：之后同一模式成功过，计数清零并标记。 */
  healedAt: number | null
}

export function emptyMeta(): SparkMeta {
  return { lastReflectAt: null, commandFailures: {} }
}

/** 容错解析：形状不对就当空元数据（而不是让插件起不来）。 */
export function parseMeta(raw: unknown): SparkMeta {
  if (raw === null || typeof raw !== 'object') return emptyMeta()
  const value = raw as Partial<SparkMeta>
  const lastReflectAt = typeof value.lastReflectAt === 'number' ? value.lastReflectAt : null
  const failures = value.commandFailures
  const commandFailures: Record<string, CommandFailureEntry> = {}
  if (failures !== null && typeof failures === 'object') {
    for (const [key, entry] of Object.entries(failures)) {
      if (entry === null || typeof entry !== 'object') continue
      const candidate = entry as Partial<CommandFailureEntry>
      if (typeof candidate.modelKey !== 'string' || typeof candidate.cmdPattern !== 'string' || typeof candidate.errSig !== 'string') continue
      commandFailures[key] = {
        modelKey: candidate.modelKey,
        cmdPattern: candidate.cmdPattern,
        errSig: candidate.errSig,
        sessions: Array.isArray(candidate.sessions) ? candidate.sessions.filter((s): s is string => typeof s === 'string') : [],
        firstSeenAt: typeof candidate.firstSeenAt === 'number' ? candidate.firstSeenAt : 0,
        lastSeenAt: typeof candidate.lastSeenAt === 'number' ? candidate.lastSeenAt : 0,
        promotedAt: typeof candidate.promotedAt === 'number' ? candidate.promotedAt : null,
        healedAt: typeof candidate.healedAt === 'number' ? candidate.healedAt : null,
      }
    }
  }
  return { lastReflectAt, commandFailures }
}

export class SparkMetaStore {
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

  async read(): Promise<SparkMeta> {
    try {
      const text = await fs.readFile(this.filePath, 'utf8')
      return parseMeta(JSON.parse(text))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return emptyMeta()
      // 损坏的 JSON 同样降级：调度状态坏了不该让插件起不来。
      if (error instanceof SyntaxError) return emptyMeta()
      throw describeStorageError(error, this.filePath)
    }
  }

  /** 读-改-写（同一临界区内），mutate 返回 null 表示不改。 */
  async update(mutate: (meta: SparkMeta) => SparkMeta | null): Promise<SparkMeta> {
    return this.serialize(async () => {
      const current = await this.read()
      const next = mutate(current)
      if (next === null) return current
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      const tmp = this.filePath + '.tmp'
      const handle = await fs.open(tmp, 'w')
      try {
        await handle.write(JSON.stringify(next, null, 2))
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(tmp, this.filePath)
      return next
    })
  }
}

/** 元数据文件默认位置（与 sparks.jsonl 同目录）。 */
export function defaultMetaPath(sparksFilePath: string): string {
  const dir = dirname(sparksFilePath)
  const sep = sparksFilePath.includes('\\') ? '\\' : '/'
  return dir + sep + 'sparks' + sep + 'meta.json'
}
