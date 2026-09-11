/**
 * npm 发布管线设置页（真 NpmSection）——零 dsh，注入面全假。
 */
import { useMemo } from 'react'
import { createMockCtx, type Lang, type Scenario } from '../mock/ctx.ts'
import { NpmSection, buildNpmInjected } from '../mock/plugins.ts'

export function NpmPane({ lang, scenario }: { lang: Lang; scenario: Scenario }) {
  const injected = useMemo(() => {
    const ctx = createMockCtx({
      lang: () => lang,
      scenario: () => scenario,
      credentials: { NPM_TOKEN: { configured: scenario === 'ok', source: 'credentials', writable: true } },
    })
    return buildNpmInjected(ctx, scenario)
  }, [lang, scenario])

  return (
    <div className="pv-frame">
      <p className="pv-hint">
        源码 barrel <code>dsh-connector-npm-ui/embed</code> · 假 <code>remote.npm</code>。
        试试：<code>npm_bad…</code> 测试连接看 403 提示，或保存一个 token 看状态面板刷新。
      </p>
      <NpmSection {...injected} />
    </div>
  )
}
