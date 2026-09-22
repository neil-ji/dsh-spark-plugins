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
 * 本模块同时承载三档改造的**编排**（每档的判定逻辑都是可单测的纯函数，放在各自模块里）：
 *   A（已落地）收件箱提醒        —— 本文件
 *   B 惰性涌现（§5.3）          —— `reflect-scheduler.ts`（脏标记判定）
 *   （C 档脚本建议已随脚本沉淀库迁出：现由独立插件 `dsh-script` 的注入层负责，
 *    见 docs/SCRIPT-LIBRARY-SPEC.md §5）
 *   D 命令失败挖掘（§5.5）      —— `command-mining.ts`（默认关）
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SparkStats, SparkView } from 'dsh-spark-wire'
import { shouldReflect } from './reflect-scheduler.ts'
import { observeSessionEvent, renderPitfallBriefing, selectPitfalls } from './command-mining.ts'
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
  /** B 档：惰性涌现（脏标记 + 会话首步触发，无定时器）。 */
  reflect?: { enabled?: boolean; threshold?: number; minIntervalMs?: number }
  /** D 档：命令失败挖掘（**默认关**，先在沙箱观察一轮再开）。 */
  commandMining?: { enabled?: boolean; minSessions?: number; maxPitfalls?: number; maxChars?: number }
}

export const Config: z<{
  enabled: boolean
  maxChars: number
  maxItems: number
  reflect: { enabled: boolean; threshold: number; minIntervalMs: number }
  commandMining: { enabled: boolean; minSessions: number; maxPitfalls: number; maxChars: number }
}> = z.object({
  enabled: z.boolean().default(true),
  maxChars: z.number().step(1).min(120).default(800),
  maxItems: z.number().step(1).min(0).max(20).default(3),
  reflect: z.object({
    enabled: z.boolean().default(true),
    threshold: z.number().step(1).min(0).default(3),
    minIntervalMs: z.number().step(1).min(0).default(300_000),
  }),
  commandMining: z.object({
    enabled: z.boolean().default(false),
    minSessions: z.number().step(1).min(2).max(10).default(2),
    maxPitfalls: z.number().step(1).min(1).max(5).default(3),
    maxChars: z.number().step(1).min(120).default(600),
  }),
})

export function apply(ctx: Context, config: SparkInboxConfig = {}): void {
  const enabled = config.enabled ?? true
  if (!enabled) return
  const maxChars = config.maxChars ?? 800
  const maxItems = config.maxItems ?? 3
  const reflectEnabled = config.reflect?.enabled ?? true
  const reflectThreshold = config.reflect?.threshold ?? 3
  const reflectMinIntervalMs = config.reflect?.minIntervalMs ?? 300_000
  const miningEnabled = config.commandMining?.enabled ?? false
  const miningMinSessions = config.commandMining?.minSessions ?? 2
  const miningMaxPitfalls = config.commandMining?.maxPitfalls ?? 3
  const miningMaxChars = config.commandMining?.maxChars ?? 600
  /** 每 agent 只注入一次（与 hippomemo 的 `injected` WeakSet 同构）。 */
  const injected = new WeakSet<object>()
  /** 进程内防重入：涌现正在跑就别再触发。 */
  let reflecting = false

  // D 档：命令失败采集走会话事件（`tool/call` / `tool/result` 是 session 日志里真实
  // append 的两类事件，见 dsh-agent-loop）。默认关时连订阅都不建。
  if (miningEnabled) {
    ctx.on('session/event', (session, event) => {
      void observeSessionEvent(ctx, session, event, { minSessions: miningMinSessions }).catch(error => {
        ctx.logger?.warn?.('spark-inbox: command mining failed: ' + String(error))
      })
    })
  }

  ctx.on('agent/pre-step', async ({ agent, messages, step }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || step !== 1) return decision
    if (injected.has(agent)) return decision
    // 先占位再去取数据：取数失败也不该让同一个会话重复尝试（保持"每会话一次"的语义）。
    injected.add(agent)

    try {
      const out = [...decision.messages]

      // A：收件箱状态通报（计数全为 0 时**也注入**，因为空状态
      //   是模型最容易把火花面板忘掉的时刻 —— 主动钩子的关键场景）。
      // 之前「0 不注入」的纪律是为零噪音，但实测下来空面板会直接
      // 进入"无事可做"状态，模型就再也不会调 spark_capture。
      // 2026-09-16 改为：始终注入；renderInboxReminder 内部按 stats 分支
      //   渲染 head / hint，仅 0+0+空无 hint 时返回 undefined。
      const stats = await ctx.spark.stats(await pendingProposalCount(ctx))
      const active = (stats.active > 0 && maxItems !== 0)
        ? await ctx.spark.list({ status: 'active', limit: maxItems })
        : []
      const reminder = renderInboxReminder(stats, active, maxChars)
      if (reminder !== undefined) out.push(reminder)

      // D：当前模型的已知命令坑（默认关；没有记录时不注入）。
      if (miningEnabled) {
        const pitfalls = await selectPitfalls(ctx, agent, miningMaxPitfalls)
        const briefing = renderPitfallBriefing(pitfalls, miningMaxChars)
        if (briefing !== undefined) out.push(briefing)
      }

      // B：惰性涌现（脏标记）。**不阻塞本步** —— 触发后立即返回，失败只记日志。
      if (reflectEnabled) {
        void triggerReflectIfDirty(ctx, reflectThreshold, reflectMinIntervalMs, () => reflecting, (value) => { reflecting = value })
          .catch(error => { ctx.logger?.warn?.('spark-inbox: lazy reflect failed: ' + String(error)) })
      }

      if (out.length === decision.messages.length) return decision
      return { kind: 'enter', messages: out }
    } catch (error) {
      ctx.logger?.warn?.('spark-inbox: reminder skipped: ' + String(error))
      return decision
    }
  })
}

/**
 * B 档：脏标记判定 + 后台跑一次涌现。
 *
 * 触发条件（纯函数 `shouldReflect`）：自上次成功涌现以来新增/变更的火花数 ≥ threshold，
 * 且距上次超过 `minIntervalMs`。跑完写回 `lastReflectAt`；失败不写回，下次首步自然重试。
 */
async function triggerReflectIfDirty(
  ctx: Context,
  threshold: number,
  minIntervalMs: number,
  isReflecting: () => boolean,
  setReflecting: (value: boolean) => void,
): Promise<void> {
  if (isReflecting()) return
  const meta = await ctx.spark.readMeta()
  const changedCount = await ctx.spark.countChangedSince(meta.lastReflectAt)
  const decision = shouldReflect({ changedCount, threshold, lastReflectAt: meta.lastReflectAt, now: Date.now(), minIntervalMs })
  if (!decision.run) return
  setReflecting(true)
  try {
    const result = await ctx.emerge.reflect({})
    await ctx.spark.updateMeta(current => ({ ...current, lastReflectAt: Date.now() }))
    ctx.logger?.info?.('spark-inbox: lazy reflect created ' + String(result.newProposals.length) + ' proposals (changed=' + String(changedCount) + ')')
  } finally {
    setReflecting(false)
  }
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
 * 渲染想法池通报（纯函数，可测）。
 *
 * 首行刻意与 hippomemo 的 "The following durable memories were retrieved…" 区分开，
 * 否则模型分不清"语义召回的记忆"和"火花池的状态通报"。
 *
 * @returns 注入消息；无法在预算内渲染出任何内容时返回 undefined（宁可不注入）。
 */
export function renderInboxReminder(
  stats: SparkStats,
  active: readonly SparkView[],
  maxChars: number,
): UserMessage | undefined {
  let head: string
  let hint: string
  if (stats.active > 0) {
    head = 'Sparks (dsh-spark): ' + String(stats.active) + ' active spark'
      + (stats.active === 1 ? '' : 's')
      + (stats.pendingProposals > 0 ? ', ' + String(stats.pendingProposals) + ' pending emergence proposal'
        + (stats.pendingProposals === 1 ? '' : 's') : '')
      + '.'
    hint = 'These are ideas from earlier sessions — related ones are background worth building on. If the current turn produced a new idea, propose it with spark_capture. This is a status notice, not an instruction.'
  } else if (stats.pendingProposals > 0) {
    head = 'Sparks (dsh-spark): no active sparks. ' + String(stats.pendingProposals) + ' pending emergence proposal'
      + (stats.pendingProposals === 1 ? '' : 's') + '.'
    hint = 'Emergence has surfaced ' + String(stats.pendingProposals) + ' pending proposal'
      + (stats.pendingProposals === 1 ? '' : 's')
      + '. If one of them matches something the user has now decided, call the corresponding resolve endpoint via the Spark panel — but only when the user has confirmed intent. This is a status notice, not an instruction.'
  } else {
    // 空 + 空：主动钩子（无 head 也能定位，仍用一行表明来源）
    head = 'Sparks (dsh-spark): no active sparks.'
    hint = 'The idea pool is empty. If the current turn produced a fleeting insight, an implicit assumption, or any "this might matter later" thought, propose it now with spark_capture(title, content, tags). Do not capture concrete actionable work — that goes through the regular task tool. This is a status notice, not an instruction.'
  }

  const lines: string[] = []
  let budget = maxChars - head.length - hint.length - 64
  for (const spark of active) {
    const line = '- <spark id="' + spark.id + '">' + spark.title + '</spark>'
    if (line.length > budget) break
    lines.push(line)
    budget -= line.length + 1
  }

  const body = [
    '<system-reminder>',
    head,
    hint,
    ...(lines.length > 0 ? ['', 'Most recent active sparks:', ...lines] : []),
    '</system-reminder>',
  ].join('\n')

  if (body.length > maxChars + 64) return undefined

  return createUserMessage({
    content: [{ type: 'text', text: body }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: 'notice',
      summary: String(stats.active) + ' active spark' + (stats.active === 1 ? '' : 's')
        + (stats.pendingProposals > 0 ? ', ' + String(stats.pendingProposals) + ' pending proposals' : ''),
    },
  })
}
