/**
 * HippoMemo search-term enrichment.
 *
 * On every memory put, fire-and-forget a small auxiliary model call that
 * generates bilingual/synonym retrieval keywords, then stores them on the
 * record's searchTerms field. Those terms are indexed like tags, so a Chinese
 * query can match an English memory (and vice versa) without a query-time LLM
 * call on the pre-step path.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from './memory-service.ts'
import { extractTextFromBlocks } from './memory-extract.ts'

export const name = 'hippomemo-terms'
export const inject = ['llm', 'memory', 'agentDefaultModel']

export interface HippomemoTermsConfig {
  enabled?: boolean
  provider?: string
  model?: string
  maxTerms?: number
  maxOutputTokens?: number
  timeoutMs?: number
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  provider: z.string(),
  model: z.string(),
  maxTerms: z.number().step(1).min(1).max(32).default(12),
  maxOutputTokens: z.number().step(1).min(1).default(256),
  timeoutMs: z.number().step(1).min(1).default(60_000),
})

interface ResolvedConfig {
  enabled: boolean
  provider?: string
  model?: string
  maxTerms: number
  maxOutputTokens: number
  timeoutMs: number
}

function resolveConfig(config: HippomemoTermsConfig = {}): ResolvedConfig {
  const provider = config.provider
  const model = config.model
  if ((provider === undefined) !== (model === undefined)) {
    throw new TypeError('hippomemo-terms: provider and model must be supplied together')
  }
  return {
    enabled: config.enabled ?? true,
    provider,
    model,
    maxTerms: config.maxTerms ?? 12,
    maxOutputTokens: config.maxOutputTokens ?? 256,
    timeoutMs: config.timeoutMs ?? 60_000,
  }
}

export function apply(ctx: Context, config: HippomemoTermsConfig = {}): void {
  const resolved = resolveConfig(config)
  if (resolved.enabled === false) return

  const tails = new Map<string, Promise<void>>()
  ctx.on('hippomemo/changed', ({ operation, id }) => {
    if (operation !== 'put') return
    void enrich(ctx, id, resolved, tails)
  })
}

async function enrich(
  ctx: Context,
  id: string,
  config: ResolvedConfig,
  tails: Map<string, Promise<void>>,
): Promise<void> {
  const record = ctx.memory.get(id)
  if (record === undefined) return
  if (Array.isArray(record.searchTerms) && record.searchTerms.length > 0) return

  const previous = tails.get(id) ?? Promise.resolve()
  const current = previous
    .then(async () => {
      const terms = await generateSearchTerms(ctx, record.title, record.content, config)
      if (terms.length === 0) return
      await ctx.memory.update(id, { searchTerms: terms })
    })
    .catch((error: unknown) => {
      ctx.logger.warn('hippomemo-terms: search-term generation failed: ' + String(error))
    })
  tails.set(id, current)
  void current.then(() => {
    if (tails.get(id) === current) tails.delete(id)
  })
}

async function generateSearchTerms(
  ctx: Context,
  title: string,
  content: string,
  config: ResolvedConfig,
): Promise<string[]> {
  const prompt = buildSearchTermsPrompt(title, content)
  const route = config.provider !== undefined && config.model !== undefined
    ? { provider: config.provider, model: config.model }
    : ctx.agentDefaultModel.currentSelection()
  const callSignal = AbortSignal.timeout(config.timeoutMs)
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: prompt.user }],
      source: { kind: 'plugin', plugin: name },
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
  return parseSearchTerms(extractTextFromBlocks(assembler.blocks())).slice(0, config.maxTerms)
}

/** Frame the auxiliary keyword-generation call. Pure for unit testing. */
export function buildSearchTermsPrompt(title: string, content: string): { system: string; user: string } {
  return {
    system: [
      'You generate retrieval keywords for one durable memory so a later Chinese- or English-speaking agent can find it by keyword search.',
      'Return a JSON array of strings only. Each keyword must be a short, self-contained search term.',
      'Include: exact technical terms, common synonyms, Chinese translations of key terms, and abbreviations.',
      'Do NOT include generic filler words, full sentences, or the memory id.',
      'Return [] only when nothing meaningful can be added.',
    ].join('\n'),
    user: 'Title: ' + title + '\nContent: ' + content,
  }
}

/** Parse the JSON array returned by the model, tolerating surrounding prose. */
export function parseSearchTerms(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start < 0 || end < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return []
  }
  if (Array.isArray(parsed) === false) return []
  const terms: string[] = []
  for (const item of parsed.slice(0, 32)) {
    if (typeof item !== 'string') continue
    const term = item.trim()
    if (term.length === 0 || term.length > 50) continue
    terms.push(term)
  }
  return [...new Set(terms)]
}
