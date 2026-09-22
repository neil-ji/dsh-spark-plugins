/**
 * 衍生引擎的**纯逻辑**（v2 §5，P15 + P17）。
 *
 * 生成是熵增：产物必须是一条新记录，不是指向旧记录。本模块只管
 * 「选哪些对 → 拼什么提示词 → 解析出什么」这三件可单测的事；
 * LLM 调用、落库、过期清理在 `derive-service.ts`（有 IO 的那一层）。
 *
 * 反自噬（§5.3）在这里落两条：
 *  - `origin='derived'` 的火花**不作父本**（只允许原创想法作父本）；
 *  - 产出与输入集合（及已有火花）的标题 token Jaccard 必须 < 0.85
 *    —— 否则它是复述，丢弃并记录拒绝原因。
 * `generation ≤ 2` 由 `types.ts` 的 `resolveProvenance` 守（落库路径上）。
 */
import type { SparkView } from 'dsh-spark-wire'
import { jaccard, tokenize } from './relevance.ts'

/** 复述判定阈值（§5.3 第 3 条）：与输入或已有火花的标题重合到这个程度就算复述。 */
export const RESTATEMENT_THRESHOLD = 0.85

export interface DerivationPair {
  a: SparkView
  b: SparkView
  /** 标题 token Jaccard。 */
  similarity: number
  /** 两条火花不共享任何标签（组合的"远距离"信号）。 */
  tagDistant: boolean
}

export interface SelectPairsOptions {
  maxPairs?: number
  minSimilarity?: number
  maxSimilarity?: number
  /** 只从这条火花出发（UI 行内「衍生」）。 */
  seedId?: string
}

/**
 * 选候选对：相似度落在【中段区间】优先 —— 太像=重复（去重里就毙了），
 * 太不像=无关（硬凑出来的组合是噪声）；标签远距离对（不同标签但标题有交集）
 * 等价于落在中段的另一种表达，两者一起排序。
 *
 * 判据必须确定（同输入同输出）：分数 → 较新的 a/b 时间 → id。
 */
export function selectDerivationPairs(
  sparks: readonly SparkView[],
  options: SelectPairsOptions = {},
): DerivationPair[] {
  const maxPairs = options.maxPairs ?? 8
  const minSimilarity = options.minSimilarity ?? 0.15
  const maxSimilarity = options.maxSimilarity ?? 0.7
  // 反自噬：derived 不作父本；墓碑 / 归档不参与（归档是用户主动收起）。
  const pool = sparks.filter(spark => (
    spark.deletedAt === null
    && spark.status === 'active'
    && spark.origin !== 'derived'
    && (options.seedId === undefined || spark.id === options.seedId || true)
  ))
  const pairs: DerivationPair[] = []
  // seed 模式：只保留与 seed 成对的组合。
  const seeds = options.seedId === undefined ? null : pool.filter(spark => spark.id === options.seedId)
  const others = options.seedId === undefined ? pool : pool.filter(spark => spark.id !== options.seedId)
  const firstSide = seeds ?? pool
  const seen = new Set<string>()
  for (const a of firstSide) {
    for (const b of others) {
      if (a.id === b.id) continue
      const key = a.id < b.id ? a.id + '\u0000' + b.id : b.id + '\u0000' + a.id
      if (seen.has(key)) continue
      seen.add(key)
      const similarity = jaccard(tokenize(a.title), tokenize(b.title))
      if (similarity < minSimilarity || similarity > maxSimilarity) continue
      const tagsA = new Set(a.tags)
      const tagDistant = b.tags.every(tag => !tagsA.has(tag))
      pairs.push({ a, b, similarity, tagDistant })
    }
  }
  // 中段甜点：离区间中心越近越靠前；同分则标签远距离优先，再按新近、id 定序。
  const center = (minSimilarity + maxSimilarity) / 2
  const newest = (pair: DerivationPair): number => Math.max(pair.a.updatedAt, pair.b.updatedAt)
  return pairs.sort((x, y) => {
    const dx = Math.abs(x.similarity - center)
    const dy = Math.abs(y.similarity - center)
    if (dx !== dy) return dx - dy
    if (x.tagDistant !== y.tagDistant) return x.tagDistant ? -1 : 1
    if (newest(y) !== newest(x)) return newest(y) - newest(x)
    const keyX = x.a.id + x.b.id
    const keyY = y.a.id + y.b.id
    return keyX.localeCompare(keyY)
  }).slice(0, maxPairs)
}

/** LLM 产出的一条候选（host 内部的输出形状；`reason` 只进日志，不进契约）。 */
export interface DerivedCandidate {
  title: string
  content: string
  tags: string[]
  derivedFrom: string[]
  reason?: string
}

/**
 * 解析并粗校验 LLM 输出（纯函数）。
 *
 * 输出面是**不可信外部数据**：只接受 `{ sparks: [...] }` 形状，逐条校验必填字段与
 * `derivedFrom` 是否落在本轮候选对里（防止模型凭空编造父代 id）。任何解析失败都
 * 返回空数组 —— 生成失败不该让一轮动作抛错。
 */
export function parseDerivedCandidates(raw: string, allowedParentIds: readonly string[]): DerivedCandidate[] {
  const json = extractJsonObject(raw)
  if (json === null) return []
  const allowed = new Set(allowedParentIds)
  const out: DerivedCandidate[] = []
  for (const item of json.sparks) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const title = typeof record['title'] === 'string' ? record['title'].trim() : ''
    const content = typeof record['content'] === 'string' ? record['content'].trim() : ''
    if (title.length === 0 || content.length === 0) continue
    const parents = Array.isArray(record['derivedFrom'])
      ? record['derivedFrom'].filter((id): id is string => typeof id === 'string' && allowed.has(id))
      : []
    if (parents.length === 0) continue
    const tags = Array.isArray(record['tags'])
      ? record['tags'].filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).slice(0, 32)
      : []
    out.push({
      title: title.slice(0, 200),
      content: content.slice(0, 20_000),
      tags,
      derivedFrom: [...new Set(parents)].slice(0, 8),
      ...(typeof record['reason'] === 'string' ? { reason: record['reason'] } : {}),
    })
  }
  return out
}

interface ParsedEnvelope {
  sparks: unknown[]
}

/** 从模型输出里抠出第一个 JSON 对象（容忍 ```json 围栏与前后解释文字）。 */
function extractJsonObject(raw: string): ParsedEnvelope | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const text = fenced === null ? raw : fenced[1]!
  const start = text.indexOf('{')
  if (start < 0) return null
  // 从第一个 { 起做括号配平扫描，避免贪婪正则吃到后面的解释。
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1)) as unknown
          if (parsed === null || typeof parsed !== 'object') return null
          const sparks = (parsed as { sparks?: unknown }).sparks
          return Array.isArray(sparks) ? { sparks } : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

export interface RestatementCheck {
  rejected: boolean
  reason?: string
}

/**
 * 复述判定（§5.3 第 3 条）：与任一父辈或已有火花的标题 token Jaccard ≥ 0.85 即
 * 视为复述（丢弃并记录拒绝原因）。空标题/空内容同样拒绝 —— 它们是模型在敷衍。
 */
export function checkRestatement(
  candidate: DerivedCandidate,
  knownTitles: readonly string[],
): RestatementCheck {
  if (candidate.title.trim().length === 0 || candidate.content.trim().length === 0) {
    return { rejected: true, reason: 'empty' }
  }
  const candidateTokens = tokenize(candidate.title)
  for (const known of knownTitles) {
    if (jaccard(candidateTokens, tokenize(known)) >= RESTATEMENT_THRESHOLD) {
      return { rejected: true, reason: 'restatement' }
    }
  }
  return { rejected: false }
}

export interface PartitionResult {
  accepted: DerivedCandidate[]
  rejected: { title: string; reason: string }[]
}

/**
 * 逐条过复述闸（含**本轮已有产出**也要参与去重：一轮里自己复述自己同样是噪声）。
 * 纯函数，顺序确定 —— 同一批候选同输入同输出。
 */
export function partitionCandidates(
  candidates: readonly DerivedCandidate[],
  knownTitles: readonly string[],
): PartitionResult {
  const accepted: DerivedCandidate[] = []
  const rejected: { title: string; reason: string }[] = []
  const titles = [...knownTitles]
  for (const candidate of candidates) {
    const check = checkRestatement(candidate, titles)
    if (check.rejected) {
      rejected.push({ title: candidate.title, reason: check.reason ?? 'rejected' })
      continue
    }
    accepted.push(candidate)
    titles.push(candidate.title)
  }
  return { accepted, rejected }
}

export interface DerivePrompt {
  system: string
  user: string
}

/**
 * 拼提示词（纯函数，可断言）。要求严格 JSON 输出，`derivedFrom` 必须引用给定 id；
 * `reason` 被明确要求"一句话"——它只进日志，用来事后判断这一轮是不是在自我复述。
 */
export function buildDerivePrompt(
  pairs: readonly DerivationPair[],
  knownTitles: readonly string[],
  maxResults: number,
): DerivePrompt {
  const system = [
    'You recombine existing ideas into NEW ideas. A derived idea must be an idea that is not already in the list:',
    'association, analogy, or recombination across distant sparks. Restating an existing idea is failure, not output.',
    'Reply with JSON only, no prose: {"sparks":[{"title":"...","content":"...","tags":["..."],"derivedFrom":["<spark id>"],"reason":"one sentence"}]}',
    'Rules: derivedFrom must contain ids from the provided pairs; at most ' + String(maxResults) + ' items;',
    'keep titles under 60 characters; write in the same language as the source sparks.',
  ].join(' ')
  const pairLines = pairs.map((pair, index) => (
    String(index + 1) + '. [' + pair.a.id + '] ' + pair.a.title + ' :: ' + pair.a.content.slice(0, 200)
    + '\n   + [' + pair.b.id + '] ' + pair.b.title + ' :: ' + pair.b.content.slice(0, 200)
  ))
  const user = [
    'Existing idea titles (do NOT restate these):',
    knownTitles.map(title => '- ' + title).join('\n'),
    '',
    'Candidate pairs to recombine:',
    pairLines.join('\n'),
    '',
    'Produce at most ' + String(maxResults) + ' new ideas as JSON.',
  ].join('\n')
  return { system, user }
}
