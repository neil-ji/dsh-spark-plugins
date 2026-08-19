/**
 * HippoMemo automatic candidate extractor.
 *
 * After each agent turn, the extractor asks the configured model route (or the
 * agent-default model) to produce durable memory candidates, then writes them
 * with status "candidate" for human curation in the settings page.
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
  extractTextFromBlocks, parseCandidateMemories, type TurnMessage,
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
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  provider: z.string(),
  model: z.string(),
  maxOutputTokens: z.number().step(1).min(1).default(512),
  timeoutMs: z.number().step(1).min(1).default(60_000),
  maxCandidatesPerTurn: z.number().step(1).min(1).max(12).default(4),
})

interface ResolvedConfig {
  enabled: boolean
  provider?: string
  model?: string
  maxOutputTokens: number
  timeoutMs: number
  maxCandidatesPerTurn: number
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
  }
}

export function apply(ctx: Context, config: HippomemoExtractorConfig = {}): void {
  const resolved = resolveConfig(config)
  if (resolved.enabled === false) return

  const tails = new WeakMap<object, Promise<void>>()
  ctx.on('agent/turn-stopping', ({ agent, turn, signal }) => {
    const messages = collectTurnMessagesFromAgent(agent, turn)
    if (messages.length === 0) return
    const previous = tails.get(agent) ?? Promise.resolve()
    const current = previous
      .then(() => extractCandidates(ctx, agent, turn, messages, resolved, signal))
      .catch((error: unknown) => {
        ctx.logger.warn('hippomemo-extractor: candidate extraction failed: ' + String(error))
      })
    tails.set(agent, current)
  })
}

interface AgentLike {
  id: string
  session: {
    events: readonly {
      type: string
      data: any
    }[]
  }
}

function collectTurnMessagesFromAgent(agent: AgentLike, turn: number): TurnMessage[] {
  const events = agent.session.events
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
  agent: AgentLike,
  turn: number,
  messages: TurnMessage[],
  config: ResolvedConfig,
  signal: AbortSignal,
): Promise<void> {
  const transcript = collectTurnMessages(messages)
  if (transcript.length === 0) return
  const prompt = buildExtractionPrompt(transcript)
  const route = config.provider !== undefined && config.model !== undefined
    ? { provider: config.provider, model: config.model }
    : ctx.agentDefaultModel.currentSelection()
  const callSignal = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
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
    await ctx.memory.put(candidateToInput(candidate, agent.id, turn))
  }
}
