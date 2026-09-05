/**
 * Snapshot selector binding — a local replacement for the removed
 * `@deepseek-ai/dsh-client-web-react` package (rc.7 dropped it; its
 * bindSnapshotSelector became internal to dsh-client-ui-renderer).
 *
 * Binds a SnapshotStore / Session observable to a typed useSyncExternalStore
 * selector hook, matching the contract the host's ui-renderer synthesizes
 * from an injected `hooks.<name>` store.
 */
import { useSyncExternalStore } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Selector hook over an observable snapshot. */
export type SnapshotSelectorHook<T> = <S>(
  selector: (snapshot: T) => S,
  equality?: (a: S, b: S) => boolean,
) => S

/**
 * Bind a bare observable source to a typed uSES selector hook.
 * subscribe/getSnapshot are captured once per source, so components never
 * resubscribe across renders. Selector results are memoized by snapshot
 * identity (all current call sites pass identity selectors).
 */
export function bindSnapshotSelector<T>(source: ObservableSnapshot<T>): SnapshotSelectorHook<T> {
  const subscribe = (onChange: () => void): (() => void) => source.subscribe(onChange)
  const getSnapshot = (): T => source.getSnapshot()
  const hook: SnapshotSelectorHook<T> = (selector) => {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    return selector(snapshot)
  }
  return hook
}
