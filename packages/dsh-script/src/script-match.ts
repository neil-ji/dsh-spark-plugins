/**
 * 程序性匹配（设计 §5.4，C 档）—— 让 `scripts.triggers` 第一次真的有消费者。
 *
 * 背景：`triggers` 字段从 Phase 5 起就存在（wire 里也标着 "Phase 5.5: tool auto-suggest"），
 * 但**从来没有任何代码读过它** —— 脚本存了没人调用，和火花一样是"只写不读"。
 * 本模块把"最近工具调用序列"与 `triggers` 做模式匹配，命中就建议**用现成的**而不是重写。
 *
 * 纯函数（除最后的渲染），便于单测；注入时机由 `inbox.ts` 的 pre-step 决定。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { ScriptView } from 'dsh-script-wire'

export interface RecentToolCall {
  name: string
  /** 参数的字符串形态（原样字符串或 JSON.stringify 的结果）。 */
  args: string
}

export interface ScriptMatch {
  script: ScriptView
  score: number
  hits: string[]
}

/** 参数在不同 provider 下可能是字符串或对象；统一成小写字符串供匹配。 */
export function stringifyArgs(args: unknown): string {
  if (typeof args === 'string') return args
  if (args === null || args === undefined) return ''
  try {
    return JSON.stringify(args)
  } catch {
    return ''
  }
}

/**
 * 从消息序列里收集**最近的**工具调用（由近及远，最多 `maxCalls` 条），
 * 返回时按时间正序（旧 → 新），方便调用方按顺序展示。
 *
 * 只认 `type === 'tool-call'` 的块（dsh-llm 的装配形状：`{ type, id, name, arguments }`）。
 */
export function collectRecentCalls(messages: readonly unknown[], maxCalls: number): RecentToolCall[] {
  if (maxCalls <= 0) return []
  const found: RecentToolCall[] = []
  for (let index = messages.length - 1; index >= 0 && found.length < maxCalls; index -= 1) {
    const message = messages[index]
    if (message === null || typeof message !== 'object') continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (let blockIndex = content.length - 1; blockIndex >= 0 && found.length < maxCalls; blockIndex -= 1) {
      const block = content[blockIndex]
      if (block === null || typeof block !== 'object') continue
      const candidate = block as { type?: unknown; name?: unknown; arguments?: unknown }
      if (candidate.type !== 'tool-call') continue
      if (typeof candidate.name !== 'string' || candidate.name.length === 0) continue
      found.push({ name: candidate.name, args: stringifyArgs(candidate.arguments) })
    }
  }
  return found.reverse()
}

/**
 * 匹配最近工具序列与脚本的 `triggers`（大小写不敏感的**子串**匹配）。
 *
 * 打分 = 命中的 trigger 条数；同分时依次比较 successRate、trigger 总长度（更具体的优先）。
 * 必须要至少命中 1 条才返回 —— 宁可不建议，也不要推荐不相干的脚本。
 */
export function matchScripts(calls: readonly RecentToolCall[], scripts: readonly ScriptView[]): ScriptMatch | undefined {
  if (calls.length === 0) return undefined
  const haystack = calls.map(call => (call.name + ' ' + call.args).toLowerCase())
  let best: ScriptMatch | undefined
  for (const script of scripts) {
    if (script.triggers.length === 0) continue
    const hits = script.triggers.filter(trigger => {
      const needle = trigger.trim().toLowerCase()
      return needle.length > 0 && haystack.some(text => text.includes(needle))
    })
    if (hits.length === 0) continue
    const score = hits.length
    const candidate: ScriptMatch = { script, score, hits }
    if (best === undefined) { best = candidate; continue }
    if (score !== best.score) { if (score > best.score) best = candidate; continue }
    const rate = (s: ScriptView): number => (s.invocationCount > 0 ? s.successCount / s.invocationCount : 0)
    if (rate(script) !== rate(best.script)) { if (rate(script) > rate(best.script)) best = candidate; continue }
    const specificity = (s: ScriptView): number => s.triggers.join('').length
    if (specificity(script) > specificity(best.script)) best = candidate
  }
  return best
}

/**
 * 渲染"有现成脚本"的**建议**（不是指令 —— 设计 §2.3：一律建议式，绝不拦截）。
 * @returns 注入消息；预算装不下时返回 undefined（宁可不注入）。
 */
export function renderScriptSuggestion(
  match: ScriptMatch,
  maxChars: number,
  pluginName = 'dsh-script',
  invokeToolName = 'script_invoke',
  successRate = 0,
): UserMessage | undefined {
  const script = match.script
  // 成功率口径单源（Spec INV-7）：由 ScriptService.successRate 算好后传入，这里只渲染。
  const rate = script.invocationCount > 0
    ? ' — success rate ' + String(Math.round(successRate * 100)) + '% over '
      + String(script.invocationCount) + ' invocation' + (script.invocationCount === 1 ? '' : 's')
    : ''
  const text = [
    '<system-reminder>',
    'Script catalog match (dsh-script): a stored procedure already covers what you are about to do.',
    '- script: "' + script.name + '" — ' + script.description,
    '- matched triggers: ' + match.hits.join(', '),
    '- steps: ' + String(script.steps.length) + rate,
    'Call ' + invokeToolName + ' with id "' + script.id + '" to get the ordered steps instead of rewriting them from scratch.',
    'This is a suggestion, not an instruction: ignore it if the current task is genuinely different.',
    '</system-reminder>',
  ].join('\n')
  if (text.length > maxChars + 64) return undefined
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: pluginName, form: 'notice', summary: 'script match: ' + script.name },
  })
}
