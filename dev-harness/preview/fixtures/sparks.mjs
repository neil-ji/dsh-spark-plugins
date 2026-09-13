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
    scope: 'project', workspacePath: WORKSPACE, inboxState: 'pending', tags: ['preview', 'embed', 'architecture'],
    sourceSessionId: 'sess-preview-001', sourceAgentId: 'agent-main', sourceTurn: 6,
    createdAt: now - 3 * HOUR, updatedAt: now - 40 * 60_000, stateChangedAt: now - 3 * HOUR, deletedAt: null, crystallized: null,
  },
  {
    id: 'spk-dock-overlay', title: 'dock 的悬浮球位置与开合状态都落在 localStorage',
    content: 'POS_KEY/OPEN_KEY/ACTIVE_KEY 三个键；拖拽阈值 4px，松手吸附最近角，双击复位。',
    scope: 'project', workspacePath: WORKSPACE, inboxState: 'pending', tags: ['dock', 'ui'],
    sourceSessionId: 'sess-preview-002', sourceAgentId: null, sourceTurn: 3,
    createdAt: now - 8 * HOUR, updatedAt: now - 8 * HOUR, stateChangedAt: now - 8 * HOUR, deletedAt: null, crystallized: null,
  },
  {
    id: 'spk-fake-transport', title: '预览的假 transport 走页面内对象，只有两处是真 HTTP',
    content: 'hippomemo 与 spark 的 client 本来就是 fetch 封装，所以数据源放在预览服务器上更保真。',
    scope: 'global', workspacePath: null, inboxState: 'pending', tags: ['preview', 'fixture'],
    sourceSessionId: 'sess-preview-001', sourceAgentId: 'agent-main', sourceTurn: 9,
    createdAt: now - 2 * DAY, updatedAt: now - DAY, stateChangedAt: now - 2 * DAY, deletedAt: null, crystallized: null,
  },
  {
    id: 'spk-archived-probe', title: '（已归档）用探针插件验证宿主端 HMR',
    content: 'root: ["packages/dsh-spark/lib"] 窄根约 18s ready；整棵仓库要 75s。',
    scope: 'project', workspacePath: WORKSPACE, inboxState: 'archived', tags: ['dev-harness'],
    sourceSessionId: 'sess-preview-003', sourceAgentId: null, sourceTurn: 1,
    createdAt: now - 5 * DAY, updatedAt: now - 4 * DAY, stateChangedAt: now - 4 * DAY, deletedAt: null,
    crystallized: { hippoId: 'mem-dsh-home-isolation', kind: 'decision', at: now - 4 * DAY },
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

const SCRIPTS = [
  {
    id: 'scr-preview-verify', name: '预览自检', description: '跑 Node 冒烟 + 服务器断言，退出码即结论。',
    steps: [
      { kind: 'instruction', payload: 'pnpm preview:verify' },
      { kind: 'tool-call', payload: 'bash: node dev-harness/preview/verify.mjs', note: '失败时看首条 FAIL' },
    ],
    triggers: ['改完 dev-harness/preview', '发版前'], scope: 'project', workspacePath: WORKSPACE,
    invocationCount: 12, successCount: 11, failureCount: 1,
    createdAt: now - 6 * DAY, updatedAt: now - 2 * HOUR, lastInvokedAt: now - 2 * HOUR, sourceSparkId: null,
  },
  {
    id: 'scr-sandbox-up', name: '起沙箱联调', description: '真宿主联调（需要本机 dsh）：初始化 + link + 启动 3997。',
    steps: [
      { kind: 'instruction', payload: 'pnpm sandbox:init' },
      { kind: 'instruction', payload: 'pnpm sandbox:link' },
      { kind: 'tool-call', payload: 'bash: pnpm sandbox:up --detach' },
    ],
    triggers: ['要验证真槽位/真 RPC'], scope: 'project', workspacePath: WORKSPACE,
    invocationCount: 5, successCount: 5, failureCount: 0,
    createdAt: now - 10 * DAY, updatedAt: now - 3 * DAY, lastInvokedAt: now - 3 * DAY, sourceSparkId: null,
  },
]

export function createSparkStore() {
  let scenario = 'ok'
  let sparks = SPARKS.map((item) => ({ ...item, tags: [...item.tags] }))

  const fail = () => scenario === 'error'
  const error = { code: 'preview-scenario', message: '预览故障注入：spark 数据源被切到 error 场景' }

  return {
    get scenario() { return scenario },
    setScenario(next) {
      scenario = ['ok', 'empty', 'error'].includes(next) ? next : 'ok'
      if (scenario === 'ok' && sparks.length === 0) sparks = SPARKS.map((item) => ({ ...item, tags: [...item.tags] }))
    },

    list(params) {
      if (fail()) return { ok: false, error }
      const inboxState = params.get('inboxState')
      const includeDeleted = params.get('includeDeleted') === 'true'
      const limit = Number(params.get('limit') ?? 100)
      let items = scenario === 'empty' ? [] : sparks
      if (!includeDeleted) items = items.filter((item) => item.deletedAt === null)
      if (inboxState !== null) items = items.filter((item) => item.inboxState === inboxState)
      return { ok: true, value: items.slice(0, limit) }
    },

    /** `GET /sparks/stats`：与真宿主 SparkService.stats() 同形（含 pendingProposals）。 */
    stats() {
      if (fail()) return { ok: false, error }
      const live = sparks.filter((item) => item.deletedAt === null)
      const count = (state) => live.filter((item) => item.inboxState === state).length
      const pending = live.filter((item) => item.inboxState === 'pending')
      const pendingProposals = PROPOSALS.filter((item) => item.status === 'pending').length
      return {
        ok: true,
        value: {
          total: live.length,
          pending: count('pending'),
          crystallized: count('crystallized'),
          dropped: count('dropped'),
          archived: count('archived'),
          deleted: sparks.length - live.length,
          oldestPendingAt: pending.length === 0 ? null : Math.min(...pending.map((item) => item.createdAt)),
          pendingProposals: scenario === 'empty' ? 0 : pendingProposals,
        },
      }
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
        inboxState: 'pending',
        tags: [...value.tags],
        sourceSessionId: value.sourceSessionId,
        sourceAgentId: value.sourceAgentId,
        sourceTurn: value.sourceTurn,
        createdAt: Date.now(), updatedAt: Date.now(), stateChangedAt: Date.now(), deletedAt: null, crystallized: null,
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
        const stateChanged = fields.inboxState !== undefined && fields.inboxState !== item.inboxState
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

    crystallize(id) {
      if (fail()) return { ok: false, error }
      const target = sparks.find((item) => item.id === id)
      if (target === undefined) return { ok: false, error: { code: 'not-found', message: id } }
      // 真宿主的 crystallize 会就地改写记录（inboxState + crystallized 链接）。
      const now = Date.now()
      let updated = null
      sparks = sparks.map((item) => {
        if (item.id !== id) return item
        updated = {
          ...item,
          inboxState: 'crystallized',
          stateChangedAt: now,
          updatedAt: now,
          crystallized: { hippoId: 'mem-' + id, kind: 'insight', at: now },
        }
        return updated
      })
      return { ok: true, value: { spark: updated, record: { id: 'mem-' + id, kind: 'insight' } } }
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

    scripts(params) {
      if (fail()) return { ok: false, error }
      const limit = Number(params.get('limit') ?? 50)
      const items = scenario === 'empty' ? [] : SCRIPTS
      return { ok: true, value: items.slice(0, limit) }
    },

    invokeScript(id) {
      if (fail()) return { ok: false, error }
      const target = SCRIPTS.find((item) => item.id === id)
      if (target === undefined) return { ok: false, error: { code: 'not-found', message: id } }
      return { ok: true, value: { invoked: id, steps: target.steps.length } }
    },
  }
}
