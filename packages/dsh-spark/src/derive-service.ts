/**
 * DeriveService（`ctx.derive`）—— 衍生引擎的 IO 半边（v2 §5，P15 + P17）。
 *
 * 分工：候选对选择 / 提示词 / 解析 / 复述判定全在 `derive.ts`（纯函数，可单测）；
 * 本文件只做三件事：拿数据、调 LLM（**可选注入**）、把产物落库。
 *
 * 三条设计纪律：
 *  1. **LLM 面可选**：`ctx.llm` / `ctx.agentDefaultModel` 用 try/catch 结构读取
 *     （不写进 `inject`，headless 组合不该因为缺 LLM 而起不来）。缺失 → 本轮不生成、
 *     **不报错**，`skipped` 如实说明原因。
 *  2. **产物直接落库**（P15）：不走进提议、不要人审批 —— 审批会让产量等于人的点击量。
 *     噪声由「会过期」兜底（`expiresAt = now + 14d`，仅 derived 非空）。
 *  3. 生成是熵增：复述（与输入/已有标题 Jaccard ≥ 0.85）一律拒绝并记录原因。
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  deriveRequestSchema,
  type SparkDeriveRequest,
  type SparkDeriveResult,
  type SparkView,
} from 'dsh-spark-wire'
import {
  buildDerivePrompt,
  parseDerivedCandidates,
  partitionCandidates,
  selectDerivationPairs,
  type DerivedCandidate,
} from './derive.ts'
import type {} from './spark-service.ts'

export const name = 'spark-derive'

/** 可选平台能力的结构面（故意不写进 inject，见文件头第 1 条）。 */
interface LlmLike {
  stream(options: GenerateOptions): AsyncIterable<unknown>
}

interface ModelSelection {
  provider: string
  model: string
}

interface DefaultModelLike {
  currentSelection(): ModelSelection | undefined
}

export interface DeriveConfig {
  /** 单轮 LLM 调用的超时（毫秒）。默认 60s。 */
  timeoutMs?: number
  maxTokens?: number
  /** 衍生火花的存活天数（到期且零召回 → 墓碑）。默认 14 天（v2 §5.2）。 */
  ttlDays?: number
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_TOKENS = 1_200
export const DEFAULT_DERIVE_TTL_DAYS = 14

/** LLM 输出里的候选总量上限（防一轮产出把库灌满）。 */
const MAX_CANDIDATES_PER_ROUND = 10

export interface DeriveDeps {
  /** 本轮输入池（调用方已按 active / 非墓碑取好）。 */
  pool: readonly SparkView[]
  /** 可选 LLM 面；缺省 = 本轮不生成（headless / 未装 provider）。 */
  llm?: LlmLike | undefined
  route?: ModelSelection | undefined
  /** 落库入口（真宿主是 `spark.capture`；测试用假实现同样能跑 provenance 闸）。 */
  capture(input: unknown): Promise<SparkView>
  logger?: { info?(message: string): void; warn?(message: string): void } | undefined
  timeoutMs?: number
  maxTokens?: number
}

/**
 * 一轮衍生的**编排**（依赖全部显式注入，因此可脱离 cordis 单测）。
 *
 * `DeriveService.run()` 只负责把真实依赖凑齐后调它 —— 于是「假模型 + 假落库」
 * 跑的是与生产**同一条**代码路径。这不是为了好看：真宿主的 sandbox profile 里
 * 模型凭据缺失（route 解析成功但流为空），端到端只能靠这样验收。
 */
export async function runDerivationRound(
  request: SparkDeriveRequest,
  deps: DeriveDeps,
  now: number = Date.now(),
): Promise<SparkDeriveResult> {
  const pairs = selectDerivationPairs(deps.pool, {
    maxPairs: request.maxPairs,
    minSimilarity: request.minSimilarity,
    maxSimilarity: request.maxSimilarity,
    ...(request.seedId === undefined ? {} : { seedId: request.seedId }),
  })
  if (pairs.length === 0) {
    return { pairsConsidered: 0, created: [], rejected: [], skipped: 'no candidate pairs' }
  }
  if (request.dryRun) {
    return { pairsConsidered: pairs.length, created: [], rejected: [], skipped: 'dry run' }
  }
  if (deps.llm === undefined) {
    return { pairsConsidered: pairs.length, created: [], rejected: [], skipped: 'llm service unavailable' }
  }
  if (deps.route === undefined) {
    return { pairsConsidered: pairs.length, created: [], rejected: [], skipped: 'no model route' }
  }

  const knownTitles = deps.pool.map(spark => spark.title)
  const prompt = buildDerivePrompt(pairs, knownTitles, request.maxResults)
  let raw: string
  try {
    raw = await callModel(deps.llm, deps.route, prompt.system, prompt.user, {
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
    })
  } catch (error) {
    deps.logger?.warn?.('spark-derive: llm call failed: ' + messageOf(error))
    return { pairsConsidered: pairs.length, created: [], rejected: [], skipped: 'llm call failed' }
  }

  const allowedParentIds = pairs.flatMap(pair => [pair.a.id, pair.b.id])
  const candidates = parseDerivedCandidates(raw, allowedParentIds).slice(0, MAX_CANDIDATES_PER_ROUND)
  if (candidates.length === 0) {
    // 诊断留痕（截断 500 字）：解析失败时"模型到底说了什么"是唯一有用的证据。
    deps.logger?.warn?.('spark-derive: unparseable output (' + String(raw.length) + ' chars): ' + raw.slice(0, 500))
    const shape = raw.trim().length === 0 ? 'empty' : (raw.includes('{') ? 'unparseable' : 'no-json')
    return {
      pairsConsidered: pairs.length,
      created: [],
      rejected: [],
      skipped: 'no usable output (' + shape + ', ' + String(raw.length) + ' chars via '
        + deps.route.provider + '/' + deps.route.model + ')',
    }
  }

  const { accepted, rejected } = partitionCandidates(candidates, knownTitles)
  const created: SparkView[] = []
  for (const candidate of accepted) {
    // 生成理由进日志（不进契约）：事后能看出这一轮是不是在自我复述。
    if (candidate.reason !== undefined) {
      deps.logger?.info?.('spark-derive: ' + candidate.title + ' ← ' + candidate.reason)
    }
    try {
      const parents = deps.pool.filter(spark => candidate.derivedFrom.includes(spark.id))
      created.push(await deps.capture({
        title: candidate.title,
        content: candidate.content,
        tags: candidate.tags,
        scope: parents[0]?.scope ?? 'project',
        workspacePath: parents[0]?.workspacePath ?? null,
        sourceSessionId: 'spark-derive',
        sourceAgentId: null,
        sourceTurn: null,
        origin: 'derived',
        derivedFrom: candidate.derivedFrom,
      }))
    } catch (error) {
      // 反自噬闸（unknown parent / derived 父本 / generation 超上限）落在这里：
      // resolveProvenance 抛，我们把它记成拒绝而不是让整轮失败。
      rejected.push({ title: candidate.title, reason: 'provenance: ' + messageOf(error) })
    }
  }
  return {
    pairsConsidered: pairs.length,
    created,
    rejected,
    skipped: created.length === 0 ? 'all candidates rejected' : null,
  }
}

/** 一次流式调用并拼出文本（与 hippomemo evolve 同形：BlockAssembler + 超时）。 */
async function callModel(
  llm: LlmLike,
  route: ModelSelection,
  system: string,
  user: string,
  limits: { timeoutMs: number; maxTokens: number },
): Promise<string> {
  const assembler = new BlockAssembler()
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: user }],
      source: { kind: 'plugin', plugin: name, form: 'instructions' },
    })],
    system,
    maxTokens: limits.maxTokens,
    signal: AbortSignal.timeout(limits.timeoutMs),
  }
  for await (const chunk of llm.stream(options)) {
    assembler.push(chunk as Parameters<BlockAssembler['push']>[0])
  }
  return assembler.blocks()
    .filter((block): block is { type: 'text'; text: string } => (
      (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string'
    ))
    .map(block => block.text)
    .join('\n')
}

export class DeriveService extends Service {
  static inject = ['spark'] as const

  private readonly timeoutMs: number
  private readonly maxTokens: number
  readonly ttlMs: number

  /** 可选平台能力：**只能**通过 `ctx.inject` 拿到（见文件头第 1 条与 AGENTS §2.5）。 */
  private llm: LlmLike | undefined
  private defaultModel: DefaultModelLike | undefined

  constructor(ctx: Context, config: DeriveConfig = {}) {
    super(ctx, 'derive')
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
    this.ttlMs = (config.ttlDays ?? DEFAULT_DERIVE_TTL_DAYS) * 86_400_000
    // 关键：**必须走可选注入**。用 `(ctx as any).llm` 结构读取在真宿主会被 inject 门
    // 拦下（`cannot get property ... without inject`），于是 try/catch 永远降级成
    // 「llm service unavailable」——能力静默失效、预览与单测全绿，只有用户发现
    // （实测踩过：sandbox 里 derive 永远 skipped）。
    // 缺任一依赖时回调不执行，llm 保持 undefined，headless 组合照常可用。
    ctx.inject(['llm', 'agentDefaultModel'], (sctx) => {
      this.llm = (sctx as unknown as { llm: LlmLike }).llm
      this.defaultModel = (sctx as unknown as { agentDefaultModel: DefaultModelLike }).agentDefaultModel
    })
  }

  /** config.ttlDays 的读面（SparkService.capture 用它给 derived 打 expiresAt）。 */
  get ttlDays(): number {
    return this.ttlMs / 86_400_000
  }

  /**
   * 跑一轮衍生。**任何失败都降级成 `skipped`，不抛给调用方**——
   * 生成是加成能力，不该让它把一次工具调用或一次点击变成错误。
   */
  async run(input: unknown = {}, now: number = Date.now()): Promise<SparkDeriveResult> {
    const request: SparkDeriveRequest = deriveRequestSchema.parse(input)
    const pool = await this.ctx.spark.list({ status: 'active', limit: 500 })
    return runDerivationRound(request, {
      pool,
      llm: this.llm,
      route: this.defaultModel?.currentSelection(),
      capture: capture => this.ctx.spark.capture(capture),
      logger: this.ctx.logger,
      timeoutMs: this.timeoutMs,
      maxTokens: this.maxTokens,
    }, now)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
