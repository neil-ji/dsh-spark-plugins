/**
 * bindSnapshotSelector 的预览副本（与 dsh-spark-plugin-kit/client 的实现同形）。
 *
 * 为什么不直接 import 真实现：根 node_modules 不 link 工作区包，而各插件的
 * `lib/embed.cjs` 已经把 plugin-kit 内联进去了——预览侧只需要这一个 8 行函数，
 * 复制比再加一条 alias 更稳。真实现见 packages/dsh-plugin-kit/src/client/snapshot.ts。
 */
import { useSyncExternalStore } from 'react'

export type SnapshotSelectorHook<T> = <S>(
  selector: (snapshot: T) => S,
  equality?: (a: S, b: S) => boolean,
) => S

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(onChange: () => void): () => void
}

export function bindSnapshotSelector<T>(source: ObservableSnapshot<T>): SnapshotSelectorHook<T> {
  const subscribe = (onChange: () => void): (() => void) => source.subscribe(onChange)
  const getSnapshot = (): T => source.getSnapshot()
  return (selector) => selector(useSyncExternalStore(subscribe, getSnapshot, getSnapshot))
}
