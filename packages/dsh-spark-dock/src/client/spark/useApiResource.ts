/**
 * 一次性加载 + 手动 reload 的小 hook（各 pane 共用）。
 *
 * 从 SparkModule.tsx 抽出：Graph pane 也需要它，而 pane 之间不该靠"同文件"
 * 共享实现（拆文件时最容易漏的是一个 hook 被复制成两份）。
 */
import { useCallback, useEffect, useState } from 'react'

export function useApiResource<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => {
    let alive = true
    loader().then(
      (d) => { if (alive) { setData(d); setError(null) } },
      (e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, error, reload }
}
