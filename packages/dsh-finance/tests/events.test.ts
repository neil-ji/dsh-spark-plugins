import { describe, expect, it } from 'vitest'
import { financeBackfillStreamFrames, type FinanceEventSource } from '../src/events.ts'
import type { FinanceBackfillProgress } from '../src/types.ts'

/** 收集 AsyncGenerator 的前 n 帧。 */
async function take(gen: AsyncGenerator<{ kind: string; [k: string]: unknown }>, n: number): Promise<Array<{ kind: string }>> {
  const frames: Array<{ kind: string }> = []
  for (let i = 0; i < n; i += 1) {
    const next = await gen.next()
    if (next.done) break
    frames.push(next.value)
  }
  return frames
}

describe('finance/events stream bridge', () => {
  it('bridges backfill progress and ledger-updated signals in order', async () => {
    const progress: FinanceBackfillProgress = {
      phase: 'done', percent: 100, scanned: 3, total: 3, rescanned: 3, startedAt: 1,
    }
    let notifyProgress: (() => void) | undefined
    let notifyLedger: (() => void) | undefined
    const source: FinanceEventSource = {
      on: (_event, listener) => {
        notifyProgress = () => listener(progress)
        return () => {}
      },
      onLedgerUpdated: (_event, listener) => {
        notifyLedger = () => listener()
        return () => {}
      },
      currentBackfillProgress: () => progress,
    }
    const gen = financeBackfillStreamFrames(source)
    // 基线帧 + 订阅时的最新快照
    const first = await take(gen as never, 2)
    expect(first.map((frame) => frame.kind)).toEqual(['ready', 'progress'])
    // 宿主广播落账信号 → ledger-updated 帧
    notifyLedger?.()
    const third = await take(gen as never, 1)
    expect(third[0]?.kind).toBe('ledger-updated')
    // 进度变更帧继续可达
    notifyProgress?.()
    const fourth = await take(gen as never, 1)
    expect(fourth[0]?.kind).toBe('progress')
  })
})
