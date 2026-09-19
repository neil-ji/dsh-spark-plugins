/**
 * 财务面板控制器：一个 snapshot store 覆盖 finance Remote + 套餐设置面。
 *
 * 重建后它**不再**持有配置草稿、本地 provider 覆盖层或余额峰值基线（那些面已删除）。
 * 只做四件事：加载 ledger + provider 列表、单 provider 余额刷新、把首次回填进度
 * （finance/events stream）落进快照、记录最近一次社区价格同步时间（脚注用）；
 * P1 起再加一件：把 `finance.plans`（静态套餐，用户填一次）读进快照并写回。
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
// F12：失败文案与信封拆解只从 kit 取一处实现。
import { messageOf, remoteFailureOf } from 'dsh-spark-plugin-kit/client'
import type { FinanceProviderEntryPatch } from './plans.ts'
import type {
  FinanceBackfillProgress,
  FinanceLedger,
  FinanceListProvidersResult,
  FinancePlanEntry,
  FinanceProviderBalance,
  FinanceProviderBillingMode,
  FinancePriceTableStatus,
  FinanceTierEntry,
} from 'dsh-spark-finance/types'
import { providerKey } from './derive.ts'

export interface FinancePanelState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  ledger?: FinanceLedger
  providerList?: FinanceListProvidersResult
  error: string | null
  /** 首次回填进度（宿主推流；只有 loading 期间会用到）。 */
  progress?: FinanceBackfillProgress
  /**
   * 初始化小字日志（宿主逐行推送的后台动作行，客户端只累积呈现）。
   * 上限 50 行，渲染层自行取尾部；loading 结束随快照一起清空。
   */
  progressLines: readonly string[]
  /** 最近一次成功的社区价格同步（epoch ms）；undefined = 从未同步。 */
  lastSyncAppliedAt?: number
  /** 价格表状态（基础快照完整性 + 覆盖层 + 被形状守卫拒绝的键）。 */
  priceTable?: FinancePriceTableStatus
  /** 价格表操作进行中（更新 / 还原）。可选：旧测试夹具不必补该字段。 */
  priceBusy?: boolean
  /** 价格表操作失败信息；不改账本状态，只在价格行显示。 */
  priceError?: string | null
  /** 静态套餐定义（`finance.plans`，用户填一次）。 */
  plans: readonly FinancePlanEntry[]
  /** context 阶梯价（`finance.tiers`，按 modelKey）；空 = 没有阶梯价可算。 */
  tiers: Record<string, readonly FinanceTierEntry[]>
  /** 设置文档是否接受写入；memory 模式下为 false（面板显示只读提示）。 */
  plansWritable: boolean
}

type FinanceRemote = ClientRemote['finance']

/**
 * `finance` 命名空间的设置面（套餐 + 阶梯价）：由挂载层（dock 模块）从
 * `ctx.settingsScope('finance')` 组装。只有"读快照 + 整写 plans"两条写能力；
 * 阶梯价是只读的（它属于价格事实，不是面板该编辑的东西）。
 */
export interface FinancePlanSeam {
  getSnapshot(): { plans: readonly FinancePlanEntry[]; tiers: Record<string, readonly FinanceTierEntry[]>; writable: boolean }
  subscribe(listener: () => void): () => void
  /** 整体写回 `plans` 字段（settings 的一次原子写）。 */
  write(plans: readonly FinancePlanEntry[]): Promise<void>
  /**
   * 只写某个 provider 的计费方式标记（订阅 / 按量 / 免费）。窄写：只碰
   * `providers[i].billingMode` 这一个字段，其余字段原样保留。
   */
  writeBillingMode(provider: string, mode: FinanceProviderBillingMode): Promise<void>
  /**
   * 待定池打标（SPEC §5.4）：计费方式 + 可选手动余额 / autoFetch 勾选，
   * 一次 settings 原子写。新建条目时补齐宿主要求的默认字段。
   */
  writeProviderEntry(provider: string, patch: FinanceProviderEntryPatch): Promise<void>
}

/** 一个面板实例一个控制器；不做模块级单例。 */
export class FinancePanelController {
  readonly store: SnapshotStore<FinancePanelState> = createSnapshotStore<FinancePanelState>({
    status: 'idle',
    error: null,
    plans: [],
    tiers: {},
    plansWritable: false,
    priceBusy: false,
    priceError: null,
    progressLines: [],
  })
  private generation = 0
  private readonly seam: FinancePlanSeam | undefined
  private readonly disposeSeam: (() => void) | undefined

  constructor(private readonly remote: FinanceRemote, seam?: FinancePlanSeam) {
    this.seam = seam
    if (seam !== undefined) {
      const sync = (): void => {
        const snapshot = seam.getSnapshot()
        this.store.update((state) => {
          state.plans = snapshot.plans
          state.tiers = snapshot.tiers
          state.plansWritable = snapshot.writable
        })
      }
      sync()
      this.disposeSeam = seam.subscribe(sync)
    }
  }

  /** 卸载时释放设置订阅（挂载层在 ctx.effect 的 disposer 里调用）。 */
  dispose(): void {
    this.disposeSeam?.()
  }

  /** 宿主推来的回填进度帧（dock 模块订阅 finance/events 后调用）。 */
  setProgress(progress: FinanceBackfillProgress): void {
    this.store.update((state) => {
      state.progress = progress
      // 动作日志逐行累积（同一行去重：宿主会为同一进度快照重复推帧）。
      if (progress.line !== undefined && state.progressLines[state.progressLines.length - 1] !== progress.line) {
        const next = [...state.progressLines, progress.line]
        state.progressLines = next.length > 50 ? next.slice(next.length - 50) : next
      }
    })
  }

  /** 拉 ledger + provider 列表；失败保留上次快照，只切状态与错误文案。 */
  async load(): Promise<void> {
    const generation = ++this.generation
    const firstLoad = this.store.getSnapshot().ledger === undefined
    this.store.update((state) => {
      state.status = firstLoad ? 'loading' : 'ready'
      state.error = null
      if (firstLoad) {
        state.progress = undefined
        state.progressLines = []
      }
    })
    try {
      const [listResult, ledgerResult] = await Promise.all([
        this.remote.listProviders(),
        this.remote.getLedger(),
      ])
      if (generation !== this.generation) return
      const listFailure = remoteFailureOf(listResult)
      if (listFailure !== undefined || !listResult.ok) {
        this.fail(listFailure ?? 'listProviders failed')
        return
      }
      const ledgerFailure = remoteFailureOf(ledgerResult)
      if (ledgerFailure !== undefined || !ledgerResult.ok) {
        this.fail(ledgerFailure ?? 'getLedger failed')
        return
      }
      this.store.update((state) => {
        state.status = 'ready'
        state.providerList = listResult.value
        state.ledger = ledgerResult.value
        state.error = null
        state.progress = undefined
        state.progressLines = []
      })
      void this.refreshPriceTable(generation)
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(messageOf(error))
    }
  }

  /**
   * 单 provider 余额刷新：host 侧绕过 autoFetch 开关（用户明确点了按钮）。
   * 只替换那一行的 balance 槽，失败保留旧值、不打断整页。
   */
  async refreshProvider(provider: string): Promise<void> {
    try {
      const result = await this.remote.refreshBalance({ provider })
      if (!result.ok) return
      const slot: FinanceProviderBalance = result.value
      this.store.update((state) => {
        const list = state.providerList
        if (list === undefined) return
        state.providerList = {
          ...list,
          providers: list.providers.map((row) => (row.provider === provider ? { ...row, balance: slot } : row)),
        }
      })
    } catch {
      // 单卡刷新失败：保留旧快照，用户可再点一次。
    }
  }

  /** 保存一条套餐（同 provider 覆盖）。设置不可写时写回会被 host 拒绝。 */
  async savePlan(plan: FinancePlanEntry): Promise<void> {
    if (this.seam === undefined) return
    const rest = this.store.getSnapshot().plans.filter((row) => providerKey(row.provider) !== providerKey(plan.provider))
    await this.seam.write([...rest, plan])
  }

  /**
   * 给某个 provider 打「订阅 / 按量 / 免费」标记（写 settings → 宿主折叠进
   * hostMetaByProvider → 账本按新分类重算），然后重新拉账本。
   */
  async setBillingMode(provider: string, mode: FinanceProviderBillingMode): Promise<void> {
    if (this.seam === undefined) return
    await this.seam.writeBillingMode(provider, mode)
    await this.load()
  }

  /**
   * 打标（SPEC §5.4 两池）：订阅带月费走 plans 写入，按量带手动余额走
   * providers 条目写入；写完重拉账本与余额刷新两池归属。
   */
  async tagProvider(provider: string, patch: FinanceProviderEntryPatch, monthlyPlan?: FinancePlanEntry): Promise<void> {
    if (this.seam === undefined) return
    await this.seam.writeProviderEntry(provider, patch)
    if (patch.mode === 'plan' && monthlyPlan !== undefined) await this.savePlan(monthlyPlan)
    await this.load()
  }

  /** 删除一条套餐。 */
  async removePlan(provider: string): Promise<void> {
    if (this.seam === undefined) return
    const rest = this.store.getSnapshot().plans.filter((row) => providerKey(row.provider) !== providerKey(provider))
    await this.seam.write(rest)
  }

  /**
   * 价格表状态（尽力而为，失败不动快照）：基础快照的日期/来源/完整性 + 覆盖层 +
   * 被形状守卫拒绝的键。一次 RPC 拿全，脚注与"未生效键"列表共用同一份数据。
   */
  private async refreshPriceTable(generation: number): Promise<void> {
    try {
      const result = await this.remote.getPriceTableStatus()
      if (generation !== this.generation || !result.ok) return
      const table = result.value
      this.store.update((state) => {
        state.priceTable = table
        state.lastSyncAppliedAt = table.overlay?.appliedAt
      })
    } catch {
      // 脚注不是关键路径。
    }
  }

  /** 一键更新价格表：拉最新目录价 → 覆盖层原子替换 → 刷新状态与账本（SPEC §5.1）。 */
  async updatePrices(): Promise<void> {
    await this.runPriceAction(async () => {
      // 平台客户端会校验 arity：这条端点在 wire 上声明了 1 个业务参数，必须显式传（空对象即默认值）。
      const result = await this.remote.syncCommunityPrices({})
      return { ok: result.ok, failure: remoteFailureOf(result) }
    }, 'syncCommunityPrices failed')
  }

  /** 还原到发版快照：丢弃用户侧覆盖（SPEC §5.1）。 */
  async restorePrices(): Promise<void> {
    await this.runPriceAction(async () => {
      const result = await this.remote.clearPriceOverlay()
      return { ok: result.ok, failure: remoteFailureOf(result) }
    }, 'clearPriceOverlay failed')
  }

  /**
   * 两个价格动作共用的一条路径：失败**保留原快照**并只写 priceError（不把整个面板切到错误态），
   * 成功则刷新状态与账本。原子性由宿主保证（拉取失败不替换覆盖层）。
   */
  private async runPriceAction(
    run: () => Promise<{ ok: boolean; failure: string | undefined }>,
    fallbackMessage: string,
  ): Promise<void> {
    const generation = this.generation
    this.store.update((state) => { state.priceBusy = true; state.priceError = null })
    try {
      const outcome = await run()
      if (generation !== this.generation) return
      if (!outcome.ok) {
        this.store.update((state) => { state.priceError = outcome.failure ?? fallbackMessage })
        return
      }
      await this.refreshPriceTable(generation)
      await this.load()
    } catch (error) {
      if (generation === this.generation) {
        this.store.update((state) => { state.priceError = error instanceof Error ? error.message : String(error) })
      }
    } finally {
      // priceBusy 必须**原地复位**，不能用上面 load 的代次守卫：成功路径里 `await this.load()`
      // 自己会 ++generation（见 load()），守卫恒为假 —— 于是「更新一次价格表」之后两枚价格按钮
      // 永久 disabled 且不给原因（2026-09-18 真宿主实测 ≥29s 不复位，切页签也不恢复，违反
      // UI-UX-SPEC §3.1「禁用必须给原因」）。动作结束即业务结束，与快照代次无关。
      this.store.update((state) => { state.priceBusy = false })
    }
  }

  private fail(message: string): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = message
    })
  }
}
