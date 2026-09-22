/**
 * Phase 6 valence heuristics (pure logic, no cordis).
 *
 * The amygdala layer of the cognitive model watches user messages for
 * strong emotional signals (anger, frustration, emphasis) and, when
 * detected, extracts the latent preference encoded in the message
 * (e.g. "you moron, why did you change file X" → preference: do not
 * modify file X without asking). The extracted preference is then
 * captured as a spark (v2 P10/E2 改道：不写 hippomemo，由 Agent / 用户
 * 判断是否值得沉淀为记忆）。
 *
 * Pure heuristics — no LLM — keep the cost at zero per message. The
 * LLM-backed version (semantic preference extraction) is Phase 6.5.
 *
 * 2026-09-23（F6 挖掘管线修复）：本模块同时承载三处**判定**的纯实现——
 * `isRealUserMessage`（谁算真人说话）、`minePreferences`（一道话语值不值得挖）、
 * `isDuplicateOfPool`（是不是已经挖过了）。判定放这里而不是 service 里，理由同
 * `command-mining.ts`：真宿主上只有日志能看见的分支，必须能被单测钉住。
 */
import type { SparkView } from 'dsh-spark-wire'
import { boilerplateTokens, jaccardWithout, substanceTokens } from './relevance.ts'
import { RESTATEMENT_THRESHOLD } from './derive.ts'

/** Score emotional intensity in [0, 1]. Pure heuristics. */
export function detectIntensity(text: string): number {
  if (text.length === 0) return 0
  let score = 0
  // 1) ALL CAPS runs: 2+ consecutive uppercase letters.
  const capsRuns = text.match(/[A-Z]{2,}/g)
  if (capsRuns !== null) score += Math.min(0.4, capsRuns.length * 0.1)
  // 2) Exclamation marks.
  const bangs = (text.match(/[!！]/g) ?? []).length
  score += Math.min(0.3, bangs * 0.1)
  // 3) Question marks (interrogative frustration).
  const qs = (text.match(/[?？]/g) ?? []).length
  score += Math.min(0.15, qs * 0.05)
  // 4) Strong Chinese frustration markers.
  const cns = (text.match(/[你您]怎么|[你您]为什么|[你您]凭什么|[他她它]怎么搞的|搞什么|什么破玩意|搞砸了/g) ?? []).length
  score += Math.min(0.5, cns * 0.25)
  // 5) Strong English frustration markers.
  const ens = (text.match(/\b(why|wtf|damn|shit|idiot|moron|stupid|broken)\b/gi) ?? []).length
  score += Math.min(0.4, ens * 0.2)
  return Math.min(1, score)
}

/**
 * Extract latent preferences from a high-intensity user message.
 * Returns an array of {verb, target, kind} candidates.
 *
 * kind ∈ 'do-not' | 'always' | 'never'
 *   do-not: user is forbidding something (high priority)
  *   always: user is asserting a regular preference
  *   never:  user is forbidding a regular action
 */
export interface PreferenceCandidate {
  kind: 'do-not' | 'always' | 'never'
  /** The action or subject being constrained. Free-form short text. */
  target: string
  /** Verbatim source phrase for traceability. */
  source: string
}

const STOP = new Set([
  'a', 'an', 'and', 'or', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '的', '了', '是', '在', '和', '与',
  '啊', '吗', '呢', '吧', '嘛', '哦', '呀',
])

/** Tokenize for preference extraction: keep words and CJK runs. */
function tokenize(text: string): string[] {
  const out: string[] = []
  let buf = ''
  const flushWord = (): void => {
    const w = buf.toLowerCase().trim()
    buf = ''
    if (w.length > 0 && !STOP.has(w)) out.push(w)
  }
  for (const ch of text) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      buf += ch
    } else {
      flushWord()
      if (/[\u4e00-\u9fa5]/.test(ch)) out.push(ch)
    }
  }
  flushWord()
  return out
}

/**
 * Pick the target subject from the raw captured phrase. The captured
 * phrase from the regex is already a coherent unit (e.g. 'run tests before
 * commit' or '先更新文档') — we just trim, strip trailing stopword-like
 * fragments, and cap at 60 chars to keep memory titles readable.
 */
function pickTarget(raw: string): string {
  let t = raw.trim().replace(/^[\s,，。！？\.!\?;:]+/, '').replace(/[\s,，。！？\.!\?;:]+$/, '')
  // Drop trailing stopwords that often trail an extracted target.
  const stopTail = /\s+(?:now|today|please|马上|现在|请|啊|吧|呢|嘛|哦|呀|谢谢)$/i
  t = t.replace(stopTail, '')
  if (t.length > 60) t = t.slice(0, 60).trim()
  return t
}

export function extractPreferences(text: string): PreferenceCandidate[] {
  const out: PreferenceCandidate[] = []
  const lower = text.toLowerCase()

  // Pattern 1: 'don't / do not / 别 / 不要 + verb-target'
  // End-marker (?:-|[\s\.\!\?，。！？]|$)) is optional so messages without
  // punctuation still match.
  const doNotPatterns: RegExp[] = [
    /\bdo(?:n't| not)\s+([a-z][a-z\s'-]{2,40}?)(?=\s*[\.\!\?,;]|$)/gi,
    /\bdon't\s+([a-z][a-z\s'-]{2,40}?)(?=\s*[\.\!\?,;]|$)/gi,
    /别\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
    /不要\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
    /别碰\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
    /别动\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
  ]
  for (const pattern of doNotPatterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const captured = (m[1] ?? '').trim()
      const target = pickTarget(captured)
      if (target.length > 0) {
        out.push({ kind: 'do-not', target, source: m[0] })
      }
    }
  }

  // Pattern 2: 'always / 总是 / 一直 + verb-target'
  const alwaysPatterns: RegExp[] = [
    /\balways\s+([a-z][a-z\s'-]{2,40}?)(?=\s*[\.\!\?,;]|$)/gi,
    /总是\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
    /一直\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
  ]
  for (const pattern of alwaysPatterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const captured = (m[1] ?? '').trim()
      const target = pickTarget(captured)
      if (target.length > 0) out.push({ kind: 'always', target, source: m[0] })
    }
  }

  // Pattern 3: 'never / 从不 / 从来不 + verb-target'
  const neverPatterns: RegExp[] = [
    /\bnever\s+([a-z][a-z\s'-]{2,40}?)(?=\s*[\.\!\?,;]|$)/gi,
    /从不\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
    /从来不\s*([\u4e00-\u9fa5\w\s]{2,20}?)(?=[\s，。！？\.\!\?;]|$)/g,
  ]
  for (const pattern of neverPatterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const captured = (m[1] ?? '').trim()
      const target = pickTarget(captured)
      if (target.length > 0) out.push({ kind: 'never', target, source: m[0] })
    }
  }

  // Dedup: same (kind, target) → keep first.
  const seen = new Set<string>()
  const deduped: PreferenceCandidate[] = []
  for (const c of out) {
    const key = c.kind + '|' + c.target.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(c)
  }
  return deduped
}

/**
 * Compose a spark-capture input from a candidate (v2 P10/E2 改道：不再直写
 * hippomemo——挖到偏好候选只产出火花；是否沉淀为记忆，由 Agent / 用户判断）。
 * Title is short, content holds the source phrase for traceability.
 */
export interface ValenceSparkInput {
  title: string
  content: string
  tags: string[]
  scope: 'project' | 'global'
  workspacePath: string | null
  sourceSessionId: string
  sourceAgentId: string | null
  sourceTurn: number | null
  origin: 'agent'
}

export function candidateToSparkInput(
  candidate: PreferenceCandidate,
  workspacePath: string | null = null,
): ValenceSparkInput {
  const verbLabel = candidate.kind === 'do-not' ? "Don't" : candidate.kind === 'always' ? 'Always' : 'Never'
  return {
    title: '用户偏好：' + verbLabel + ' ' + candidate.target,
    content: candidate.source,
    tags: ['preference', 'valence-mined', candidate.kind],
    scope: 'project', // 是否跨工作区成立交由后续判断（不再自动升 global）
    workspacePath,
    sourceSessionId: 'valence-mining',
    sourceAgentId: null,
    sourceTurn: null,
    // **显式声明**，不靠 `sparkOriginSchema.default('human')` 兜底（2026-09-23 修）：
    // origin 回答的是「谁判断的」。正则从会话里抠出来的句子不是人写的，但也不
    // 该冒充人类原创——默认值曾让 40/40 条机器产物在库里长得和人手写的一模一样，
    // 除 `sourceSessionId` 这个魔法字符串外无从区分（D3）。
    origin: 'agent',
  }
}

/**
 * Decay: blend intensity over time. Older high-intensity signals fade.
 * Returns importance in [0, 1]. Phase 6 MVP uses simple time-decay;
 * Phase 6.5 can replace with explicit "preference decay" config.
 */
export function decayImportance(baseImportance: number, ageDays: number): number {
  const decay = Math.exp(-ageDays / 30)  // 30-day half-ish decay
  return baseImportance * (0.4 + 0.6 * decay)  // never drops below 40%
}

/** 默认的强度闸阈值（0..1）。 */
export const DEFAULT_INTENSITY_THRESHOLD = 0.4

/**
 * 默认的「一条真人话语」长度上界（字符）。
 *
 * 为什么需要它（D2）：`detectIntensity` 是**整条消息一个分**，而
 * `extractPreferences` 是**整条消息做正则**。闸门原本是为「短句情绪爆发」设计的，
 * 一段一万字的文档却天然带一堆问号与全大写词，轻松过 0.4 阈值后被逐句抠成偏好——
 * 实测 AGENTS.md 那 10079 字符得 0.60 分、一次产出 6 条「用户偏好」。
 *
 * D1（只认 `source.kind === 'user'`）已经堵掉了注入面；这一道是**纵深防御**：
 * 真人粘一整篇文档进来时同样不该被当成偏好来源。真人现场打出来的抱怨很少超过
 * 这个量级，所以宁可漏挖也不要再灌垃圾。
 */
export const DEFAULT_MAX_UTTERANCE_CHARS = 2000

/** valence 挖掘的配置面（纯定义，service 与 SparkConfig 共用）。 */
export interface ValenceConfig {
  /** 是否捕获挖到的偏好为火花。默认 true（产品定位：Agent 是平等的提出者）。 */
  enabled?: boolean
  /** 最低情绪强度才触发抽取。0..1，默认 {@link DEFAULT_INTENSITY_THRESHOLD}。 */
  intensityThreshold?: number
  /** 单条话语长度上界；超过视为「贴文档」而非「说话」。默认 {@link DEFAULT_MAX_UTTERANCE_CHARS}。 */
  maxUtteranceChars?: number
}

export type ValenceSkipReason = 'empty' | 'too-long' | 'low-intensity'

export interface ValenceMiningResult {
  candidates: PreferenceCandidate[]
  /** 未产出候选时的原因；产出候选时为 null。 */
  skipped: ValenceSkipReason | null
}

/**
 * 挖掘闸门（纯函数）：长度闸 → 强度闸 → 抽取。
 *
 * 三道都必须过**同一条话语**——闸门与抽取粒度错位正是 D2 的病根。
 * 把顺序与短路理由收进纯函数，是为了让「什么被拒绝了、为什么」可单测，
 * 而不是散在 service 的 if 里（那些分支在真宿主上只有日志能看见）。
 */
export function minePreferences(text: string, config: ValenceConfig = {}): ValenceMiningResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { candidates: [], skipped: 'empty' }
  const maxChars = config.maxUtteranceChars ?? DEFAULT_MAX_UTTERANCE_CHARS
  if (trimmed.length > maxChars) return { candidates: [], skipped: 'too-long' }
  const threshold = config.intensityThreshold ?? DEFAULT_INTENSITY_THRESHOLD
  if (detectIntensity(trimmed) < threshold) return { candidates: [], skipped: 'low-intensity' }
  const candidates = extractPreferences(trimmed)
  return { candidates, skipped: candidates.length === 0 ? 'low-intensity' : null }
}

/**
 * 这条 `user/message` 是不是**真人说的**（D1）。
 *
 * `session/event` 的 `user/message` 同时承载注入的脚手架（AGENTS.md、
 * HippoMemo 记忆提醒、技能目录、runtime context…）——实测一个会话 7 条
 * `user/message` 里只有 2 条是真人说的。判据是**结构性**的，不是启发式：
 * 权威定义见 `@deepseek-ai/dsh-llm` 的 `MessageSourceMap`，其中 `user` 是唯一
 * 的真人 kind，且该类型是 merge-extensible 的（明言「switch on `kind` and fall
 * through unknowns」）——所以这里写**白名单**，对将来新增的注入 kind 天然免疫。
 *
 * `source` 缺失时判否：宁可漏挖，也不再把 AI 自己的指令当用户偏好存库。
 */
export function isRealUserMessage(source: unknown): boolean {
  if (source === null || typeof source !== 'object') return false
  return (source as { kind?: unknown }).kind === 'user'
}

/**
 * 跨会话去重的参照面：由现有火花算出的实质面 token + 池级模板 token。
 * 池为空集时 `isDuplicateOfPool` 恒为 false（不退化成"什么都不挖"）。
 */
export interface ValenceDedupPool {
  tokens: readonly (readonly string[])[]
  boilerplate: ReadonlySet<string>
}

/** 从现有火花构建去重参照面（纯函数；service 只负责把库读出来）。 */
export function buildDedupPool(sparks: readonly SparkView[]): ValenceDedupPool {
  const tokens = sparks.map(s => substanceTokens(s))
  return { tokens, boilerplate: boilerplateTokens(tokens) }
}

/**
 * 这个候选是不是**已经挖过了**（D4）。
 *
 * 动机：同一份脚手架每个新会话都会被重新注入，于是同一批短语被反复挖出——
 * 实测 3 个会话 23 个候选只有 9 个唯一（冗余 61%），实库 40 条里 22 条逐字节重复。
 *
 * 判据是实质面（标题+正文，剔除池级模板 token）相似度 ≥ `RESTATEMENT_THRESHOLD`。
 *  - 为什么复用 `derive.ts` 的 0.85：那是仓库里**唯一**的「复述」口径（F5 反自噬闸），
 *    再定一个阈值就等于有两份「多像算同一条」的定义。
 *  - 为什么不照抄 `checkRestatement`（它只比**标题**）：本管线的标题是模板化的
 *    （「用户偏好：Don't X」），模板前缀贡献 6 个 token 里的 5 个，比标题会把
 *    任意两条都判成重复。实质面以正文为主，而正文实测区分度最高
 *    （纯正文 Jaccard 中位数 0.000，同池标题面 0.357）。
 */
export function isDuplicateOfPool(
  input: { title: string; content: string },
  pool: ValenceDedupPool,
): boolean {
  if (pool.tokens.length === 0) return false
  const tokens = substanceTokens(input)
  return pool.tokens.some(existing => jaccardWithout(tokens, existing, pool.boilerplate) >= RESTATEMENT_THRESHOLD)
}

/** 一条 `user/message` 事件的最小面（结构化，不引入 platform 依赖）。 */
export interface MiningEventData {
  content: readonly { type: string; text?: unknown }[]
  source?: unknown
}

export interface MiningDecision {
  /**
   * - `ignore-injected`：不是真人说的，根本没进管线（D1）
   * - `skip`：是真人说的，但没通过长度/强度闸（D2）
   * - `mine`：可以进入捕获（仍需过 D4 去重）
   */
  action: 'ignore-injected' | 'skip' | 'mine'
  candidates: PreferenceCandidate[]
  skipReason: ValenceSkipReason | null
}

/** 从消息块里取纯文本（与既有实现同形）。 */
export function extractMessageText(content: readonly { type: string; text?: unknown }[]): string {
  const out: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') out.push(block.text)
  }
  return out.join(' ').trim()
}

/**
 * 一条 `user/message` 事件的完整判定（纯函数）——D1 → D2。
 *
 * 收进纯函数是为了能用**真实会话里抓到的载荷形状**做回归测试：真宿主上这些分支
 * 只有日志能看见，而它们正是 40/54 条垃圾火花的全部来源。
 */
export function decideMining(data: MiningEventData, config: ValenceConfig = {}): MiningDecision {
  if (!isRealUserMessage(data.source)) {
    return { action: 'ignore-injected', candidates: [], skipReason: null }
  }
  const { candidates, skipped } = minePreferences(extractMessageText(data.content), config)
  if (skipped !== null) return { action: 'skip', candidates: [], skipReason: skipped }
  return { action: 'mine', candidates, skipReason: null }
}
