import test from 'node:test'
import assert from 'node:assert/strict'
import { completeVerdicts, planEvolution, titleTokenJaccard } from '../src/memory-evolve.ts'
import type { EvolveOptions, EvolveAction } from '../src/memory-evolve.ts'
import type { MemoryRecord } from '../src/types.ts'

const DAY = 86_400_000
const NOW = 1_000_000 * DAY

const BASE_OPTIONS: EvolveOptions = {
  now: NOW,
  graceMs: 3 * DAY,
  decayMinRecalls: 5,
  probationMs: 30 * DAY,
  dupTitleThreshold: 0.7,
  maxConsolidations: 20,
}

function record(partial: Partial<MemoryRecord> & { id: string; title: string }): MemoryRecord {
  return {
    id: partial.id,
    kind: 'insight',
    title: partial.title,
    content: partial.content ?? 'content',
    tags: [],
    scope: 'global',
    workspacePath: null,
    globalProven: false,
    seenWorkspaces: [],
    importance: 0.8,
    status: 'active',
    sourceSessionId: 's',
    revision: 1,
    updatedBy: 'system',
    supersedes: null,
    supersededBy: null,
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - 1 * DAY,
    expiresAt: null,
    relatedIds: [],
    recallCount: 0,
    lastRecalledAt: null,
    citationCount: 0,
    lastCitedAt: null,
    ...partial,
  }
}

function actionsBy(actions: EvolveAction[], id: string): EvolveAction[] {
  return actions.filter(action => action.id === id)
}

test('titleTokenJaccard measures latin and CJK title overlap', () => {
  assert.equal(titleTokenJaccard('dsh 插件整合为 monorepo', 'dsh 插件整合为 monorepo'), 1)
  assert.ok(titleTokenJaccard('dsh 插件整合为 monorepo', 'dsh 插件整合 monorepo 完成') > 0.7)
  assert.equal(titleTokenJaccard('虚拟骑行核心设计', 'npm 发布 OIDC 解锁'), 0)
  assert.equal(titleTokenJaccard('', 'x'), 0)
})

test('expired memory with zero citations is archived', () => {
  const actions = planEvolution([
    record({ id: 'a', title: 'Alpha', expiresAt: NOW - DAY }),
  ], BASE_OPTIONS)
  assert.equal(actions.length, 1)
  assert.equal(actions[0]!.action, 'archive')
  assert.equal(actions[0]!.reason, 'expired without citation')
})

test('expired memory that was cited has its probation lifted instead', () => {
  const actions = planEvolution([
    record({ id: 'a', title: 'Alpha', citationCount: 2, expiresAt: NOW - DAY }),
  ], BASE_OPTIONS)
  assert.equal(actions.length, 1)
  assert.equal(actions[0]!.action, 'cancel-probation')
})

test('future expiry keeps the record on probation, untouched (even when it matches the noise profile)', () => {
  // A record already on probation must never be re-flagged: re-flagging would
  // endlessly extend its expiry and it would never reach the archive step.
  const actions = planEvolution([
    record({ id: 'a', title: 'Alpha', recallCount: 12, citationCount: 0, expiresAt: NOW + 5 * DAY }),
  ], BASE_OPTIONS)
  assert.equal(actions.length, 0)
})

test('uncited noise with many recalls and no grace period is put on probation', () => {
  const actions = planEvolution([
    record({ id: 'a', title: 'Alpha', recallCount: 12, citationCount: 0 }),
  ], BASE_OPTIONS)
  assert.equal(actions.length, 1)
  assert.equal(actions[0]!.action, 'probation')
  assert.match(actions[0]!.reason, /12× never cited/)
})

test('young memories are not judged (grace window)', () => {
  const actions = planEvolution([
    record({ id: 'a', title: 'Alpha', recallCount: 12, citationCount: 0, createdAt: NOW - DAY }),
  ], BASE_OPTIONS)
  assert.equal(actions.length, 0)
})

test('low recall or cited memories are not probated', () => {
  const few = planEvolution([
    record({ id: 'a', title: 'Alpha', recallCount: 2, citationCount: 0 }),
  ], BASE_OPTIONS)
  assert.equal(few.length, 0)
  const cited = planEvolution([
    record({ id: 'a', title: 'Alpha', recallCount: 12, citationCount: 1 }),
  ], BASE_OPTIONS)
  assert.equal(cited.length, 0)
})

test('near-duplicate unused memory is superseded into the used winner', () => {
  const actions = planEvolution([
    record({ id: 'loser', title: 'dsh 插件整合为 monorepo', recallCount: 9, citationCount: 0, importance: 0.5 }),
    record({ id: 'winner', title: 'dsh 插件整合为 monorepo', citationCount: 3, importance: 0.9 }),
  ], BASE_OPTIONS)
  const supersedes = actionsBy(actions, 'loser')
  assert.equal(supersedes.length, 1)
  assert.equal(supersedes[0]!.action, 'supersede')
  assert.equal(supersedes[0]!.targetId, 'winner')
})

test('near-duplicate USED memories are only linked, never destroyed', () => {
  const actions = planEvolution([
    record({ id: 'a', title: 'dsh 插件整合为 monorepo', citationCount: 2 }),
    record({ id: 'b', title: 'dsh 插件整合为 monorepo', citationCount: 1 }),
  ], BASE_OPTIONS)
  const links = actions.filter(action => action.action === 'link' || action.action === 'supersede')
  assert.equal(links.length, 1)
  assert.equal(links[0]!.action, 'link')
  assert.match(links[0]!.reason, /human review/)
})

test('dissimilar titles or different scopes never consolidate', () => {
  const actions = planEvolution([
    record({ id: 'a', title: 'npm 发布 2FA 解锁', scope: 'workspace', workspacePath: '/x' }),
    record({ id: 'b', title: 'dsh 插件整合为 monorepo', scope: 'workspace', workspacePath: '/y' }),
  ], BASE_OPTIONS)
  assert.equal(actions.length, 0)
})

test('a record is claimed by at most one consolidation per run', () => {
  const actions = planEvolution([
    record({ id: 'a', title: '同一条标题', citationCount: 3 }),
    record({ id: 'b', title: '同一条标题', citationCount: 0 }),
    record({ id: 'c', title: '同一条标题', citationCount: 0 }),
  ], BASE_OPTIONS)
  const superseded = actions.filter(action => action.action === 'supersede')
  // Both uncited copies merge into the cited winner; each record is claimed once.
  assert.equal(superseded.length, 2)
  assert.deepEqual(superseded.map(action => action.targetId), ['a', 'a'])
  assert.notEqual(superseded[0]!.id, superseded[1]!.id)
})

test('maxConsolidations bounds the pairing work', () => {
  const options = { ...BASE_OPTIONS, maxConsolidations: 1 }
  const records = []
  for (let i = 0; i < 4; i += 1) {
    records.push(record({ id: 'r' + String(i), title: '标题相同的一条记忆', citationCount: i === 0 ? 1 : 0, recallCount: 6 }))
  }
  const actions = planEvolution(records, options)
  const consolidations = actions.filter(action => action.action === 'supersede' || action.action === 'link')
  assert.ok(consolidations.length <= 1)
})

test('a declared global with only source-workspace evidence is downgraded to workspace', () => {
  const actions = planEvolution([
    record({ id: 'g', title: 'Global claim', recallCount: 8, citationCount: 0, scope: 'global', workspacePath: '/a', seenWorkspaces: ['/a'], globalProven: false }),
    record({ id: 'k', title: 'Proven global', recallCount: 8, citationCount: 0, scope: 'global', workspacePath: '/a', seenWorkspaces: ['/a', '/b', '/c'], globalProven: true }),
    record({ id: 'w', title: 'On its way', recallCount: 8, citationCount: 0, scope: 'global', workspacePath: '/a', seenWorkspaces: ['/a', '/b'], globalProven: false }),
    record({ id: 'legacy', title: 'No evidence data', recallCount: 12, citationCount: 0, scope: 'global', workspacePath: '/a', seenWorkspaces: [], globalProven: false }),
  ], BASE_OPTIONS)

  const gActions = actionsBy(actions, 'g')
  assert.equal(gActions.some(action => action.action === 'downgrade-scope'), true)
  assert.equal(gActions.some(action => action.action === 'probation'), false)
  assert.equal(actionsBy(actions, 'k').some(action => action.action === 'downgrade-scope'), false)
  assert.equal(actionsBy(actions, 'w').some(action => action.action === 'downgrade-scope'), false)
  assert.equal(actionsBy(actions, 'legacy').some(action => action.action === 'downgrade-scope'), false)
})
// ---- LLM review pass ----
import { buildReviewPrompt, parseReviewVerdicts } from '../src/memory-evolve.ts'

const candidates = [
  { id: 'a', kind: 'insight', title: 'A 记忆', content: '内容甲', recallCount: 9 },
  { id: 'b', kind: 'decision', title: 'B 记忆', content: '内容乙', recallCount: 6 },
]

test('buildReviewPrompt frames candidates with id/kind/title/recall', () => {
  const prompt = buildReviewPrompt(candidates)
  assert.match(prompt.system, /"noise"|"keep"/)
  assert.ok(prompt.user.includes('id: a'))
  assert.ok(prompt.user.includes('recalled: 9×, never cited'))
  assert.ok(prompt.user.includes('title: A 记忆'))
})

test('parseReviewVerdicts parses a JSON array and skips unknown ids', () => {
  const verdicts = parseReviewVerdicts(
    '[{"id":"a","verdict":"noise","reason":"已完结"},{"id":"b","verdict":"keep"},{"id":"zz","verdict":"noise"}]',
    ['a', 'b'],
  )
  assert.equal(verdicts.length, 2)
  assert.equal(verdicts[0]!.verdict, 'noise')
  assert.equal(verdicts[0]!.reason, '已完结')
  assert.equal(verdicts[1]!.verdict, 'keep')
  assert.equal(verdicts[1]!.reason, undefined)
})

test('parseReviewVerdicts tolerates prose and invalid input', () => {
  const prose = 'Here you go:\n[{"id":"a","verdict":"keep"}]\nHope that helps'
  assert.equal(parseReviewVerdicts(prose, ['a'])[0]!.verdict, 'keep')
  assert.deepEqual(parseReviewVerdicts('no json', ['a']), [])
  assert.deepEqual(parseReviewVerdicts('[{"id":"a","verdict":"maybe"}]', ['a']), [])
  assert.deepEqual(parseReviewVerdicts('', ['a']), [])
})

test('parseReviewVerdicts requires a verdict for every candidate (caller falls back)', () => {
  const partial = parseReviewVerdicts('[{"id":"a","verdict":"keep"}]', ['a', 'b'])
  assert.equal(partial.length, 1)
})


test('completeVerdicts fills missing verdicts with keep by default', () => {
  const candidates = [
    { id: 'a', kind: 'insight', title: 'A', content: 'x', recallCount: 9 },
    { id: 'b', kind: 'decision', title: 'B', content: 'y', recallCount: 6 },
    { id: 'c', kind: 'fact', title: 'C', content: 'z', recallCount: 5 },
  ]
  const complete = completeVerdicts([{ id: 'a', verdict: 'noise' }], candidates)
  assert.equal(complete.length, 3)
  assert.equal(complete[0]!.verdict, 'noise')
  assert.equal(complete[1]!.verdict, 'keep')
  assert.match(complete[1]!.reason ?? '', /kept by default/)
  assert.equal(complete[2]!.verdict, 'keep')
})
