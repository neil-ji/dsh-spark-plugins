/**
 * 财务面板（真 FinancePanel：四个决策视图 = 本月值不值 / 该用谁 / 怎么调度更省 / 项目账）
 * ——零 dsh：假 remote.finance（账本 + provider 列表 + 余额刷新），没有任何配置面。
 */
import { useMemo } from 'react'
import { createMockCtx, type Lang, type Scenario } from '../mock/ctx.ts'
import { FinancePanel, buildFinanceInjected } from '../mock/plugins.ts'

export function FinancePane({ lang, scenario }: { lang: Lang; scenario: Scenario }) {
  const injected = useMemo(() => {
    const ctx = createMockCtx({ lang: () => lang, scenario: () => scenario })
    const built = buildFinanceInjected(ctx, scenario)
    // 组件级画布自己触发一次首屏加载（真装配里由 dock 模块 start 时调用）。
    void built.controller.load()
    return built
  }, [lang, scenario])

  return (
    <div className="pv-frame pv-wide">
      <p className="pv-hint">
        源码 barrel <code>dsh-spark-finance-client/embed</code> · 假 <code>remote.finance</code>
        （账本 + provider 列表 + 余额刷新）。页签 = 本月值不值 / 该用谁 / 怎么调度更省 / 项目账，
        没有配置表单：预置兜底价只在后台参与计算。
      </p>
      <FinancePanel {...injected.panel} />
    </div>
  )
}
