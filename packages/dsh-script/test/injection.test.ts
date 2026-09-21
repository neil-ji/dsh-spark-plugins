/**
 * 目录注入与主动建议的回归（Spec §8 A1：INV-4/5/6）。
 *
 * 用假 ctx 抓出真实的 `agent/pre-step` 处理器直接调用 —— 纯函数测试只能证明"渲染得对"，
 * 证明不了"该注入时注入、不该注入时不注入、重复调用不重复注入"。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scriptViewSchema, type ScriptView } from 'dsh-script-wire'
import { InjectStateStore, catalogDigest } from '../src/inject-state.ts'
import { registerScriptInjection } from '../src/injection.ts'
import type { ScriptService } from '../src/script-service.ts'

const NOW = 1_700_000_000_000
type Handler = (payload: unknown, next: () => Promise<{ kind: string; messages: unknown[] }>) => Promise<{ kind: string; messages: unknown[] }>

function record(overrides: Partial<ScriptView> = {}): ScriptView {
  return scriptViewSchema.parse({
    id: overrides.id ?? 's1',
    name: overrides.name ?? '跑全套闸门',
    description: overrides.description ?? '合并前跑一次 check:all',
    steps: overrides.steps ?? [{ kind: 'tool-call', payload: 'pnpm check:all' }],
    triggers: overrides.triggers ?? ['check:all'],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  })
}

const agent = { id: 'agent-1', session: { id: 'sess-1', header: { cwd: '/repo' } } }
const baseDecision = { kind: 'enter', messages: [] as unknown[] }
const bashCall = (command: string): unknown => ({
  source: { kind: 'assistant' },
  content: [{ type: 'tool-call', name: 'bash', arguments: { command } }],
})

async function setup(t: { after: (fn: () => Promise<void>) => void }, records: ScriptView[]): Promise<{ handler: Handler; store: InjectStateStore; statePath: string; warnings: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-script-inject-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const statePath = join(dir, 'inject-state.json')
  let captured: Handler | undefined
  const listTool = { name: 'script_list' }
  const warnings: string[] = []
  const ctx = {
    on(event: string, handler: Handler) { if (event === 'agent/pre-step') captured = handler; return () => {} },
    tools: { get: (name: string) => (name === 'script_list' ? listTool : undefined) },
    logger: { warn: (message: string) => warnings.push(String(message)) },
  }
  const service = {
    async listVisible() { return records },
    async listVisibleRecords() { return records },
  } as unknown as ScriptService
  registerScriptInjection(ctx as never, { enabled: true, maxChars: 2000 }, {
    service,
    stateStore: new InjectStateStore(statePath),
    listTool,
    pluginName: 'dsh-script',
    listToolName: 'script_list',
    invokeToolName: 'script_invoke',
  })
  return { handler: captured as Handler, store: new InjectStateStore(statePath), statePath, warnings }
}

test('目录帧：首次注入完整清单，指纹不变则不重复注入（INV-4/5）', async (t) => {
  const { handler, statePath } = await setup(t, [record()])
  const first = await handler({ agent, messages: [], step: 1, signal: new AbortController().signal }, async () => ({ ...baseDecision }))
  assert.equal(first.messages.length, 1)
  assert.match(JSON.stringify(first.messages[0]), /available_scripts/)
  assert.match(JSON.stringify(first.messages[0]), /跑全套闸门/)
  const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, { digest: string }>
  assert.equal(state['sess-1']!.digest, catalogDigest([{ name: '跑全套闸门', description: '合并前跑一次 check:all' }]))

  const second = await handler({ agent, messages: [], step: 2, signal: new AbortController().signal }, async () => ({ ...baseDecision }))
  assert.equal(second.messages.length, 0, '指纹未变 → 不注入')
})

test('目录变化 → 替换帧（措辞明确作废旧清单）', async (t) => {
  const records = [record()]
  const { handler } = await setup(t, records)
  await handler({ agent, messages: [], step: 1, signal: new AbortController().signal }, async () => ({ ...baseDecision }))
  records.push(record({ id: 's2', name: '预览自检', description: '跑 preview:verify' }))
  const next = await handler({ agent, messages: [], step: 2, signal: new AbortController().signal }, async () => ({ ...baseDecision }))
  assert.equal(next.messages.length, 1)
  assert.match(JSON.stringify(next.messages[0]), /replaces every earlier script catalog/)
})

test('per-agent 门控：工具不可见时不注入目录（INV-6）', async (t) => {
  const { handler } = await setup(t, [record()])
  let captured: Handler | undefined
  const listTool = { name: 'script_list' }
  const ctx = {
    on(event: string, handler: Handler) { if (event === 'agent/pre-step') captured = handler; return () => {} },
    tools: { get: () => undefined },
    logger: { warn: () => {} },
  }
  registerScriptInjection(ctx as never, { enabled: true }, {
    service: { async listVisible() { return [record()] }, async listVisibleRecords() { return [] } } as unknown as ScriptService,
    stateStore: new InjectStateStore(join(tmpdir(), 'never-written-' + String(Date.now()) + '.json')),
    listTool,
    pluginName: 'dsh-script',
    listToolName: 'script_list',
    invokeToolName: 'script_invoke',
  })
  const out = await (captured as Handler)({ agent, messages: [], step: 1, signal: new AbortController().signal }, async () => ({ ...baseDecision }))
  assert.equal(out.messages.length, 0, '工具对该 agent 不可见 → 不注入')
  void handler
})

test('主动建议：命中的 triggers 只建议一次（按会话持久化）', async (t) => {
  const { handler, warnings } = await setup(t, [record({ triggers: ['check:all'] })])
  const messages = [bashCall('pnpm check:all')]
  const first = await handler({ agent, messages, step: 1, signal: new AbortController().signal }, async () => ({ ...baseDecision }))
  const suggestion = first.messages.find(message => JSON.stringify(message).includes('Script catalog match'))
  assert.ok(suggestion !== undefined, '命中 triggers 应给出建议；warnings=' + JSON.stringify(warnings.slice(0, 2)))
  assert.match(JSON.stringify(suggestion), /script_invoke/)

  const second = await handler({ agent, messages, step: 2, signal: new AbortController().signal }, async () => ({ ...baseDecision }))
  assert.equal(second.messages.filter(message => JSON.stringify(message).includes('Script catalog match')).length, 0, '同一会话不重复建议')
})

test('预算装不下时不注入，且不写状态（下次仍会尝试）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-script-budget-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const statePath = join(dir, 'inject-state.json')
  let captured: Handler | undefined
  const listTool = { name: 'script_list' }
  const ctx = {
    on(event: string, handler: Handler) { if (event === 'agent/pre-step') captured = handler; return () => {} },
    tools: { get: () => listTool },
    logger: { warn: () => {} },
  }
  registerScriptInjection(ctx as never, { enabled: true, maxChars: 10, suggest: { enabled: false } }, {
    service: {
      async listVisible() { return [record({ description: 'x'.repeat(500) })] },
      async listVisibleRecords() { return [] },
    } as unknown as ScriptService,
    stateStore: new InjectStateStore(statePath),
    listTool,
    pluginName: 'dsh-script',
    listToolName: 'script_list',
    invokeToolName: 'script_invoke',
  })
  const out = await (captured as Handler)({ agent, messages: [], step: 1, signal: new AbortController().signal }, async () => ({ ...baseDecision }))
  assert.equal(out.messages.length, 0)
  const state = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}')) as Record<string, unknown>
  assert.deepEqual(state, {}, '未发布就不该写状态')
})
