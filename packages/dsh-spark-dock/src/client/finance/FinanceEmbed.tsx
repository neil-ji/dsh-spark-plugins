/**
 * Finance embed: renders the FULL dsh-spark-finance-client panel inside the
 * dock panel（定位：dock 完全取代设置页入口）——内嵌页自带 4 个页签
 * （总览 dashboard / 连接与价格同步 / 供应商 / 高级定价 JSON）+ 吸底保存行，
 * 因此这里只做装配与加载态，不再有「展开/收起」外壳。
 * 装配方式镜像原 client/index.ts 的 apply：mount remote.finance →
 * FinanceAuditController + FinanceCardController（settingsScope('finance')）
 * → 拼装 FinanceCard 的注入面。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { bindSnapshotSelector, type SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import {
  FinanceAuditController,
  FinanceCard,
  FinanceCardController,
  financeRemoteContribution,
  type FinanceAuditInjected,
  type FinanceAuditState,
  type FinanceCardInjected,
  type FinanceRemote,
  type FinanceKey,
} from 'dsh-spark-finance-client/embed'

interface FinanceInjected {
  card: FinanceCardInjected & FinanceAuditInjected
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let injected: FinanceInjected | undefined
let started = false
let failed = false
const listeners = new Set<() => void>()

/** 由 client 入口在 apply 时调用：异步装配注入面，完成后通知 pane 重渲染。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function startFinanceEmbed(ctx: any): void {
  if (started) return
  started = true
  void Promise.resolve(ctx.remote.$mount(financeRemoteContribution)).catch(() => {
    // 原 finance-client 插件同场加载时已 mount 过 → 直接复用
  }).then(() => {
    const finance = ctx.reflect.get('remote.finance')
    if (finance === undefined) {
      failed = true // finance 宿主未加载：pane 显示明确的失败态（区别于加载中）
      for (const l of listeners) l()
      return
    }
    const controller = new FinanceAuditController(finance)
    const useSnapshot = bindSnapshotSelector(controller.store) as SnapshotSelectorHook<FinanceAuditState>
    const t = ctx.locale.bind('settings.finance') as (key: FinanceKey) => string
    const refresh = (): void => { void controller.load() }
    const refreshProvider = (provider: string): Promise<void> => controller.refreshProvider(provider)

    const cardController = new FinanceCardController(
      ctx.settingsScope.bind({ namespace: 'finance' }),
      finance as unknown as FinanceRemote,
    )
    cardController.ensureAutoSync()
    const cardFace = cardController.inject()
    const cardInjected: FinanceCardInjected = {
      ...cardFace,
      useFinanceCard: bindSnapshotSelector(cardFace.hooks.financeCard) as FinanceCardInjected['useFinanceCard'],
      dashboardRefresh: refresh,
      refreshProvider,
      useSnapshot,
    }
    injected = {
      card: { ...cardInjected, useSnapshot, t, refresh, refreshProvider },
    }
    for (const l of listeners) l()
  }).catch((err: unknown) => {
    console.warn('[dsh-spark-dock] finance remote mount failed:', err)
  })
}

export function FinanceEmbedPane(): ReactNode {
  const [, bump] = useState(0)
  useEffect(() => {
    function remount(): void { bump((n) => n + 1) }
    listeners.add(remount)
    return () => { listeners.delete(remount) }
  }, [])
  if (injected === undefined) {
    return failed
      ? <div className="dock-empty dock-embed-failed">财务审计模块装配失败：宿主未提供 remote.finance。重载插件或检查宿主后重试。</div>
      : <div className="dock-empty"><span className="dock-spin" aria-hidden="true" /> 财务审计模块加载中…</div>
  }
  return (
    <div className="dock-embed">
      {/* embedded：dock 模块头已给出「财务 Finance + 一句话说明」，
          总览仪表盘自己的大标题/副标题不再渲染（而不是渲染后 CSS 压掉）。 */}
      <FinanceCard {...injected.card} embedded />
    </div>
  )
}
