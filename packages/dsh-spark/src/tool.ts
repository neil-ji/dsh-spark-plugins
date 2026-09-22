/**
 * Agent-facing spark tools.
 *
 * spark_capture（提出想法）与 spark_reflect（整理类涌现）。
 * v2（docs/spark-v2-design-2026-09-21.md §4.7，P16）：火花是想法，不是任何东西的草稿；
 * spark → memory 的直连已删——火花值得成为信念时，Agent 自己调 hippomemo 的
 * memory_remember（该工具已存在，不加包装）。
 *
 * 2026-09-21：脚本三件套（spark_to_script / spark_invoke_script /
 * spark_record_script_result）随脚本沉淀库迁出到独立插件 `dsh-script`
 * （见 docs/SCRIPT-LIBRARY-SPEC.md）。
 *
 * registerSparkTools is invoked from src/index.ts apply() right after the
 * SparkService is mounted.
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
  'Sparks are ideas — not drafts of anything else. The spark store is where an idea stays alive until it is useful. Treat proposing ideas as a first-class contribution.',
  'spark_capture: propose an idea. Do this when the user asks for ideas, and when you notice the current conversation could branch somewhere it has not gone yet. This is not a logging duty.',
  'Ideas beget ideas: use spark_search to find related sparks, then capture the combination; spark_derive runs a whole round of recombination when you want new ideas from the pool at once. Association, analogy and recombination across distant sparks are explicitly wanted.',
  'Prefer association over summary. A spark that merely restates an existing spark is noise.',
  'Do NOT capture concrete actionable work — that goes through the regular task tool.',
  'Keep titles short (<= 60 chars). Content can be longer (full sentence or two). Tags are optional keywords.',
  'Default scope is "project" (bound to the current workspace). Use "session" for truly ephemeral, "global" only when the idea clearly crosses project boundaries.',
].join('\n')

export function registerSparkTools(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:spark',
    order: 116,
    text: GUIDANCE,
  })

  ctx.tools.register(defineTool({
    name: 'spark_capture',
    description: 'Propose one idea (free-form inspiration, association, or hunch that surfaced mid-conversation). The spark store is where an idea stays alive until it is useful — it is not a todo list and not durable memory. Use this when you (the agent) or the user wants an idea kept, without turning it into an immediate task.',
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

  // Phase 4: spark_reflect — DMN-style trigger of rule-based emergence.
  // Phase 4.5 will layer LLM-backed proposals on top.
  ctx.tools.register(defineTool({
    name: 'spark_search',
    description: 'Search the idea pool for sparks related to a query (token Jaccard over title/content/tags; active sparks only). Use it before proposing an idea that may already exist, and to find distant sparks worth recombining.',
    parameters: {
      query: { type: 'string', required: true, description: 'What to look for (a phrase, not a boolean query).' },
      limit: { type: 'number', description: 'Max results. Defaults to 5.' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (query.length === 0) {
        throw new HarnessError('spark_search requires a query', 'SPARK_QUERY_REQUIRED')
      }
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 5
      const found = await ctx.spark.search(query, limit)
      return JSON.stringify(found)
    },
    presentCall(args) {
      return { card: 'generic', title: 'Search sparks', kind: 'other', rawInput: args.query }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'spark_derive',
    description: 'Run one round of idea derivation: recombine existing sparks into NEW ideas (association, analogy, recombination) and store them as derived sparks. Requires a model route; if none is available the round is skipped instead of failing. Restatements of existing ideas are rejected.',
    parameters: {
      seedId: { type: 'string', description: 'Only derive from this spark (its mid-range partners). Omit to pick pairs across the whole pool.' },
      maxPairs: { type: 'number', description: 'Cap on candidate pairs sent to the model. Defaults to 8.' },
      maxResults: { type: 'number', description: 'Max new ideas this round. Defaults to 3.' },
      dryRun: { type: 'boolean', description: 'Only pick candidate pairs (no model call). Useful to check that a round would have material.' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const opts: Record<string, unknown> = {}
      if (typeof args.seedId === 'string' && args.seedId.trim().length > 0) opts.seedId = args.seedId.trim()
      if (typeof args.maxPairs === 'number') opts.maxPairs = Math.floor(args.maxPairs)
      if (typeof args.maxResults === 'number') opts.maxResults = Math.floor(args.maxResults)
      if (args.dryRun === true) opts.dryRun = true
      return JSON.stringify(await ctx.derive.run(opts))
    },
    presentCall() {
      return { card: 'generic', title: 'Derive sparks', kind: 'other', rawInput: 'derivation' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'spark_reflect',
    description: 'Run the emergence engine over the active spark set. Returns new proposals persisted to the proposals inbox. Use this when you (the agent) or the user want to surface cross-spark associations, themes, or stale items to clean up. Phase 4 MVP is rule-based (title-token Jaccard for links, shared-tag clustering, staleness for prune); Phase 4.5 will add LLM-backed semantic and contradict proposals.',
    parameters: {
      candidateLimit: { type: 'number', description: 'Cap on candidate sparks to consider. Defaults to 30.' },
      linkThreshold: { type: 'number', description: 'Min title-token Jaccard for link proposals. 0..1. Defaults to 0.5.' },
      clusterMinSharedTags: { type: 'number', description: 'Min shared tags for cluster proposals. Defaults to 2.' },
      pruneStaleDays: { type: 'number', description: 'Days untouched for prune proposals. Defaults to 14.' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const opts: Record<string, unknown> = {}
      if (typeof args.candidateLimit === 'number') opts.candidateLimit = args.candidateLimit
      if (typeof args.linkThreshold === 'number') opts.linkThreshold = args.linkThreshold
      if (typeof args.clusterMinSharedTags === 'number') opts.clusterMinSharedTags = args.clusterMinSharedTags
      if (typeof args.pruneStaleDays === 'number') opts.pruneStaleDays = args.pruneStaleDays
      const result = await ctx.emerge.reflect(opts)
      return JSON.stringify(result)
    },
    presentCall() {
      return { card: 'generic', title: 'Reflect (run emergence)', kind: 'other', rawInput: 'emergence' }
    },
  }))

}
