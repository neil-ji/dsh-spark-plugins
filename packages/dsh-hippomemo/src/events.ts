/**
 * hippomemo 事件桥（纯函数，可单测）。
 *
 * 与 spark 同形：宿主侧只有 cordis 一条总线（`hippomemo/changed`），这里桥成
 * pull 型帧序列，由 `events-service.ts` 的 `events()` 方法（typert stream 描述符，
 * 契约在 `wire.ts`）暴露成 `ctx.remote.hippomemo.events()`。队列/取消/基线帧复用
 * kit 的 `bridgeEvents`。
 *
 * 相比此前 `http.ts` 里那条手写 SSE：连接并入 remote mux（不再单独占一条 HTTP 长连接）、
 * 载荷过 wire schema、每代先发 `ready` 基线（旧实现在断线窗口里静默丢事件）。
 */
import { bridgeEvents } from 'dsh-spark-plugin-kit'
import type { HippomemoChangedEvent, HippomemoStreamFrame } from './wire.ts'

/** 桥接所需的最小事件源面（cordis `Context` 结构上即满足）。 */
export interface HippomemoEventSource {
  on(event: 'hippomemo/changed', listener: (change: HippomemoChangedEvent) => void): () => void
}

/**
 * 把 `hippomemo/changed` 桥成帧序列。
 * @param source - 事件源（宿主里是 cordis Context）。
 * @param signal - 取消信号；中止时立即结束迭代并解除订阅。
 */
export function hippomemoStreamFrames(
  source: HippomemoEventSource,
  signal?: AbortSignal,
): AsyncGenerator<HippomemoStreamFrame> {
  return bridgeEvents<HippomemoStreamFrame>({
    signal,
    baseline: () => ({ kind: 'ready', at: Date.now() }),
    subscribe: (push) => [
      source.on('hippomemo/changed', (payload) => { push({ kind: 'memory', payload }) }),
    ],
  })
}
