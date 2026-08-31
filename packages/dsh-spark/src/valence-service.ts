/**
 * Phase 6 ValenceService: amygdala-like emotional signal mining.
 *
 * Subscribes to DSH session events (user messages). When a message crosses
 * the intensity threshold, extracts latent preferences and persists them
 * as HippoMemo kind='preference' records (via ctx.memory.put).
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
  candidateToHippoPreference,
  type PreferenceCandidate,
  type HippoPreferenceInput,
} from './valence.ts'

/** Minimal structural type for the HippoMemo service (matches Phase 2). */
interface HippoService {
  put(input: HippoPreferenceInput): Promise<{ id: string }>
}

export interface ValenceConfig {
  /** Minimum intensity to trigger extraction. 0..1. Default 0.4. */
  intensityThreshold?: number
  /** If true, persist extracted preferences via ctx.memory.put. Default true. */
  persistEnabled?: boolean
}

export interface ValenceRunStats {
  intensityThreshold: number
  persistEnabled: boolean
  /** How many messages were observed above the intensity threshold. */
  highIntensitySeen: number
  /** How many preference records were persisted. */
  preferencesPersisted: number
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
  static inject = ['spark', 'memory'] as const

  private readonly intensityThreshold: number
  private readonly persistEnabled: boolean
  private highIntensitySeen = 0
  private preferencesPersisted = 0
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
    const memory = (this.ctx as unknown as { memory?: HippoService }).memory
    if (memory === undefined) return  // Hippo not installed; skip silently
    const spark = (this.ctx as unknown as { spark?: { get: (id: string) => Promise<unknown> } }).spark
    let workspacePath: string | null = null
    if (spark !== undefined) {
      try {
        // We don't have the session ref here; workspacePath stays null.
        // Phase 6.5: thread the session through ctx.on.
      } catch (_error) {
        // ignore
      }
    }
    for (const candidate of candidates) {
      const input = candidateToHippoPreference(candidate, workspacePath)
      try {
        await memory.put(input)
        this.preferencesPersisted += 1
      } catch (error) {
        this.ctx.logger?.warn?.('valence: persist failed: ' + String(error))
      }
    }
  }

  /** Test-only / introspection: current stats. */
  stats(): ValenceRunStats {
    return {
      intensityThreshold: this.intensityThreshold,
      persistEnabled: this.persistEnabled,
      highIntensitySeen: this.highIntensitySeen,
      preferencesPersisted: this.preferencesPersisted,
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
