/**
 * 宿主侧事件桥（ADR-001/004）：把 push 型的 cordis 事件适配成 typert stream 需要的
 * pull 型 `AsyncIterable`。
 *
 * 插件只提供两件事 —— 「怎么订阅」（用自己类型的 `ctx.on(...)`）与「基线帧是什么」；
 * 队列、唤醒、取消、清理都在这里，两个插件（dsh-spark / dsh-hippomemo）不再各写一遍。
 *
 * 世代语义：每个物理世代**先发基线帧**，客户端收到即重新拉取一次状态 ——
 * 世代之间的空窗不回放（与平台 `RemoteStreamItem.accept()` 的基线约定一致）。
 */

/** 所有帧都带 kind：`ready` 是基线，其余是主题帧。 */
export interface FramedEvent {
  readonly kind: string
}

export interface BridgeEventsOptions<Frame> {
  /**
   * 订阅事件源。调用方在这里做有类型的 `ctx.on(...)`，并把每个帧推进 `push`；
   * 返回全部 disposer（取消/结束时统一解除）。
   */
  readonly subscribe: (push: (frame: Frame) => void) => Array<() => void>
  /** 每个世代先发的基线帧。 */
  readonly baseline: () => Frame
  /** 取消信号（typert 传输注入；缺省时仅在消费结束时清理）。 */
  readonly signal?: AbortSignal | undefined
}

/**
 * 把一条事件源桥成帧序列。
 * @param options - 订阅方式、基线帧与取消信号。
 * @returns 先基线帧，随后按发生顺序给主题帧；取消或消费者提前返回时解除全部订阅。
 */
export async function * bridgeEvents<Frame>(options: BridgeEventsOptions<Frame>): AsyncGenerator<Frame> {
  const pending: Frame[] = []
  let wake: (() => void) | null = null
  let closed = false

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

  const disposers = options.subscribe(push)
  const dispose = (): void => {
    for (const off of disposers) off()
    closed = true
    release()
  }
  if (options.signal?.aborted === true) {
    dispose()
  } else {
    options.signal?.addEventListener('abort', dispose, { once: true })
  }

  try {
    yield options.baseline()
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
    options.signal?.removeEventListener('abort', dispose)
    dispose()
  }
}
