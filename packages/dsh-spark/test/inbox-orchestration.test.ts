/**
 * 会话编排层的集成测试（设计 §5.1/§5.3/§5.4）—— 用假 ctx 驱动真实的 pre-step 处理器。
 *
 * 为什么需要它：AGENTS.md 要求注入类改动必须同时证明**注入发生了**与**不该注入时不注入**，
 * 而 `renderInboxReminder` 之类的纯函数测试只能证明"渲染得对"，不能证明"真的被挂上去了"。
 * 这里把 `ctx.on('agent/pre-step')` 的处理器抓出来直接调用，断言注入面的增删。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/inbox.ts'
import { emptyMeta, type SparkMeta } from '../src/meta-store.ts'
import type { ScriptView, SparkStats, SparkView } from 'dsh-spark-wire'

const NOW = 1_700_000_000_000

type PreStepHandler = (payload: unknown, next: () => Promise<{ kind: string; messages: unknown[] }>) => Promise<{ kind: string; messages: unknown[] }>

interface FakeOptions {
  stats?: Partial<SparkStats>
  pending?: SparkView[]
  scripts?: ScriptView[]
  modelKey?: string
  reflectResult?: { newProposals: unknown[] }
}

function makeSpark(id: string, title: string): SparkView {
  return {
    id, title, content: 'c', scope: 'project', workspacePath: null, inboxState: 'pending', tags: [],
    sourceSessionId: 's', sourceAgentId: null, sourceTurn: null,
    createdAt: NOW, updatedAt: NOW, stateChangedAt: NOW, deletedAt: null, crystallized: null,
  }
}

function makeScript(): ScriptView {
  return {
    id: 'scr-verify', name: '预览自检', description: '跑 Node 冒烟 + 服务器断言',
    steps: [{ kind: 'instruction', payload: 'pnpm preview:verify' }],
    triggers: ['preview:verify'], scope: 'project', workspacePath: null,
    invocationCount: 3, successCount: 3, failureCount: 0,
    createdAt: NOW, updatedAt: NOW, lastInvokedAt: null, sourceSparkId: null,
  }
}

/** 假 ctx：只实现本模块用到的面（on / spark / emerge / script / logger）。 */
function makeCtx(options: FakeOptions = {}): { ctx: unknown; handlers: PreStepHandler[]; calls: { reflect: number; updateMeta: number } } {
  const handlers: PreStepHandler[] = []
  const calls = { reflect: 0, updateMeta: 0 }
  let meta: SparkMeta = emptyMeta()
  const stats: SparkStats = {
    total: 0, pending: 0, crystallized: 0, dropped: 0, archived: 0, deleted: 0, oldestPendingAt: null, pendingProposals: 0,
    ...options.stats,
  }
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    on: (event: string, handler: PreStepHandler) => { if (event === 'agent/pre-step') handlers.push(handler); return () => {} },
    spark: {
      stats: async () => stats,
      list: async () => options.pending ?? [],
      countChangedSince: async () => 0,
      readMeta: async () => meta,
      updateMeta: async (mutate: (m: SparkMeta) => SparkMeta | null) => {
        calls.updateMeta += 1
        meta = mutate(meta) ?? meta
        return meta
      },
    },
    emerge: {
      list: async () => [],
      reflect: async () => { calls.reflect += 1; return { newProposals: options.reflectResult?.newProposals ?? [] } },
    },
    script: { list: async () => options.scripts ?? [] },
  }
  return { ctx, handlers, calls }
}

function assistantWithBash(command: string): unknown {
  return { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'bash', arguments: { command } }] }
}

const agent = { session: { id: 'sess-1', header: {} } }
const baseDecision = { kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] as unknown[] }

test('A: zero pending sparks and zero proposals injects nothing at all', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx as never, { reflect: { enabled: false } })
  const out = await handlers[0]!( { agent, messages: [], step: 1 }, async () => ({ ...baseDecision }))
  assert.equal(out.messages.length, baseDecision.messages.length, 'no injection when the inbox is empty')
})

test('A: pending sparks produce exactly one reminder, and only once per agent', async () => {
  const { ctx, handlers } = makeCtx({ stats: { pending: 2 }, pending: [makeSpark('a', 'first'), makeSpark('b', 'second')] })
  apply(ctx as never, { reflect: { enabled: false } })
  const first = await handlers[0]!({ agent, messages: [], step: 1 }, async () => ({ ...baseDecision }))
  assert.equal(first.messages.length, baseDecision.messages.length + 1)
  const text = JSON.stringify(first.messages[first.messages.length - 1])
  assert.match(text, /Spark inbox/)
  assert.match(text, /first/)
  const second = await handlers[0]!({ agent, messages: [], step: 1 }, async () => ({ ...baseDecision }))
  assert.equal(second.messages.length, baseDecision.messages.length, 'per-agent once (WeakSet guard)')
})

test('C: a matching recent tool call injects the script suggestion, and never twice', async () => {
  const { ctx, handlers } = makeCtx({ scripts: [makeScript()] })
  apply(ctx as never, { reflect: { enabled: false } })
  const messages = [assistantWithBash('pnpm preview:verify')]
  const first = await handlers[0]!({ agent, messages, step: 1 }, async () => ({ ...baseDecision }))
  assert.equal(first.messages.length, baseDecision.messages.length + 1)
  assert.match(JSON.stringify(first.messages[first.messages.length - 1]), /scr-verify/)
  // 去重是**按会话**的（WeakMap<agent>），不是全局：新会话里同样的命中应当再提示一次 ——
  // 模型在新会话里并不知道之前建议过。同一个 agent 则被 injected WeakSet 挡住（上一条测试覆盖）。
  const otherAgent = { session: { id: 'sess-2', header: {} } }
  const again = await handlers[0]!({ agent: otherAgent, messages, step: 1 }, async () => ({ ...baseDecision }))
  assert.equal(again.messages.length, baseDecision.messages.length + 1, 'a new session gets its own suggestion')
})

test('C: a non-matching tool call injects no script suggestion', async () => {
  const { ctx, handlers } = makeCtx({ scripts: [makeScript()] })
  apply(ctx as never, { reflect: { enabled: false } })
  const out = await handlers[0]!({ agent, messages: [assistantWithBash('ls -la')], step: 1 }, async () => ({ ...baseDecision }))
  assert.equal(out.messages.length, baseDecision.messages.length)
})

test('B: the dirty marker triggers a background reflect once, then records lastReflectAt', async () => {
  // countChangedSince 返回 5（≥ threshold 3），minIntervalMs = 0 → 应当触发。
  const { ctx, handlers, calls } = makeCtx()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(ctx as any).spark.countChangedSince = async () => 5
  apply(ctx as never, { reflect: { enabled: true, threshold: 3, minIntervalMs: 0 } })
  await handlers[0]!({ agent, messages: [], step: 1 }, async () => ({ ...baseDecision }))
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(calls.reflect, 1, 'reflect ran in the background')
  assert.ok(calls.updateMeta >= 1, 'lastReflectAt was written back')
})

test('B: below threshold, or with reflect disabled, nothing runs in the background', async () => {
  const below = makeCtx()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(below.ctx as any).spark.countChangedSince = async () => 1
  apply(below.ctx as never, { reflect: { enabled: true, threshold: 3, minIntervalMs: 0 } })
  await below.handlers[0]!({ agent, messages: [], step: 1 }, async () => ({ ...baseDecision }))
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(below.calls.reflect, 0)

  const off = makeCtx()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(off.ctx as any).spark.countChangedSince = async () => 99
  apply(off.ctx as never, { reflect: { enabled: false } })
  await off.handlers[0]!({ agent, messages: [], step: 1 }, async () => ({ ...baseDecision }))
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(off.calls.reflect, 0)
})
