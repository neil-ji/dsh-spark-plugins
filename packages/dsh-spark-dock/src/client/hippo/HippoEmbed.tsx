/**
 * Hippo embed: renders the FULL dsh-hippomemo settings section inside the
 * dock panel (定位：dock 完全取代设置页入口).
 *
 * - api：dsh-hippomemo 官方工厂（HTTP 同 /hippomemo/*，与设置页完全同源）；
 * - t：宿主 locale 绑定（dock client 入口在 apply 时注入，见 index.ts）；
 * - CSS：HIPPOMEMO_CSS 全部 scoped 在 [data-plugin="dsh-hippomemo"]，
 *   由本组件根节点提供该属性（settings 壳平时提供，dock 里由我们补）。
 */
import type { ReactNode } from 'react'
import { MemorySection, createHippomemoApi, type HippomemoApi, type MemorySectionProps } from 'dsh-hippomemo/embed'

const api: HippomemoApi = createHippomemoApi()

let hippoT: MemorySectionProps['t'] | undefined

/** 由 client 入口在 apply 时注入 locale.bind(namespace) 结果。 */
export function setHippoT(t: MemorySectionProps['t']): void {
  hippoT = t
}

function fallbackT(key: Parameters<MemorySectionProps['t']>[0]): string {
  return String(key)
}

export function HippoEmbedPane(): ReactNode {
  const t = hippoT ?? fallbackT
  return (
    <div data-plugin="dsh-hippomemo" className="dock-embed hippomemo-dock-scope">
      <MemorySection api={api} t={t} />
    </div>
  )
}
