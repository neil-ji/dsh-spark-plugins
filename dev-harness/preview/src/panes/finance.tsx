/**
 * 财务审计面板（真 FinanceCard：4 页签 = 总览 dashboard / 连接 / 供应商 / 高级）
 * ——零 dsh：假 remote.finance + 内存版 settingsScope（可真的编辑/保存/还原）。
 */
import { useMemo } from 'react'
import { createMockCtx, type Lang, type Scenario } from '../mock/ctx.ts'
import { FinanceCard, buildFinanceInjected } from '../mock/plugins.ts'
import { FINANCE_BASE_CONFIG } from '../mock/fixtures.ts'

export function FinancePane({ lang, scenario }: { lang: Lang; scenario: Scenario }) {
  const injected = useMemo(() => {
    const ctx = createMockCtx({ lang: () => lang, scenario: () => scenario })
    return buildFinanceInjected(ctx, scenario, FINANCE_BASE_CONFIG)
  }, [lang, scenario])

  return (
    <div className="pv-frame pv-wide">
      <p className="pv-hint">
        真产物 <code>dsh-spark-finance-client/embed</code> · 假 <code>remote.finance</code> +
        内存 <code>settingsScope('finance')</code>。页签 = 总览 / 连接 / 供应商 / 高级（无折叠交互）；
        改字段会立刻出现 override 徽标，保存/还原走内存层（刷新即复原）。
      </p>
      <FinanceCard {...injected.card} />
    </div>
  )
}
