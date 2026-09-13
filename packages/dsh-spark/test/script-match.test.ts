/** C 档：triggers 匹配与建议渲染。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectRecentCalls, matchScripts, renderScriptSuggestion, stringifyArgs } from '../src/script-match.ts'
import type { ScriptView } from 'dsh-spark-wire'

const NOW = 1_700_000_000_000

function script(overrides: Partial<ScriptView> = {}): ScriptView {
  return {
    id: overrides.id ?? 'scr-1',
    name: overrides.name ?? '预览自检',
    description: overrides.description ?? '跑 Node 冒烟 + 服务器断言',
    steps: overrides.steps ?? [{ kind: 'instruction', payload: 'pnpm preview:verify' }],
    triggers: overrides.triggers ?? ['preview:verify'],
    scope: overrides.scope ?? 'project',
    workspacePath: null,
    invocationCount: overrides.invocationCount ?? 0,
    successCount: overrides.successCount ?? 0,
    failureCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    lastInvokedAt: null,
    sourceSparkId: null,
  }
}

function assistantWithCalls(calls: readonly { name: string; arguments: unknown }[]): unknown {
  return { role: 'assistant', content: calls.map((call, index) => ({ type: 'tool-call', id: 'c' + String(index), name: call.name, arguments: call.arguments })) }
}

test('stringifyArgs tolerates strings, objects and junk', () => {
  assert.equal(stringifyArgs('{"a":1}'), '{"a":1}')
  assert.equal(stringifyArgs({ a: 1 }), '{"a":1}')
  assert.equal(stringifyArgs(null), '')
})

test('collectRecentCalls takes the most recent N in chronological order', () => {
  const messages = [assistantWithCalls([{ name: 'bash', arguments: { command: 'one' } }, { name: 'bash', arguments: { command: 'two' } }]),
    assistantWithCalls([{ name: 'bash', arguments: { command: 'three' } }])]
  const calls = collectRecentCalls(messages, 2)
  assert.deepEqual(calls.map(c => c.name), ['bash', 'bash'])
  assert.match(calls[0]!.args, /two/)
  assert.match(calls[1]!.args, /three/)
  assert.deepEqual(collectRecentCalls(messages, 0), [])
})

test('matchScripts matches on trigger substring in the tool name or arguments', () => {
  const calls = collectRecentCalls([assistantWithCalls([{ name: 'bash', arguments: { command: 'pnpm preview:verify' } }])], 4)
  const match = matchScripts(calls, [script()])
  assert.equal(match?.script.id, 'scr-1')
  assert.deepEqual(match?.hits, ['preview:verify'])
})

test('matchScripts returns undefined when nothing is hit or triggers are empty', () => {
  const calls = collectRecentCalls([assistantWithCalls([{ name: 'bash', arguments: { command: 'ls -la' } }])], 4)
  assert.equal(matchScripts(calls, [script()]), undefined)
  assert.equal(matchScripts(calls, [script({ triggers: [] })]), undefined)
  assert.equal(matchScripts([], [script()]), undefined)
})

test('matchScripts prefers more hits, then a higher success rate, then specificity', () => {
  const calls = collectRecentCalls([assistantWithCalls([{ name: 'bash', arguments: { command: 'pnpm preview:verify && pnpm sandbox:up' } }])], 4)
  const twoHits = script({ id: 'two', triggers: ['preview:verify', 'sandbox:up'], invocationCount: 1, successCount: 0 })
  const oneHit = script({ id: 'one', triggers: ['preview:verify'], invocationCount: 10, successCount: 10 })
  assert.equal(matchScripts(calls, [oneHit, twoHits])?.script.id, 'two')
  const goodRate = script({ id: 'good', triggers: ['preview:verify'], invocationCount: 10, successCount: 9 })
  const badRate = script({ id: 'bad', triggers: ['preview:verify'], invocationCount: 10, successCount: 1 })
  assert.equal(matchScripts(calls, [badRate, goodRate])?.script.id, 'good')
})

test('renderScriptSuggestion is a suggestion (not an instruction) and respects the budget', () => {
  const calls = collectRecentCalls([assistantWithCalls([{ name: 'bash', arguments: { command: 'pnpm preview:verify' } }])], 4)
  const match = matchScripts(calls, [script()])!
  const message = renderScriptSuggestion(match, 600)!
  const text = message.content.map(b => (b as { text?: string }).text ?? '').join('')
  assert.match(text, /spark_invoke_script/)
  assert.match(text, /suggestion, not an instruction/)
  assert.equal(message.source?.form, 'notice')
  assert.equal(renderScriptSuggestion(match, 120), undefined, 'over budget -> no injection')
})
