/**
 * 事件订阅运行时（dsh-spark-plugin-kit client）—— 插件共享的唯一订阅入口。
 *
 * 背景（ADR-001/004）：平台用 typert stream 方法把宿主领域事件下发到浏览器，
 * 一条物理载波（remote mux WebSocket）承载所有插件的所有事件。`ctx.remote.$stream`
 * 已经解决了**代际重连**与**取消**（平台 `RemoteStream`：跨载波世代重开、`accept()`
 * 标记基线、`dispose()` 回收），所以这里只补三件平台不管的事：
 *
 *  1. **扇出**：一条逻辑流多个消费者（dock 的面板 + 悬浮球 + 未来的其他消费者），
 *     平台明确是 single-consumer（`$stream` 注释），所以每个 name 只开一条，
 *     在本地把帧分发给所有订阅者；
 *  2. **引用计数**：第一个订阅者开流、最后一个离开时 dispose（连接不常驻，
 *     避免 HTTP/1.1 六连接上限那类问题）；
 *  3. **主题路由 + 基线**：`{ kind: 'ready' }` 基线帧触发 `onReady`（消费者据此
 *     重新拉一次状态 —— 世代之间的窗口不回放），其余帧按 kind 分发给 `onFrame`。
 *
 * 这类「一条流 + 本地扇出 + 基线重同步」的形制与平台第一方
 * `dsh-api-workspace-files` 的 ChangeFeed 一致（那边是 per-session 扇出）。
 */
import { useEffect, useRef } from 'react'

/** `ctx.remote.$stream` 的最小结构镜像（真实实现来自 @deepseek-ai/dsh-api-gateway/client）。 */
export interface SupervisedStreamItem<Item> {
  /** 本世代的解码帧。 */
  readonly value: Item
  /** 标记本世代健康（重置重连退避）。收到基线帧后必须调用。 */
  accept(): void
}

/** 平台监督的可重连单消费者流。 */
export interface SupervisedStream<Item> extends AsyncIterable<SupervisedStreamItem<Item>> {
  /** 永久关闭本流。 */
  dispose(): Promise<void>
}

/** 打开一代的选项（与平台 `RemoteStreamOptions` 同形）。 */
export interface StreamOptions<Item> {
  /** 诊断用名字（也用作逻辑流的复用键）。 */
  readonly name: string
  /** 打开一个物理世代；`signal` 中止它。 */
  readonly open: (signal: AbortSignal) => AsyncIterable<Item>
  /** 一个世代正常结束意味着什么错误（载波错误会重开，其它视为终止）。 */
  readonly ended: (accepted: boolean) => Error
  /** 可重试的载波丢失（诊断用）。 */
  readonly carrierFailed?: (error: unknown) => void
}

/** 提供 `$stream` 的 remote 面。 */
export interface StreamRemote {
  $stream<Item>(options: StreamOptions<Item>): SupervisedStream<Item>
}

/** 所有帧都带 kind：`ready` 是基线，其余是主题帧。 */
export interface FramedEvent {
  readonly kind: string
}

interface Subscriber<Frame extends FramedEvent> {
  readonly onFrame: (frame: Frame) => void
  readonly onReady: () => void
}

interface StreamEntry {
  readonly subscribers: Set<Subscriber<FramedEvent>>
  readonly stream: SupervisedStream<FramedEvent>
}

/** name → 逻辑流。第一个订阅者创建，最后一个离开时删除并 dispose。 */
const streams = new Map<string, StreamEntry>()

export interface SubscribeFramesOptions<Frame extends FramedEvent> {
  /** 逻辑流名（同时是复用键；一般取 wire 端点名，如 `spark/events`）。 */
  name: string
  /** 打开一代（一般是 `remote.<ns>.<method>(signal)`）。 */
  open: (signal: AbortSignal) => AsyncIterable<Frame>
  /** 收到变更帧。 */
  onFrame: (frame: Frame) => void
  /** 收到基线帧（新世代开始）：消费者应重新拉取一次状态。 */
  onReady?: () => void
  /** 只处理这些 kind（其余静默忽略）；省略表示全部。 */
  kinds?: readonly string[]
}

/**
 * 订阅一条逻辑事件流（引用计数）。
 * @param remote - 带 `$stream` 的 remote 面（`ctx.remote`）。
 * @param options - 流名、opener、帧处理与基线处理。
 * @returns 取消订阅；最后一个订阅者取消时流被 dispose。
 */
export function subscribeFrames<Frame extends FramedEvent>(
  remote: StreamRemote,
  options: SubscribeFramesOptions<Frame>,
): () => void {
  const { name, open, kinds } = options
  const admitted = kinds === undefined ? null : new Set(kinds)

  let entry = streams.get(name)
  if (entry === undefined) {
    const subscribers = new Set<Subscriber<FramedEvent>>()
    const stream = remote.$stream<FramedEvent>({
      name,
      open: (signal) => open(signal) as AsyncIterable<FramedEvent>,
      ended: (accepted) => new Error(
        accepted ? `remote event stream "${name}" ended` : `remote event stream "${name}" ended before its baseline`,
      ),
      carrierFailed: () => { console.warn(`[dsh-spark-plugin-kit] 事件流 ${name} 载波断开，正在重连`) },
    })
    const created: StreamEntry = { subscribers, stream }
    streams.set(name, created)
    entry = created
    void (async () => {
      try {
        for await (const item of stream) {
          if (item.value.kind === 'ready') {
            item.accept()
            for (const subscriber of created.subscribers) subscriber.onReady()
            continue
          }
          for (const subscriber of created.subscribers) subscriber.onFrame(item.value)
        }
      } catch (error) {
        // 终止性结束（非载波故障）：只留诊断，消费者的下一次订阅会重开。
        console.warn(`[dsh-spark-plugin-kit] 事件流 ${name} 结束：`, error)
      }
    })()
  }

  const subscriber: Subscriber<Frame> = {
    onFrame: (frame) => { if (admitted === null || admitted.has(frame.kind)) options.onFrame(frame) },
    onReady: () => { options.onReady?.() },
  }
  entry.subscribers.add(subscriber as Subscriber<FramedEvent>)

  return () => {
    const current = streams.get(name)
    if (current === undefined) return
    current.subscribers.delete(subscriber as Subscriber<FramedEvent>)
    if (current.subscribers.size === 0) {
      streams.delete(name)
      void current.stream.dispose()
    }
  }
}

export interface UseFramesOptions<Frame extends FramedEvent> extends SubscribeFramesOptions<Frame> {
  /** 带 `$stream` 的 remote 面；`null` 时挂起（尚未 mount / 无 remote）。 */
  remote: StreamRemote | null
}

/**
 * React 版订阅：挂载即订阅、卸载即取消。
 *
 * `open` / `onFrame` / `onReady` 放在 ref 里，因此不会因为每次渲染新建函数而重开流；
 * 重开只发生在 `name` / `kinds` / `remote` 变化时。等价于平台侧的
 * 「一个 name 一条流」纪律。
 */
export function useFrames<Frame extends FramedEvent>(options: UseFramesOptions<Frame>): void {
  const latest = useRef(options)
  latest.current = options
  const kindsKey = options.kinds === undefined ? '' : options.kinds.join(',')
  const { remote, name } = options
  useEffect(() => {
    if (remote === null) return
    return subscribeFrames(remote, {
      name,
      open: (signal) => latest.current.open(signal),
      onFrame: (frame) => { latest.current.onFrame(frame) },
      onReady: () => { latest.current.onReady?.() },
      ...(kindsKey === '' ? {} : { kinds: kindsKey.split(',') }),
    })
  }, [remote, name, kindsKey])
}

/** 测试/诊断：当前打开的逻辑流名。 */
export function openStreamNames(): string[] {
  return [...streams.keys()]
}
