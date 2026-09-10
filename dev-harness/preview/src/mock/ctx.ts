/**
 * 预览用的假宿主上下文：够真插件 client 半侧跑起来的**最小** cordis ctx 形状。
 *
 * 覆盖面来自 docs/LOCAL-DEV-HARNESS.md §1.6 实测：本仓库插件只消费
 * effect / locale.register|bind / remote.$mount|$on|$stream|命名空间 /
 * reflect.get / settingsScope.bind。
 *
 * 全部内存态：不写 settings.yaml、不发任何请求、不碰 DSH_HOME。
 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SparkStreamFrame } from 'dsh-spark-wire'
import {
  createSupervisedStream,
  hippomemoEventsGeneration,
  sparkEventsGeneration,
  type HippomemoStreamFrame,
  type StreamOptions,
  type SupervisedStream,
} from './streams.ts'

export type Lang = 'zh' | 'en'
export type Scenario = 'ok' | 'empty' | 'error'

/** wire 层统一封装：预览的假宿主永远返回 RemoteResult 形状。 */
export function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value } as RemoteResult<T>
}

export function err<T = never>(message: string, code = 'preview'): RemoteResult<T> {
  return { ok: false, error: { code, message } } as unknown as RemoteResult<T>
}

/** 模拟网络往返，让 loading 态可见。 */
export function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

export interface MockCredential {
  configured: boolean
  source: string
  writable: boolean
}

export interface MockCtxOptions {
  /** 当前语言（t 绑定读它，切换语言重挂即生效）。 */
  lang: () => Lang
  /** 当前场景。 */
  scenario: () => Scenario
  /** 初始凭据状态。 */
  credentials?: Record<string, MockCredential>
}

export interface MockSettingsScope<T> extends SettingsScope<T> {
  /** 当前用户层（预览调试用）。 */
  userLayer(): Record<string, unknown>
}

/** 内存版 settingsScope：set/unset 立刻反映到 snapshot，含 user 层语义。 */
export function createMemoryScope<T extends object>(base: T, namespace: string): MockSettingsScope<T> {
  let user: Record<string, unknown> = {}
  let revision = 1
  let snapshot = publish()
  const listeners = new Set<() => void>()

  function value(): T {
    return { ...base, ...user } as T
  }

  function publish(): { status: 'ready'; value: T; base: unknown; user: unknown; revision: number; writable: boolean; mode: 'memory' } {
    return { status: 'ready', value: value(), base, user: { ...user }, revision, writable: true, mode: 'memory' }
  }

  function commit(): void {
    revision += 1
    snapshot = publish()
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async mutate(ops) {
      for (const op of ops) {
        const record = op as { path?: string; value?: unknown; unset?: boolean }
        if (record.path === undefined) continue
        if (record.unset === true) delete user[record.path]
        else user[record.path] = record.value
      }
      commit()
    },
    async set(field, next) {
      user[field] = next
      commit()
    },
    async unset(field) {
      delete user[field]
      commit()
    },
    userLayer: () => ({ ...user }),
    // namespace 仅用于调试打印
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ namespace } as any),
  } as MockSettingsScope<T>
}

export interface MockCtx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
  effect: (fn: () => unknown) => () => void
  locale: {
    register: (namespace: string, lang: string, dictionary: Record<string, string>) => () => void
    bind: (namespace: string) => (key: string, params?: Record<string, unknown>) => string
  }
  remote: {
    $mount: (contribution: unknown) => Promise<unknown>
    $on: (event: string, listener: () => void) => () => void
    /** 平台 `$stream` 的预览替身（监督/重连语义同形，见 mock/streams.ts）。 */
    $stream: <Item>(options: StreamOptions<Item>) => SupervisedStream<Item>
    /** 事件流命名空间（产品契约：先 ready 基线帧，再变更帧）。 */
    spark: {
      events: (signal?: AbortSignal) => AsyncIterable<SparkStreamFrame>
    }
    hippomemo: {
      events: (signal?: AbortSignal) => AsyncIterable<HippomemoStreamFrame>
    }
    credentials: {
      describe: (refs: readonly string[]) => Promise<RemoteResult<Record<string, MockCredential>>>
      set: (ref: string, value: string) => Promise<RemoteResult<unknown>>
      unset: (ref: string) => Promise<RemoteResult<unknown>>
    }
  }
  reflect: { get: (id: string) => unknown }
  settingsScope: { bind: (spec: { namespace: string }) => unknown }
  /** 预览专用：注册 remote 命名空间 / 注册字典 / 预置 settingsScope（真宿主由 cordis 服务承担）。 */
  __preview: {
    namespace: (id: string, value: unknown) => void
    dictionary: (namespace: string, lang: Lang, dict: Record<string, string>) => void
    scope: (namespace: string, base?: object) => MockSettingsScope<object>
    scopes: Map<string, MockSettingsScope<object>>
  }
}

/** 替换字典串里的 {name} 占位符（与真宿主 locale 行为对齐）。 */
function interpolate(template: string, params?: Record<string, unknown>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (raw, name: string) => {
    const value = params[name]
    return value === undefined ? raw : String(value)
  })
}

/** 建一个假宿主 ctx；多次调用各自独立（互不串状态）。 */
export function createMockCtx(options: MockCtxOptions): MockCtx {
  const dictionaries = new Map<string, Partial<Record<Lang, Record<string, string>>>>()
  const namespaces = new Map<string, unknown>()
  const scopes = new Map<string, MockSettingsScope<object>>()
  const credentialState = new Map<string, MockCredential>(Object.entries(options.credentials ?? {}))
  const disposers: Array<() => void> = []

  const ctx: MockCtx = {
    effect(fn) {
      const result = fn()
      if (typeof result === 'function') disposers.push(result as () => void)
      return () => {}
    },
    locale: {
      register(namespace, lang, dictionary) {
        const entry = dictionaries.get(namespace) ?? {}
        entry[lang as Lang] = dictionary
        dictionaries.set(namespace, entry)
        return () => { dictionaries.delete(namespace) }
      },
      bind(namespace) {
        return (key, params) => {
          const entry = dictionaries.get(namespace)
          const lang = options.lang()
          const raw = entry?.[lang]?.[key] ?? entry?.zh?.[key] ?? entry?.en?.[key] ?? String(key)
          return interpolate(raw, params)
        }
      },
    },
    remote: {
      $mount: async (contribution) => contribution,
      $on: () => () => {},
      $stream: (options) => createSupervisedStream(options),
      spark: {
        events: (signal?: AbortSignal) => sparkEventsGeneration(signal ?? new AbortController().signal),
      },
      hippomemo: {
        events: (signal?: AbortSignal) => hippomemoEventsGeneration(signal ?? new AbortController().signal),
      },
      credentials: {
        describe: async (refs) => {
          if (options.scenario() === 'error') return err('credential seam unavailable (preview error scenario)')
          const value: Record<string, MockCredential> = {}
          for (const ref of refs) {
            value[ref] = credentialState.get(ref) ?? { configured: false, source: 'credentials', writable: true }
          }
          return ok(value)
        },
        set: async (ref, value) => {
          if (options.scenario() === 'error') return err('cannot write credential (preview error scenario)')
          if (value.trim() === '') return err('empty token')
          credentialState.set(ref, { configured: true, source: 'credentials', writable: true })
          return ok({ configured: true })
        },
        unset: async (ref) => {
          credentialState.set(ref, { configured: false, source: 'credentials', writable: true })
          return ok({ configured: false })
        },
      },
    },
    // 与真宿主同形：`remote.<ns>` 是动态提供的服务 —— 预览里它挂在 ctx.remote 上，
    // 而 reflect 要能取回（产品的 `reflect.get('remote.<ns>')` 路径就靠这里）。
    reflect: {
      get: (id) => {
        const registered = namespaces.get(id)
        if (registered !== undefined) return registered
        if (id.startsWith('remote.')) {
          return (ctx.remote as unknown as Record<string, unknown>)[id.slice('remote.'.length)]
        }
        return undefined
      },
    },
    settingsScope: {
      bind(spec) {
        let scope = scopes.get(spec.namespace)
        if (scope === undefined) {
          scope = createMemoryScope<object>({}, spec.namespace)
          scopes.set(spec.namespace, scope)
        }
        return scope
      },
    },
    __preview: {
      namespace: (id, value) => { namespaces.set(id, value) },
      dictionary: (namespace, lang, dict) => { ctx.locale.register(namespace, lang, dict) },
      scope: (namespace, base = {}) => {
        const scope = createMemoryScope<object>(base, namespace)
        scopes.set(namespace, scope)
        return scope
      },
      scopes,
    },
  }
  return ctx
}

/** 从导出的字典构造 t（等价 ctx.locale.bind 的最小实现，供不建 ctx 的场合）。 */
export function translator(
  dictionaries: Partial<Record<Lang, Record<string, string>>>,
  lang: Lang,
): (key: string, params?: Record<string, unknown>) => string {
  return (key, params) => {
    const raw = dictionaries[lang]?.[key] ?? dictionaries.zh?.[key] ?? dictionaries.en?.[key] ?? String(key)
    return interpolate(raw, params)
  }
}
