/**
 * Phase 6 ValenceService: amygdala-like emotional signal mining.
 *
 * Subscribes to DSH session events (user messages). When a message crosses
 * the intensity threshold, extracts latent preferences and captures them
 * as sparks (v2 P10/E2 改道：不再写 HippoMemo——INV-F1 零直连，是否沉淀为
 * 记忆由 Agent / 用户判断）。
 *
 * Phase 6 MVP: rule-based heuristics only, manual config of threshold.
 * Phase 6.5+: LLM-backed preference extraction, explicit decay config,
 * and feedback into the prefrontal filter (Phase 3 cognitive filter).
 *
 * 2026-09-23 修复（F7 挖掘管线，四道防线）——此前本条管线是唯一**始终开启**的
 * 自动写入线，也是唯一在产垃圾的（实测 40/54 条火花是它的产物，22 条逐字节重复，
 * 内容全是 AI 自己的指令文本被贴上「用户偏好」标签）：
 *
 *  D1 **只认真人话语**：`session/event` 的 `user/message` 同时承载**注入的脚手架**
 *     （AGENTS.md、HippoMemo 记忆提醒、技能目录、runtime context…）。实测一个会话
 *     7 条 user/message 里只有 2 条是真人说的。判据是结构性的、不靠启发式：
 *     `data.source.kind === 'user'`。权威定义见 `@deepseek-ai/dsh-llm` 的
 *     `MessageSourceMap`——它明确要求「switch on `kind` and fall through unknowns」
 *     （merge-extensible 和类型，插件可自行增加 kind），所以这里写**白名单**而不是
 *     枚举已知注入类型，对将来新增的 kind 天然免疫。
 *  D2 **闸门与抽取同一条话语**：长度闸 + 强度闸都作用于那一条真人话语（见
 *     `valence.ts` 的 `minePreferences`）。
 *  D3 **provenance 显式**：`candidateToSparkInput` 声明 `origin: 'agent'`，不再
 *     让 wire schema 的 `default('human')` 把机器产物冒充人类原创。
 *  D4 **跨会话去重**：同一份脚手架每个新会话都会被重新注入 → 同一批短语被反复挖出
 *     （实测 3 个会话 23 个候选只有 9 个唯一，冗余 61%）。捕获前先与池比实质面相似度。
 *
 * `commandMining` 的先例是「默认关、先在沙箱观察一轮产出质量」；valence 是产品定位
 * 的一部分（Agent 是平等的提出者），所以保持**默认开启**，但把上述四道防线补齐。
 */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  buildDedupPool,
  candidateToSparkInput,
  decideMining,
  isDuplicateOfPool,
  minePreferences,
  type PreferenceCandidate,
  type ValenceConfig,
  type ValenceDedupPool,
  type ValenceSkipReason,
} from './valence.ts'

export type { ValenceConfig } from './valence.ts'

export interface ValenceRunStats {
  intensityThreshold: number
  maxUtteranceChars: number
  persistEnabled: boolean
  /** 被 D1 判为注入而非真人话语、直接跳过的事件数。 */
  ignoredInjected: number
  /** How many messages were observed above the intensity threshold. */
  highIntensitySeen: number
  /** 因与已有火花实质面重复而跳过的候选数（D4）。 */
  duplicatesSkipped: number
  /** How many preference sparks were captured. */
  sparksCaptured: number
  /** 最近一次被跳过的原因（诊断用；null = 没有被跳过）。 */
  lastSkipReason: ValenceSkipReason | null
}

interface ContentBlockLike { type: string; text?: unknown }

/**
 * `session/event` 的 `user/message` 载荷。
 *
 * 只声明本服务用到的面（仓库既有风格：不为此引入 platform 依赖）。
 * `source.kind` 的权威定义在 `@deepseek-ai/dsh-llm` 的 `MessageSourceMap`。
 */
interface UserMessageEvent {
  type: 'user/message'
  data: {
    content: readonly ContentBlockLike[]
    source?: { kind?: unknown } | undefined
  }
}

/**
 * `session/event` 的 `user/message` 载荷。
 *
 * 只声明本服务用到的面（仓库既有风格：不为此引入 platform 依赖）。
 * `source.kind` 的权威定义在 `@deepseek-ai/dsh-llm` 的 `MessageSourceMap`。
 */
interface UserMessageEvent {
  type: 'user/message'
  data: {
    content: readonly ContentBlockLike[]
    source?: { kind?: unknown } | undefined
  }
}

export class ValenceService extends Service {
  static inject = ['spark'] as const

  private readonly config: ValenceConfig
  private readonly persistEnabled: boolean
  private ignoredInjected = 0
  private highIntensitySeen = 0
  private duplicatesSkipped = 0
  private sparksCaptured = 0
  private lastSkipReason: ValenceSkipReason | null = null
  private unsubscribe: (() => void) | null = null

  constructor(ctx: Context, config: ValenceConfig = {}) {
    super(ctx, 'valence')
    this.config = config
    this.persistEnabled = config.enabled ?? true
    this.subscribe(ctx)
  }

  private subscribe(ctx: Context): void {
    const dispose = ctx.on('session/event', (_session, event) => {
      if (event.type !== 'user/message') return
      void this.handleUserMessage(event as UserMessageEvent).catch(error => {
        ctx.logger?.warn?.('valence: handle failed: ' + String(error))
      })
    })
    this.unsubscribe = dispose
  }

  private async handleUserMessage(event: UserMessageEvent): Promise<void> {
    // D1 + D2：判定（谁能进管线 / 进管线后过不过闸）全在纯函数里，见 valence.ts。
    const decision = decideMining(event.data, this.config)
    if (decision.action === 'ignore-injected') {
      this.ignoredInjected += 1
      return
    }
    if (decision.action === 'skip') {
      this.lastSkipReason = decision.skipReason
      return
    }
    this.highIntensitySeen += 1
    if (!this.persistEnabled) return
    // D4：池只读一次，本条的候选全部拿它比对（不是每个候选各读一次）。
    const pool = await this.loadDedupPool()
    for (const candidate of decision.candidates) {
      const input = candidateToSparkInput(candidate, null)
      if (isDuplicateOfPool(input, pool)) {
        this.duplicatesSkipped += 1
        continue
      }
      try {
        await this.ctx.spark.capture(input)
        this.sparksCaptured += 1
      } catch (error) {
        this.ctx.logger?.warn?.('valence: capture failed: ' + String(error))
      }
    }
  }

  /**
   * 去重参照面：现有的、非墓碑的火花。
   *
   * 读失败时返回空池（**不做去重**而不是不挖）——去重是防噪声，不该因为一次 IO
   * 抖动就把捕获整条掐掉；`capture` 自己的错误处理仍在下面兜底。
   */
  private async loadDedupPool(): Promise<ValenceDedupPool> {
    try {
      return buildDedupPool(await this.ctx.spark.list({ limit: 500 }))
    } catch (error) {
      this.ctx.logger?.warn?.('valence: dedup pool read failed, skipping dedup: ' + String(error))
      return { tokens: [], boilerplate: new Set<string>() }
    }
  }

  /** Test-only / introspection: current stats. */
  stats(): ValenceRunStats {
    return {
      intensityThreshold: this.config.intensityThreshold ?? 0,
      maxUtteranceChars: this.config.maxUtteranceChars ?? 0,
      persistEnabled: this.persistEnabled,
      ignoredInjected: this.ignoredInjected,
      highIntensitySeen: this.highIntensitySeen,
      duplicatesSkipped: this.duplicatesSkipped,
      sparksCaptured: this.sparksCaptured,
      lastSkipReason: this.lastSkipReason,
    }
  }

  /** Test-only: run the gate on a text without going through events. */
  async testMine(text: string): Promise<PreferenceCandidate[]> {
    return minePreferences(text, this.config).candidates
  }

  dispose(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  /** Reserved future fields. */
  private readonly _reserved: string = randomUUID()
}
