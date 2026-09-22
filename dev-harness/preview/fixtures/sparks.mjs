/**
 * spark 预览 fixture：dock 的「火花流 / 涌现提议 / 脚本目录」三个子页的数据源。
 *
 * 与 hippomemo 同理——dock 的 sparkApi 本来就是 `fetch('/sparks...')`，
 * 所以服务端换数据即可，插件代码一行不改。
 *
 * **W4 保真（F14）**：写入路径按 **wire 契约 schema 单源校验**（`dsh-spark-wire`
 * 的 `sparkCaptureSchema` / `sparkPatchSchema`，与真宿主 `SparkService.capture()`
 * 用的是同一份 zod）。此前这里给 `sourceSessionId` 兜默认值，导致「客户端漏传必填
 * 字段」在预览里静默通过、到真宿主才 400 —— 现在预览会以同样的 BAD_REQUEST 拒绝。
 *
 * scenario：ok（默认）· empty（空库）· error（每次调用都失败）。
 */
import { sparkCaptureSchema, sparkPatchSchema } from '../../../packages/dsh-spark-wire/lib/index.js'
// 脚本侧**不手抄口径**：读模型与治理结论直接吃宿主 `dsh-script` 的纯函数叶子模块
// （Node ≥23.6 原生剥类型；`pnpm -r test` 跑 `node --test test/*.ts` 早已要求同一版本）。
// 于是预览里的「退役 / 僵尸 / 降级 / 合并」建议就是**真引擎**算的 —— 预览与真宿主的差
// 只剩传输层，而不是两套会各自漂移的口径（AGENTS §0.5）。
import { auditStats, expiredIds, governanceAdvices } from '../../../packages/dsh-script/src/governance.ts'
import { toSummary } from '../../../packages/dsh-script/src/metrics.ts'
// 检索口径也吃真源：预览的 `q` 过滤/排序必须与宿主 `applyQuery` 完全同源，
// 否则"预览里搜得到、真宿主搜不到"这种漂移只有用户能发现。
import { matchScore, normalizeNeedle } from '../../../packages/dsh-script/src/retrieval.ts'
// 语义召回口径同样吃真源（v2 P13）：预览的 /sparks/search 与真宿主注入面、
// `spark_search` 工具走同一个 selectRelevant —— 否则"预览搜得到、真宿主搜不到"。
import { selectRelevant } from '../../../packages/dsh-spark/src/relevance.ts'

const WORKSPACE = 'F:\\AgentStudio\\dsh-spark-plugins'
const HOUR = 3600_000
const DAY = 24 * HOUR
const now = Date.now()

/** 与真宿主的 BAD_REQUEST 信封同形（`http.ts` 的 errorEnvelope('BAD_REQUEST', …)）。 */
function badRequest(issues) {
  return { code: 'BAD_REQUEST', message: issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join('; ') }
}

const SPARKS = [
  {
    id: 'spk-preview-harness', title: '零 dsh 组件预览可以只靠 embed 产物跑起来',
    content: '四个包的 lib/embed.cjs 都是自包含的，唯一外部依赖是 react；宿主那一半用假 ctx 补上就够了。',
    scope: 'project', workspacePath: WORKSPACE, status: 'active', tags: ['preview', 'embed', 'architecture'],
    origin: 'agent', derivedFrom: [], generation: 0,
    sourceSessionId: 'sess-preview-001', sourceAgentId: 'agent-main', sourceTurn: 6,
    createdAt: now - 3 * HOUR, updatedAt: now - 40 * 60_000, stateChangedAt: now - 3 * HOUR, deletedAt: null,
  },
  {
    id: 'spk-dock-overlay', title: 'dock 的悬浮球位置与开合状态都落在 localStorage',
    content: 'POS_KEY/OPEN_KEY/ACTIVE_KEY 三个键；拖拽阈值 4px，松手吸附最近角，双击复位。',
    scope: 'project', workspacePath: WORKSPACE, status: 'active', tags: ['dock', 'ui'],
    origin: 'human', derivedFrom: [], generation: 0,
    sourceSessionId: 'sess-preview-002', sourceAgentId: null, sourceTurn: 3,
    createdAt: now - 8 * HOUR, updatedAt: now - 8 * HOUR, stateChangedAt: now - 8 * HOUR, deletedAt: null,
  },
  {
    id: 'spk-fake-transport', title: '预览的假 transport 走页面内对象，只有两处是真 HTTP',
    content: 'hippomemo 与 spark 的 client 本来就是 fetch 封装，所以数据源放在预览服务器上更保真。',
    scope: 'global', workspacePath: null, status: 'active', tags: ['preview', 'fixture'],
    origin: 'agent', derivedFrom: [], generation: 0,
    sourceSessionId: 'sess-preview-001', sourceAgentId: 'agent-main', sourceTurn: 9,
    createdAt: now - 2 * DAY, updatedAt: now - DAY, stateChangedAt: now - 2 * DAY, deletedAt: null,
  },
  {
    id: 'spk-archived-probe', title: '（已归档）用探针插件验证宿主端 HMR',
    content: 'root: ["packages/dsh-spark/lib"] 窄根约 18s ready；整棵仓库要 75s。',
    scope: 'project', workspacePath: WORKSPACE, status: 'archived', tags: ['dev-harness'],
    origin: 'human', derivedFrom: [], generation: 0,
    sourceSessionId: 'sess-preview-003', sourceAgentId: null, sourceTurn: 1,
    createdAt: now - 5 * DAY, updatedAt: now - 4 * DAY, stateChangedAt: now - 4 * DAY, deletedAt: null,
  },
]

const PROPOSALS = [
  {
    id: 'prp-cluster-preview', type: 'cluster', sparkIds: ['spk-preview-harness', 'spk-fake-transport'],
    explanation: '两条都在讲"预览的数据从哪来"，可聚成一条「预览数据源分层」结论。',
    confidence: 0.72, leverage: 'high', status: 'pending', createdAt: now - 90 * 60_000, resolvedAt: null,
  },
  {
    id: 'prp-link-dock', type: 'link', sparkIds: ['spk-dock-overlay', 'spk-preview-harness'],
    explanation: 'dock 悬浮球是预览的默认画布，两条互相引用。',
    confidence: 0.48, leverage: 'medium', status: 'pending', createdAt: now - 5 * HOUR, resolvedAt: null,
  },
  {
    id: 'prp-prune-old', type: 'prune', sparkIds: ['spk-archived-probe'],
    explanation: '已归档且 4 天未被引用，建议剪枝。',
    confidence: 0.61, leverage: 'low', status: 'dismissed', createdAt: now - 2 * DAY, resolvedAt: now - DAY,
  },
]

/**
 * 脚本 fixture（治理面的素材）：每一条都刻意命中（或刻意不命中）一类建议，
 * 这样预览/真宿主里能同时看到四种待裁决项与各种状态。
 */
function scriptView(overrides) {
  const createdAt = overrides.createdAt ?? now - 6 * DAY
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description ?? '预览夹具：' + overrides.name,
    steps: overrides.steps ?? [{ kind: 'tool-call', payload: 'bash: echo ' + overrides.id }],
    triggers: overrides.triggers ?? ['预览夹具', overrides.id],
    tags: overrides.tags ?? ['preview'],
    // 检索词：可选字段（不给就不写，与 schema 的 `.optional()` 一致）。
    // **曾经漏了这一行**：夹具 helper 逐字段枚举，新增字段不显式透传就会被静默丢掉 ——
    // 表现为"夹具里写了 searchTerms，但检索永远搜不到"，preview:verify 当场抓出来。
    ...(overrides.searchTerms === undefined ? {} : { searchTerms: overrides.searchTerms }),
    scope: overrides.scope ?? 'workspace',
    workspacePath: overrides.workspacePath ?? WORKSPACE,
    status: overrides.status ?? 'active',
    revision: overrides.revision ?? 1,
    supersedes: overrides.supersedes ?? null,
    supersededBy: overrides.supersededBy ?? null,
    updatedBy: overrides.updatedBy ?? 'agent',
    sourceSessionId: overrides.sourceSessionId ?? 'preview-session',
    sourceAgentId: overrides.sourceAgentId ?? null,
    sourceTurn: overrides.sourceTurn ?? null,
    invocationCount: overrides.invocationCount ?? 0,
    successCount: overrides.successCount ?? 0,
    failureCount: overrides.failureCount ?? 0,
    invokedWorkspaces: overrides.invokedWorkspaces ?? [],
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    expiresAt: overrides.expiresAt ?? null,
    lastInvokedAt: overrides.lastInvokedAt ?? null,
  }
}

const SCRIPTS = [
  scriptView({
    id: 'scr-preview-verify',
    name: '预览自检',
    description: '跑 Node 冒烟 + 服务器断言，退出码即结论。',
    steps: [
      { kind: 'instruction', payload: '在仓库根执行 pnpm preview:verify' },
      { kind: 'tool-call', payload: 'bash: node dev-harness/preview/verify.mjs', note: '失败时看首条 FAIL' },
      { kind: 'instruction', payload: '验收：退出码 0 且 FAIL 计数为 0' },
    ],
    triggers: ['改完 dev-harness/preview', '发版前'],
    searchTerms: ['smoke test', 'preview self-check', '预览自检'],
    scope: 'project',
    invocationCount: 12, successCount: 11, failureCount: 1,
    invokedWorkspaces: [WORKSPACE],
    createdAt: now - 6 * DAY, updatedAt: now - 2 * HOUR, lastInvokedAt: now - 2 * HOUR,
  }),
  scriptView({
    id: 'scr-sandbox-up',
    name: '起沙箱联调',
    description: '真宿主联调（需要本机 dsh）：初始化 + link + 启动 3997。',
    steps: [
      { kind: 'instruction', payload: '先跑 pnpm sandbox:init 准备沙箱 home' },
      { kind: 'instruction', payload: '再跑 pnpm sandbox:link 把工作区包链进 profile' },
      { kind: 'tool-call', payload: 'bash: pnpm sandbox:up --detach' },
    ],
    triggers: ['要验证真槽位/真 RPC'],
    scope: 'project',
    invocationCount: 5, successCount: 5,
    invokedWorkspaces: [WORKSPACE],
    createdAt: now - 10 * DAY, updatedAt: now - 3 * DAY, lastInvokedAt: now - 3 * DAY,
  }),
  // 退役候选：调用够多但成功率 1/6
  scriptView({
    id: 'scr-retire-me',
    name: '过期的构建诀窍',
    description: '早年的一条构建流程，成功率已经掉到 17%。',
    searchTerms: ['legacy build tips', '旧构建诀窍'],
    invocationCount: 6, successCount: 1, failureCount: 5,
    invokedWorkspaces: [WORKSPACE],
    createdAt: now - 40 * DAY, updatedAt: now - 5 * DAY, lastInvokedAt: now - 5 * DAY,
  }),
  // 僵尸：活跃、从没被调用、90 天没动
  scriptView({
    id: 'scr-zombie',
    name: '没人用的探查脚本',
    description: '写好之后再没被调用过。',
    createdAt: now - 120 * DAY, updatedAt: now - 90 * DAY,
  }),
  // 降级候选：号称全局，却只在一个工作区被调用过
  scriptView({
    id: 'scr-global-one-ws',
    name: '假装全局的流程',
    description: '标了 global，但调用证据只有一个工作区。',
    scope: 'global',
    invocationCount: 3, successCount: 3,
    invokedWorkspaces: [WORKSPACE],
    createdAt: now - 20 * DAY, updatedAt: now - 4 * DAY, lastInvokedAt: now - 4 * DAY,
  }),
  // 重复对：同名 + 同步骤 + 同 triggers → 对**较新**的一条提合并建议
  scriptView({
    id: 'scr-dup-keep',
    name: '跑预览自检',
    description: '旧的一条：保留为留存者。',
    steps: [{ kind: 'tool-call', payload: 'bash: pnpm preview:verify' }],
    triggers: ['预览'],
    createdAt: now - 30 * DAY, updatedAt: now - 20 * DAY,
    invocationCount: 2, successCount: 2, invokedWorkspaces: [WORKSPACE],
  }),
  scriptView({
    id: 'scr-dup-lose',
    name: '跑预览自检',
    description: '新的一条：同名的重复。',
    steps: [{ kind: 'tool-call', payload: 'bash: pnpm preview:verify' }],
    triggers: ['预览'],
    createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY,
  }),
  // 已归档：状态分布 + 恢复/删除动作的素材
  scriptView({
    id: 'scr-archived',
    name: '归档掉的旧脚本',
    description: '已经被人工归档，只等清理。',
    status: 'archived',
    createdAt: now - 60 * DAY, updatedAt: now - 30 * DAY,
  }),
  // 已过期但仍是 active：POST /scripts/sweep 会把它结算为 archived
  scriptView({
    id: 'scr-expired',
    name: '到期未结算的脚本',
    description: 'expiresAt 已过：打开治理面时应当被自动归档。',
    expiresAt: now - DAY,
    createdAt: now - 15 * DAY, updatedAt: now - 15 * DAY,
  }),
]

export function createSparkStore() {
  let scenario = 'ok'
  let sparks = SPARKS.map((item) => ({ ...item, tags: [...item.tags] }))
  // 脚本库是**可变**的：sweep / 状态动作 / 删除都会改它（与真宿主的 JSONL 语义同形）。
  let scripts = SCRIPTS.map((item) => ({ ...item, steps: [...item.steps], triggers: [...item.triggers], tags: [...item.tags], invokedWorkspaces: [...item.invokedWorkspaces] }))

  const fail = () => scenario === 'error'
  const error = { code: 'preview-scenario', message: '预览故障注入：spark 数据源被切到 error 场景' }

  return {
    get scenario() { return scenario },
    setScenario(next) {
      scenario = ['ok', 'empty', 'error'].includes(next) ? next : 'ok'
      if (scenario === 'ok' && sparks.length === 0) sparks = SPARKS.map((item) => ({ ...item, tags: [...item.tags] }))
      if (scenario === 'ok' && scripts.length !== SCRIPTS.length) {
        scripts = SCRIPTS.map((item) => ({ ...item, steps: [...item.steps], triggers: [...item.triggers], tags: [...item.tags], invokedWorkspaces: [...item.invokedWorkspaces] }))
      }
    },

    list(params) {
      if (fail()) return { ok: false, error }
      const status = params.get('status')
      const includeDeleted = params.get('includeDeleted') === 'true'
      const limit = Number(params.get('limit') ?? 100)
      let items = scenario === 'empty' ? [] : sparks
      if (!includeDeleted) items = items.filter((item) => item.deletedAt === null)
      if (status !== null) items = items.filter((item) => item.status === status)
      return { ok: true, value: items.slice(0, limit) }
    },

    /** `GET /sparks/stats`：与真宿主 SparkService.stats() 同形（含 pendingProposals）。 */
    stats() {
      if (fail()) return { ok: false, error }
      const live = sparks.filter((item) => item.deletedAt === null)
      const count = (state) => live.filter((item) => item.status === state).length
      const active = live.filter((item) => item.status === 'active')
      const pendingProposals = PROPOSALS.filter((item) => item.status === 'pending').length
      return {
        ok: true,
        value: {
          total: live.length,
          active: count('active'),
          archived: count('archived'),
          deleted: sparks.length - live.length,
          oldestActiveAt: active.length === 0 ? null : Math.min(...active.map((item) => item.createdAt)),
          pendingProposals: scenario === 'empty' ? 0 : pendingProposals,
        },
      }
    },

    /** `GET /sparks/search?q=&limit=`（只读，v2 P13）。 */
    search(params) {
      if (fail()) return { ok: false, error }
      const q = params.get('q') ?? ''
      const limit = Number(params.get('limit') ?? 5)
      const pool = (scenario === 'empty' ? [] : sparks).filter((item) => item.deletedAt === null && item.status === 'active')
      return { ok: true, value: selectRelevant(pool, q, { limit: Number.isFinite(limit) ? limit : 5, minScore: 0 }).map((entry) => entry.spark) }
    },

    capture(input) {
      if (fail()) return { ok: false, error }
      // 真宿主 SparkService.capture() 的第一件事就是 `sparkCaptureSchema.parse(input)`
      // （required: title/content/sourceSessionId…）。预览必须同样严格，否则
      // 「漏传必填字段」这类回归只有在真宿主才暴露（F14）。
      const parsed = sparkCaptureSchema.safeParse(input)
      if (!parsed.success) return { ok: false, error: badRequest(parsed.error.issues) }
      const value = parsed.data
      const created = {
        id: 'spk-' + Math.random().toString(36).slice(2, 8),
        title: value.title,
        content: value.content,
        scope: value.scope,
        workspacePath: value.workspacePath,
        status: 'active',
        origin: value.origin ?? (value.sourceAgentId !== null ? 'agent' : 'human'),
        derivedFrom: value.derivedFrom ?? [],
        generation: 0,
        tags: [...value.tags],
        sourceSessionId: value.sourceSessionId,
        sourceAgentId: value.sourceAgentId,
        sourceTurn: value.sourceTurn,
        createdAt: Date.now(), updatedAt: Date.now(), stateChangedAt: Date.now(), deletedAt: null,
      }
      sparks = [created, ...sparks]
      return { ok: true, value: created }
    },

    patch(id, patch) {
      if (fail()) return { ok: false, error }
      const parsed = sparkPatchSchema.safeParse(patch)
      if (!parsed.success) return { ok: false, error: badRequest(parsed.error.issues) }
      const fields = parsed.data
      let updated = null
      sparks = sparks.map((item) => {
        if (item.id !== id) return item
        const stateChanged = fields.status !== undefined && fields.status !== item.status
        updated = {
          ...item,
          ...fields,
          ...(stateChanged ? { stateChangedAt: Date.now() } : {}),
          updatedAt: Date.now(),
        }
        return updated
      })
      return updated === null ? { ok: false, error: { code: 'not-found', message: id } } : { ok: true, value: updated }
    },

    /** `POST /sparks/:id/restore`：从墓碑恢复。 */
    restore(id) {
      if (fail()) return { ok: false, error }
      let restored = null
      sparks = sparks.map((item) => {
        if (item.id !== id) return item
        restored = { ...item, deletedAt: null, updatedAt: Date.now() }
        return restored
      })
      return restored === null ? { ok: false, error: { code: 'not-found', message: id } } : { ok: true, value: restored }
    },

    /** `POST /sparks/:id`（DELETE 未走这里）：软删除成墓碑，供「最近删除」视图断言。 */
    remove(id) {
      if (fail()) return { ok: false, error }
      let removed = false
      sparks = sparks.map((item) => {
        if (item.id !== id || item.deletedAt !== null) return item
        removed = true
        return { ...item, deletedAt: Date.now(), updatedAt: Date.now() }
      })
      return removed ? { ok: true, value: { removed } } : { ok: false, error: { code: 'not-found', message: id } }
    },


    proposals(params) {
      if (fail()) return { ok: false, error }
      const status = params.get('status')
      const limit = Number(params.get('limit') ?? 100)
      let items = scenario === 'empty' ? [] : PROPOSALS
      if (status !== null) items = items.filter((item) => item.status === status)
      return { ok: true, value: items.slice(0, limit) }
    },

    resolveProposal(id, status) {
      if (fail()) return { ok: false, error }
      const target = PROPOSALS.find((item) => item.id === id)
      if (target === undefined) return { ok: false, error: { code: 'not-found', message: id } }
      return { ok: true, value: { ...target, status, resolvedAt: Date.now() } }
    },

    reflect() {
      if (fail()) return { ok: false, error }
      return { ok: true, value: { created: 2, skipped: 1 } }
    },

    /* ─────────────── 脚本沉淀库（读模型 + 治理面，口径吃真引擎） ─────────────── */

    /** `GET /scripts`：与真宿主同形的**读模型**（不含 steps，带宿主算好的 successRate）。 */
    scripts(params) {
      if (fail()) return { ok: false, error }
      const limit = Number(params.get('limit') ?? 50)
      let items = scenario === 'empty' ? [] : scripts
      const status = params.get('status')
      if (status !== null) items = items.filter((item) => item.status === status)
      const scope = params.get('scope')
      if (scope !== null) items = items.filter((item) => item.scope === scope)
      const needle = normalizeNeedle(params.get('q') ?? '')
      if (needle.length > 0) {
        // 与宿主 `applyQuery` 同一算法：过滤与排序都由 matchScore 一个口径决定（Spec §5.4）。
        const scored = items
          .map((item) => ({ item, score: matchScore(item, needle) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
        return { ok: true, value: scored.slice(0, limit).map((entry) => toSummary(entry.item)) }
      }
      // 无 q：与宿主同序（updatedAt 倒序）。
      items = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
      return { ok: true, value: items.slice(0, limit).map((item) => toSummary(item)) }
    },

    /** 一条脚本的全文（含 steps）；人面看步骤走这条，**不计量**（Spec D9）。 */
    scriptDetail(id) {
      if (fail()) return { ok: false, error }
      const target = scripts.find((item) => item.id === id)
      if (target === undefined) return { ok: false, error: { code: 'not-found', message: id } }
      return { ok: true, value: target }
    },

    /** `GET /scripts/audit`（只读）与 `POST /scripts/sweep`（先结算过期）同形。 */
    scriptAudit(settle) {
      if (fail()) return { ok: false, error }
      let archived = 0
      if (settle === true && scenario !== 'empty') {
        const ids = expiredIds(scripts, Date.now())
        for (const id of ids) {
          const target = scripts.find((item) => item.id === id)
          if (target !== undefined) { target.status = 'archived'; target.updatedAt = Date.now() }
        }
        archived = ids.length
      }
      const at = Date.now()
      const live = scenario === 'empty' ? [] : scripts
      return {
        ok: true,
        value: { settledAt: at, archived, stats: auditStats(live, at), advices: governanceAdvices(live, at) },
      }
    },

    /** 状态迁移（归档 / 恢复 / 取代）；取代必须带 supersededBy（Spec INV-11）。 */
    setScriptStatus(id, status, supersededBy) {
      if (fail()) return { ok: false, error }
      const target = scripts.find((item) => item.id === id)
      if (target === undefined) return { ok: false, error: { code: 'not-found', message: id } }
      if (status === 'superseded' && (supersededBy === null || supersededBy === undefined)) {
        return { ok: false, error: { code: 'BAD_REQUEST', message: 'script: superseded 必须带 supersededBy（取代链不能断）' } }
      }
      target.status = status
      if (status === 'superseded') target.supersededBy = supersededBy
      target.updatedAt = Date.now()
      return { ok: true, value: target }
    },

    /** 改作用域（降级建议的落点）。 */
    setScriptScope(id, scope) {
      if (fail()) return { ok: false, error }
      const target = scripts.find((item) => item.id === id)
      if (target === undefined) return { ok: false, error: { code: 'not-found', message: id } }
      target.scope = scope
      target.updatedAt = Date.now()
      return { ok: true, value: target }
    },

    /** 物理删除：只有已归档条目可删（Spec INV-11）。 */
    removeScript(id) {
      if (fail()) return { ok: false, error }
      const index = scripts.findIndex((item) => item.id === id)
      if (index < 0) return { ok: true, value: { removed: false } }
      if (scripts[index].status !== 'archived') return { ok: false, error: { code: 'CONFLICT', message: 'only archived scripts can be purged' } }
      scripts.splice(index, 1)
      return { ok: true, value: { removed: true } }
    },

    invokeScript(id) {
      if (fail()) return { ok: false, error }
      const target = scripts.find((item) => item.id === id)
      if (target === undefined) return { ok: false, error: { code: 'not-found', message: id } }
      return { ok: true, value: { invoked: id, steps: target.steps.length } }
    },
  }
}
