/**
 * 连接器设置页的加载骨架（`generation` 守卫 + status/error 迁移 + 幂等刷新）。
 *
 * 为什么在 kit：github-ui 与 npm-ui 两个设置页的 `load()` 是同一套骨架逐字重复
 * （评审 F13）——「最新一次请求胜出」的 generation 守卫最容易在复制粘贴里写漏，
 * 写漏的表现是慢请求覆盖快请求、页面闪回旧数据。
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { messageOf } from './remote-result.ts'

/** 页面快照必须携带的加载状态字段。 */
export interface PageState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
}

/**
 * 页面加载器。
 *
 * 用法：`load()` 里只写「取数 + 返回补丁」，状态迁移与竞态守卫交给它：
 * ```ts
 * async load() { await this.loader.run(async () => ({ config: await fetchConfig() })) }
 * ```
 */
export class PageLoader<S extends PageState> {
  private generation = 0

  constructor(private readonly store: SnapshotStore<S>) {}

  /** 只在页面已经加载过一次之后刷新（首次进来由组件的 effect 触发 `load()`）。 */
  refreshIfLoaded(reload: () => Promise<void>): void {
    if (this.store.getSnapshot().status === 'idle') return
    void reload()
  }

  /**
   * 跑一次加载：进入 loading → 取数（可抛错）→ 最新一次才落 ready。
   * @param fetch - 取数并返回要合并进快照的字段（抛错即进入错误态）。
   */
  async run(fetch: () => Promise<Partial<S>>): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const patch = await fetch()
      if (generation !== this.generation) return
      this.store.update((state) => {
        Object.assign(state, patch)
        state.status = 'ready'
        state.error = null
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
    }
  }
}
