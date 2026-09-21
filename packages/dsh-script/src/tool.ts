/**
 * agent 可见的四个脚本工具（Spec §3.1）。
 *
 * 命名去掉了 `spark_` 前缀：后两个工具与火花毫无关系（沉淀库独立成型后，
 * 前缀只会误导）。写入口只有一个 `script_save`，判重与校验在服务里（单一口径）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from './types.ts'
import { ScriptService } from './script-service.ts'

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const GUIDANCE = [
  'The script library stores reusable multi-step procedures (structured steps: instruction | tool-call).',
  'After finishing a multi-step procedure that will be needed again, persist it with script_save — write steps that are executable, not vague ("run pnpm check:all", not "verify things").',
  'Before writing multi-step commands from scratch, call script_list (or read the script catalog when it appears) to check whether a stored procedure already covers the task; script_invoke returns its full steps. script_list matches name, description, tags, triggers and searchTerms.',
  'Always close the loop with script_result(id, success) after invoking a script, so the catalog success rate stays honest.',
  'Default scope is "workspace" (bound to the current cwd). Use "global" only for procedures that are genuinely workspace-independent, and "project" for procedures tied to the project root.',
].join('\n')

export interface RegisteredScriptTools {
  readonly saveTool: ReturnType<typeof defineTool>
  readonly listTool: ReturnType<typeof defineTool>
  readonly invokeTool: ReturnType<typeof defineTool>
  readonly resultTool: ReturnType<typeof defineTool>
}

/** 注册工具并返回工具对象（注入层需要 `listTool` 做 per-agent 可见性门控）。 */
export function registerScriptTools(ctx: Context): RegisteredScriptTools {
  ctx.systemPrompt.section({ name: 'tool:script', order: 118, text: GUIDANCE })

  const saveTool = defineTool({
    name: 'script_save',
    description: 'Persist a reusable multi-step procedure into the script library. Steps are structured: kind=instruction is a directive for the model, kind=tool-call is a tool name or command. Writes are validated (no vague steps) and deduplicated (same name, or same steps with overlapping triggers) — a duplicate returns the existing script id instead of creating a second copy.',
    parameters: {
      name: { type: 'string', required: true, description: 'Short script name.' },
      description: { type: 'string', required: true, description: 'One sentence: what this procedure does AND when to use it (the catalog shows only this line, so put the trigger conditions here).' },
      steps: { type: 'string', required: true, description: 'JSON array: [{"kind":"instruction"|"tool-call","payload":"...","note":"optional"}]. 1-50 steps.' },
      triggers: { type: 'string', description: 'Comma-separated patterns matched against recent tool calls for proactive suggestions.' },
      tags: { type: 'string', description: 'Comma-separated retrieval keywords.' },
      searchTerms: { type: 'string', description: 'Comma-separated bilingual/synonym keywords that help a Chinese or English query find this script later (searched with the same weight as tags). Supply them when you already know the other-language terms; the host also enriches empty ones in the background.' },
      scope: { type: 'string', enum: ['global', 'workspace', 'project'], description: 'Defaults to workspace (bound to this cwd).' },
      expiresAt: { type: 'number', description: 'Optional absolute epoch ms after which the script is no longer injected.' },
      supersedes: { type: 'string', description: 'Optional id of the script this revision replaces (it becomes status=superseded).' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      let steps: unknown
      try {
        steps = JSON.parse(args.steps)
      } catch (error) {
        throw new HarnessError('script_save: steps must be valid JSON: ' + String(error), 'SCRIPT_STEPS_INVALID')
      }
      const split = (value: unknown): string[] => typeof value === 'string' && value.length > 0
        ? value.split(',').map(part => part.trim()).filter(part => part.length > 0)
        : []
      const agent = exec.agent
      const result = await ctx.script.save({
        name: args.name,
        description: args.description,
        steps,
        triggers: split(args.triggers),
        tags: split(args.tags),
        ...(split(args.searchTerms).length > 0 ? { searchTerms: split(args.searchTerms) } : {}),
        scope: args.scope ?? 'workspace',
        workspacePath: agent?.session.header.cwd ?? null,
        expiresAt: typeof args.expiresAt === 'number' ? args.expiresAt : null,
        supersedes: typeof args.supersedes === 'string' && args.supersedes.length > 0 ? args.supersedes : null,
        sourceSessionId: agent?.session.id ?? null,
        sourceAgentId: agent?.id ?? null,
        sourceTurn: null,
      }, {
        updatedBy: 'agent',
        workspacePath: agent?.session.header.cwd ?? null,
      })
      if (result.kind === 'invalid') throw new HarnessError('script_save rejected: ' + result.problems.join('; '), 'SCRIPT_INVALID')
      if (result.kind === 'duplicate') {
        return JSON.stringify({ duplicateOf: result.existing.id, name: result.existing.name, note: 'already stored; use script_invoke with that id' })
      }
      return JSON.stringify({ scriptId: result.record.id, name: result.record.name, stepCount: result.record.steps.length, scope: result.record.scope })
    },
    presentCall(args) { return { card: 'generic', title: 'Save script', kind: 'other', rawInput: args.name } },
  })

  const listTool = defineTool({
    name: 'script_list',
    description: 'Search the script library (name / description / tags / triggers). Returns compact summaries without the full steps — call script_invoke with an id to load the steps.',
    parameters: {
      q: { type: 'string', description: 'Case-insensitive substring matched against name, description, tags and triggers.' },
      scope: { type: 'string', enum: ['global', 'workspace', 'project'], description: 'Filter by scope.' },
      status: { type: 'string', enum: ['active', 'archived', 'superseded', 'candidate'], description: 'Filter by lifecycle status (default: all).' },
      tag: { type: 'string', description: 'Filter by exact tag.' },
      limit: { type: 'number', description: 'Max entries (default 20).' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const query: Record<string, unknown> = { limit: typeof args.limit === 'number' ? args.limit : 20 }
      if (typeof args.q === 'string') query.q = args.q
      if (typeof args.scope === 'string') query.scope = args.scope
      if (typeof args.status === 'string') query.status = args.status
      if (typeof args.tag === 'string') query.tag = args.tag
      const records = await ctx.script.list(query)
      return JSON.stringify({
        count: records.length,
        scripts: records.map(record => ({
          id: record.id,
          name: record.name,
          description: record.description,
          stepCount: record.steps.length,
          triggers: record.triggers,
          tags: record.tags,
          scope: record.scope,
          status: record.status,
          invocationCount: record.invocationCount,
          successRate: ScriptService.successRate(record),
        })),
      })
    },
    presentCall(args) { return { card: 'generic', title: 'List scripts', kind: 'read', rawInput: args.q ?? '(all)' } },
  })

  const invokeTool = defineTool({
    name: 'script_invoke',
    description: 'Load a stored procedure: returns its ordered steps for you to execute. Records the invocation, so follow up with script_result(id, success) when done.',
    parameters: {
      id: { type: 'string', required: true, description: 'The script id from script_list or the catalog.' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      // 带上 session cwd 作为调用证据（`invokedWorkspaces`）：降级作用域建议的唯一病据（Spec §6.2）。
      const result = await ctx.script.invoke(args.id, Date.now(), exec.agent?.session.header.cwd ?? null)
      return JSON.stringify({
        scriptId: result.script.id,
        name: result.script.name,
        description: result.script.description,
        steps: result.script.steps,
        priorSuccessRate: result.successRate,
        invocationCount: result.script.invocationCount,
      })
    },
    presentCall(args) { return { card: 'generic', title: 'Invoke script', kind: 'read', rawInput: args.id } },
  })

  const resultTool = defineTool({
    name: 'script_result',
    description: 'Record the outcome of a previously invoked script so the catalog success rate stays accurate.',
    parameters: {
      id: { type: 'string', required: true, description: 'The script id that was invoked.' },
      success: { type: 'boolean', required: true, description: 'true if all steps succeeded, false otherwise.' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const updated = await ctx.script.recordResult(args.id, args.success === true)
      if (updated === null) throw new HarnessError('script_result: unknown script id: ' + args.id, 'SCRIPT_NOT_FOUND')
      return JSON.stringify({
        scriptId: updated.id,
        successCount: updated.successCount,
        failureCount: updated.failureCount,
        invocationCount: updated.invocationCount,
        successRate: ScriptService.successRate(updated),
      })
    },
    presentCall(args) { return { card: 'generic', title: 'Record script result', kind: 'other', rawInput: args.id } },
  })

  return { saveTool, listTool, invokeTool, resultTool }
}
