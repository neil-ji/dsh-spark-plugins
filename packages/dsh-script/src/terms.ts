/**
 * 检索词富化（Spec §5.5 / D11）—— `dsh-script/terms` 子路径入口。
 *
 * 一次 fire-and-forget 的辅助模型调用：脚本被沉淀（`scripts/changed{operation:'save'}`）且
 * 该条还没有 `searchTerms` 时，生成一批双语/同义词写回 `searchTerms`，让"另一种语言的查询"
 * 也能找到这条脚本（`matchScore` 把它与 tags 同权重，Spec §5.4）。范本：`dsh-hippomemo` 的
 * `memory-terms.ts`（同一套形态：子路径插件入口 + bundle patch 的 loader 行 + 只填空 + 失败只 warn）。
 *
 * 四条刻意的约束（Spec §5.5 逐条对应）：
 *  1. **只填空**：已有检索词就不再调用模型 —— 幂等，也是防自激的闸门；
 *  2. **不动 `updatedAt`**（走 `ScriptService.setSearchTerms` 的 `touch: false`）：它是索引不是
 *     内容修订；动它会把"僵尸脚本"的病据悄悄治没（D11）；
 *  3. **不派发客户端事件**：检索词不上屏，多派一帧只会让一次 save 触发两次面板重载；
 *  4. **失败只 warn**：富化是尽力而为，绝不能影响写入主路径。
 *
 * 组合面：`inject = ['llm', 'script', 'agentDefaultModel']` —— 平台缺任一服务时本插件整体
 * 不激活，headless 组合照常可用（AGENTS §2.5）。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from './types.ts'

export const name = 'script-terms'
export const inject = ['llm', 'script', 'agentDefaultModel'] as const

export interface ScriptTermsConfig {
  enabled?: boolean
  /** 指定生成用模型；与 `model` 成对，缺省用会话默认模型。 */
  provider?: string
  model?: string
  maxTerms?: number
  maxOutputTokens?: number
  timeoutMs?: number
}

export const Config: z<{
  enabled: boolean
  provider: string
  model: string
  maxTerms: number
  maxOutputTokens: number
  timeoutMs: number
}> = z.object({
  enabled: z.boolean().default(true),
  provider: z.string(),
  model: z.string(),
  maxTerms: z.number().step(1).min(1).max(32).default(12),
  maxOutputTokens: z.number().step(1).min(1).default(256),
  timeoutMs: z.number().step(1).min(1).default(60_000),
})

export interface ResolvedTermsConfig {
  enabled: boolean
  /** 未配置时为 `undefined`（`provider`/`model` 必须成对，见 `resolveConfig`）。 */
  provider: string | undefined
  model: string | undefined
  maxTerms: number
  maxOutputTokens: number
  timeoutMs: number
}

/**
 * 归一化配置。
 * @throws 只给了 provider / model 之一时抛错（半截路由比不配更危险：会静默走默认模型）。
 */
export function resolveConfig(config: ScriptTermsConfig = {}): ResolvedTermsConfig {
  const provider = config.provider
  const model = config.model
  if ((provider === undefined) !== (model === undefined)) {
    throw new TypeError('script-terms: provider and model must be supplied together')
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

/** prompt 里脚本正文（步骤）的字符预算：够抽词，又不至于把上下文塞满。 */
export const PROMPT_STEPS_MAX_CHARS = 800

/**
 * 构造富化调用的 prompt（纯函数）。
 * @param script - 名称 / 描述 / 步骤文本。
 * @returns system 与 user 两段文本。
 */
export function buildSearchTermsPrompt(script: {
  readonly name: string
  readonly description: string
  readonly stepsText?: string
}): { system: string; user: string } {
  const steps = (script.stepsText ?? '').replaceAll(/\s+/g, ' ').trim()
  return {
    system: [
      'You generate retrieval keywords for one stored multi-step procedure so a later Chinese- or English-speaking agent can find it by keyword search.',
      'Return a JSON array of strings only. Each keyword must be a short, self-contained search term.',
      'Include: exact technical terms, tool/command names, common synonyms, Chinese translations of key terms, and abbreviations.',
      'Do NOT include generic filler words, full sentences, or the script id.',
      'Return [] only when nothing meaningful can be added.',
    ].join('\n'),
    user: [
      'Name: ' + script.name,
      'When to use: ' + script.description,
      ...(steps.length === 0 ? [] : ['Steps: ' + steps.slice(0, PROMPT_STEPS_MAX_CHARS)]),
    ].join('\n'),
  }
}

/**
 * 解析模型返回的 JSON 数组（容忍前后有解释性文字）。纯函数。
 * @param text - 模型输出。
 * @returns 去重后的检索词（逐项限定长度 ≤50，与 schema 一致）。
 */
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

/** 富化所需的最小记录形状。 */
export interface EnrichableRecord {
  readonly name: string
  readonly description: string
  readonly steps: readonly { readonly payload: string }[]
  readonly searchTerms?: readonly string[] | undefined
}

/** 富化的全部外部依赖（注入以便无 llm/无文件系统单测）。 */
export interface TermsDeps {
  readonly read: (id: string) => Promise<EnrichableRecord | null>
  readonly write: (id: string, terms: readonly string[]) => Promise<unknown>
  /** 辅助模型调用：给 prompt，回原始文本。 */
  readonly generate: (prompt: { system: string; user: string }) => Promise<string>
  readonly warn: (message: string) => void
}

/**
 * 富化一条记录（Spec §5.5）：只填空、解析、回写。
 * @returns 本次写入的检索词；不需要富化或没抽到词时返回空数组。
 */
export async function enrichRecord(
  id: string,
  deps: TermsDeps,
  config: ResolvedTermsConfig,
): Promise<string[]> {
  const record = await deps.read(id)
  if (record === null) return []
  // 只填空：已有检索词就不再花一次模型调用（也是防"回写触发再富化"的自激闸门）。
  if ((record.searchTerms ?? []).length > 0) return []
  const raw = await deps.generate(buildSearchTermsPrompt({
    name: record.name,
    description: record.description,
    stepsText: record.steps.map(step => step.payload).join('\n'),
  }))
  const terms = parseSearchTerms(raw).slice(0, config.maxTerms)
  if (terms.length === 0) return []
  await deps.write(id, terms)
  return terms
}

/** 注册富化（`dsh-script/terms` 入口的 apply）。 */
export function apply(ctx: Context, config: ScriptTermsConfig = {}): void {
  const resolved = resolveConfig(config)
  if (resolved.enabled === false) return

  // 同一 id 串行：save 连发时不会用两次模型调用互相覆盖（与 memory-terms 同手法）。
  const tails = new Map<string, Promise<void>>()
  ctx.on('scripts/changed', ({ operation, id }) => {
    if (operation !== 'save' || id === null) return
    void runEnrichment(ctx, id, resolved, tails)
  })
}

async function runEnrichment(
  ctx: Context,
  id: string,
  config: ResolvedTermsConfig,
  tails: Map<string, Promise<void>>,
): Promise<void> {
  const previous = tails.get(id) ?? Promise.resolve()
  const current = previous
    .then(async () => {
      await enrichRecord(id, depsOf(ctx, config), config)
    })
    .catch((error: unknown) => {
      // 尽力而为：失败只 warn，绝不影响写入主路径。
      ctx.logger?.warn?.('script-terms: search-term enrichment failed: ' + String(error))
    })
  tails.set(id, current)
  void current.then(() => {
    if (tails.get(id) === current) tails.delete(id)
  })
}

/** 把 ctx 的四个能力接到富化依赖上（I/O 全部集中在这里，纯逻辑在上面）。 */
export function depsOf(ctx: Context, config: ResolvedTermsConfig): TermsDeps {
  return {
    read: async (id) => await ctx.script.get(id),
    write: async (id, terms) => await ctx.script.setSearchTerms(id, terms),
    generate: async (prompt) => await generateViaLlm(ctx, prompt, config),
    warn: (message) => { ctx.logger?.warn?.(message) },
  }
}

async function generateViaLlm(
  ctx: Context,
  prompt: { system: string; user: string },
  config: ResolvedTermsConfig,
): Promise<string> {
  const route = config.provider !== undefined && config.model !== undefined
    ? { provider: config.provider, model: config.model }
    : ctx.agentDefaultModel.currentSelection()
  const signal = AbortSignal.timeout(config.timeoutMs)
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: prompt.user }],
      source: { kind: 'plugin', plugin: name },
    })],
    system: prompt.system,
    maxTokens: config.maxOutputTokens,
    signal,
  }
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  return extractText(assembler)
}

/**
 * 把装配好的块拼成纯文本。
 *
 * 刻意**不**复用 hippomemo 的 `extractTextFromBlocks`：跨插件零引用是硬不变量（Spec INV-1，
 * 架构闸门 `crossplugin` 逐文件拦截）—— 十行文本提取不值得为它开一条跨插件通道。
 * @param assembler - dsh-llm 的块装配器。
 */
function extractText(assembler: BlockAssembler): string {
  const blocks = assembler.blocks() as readonly { type?: string; text?: string }[]
  return blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join(' ')
    .trim()
}
