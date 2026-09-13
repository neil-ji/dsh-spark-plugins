/** D 档：命令失败挖掘的纯逻辑（归一化 / 噪声防线 / 聚合 / 自愈 / 渲染）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearFailuresForSuccess, commandOf, eligibleForPromotion, errorSignature, failureKey,
  isNoiseFailure, isShellTool, normalizeCommand, pitfallsForModel, recordFailure,
  renderPitfallBriefing, resultText, sessionModelKey,
} from '../src/command-mining.ts'
import { emptyMeta } from '../src/meta-store.ts'

const NOW = 1_700_000_000_000

test('only shell-ish tools are mined', () => {
  assert.equal(isShellTool('bash'), true)
  assert.equal(isShellTool('mcp__pwsh'), true)
  assert.equal(isShellTool('read'), false)
  assert.equal(isShellTool('webfetch'), false)
})

test('commandOf reads the command out of object / string / argv forms', () => {
  assert.equal(commandOf('{"command":"ls -la"}'), 'ls -la')
  assert.equal(commandOf('{"cmd":"echo hi"}'), 'echo hi')
  assert.equal(commandOf('{"args":["git","status"]}'), 'git status')
  assert.equal(commandOf('not json at all'), 'not json at all')
})

test('normalizeCommand keeps the stable shape and folds volatile parts', () => {
  assert.equal(normalizeCommand('bash', JSON.stringify({ command: 'git commit -m "a very long message" --amend' })), 'git commit -m')
  // 取前 3 个 token（命令 + 子命令 + 关键 flag），其余折叠：这正是"同一个坑"的稳定指纹。
  assert.equal(normalizeCommand('bash', JSON.stringify({ command: 'node C:\\\\work\\\\(repo)\\scripts\\run.mjs 12345' })), 'node <path> <n>')
  assert.equal(normalizeCommand('read', JSON.stringify({ command: 'ls' })), undefined, 'non-shell tools are ignored')
})

test('errorSignature folds paths/numbers and truncates', () => {
  const sig = errorSignature('Error: Cannot find module C:\\\\work\\\\(repo)\\missing\\thing.js at 12345\nsecond line')
  assert.match(sig, /<path>/)
  assert.ok(sig.length <= 160)
  assert.ok(!sig.includes('second line'))
})

test('noise filter rejects legitimate non-zero exits', () => {
  assert.equal(isNoiseFailure('grep: no matches found'), true)
  assert.equal(isNoiseFailure('process terminated by SIGKILL'), true)
  assert.equal(isNoiseFailure('exit code 137'), true)
  assert.equal(isNoiseFailure('已被强杀'), true)
  assert.equal(isNoiseFailure("bash: line 1: syntax error near unexpected token"), false)
})

test('cross-session repeats accumulate; same-session repeats do not', () => {
  let meta = emptyMeta()
  const base = { modelKey: 'tencent/hy4', cmdPattern: 'git commit -m', errSig: 'error: pathspec' }
  meta = recordFailure(meta, { ...base, sessionId: 's1' }, NOW)
  meta = recordFailure(meta, { ...base, sessionId: 's1' }, NOW + 1)
  assert.equal(meta.commandFailures[failureKey(base.modelKey, base.cmdPattern, base.errSig)]!.sessions.length, 1)
  meta = recordFailure(meta, { ...base, sessionId: 's2' }, NOW + 2)
  assert.equal(eligibleForPromotion(meta, 2).length, 1, 'two distinct sessions reach the threshold')
  assert.equal(eligibleForPromotion(meta, 3).length, 0)
})

test('a later success heals the pattern, and a new failure revives it', () => {
  let meta = emptyMeta()
  const base = { modelKey: 'm', cmdPattern: 'pnpm build', errSig: 'boom' }
  meta = recordFailure(meta, { ...base, sessionId: 's1' }, NOW)
  meta = recordFailure(meta, { ...base, sessionId: 's2' }, NOW + 1)
  meta = clearFailuresForSuccess(meta, 'm', 'pnpm build', NOW + 2)
  const key = failureKey('m', 'pnpm build', 'boom')
  assert.deepEqual(meta.commandFailures[key]!.sessions, [])
  assert.equal(meta.commandFailures[key]!.healedAt, NOW + 2)
  assert.equal(eligibleForPromotion(meta, 2).length, 0, 'healed entries are not promoted')
  assert.equal(pitfallsForModel(meta, 'm', 3).length, 0, 'healed entries are not briefed')
  meta = recordFailure(meta, { ...base, sessionId: 's3' }, NOW + 3)
  assert.equal(meta.commandFailures[key]!.healedAt, null, 'recurrence clears the healed mark')
  // 自愈后单次复现只算 1 个会话 —— 不该立刻又去提示（同一门槛重新累积）。
  assert.equal(pitfallsForModel(meta, 'm', 3).length, 0, 'one recurrence is not yet cross-session evidence')
  meta = recordFailure(meta, { ...base, sessionId: 's4' }, NOW + 4)
  assert.equal(pitfallsForModel(meta, 'm', 3).length, 1)
})

test('pitfalls are scoped to the running model (per-model error notebook)', () => {
  let meta = emptyMeta()
  meta = recordFailure(meta, { modelKey: 'a/x', cmdPattern: 'git push', errSig: 'e', sessionId: 's1' }, NOW)
  meta = recordFailure(meta, { modelKey: 'a/x', cmdPattern: 'git push', errSig: 'e', sessionId: 's2' }, NOW)
  assert.equal(pitfallsForModel(meta, 'a/x', 3).length, 1)
  assert.equal(pitfallsForModel(meta, 'b/y', 3).length, 0, 'other models must not see it')
  assert.equal(pitfallsForModel(meta, undefined, 3).length, 0)
})

test('resultText understands the platform tool-result block', () => {
  const message = {
    source: { kind: 'tool', callId: 'c1' },
    content: [{ type: 'tool-result', toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'fatal: not a git repository' }] }],
  }
  const parsed = resultText(message)
  assert.equal(parsed.isError, true)
  assert.match(parsed.text, /not a git repository/)
  assert.deepEqual(resultText(null), { isError: false, text: '' })
})

test('sessionModelKey mirrors the hippomemo resolution (requestHeader wins)', () => {
  assert.equal(sessionModelKey({ requestHeader: () => ({ config: { provider: 'tencent', model: 'hy4' } }) }), 'tencent/hy4')
  assert.equal(sessionModelKey({}), undefined)
})

test('renderPitfallBriefing is background info, not an instruction, and respects budget', () => {
  let meta = emptyMeta()
  meta = recordFailure(meta, { modelKey: 'm', cmdPattern: 'git commit -m', errSig: 'error: pathspec', sessionId: 's1' }, NOW)
  meta = recordFailure(meta, { modelKey: 'm', cmdPattern: 'git commit -m', errSig: 'error: pathspec', sessionId: 's2' }, NOW)
  const entries = pitfallsForModel(meta, 'm', 3)
  const message = renderPitfallBriefing(entries, 600)!
  const text = message.content.map(b => (b as { text?: string }).text ?? '').join('')
  assert.match(text, /Known command pitfalls/)
  assert.match(text, /error: pathspec/)
  assert.match(text, /not an instruction/)
  assert.equal(renderPitfallBriefing([], 600), undefined)
  assert.equal(renderPitfallBriefing(entries, 10), undefined)
})
