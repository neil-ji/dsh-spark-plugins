/**
 * Unified event channel for the spark domain (ADR-001) —— **纯桥接层**。
 *
 * 宿主侧只有 cordis 一条总线（`sparks/changed` / `proposals/changed`）；
 * 这里把它桥成一条事件帧序列，由 `events-service.ts` 的 `events()` 方法（typert stream
 * 描述符，契约在 `dsh-spark-wire`）暴露成 `ctx.remote.spark.events()`：
 *
 *   cordis emit ──▶ 本模块的订阅 ──▶ 异步队列 ──▶ AsyncIterable<SparkStreamFrame>
 *                                                        └─ 经 remote mux（单一 WebSocket 载波）
 *
 * 队列 / 取消 / 基线帧由 kit 的 `bridgeEvents()` 提供（dsh-hippomemo 用同一个实现，
 * 两个插件不再各写一遍）。相比此前每个领域各写一条 HTTP SSE 端点：
 *  - 连接数：3 条常驻 SSE → 0（全部并入 mux）；
 *  - 契约：帧按 `sparkStreamFrameSchema` 逐项校验，host/client 引用同一份声明；
 *  - 语义：每代开头先发 `ready` 基线帧，客户端据此 resync（旧 SSE 在断线窗口里静默丢事件）；
 *  - 取消：`signal` 由 typert 注入，客户端 dispose 即回收本函数的订阅。
 *
 * 与装饰器分文件：`@Remote` 不可擦除，而本仓测试跑在 Node type-stripping 下
 * （`node --test test/*.ts`）——纯函数可测，装饰器只是薄包装。
 */
import { bridgeEvents } from 'dsh-spark-plugin-kit'
import type { ProposalsChangedEvent, SparkChangedEvent, SparkStreamFrame } from 'dsh-spark-wire'

/** 桥接所需的最小事件源面（cordis `Context` 结构上即满足）。 */
export interface SparkEventSource {
  on(event: 'sparks/changed', listener: (change: SparkChangedEvent) => void): () => void
  on(event: 'proposals/changed', listener: (change: ProposalsChangedEvent) => void): () => void
}

/**
 * 把 spark 的三条事件源桥成帧序列：先 `ready` 基线帧，随后按发生顺序给变更帧。
 * @param source - 事件源（宿主里是 cordis Context）。
 * @param signal - 取消信号；中止时立即结束迭代并解除订阅。
 */
export function sparkStreamFrames(
  source: SparkEventSource,
  signal?: AbortSignal,
): AsyncGenerator<SparkStreamFrame> {
  return bridgeEvents<SparkStreamFrame>({
    signal,
    baseline: () => ({ kind: 'ready', at: Date.now() }),
    subscribe: (push) => [
      source.on('sparks/changed', (payload) => { push({ kind: 'spark', payload }) }),
      source.on('proposals/changed', (payload) => { push({ kind: 'proposal', payload }) }),
    ],
  })
}
