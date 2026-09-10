/**
 * `spark.events()` 的宿主服务。
 *
 * 桥接逻辑在 `events.ts`（纯函数、可单测）；这里只负责把方法暴露成 typert 流派。
 *
 * **为什么没有 `@Remote({ mode: 'stream' })` 装饰器**（实测依据）：
 * 网关对「已注册 descriptor」走 strict 路径 —— `resolveDescriptor()` 先查 `ctx.typert.local`
 * （本插件 `ctx.typert.register(SPARK_HOST_CONTRIBUTION)` 的产物），命中即用；
 * `prepareInvocation()` 用 `descriptor.implementation ?? descriptor.method` 取方法、
 * 用 `descriptor.cancellation` 注入 signal、用 `descriptor.mode` 判定流派，全程不看装饰器。
 * 装饰器标记只服务 **SRC 回退**（未注册端点的第一方发现路径）。
 * 另一层现实原因：hippomemo 的 host 半边由 tsdown/oxc 打包，装饰器不会被降级，
 * 会直接让宿主 `SyntaxError`。两个插件因此统一为「契约以 wire 描述符为唯一真源」。
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SparkStreamFrame } from 'dsh-spark-wire'
import { sparkStreamFrames } from './events.ts'

export class SparkEventsService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'sparkEvents', { namespace: 'spark' })
  }

  /**
   * 流式下发 spark 域的全部变更。
   * @param signal - 客户端取消（typert 传输按 descriptor.cancellation 注入）。
   */
  events(signal?: AbortSignal): AsyncIterable<SparkStreamFrame> {
    return sparkStreamFrames(this.ctx, signal)
  }
}
