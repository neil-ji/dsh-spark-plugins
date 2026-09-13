/**
 * 惰性涌现调度（设计 §5.3）—— **纯函数**，不含定时器。
 *
 * AGENTS.md §1.3 明令：轮询模拟事件是反模式。原 Phase 4.5 设想的 `intervalMs`
 * 定时扫掠正是这种反模式（没人看的时候空转、会话空闲时白烧 CPU）。这里改成
 * **脏标记 + 会话首步惰性触发**：谁能跑、该不该跑，由"自上次以来变了多少"决定。
 *
 * 代价（写进设计文档的取舍）：长期不开会话就不会生成提议。可接受 —— 没人看的
 * 时候生成提议也没有消费者。
 */

export interface ReflectDecisionInput {
  /** 自 `lastReflectAt` 以来新增或变更的火花数。 */
  changedCount: number
  /** 触发阈值；<= 0 表示关闭。 */
  threshold: number
  /** 上次成功跑完涌现的时间；null = 从未跑过。 */
  lastReflectAt: number | null
  now: number
  /** 两次涌现之间的最小间隔（防止一次会话里连续触发）。 */
  minIntervalMs: number
}

export interface ReflectDecision {
  run: boolean
  reason: 'disabled' | 'below-threshold' | 'too-soon' | 'dirty'
}

export function shouldReflect(input: ReflectDecisionInput): ReflectDecision {
  if (input.threshold <= 0) return { run: false, reason: 'disabled' }
  if (input.changedCount < input.threshold) return { run: false, reason: 'below-threshold' }
  if (input.lastReflectAt !== null && input.now - input.lastReflectAt < input.minIntervalMs) {
    return { run: false, reason: 'too-soon' }
  }
  return { run: true, reason: 'dirty' }
}
