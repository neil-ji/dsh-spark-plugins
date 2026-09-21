/**
 * 检索与检索词富化回归（Spec §8 A1/A9/A10）。
 *
 * 这一轮修的是一条**生产级静默缺陷**：`searchTerms` 从 F1 起就是 schema 里的正式字段，
 * 但既没有写入路径（`script_save` 没这个入参）也没有读路径（`applyQuery` 不看它）——
 * 典型的"只写不读"字段（与 `triggers` 当年同样的病）。这里逐条钉住修好之后的口径：
 *
 *   - `matchScore` 的字段权重与排序（§5.4 三处共用一个口径）；
 *   - `setSearchTerms` 的三条约束（不动 `updatedAt` / 不派发事件 / 去重封顶）；
 *   - 富化"只填空 + 失败只 warn + 只对 save 触发"（§5.5/D11）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEARCH_FIELD_WEIGHTS,
  matchScore,
  normalizeNeedle,
  searchHits,
} from '../src/retrieval.ts'
import {
  PROMPT_STEPS_MAX_CHARS,
  apply as applyTerms,
  buildSearchTermsPrompt,
  enrichRecord,
  parseSearchTerms,
  resolveConfig as resolveTermsConfig,
} from '../src/terms.ts'
import { registerScriptTools } from '../src/tool.ts'
import { ScriptService } from '../src/script-service.ts'
import { MS_PER_DAY, governanceAdvices } from '../src/governance.ts'
import { NOW, appendRaw, harness, record, seed, type Harness } from './helpers/service-harness.ts'

/**
 * 等富化跑完。
 *
 * 富化是 **fire-and-forget 且内含文件 I/O**（读记录 → 调模型 → 回写），
 * `setTimeout(0)` 这类"一轮微任务"根本不够（实测 calls 仍为 0）。正向断言用轮询，
 * "不该发生"的断言用这个固定的有界等待 —— 两者都不是靠运气。
 */
const settle = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 40)) }

/** 轮询直到条件成立（默认 1s 超时），避免把时序写死进断言。 */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 1_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return true
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return await condition()
}

/* ───────────────────────── 检索口径（§5.4） ───────────────────────── */

test('matchScore：按字段权重累加，未命中为 0（过滤与排序同源）', () => {
  const r = record({
    name: '跑预览自检',
    description: '改完 dev-harness 之后跑一遍',
    tags: ['verify'],
    triggers: ['preview'],
    searchTerms: ['smoke test', '自检'],
  })
  const needle = normalizeNeedle('  SMOKE Test ')
  assert.equal(needle, 'smoke test', '查询归一化：去空白 + 小写')
  assert.equal(matchScore(r, needle), SEARCH_FIELD_WEIGHTS.searchTerms)
  assert.equal(matchScore(r, normalizeNeedle('跑预览')), SEARCH_FIELD_WEIGHTS.name)
  assert.equal(matchScore(r, normalizeNeedle('verify')), SEARCH_FIELD_WEIGHTS.tags)
  assert.equal(matchScore(r, normalizeNeedle('preview')), SEARCH_FIELD_WEIGHTS.triggers)
  assert.equal(matchScore(r, normalizeNeedle('dev-harness')), SEARCH_FIELD_WEIGHTS.description)
  assert.equal(matchScore(r, normalizeNeedle('不存在的词')), 0)
  assert.equal(matchScore(r, ''), 0, '空查询不匹配任何东西')
})

test('matchScore：多字段命中累加；name 命中重过一堆 description 命中', () => {
  const both = record({ name: '闸门', description: '闸门与闸门' })
  assert.equal(matchScore(both, normalizeNeedle('闸门')), SEARCH_FIELD_WEIGHTS.name + SEARCH_FIELD_WEIGHTS.description)
  const nameHit = record({ id: 'a', name: 'preview verify', description: 'x' })
  const descHits = record({ id: 'b', name: 'y', description: 'preview verify preview verify' })
  assert.ok(matchScore(nameHit, 'preview') > matchScore(descHits, 'preview'), '字段权重优先于命中次数')
})

test('searchHits：给出命中的字段与原文（诊断用）', () => {
  const r = record({ name: '部署', description: '上线流程', tags: ['deploy'], searchTerms: ['release'] })
  assert.deepEqual(
    searchHits(r, 'deploy').map(hit => [hit.field, hit.value]),
    [['tags', 'deploy']],
  )
})

/* ───────────────────────── 检索（服务级，A9） ───────────────────────── */

test('searchTerms 真的参与检索：只用同义词也能找到（F1 的死字段修复）', async () => {
  const h = await harness()
  try {
    const target = await seed(h.service, { name: '发版前检查', searchTerms: ['release checklist', '发布清单'] })
    await seed(h.service, { name: '另一个脚本', steps: [{ kind: 'tool-call', payload: 'pnpm other' }] })

    const byEnglish = await h.service.list({ q: 'release' })
    assert.deepEqual(byEnglish.map(item => item.id), [target.id])
    const byChinese = await h.service.list({ q: '发布清单' })
    assert.deepEqual(byChinese.map(item => item.id), [target.id])
    assert.deepEqual((await h.service.list({ q: '没有的词' })), [])
  } finally {
    await h.cleanup()
  }
})

test('排序口径：有 q 按得分倒序（同分按 updatedAt），无 q 按 updatedAt 倒序', async () => {
  const h = await harness()
  try {
    // name 命中（4 分）晚于 description 命中（1 分）创建，但有 q 时必须排在前面。
    const descHit = await seed(h.service, { name: '普通脚本', description: '包含 deploy 这个词', steps: [{ kind: 'tool-call', payload: 'pnpm a' }] })
    const nameHit = await seed(h.service, { name: 'deploy 助手', description: '无关描述', steps: [{ kind: 'tool-call', payload: 'pnpm b' }] })

    assert.deepEqual((await h.service.list({ q: 'deploy' })).map(item => item.name), ['deploy 助手', '普通脚本'])
    // 无 q：仍是 updatedAt 倒序（新写的在前），口径没被检索排序污染。
    const all = await h.service.list({})
    assert.deepEqual(all.map(item => item.name), ['deploy 助手', '普通脚本'])
    assert.ok(nameHit.updatedAt >= descHit.updatedAt)
  } finally {
    await h.cleanup()
  }
})

/* ───────────────────────── 写入检索词（D11 三条约束） ───────────────────────── */

test('setSearchTerms：去重、裁剪、封顶 32；空词表与未知 id 都不写', async () => {
  const h = await harness()
  try {
    const created = await seed(h.service)
    const updated = await h.service.setSearchTerms(created.id, ['  alpha ', 'alpha', '', 'beta'])
    assert.deepEqual(updated?.searchTerms, ['alpha', 'beta'])
    assert.equal(await h.service.setSearchTerms(created.id, []), null, '空词表不写库')
    assert.equal(await h.service.setSearchTerms('missing', ['x']), null)

    const many = Array.from({ length: 40 }, (_, index) => 'term-' + String(index))
    assert.equal((await h.service.setSearchTerms(created.id, many))?.searchTerms?.length, 32)
  } finally {
    await h.cleanup()
  }
})

test('富化写检索词不得推新 updatedAt：僵尸脚本的病据不能被洗掉（D11）', async () => {
  const h = await harness()
  try {
    // 直接落一条"90 天没人碰"的记录（走 appendRaw：save 会把 updatedAt 设成 now）。
    await appendRaw(h.filePath, record({ id: 'stale', name: '陈旧脚本', invocationCount: 0, updatedAt: NOW - 90 * MS_PER_DAY }))
    assert.deepEqual(
      governanceAdvices(await h.service.list({}), NOW).map(advice => advice.kind),
      ['zombie'],
      '前置：这条确实是僵尸候选',
    )

    const before = h.emits.length
    const updated = await h.service.setSearchTerms('stale', ['bilingual', '双语', 'bilingual'])
    assert.deepEqual(updated?.searchTerms, ['bilingual', '双语'])
    assert.equal(updated?.updatedAt, NOW - 90 * MS_PER_DAY, 'updatedAt 必须原样（touch: false）')
    assert.equal(h.emits.length, before, '检索词是索引不是内容修订：一次事件都不派发')
    assert.deepEqual(
      governanceAdvices(await h.service.list({}), NOW).map(advice => advice.kind),
      ['zombie'],
      '僵尸建议不得被富化洗掉',
    )
    assert.ok(matchScore(updated!, normalizeNeedle('bilingual')) > 0, '新词确实进了检索面')
  } finally {
    await h.cleanup()
  }
})

/* ───────────────────────── 写入路径（A9）：工具入参 ───────────────────────── */

test('script_save 工具接受 searchTerms 并落库（此前 schema 有、入参没有 = 死字段）', async () => {
  const h = await harness()
  try {
    const ctx = {
      systemPrompt: { section: () => {} },
      script: h.service,
    }
    const tools = registerScriptTools(ctx as never)
    const saved = await tools.saveTool.execute({
      name: '带同义词的脚本',
      description: '演示检索词入参',
      steps: JSON.stringify([{ kind: 'tool-call', payload: 'pnpm demo' }]),
      searchTerms: 'release checklist, 发布清单',
    }, {} as never) as string
    const parsed = JSON.parse(saved) as { scriptId: string }
    const stored = await h.service.get(parsed.scriptId)
    assert.deepEqual(stored?.searchTerms, ['release checklist', '发布清单'])
    // 命中的是 searchTerms 而不是 name/description/tags
    assert.deepEqual((await h.service.list({ q: 'checklist' })).map(item => item.id), [parsed.scriptId])
  } finally {
    await h.cleanup()
  }
})

/* ───────────────────────── 富化纯函数（A10） ───────────────────────── */

test('buildSearchTermsPrompt：带上名称 / 使用场景 / 步骤，且步骤按预算截断', () => {
  const prompt = buildSearchTermsPrompt({ name: '跑全套闸门', description: '合并前用', stepsText: 'pnpm build\npnpm test' })
  assert.match(prompt.user, /跑全套闸门/)
  assert.match(prompt.user, /合并前用/)
  assert.match(prompt.user, /pnpm build pnpm test/, '步骤折成一行')
  assert.ok(prompt.system.includes('JSON array'))

  const long = buildSearchTermsPrompt({ name: 'x', description: 'y', stepsText: 'a'.repeat(PROMPT_STEPS_MAX_CHARS * 2) })
  assert.ok(long.user.length < PROMPT_STEPS_MAX_CHARS + 100, '步骤超长要截断（别把上下文塞满）')
})

test('parseSearchTerms：容忍前后文、去重、丢弃非字符串与超长项', () => {
  assert.deepEqual(parseSearchTerms('["a", "b"]'), ['a', 'b'])
  assert.deepEqual(parseSearchTerms('结果如下：["a", "a", " b "]'), ['a', 'b'])
  assert.deepEqual(parseSearchTerms('[1, "x", ""]'), ['x'])
  assert.deepEqual(parseSearchTerms('not json'), [])
  assert.deepEqual(parseSearchTerms(JSON.stringify(['ok', 'a'.repeat(51)])), ['ok'])
})

test('resolveTermsConfig：provider/model 必须成对（半截路由比不配更危险）', () => {
  assert.equal(resolveTermsConfig({}).enabled, true)
  assert.throws(() => resolveTermsConfig({ provider: 'p' }), /must be supplied together/)
  assert.throws(() => resolveTermsConfig({ model: 'm' }), /must be supplied together/)
  const resolved = resolveTermsConfig({ provider: 'p', model: 'm', maxTerms: 3 })
  assert.deepEqual([resolved.provider, resolved.model, resolved.maxTerms], ['p', 'm', 3])
})

test('enrichRecord：只填空 / 空结果不写 / 命中就回写', async () => {
  const steps = [{ payload: 'pnpm check:all' }]
  const calls: string[] = []
  const deps = {
    read: async () => ({ name: 'n', description: 'd', steps, searchTerms: [] as string[] }),
    write: async (_id: string, terms: readonly string[]) => { calls.push('write:' + terms.join(',')) },
    generate: async () => { calls.push('generate'); return '["alpha","beta"]' },
    warn: () => {},
  }
  assert.deepEqual(await enrichRecord('s1', deps, resolveTermsConfig({})), ['alpha', 'beta'])
  assert.deepEqual(calls, ['generate', 'write:alpha,beta'])

  // 已有检索词 → 一次模型调用都不该发生
  calls.length = 0
  const filled = { ...deps, read: async () => ({ name: 'n', description: 'd', steps, searchTerms: ['已有'] }) }
  assert.deepEqual(await enrichRecord('s1', filled, resolveTermsConfig({})), [])
  assert.deepEqual(calls, [])

  // 模型没给出可用词 → 不写空数组（避免把字段写成 []）
  calls.length = 0
  const empty = { ...deps, generate: async () => { calls.push('generate'); return '[]' } }
  assert.deepEqual(await enrichRecord('s1', empty, resolveTermsConfig({})), [])
  assert.deepEqual(calls, ['generate'])
})

/* ───────────────────────── 富化事件桥（A10，假 ctx 驱动真实 apply） ───────────────────────── */

/** 造一个假 llm：一次性吐出给定的 JSON 文本（chunk 形状取自 dsh-llm 的 StreamChunk）。 */
function fakeLlm(text: string, counter: { calls: number }): { stream: () => AsyncIterable<unknown> } {
  return {
    stream: () => (async function* () {
      counter.calls += 1
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  }
}

async function termsHarness(text = '["release","发布"]'): Promise<{ h: Harness; counter: { calls: number } }> {
  const h = await harness()
  const counter = { calls: 0 }
  h.ctx['llm'] = fakeLlm(text, counter)
  h.ctx['agentDefaultModel'] = { currentSelection: () => ({ provider: 'fake', model: 'fake-mini' }) }
  applyTerms(h.ctx as never, { enabled: true, maxOutputTokens: 64 })
  return { h, counter }
}

test('富化事件桥：只有 save 触发模型调用，成功后回写检索词且不动 updatedAt', async () => {
  const { h, counter } = await termsHarness()
  try {
    const created = await seed(h.service)
    const before = {...created}
    h.fire('scripts/changed', { at: NOW, operation: 'save', id: created.id })
    const enriched = await waitFor(async () => ((await h.service.get(created.id))?.searchTerms ?? []).length > 0)

    assert.ok(enriched, 'save 应当触发一次富化并回写')
    assert.equal(counter.calls, 1, 'save 触发一次富化调用')
    const stored = await h.service.get(created.id)
    assert.deepEqual(stored?.searchTerms, ['release', '发布'])
    assert.equal(stored?.updatedAt, before.updatedAt, '富化不动 updatedAt')

    // 非 save 事件不该触发（status / invoke / result / expire 都不是新沉淀）
    for (const operation of ['status', 'invoke', 'result', 'expire', 'delete']) {
      h.fire('scripts/changed', { at: NOW, operation, id: created.id })
    }
    await settle()
    assert.equal(counter.calls, 1, '只有 save 会花钱调模型')
  } finally {
    await h.cleanup()
  }
})

test('富化事件桥：已有检索词不再调用模型（幂等 + 防自激）', async () => {
  const { h, counter } = await termsHarness()
  try {
    const created = await seed(h.service, { searchTerms: ['已有词'] })
    h.fire('scripts/changed', { at: NOW, operation: 'save', id: created.id })
    await settle()
    assert.equal(counter.calls, 0)
    assert.deepEqual((await h.service.get(created.id))?.searchTerms, ['已有词'], '不得覆盖人工/agent 给的词')
  } finally {
    await h.cleanup()
  }
})

test('富化事件桥：模型失败只 warn，不影响写入主路径（也不写脏数据）', async () => {
  const h = await harness()
  try {
    h.ctx['llm'] = { stream: () => (async function* () { throw new Error('provider exploded') })() }
    h.ctx['agentDefaultModel'] = { currentSelection: () => ({ provider: 'fake', model: 'fake-mini' }) }
    applyTerms(h.ctx as never, { enabled: true })

    const created = await seed(h.service)
    h.fire('scripts/changed', { at: NOW, operation: 'save', id: created.id })
    await settle()

    assert.ok(h.warnings.some(line => line.includes('script-terms')), JSON.stringify(h.warnings))
    const stored = await h.service.get(created.id)
    assert.equal(stored?.searchTerms, undefined, '失败就不写（不落半个结果）')
    assert.ok(stored !== null, '记录本身还在')
  } finally {
    await h.cleanup()
  }
})

test('富化可关闭：enabled=false 时连事件都不订阅', async () => {
  const h = await harness()
  try {
    const counter = { calls: 0 }
    h.ctx['llm'] = fakeLlm('["x"]', counter)
    h.ctx['agentDefaultModel'] = { currentSelection: () => ({ provider: 'f', model: 'f' }) }
    applyTerms(h.ctx as never, { enabled: false })
    const created = await seed(h.service)
    h.fire('scripts/changed', { at: NOW, operation: 'save', id: created.id })
    await settle()
    assert.equal(counter.calls, 0)
    assert.equal((await h.service.get(created.id))?.searchTerms, undefined)
  } finally {
    await h.cleanup()
  }
})
