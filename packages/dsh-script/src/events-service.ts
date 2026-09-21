/**
 * `script/events()` 的宿主服务。
 *
 * 桥接逻辑在 `events.ts`（纯函数）；这里只把方法暴露成 typert 流派。
 * **不挂 `@Remote` 装饰器**：描述符是唯一真源（AGENTS §2.4，实测依据见 dsh-spark 同文件）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ScriptStreamFrame } from 'dsh-script-wire'
import { scriptStreamFrames } from './events.ts'

export class ScriptEventsService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'scriptEvents', { namespace: 'script' })
  }

  /**
   * 流式下发脚本域的全部变更。
   * @param signal - 客户端取消（typert 传输按 descriptor.cancellation 注入）。
   */
  events(signal?: AbortSignal): AsyncIterable<ScriptStreamFrame> {
    return scriptStreamFrames(this.ctx, signal)
  }
}
