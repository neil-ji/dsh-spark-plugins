/**
 * `hippomemo.events()` 的宿主服务。
 *
 * 桥接逻辑在 `events.ts`（纯函数）；这里只负责把方法暴露成 typert 流派。
 *
 * **为什么没有 `@Remote({ mode: 'stream' })` 装饰器**（实测依据）：
 * 网关对「已注册 descriptor」走 strict 路径 —— `resolveDescriptor()` 先查
 * `ctx.typert.local`（本插件 `ctx.typert.register(HIPPOMEMO_HOST_CONTRIBUTION)` 的产物），
 * 命中就直接用；`prepareInvocation()` 用 `descriptor.implementation ?? descriptor.method`
 * 取方法、用 `descriptor.cancellation` 注入 signal、用 `descriptor.mode` 判定流派，
 * 全程不看装饰器。装饰器标记只服务 **SRC 回退**（未注册端点的第一方发现路径）。
 * 另一层现实原因：本包 host 半边由 tsdown/oxc 打包，装饰器语法不会被降级，
 * 直接进 lib/index.js 会让宿主 `SyntaxError: Invalid or unexpected token`（实测）。
 * 契约以 wire 描述符为唯一真源，两个插件（spark / hippomemo）因此同一机制。
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { hippomemoStreamFrames } from './events.ts'
import type { HippomemoStreamFrame } from './wire.ts'

export class HippomemoEventsService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'hippomemoEvents', { namespace: 'hippomemo' })
  }

  /**
   * 流式下发记忆变更。
   * @param signal - 客户端取消（typert 传输按 descriptor.cancellation 注入）。
   */
  events(signal?: AbortSignal): AsyncIterable<HippomemoStreamFrame> {
    return hippomemoStreamFrames(this.ctx, signal)
  }
}
