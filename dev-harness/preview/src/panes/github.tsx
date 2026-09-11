/**
 * GitHub 连接器设置页（真 GithubSection）——零 dsh，注入面全假。
 */
import { useMemo } from 'react'
import { createMockCtx, type Lang, type Scenario } from '../mock/ctx.ts'
import { GithubSection, buildGithubInjected } from '../mock/plugins.ts'

export function GithubPane({ lang, scenario }: { lang: Lang; scenario: Scenario }) {
  const injected = useMemo(() => {
    const ctx = createMockCtx({
      lang: () => lang,
      scenario: () => scenario,
      credentials: { GITHUB_TOKEN: { configured: scenario === 'ok', source: 'credentials', writable: true } },
    })
    return buildGithubInjected(ctx, scenario)
  }, [lang, scenario])

  return (
    <div className="pv-frame">
      <p className="pv-hint">
        源码 barrel <code>dsh-connector-github-ui/embed</code> · 假 <code>remote.github</code> +
        <code>remote.credentials</code>。试试：粘贴 <code>ghp_bad…</code> 测试连接看失败态，或用场景切到 error/empty。
      </p>
      <GithubSection {...injected} />
    </div>
  )
}
