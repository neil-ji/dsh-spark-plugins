/**
 * 会话首步想法池通报的渲染测试（v2 §4.4 注入两段中的第①段）。
 *
 * 断言三条纪律：① 首行与 hippomemo 的召回可区分；② 队列语已退役（P16：
 * 不出现 waiting for triage / spark_crystallize）；③ maxChars 预算被尊重。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderInboxReminder } from '../src/inbox.ts'
import type { SparkStats, SparkView } from 'dsh-spark-wire'

const NOW = 1_700_000_000_000

function stats(overrides: Partial<SparkStats> = {}): SparkStats {
  return {
    total: 0, active: 0, archived: 0, deleted: 0,
    oldestActiveAt: null, pendingProposals: 0,
    ...overrides,
  }
}

function spark(id: string, title: string): SparkView {
  return {
    id, title, content: 'c', scope: 'project', workspacePath: null, status: 'active', tags: [],
    sourceSessionId: 's', sourceAgentId: null, sourceTurn: null,
    createdAt: NOW, updatedAt: NOW, stateChangedAt: NOW, deletedAt: null,
  }
}

function textOf(message: { content: readonly { type: string; text?: string }[] }): string {
  return message.content.map(block => block.text ?? '').join('\n')
}

test('renders a status notice with counts, id-marked titles and a distinct first line', () => {
  const message = renderInboxReminder(stats({ active: 2, pendingProposals: 1 }), [spark('id-a', 'first'), spark('id-b', 'second')], 800)!
  const text = textOf(message)
  assert.match(text, /^<system-reminder>/)
  assert.match(text, /Sparks \(dsh-spark\): 2 active sparks, 1 pending emergence proposal\./)
  assert.match(text, /<spark id="id-a">first<\/spark>/)
  assert.match(text, /<spark id="id-b">second<\/spark>/)
  assert.match(text, /status notice, not an instruction/)
  assert.ok(!/durable memories were retrieved/.test(text), 'must not look like a HippoMemo recall')
  // P16：队列语退役 —— 不再催促"处理掉"或引导去结晶。
  assert.ok(!/waiting for triage/.test(text))
  assert.ok(!/spark_crystallize/.test(text))
  assert.deepEqual(message.source, {
    kind: 'plugin', plugin: 'spark-inbox', form: 'notice', summary: '2 active sparks, 1 pending proposals',
  })
})

test('singular/plural wording', () => {
  assert.match(textOf(renderInboxReminder(stats({ active: 1 }), [spark('a', 'x')], 800)!), /1 active spark\./)
  assert.match(textOf(renderInboxReminder(stats({ active: 0, pendingProposals: 2 }), [], 800)!), /no active sparks\. 2 pending emergence proposals/)
})

test('empty pool shows the capture hook', () => {
  const message = renderInboxReminder(stats({ active: 0, pendingProposals: 0 }), [], 800)!
  const text = textOf(message)
  assert.match(text, /no active sparks\./)
  assert.match(text, /spark_capture/)
  assert.match(text, /Do not capture concrete actionable work/)
})

test('proposal-only state still injects, and no spark list is emitted', () => {
  const text = textOf(renderInboxReminder(stats({ active: 0, pendingProposals: 3 }), [], 800)!)
  assert.ok(!/Most recent active sparks/.test(text))
})

test('budget: drops entries that do not fit instead of overflowing', () => {
  const long = 'x'.repeat(400)
  const message = renderInboxReminder(stats({ active: 5 }), [spark('a', long), spark('b', long)], 400)!
  const text = textOf(message)
  assert.ok(text.length <= 400 + 64, 'stays within the budget, got ' + text.length)
  assert.ok(!text.includes(long), 'no oversized entry is emitted')
})

test('returns undefined when even the header cannot fit', () => {
  assert.equal(renderInboxReminder(stats({ active: 1 }), [spark('a', 'x')], 10), undefined)
})
