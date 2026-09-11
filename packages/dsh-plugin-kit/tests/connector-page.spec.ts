/**
 * 连接器公共层（`credentials.ts` / `page.ts`）的回归测试。
 *
 * 这两个模块是从 github-ui / npm-ui 两家逐字重复的实现里抽出来的（评审 F13），
 * 所以它们承载两类不变量：
 *  - **竞态**：只有最新一次加载能落盘（写漏 generation 守卫 → 慢请求覆盖快请求）；
 *  - **失败语义**：`read()` 抛错交给加载骨架转错误态，`save()/remove()` 返回文案给表单。
 */
import { describe, expect, it, vi } from 'vitest'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { CredentialToken, messageOf } from '../src/client/credentials.ts'
import { PageLoader, type PageState } from '../src/client/page.ts'

interface FakeState extends PageState {
  payload?: string
}

/** 最小 SnapshotStore 替身：`update` 收 mutator（与真 store 同形）。 */
function fakeStore(initial: FakeState) {
  let snapshot = { ...initial }
  const store = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    update: (mutate: (draft: FakeState) => void) => {
      const draft = { ...snapshot }
      mutate(draft)
      snapshot = draft
    },
  }
  return { store: store as unknown as SnapshotStore<FakeState>, read: () => snapshot }
}

const idle = (): FakeState => ({ status: 'idle', error: null })

describe('PageLoader', () => {
  it('加载成功：loading → ready 并把补丁合并进快照', async () => {
    const { store, read } = fakeStore(idle())
    const loader = new PageLoader<FakeState>(store)
    const pending = loader.run(async () => ({ payload: 'ok' }))
    expect(read().status).toBe('loading')
    await pending
    expect(read()).toEqual({ status: 'ready', error: null, payload: 'ok' })
  })

  it('加载失败：status=error 且带错误文案', async () => {
    const { store, read } = fakeStore(idle())
    const loader = new PageLoader<FakeState>(store)
    await loader.run(async () => { throw new Error('boom') })
    expect(read()).toEqual({ status: 'error', error: 'boom' })
  })

  it('非 Error 抛出的也转成文案', async () => {
    const { store, read } = fakeStore(idle())
    const loader = new PageLoader<FakeState>(store)
    await loader.run(async () => { throw 'plain string' })
    expect(read().error).toBe('plain string')
  })

  it('竞态守卫：慢的旧请求不得覆盖新请求的结果', async () => {
    const { store, read } = fakeStore(idle())
    const loader = new PageLoader<FakeState>(store)
    let releaseSlow: (() => void) | null = null
    const slow = loader.run(async () => {
      await new Promise<void>((resolve) => { releaseSlow = resolve })
      return { payload: 'slow' }
    })
    await loader.run(async () => ({ payload: 'fast' }))
    expect(read().payload).toBe('fast')
    releaseSlow?.()
    await slow
    // 旧请求落定时已被更新的 generation 取代 —— 既不能改 payload，也不能改状态。
    expect(read()).toEqual({ status: 'ready', error: null, payload: 'fast' })
  })

  it('竞态守卫：旧请求失败也不得把新结果拖进错误态', async () => {
    const { store, read } = fakeStore(idle())
    const loader = new PageLoader<FakeState>(store)
    let releaseSlow: (() => void) | null = null
    const slow = loader.run(async () => {
      await new Promise<void>((resolve) => { releaseSlow = resolve })
      throw new Error('stale failure')
    })
    await loader.run(async () => ({ payload: 'fresh' }))
    releaseSlow?.()
    await slow
    expect(read()).toEqual({ status: 'ready', error: null, payload: 'fresh' })
  })

  it('refreshIfLoaded 只在页面加载过之后才刷新', async () => {
    const { store } = fakeStore(idle())
    const loader = new PageLoader<FakeState>(store)
    const reload = vi.fn(async () => {})
    loader.refreshIfLoaded(reload)
    expect(reload).not.toHaveBeenCalled()
    await loader.run(async () => ({ payload: 'ok' }))
    loader.refreshIfLoaded(reload)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

/** 凭据 seam 替身。 */
function fakeCtx(seam: Record<string, unknown>) {
  return { remote: { credentials: seam } } as never
}

describe('CredentialToken', () => {
  it('read 成功返回该 ref 的视图', async () => {
    const view = { configured: true, source: 'credentials', writable: true }
    const token = new CredentialToken(fakeCtx({ describe: async () => ({ ok: true, value: { GITHUB_TOKEN: view } }) }), 'GITHUB_TOKEN')
    expect(await token.read()).toEqual(view)
  })

  it('read 失败抛错（交给加载骨架转错误态）', async () => {
    const token = new CredentialToken(fakeCtx({ describe: async () => ({ ok: false, error: { message: 'seam down' } }) }), 'GITHUB_TOKEN')
    await expect(token.read()).rejects.toThrow('seam down')
  })

  it('save / remove 成功返回 undefined', async () => {
    const set = vi.fn(async () => ({ ok: true, value: {} }))
    const unset = vi.fn(async () => ({ ok: true, value: {} }))
    const token = new CredentialToken(fakeCtx({ set, unset }), 'NPM_TOKEN')
    expect(await token.save('npm_secret')).toBeUndefined()
    expect(set).toHaveBeenCalledWith('NPM_TOKEN', 'npm_secret')
    expect(await token.remove()).toBeUndefined()
    expect(unset).toHaveBeenCalledWith('NPM_TOKEN')
  })

  it('save / remove 失败返回文案（不抛错，表单直接显示）', async () => {
    const token = new CredentialToken(fakeCtx({
      set: async () => ({ ok: false, error: { message: 'rejected' } }),
      unset: async () => { throw new Error('offline') },
    }), 'NPM_TOKEN')
    expect(await token.save('x')).toBe('rejected')
    expect(await token.remove()).toBe('offline')
  })
})

describe('messageOf', () => {
  it('Error 取 message，其余 String()', () => {
    expect(messageOf(new Error('x'))).toBe('x')
    expect(messageOf('y')).toBe('y')
    expect(messageOf(42)).toBe('42')
  })
})
