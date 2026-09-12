/**
 * `finance.events()` 的宿主服务（F11 commit）。
 *
 * 桥接逻辑在 `events.ts`（纯函数）；这里只负责把方法暴露成 typert stream
 * 端点（不挂 `@Remote` 装饰器 —— 见 dsh-hippomemo `events-service.ts` 与
 * dsh-spark `events-service.ts` 实测：tsdown/oxc 不降级装饰器语法，
 * 会让宿主 SyntaxError；描述符是唯一真源）。
 *
 * 这个 service 独立于 `FinanceService` 自身：cordis key `financeEvents`，
 * typert 命名空间 `finance`。stream 返回 AsyncIterable 与 strict snapshot
 * 端点的契约正交，分两个 service 让反射模型各自干净，wire 描述符同步拆分
 * （FINANCE_INVOCATIONS 里 `finance/events` 描述符的 service 字段就是这个 key）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { financeBackfillStreamFrames } from './events.ts'
import type { FinanceEventSource } from './events.ts'
import type { FinanceBackfillProgress, FinanceBackfillStreamFrame } from './types.ts'

export class FinanceEventsService extends TypertRemoteService {
  /**
   * @param getSnapshot - 最新 backfill 快照的只读访问器。由组合根
   *   （`FinanceService` 构造器）注入 `() => this.backfillProgress`
   *   闭包，而**不是**让本 service 去 `ctx.finance` 上跨服务取 —— cordis
   *   对未声明 inject 的跨服务属性访问会抛
   *   `cannot get property ... without inject`（真宿主实测），而事件总线
   *   `ctx.on` 不受此限（hippomemo 同款）。闭包在每次订阅建立时调用，
   *   读到的始终是最新快照。
   */
  constructor(ctx: Context, private readonly getSnapshot: () => FinanceBackfillProgress | undefined) {
    super(ctx, 'financeEvents', { namespace: 'finance' })
  }

  /**
   * 流式下发 backfill 进度（F11 commit）。
   * @param signal - 客户端取消（typert 传输按 descriptor.cancellation 注入）。
   */
  events(signal?: AbortSignal): AsyncIterable<FinanceBackfillStreamFrame> {
    const source: FinanceEventSource = {
      on: (event, listener) => this.ctx.on(event, listener),
      currentBackfillProgress: () => this.getSnapshot(),
    }
    return financeBackfillStreamFrames(source, signal)
  }
}
