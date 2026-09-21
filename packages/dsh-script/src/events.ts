/**
 * 脚本域事件桥（纯函数，可单测）：cordis `scripts/changed` → typert stream 帧序列。
 *
 * 队列 / 取消 / 基线帧由 kit 的 `bridgeEvents()` 提供（与 spark / hippomemo 同一实现，
 * 见 AGENTS §2.4 的 stream 模式）。
 */
import { bridgeEvents } from 'dsh-spark-plugin-kit'
import type { ScriptsChangedEvent, ScriptStreamFrame } from 'dsh-script-wire'

/** 桥接所需的最小事件源面（cordis `Context` 结构上即满足）。 */
export interface ScriptEventSource {
  on(event: 'scripts/changed', listener: (change: ScriptsChangedEvent) => void): () => void
}

/**
 * 把 `scripts/changed` 桥成帧序列：先 `ready` 基线帧，随后按发生顺序给变更帧。
 * @param source - 事件源（宿主里是 cordis Context）。
 * @param signal - 取消信号；中止时立即结束并解除订阅。
 */
export function scriptStreamFrames(source: ScriptEventSource, signal?: AbortSignal): AsyncGenerator<ScriptStreamFrame> {
  return bridgeEvents<ScriptStreamFrame>({
    signal,
    baseline: () => ({ kind: 'ready', at: Date.now() }),
    subscribe: push => [source.on('scripts/changed', payload => { push({ kind: 'changed', payload }) })],
  })
}
