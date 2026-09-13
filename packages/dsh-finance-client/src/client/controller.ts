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
import type {
  FinanceBackfillProgress,
  FinanceLedger,
  FinanceListProvidersResult,
  FinancePlanEntry,
  FinanceProviderBalance,
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
  /** 最近一次成功的社区价格同步（epoch ms）；undefined = 从未同步。 */
  lastSyncAppliedAt?: number
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
}

/** 一个面板实例一个控制器；不做模块级单例。 */
export class FinancePanelController {
  readonly store: SnapshotStore<FinancePanelState> = createSnapshotStore<FinancePanelState>({
    status: 'idle',
    error: null,
    plans: [],
    tiers: {},
    plansWritable: false,
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
    this.store.update((state) => { state.progress = progress })
  }

  /** 拉 ledger + provider 列表；失败保留上次快照，只切状态与错误文案。 */
  async load(): Promise<void> {
    const generation = ++this.generation
    const firstLoad = this.store.getSnapshot().ledger === undefined
    this.store.update((state) => {
      state.status = firstLoad ? 'loading' : 'ready'
      state.error = null
      if (firstLoad) state.progress = undefined
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
      })
      void this.refreshSyncStatus(generation)
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

  /** 删除一条套餐。 */
  async removePlan(provider: string): Promise<void> {
    if (this.seam === undefined) return
    const rest = this.store.getSnapshot().plans.filter((row) => providerKey(row.provider) !== providerKey(provider))
    await this.seam.write(rest)
  }

  /** 价格来源脚注（尽力而为，失败不动快照）。 */
  private async refreshSyncStatus(generation: number): Promise<void> {
    try {
      const result = await this.remote.getSyncStatus()
      if (generation !== this.generation || !result.ok || result.value === null) return
      const appliedAt = result.value.appliedAt
      this.store.update((state) => { state.lastSyncAppliedAt = appliedAt })
    } catch {
      // 脚注不是关键路径。
    }
  }

  private fail(message: string): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = message
    })
  }
}
