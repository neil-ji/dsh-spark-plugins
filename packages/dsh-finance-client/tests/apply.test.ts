import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import financeRemote from 'dsh-spark-finance/remote'
import type { FinanceCommunitySyncResult } from 'dsh-spark-finance/types'

const stubOkSync: FinanceCommunitySyncResult = {
  ok: true,
  source: 'https://models.dev/api.json',
  appliedAt: 0,
  fx: 7.2,
  requestedProviders: [],
  requestedMissing: [],
  kept: 0,
  droppedDated: 0,
  droppedNonToken: 0,
  droppedNoCost: 0,
  providers: [],
}

// Both imports are browser bundles (module-scope window); swap them for node-safe fakes.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: object) => ({
    getSnapshot: () => init,
    subscribe: () => () => {},
    update: () => {},
    set: () => {},
  }),
}))
// ADR-003：本包的 apply 会把 dock 模块注册进 `spark.dock.module` 子槽，
// 这里用 spy 替掉 kit 的注册器（真实现要平台槽位）。
const spies = vi.hoisted(() => ({ registerDockModule: vi.fn((_ctx: unknown, _spec: unknown) => () => {}) }))
vi.mock('dsh-spark-plugin-kit/client', () => ({
  bindSnapshotSelector: (source: { getSnapshot: () => object }) => () => source.getSnapshot(),
  registerDockModule: spies.registerDockModule,
}))

function fakeCtx() {
  const effects: Array<() => unknown> = []
  const registrars = new Map<string, () => unknown>()
  const ctx = {
    effect: vi.fn((fn: () => unknown) => { effects.push(fn); return fn() }),
    locale: {
      register: vi.fn(() => () => {}),
      bind: vi.fn(() => (key: string) => key),
    },
    remote: {
      $mount: vi.fn(async () => async () => {}),
    },
    reflect: {
      get: vi.fn(() => ({
        getOverview: vi.fn(),
        getBalance: vi.fn(),
        getLedger: vi.fn(),
        syncCommunityPrices: vi.fn(async () => ({ ok: true, value: stubOkSync })),
        getSyncStatus: vi.fn(async () => ({ ok: true, value: null })),
      })),
    },
    slots: {
      inject: vi.fn((name: string, registrar: () => unknown) => { registrars.set(name, registrar) }),
      register: vi.fn((entry: object) => () => {}),
    },
    sessions: {
      open: vi.fn(),
    },
    settingsScope: {
      bind: vi.fn(() => ({
        getSnapshot: () => ({
          status: 'ready' as const,
          value: {},
          base: {},
          user: undefined,
          revision: 1,
          writable: true,
          mode: 'host' as const,
        }),
        subscribe: () => () => {},
        set: async () => {},
        unset: async () => {},
      })),
    },
  }
  return {
    ctx: ctx as never,
    effects,
    getRegistrar: (name: string) => registrars.get(name),
  }
}

describe('dsh-spark-finance-client apply', () => {
  beforeEach(() => { spies.registerDockModule.mockClear() })

  it('mounts the finance Remote contribution', async () => {
    const { ctx } = fakeCtx()
    await apply(ctx)
    expect(ctx.remote.$mount).toHaveBeenCalledWith(financeRemote)
  })

  // B7: the standalone `settings.section` entry was removed in commit folding
  // the dashboard into the plugin card body. One entry, one mental model.
  it('does not register a standalone settings.section slot', async () => {
    const { ctx, getRegistrar } = fakeCtx()
    await apply(ctx)
    expect(ctx.slots.inject).not.toHaveBeenCalledWith('settings.section', expect.any(Function))
    expect(getRegistrar('settings.section')).toBeUndefined()
  })

  // ADR-003：功能 UI 归插件自己 —— apply 必须 mount remote、reflect 取命名空间、
  // bind settingsScope（财务卡的配置面）、并把模块注册进 dock 的子槽。
  it('contributes its dock module via registerDockModule (ADR-003)', async () => {
    const { ctx } = fakeCtx()
    await apply(ctx)
    expect(ctx.slots.inject).not.toHaveBeenCalledWith('settings.plugin.item', expect.any(Function))
    expect(ctx.reflect.get).toHaveBeenCalledWith('remote.finance')
    expect(ctx.settingsScope.bind).toHaveBeenCalledWith({ namespace: 'finance' })
    expect(spies.registerDockModule).toHaveBeenCalledTimes(1)
    const spec = spies.registerDockModule.mock.calls[0][1] as { id: string, order: number, inject: () => object }
    expect(spec.id).toBe('finance')
    expect(spec.order).toBe(30)
    expect(typeof spec.inject).toBe('function')
  })

  it('registers locale dictionaries for settings.finance', async () => {
    const { ctx } = fakeCtx()
    await apply(ctx)
    // 0.1.2：locale.register 按语言逐条注册。
    expect(ctx.locale.register).toHaveBeenCalledWith('settings.finance', 'zh', expect.objectContaining({ addModel: expect.any(String) }))
    expect(ctx.locale.register).toHaveBeenCalledWith('settings.finance', 'en', expect.objectContaining({ addModel: expect.any(String) }))
    expect(ctx.locale.register).toHaveBeenCalledTimes(2)
  })

  it('disposes the remote mount on teardown', async () => {
    const disposeRemote = vi.fn(async () => {})
    const { ctx } = fakeCtx()
    ctx.remote.$mount.mockResolvedValue(disposeRemote)
    const teardown = await apply(ctx)
    await teardown()
    expect(disposeRemote).toHaveBeenCalledTimes(1)
  })
})