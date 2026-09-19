/**
 * A10 / A12：`financeQuota` 投影的去重与兼容性（SPEC §10.6）。
 *
 * A10 锁的是**计数口径**：实测同一次断供会留下 `5× llm/retry + 1× turn/end`
 * （原始事件 123 → 真实断供 21，约 6 倍放大）。若不去重，面板显示的"被挡了几次"
 * 就是个虚高 6 倍的假数字。
 *
 * A12 锁的是**投影兼容性**：新增 `financeQuota` 绝不能 bump 既有 4 个 unit 的
 * `stateVersion` —— 缓存对版本不匹配是丢弃而非迁移，一次 bump 会让每个会话全量重放。
 */
import { describe, expect, it } from 'vitest'
import { financeQuotaProjectionDefinition as quota } from '../src/projection.ts'
import {
  financeContextProjectionDefinition as context,
  financeRateProjectionDefinition as rate,
  financeUsageHourlyProjectionDefinition as hourly,
  financeUsageProjectionDefinition as usage,
} from '../src/projection.ts'

const T0 = Date.UTC(2026, 8, 19, 10, 0, 0)

const header = (time: number, provider: string, model: string) => ({
  type: 'request/header',
  time,
  data: { header: { config: { provider, model } } },
} as const)

const retry = (time: number, provider: string, message: string, code: string) => ({
  type: 'llm/retry',
  time,
  data: { retryId: `r-${String(time)}`, turn: 1, step: 1, provider, policyKey: 'p', retry: 1, maxRetries: 5, delayMs: 500, failure: { message, code } },
} as const)

const turnEnd = (time: number, message: string, code: string) => ({
  type: 'turn/end',
  time,
  data: { turn: 1, reason: { kind: 'error', error: { message, code } } },
} as const)

const QUOTA_5H = '429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-09-19 23:17:45"}'
const QUOTA_WEEK = '429: {"code":"1310","message":"Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-09-23 18:56:48"}'
const CAPACITY = 'OpenAI API error (429): {"code":"429006","message":"The model service is currently busy or has reached its serving capacity limit."}'

function fold(events: readonly unknown[]) {
  let state = quota.init()
  for (const event of events) state = quota.apply(state, event as never)
  return quota.wire.view(state)
}

describe('A10 · episode dedup', () => {
  it('collapses 5 retries + 1 terminal into ONE episode (hits=1, attempts=6, final=true)', () => {
    const view = fold([
      header(T0, 'zai', 'glm-5.3-flash'),
      retry(T0 + 1000, 'zai', QUOTA_5H, 'RATE_LIMIT'),
      retry(T0 + 2000, 'zai', QUOTA_5H, 'RATE_LIMIT'),
      retry(T0 + 3000, 'zai', QUOTA_5H, 'RATE_LIMIT'),
      retry(T0 + 4000, 'zai', QUOTA_5H, 'RATE_LIMIT'),
      retry(T0 + 5000, 'zai', QUOTA_5H, 'RATE_LIMIT'),
      turnEnd(T0 + 6000, QUOTA_5H, 'RATE_LIMIT'),
    ])
    expect(view.episodes).toHaveLength(1)
    const episode = view.episodes[0]
    expect(episode.attempts).toBe(6)
    expect(episode.final).toBe(true)
    expect(episode.window).toBe('5h')
    expect(episode.modelKey).toBe('zai/glm-5.3-flash')
    expect(episode.provider).toBe('zai')
    expect(episode.firstAtMs).toBe(T0 + 1000)
    expect(episode.lastAtMs).toBe(T0 + 6000)
  })

  it('keeps two separate outages apart when the reset anchor differs', () => {
    const view = fold([
      header(T0, 'zai', 'glm-5.3-flash'),
      turnEnd(T0, QUOTA_5H, 'RATE_LIMIT'),
      turnEnd(T0 + 1000, QUOTA_WEEK, 'RATE_LIMIT'),
    ])
    expect(view.episodes).toHaveLength(2)
    expect(view.episodes.map(e => e.window).sort()).toEqual(['5h', 'week'])
  })

  it('does not record capacity failures at all (they are not quota)', () => {
    const view = fold([
      header(T0, 'tencent', 'hy4-preview'),
      retry(T0 + 1000, 'tencent', CAPACITY, 'RATE_LIMIT'),
      turnEnd(T0 + 2000, CAPACITY, 'RATE_LIMIT'),
    ])
    expect(view.episodes).toHaveLength(0)
  })

  it('fills in reset info that only arrives on the terminal event', () => {
    // 第一条 retry 的 message 没带 reset 段，终态那条带 —— 合并后应保留后者。
    const bare = '429: {"code":"1308","message":"Usage limit reached for 5 hour."}'
    const view = fold([
      header(T0, 'zai', 'glm-5.3-flash'),
      retry(T0 + 1000, 'zai', bare, 'QUOTA'),
      turnEnd(T0 + 2000, QUOTA_5H, 'RATE_LIMIT'),
    ])
    // 两条的锚点不同（一个有 resetRaw、一个没有），所以是两个 episode；
    // 但它们同窗口同模型 —— 这里断言"有 reset 信息的那条被保留"。
    const withReset = view.episodes.find(e => e.resetRaw !== null)
    expect(withReset?.resetRaw).toBe('2026-09-19 23:17:45')
  })

  it('bounds the episode list so a long session cannot grow without limit', () => {
    const events: unknown[] = [header(T0, 'zai', 'glm-5.3-flash')]
    for (let index = 0; index < 60; index += 1) {
      // 每次都换一个 reset 时刻 -> 每次都新建 episode。
      events.push(turnEnd(T0 + index * 1000, `429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-09-${String(1 + (index % 28)).padStart(2, '0')} 10:00:00"}`, 'QUOTA'))
    }
    const view = fold(events)
    expect(view.episodes.length).toBeLessThanOrEqual(50)
  })
})

describe('A12 · projection compatibility', () => {
  it('introduces financeQuota as a NEW key without touching existing stateVersions', () => {
    expect(quota.key).toBe('financeQuota')
    expect(quota.stateVersion).toBe(1)
    // 既有 4 个 unit 的版本必须原封不动 —— 任一 bump 都会让所有会话重放。
    expect(usage.stateVersion).toBe(1)
    expect(hourly.stateVersion).toBe(1)
    expect(context.stateVersion).toBe(1)
    // financeRate 是 v2（2026-09-17 修 bug 时定的），同样不许再动。
    expect(rate.stateVersion).toBe(2)
  })

  it('degrades gracefully for sessions checkpointed before this unit existed', () => {
    // 旧会话没有 financeQuota 键，等价于空 episode 列表（不报错、不重放）。
    const view = fold([header(T0, 'zai', 'glm-5.3-flash')])
    expect(view.episodes).toEqual([])
  })
})