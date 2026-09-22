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
 */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  detectIntensity,
  extractPreferences,
  candidateToSparkInput,
  type PreferenceCandidate,
} from './valence.ts'

export interface ValenceConfig {
  /** Minimum intensity to trigger extraction. 0..1. Default 0.4. */
  intensityThreshold?: number
  /** If true, capture extracted preferences as sparks. Default true. */
  persistEnabled?: boolean
}

export interface ValenceRunStats {
  intensityThreshold: number
  persistEnabled: boolean
  /** How many messages were observed above the intensity threshold. */
  highIntensitySeen: number
  /** How many preference sparks were captured. */
  sparksCaptured: number
}

interface AssistantLike { type: string; content: unknown }
// The DSH session event payload wraps a UserMessage whose  is the block array.
interface UserMessageEvent {
  type: 'user/message'
  data: { content: AssistantLike[] }
}

/** Extract plain text from a message.content array. */
function extractText(content: readonly AssistantLike[]): string {
  const out: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      out.push(((block as unknown as { text: string }).text))
    }
  }
  return out.join(' ').trim()
}

export class ValenceService extends Service {
  static inject = ['spark'] as const

  private readonly intensityThreshold: number
  private readonly persistEnabled: boolean
  private highIntensitySeen = 0
  private sparksCaptured = 0
  private unsubscribe: (() => void) | null = null

  constructor(ctx: Context, config: ValenceConfig = {}) {
    super(ctx, 'valence')
    this.intensityThreshold = config.intensityThreshold ?? 0.4
    this.persistEnabled = config.persistEnabled ?? true
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
    const text = extractText(event.data.content)
    if (text.length === 0) return
    const intensity = detectIntensity(text)
    if (intensity < this.intensityThreshold) return
    this.highIntensitySeen += 1
    const candidates = extractPreferences(text)
    if (candidates.length === 0) return
    if (!this.persistEnabled) return
    for (const candidate of candidates) {
      const input = candidateToSparkInput(candidate, null)
      try {
        await this.ctx.spark.capture(input)
        this.sparksCaptured += 1
      } catch (error) {
        this.ctx.logger?.warn?.('valence: capture failed: ' + String(error))
      }
    }
  }

  /** Test-only / introspection: current stats. */
  stats(): ValenceRunStats {
    return {
      intensityThreshold: this.intensityThreshold,
      persistEnabled: this.persistEnabled,
      highIntensitySeen: this.highIntensitySeen,
      sparksCaptured: this.sparksCaptured,
    }
  }

  /** Test-only: run heuristics on a text without going through events. */
  async testMine(text: string): Promise<PreferenceCandidate[]> {
    const intensity = detectIntensity(text)
    if (intensity < this.intensityThreshold) return []
    return extractPreferences(text)
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
