/**
 * Agent-facing spark tools.
 *
 * Phase 1: spark_capture (capture a spark).
 * Phase 2: spark_crystallize (promote a spark into HippoMemo MemoryRecord).
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
  'Use spark_capture to persist an inspiration, sudden association, or TODO-adjacent thought that just surfaced mid-conversation.',
  'Sparks are episodic (time-stamped, tied to the current session/workspace). They are NOT todos; do not capture concrete tasks with spark_capture — use the regular task tool for that.',
  'Sparks are NOT durable cross-session memory by default. When a spark has matured into a stable fact, decision, or preference, promote it to durable memory with spark_crystallize (Phase 2). Crystallize is idempotent — calling twice on the same spark returns the same hippoId without creating a duplicate.',
  'Crystallize requires HippoMemo (dsh-hippomemo) to be loaded. If the tool returns SPARK_HIPPO_UNAVAILABLE, the user must install HippoMemo first.',
  'Pick `kind` based on the spark\'s nature: insight (realized understanding), decision (a choice made), fact (objective truth), preference (user\'s taste/habit), constraint (an external rule). Default is insight when unsure.',
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

  // Phase 4: spark_reflect — DMN-style trigger of rule-based emergence.
  // Phase 4.5 will layer LLM-backed proposals on top.
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

  ctx.tools.register(defineTool({
    name: 'spark_crystallize',
    description: 'Promote one captured spark into a durable HippoMemo memory record. Idempotent: calling twice on the same spark returns the existing hippoId without creating a duplicate. Use when a spark has matured into a stable insight, decision, fact, preference, or constraint that should survive across sessions and workspaces. Requires dsh-hippomemo to be installed.',
    parameters: {
      id: { type: 'string', required: true, description: 'The spark id to crystallize.' },
      kind: { type: 'string', enum: ['insight', 'decision', 'fact', 'preference', 'constraint'], description: 'Which HippoMemo kind to file the memory under. Defaults to insight.' },
      importance: { type: 'number', description: '0 to 1. Defaults to 0.5.' },
      scope: { type: 'string', enum: ['session', 'project', 'global'], description: 'Override the destination memory scope. session maps to project (hippo has no session scope).' },
      globalProven: { type: 'boolean', description: 'Set true only when the crystallized fact is genuinely useful across every workspace. Defaults to false; an unproven global degrades to workspace-bound for auto-injection.' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new HarnessError('spark_crystallize requires a calling agent', 'SPARK_AGENT_REQUIRED')
      }
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      if (id.length === 0) {
        throw new HarnessError('spark_crystallize requires an id', 'SPARK_ID_REQUIRED')
      }
      const opts: Record<string, unknown> = {}
      if (typeof args.kind === 'string') opts.kind = args.kind
      if (typeof args.importance === 'number') opts.importance = args.importance
      if (typeof args.scope === 'string') opts.scope = args.scope
      if (typeof args.globalProven === 'boolean') opts.globalProven = args.globalProven
      const result = await ctx.spark.crystallize(id, opts)
      return JSON.stringify({
        hippoId: result.record.id,
        kind: result.record.kind,
        sparkId: result.spark.id,
        crystallizedAt: result.spark.crystallized?.at ?? null,
      })
    },
    presentCall(args) {
      return { card: 'generic', title: 'Crystallize spark', kind: 'other', rawInput: args.id }
    },
  }))

  // Phase 5: spark_to_script — crystallize a procedural sequence into the script catalog.
  ctx.tools.register(defineTool({
    name: 'spark_to_script',
    description: 'Persist a procedural sequence (ordered steps) as a reusable script in the cognitive-layer catalog. Use when you (the agent) have just completed a multi-step procedure that should be remembered across sessions and possibly re-invoked. Steps can be LLM instructions (kind=instruction) or tool invocations (kind=tool-call).',
    parameters: {
      name: { type: 'string', required: true, description: 'Short script name.' },
      description: { type: 'string', required: true, description: 'One-sentence description of what this script does.' },
      steps: { type: 'string', required: true, description: 'JSON array of steps: [{kind: "instruction"|"tool-call", payload: "...", note: "optional"}]. 1-50 steps.' },
      triggers: { type: 'string', description: 'Comma-separated trigger patterns for retrieval matching.' },
      scope: { type: 'string', enum: ['session', 'project', 'global'], description: 'Defaults to project.' },
      sourceSparkId: { type: 'string', description: 'Optional spark id this script crystallized from.' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const agent = exec.agent
      const sessionId = agent?.session.id ?? 'unknown'
      let steps: unknown
      try { steps = JSON.parse(args.steps) } catch (err) { throw new HarnessError('spark_to_script: steps must be valid JSON: ' + String(err), 'SPARK_STEPS_INVALID') }
      const triggers = typeof args.triggers === 'string' && args.triggers.length > 0
        ? args.triggers.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : []
      const created = await ctx.script.create({
        name: args.name,
        description: args.description,
        steps,
        triggers,
        scope: args.scope ?? 'project',
        workspacePath: agent?.session.header.cwd ?? null,
        sourceSparkId: typeof args.sourceSparkId === 'string' ? args.sourceSparkId : null,
      })
      return JSON.stringify({ scriptId: created.id, name: created.name, stepCount: created.steps.length, sessionId })
    },
    presentCall(args) { return { card: 'generic', title: 'Crystallize script', kind: 'other', rawInput: args.name } },
  }))

  // Phase 5: spark_invoke_script — return steps for the agent to execute; track invocation.
  ctx.tools.register(defineTool({
    name: 'spark_invoke_script',
    description: 'Invoke a stored procedural script: returns its ordered steps for you (the agent) to execute sequentially. After completing (or failing), call spark_record_script_result with the script id and success flag so the catalog\'s successRate stays accurate.',
    parameters: {
      id: { type: 'string', required: true, description: 'The script id to invoke.' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const result = await ctx.script.invoke(args.id)
      return JSON.stringify({
        scriptId: result.script.id,
        name: result.script.name,
        description: result.script.description,
        steps: result.script.steps,
        priorSuccessRate: result.successRate,
        invocationCount: result.script.invocationCount,
      })
    },
    presentCall(args) { return { card: 'generic', title: 'Invoke script', kind: 'other', rawInput: args.id } },
  }))

  // Phase 5: spark_record_script_result — close the loop on success/failure.
  ctx.tools.register(defineTool({
    name: 'spark_record_script_result',
    description: 'Record the outcome (success/failure) of a previously-invoked script. Updates the catalog\'s successRate counter.',
    parameters: {
      id: { type: 'string', required: true, description: 'The script id that was invoked.' },
      success: { type: 'boolean', required: true, description: 'true if all steps succeeded, false otherwise.' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const updated = await ctx.script.recordResult(args.id, args.success === true)
      if (updated === null) throw new HarnessError('spark_record_script_result: unknown script id: ' + args.id, 'SCRIPT_NOT_FOUND')
      return JSON.stringify({ scriptId: updated.id, successCount: updated.successCount, failureCount: updated.failureCount, invocationCount: updated.invocationCount })
    },
    presentCall(args) { return { card: 'generic', title: 'Record script result', kind: 'other', rawInput: args.id } },
  }))
}
