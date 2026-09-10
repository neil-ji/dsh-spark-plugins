/**
 * 预览侧的假事件载波（zero-dsh）。
 *
 * 产品代码现在通过平台 API 取事件：`ctx.remote.$stream({ name, open, ended })` +
 * `ctx.remote.<ns>.events(signal)`（见 ADR-001）。真宿主里这是 typert stream 跑在
 * `/api/remote.mux` WebSocket 上；预览没有 dsh 进程，所以这里**按平台同一个形制**造一个：
 *
 *  - `$stream` 复刻 `RemoteStream` 的监督语义：逐项包成 `{ value, accept() }`，
 *    世代结束/载波故障后**自动重开**（可据此在预览里验证「重连 + 基线重同步」路径）；
 *  - `<ns>.events()` 是一代的 opener：订阅 fixture server 的对应 SSE，
 *    映射成产品契约的帧（`ready` 基线 + 主题变更帧）。
 *
 * 注意：这些 fixture SSE **只属于 harness**（产品宿主已无 `/sparks|/proposals|/scripts|
 * /hippomemo /events`）；它们在这里扮演「物理载波」，插件代码看不到差别。
 */
import type { SparkStreamFrame } from 'dsh-spark-wire'

/**
 * hippomemo 帧的结构镜像（该包不导出 wire 子路径；harness 只需要「能产出合规帧」，
 * 类型以插件侧 `dsh-hippomemo/src/wire.ts` 为真源）。
 */
export type HippomemoStreamFrame =
  | { kind: 'ready'; at: number }
  | { kind: 'memory'; payload: { operation: 'put' | 'deleted'; id: string } }

/** 一帧的监督包装（与平台 RemoteStreamItem 同形：value + accept）。 */
export interface SupervisedItem<Item> {
  readonly value: Item
  accept(): void
}

/** 与平台 RemoteStreamOptions 同形的 opener 选项。 */
export interface StreamOptions<Item> {
  readonly name: string
  readonly open: (signal: AbortSignal) => AsyncIterable<Item>
  readonly ended: (accepted: boolean) => Error
  readonly carrierFailed?: (error: unknown) => void
}

/** 与平台 RemoteStream 同形的可重连单消费者流。 */
export interface SupervisedStream<Item> extends AsyncIterable<SupervisedItem<Item>> {
  dispose(): Promise<void>
}

/** 重开前的等待（预览里缩短，便于走查重连路径）。 */
const REOPEN_DELAY_MS = 250

/**
 * 造一个「跨世代重开」的监督流。
 * @param options - opener 与结束分类（与平台同形）。
 * @returns 可迭代的监督流；`dispose()` 中止并停止重开。
 */
export function createSupervisedStream<Item>(options: StreamOptions<Item>): SupervisedStream<Item> {
  const controller = new AbortController()
  let disposed = false

  async function* supervised(): AsyncGenerator<SupervisedItem<Item>> {
    while (!disposed) {
      let accepted = false
      try {
        for await (const value of options.open(controller.signal)) {
          yield { value, accept: () => { accepted = true } }
        }
        // 世代正常结束：载波仍在 → 平台语义是「请求替换」，这里照做。
      } catch (error) {
        if (!disposed) options.carrierFailed?.(error)
      }
      if (disposed) return
      void options.ended(accepted)
      await new Promise((resolve) => setTimeout(resolve, REOPEN_DELAY_MS))
    }
  }

  const iterator = supervised()[Symbol.asyncIterator]()
  return {
    [Symbol.asyncIterator]: () => iterator,
    async dispose() {
      disposed = true
      controller.abort()
    },
  }
}

/**
 * 把若干 harness SSE 当物理载波，映射成产品契约的帧序列（先 `ready` 基线帧）。
 * @param signal - 世代取消（由 `$stream` 注入）。
 * @param bindings - 每条 SSE 的 URL 与其产出帧的 kind。
 */
function framesFromHarnessStreams<Frame extends { kind: string }>(
  signal: AbortSignal,
  bindings: ReadonlyArray<{ url: string; kind: string }>,
): AsyncIterable<Frame> {
  const pending: Frame[] = []
  let wake: (() => void) | null = null
  let closed = false
  const sources: EventSource[] = []

  const release = (): void => {
    const resume = wake
    wake = null
    resume?.()
  }
  const push = (frame: Frame): void => {
    if (closed) return
    pending.push(frame)
    release()
  }
  const closeAll = (): void => {
    closed = true
    for (const source of sources) source.close()
    sources.length = 0
    release()
  }

  for (const binding of bindings) {
    const source = new EventSource(binding.url)
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>
        push({ kind: binding.kind, payload } as unknown as Frame)
      } catch { /* keepalive / 非 JSON 帧 */ }
    }
    sources.push(source)
  }
  signal.addEventListener('abort', closeAll, { once: true })

  return {
    async *[Symbol.asyncIterator]() {
      try {
        yield { kind: 'ready', at: Date.now() } as unknown as Frame
        while (true) {
          const next = pending.shift()
          if (next !== undefined) {
            yield next
            continue
          }
          if (closed) return
          await new Promise<void>((resolve) => { wake = resolve })
        }
      } finally {
        closeAll()
      }
    },
  }
}

/**
 * 一代 spark 事件流（harness 的三条 spark SSE 当载波）。
 * @param signal - 世代取消。
 */
export function sparkEventsGeneration(signal: AbortSignal): AsyncIterable<SparkStreamFrame> {
  return framesFromHarnessStreams<SparkStreamFrame>(signal, [
    { url: '/sparks/events', kind: 'spark' },
    { url: '/proposals/events', kind: 'proposal' },
    { url: '/scripts/events', kind: 'script' },
  ])
}

/**
 * 一代 hippomemo 事件流（harness 的 `/hippomemo/events` 当载波）。
 * @param signal - 世代取消。
 */
export function hippomemoEventsGeneration(signal: AbortSignal): AsyncIterable<HippomemoStreamFrame> {
  return framesFromHarnessStreams<HippomemoStreamFrame>(signal, [
    { url: '/hippomemo/events', kind: 'memory' },
  ])
}
