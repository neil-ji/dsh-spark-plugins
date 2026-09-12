/**
 * Unified event channel for the finance domain (F11 commit) — 纯桥接层。
 *
 * 宿主侧只有 cordis 一条总线（`finance/backfillProgress`），由
 * `FinanceService.ensureHourlyBackfilled` 在 sink 的 `onProgress` 回调里
 * emit 最新的 `FinanceBackfillProgress`；本模块把它桥成帧序列，由
 * `FinanceEventsService.events()`（typert 描述符在 dsh-spark-finance-wire）
 * 暴露成 `ctx.remote.finance.events()`：
 *
 *   cordis emit ──▶ 本模块的订阅 ──▶ 异步队列 ──▶ AsyncIterable<FinanceBackfillStreamFrame>
 *                                                          └─ 经 remote mux（单一 WebSocket 载波）
 *
 * 队列 / 取消 / 基线帧由 kit 的 `bridgeEvents()` 提供，与 dsh-spark / dsh-hippomemo
 * 用同一个实现，finance 不再各写一遍。
 *
 * 与装饰器分文件：`@Remote` 不可擦除，而本仓测试跑在 Node type-stripping 下
 * （`node --test test/*.ts`）——纯函数可测，装饰器只是薄包装。
 *
 * 入口注册的 host 事件名：`finance/backfillProgress`。这是 sink.onProgress
 * 的总线话题；首次订阅时也会同步一次最新快照（如果 `ensureHourlyBackfilled`
 * 已经跑过一次），避免客户端只收到 ready 基线帧而错过 `done` 终态。
 */
import { bridgeEvents } from 'dsh-spark-plugin-kit'
import type { FinanceBackfillProgress, FinanceBackfillStreamFrame } from './types.ts'

/** 桥接所需的最小事件源面（cordis `Context` 结构上即满足）。 */
export interface FinanceEventSource {
  on(
    event: 'finance/backfillProgress',
    listener: (progress: FinanceBackfillProgress) => void,
  ): () => void
  /** 一次性快照：返回当前已知最新 progress（若有）。 */
  currentBackfillProgress?(): FinanceBackfillProgress | undefined
}

/**
 * 把 finance 的 backfillProgress 事件源桥成帧序列：先 `ready` 基线帧，
 * 随后按发生顺序给 `progress` 变更帧。如果事件源在订阅时已有最新快照，
 * 先把那条快照作为第一帧（避免错过已经跑完的回填）。
 * @param source - 事件源（宿主里是 cordis Context + FinanceService）。
 * @param signal - 取消信号；中止时立即结束迭代并解除订阅。
 */
export function financeBackfillStreamFrames(
  source: FinanceEventSource,
  signal?: AbortSignal,
): AsyncGenerator<FinanceBackfillStreamFrame> {
  const subscribe = (push: (frame: FinanceBackfillStreamFrame) => void): Array<() => void> => {
    // If we already know the current progress, push it first so a consumer
    // doesn't have to wait for the next mutation to learn that the backfill
    // is done (or that nothing is running). Always push a synthetic snapshot
    // when the source exposes `currentBackfillProgress` — including when it
    // is undefined (idle): the strict codec requires an explicit phase, and
    // an undefined read collapses to 'idle' anyway.
    const initial = source.currentBackfillProgress?.()
    if (initial !== undefined) {
      push({ kind: 'progress', payload: initial, at: Date.now() })
    }
    return [
      source.on('finance/backfillProgress', (payload) => {
        push({ kind: 'progress', payload, at: Date.now() })
      }),
    ]
  }
  const baseline = (): FinanceBackfillStreamFrame => ({ kind: 'ready', at: Date.now() })
  return bridgeEvents<FinanceBackfillStreamFrame>({ signal, baseline, subscribe })
}
