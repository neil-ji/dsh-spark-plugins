import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryCore, normalizeRecord, splitTags, tokenize, isMemoryAutoInjectable, filterAutoInjection } from '../src/memory-core.ts'
import type { MemoryPutInput, MemoryRecord } from '../src/types.ts'

function makeCore(overrides: Partial<{ maxMemories: number; defaultRecallLimit: number; maxRecallChars: number }> = {}) {
  let seq = 0
  return new MemoryCore(
    () => ({
      maxMemories: overrides.maxMemories ?? 10,
      defaultRecallLimit: overrides.defaultRecallLimit ?? 5,
      maxRecallChars: overrides.maxRecallChars ?? 5000,
    }),
    {
      now: () => 1000 + seq,
      newId: () => 'id-' + String(++seq),
    },
  )
}

function input(title: string, content: string, extra: Partial<MemoryPutInput> = {}): MemoryPutInput {
  return { title, content, ...extra }
}

test('tokenize returns latin words and CJK bigrams (no noisy unigrams)', () => {
  assert.deepEqual(tokenize('Hello world'), ['hello', 'world'])
  const cjk = tokenize('中文测试')
  // Single hanzi must NOT be indexed: they routinely co-occur by accident and
  // produced false-positive recalls (e.g. 本/量/回/否 matching an unrelated memory).
  for (const token of ['中', '文', '测', '试']) {
    assert.equal(cjk.includes(token), false)
  }
  for (const token of ['中文', '文测', '测试']) {
    assert.equal(cjk.includes(token), true)
  }
  assert.equal(tokenize('hello 中文').includes('hello'), true)
  // An isolated one-character run is still tokenized so single-char searches work.
  assert.deepEqual(tokenize('环'), ['环'])
})

test('splitTags trims, dedupes, and drops empty entries', () => {
  assert.deepEqual(splitTags('a, b , a, '), ['a', 'b'])
  assert.deepEqual(splitTags(''), [])
})

test('normalizeRecord creates defaults and bumps revisions', () => {
  const first = normalizeRecord(input('Alpha', 'one'), undefined, { now: () => 2000, newId: () => 'id-1' })
  assert.equal(first.record.id, 'id-1')
  assert.equal(first.record.revision, 1)
  assert.equal(first.record.createdAt, 2000)
  assert.equal(first.record.updatedAt, 2000)
  assert.equal(first.record.status, 'active')
  assert.equal(first.record.updatedBy, 'system')

  const second = normalizeRecord(input('Alpha', 'two'), first.record, { now: () => 3000 })
  assert.equal(second.record.id, 'id-1')
  assert.equal(second.record.revision, 2)
  assert.equal(second.record.createdAt, 2000)
  assert.equal(second.record.updatedAt, 3000)
})

test('normalizeRecord rejects empty title and content', () => {
  assert.throws(() => normalizeRecord(input('  ', 'x')), /title must be non-empty/)
  assert.throws(() => normalizeRecord(input('x', '  ')), /content must be non-empty/)
})

test('core put/list/get/delete round-trips records', () => {
  const core = makeCore()
  const record = core.put(input('First', 'hello world', { tags: ['greeting'], kind: 'fact' }))
  assert.equal(core.size, 1)
  assert.equal(core.get(record.id)?.title, 'First')
  assert.equal(core.list().total, 1)
  assert.equal(core.delete(record.id), true)
  assert.equal(core.delete(record.id), false)
  assert.equal(core.get(record.id), undefined)
})

test('core enforces maxMemories on create', () => {
  const core = makeCore({ maxMemories: 1 })
  core.put(input('A', 'one'))
  assert.throws(() => core.put(input('B', 'two')), /maxMemories/)
})

test('core update bumps revision and changes fields', () => {
  const core = makeCore()
  const first = core.put(input('A', 'one', { scope: 'global', kind: 'fact' }))
  const second = core.update(first.id, { title: 'B', content: 'two', scope: 'workspace', importance: 0.9 })
  assert.equal(second.revision, 2)
  assert.equal(second.title, 'B')
  assert.equal(second.scope, 'workspace')
  assert.equal(second.importance, 0.9)
  assert.equal(second.createdAt, first.createdAt)
  assert.throws(() => core.update('missing', { title: 'x' }), /unknown memory/)
})

test('core filters by kind, status, tag, and scope', () => {
  const core = makeCore()
  core.put(input('A', 'one', { kind: 'fact', status: 'active', tags: ['red'], scope: 'global' }))
  core.put(input('B', 'two', { kind: 'decision', status: 'candidate', tags: ['blue'], scope: 'workspace', workspacePath: '/w' }))
  core.put(input('C', 'three', { kind: 'fact', status: 'archived', tags: ['red'], scope: 'project', workspacePath: '/w/p' }))

  assert.equal(core.list({ kind: 'fact' }).total, 2)
  assert.equal(core.list({ status: 'candidate' }).total, 1)
  assert.equal(core.list({ tag: 'red' }).total, 2)
  assert.equal(core.list({ scope: 'workspace' }).total, 1)
  assert.equal(core.list({ scope: 'current', workspacePath: '/w' }).total, 2)
  assert.equal(core.list({ scope: 'current' }).total, 1)
})

test('core search ranks title matches above content matches', () => {
  const core = makeCore()
  core.put(input('Needle title', 'nothing here', { kind: 'fact' }))
  core.put(input('Other title', 'needle appears only in content', { kind: 'fact' }))
  const result = core.search({ q: 'needle' })
  assert.equal(result.items[0].record.title, 'Needle title')
  assert.equal(result.items[0].matchedReason.includes('title'), true)
})

test('core search filters current scope and reports matchedReason', () => {
  const core = makeCore()
  core.put(input('Global memory', 'shared insight', { scope: 'global', tags: ['insight'] }))
  core.put(input('Workspace memory', 'local insight', { scope: 'workspace', workspacePath: '/w' }))
  core.put(input('Other workspace', 'local insight', { scope: 'workspace', workspacePath: '/x' }))
  const result = core.search({ q: 'insight', scope: 'current', workspacePath: '/w' })
  assert.equal(result.total, 2)
  assert.equal(result.items.some(hit => hit.record.scope === 'global'), true)
  assert.equal(result.items.some(hit => hit.record.scope === 'workspace' && hit.record.workspacePath === '/w'), true)
})

test('core search honors recall limit and byte budget', () => {
  const core = makeCore({ defaultRecallLimit: 2, maxRecallChars: 10 })
  core.put(input('A', 'aaaaaaaaaa'))
  core.put(input('B', 'bbbbbbbbbb'))
  core.put(input('C', 'cccccccccc'))
  const result = core.search({ q: '' })
  assert.equal(result.items.length, 1)
})

test('core stats counts statuses and kinds', () => {
  const core = makeCore()
  core.put(input('A', 'one', { kind: 'fact', status: 'active' }))
  core.put(input('B', 'two', { kind: 'decision', status: 'archived' }))
  core.put(input('C', 'three', { kind: 'preference', status: 'superseded' }))
  core.put(input('D', 'four', { kind: 'constraint', status: 'candidate' }))
  const stats = core.stats()
  assert.equal(stats.total, 4)
  assert.equal(stats.active, 1)
  assert.equal(stats.archived, 1)
  assert.equal(stats.superseded, 1)
  assert.equal(stats.candidate, 1)
  assert.equal(stats.byKind.fact, 1)
})

test('core defaults work without injected clocks or ids', () => {
  const core = new MemoryCore(() => ({ maxMemories: 10, defaultRecallLimit: 5, maxRecallChars: 5000 }))
  const record = core.put(input('Default', 'default record', { tags: ['default'] }))
  assert.equal(record.id.length > 0, true)
  assert.equal(record.createdAt > 0, true)
  assert.equal([...core.entries()].length, 1)
})

test('core search matches tag tokens', () => {
  const core = makeCore()
  core.put(input('Title', 'body', { tags: ['tag-token'] }))
  const result = core.search({ q: 'tag-token' })
  assert.equal(result.items[0].matchedReason.includes('tag'), true)
})

test('core list filters workspacePath when scope is omitted', () => {
  const core = makeCore()
  core.put(input('Global', 'one', { scope: 'global' }))
  core.put(input('Local', 'two', { scope: 'workspace', workspacePath: '/w' }))
  core.put(input('Other', 'three', { scope: 'workspace', workspacePath: '/x' }))
  assert.equal(core.list({ workspacePath: '/w' }).total, 2)
})

test('core load accepts storage-domain entry tuples', () => {
  const core = makeCore()
  const record: MemoryRecord = {
    id: 'tuple-1', kind: 'fact', title: 'Tuple', content: 'entry tuple', tags: ['tuple'], scope: 'global',
    workspacePath: null, importance: 0.5, status: 'active', sourceSessionId: 's1', revision: 1,
    updatedBy: 'system', supersedes: null, supersededBy: null, createdAt: 1, updatedAt: 2, expiresAt: null, relatedIds: [],
    recallCount: 0, lastRecalledAt: null, citationCount: 0, lastCitedAt: null,
  }
  core.load([['tuple-1', record]])
  assert.equal(core.get('tuple-1')?.title, 'Tuple')
  assert.equal(core.list().items[0].title, 'Tuple')
})

test('core tolerates legacy records without tags', () => {
  const core = makeCore()
  const legacy = {
    id: 'legacy-1', kind: 'fact', title: 'Legacy', content: 'no tags field', scope: 'global',
    workspacePath: null, importance: 0.5, status: 'active', sourceSessionId: 's1', revision: 1,
    updatedBy: 'system', supersedes: null, supersededBy: null, createdAt: 1, updatedAt: 2, expiresAt: null, relatedIds: [],
  } as any
  core.load([legacy])
  assert.equal(core.get('legacy-1')?.title, 'Legacy')
  assert.equal(core.search({ q: 'legacy' }).total, 1)
})

test('core list paginates with limit/cursor/nextCursor', () => {
  const core = makeCore()
  for (let index = 1; index <= 5; index += 1) {
    core.put(input('Item ' + index, 'body ' + index))
  }
  const first = core.list({ limit: 2 })
  assert.equal(first.total, 5)
  assert.equal(first.items.length, 2)
  assert.equal(first.nextCursor, 2)
  const second = core.list({ limit: 2, cursor: first.nextCursor })
  assert.equal(second.items.length, 2)
  assert.equal(second.nextCursor, 4)
  const third = core.list({ limit: 2, cursor: second.nextCursor as number })
  assert.equal(third.items.length, 1)
  assert.equal(third.nextCursor, undefined)
})

test('core list sorts by key and direction', () => {
  const core = makeCore()
  core.put(input('Beta', 'b', { importance: 0.3 }))
  core.put(input('Alpha', 'a', { importance: 0.9 }))
  core.put(input('Gamma', 'g', { importance: 0.5 }))

  assert.deepEqual(core.list({ sort: 'updatedAt', order: 'desc' }).items.map(r => r.title), ['Gamma', 'Alpha', 'Beta'])
  assert.deepEqual(core.list({ sort: 'updatedAt', order: 'asc' }).items.map(r => r.title), ['Beta', 'Alpha', 'Gamma'])
  assert.deepEqual(core.list({ sort: 'importance', order: 'desc' }).items.map(r => r.title), ['Alpha', 'Gamma', 'Beta'])
  assert.deepEqual(core.list({ sort: 'importance', order: 'asc' }).items.map(r => r.title), ['Beta', 'Gamma', 'Alpha'])
  assert.deepEqual(core.list({ sort: 'title', order: 'asc' }).items.map(r => r.title), ['Alpha', 'Beta', 'Gamma'])
  assert.deepEqual(core.list({ sort: 'title', order: 'desc' }).items.map(r => r.title), ['Gamma', 'Beta', 'Alpha'])
})

test('core allTags counts and orders by usage', () => {
  const core = makeCore()
  core.put(input('A', 'one', { tags: ['red', 'blue'] }))
  core.put(input('B', 'two', { tags: ['red'] }))
  core.put(input('C', 'three', { tags: ['green', 'red'] }))
  assert.deepEqual(core.allTags(), [
    { tag: 'red', count: 3 },
    { tag: 'blue', count: 1 },
    { tag: 'green', count: 1 },
  ])
})

test('core load rebuilds index from durable records', () => {
  const core = makeCore()
  const record: MemoryRecord = {
    id: 'loaded-1', kind: 'insight', title: 'Loaded', content: 'durable content', tags: ['loaded'],
    scope: 'workspace', workspacePath: '/w', importance: 0.5, status: 'active', sourceSessionId: 's1',
    revision: 1, updatedBy: 'system', supersedes: null, supersededBy: null, createdAt: 1, updatedAt: 2,
    expiresAt: null, relatedIds: [],
    recallCount: 0, lastRecalledAt: null, citationCount: 0, lastCitedAt: null,
  }
  core.load([record])
  assert.equal(core.get('loaded-1')?.title, 'Loaded')
  assert.equal(core.search({ q: 'durable', scope: 'current', workspacePath: '/w' }).total, 1)
})

test('core markRecalled bumps recall counters and returns changed records', () => {
  const core = makeCore()
  const first = core.put(input('A', 'one'))
  const second = core.put(input('B', 'two'))
  const changed = core.markRecalled([first.id, second.id, 'missing'])
  assert.equal(changed.length, 2)
  assert.equal(core.get(first.id)?.recallCount, 1)
  assert.equal(core.get(first.id)?.lastRecalledAt, 1002)
  core.markRecalled([first.id])
  assert.equal(core.get(first.id)?.recallCount, 2)
  // recall must not refresh the content updatedAt
  assert.equal(core.get(first.id)?.updatedAt, 1000)
  assert.equal(core.get('missing'), undefined)
})

test('core markCited bumps citation counters', () => {
  const core = makeCore()
  const record = core.put(input('A', 'one'))
  assert.equal(core.markCited('missing'), undefined)
  const changed = core.markCited(record.id)
  assert.equal(changed?.id, record.id)
  assert.equal(core.get(record.id)?.citationCount, 1)
  assert.equal(core.get(record.id)?.lastCitedAt, 1001)
  core.markCited(record.id)
  assert.equal(core.get(record.id)?.citationCount, 2)
})

test('core load fills missing counters on legacy records', () => {
  const core = makeCore()
  const legacy = {
    id: 'legacy-2', kind: 'fact', title: 'Legacy', content: 'no counters', scope: 'global',
    workspacePath: null, importance: 0.5, status: 'active', sourceSessionId: 's1', revision: 1,
    updatedBy: 'system', supersedes: null, supersededBy: null, createdAt: 1, updatedAt: 2, expiresAt: null, relatedIds: [],
  } as any
  core.load([legacy])
  assert.equal(core.get('legacy-2')?.recallCount, 0)
  assert.equal(core.get('legacy-2')?.lastRecalledAt, null)
  assert.equal(core.get('legacy-2')?.citationCount, 0)
  assert.equal(core.get('legacy-2')?.lastCitedAt, null)
})

test('core usage reports rates, staleness, and rankings', () => {
  const core = makeCore()
  // now() returns 1000 + seq; each put advances seq
  const recalled = core.put(input('Recalled', 'one'))
  core.put(input('Never surfaced', 'two'))
  const stale = core.put(input('Stale active', 'three'))
  core.put(input('Archived old', 'four', { status: 'archived' }))

  core.markRecalled([recalled.id, stale.id]) // both surfaced at seq=1004-ish
  core.markCited([recalled.id][0])

  const report = core.usage(30)
  assert.equal(report.total, 4)
  assert.equal(report.recalled, 2)
  assert.equal(report.cited, 1)
  assert.equal(report.neverRecalled, 2)
  assert.equal(report.conversionRate, 0.5)
  assert.equal(report.recallRate, 0.5)
  assert.equal(report.citationRate, 0.25)
  assert.equal(report.topRecalled.length, 2)
  assert.equal(report.topRecalled[0].id, recalled.id)
  assert.equal(report.topCited[0].id, recalled.id)
  assert.equal(report.topCited[0].count, 1)
  // a never-recalled active memory is stale under any window
  assert.equal(report.staleCount, 1)
  assert.equal(report.stale[0].title, 'Never surfaced')
  // archived memories are excluded from the staleness pool
  assert.equal(report.active, 3)

  // forcing an old recall marks that memory stale under a zero window
  const aged = core.get(stale.id)
  assert.ok(aged !== undefined)
  aged.lastRecalledAt = 1
  const wide = core.usage(0)
  assert.equal(wide.staleCount, 2)
  assert.equal(wide.stale.some(item => item.id === stale.id), true)
})

test('core usage is empty-safe', () => {
  const core = makeCore()
  const report = core.usage(30)
  assert.equal(report.total, 0)
  assert.equal(report.recallRate, 0)
  assert.equal(report.citationRate, 0)
  assert.equal(report.conversionRate, 0)
  assert.deepEqual(report.topRecalled, [])
  assert.deepEqual(report.topCited, [])
})

test('core search does not recall records with no token overlap', () => {
  const core = makeCore()
  // High importance + fresh record must NOT be recalled when no token overlaps the query.
  core.put(input('dev loop typecheck', 'pnpm install fails without registry', { importance: 1 }))
  const result = core.search({ q: '提交了吗' })
  assert.equal(result.total, 0)
})

test('core search treats stopword-only queries as empty queries', () => {
  const core = makeCore()
  core.put(input('A', 'alpha content'))
  core.put(input('B', 'beta content'))
  // 'the'/'of'/'in' are all stop tokens, so this degenerates to recency ranking.
  const result = core.search({ q: 'the of in' })
  assert.equal(result.total, 2)
  assert.deepEqual(result.items.map(hit => hit.record.title), ['B', 'A'])
})

test('core search ignores stop tokens mixed into a query', () => {
  const core = makeCore()
  core.put(input('Quick fox', 'the lazy dog', { scope: 'workspace', workspacePath: '/w' }))
  const result = core.search({ q: 'the lazy', scope: 'current', workspacePath: '/w' })
  assert.equal(result.total, 1)
  assert.equal(result.items[0].matchedReason.includes('content'), true)
})

test('core search idf outranks recency tiebreak for rare tokens', () => {
  const core = makeCore()
  core.put(input('Rare', 'rare only'))
  for (let index = 0; index < 5; index += 1) core.put(input('Common ' + index, 'shared only'))
  const result = core.search({ q: 'shared rare' })
  // 'rare' appears in one doc (high idf) while 'shared' appears in five (low idf);
  // the rare match wins even though its updatedAt is the oldest.
  assert.equal(result.items[0].record.title, 'Rare')
})

test('core search index stays consistent after update and delete', () => {
  const core = makeCore()
  const record = core.put(input('Old title', 'old content'))
  assert.equal(core.search({ q: 'old' }).total, 1)
  core.update(record.id, { title: 'New title', content: 'new content' })
  assert.equal(core.search({ q: 'old' }).total, 0)
  assert.equal(core.search({ q: 'new' }).total, 1)
  core.delete(record.id)
  assert.equal(core.search({ q: 'new' }).total, 0)
})

test('core search does not let importance or recency gate recall', () => {
  const core = makeCore()
  core.put(input('Unrelated', 'nothing to do with the query', { importance: 1 }))
  // MatchedReason for an empty query is 'recency'; a non-empty unrelated query returns nothing.
  const result = core.search({ q: 'zzzz-not-present' })
  assert.equal(result.total, 0)
})

test('core search does not match on single shared CJK characters', () => {
  const core = makeCore()
  // The npm-2FA style memory shares only single hanzi (本/量/否/确/回) with the query.
  core.put(input('npm publish automation', '实测结论：npm 自动化 token 已不存在，先发布再 trust，浏览器确认即完成，否则返回 E404', { scope: 'global', importance: 0.85 }))
  const result = core.search({ q: '记忆 item 质量如何 是否正确召回' })
  assert.equal(result.total, 0)
  // Bigram overlap still recalls.
  const hit = core.search({ q: 'npm 自动化发布' })
  assert.equal(hit.total, 1)
})

test('core search indexes searchTerms like tags', () => {
  const core = makeCore()
  core.put(input('English title', 'english content only', { searchTerms: ['注入', '召回', 'recall'] }))
  // A Chinese query matches via the generated bilingual searchTerms even though title/content are English.
  const result = core.search({ q: '注入' })
  assert.equal(result.total, 1)
  assert.equal(result.items[0].matchedReason.includes('tag'), true)
})

test('core search requires global memories to match at least two tokens (or title)', () => {
  const core = makeCore()
  core.put(input('Global pref', 'hippomemo stats and events endpoints', { scope: 'global' }))
  core.put(input('Workspace mem', 'hippomemo stats and events endpoints', { scope: 'workspace', workspacePath: '/w' }))
  // Single shared latin token: the global memory is filtered out, the workspace one is not.
  const single = core.search({ q: 'hippomemo', scope: 'current', workspacePath: '/w' })
  assert.equal(single.items.some(hit => hit.record.scope === 'global'), false)
  assert.equal(single.items.some(hit => hit.record.scope === 'workspace'), true)
  // Two shared tokens: the global memory is eligible again.
  const multi = core.search({ q: 'hippomemo stats', scope: 'current', workspacePath: '/w' })
  assert.equal(multi.items.some(hit => hit.record.scope === 'global'), true)
  // A single token matching the global memory's TITLE still counts as a strong signal.
  const titleHit = core.search({ q: 'Global', scope: 'current', workspacePath: '/w' })
  assert.equal(titleHit.items.some(hit => hit.record.scope === 'global'), true)
})

test('core search does not leak stopped-bigram single characters (是否/因为/所以)', () => {
  const core = makeCore()
  core.put(input('Other project', '否则该流程返回失败，因为重试超时', {}))
  // Query shares only 否/因/所 single characters with the memory via stopped bigrams.
  const result = core.search({ q: '是否正确 是否成功' })
  assert.equal(result.total, 0)
})

test('core search updates searchTerms on revision and drops them on delete', () => {
  const core = makeCore()
  const record = core.put(input('A', 'one', { searchTerms: ['alpha'] }))
  assert.equal(core.search({ q: 'alpha' }).total, 1)
  core.update(record.id, { searchTerms: ['beta'] })
  assert.equal(core.search({ q: 'alpha' }).total, 0)
  assert.equal(core.search({ q: 'beta' }).total, 1)
  core.delete(record.id)
  assert.equal(core.search({ q: 'beta' }).total, 0)
})

test('auto-injection gate: unproven global under-recalls, never pollutes', () => {
  const base = {
    id: 'g', kind: 'fact' as const, title: 'G', content: 'c', tags: [], scope: 'global' as const,
    workspacePath: '/a', globalProven: true, importance: 0.5, status: 'active' as const,
    sourceSessionId: 's', revision: 1, updatedBy: 'system' as const, supersedes: null,
    supersededBy: null, createdAt: 1, updatedAt: 1, expiresAt: null, relatedIds: [],
    searchTerms: [], recallCount: 0, lastRecalledAt: null, citationCount: 0, lastCitedAt: null,
  }
  const proven = { ...base, id: 'proven' } as MemoryRecord
  const unproven = { ...base, id: 'unproven', globalProven: false } as MemoryRecord
  const local = { ...base, id: 'local', scope: 'workspace' as const, workspacePath: '/a', globalProven: false } as MemoryRecord

  // In workspace /a: proven global, unproven global (bound to /a), and the /a workspace memory all inject.
  assert.equal(isMemoryAutoInjectable(proven, '/a'), true)
  assert.equal(isMemoryAutoInjectable(unproven, '/a'), true)
  assert.equal(isMemoryAutoInjectable(local, '/a'), true)

  // In the unrelated workspace /b: only the proven global injects — an unproven
  // global degrades to workspace-bound and cannot pollute another workspace.
  assert.equal(isMemoryAutoInjectable(proven, '/b'), true)
  assert.equal(isMemoryAutoInjectable(unproven, '/b'), false)
  assert.equal(isMemoryAutoInjectable(local, '/b'), false)

  // No workspace supplied: only a proven global is injectable.
  assert.equal(isMemoryAutoInjectable(proven, undefined), true)
  assert.equal(isMemoryAutoInjectable(unproven, undefined), false)

  const filtered = filterAutoInjection([
    { record: proven, matchedReason: ['title'] },
    { record: unproven, matchedReason: ['title'] },
    { record: local, matchedReason: ['title'] },
  ], '/b')
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].record.id, 'proven')
})

test('cross-workspace recall accumulates evidence and auto-confirms a global', () => {
  const core = makeCore()
  const g = core.put(input('Shared pref', 'cross workspace tokens', { scope: 'global', workspacePath: '/a' }))
  assert.equal(g.globalProven, false)
  assert.deepEqual(g.seenWorkspaces, ['/a'])

  // Surfaced only in its source workspace: still not proven.
  core.markRecalled([g.id], 1000, '/a')
  assert.equal(core.get(g.id).seenWorkspaces.length, 1)
  assert.equal(core.get(g.id).globalProven, false)

  // One more distinct workspace: evidence grows but the >=3 bar is not met.
  core.markRecalled([g.id], 1001, '/b')
  assert.equal(core.get(g.id).globalProven, false)

  // A third distinct workspace auto-confirms the declared global.
  core.markRecalled([g.id], 1002, '/c')
  assert.equal(core.get(g.id).globalProven, true)

  // A workspace-bound memory never auto-confirms, even across many workspaces.
  const w = core.put(input('Local pref', 'local tokens', { scope: 'workspace', workspacePath: '/x' }))
  core.markRecalled([w.id], 1003, '/x')
  core.markRecalled([w.id], 1004, '/y')
  core.markRecalled([w.id], 1005, '/z')
  assert.equal(core.get(w.id).globalProven, false)

  // Repeated recall in the same workspace does not double-count.
  core.markRecalled([g.id], 1006, '/c')
  assert.equal(core.get(g.id).seenWorkspaces.length, 3)
})
