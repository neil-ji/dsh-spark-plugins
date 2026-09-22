/**
 * 命令失败挖掘（设计 §5.5，D 档）—— **默认关闭**，先在沙箱观察一轮再开。
 *
 * 目标（用户提的实验假设）：同一个模型在"写某类命令"上的训练缺口，会表现为
 * **相似的命令、跨会话重复遇到同样的错误**。把这个信号采出来，沉淀成
 *   ① 声明侧：一条火花（v2 P10/E3 改道：不再直写 hippomemo——INV-F1 零直连；
 *      是否值得成为按模型约束，由 Agent / 用户判断）；
 *   ② 程序侧：可以再写成脚本（triggers = 命令模式），让修法可执行。
 *
 * **噪声防线**（不做这层挖出来的就是垃圾）：非零退出 ≠ 失败。
 * grep 无匹配、test -f、--version 探测、被强杀进程（本项目 AGENTS.md 明确：
 * Windows 上被强杀的进程以 exit 1 结算）全是合法结果。这类一律不计入。
 *
 * 采集口径：`tool/call`（拿命令与参数）+ `tool/result`（拿是否报错与输出），
 * 两者都是 session 日志里真实 append 的事件（dsh-agent-loop）。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { SparkMeta, CommandFailureEntry } from './meta-store.ts'
import type {} from './spark-service.ts'

/** 只盯 shell 类工具；其它工具的失败不在本档范围内。 */
const SHELL_TOOL_PATTERN = /(^|[^a-z])(bash|shell|sh|zsh|pwsh|powershell|cmd|exec|terminal)([^a-z]|$)/i

/** 合法非零退出的白名单（设计 §5.5 噪声防线）。 */
const NOISE_PATTERNS: readonly RegExp[] = [
  /no matches found/i,
  /no match/i,
  /command not found:\s*test\b/i,
  /test -[fde]/i,
  /(killed|terminated|sigkill|sigterm)/i,
  /exit code 137|exit code 143/i,
  /已被强杀|进程被终止/,
]

export interface ToolCallSeen {
  name: string
  args: string
}

/** 在途调用（callId → 调用信息）；工具结果到达时据此还原命令。 */
const inFlight = new Map<string, ToolCallSeen>()

export function isShellTool(name: string): boolean {
  return SHELL_TOOL_PATTERN.test(name)
}

/** 从工具参数里取出命令行文本（参数可能是对象、字符串或数组）。 */
export function commandOf(argsRaw: string): string {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (parsed !== null && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const candidate = record['command'] ?? record['cmd'] ?? record['script'] ?? record['args']
      if (typeof candidate === 'string') return candidate
      if (Array.isArray(candidate)) return candidate.filter((x): x is string => typeof x === 'string').join(' ')
    }
  } catch {
    return argsRaw
  }
  return argsRaw
}

/**
 * 归一化命令模式：首个 token（命令名）+ 子命令 + 关键 flag。
 * 路径、数字、引号内容全部折叠 —— 它们每次都不同，留着会让同一个坑看起来像不同问题。
 */
export function normalizeCommand(toolName: string, argsRaw: string): string | undefined {
  if (!isShellTool(toolName)) return undefined
  const firstLine = commandOf(argsRaw).split(/\r?\n/)[0] ?? ''
  const normalized = firstLine
    .replace(/["'][^"']*["']/g, '<str>')
    .replace(/[A-Za-z]:\\\\[^\s]+|\/(?:[\w.-]+\/)+[\w.-]+/g, '<path>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length === 0) return undefined
  return normalized.split(' ').filter(token => token.length > 0).slice(0, 3).join(' ')
}

/** 错误签名：首个非空输出行，折叠路径/数字后截断 —— 同类错误应当收敛成同一个串。 */
export function errorSignature(output: string): string {
  const line = output.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? ''
  return line
    .replace(/[A-Za-z]:\\\\[^\s]+|\/(?:[\w.-]+\/)+[\w.-]+/g, '<path>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

/** 合法非零退出 → true（别把它算成"模型写错了命令"）。 */
export function isNoiseFailure(output: string): boolean {
  return NOISE_PATTERNS.some(pattern => pattern.test(output))
}

/** 聚合键。命令模式与错误签名都已归一化成单行，所以用换行作分隔符是安全的。 */
export function failureKey(modelKey: string, cmdPattern: string, errSig: string): string {
  return modelKey + '\n' + cmdPattern + '\n' + errSig
}

/**
 * 记录一次失败（纯函数）。同一 (model, 命令模式, 错误签名) 的**不同会话**才计数 ——
 * 同一会话里重复不算"跨会话复现"。
 */
export function recordFailure(
  meta: SparkMeta,
  observation: { modelKey: string; cmdPattern: string; errSig: string; sessionId: string },
  now: number,
): SparkMeta {
  const key = failureKey(observation.modelKey, observation.cmdPattern, observation.errSig)
  const previous = meta.commandFailures[key]
  const entry: CommandFailureEntry = previous === undefined
    ? {
        modelKey: observation.modelKey,
        cmdPattern: observation.cmdPattern,
        errSig: observation.errSig,
        sessions: [observation.sessionId],
        firstSeenAt: now,
        lastSeenAt: now,
        promotedAt: null,
        healedAt: null,
      }
    : {
        ...previous,
        sessions: previous.sessions.includes(observation.sessionId)
          ? previous.sessions
          : [...previous.sessions, observation.sessionId].slice(-20),
        lastSeenAt: now,
        healedAt: null,
      }
  return { ...meta, commandFailures: { ...meta.commandFailures, [key]: entry } }
}

/**
 * 自愈：同一 (model, 命令模式) 之后成功过 → 该模式下的失败计数清零并标记。
 * 这是"agent 已经学会正确写法"的信号，不清掉会一直误报。
 */
export function clearFailuresForSuccess(meta: SparkMeta, modelKey: string, cmdPattern: string, now: number): SparkMeta {
  let changed = false
  const next: Record<string, CommandFailureEntry> = {}
  for (const [key, entry] of Object.entries(meta.commandFailures)) {
    if (entry.modelKey === modelKey && entry.cmdPattern === cmdPattern) {
      changed = true
      next[key] = { ...entry, sessions: [], healedAt: now }
      continue
    }
    next[key] = entry
  }
  return changed ? { ...meta, commandFailures: next } : meta
}

/** 达到门槛、还没沉淀过的条目（minSessions = 跨会话复现次数下限）。 */
export function eligibleForPromotion(meta: SparkMeta, minSessions: number): CommandFailureEntry[] {
  return Object.values(meta.commandFailures).filter(entry => (
    entry.healedAt === null && entry.promotedAt === null && entry.sessions.length >= minSessions
  ))
}

/** 当前模型的已知坑（首步简报用）：未自愈、跨会话复现过、按最近复现排序。 */
export function pitfallsForModel(meta: SparkMeta, modelKey: string | undefined, limit: number): CommandFailureEntry[] {
  if (modelKey === undefined || limit <= 0) return []
  return Object.values(meta.commandFailures)
    .filter(entry => entry.modelKey === modelKey && entry.healedAt === null && entry.sessions.length >= 2)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, limit)
}

/** 会话的当前模型 key（provider/model）；与 hippomemo 的解析口径一致。 */
export function sessionModelKey(session: unknown): string | undefined {
  if (session === null || typeof session !== 'object') return undefined
  const candidate = session as { requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined }
  const logged = candidate.requestHeader?.()?.config
  if (logged?.provider !== undefined && logged?.model !== undefined) return logged.provider + '/' + logged.model
  return undefined
}

export interface SessionEventLike {
  type?: unknown
  data?: unknown
}

/** 从 tool/result 的正文里拼出可读输出（供错误签名与噪声判定用）。 */
export function resultText(message: unknown): { isError: boolean; text: string } {
  if (message === null || typeof message !== 'object') return { isError: false, text: '' }
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return { isError: false, text: '' }
  let isError = false
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; isError?: unknown; content?: unknown }
    if (candidate.type !== 'tool-result') continue
    if (candidate.isError === true) isError = true
    const inner = candidate.content
    if (typeof inner === 'string') parts.push(inner)
    else if (Array.isArray(inner)) {
      for (const item of inner) {
        if (item !== null && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
          parts.push((item as { text: string }).text)
        }
      }
    }
  }
  return { isError, text: parts.join('\n') }
}

/**
 * 会话事件订阅体：tool/call 记在途调用，tool/result 判定失败或自愈并落聚合表。
 * 只做增量更新，不做整体重扫（事件是高频路径）。
 */
export async function observeSessionEvent(
  ctx: Context,
  session: unknown,
  event: SessionEventLike,
  options: { minSessions: number },
): Promise<void> {
  const type = event?.type
  if (type !== 'tool/call' && type !== 'tool/result') return
  const data = (event.data ?? {}) as Record<string, unknown>
  const sessionId = (session as { id?: unknown })?.id
  if (typeof sessionId !== 'string') return

  if (type === 'tool/call') {
    const callId = data['callId']
    const name = data['name']
    if (typeof callId !== 'string' || typeof name !== 'string') return
    const args = typeof data['arguments'] === 'string' ? data['arguments'] : JSON.stringify(data['arguments'] ?? '')
    inFlight.set(callId, { name, args })
    if (inFlight.size > 500) {
      const oldest = inFlight.keys().next().value
      if (typeof oldest === 'string') inFlight.delete(oldest)
    }
    return
  }

  const message = data['message']
  const { isError, text } = resultText(message)
  const callId = extractCallId(message)
  if (callId === undefined) return
  const call = inFlight.get(callId)
  inFlight.delete(callId)
  if (call === undefined) return
  const cmdPattern = normalizeCommand(call.name, call.args)
  if (cmdPattern === undefined) return
  const modelKey = sessionModelKey(session)
  if (modelKey === undefined) return
  const now = Date.now()

  if (!isError) {
    await ctx.spark.updateMeta(meta => clearFailuresForSuccess(meta, modelKey, cmdPattern, now))
    return
  }
  if (isNoiseFailure(text)) return

  const errSig = errorSignature(text)
  if (errSig.length === 0) return
  const meta = await ctx.spark.updateMeta(m => recordFailure(m, { modelKey, cmdPattern, errSig, sessionId }, now))
  await promoteEligible(ctx, meta, options.minSessions, now)
}

function extractCallId(message: unknown): string | undefined {
  if (message === null || typeof message !== 'object') return undefined
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; toolCallId?: unknown }
    if (candidate.type === 'tool-result' && typeof candidate.toolCallId === 'string') return candidate.toolCallId
  }
  return undefined
}

/**
 * 把达到门槛的失败沉淀成一条火花（v2 P10/E3 改道：不再直写 hippomemo）。
 * 失败即产出，产出即留痕（promotedAt = 时间戳）；失败只记日志，下次再试。
 */
async function promoteEligible(ctx: Context, meta: SparkMeta, minSessions: number, now: number): Promise<void> {
  const eligible = eligibleForPromotion(meta, minSessions)
  if (eligible.length === 0) return
  for (const entry of eligible) {
    try {
      await ctx.spark.capture({
        title: '命令坑（' + entry.modelKey + '）：' + entry.cmdPattern,
        content: 'Cross-session repeated failure for this model.'
          + ' command pattern: ' + entry.cmdPattern
          + ' / error signature: ' + entry.errSig
          + ' / seen in ' + String(entry.sessions.length) + ' sessions.'
          + ' Mined automatically from tool results.',
        tags: ['command-pitfall', 'auto-mined'],
        scope: 'global',
        workspacePath: null,
        sourceSessionId: 'command-mining',
        sourceAgentId: null,
        sourceTurn: null,
      })
      await ctx.spark.updateMeta(current => {
        const key = failureKey(entry.modelKey, entry.cmdPattern, entry.errSig)
        const existing = current.commandFailures[key]
        if (existing === undefined) return null
        return {
          ...current,
          commandFailures: { ...current.commandFailures, [key]: { ...existing, promotedAt: now } },
        }
      })
    } catch (error) {
      ctx.logger?.warn?.('spark-inbox: capture command pitfall failed: ' + String(error))
    }
  }
}

/** 首步简报用的坑列表。 */
export async function selectPitfalls(ctx: Context, agent: { session?: unknown }, limit: number): Promise<CommandFailureEntry[]> {
  const meta = await ctx.spark.readMeta()
  return pitfallsForModel(meta, sessionModelKey(agent?.session), limit)
}

/** 渲染"这个模型已知的命令坑"简报（建议式；无内容时返回 undefined）。 */
export function renderPitfallBriefing(entries: readonly CommandFailureEntry[], maxChars: number): UserMessage | undefined {
  if (entries.length === 0) return undefined
  const lines = entries.map(entry => (
    '- command pattern "' + entry.cmdPattern + '" failed in ' + String(entry.sessions.length)
    + ' sessions with: ' + entry.errSig
  ))
  const text = [
    '<system-reminder>',
    'Known command pitfalls for the model running this session (dsh-spark, mined from past session logs):',
    ...lines,
    'These were recorded automatically from failed tool runs. Consider a different command shape, or verify assumptions first.',
    'This is background information, not an instruction.',
    '</system-reminder>',
  ].join('\n')
  if (text.length > maxChars + 64) return undefined
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'spark-inbox', form: 'notice', summary: String(entries.length) + ' known command pitfalls' },
  })
}
