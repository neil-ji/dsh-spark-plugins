/**
 * hippomemo 预览 fixture：内存态「假宿主」，按真 wire 形状回答 /hippomemo/*。
 *
 * 这是唯一走 HTTP 的预览数据源——因为 dsh-hippomemo 的 client 半侧本来就用
 * `fetch('/hippomemo/...')`，所以无需改插件代码，服务端换掉数据即可。
 *
 * scenario：ok（默认）· empty（空库）· error（每次调用都失败）。
 */

const WORKSPACE = 'F:\\AgentStudio\\dsh-spark-plugins'
const HOUR = 3600_000
const DAY = 24 * HOUR
const now = Date.now()

/** 一条 MemoryRecord 的完整形状（缺字段会被 UI 当成 undefined 渲染）。 */
function record(input) {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    content: input.content,
    tags: input.tags ?? [],
    scope: input.scope ?? 'workspace',
    workspacePath: input.workspacePath ?? WORKSPACE,
    globalProven: input.globalProven ?? false,
    seenWorkspaces: input.seenWorkspaces ?? [WORKSPACE],
    importance: input.importance ?? 3,
    status: input.status ?? 'active',
    sourceSessionId: input.sourceSessionId ?? 'sess-preview-001',
    sourceAgentId: input.sourceAgentId ?? 'agent-main',
    sourceTurn: input.sourceTurn ?? 4,
    sourceSparkId: input.sourceSparkId ?? null,
    revision: input.revision ?? 1,
    updatedBy: input.updatedBy ?? 'agent',
    supersedes: input.supersedes ?? null,
    supersededBy: input.supersededBy ?? null,
    createdAt: input.createdAt ?? now - 3 * DAY,
    updatedAt: input.updatedAt ?? now - 2 * HOUR,
    expiresAt: input.expiresAt ?? null,
    relatedIds: input.relatedIds ?? [],
    searchTerms: input.searchTerms ?? [],
    modelIds: input.modelIds ?? [],
    recallCount: input.recallCount ?? 0,
    lastRecalledAt: input.lastRecalledAt ?? null,
    citationCount: input.citationCount ?? 0,
    lastCitedAt: input.lastCitedAt ?? null,
  }
}

const SEED = [
  record({
    id: 'mem-dsh-home-isolation', kind: 'decision', importance: 5,
    title: '沙箱开发一律走 DSH_HOME 隔离，绝不碰 ~/.dsh',
    content: '改插件时把 DSH_HOME 指向仓库内 .dev/home，用 devweb profile（3997）验证；3080 是常驻服务，任何验证都不要落在它身上。',
    tags: ['dsh', 'dev-harness', 'isolation'],
    recallCount: 12, lastRecalledAt: now - 40 * 60_000, citationCount: 5, lastCitedAt: now - 2 * HOUR,
  }),
  record({
    id: 'mem-embed-entry', kind: 'insight', importance: 4,
    title: '插件 client UI 一律提供 ./embed 库形态入口',
    content: 'embed 入口无 ModuleLoader banner、不注册槽位，只导出组件 + controller + 字典，让 dock 或预览 harness 自行装配注入面。',
    tags: ['plugin-kit', 'embed', 'architecture'],
    recallCount: 8, lastRecalledAt: now - 3 * HOUR, citationCount: 3, lastCitedAt: now - 6 * HOUR,
  }),
  record({
    id: 'mem-token-first', kind: 'preference', importance: 4,
    title: 'npm 连接器：粘贴 token → 测试 → 保存，之后全权交给 agent',
    content: 'token 存进 credential seam（NPM_TOKEN），UI 只做凭据与只读状态，发布类动作全部走 agent 工具。',
    tags: ['npm', 'credential', 'preference'],
    recallCount: 4, lastRecalledAt: now - 20 * HOUR, citationCount: 1, lastCitedAt: now - DAY,
  }),
  record({
    id: 'mem-peak-hours', kind: 'fact', importance: 3,
    title: 'DeepSeek 计价存在峰谷时段（UTC+8 00:30-08:30 为谷时）',
    content: 'finance 插件的账本按峰/谷/平价三档拆分，峰时迁移可算出 shiftSavingsMicros。',
    tags: ['finance', 'pricing'],
    recallCount: 2, lastRecalledAt: now - 2 * DAY, citationCount: 0,
  }),
  record({
    id: 'mem-dock-single-entry', kind: 'constraint', importance: 4,
    title: '设置页入口统一收敛到 spark-dock 悬浮球',
    content: '四个插件不再各自注册 settings.section，由 dock 内嵌完整设置页；重复注册会与 dock 的字典注册冲突。',
    tags: ['dock', 'constraint', 'ui'],
    recallCount: 6, lastRecalledAt: now - 5 * HOUR, citationCount: 2, lastCitedAt: now - 8 * HOUR,
  }),
  record({
    id: 'mem-version-discipline', kind: 'constraint', importance: 5,
    title: 'tarball 安装路径下改码必须 bump 版本',
    content: 'client-modules 按插件版本缓存产物字节；link 通道不受此限（走内容哈希热替换）。',
    tags: ['release', 'version', 'constraint'],
    recallCount: 9, lastRecalledAt: now - 90 * 60_000, citationCount: 4, lastCitedAt: now - 3 * HOUR,
  }),
  record({
    id: 'mem-stale-proposal', kind: 'insight', importance: 2, status: 'candidate',
    title: '（候选）把 ui-kit 的 Chart 组件抽成独立包',
    content: '目前 Charts 依赖 shiki 等重依赖，抽包可让只用按钮的插件不必引入整棵依赖树。',
    tags: ['ui-kit', 'refactor'],
    recallCount: 0, citationCount: 0, expiresAt: now + 2 * DAY,
  }),
  record({
    id: 'mem-archived-ci', kind: 'fact', importance: 1, status: 'archived',
    title: '（已归档）CI 曾用 ubuntu-20.04 镜像',
    content: '已升级到 ubuntu-24.04，旧 runner 的 node 版本不满足 engines >= 20。',
    tags: ['ci'],
  }),
]

const CITATIONS = [
  { id: 'cit-1', memoryId: 'mem-dsh-home-isolation', sessionId: 'sess-preview-001', kind: 'id-ref', ts: now - 2 * HOUR, snippet: '按 mem-dsh-home-isolation，验证走 3997。' },
  { id: 'cit-2', memoryId: 'mem-version-discipline', sessionId: 'sess-preview-001', kind: 'title-ref', ts: now - 3 * HOUR, snippet: 'tarball 安装路径下改码必须 bump 版本。' },
  { id: 'cit-3', memoryId: 'mem-dock-single-entry', sessionId: 'sess-preview-002', kind: 'link', ts: now - 8 * HOUR },
  { id: 'cit-4', memoryId: 'mem-embed-entry', sessionId: 'sess-preview-002', kind: 'id-ref', ts: now - 6 * HOUR, snippet: '见 mem-embed-entry 的装配约定。' },
]

const PREFERENCES = [
  /* 已确认 = 不再衰减：宿主 computePreferenceDecay 对 global+proven 直接返回 null，
     fixture 也必须是 null（以前这里给 confirmed 项配了 92% 衰减，是宿主产不出来的样本）。 */
  { id: 'mem-token-first', title: 'npm 连接器：粘贴 token → 测试 → 保存，之后全权交给 agent', content: 'token 存进 credential seam，UI 只做凭据与只读状态。', tags: ['npm', 'credential'], source: 'manual', hitCount: 4, lastSurfacedAt: now - 20 * HOUR, decayPercent: null, confirmed: true, status: 'active', updatedAt: now - 20 * HOUR },
  { id: 'mem-terse-replies', title: '回答尽量短，先给结论再给依据', content: '用户偏好中文、先结论后细节、不要客套。', tags: ['style'], source: 'auto', hitCount: 17, lastSurfacedAt: now - 30 * 60_000, decayPercent: 71, confirmed: false, status: 'active', updatedAt: now - 30 * 60_000 },
  { id: 'mem-no-sudo', title: '不要擅自 sudo / 提权', content: '需要提权时先说明原因并等待确认。', tags: ['safety'], source: 'auto', hitCount: 2, lastSurfacedAt: now - 4 * DAY, decayPercent: 38, confirmed: false, status: 'active', updatedAt: now - 4 * DAY },
]

const CANDIDATES = [
  { id: 'mem-stale-proposal', kind: 'observation', title: '（候选）把 ui-kit 的 Chart 组件抽成独立包', reason: '观察期剩余 2 天，期间被引用 0 次', memoryKind: 'insight', suggestedAction: 'probation', expiresAt: now + 2 * DAY, importance: 2, detectedAt: now - HOUR },
  { id: 'mem-dup-home', kind: 'near-duplicate', title: '验证插件务必用隔离 home', reason: '与 mem-dsh-home-isolation 标题/内容高度重合', memoryKind: 'decision', suggestedAction: 'supersede', targetId: 'mem-dsh-home-isolation', importance: 4, detectedAt: now - 3 * HOUR },
  { id: 'mem-expired-ci', kind: 'expired', title: '（已归档）CI 曾用 ubuntu-20.04 镜像', reason: '已过期 6 天', memoryKind: 'fact', suggestedAction: 'archive', importance: 1, detectedAt: now - 6 * DAY },
  { id: 'mem-no-sudo', kind: 'preference-review', title: '不要擅自 sudo / 提权', reason: '衰减到 38%，等待人工确认是否长期保留', memoryKind: 'preference', suggestedAction: 'downgrade-scope', importance: 3, detectedAt: now - DAY },
]

const LAST_EVOLVE = {
  runAt: now - 6 * HOUR,
  dryRun: false,
  actions: [
    { id: 'mem-archived-ci', action: 'archive', reason: '过期 6 天且未被引用' },
    { id: 'mem-dup-home', action: 'supersede', reason: '与 mem-dsh-home-isolation 重复', targetId: 'mem-dsh-home-isolation' },
  ],
  review: [{ id: 'mem-stale-proposal', verdict: 'keep', reason: '重构提案仍有价值，保留观察' }],
}

function buckets(scale = 1) {
  const uncachedInputTokens = Math.round(184_000 * scale)
  const cacheReadTokens = Math.round(1_240_000 * scale)
  const cacheWriteTokens = Math.round(96_000 * scale)
  const outputTokens = Math.round(42_000 * scale)
  return { uncachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens }
}

/** 服务端 fixture 仓库（进程内存态；重启即回到 seed）。 */
export function createHippoStore() {
  let scenario = 'ok'
  let records = SEED.map((item) => ({ ...item, tags: [...item.tags], seenWorkspaces: [...item.seenWorkspaces] }))

  const fail = () => scenario === 'error'
  const error = { code: 'preview-scenario', message: '预览故障注入：hippomemo 数据源被切到 error 场景' }
  const visible = () => (scenario === 'empty' ? [] : records)

  function filterBy(params) {
    let items = visible()
    const q = params.get('q')
    const kind = params.get('kind')
    const status = params.get('status')
    const scope = params.get('scope')
    const tag = params.get('tag')
    const modelId = params.get('modelId')
    if (q !== null && q !== '') {
      const needle = q.toLowerCase()
      items = items.filter((item) => (item.title + ' ' + item.content + ' ' + item.tags.join(' ')).toLowerCase().includes(needle))
    }
    if (kind !== null) items = items.filter((item) => item.kind === kind)
    if (status !== null) items = items.filter((item) => item.status === status)
    if (scope !== null && scope !== 'current') items = items.filter((item) => item.scope === scope)
    if (tag !== null) items = items.filter((item) => item.tags.includes(tag))
    if (modelId !== null) items = items.filter((item) => item.modelIds.includes(modelId))
    const sort = params.get('sort') ?? 'updatedAt'
    const order = params.get('order') ?? 'desc'
    const direction = order === 'asc' ? 1 : -1
    items = [...items].sort((a, b) => {
      const left = a[sort]
      const right = b[sort]
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction
      return String(left).localeCompare(String(right)) * direction
    })
    return items
  }

  return {
    get scenario() { return scenario },
    setScenario(next) {
      scenario = ['ok', 'empty', 'error'].includes(next) ? next : 'ok'
      if (scenario === 'ok' && records.length === 0) {
        records = SEED.map((item) => ({ ...item, tags: [...item.tags], seenWorkspaces: [...item.seenWorkspaces] }))
      }
    },

    list(params) {
      if (fail()) return { ok: false, error }
      const items = filterBy(params)
      const limit = Number(params.get('limit') ?? 20)
      const cursor = Number(params.get('cursor') ?? 0)
      const page = items.slice(cursor, cursor + limit)
      const next = cursor + limit
      return next < items.length ? { items: page, total: items.length, nextCursor: next } : { items: page, total: items.length }
    },

    get(id) {
      if (fail()) return { ok: false, error }
      return visible().find((item) => item.id === id) ?? null
    },

    create(input) {
      if (fail()) return { ok: false, error }
      const created = record({
        ...input,
        id: input.id ?? 'mem-' + Math.random().toString(36).slice(2, 8),
        createdAt: now,
        updatedAt: now,
        revision: 1,
        updatedBy: 'human',
      })
      records = [created, ...records]
      return created
    },

    update(id, patch) {
      if (fail()) return { ok: false, error }
      let updated = null
      records = records.map((item) => {
        if (item.id !== id) return item
        updated = { ...item, ...patch, revision: item.revision + 1, updatedAt: Date.now() }
        return updated
      })
      return updated
    },

    remove(id) {
      if (fail()) return { ok: false, error }
      const before = records.length
      records = records.filter((item) => item.id !== id)
      return records.length < before
    },

    stats() {
      if (fail()) return { ok: false, error }
      const items = visible()
      const byKind = { insight: 0, decision: 0, fact: 0, preference: 0, constraint: 0 }
      for (const item of items) byKind[item.kind] += 1
      return {
        total: items.length,
        active: items.filter((item) => item.status === 'active').length,
        archived: items.filter((item) => item.status === 'archived').length,
        superseded: items.filter((item) => item.status === 'superseded').length,
        candidate: items.filter((item) => item.status === 'candidate').length,
        byKind,
      }
    },

    tags() {
      if (fail()) return { ok: false, error }
      const counts = new Map()
      for (const item of visible()) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count)
    },

    usage() {
      if (fail()) return { ok: false, error }
      const items = visible()
      const recalled = items.filter((item) => item.recallCount > 0)
      const cited = items.filter((item) => item.citationCount > 0)
      const rank = (key, at) => [...items]
        .filter((item) => item[key] > 0)
        .sort((a, b) => b[key] - a[key])
        .slice(0, 5)
        .map((item) => ({ id: item.id, title: item.title, count: item[key], lastAt: item[at] }))
      const staleCutoff = Date.now() - 7 * DAY
      const stale = items
        .filter((item) => item.status === 'active' && (item.lastRecalledAt === null || item.lastRecalledAt < staleCutoff))
        .map((item) => ({ id: item.id, title: item.title, count: item.recallCount, lastAt: item.lastRecalledAt }))
      const total = items.length || 1
      return {
        total: items.length,
        active: items.filter((item) => item.status === 'active').length,
        recalled: recalled.length,
        cited: cited.length,
        neverRecalled: items.length - recalled.length,
        staleCount: stale.length,
        recallRate: recalled.length / total,
        citationRate: cited.length / total,
        conversionRate: recalled.length === 0 ? 0 : cited.length / recalled.length,
        topRecalled: rank('recallCount', 'lastRecalledAt'),
        topCited: rank('citationCount', 'lastCitedAt'),
        stale,
      }
    },

    citations(params) {
      if (fail()) return { ok: false, error }
      const memoryId = params.get('memoryId')
      const kind = params.get('kind')
      let items = scenario === 'empty' ? [] : CITATIONS
      if (memoryId !== null) items = items.filter((item) => item.memoryId === memoryId)
      if (kind !== null) items = items.filter((item) => item.kind === kind)
      const limit = Number(params.get('limit') ?? 20)
      return { items: items.slice(0, limit), total: items.length }
    },

    preferences(params) {
      if (fail()) return { ok: false, error }
      const source = params.get('source')
      const floor = params.get('decayFloor')
      let items = scenario === 'empty' ? [] : PREFERENCES
      if (source !== null) items = items.filter((item) => item.source === source)
      if (floor !== null) items = items.filter((item) => (item.decayPercent ?? 0) <= Number(floor))
      return { items, total: items.length }
    },

    candidates() {
      if (fail()) return { ok: false, error }
      const items = scenario === 'empty' ? [] : CANDIDATES
      const byKind = { expired: 0, 'near-duplicate': 0, observation: 0, 'preference-review': 0 }
      for (const item of items) byKind[item.kind] += 1
      return { items, byKind, total: items.length }
    },

    narrative() {
      if (fail()) return { ok: false, error }
      const latest = scenario === 'empty' ? null : CITATIONS[0]
      return latest === null
        ? { text: '记忆库为空，等待第一条写入', region: 'hippo', ts: Date.now() }
        : {
            text: '海马体调取了「DSH_HOME 隔离」决策，供前额叶参考',
            region: 'hippo',
            ts: latest.ts,
            snippet: latest.snippet,
          }
    },

    evolveLast() {
      if (fail()) return { ok: false, error }
      return scenario === 'empty' ? null : LAST_EVOLVE
    },

    evolve(dryRun) {
      if (fail()) return { ok: false, error }
      return { runAt: Date.now(), dryRun, actions: dryRun ? LAST_EVOLVE.actions : [] }
    },

    /** 供未来 fixture 扩展（当前未用）。 */
    buckets,
  }
}
