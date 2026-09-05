/**
 * HippoMemo automatic candidate extractor.
 *
 * Turn capture and extraction are decoupled. At each `agent/turn-stopping` the
 * turn's direct user/assistant messages are captured into a per-session buffer
 * (cheap, no LLM); extraction is drained later — after an idle debounce
 * (`deferMs`), once `batchMaxTurns` turns are buffered, or on session/plugin
 * disposal. Draft candidates are written with status "candidate" for human
 * curation in the settings page. The deferred drain runs in the background and
 * never rejects the user's turn.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from './memory-service.ts'
import {
  buildExtractionPrompt, candidateToInput, collectTurnMessages,
  extractTextFromBlocks, isDirectUserMessage, parseCandidateMemories, type TurnMessage,
} from './memory-extract.ts'

export const name = 'hippomemo-extractor'
export const inject = ['agents', 'llm', 'memory', 'agentDefaultModel']

export interface HippomemoExtractorConfig {
  enabled?: boolean
  provider?: string
  model?: string
  maxOutputTokens?: number
  timeoutMs?: number
  maxCandidatesPerTurn?: number
  /** Idle debounce (ms) before draining a non-empty buffer. */
  deferMs?: number
  /** Drain as soon as this many turns are buffered. */
  batchMaxTurns?: number
  /** Drain remaining buffered turns on session/plugin disposal. */
  flushOnDispose?: boolean
}

export const Config: z<{
  enabled: boolean
  provider: string
  model: string
  maxOutputTokens: number
  timeoutMs: number
  maxCandidatesPerTurn: number
  deferMs: number
  batchMaxTurns: number
  flushOnDispose: boolean
}> = z.object({
  enabled: z.boolean().default(true),
  provider: z.string(),
  model: z.string(),
  maxOutputTokens: z.number().step(1).min(1).default(512),
  timeoutMs: z.number().step(1).min(1).default(60_000),
  maxCandidatesPerTurn: z.number().step(1).min(1).max(12).default(4),
  deferMs: z.number().step(1).min(0).default(4_000),
  batchMaxTurns: z.number().step(1).min(1).max(64).default(8),
  flushOnDispose: z.boolean().default(true),
})

interface ResolvedConfig {
  enabled: boolean
  provider?: string
  model?: string
  maxOutputTokens: number
  timeoutMs: number
  maxCandidatesPerTurn: number
  deferMs: number
  batchMaxTurns: number
  flushOnDispose: boolean
}

function resolveConfig(config: HippomemoExtractorConfig = {}): ResolvedConfig {
  const provider = config.provider
  const model = config.model
  if ((provider === undefined) !== (model === undefined)) {
    throw new TypeError('hippomemo-extractor: provider and model must be supplied together')
  }
  return {
    enabled: config.enabled ?? true,
    provider,
    model,
    maxOutputTokens: config.maxOutputTokens ?? 512,
    timeoutMs: config.timeoutMs ?? 60_000,
    maxCandidatesPerTurn: config.maxCandidatesPerTurn ?? 4,
    deferMs: config.deferMs ?? 4_000,
    batchMaxTurns: config.batchMaxTurns ?? 8,
    flushOnDispose: config.flushOnDispose ?? true,
  }
}

interface AgentLike {
  id: string
  session: {
    header?: { cwd?: string }
    snapshotEvents(fromSeq?: number, toSeqExclusive?: number): readonly {
      type: string
      data: any
    }[]
  }
}

interface PendingTurn {
  sessionId: string
  turn: number
  messages: TurnMessage[]
  workspacePath?: string
}

/** Per-session capture buffer that defers LLM extraction off the turn path. */
class DeferredExtractor {
  private readonly buffers = new Map<string, PendingTurn[]>()
  private readonly chains = new Map<string, Promise<void>>()
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  /** Capture a completed turn. Cheap; no LLM call yet. */
  enqueue(sessionId: string, entry: PendingTurn): void {
    let buffer = this.buffers.get(sessionId)
    if (buffer === undefined) {
      buffer = []
      this.buffers.set(sessionId, buffer)
    }
    buffer.push(entry)
    this.armIdle(sessionId)
    if (buffer.length >= this.config.batchMaxTurns) {
      void this.drain(sessionId, 'batch')
    }
  }

  private armIdle(sessionId: string): void {
    const existing = this.idleTimers.get(sessionId)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.idleTimers.delete(sessionId)
      void this.drain(sessionId, 'idle')
    }, this.config.deferMs)
    unrefTimer(timer)
    this.idleTimers.set(sessionId, timer)
  }

  private clearIdle(sessionId: string): void {
    const existing = this.idleTimers.get(sessionId)
    if (existing !== undefined) clearTimeout(existing)
    this.idleTimers.delete(sessionId)
  }

  /** Drain every buffered turn for a session, serialized. Never rejects. */
  drain(sessionId: string, reason: string): Promise<void> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        this.clearIdle(sessionId)
        const buffer = this.buffers.get(sessionId)
        if (buffer === undefined || buffer.length === 0) return
        this.buffers.set(sessionId, [])
        for (const entry of buffer) {
          try {
            await extractCandidates(this.ctx, entry.sessionId, entry.turn, entry.messages, entry.workspacePath, this.config)
          } catch (error) {
            this.ctx.logger.warn('hippomemo-extractor: candidate extraction failed: ' + String(error))
          }
        }
        this.ctx.logger.debug?.(`hippomemo-extractor: drained ${buffer.length} turn(s) reason=${reason}`)
      })
    this.chains.set(sessionId, next)
    return next
  }

  /** Flush one session (e.g. on agent dispose). */
  flush(sessionId: string): void {
    this.clearIdle(sessionId)
    void this.drain(sessionId, 'dispose')
  }

  /** Drain every buffered session (plugin disposal). */
  async dispose(): Promise<void> {
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    this.idleTimers.clear()
    const sessionIds = [...this.buffers.keys()]
    for (const sessionId of sessionIds) {
      this.clearIdle(sessionId)
      await this.drain(sessionId, 'shutdown')
    }
  }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const t = timer as unknown as { unref?: () => void }
  t.unref?.()
}

export function apply(ctx: Context, config: HippomemoExtractorConfig = {}): void {
  const resolved = resolveConfig(config)
  if (resolved.enabled === false) return

  const extractor = new DeferredExtractor(ctx, resolved)

  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    const messages = collectTurnMessagesFromAgent(agent, turn)
    if (messages.length === 0) return
    extractor.enqueue(agent.id, { sessionId: agent.id, turn, messages, workspacePath: agent.session.header?.cwd ?? undefined })
  })

  ctx.on('agent/disposed', ({ agent }) => {
    if (resolved.flushOnDispose) extractor.flush(agent.id)
  })

  ctx.effect(
    () => () => { void extractor.dispose() },
    'hippomemo-extractor: drain pending candidates',
  )
}

function collectTurnMessagesFromAgent(agent: AgentLike, turn: number): TurnMessage[] {
  const events = agent.session.snapshotEvents()
  let start = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/start' && event.data.turn === turn) {
      start = index
      break
    }
  }
  if (start < 0) return []

  const messages: TurnMessage[] = []
  for (const event of events.slice(start + 1)) {
    if (event.type === 'user/message') {
      // Skip plugin-injected context (recall blocks, time snapshots, other
      // plugin provenance) — only direct user input is a candidate source for
      // durable memory, so memory never re-ingests its own recall block.
      if (!isDirectUserMessage(event.data)) continue
      const text = extractTextFromBlocks(event.data.content ?? [])
      if (text.length > 0) messages.push({ role: 'user', text })
    } else if (event.type === 'assistant/message') {
      const text = extractTextFromBlocks(event.data.message?.content ?? [])
      if (text.length > 0) messages.push({ role: 'assistant', text })
    }
  }
  return messages
}

async function extractCandidates(
  ctx: Context,
  sessionId: string,
  turn: number,
  messages: TurnMessage[],
  workspacePath: string | undefined,
  config: ResolvedConfig,
): Promise<void> {
  const transcript = collectTurnMessages(messages)
  if (transcript.length === 0) return
  const prompt = buildExtractionPrompt(transcript)
  const route = config.provider !== undefined && config.model !== undefined
    ? { provider: config.provider, model: config.model }
    : ctx.agentDefaultModel.currentSelection()
  // Deferred extraction runs after the turn's own signal has aborted, so use a
  // fresh timeout here instead of the turn signal.
  const callSignal = AbortSignal.timeout(config.timeoutMs)
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: prompt.user }],
      source: { kind: 'plugin', plugin: name, form: 'extract' } as unknown as import('@deepseek-ai/dsh-llm').MessageSource,
    })],
    system: prompt.system,
    maxTokens: config.maxOutputTokens,
    signal: callSignal,
  }

  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    callSignal.throwIfAborted()
    assembler.push(chunk)
  }
  callSignal.throwIfAborted()
  const text = extractTextFromBlocks(assembler.blocks())
  const candidates = parseCandidateMemories(text).slice(0, config.maxCandidatesPerTurn)
  for (const candidate of candidates) {
    await ctx.memory.put(candidateToInput(candidate, sessionId, turn, workspacePath))
  }
}
