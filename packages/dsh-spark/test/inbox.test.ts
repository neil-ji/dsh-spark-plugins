/**
 * 会话首步收件箱提醒的渲染测试（设计 §5.1）。
 *
 * 断言三条纪律：① 计数为 0 时不产生内容；② 提醒首行与 hippomemo 的召回可区分；
 * ③ maxChars 预算被尊重（宁可少列也不超预算）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderInboxReminder } from '../src/inbox.ts'
import type { SparkStats, SparkView } from 'dsh-spark-wire'

const NOW = 1_700_000_000_000

function stats(overrides: Partial<SparkStats> = {}): SparkStats {
  return {
    total: 0, pending: 0, crystallized: 0, dropped: 0, archived: 0, deleted: 0,
    oldestPendingAt: null, pendingProposals: 0,
    ...overrides,
  }
}

function spark(id: string, title: string): SparkView {
  return {
    id, title, content: 'c', scope: 'project', workspacePath: null, inboxState: 'pending', tags: [],
    sourceSessionId: 's', sourceAgentId: null, sourceTurn: null,
    createdAt: NOW, updatedAt: NOW, stateChangedAt: NOW, deletedAt: null, crystallized: null,
  }
}

function textOf(message: { content: readonly { type: string; text?: string }[] }): string {
  return message.content.map(block => block.text ?? '').join('\n')
}

test('renders a status notice with counts, id-marked titles and a distinct first line', () => {
  const message = renderInboxReminder(stats({ pending: 2, pendingProposals: 1 }), [spark('id-a', 'first'), spark('id-b', 'second')], 800)!
  const text = textOf(message)
  assert.match(text, /^<system-reminder>/)
  assert.match(text, /Spark inbox \(dsh-spark\): 2 pending sparks, 1 pending emergence proposal\./)
  assert.match(text, /<spark id="id-a">first<\/spark>/)
  assert.match(text, /<spark id="id-b">second<\/spark>/)
  assert.match(text, /status notice, not an instruction/)
  assert.ok(!/durable memories were retrieved/.test(text), 'must not look like a HippoMemo recall')
  assert.deepEqual(message.source, {
    kind: 'plugin', plugin: 'spark-inbox', form: 'notice', summary: '2 pending sparks, 1 pending proposals',
  })
})

test('singular/plural wording', () => {
  assert.match(textOf(renderInboxReminder(stats({ pending: 1 }), [spark('a', 'x')], 800)!), /1 pending spark\./)
  assert.match(textOf(renderInboxReminder(stats({ pending: 0, pendingProposals: 2 }), [], 800)!), /0 pending sparks, 2 pending emergence proposals/)
})

test('proposal-only state still injects, and no pending spark list is emitted', () => {
  const text = textOf(renderInboxReminder(stats({ pending: 0, pendingProposals: 3 }), [], 800)!)
  assert.ok(!/Most recent pending sparks/.test(text))
})

test('budget: drops entries that do not fit instead of overflowing', () => {
  const long = 'x'.repeat(400)
  const message = renderInboxReminder(stats({ pending: 5 }), [spark('a', long), spark('b', long)], 400)!
  const text = textOf(message)
  assert.ok(text.length <= 400 + 64, 'stays within the budget, got ' + text.length)
  assert.ok(!text.includes(long), 'no oversized entry is emitted')
})

test('returns undefined when even the header cannot fit', () => {
  assert.equal(renderInboxReminder(stats({ pending: 1 }), [spark('a', 'x')], 10), undefined)
})
