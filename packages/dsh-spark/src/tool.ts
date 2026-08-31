/**
 * Agent-facing spark tools (Phase 1: just spark_capture).
 *
 * registerSparkTools is invoked from src/index.ts apply() right after the
 * SparkService is mounted. The tool delegates to ctx.spark for persistence.
 */
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from './spark-service.ts'

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const GUIDANCE = [
  'Use spark_capture to persist an inspiration, sudden association, or TODO-adjacent thought that just surfaced mid-conversation.',
  'Sparks are episodic (time-stamped, tied to the current session/workspace). They are NOT todos; do not capture concrete tasks with spark_capture — use the regular task tool for that.',
  'Sparks are NOT durable cross-session memory; do not capture finished conclusions here — use memory_remember (hippo) for that. Crystallize (Phase 2) will be the explicit bridge when the user wants a spark to graduate.',
  'Keep titles short (<= 60 chars). Content can be longer (full sentence or two). Tags are optional keywords.',
  'Default scope is "project" (bound to the current workspace). Use "session" for truly ephemeral, "global" only when the inspiration clearly crosses project boundaries.',
].join('\n')

export function registerSparkTools(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:spark',
    order: 116,
    text: GUIDANCE,
  })

  ctx.tools.register(defineTool({
    name: 'spark_capture',
    description: 'Persist one spark (free-form inspiration captured mid-conversation). Sparks are episodic memory: time-stamped, scoped to the session/project, never auto-promoted to a todo or to durable memory. Use this when you (the agent) or the user wants to remember a thought, association, or hunch that just surfaced, without turning it into an immediate task.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short title (<= 60 chars). Auto-derived from content if omitted.' },
      content: { type: 'string', required: true, description: 'The full thought. Can be a sentence or two.' },
      tags: { type: 'string', description: 'Comma-separated tags for later filtering.' },
      scope: { type: 'string', enum: ['session', 'project', 'global'], description: 'Defaults to project.' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new HarnessError('spark_capture requires a calling agent', 'SPARK_AGENT_REQUIRED')
      }
      const sessionId = agent.session.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new HarnessError('spark_capture requires a valid session id', 'SPARK_SESSION_REQUIRED')
      }
      const tags = typeof args.tags === 'string' && args.tags.length > 0
        ? args.tags.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : []
      const record = await ctx.spark.capture({
        title: args.title,
        content: args.content,
        scope: args.scope ?? 'project',
        tags,
        workspacePath: agent.session.header.cwd ?? null,
        sourceSessionId: sessionId,
        sourceAgentId: agent.id ?? null,
        sourceTurn: null,
      })
      return JSON.stringify(record)
    },
    presentCall(args) {
      return { card: 'generic', title: 'Capture spark', kind: 'other', rawInput: args.title }
    },
  }))
}
