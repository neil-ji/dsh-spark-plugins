import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import financeRemote from 'dsh-finance/remote'

// Both imports are browser bundles (module-scope window); swap them for node-safe fakes.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: object) => ({
    getSnapshot: () => init,
    subscribe: () => () => {},
    update: () => {},
    set: () => {},
  }),
}))
vi.mock('@deepseek-ai/dsh-client-web-react', () => ({
  bindSnapshotSelector: (source: { getSnapshot: () => object }) => () => source.getSnapshot(),
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

describe('dsh-finance-client apply', () => {
  it('mounts the finance Remote contribution', async () => {
    const { ctx } = fakeCtx()
    await apply(ctx)
    expect(ctx.remote.$mount).toHaveBeenCalledWith(financeRemote)
  })

  it('registers the settings.section slot named finance-audit', async () => {
    const { ctx, getRegistrar } = fakeCtx()
    await apply(ctx)
    expect(ctx.slots.inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
    getRegistrar('settings.section')!()
    expect(ctx.slots.register).toHaveBeenCalledTimes(1)
    const [entry] = ctx.slots.register.mock.calls[0]
    expect(entry.name).toBe('settings.section')
    expect(entry.id).toBe('finance-audit')
    expect(entry.order).toBe(20)
    expect(entry.locale).toBe('settings.finance')
  })

  it('registers the finance plugin card into settings.plugin.item', async () => {
    const { ctx, getRegistrar } = fakeCtx()
    await apply(ctx)
    expect(ctx.settingsScope.bind).toHaveBeenCalledWith({ namespace: 'finance' })
    expect(ctx.slots.inject).toHaveBeenCalledWith('settings.plugin.item', expect.any(Function))
    getRegistrar('settings.plugin.item')!()
    expect(ctx.slots.register).toHaveBeenCalledTimes(1)
    const [entry] = ctx.slots.register.mock.calls[0]
    expect(entry.name).toBe('settings.plugin.item')
    expect(entry.id).toBe('finance')
    expect(entry.order).toBe(30)
    expect(entry.locale).toBe('settings.finance')
  })

  it('reads the mounted finance namespace via reflect (no inject deadlock)', async () => {
    const { ctx } = fakeCtx()
    await apply(ctx)
    expect(ctx.reflect.get).toHaveBeenCalledWith('remote.finance')
  })

  it('registers locale dictionaries for settings.finance', async () => {
    const { ctx } = fakeCtx()
    await apply(ctx)
    expect(ctx.locale.register).toHaveBeenCalledWith('settings.finance', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
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
