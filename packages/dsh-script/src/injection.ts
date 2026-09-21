/**
 * 目录注入与主动建议（Spec §5）—— 宿主在 `agent/pre-step` 里给模型的"脚本库可见面"。
 *
 * 四件事（INV-4/5/6）：
 *   1. **per-agent 门控**：只有本插件注册的 `script_list` 工具对该 agent 可见时才注入；
 *   2. **指纹去重**：`(name, description)` 集合的 sha256 不变则不重复注入；
 *   3. **状态耐久**：指纹与已建议集合存 sidecar（宿主重启/会话恢复不重复发布）；
 *   4. **替换帧**：目录变化时明确告知"这份清单取代此前所有清单"。
 *
 * 另保留 triggers 主动建议（Spec §5.1 第 2 条）：最近工具调用命中某条脚本的 triggers 时
 * 建议"用现成的"，建议式、不拦截。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
// PreStepDecision 是平台 `agent/pre-step` 中间件的返回类型（与 spark/hippomemo 同一入口）。
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ScriptView } from 'dsh-script-wire'
import type { ScriptService } from './script-service.ts'
import { ScriptService as Service } from './script-service.ts'
import { collectRecentCalls, matchScripts, renderScriptSuggestion } from './script-match.ts'
import { catalogDigest, pruneInjectState, type CatalogEntry, type InjectStateStore } from './inject-state.ts'

/** 注入配置（cordis.patch.yml 的 `config.injection`）。 */
export interface InjectionConfig {
  enabled?: boolean
  /** 目录最多列多少条（超出部分只在 `script_list` 检索里可见）。 */
  maxItems?: number
  /** 一条注入消息的字符预算。 */
  maxChars?: number
  /** 目录行里描述的最大长度（折叠空白后截断）。 */
  catalogDescriptionMaxLength?: number
  suggest?: {
    enabled?: boolean
    maxRecentCalls?: number
    maxChars?: number
  }
}

export interface InjectionDeps {
  readonly service: ScriptService
  readonly stateStore: InjectStateStore
  /** 本插件注册的 `script_list` 工具对象（用于 per-agent 可见性门控）。 */
  readonly listTool: unknown
  readonly pluginName: string
  readonly listToolName: string
  readonly invokeToolName: string
}

/** 折叠空白并按上限截断（与平台目录行的处理同构）。 */
export function truncateDescription(value: string, maxLength: number): string {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
}

/** 目录帧文本（首帧 = 完整清单；后续 = 替换帧）。 */
export function renderCatalogText(
  entries: readonly CatalogEntry[],
  options: { readonly pluginName: string; readonly listToolName: string; readonly update: boolean },
): string {
  const lines = entries.map(entry => `- \`${entry.name}\`: ${entry.description}`)
  const open = options.update
    ? 'The script catalog changed. This complete list replaces every earlier script catalog in this session:'
    : 'A script library is available in this session:'
  const guidance = entries.length === 0
    ? [`No scripts are available. Do not use names from earlier script catalogs.`]
    : [
        `Use only names in this list. When the current task clearly matches one, call ${options.listToolName} or the invoke tool with its exact name/id before writing the steps yourself.`,
        'This catalog contains summaries only; the full steps come from the invoke tool.',
      ]
  return [
    '<system-reminder>',
    ...(options.pluginName.length > 0 ? [`Script library (${options.pluginName}).`] : []),
    open,
    '',
    '<available_scripts>',
    ...lines,
    '</available_scripts>',
    '',
    ...guidance,
    '</system-reminder>',
  ].join('\n')
}

/** 目录消息（预算装不下时返回 undefined）。 */
export function renderCatalogMessage(
  entries: readonly CatalogEntry[],
  options: { readonly pluginName: string; readonly listToolName: string; readonly update: boolean; readonly maxChars: number },
): UserMessage | undefined {
  const text = renderCatalogText(entries, options)
  if (text.length > options.maxChars + 64) return undefined
  return createUserMessage({
    content: [{ type: 'text', text }],
    // 只能用平台白名单内的 kind（Spec INV-3）：自造 kind 会被会话格式迁移拒绝。
    source: {
      kind: 'plugin',
      plugin: options.pluginName,
      form: 'catalog',
      summary: String(entries.length) + ' script' + (entries.length === 1 ? '' : 's') + ' available',
    },
  })
}

/**
 * 注册注入中间件。
 * @param ctx - 宿主上下文。
 * @param config - 注入配置。
 * @param deps - 服务、状态 store 与工具门控依赖。
 */
export function registerScriptInjection(ctx: Context, config: InjectionConfig, deps: InjectionDeps): void {
  const enabled = config.enabled ?? true
  if (!enabled) return
  const maxItems = config.maxItems ?? 50
  const maxChars = config.maxChars ?? 1200
  const descriptionMax = config.catalogDescriptionMaxLength ?? 200
  const suggestEnabled = config.suggest?.enabled ?? true
  const maxRecentCalls = config.suggest?.maxRecentCalls ?? 8
  const suggestMaxChars = config.suggest?.maxChars ?? 600

  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    try {
      const sessionId = typeof agent.session.id === 'string' ? agent.session.id : ''
      if (sessionId.length === 0) return decision
      const cwd = agent.session.header.cwd
      const now = Date.now()
      const state = await deps.stateStore.read()
      const entry = state[sessionId]
      const out: UserMessage[] = [...decision.messages]
      let dirty = false

      // ① 目录帧（门控 → 可见集 → 指纹）
      const toolVisible = ctx.tools.get(deps.listToolName, agent) === deps.listTool
      if (toolVisible) {
        const visible = await deps.service.listVisible(cwd, now)
        const entries: CatalogEntry[] = visible
          .slice(0, maxItems)
          .map(record => ({ name: record.name, description: truncateDescription(record.description, descriptionMax) }))
        const digest = catalogDigest(entries)
        if (digest !== entry?.digest) {
          const catalog = renderCatalogMessage(entries, {
            pluginName: deps.pluginName,
            listToolName: deps.listToolName,
            update: entry !== undefined,
            maxChars,
          })
          if (catalog !== undefined) {
            out.push(catalog)
            state[sessionId] = {
              digest,
              publishedAt: now,
              agentId: typeof agent.id === 'string' ? agent.id : null,
              suggested: entry?.suggested ?? [],
            }
            dirty = true
          }
        }
      } else if (entry !== undefined) {
        // 工具对这个 agent 不可见（被限制/被同名遮蔽）→ 撤下目录，且不再重复发布。
        const catalog = renderCatalogMessage([], {
          pluginName: deps.pluginName,
          listToolName: deps.listToolName,
          update: true,
          maxChars,
        })
        if (catalog !== undefined) out.push(catalog)
        delete state[sessionId]
        dirty = true
      }

      // ② 主动建议帧（triggers 命中最近工具调用）
      if (suggestEnabled) {
        const records: ScriptView[] = await deps.service.listVisibleRecords(cwd, now)
        const match = matchScripts(collectRecentCalls(messages, maxRecentCalls), records)
        const already = state[sessionId]?.suggested ?? []
        if (match !== undefined && !already.includes(match.script.id)) {
          const suggestion = renderScriptSuggestion(
            match,
            suggestMaxChars,
            deps.pluginName,
            deps.invokeToolName,
            Service.successRate(match.script),
          )
          if (suggestion !== undefined) {
            out.push(suggestion)
            const base = state[sessionId] ?? { digest: '', publishedAt: now, agentId: null, suggested: [] }
            state[sessionId] = { ...base, suggested: [...already, match.script.id] }
            dirty = true
          }
        }
      }

      if (dirty) await deps.stateStore.write(pruneInjectState(state))
      if (out.length === decision.messages.length) return decision
      return { kind: 'enter', messages: out }
    } catch (error) {
      ctx.logger?.warn?.('dsh-script: injection skipped: ' + String(error))
      return decision
    }
  })
}
