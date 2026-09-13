/**
 * spark-inbox —— 会话编排层（设计 §5）：火花的**回收回路**。
 *
 * 为什么需要它：在此之前 `spark_capture` 只写不读 —— 存进去的火花不会被注入、
 * 不会在下次会话提醒、不会进 todo，所以火花面板必然是坟场（实测真实环境 2 条、
 * 0 提议、0 脚本）。本模块在**会话首步**把收件箱状态告诉模型，让"存"有了下游。
 *
 * 与 hippomemo 的自动召回同构（同一个 `agent/pre-step` 中间件、同样的每 agent 一次
 * 去重、同样的 `<system-reminder>` 包裹），差异只在内容形态：
 *   - hippomemo：与当前查询**语义相关**的记忆（token Jaccard 召回）
 *   - spark-inbox：收件箱**计数 + 最近未处理条目**（不是召回，是状态通报）
 * 因此两者的提醒首行必须可区分，模型才分得清两类背景。
 *
 * 设计上的三条纪律：
 *   ① 计数为 0 时**不注入**（零噪音）；
 *   ② 每 agent 会话只注入一次；
 *   ③ 只用 `GET /sparks/stats` 同源的统计，不 list 全量再过滤（O(n) + 预算风险）。
 *
 * 未实现（设计 §5.3，B 档）：脏标记 + 惰性 reflect。挂载点就在本文件的 pre-step 里，
 * 但需要先有"距上次 reflect 的新增数"这个持久标记，故不在 A 档。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SparkStats, SparkView } from 'dsh-spark-wire'
import type {} from './spark-service.ts'
import type {} from './emerge-service.ts'

export const name = 'spark-inbox'
export const inject = ['agents', 'spark', 'emerge'] as const

export interface SparkInboxConfig {
  /** 关掉即回到"只写不读"（默认 true）。 */
  enabled?: boolean
  /** 注入文本的字符预算（含包裹标签）。默认 800。 */
  maxChars?: number
  /** 最多列出几条待处理火花。默认 3。 */
  maxItems?: number
}

export const Config: z<{ enabled: boolean; maxChars: number; maxItems: number }> = z.object({
  enabled: z.boolean().default(true),
  maxChars: z.number().step(1).min(120).default(800),
  maxItems: z.number().step(1).min(0).max(20).default(3),
})

export function apply(ctx: Context, config: SparkInboxConfig = {}): void {
  const enabled = config.enabled ?? true
  if (!enabled) return
  const maxChars = config.maxChars ?? 800
  const maxItems = config.maxItems ?? 3
  /** 每 agent 只注入一次（与 hippomemo 的 `injected` WeakSet 同构）。 */
  const injected = new WeakSet<object>()

  ctx.on('agent/pre-step', async ({ agent, step }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || step !== 1) return decision
    if (injected.has(agent)) return decision
    // 先占位再去取数据：取数失败也不该让同一个会话重复尝试（保持"每会话一次"的语义）。
    injected.add(agent)

    try {
      const stats = await ctx.spark.stats(await pendingProposalCount(ctx))
      if (stats.pending === 0 && stats.pendingProposals === 0) return decision
      const pending = maxItems === 0 ? [] : await ctx.spark.list({ inboxState: 'pending', limit: maxItems })
      const reminder = renderInboxReminder(stats, pending, maxChars)
      if (reminder === undefined) return decision
      return { kind: 'enter', messages: [...decision.messages, reminder] }
    } catch (error) {
      ctx.logger?.warn?.('spark-inbox: reminder skipped: ' + String(error))
      return decision
    }
  })
}

/** 待决提议数；emerge 不可用时按 0 处理（通报不该因为它的缺失而失败）。 */
async function pendingProposalCount(ctx: Context): Promise<number> {
  try {
    const all = await ctx.emerge.list()
    return all.filter(p => p.status === 'pending').length
  } catch {
    return 0
  }
}

/**
 * 渲染收件箱提醒（纯函数，可测）。
 *
 * 首行刻意与 hippomemo 的 "The following durable memories were retrieved…" 区分开，
 * 否则模型分不清"语义召回的记忆"和"待处理的状态通报"。
 *
 * @returns 注入消息；无法在预算内渲染出任何内容时返回 undefined（宁可不注入）。
 */
export function renderInboxReminder(
  stats: SparkStats,
  pending: readonly SparkView[],
  maxChars: number,
): UserMessage | undefined {
  const head = 'Spark inbox (dsh-spark): ' + String(stats.pending) + ' pending spark'
    + (stats.pending === 1 ? '' : 's')
    + (stats.pendingProposals > 0 ? ', ' + String(stats.pendingProposals) + ' pending emergence proposal'
      + (stats.pendingProposals === 1 ? '' : 's') : '')
    + '.'
  const hint = 'Sparks are raw inspirations waiting to be triaged. Promote one with spark_crystallize when it has matured, '
    + 'or leave it for the user to handle in the Spark panel (core button: the floating ball). '
    + 'This is a status notice, not an instruction.'

  const lines: string[] = []
  let budget = maxChars - head.length - hint.length - 64
  for (const spark of pending) {
    const line = '- <spark id="' + spark.id + '">' + spark.title + '</spark>'
    if (line.length > budget) break
    lines.push(line)
    budget -= line.length + 1
  }

  const body = [
    '<system-reminder>',
    head,
    hint,
    ...(lines.length > 0 ? ['', 'Most recent pending sparks:', ...lines] : []),
    '</system-reminder>',
  ].join('\n')

  if (body.length > maxChars + 64) return undefined

  return createUserMessage({
    content: [{ type: 'text', text: body }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: 'notice',
      summary: String(stats.pending) + ' pending spark' + (stats.pending === 1 ? '' : 's')
        + (stats.pendingProposals > 0 ? ', ' + String(stats.pendingProposals) + ' pending proposals' : ''),
    },
  })
}
