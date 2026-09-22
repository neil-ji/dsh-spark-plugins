/**
 * 会话首步想法池通报的渲染测试（v2 §4.4 注入两段中的第①段）。
 *
 * 断言三条纪律：① 首行与 hippomemo 的召回可区分；② 队列语已退役（P16：
 * 不出现 waiting for triage / spark_crystallize）；③ maxChars 预算被尊重。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { lastUserText, renderInboxReminder, renderRelatedReminder } from '../src/inbox.ts'
import { selectRelevant } from '../src/relevance.ts'
import type { SparkStats, SparkView } from 'dsh-spark-wire'

const NOW = 1_700_000_000_000

function stats(overrides: Partial<SparkStats> = {}): SparkStats {
  return {
    total: 0, active: 0, archived: 0, deleted: 0,
    oldestActiveAt: null, pendingProposals: 0,
    ...overrides,
  }
}

function spark(id: string, title: string, content: string = 'c'): SparkView {
  return {
    id, title, content, scope: 'project', workspacePath: null, status: 'active', tags: [],
    origin: 'human', derivedFrom: [], generation: 0,
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

/* ─────────── 第②段：相关火花（v2 §4.4 P13） ─────────── */

test('related: 注入全文（标题 + 内容）并带 score', () => {
  const relevant = selectRelevant([spark('r1', 'preview mock channel', 'zero-dsh component preview')], 'preview mock channel', { limit: 3 })
  const message = renderRelatedReminder(relevant, 800)!
  const text = textOf(message)
  assert.match(text, /^<system-reminder>\nRelated sparks from the idea pool \(dsh-spark\):/)
  assert.match(text, /<spark id="r1" score="[\d.]+">preview mock channel — zero-dsh component preview<\/spark>/)
  assert.deepEqual(message.source, { kind: 'plugin', plugin: 'spark-inbox', form: 'notice', summary: '1 related spark' })
})

test('AC-6：三类注入首行前缀互不相同（记忆召回 / 状态通报 / 相关火花）', () => {
  const memoryFirstLine = 'The following durable memories were retrieved from other sessions or workspaces by HippoMemo.'
  const status = textOf(renderInboxReminder(stats({ active: 1 }), [spark('a', 'x')], 800)!).split('\n')[1]!
  const related = textOf(renderRelatedReminder(selectRelevant([spark('r', 'x', 'x')], 'x', { limit: 1 }), 800)!).split('\n')[1]!
  const heads = [memoryFirstLine, status, related]
  assert.equal(new Set(heads).size, 3, '三者必须可区分：' + JSON.stringify(heads))
})

test('related: 无候选返回 undefined（宁可不注入）', () => {
  assert.equal(renderRelatedReminder([], 800), undefined)
})

test('related: 预算放不下任何一条时返回 undefined，放得下就截断', () => {
  const long = 'y'.repeat(700)
  assert.equal(renderRelatedReminder(selectRelevant([spark('r', long, long)], long, { limit: 3 }), 120), undefined)
  const two = renderRelatedReminder([
    { spark: spark('a', 't', 'c'), score: 0.5 },
    { spark: spark('b', long, long), score: 0.4 },
  ], 800)!
  const text = textOf(two)
  assert.ok(!text.includes(long), '放不下的条目被丢掉')
  assert.match(text, /<spark id="a"/)
})

test('lastUserText: 拼接文本块并 trim（与 hippomemo 同形取数）', () => {
  assert.equal(lastUserText([{ content: [{ type: 'text', text: ' a ' }, { type: 'image' }] }]), 'a')
  assert.equal(lastUserText([]), '')
})
