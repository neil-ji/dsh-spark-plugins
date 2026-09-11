/**
 * 记忆（HippoMemo）设置面板（真 MemorySection）——零 dsh：
 * 数据走真 fetch，但 `/hippomemo/*` 由预览服务器返回 fixture。
 */
import { useEffect, useMemo } from 'react'
import {
  HIPPOMEMO_CSS,
  MemorySection,
  createHippomemoApi,
  en as hippoEn,
  zh as hippoZh,
} from 'dsh-hippomemo/embed'
import { translator, type Lang } from '../mock/ctx.ts'

const api = createHippomemoApi()

/** 幂等注入插件 CSS（等价 plugin-kit 的 injectPluginStyle，tag 与原插件一致）。 */
function ensureHippoStyle(): void {
  const tag = 'style[data-plugin-css="hippomemo"]'
  if (document.querySelector(tag) !== null) return
  const style = document.createElement('style')
  style.setAttribute('data-plugin-css', 'hippomemo')
  style.dataset.plugin = 'dsh-hippomemo'
  style.textContent = Array.isArray(HIPPOMEMO_CSS) ? HIPPOMEMO_CSS.join('\n') : HIPPOMEMO_CSS
  document.head.appendChild(style)
}

export function HippomemoPane({ lang }: { lang: Lang; scenario: string }) {
  const t = useMemo(() => translator({ zh: hippoZh, en: hippoEn }, lang), [lang])
  useEffect(() => { ensureHippoStyle() }, [])

  return (
    <div className="pv-frame pv-wide">
      <p className="pv-hint">
        源码 barrel <code>dsh-hippomemo/embed</code> · 数据源 = 预览服务器 <code>/hippomemo/*</code> fixture
        （8 条记忆 + 引用 + 偏好 + 候选）。场景切 empty/error 可看空态与失败态。
      </p>
      <div data-plugin="dsh-hippomemo">
        <MemorySection api={api} t={t} />
      </div>
    </div>
  )
}
