/**
 * Spark 事件通道的客户端面。
 *
 * 平台的两条规则（真宿主验收时才看清，预览的 mock 没有这两道门）：
 *
 *  1. `remote.<ns>` 是按命名空间提供的 **cordis 服务**，受 inject 门管辖；但注入它
 *     会死锁 —— 该服务正是本插件 `$mount(SPARK_REMOTE_CONTRIBUTION)` 之后才出现的，
 *     写进 `export const inject` 会让 fiber 永远等不到（实测：悬浮球整个不挂载）。
 *     平台里唯一可用的取法是 `ctx.reflect.get('remote.<ns>')`（这正是本仓
 *     `reflect.ts` 存在的原因，也是 github/npm/finance 三个 embed 的既有做法）。
 *  2. `$stream` 在 `ctx.remote` 上，不需要命名空间就能拿到，负责代际重连与取消。
 *
 * 于是客户端侧的「事件通道」= `{ $stream 的持有者, 命名空间 }` 这两件东西，
 * 由 dock 在 `await $mount(...)` 之后组装一次，再通过插槽 inject 面交给组件。
 */
import type { StreamRemote } from 'dsh-spark-plugin-kit/client'
import type { SparkStreamFrame } from 'dsh-spark-wire'

/** `remote.spark`（宿主 `spark.events()` 的客户端面）。 */
export interface SparkEventsFace {
  events(signal?: AbortSignal): AsyncIterable<SparkStreamFrame>
}

/** 组装好的事件通道：监督流 + spark 命名空间。 */
export interface SparkEventChannel {
  /** 平台监督流（`ctx.remote.$stream`）：一条物理载波、自动重连、可取消。 */
  readonly remote: StreamRemote
  /** `ctx.reflect.get('remote.spark')`：`$mount` 之后才存在。 */
  readonly events: SparkEventsFace
}

/** 逻辑流名（与宿主方法同名，同时是 kit 订阅运行时的复用键）。 */
export const SPARK_EVENTS_STREAM = 'spark/events'

/**
 * 组装 spark 事件通道。
 * @param remote - `ctx.remote`（提供 `$stream`）。
 * @param reflect - `ctx.reflect`（取回动态 remote 命名空间）。
 * @returns 通道；命名空间尚未就绪（mount 失败/未完成）时返回 null，调用方降级为不订阅。
 */
export function sparkChannelOf(
  remote: StreamRemote,
  reflect: { get(id: string): unknown },
): SparkEventChannel | null {
  const namespace = reflect.get('remote.spark') as SparkEventsFace | undefined
  if (namespace === undefined || namespace === null || typeof namespace.events !== 'function') return null
  return { remote, events: namespace }
}
