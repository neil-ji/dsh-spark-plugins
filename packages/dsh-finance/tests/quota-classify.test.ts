/**
 * A9：额度触达分类器一致性（SPEC §10.6）。
 *
 * fixture 全部取自本机 390 个真实会话日志（2026-09-19 扫描），**已脱敏**：
 * request-id / UUID / 长 hex 保留形态但换成占位串，时间戳保持原样（它们是
 * reset 解析的输入，语义必须真实）。
 *
 * 这张表锁的是本功能最容易翻车的地方：**把"服务容量繁忙"误判成"额度到顶"**。
 * 实测 498 条失败载荷里 capacity 占 49 条 —— 它们若落进 quota，用户会被告知去充钱，
 * 而真实处置是降频或稍后重试。
 */
import { describe, expect, it } from 'vitest'
import { classifyQuotaFailure, quotaEpisodeKey, quotaMessageSignature, parseQuotaReset } from '../src/quota.ts'

/** 分类基准时刻：让"短格式 reset"的年份推断确定化。 */
const NOW = 1789827337175

interface Case {
  /** 厂商原始 message（已脱敏）。 */
  message: string
  /** DSH 归一化后的 code。 */
  code: string
  /** 期望分类。 */
  expect: string
}

/**
 * 真实厂商形态全集（SPEC §10.2 表）。每条都来自实测日志。
 */
const REAL_CASES: readonly Case[] = [
  // ── 真正的额度触达 ──────────────────────────────────────────────
  { message: '429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-09-19 23:17:45"}', code: 'QUOTA', expect: 'quota:5h' },
  { message: 'OpenAI API error (429): {"code":"AccountQuotaExceeded","message":"You have exceeded the 5-hour usage quota. It will reset at 2026-08-28 22:38:22 +0800 CST. We recommend upgrading your plan for more quota, or waiting for the reset. Request id: <hex>","param":"","type":"TooManyRequests"}', code: 'RATE_LIMIT', expect: 'quota:5h' },
  { message: '429: {"code":"1310","message":"Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-09-03 18:56:48"}', code: 'RATE_LIMIT', expect: 'quota:week' },
  { message: 'rate_limit_exceeded: Your token-plan 1-week quota has been exhausted. The quota will reset at 09-03 13:34:00 UTC.', code: 'RATE_LIMIT', expect: 'quota:week' },
  { message: '429 {"type":"error","error":{"type":"rate_limit_error","message":"当前已达到 Token Plan 用量上限。为避免调用中断，请升级 Token Plan 套餐，或购买积分补充用量并开启积分自动消耗。 (2067)"},"request_id":"<uuid>"}', code: '', expect: 'quota:month' },
  { message: '429: {"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}', code: 'QUOTA', expect: 'quota:balance' },
  { message: 'OpenAI API error (402): {"type":"gateway_error","code":"401008","message":"The free trial quota for the service has been exhausted and postpaid billing is not enabled, so the service cannot be accessed.","message_zh":"服务免费体验额度已耗尽，且未开启后付费，无法正常访问。","request_id":"<uuid>"}', code: 'PI_AI_ERROR', expect: 'quota:trial' },
  { message: '429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-08-30 03:31:58"}', code: 'QUOTA', expect: 'quota:5h' },

  // ── 明确不是额度：服务容量 / 突发保护（**误判为额度的唯一现实风险**） ──
  { message: 'OpenAI API error (429): {"type":"rate_limit_error","code":"429006","message":"The model service is currently busy or has reached its serving capacity limit. Please reduce the request frequency and try again later.","message_zh":"当前模型服务繁忙或已达服务容量上限，请降低请求频率后稍后重试。","source":"gateway","request_id":"<uuid>"}', code: 'RATE_LIMIT', expect: 'capacity' },
  { message: 'OpenAI API error (429): {"code":"RequestBurstTooFast","message":"System protection triggered by request burst. Please slow down traffic growth and increase the request interval."}', code: 'RATE_LIMIT', expect: 'capacity' },
  { message: '429 event:error data:{"request_id":"<uuid>","code":"Throttling","message":"Request rate increased too quickly. To ensure system stability, please adjust your request rate."}', code: 'RATE_LIMIT', expect: 'capacity' },

  // ── 请求级限流 / 无信息样本：不升级为额度 ──────────────────────
  { message: 'OpenAI API error (429): 429 status code (no body)', code: 'RATE_LIMIT', expect: 'throttle' },
  { message: '429: {"code":"1302","message":"Rate limit reached for requests"}', code: 'RATE_LIMIT', expect: 'throttle' },

  // ── 与本功能无关 ────────────────────────────────────────────────
  { message: '529 {"type":"error","error":{"type":"overloaded_error","message":"当前服务集群负载较高，请稍后重试，感谢您的耐心等待。 (2064) (529)"},"request_id":"<hex>"}', code: 'SERVER', expect: 'other' },
  { message: 'DeepSeek API request to https://api.deepseek.com failed', code: 'TRANSPORT', expect: 'other' },
  { message: 'DeepSeek API stream from https://api.deepseek.com failed', code: 'TRANSPORT', expect: 'other' },
  { message: "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'.", code: 'INVALID_REQUEST', expect: 'other' },
  { message: '401 {"error":{"code":"AuthenticationError","message":"the API key or AK/SK in the request is missing or invalid. request id: <hex>"}}', code: 'AUTH', expect: 'other' },
  { message: 'Request timed out.', code: 'TIMEOUT', expect: 'other' },
  { message: 'model returned a completed response with no content', code: 'EMPTY_RESPONSE', expect: 'other' },
  { message: 'OpenAI API error (404): 404 404 page not found\n', code: 'PI_AI_ERROR', expect: 'other' },
]

describe('A9 · classifyQuotaFailure over real provider payloads', () => {
  for (const testCase of REAL_CASES) {
    it(`${testCase.expect} ← ${testCase.message.slice(0, 64)}`, () => {
      const result = classifyQuotaFailure({ message: testCase.message, code: testCase.code }, NOW)
      const actual = result.kind === 'quota' ? `quota:${result.window}` : result.kind
      expect(actual).toBe(testCase.expect)
    })
  }

  it('never lets a capacity payload into the quota class', () => {
    const capacityOnly = REAL_CASES.filter(c => c.expect === 'capacity')
    expect(capacityOnly.length).toBeGreaterThanOrEqual(3)
    for (const testCase of capacityOnly) {
      const result = classifyQuotaFailure({ message: testCase.message, code: testCase.code }, NOW)
      expect(result.kind).not.toBe('quota')
    }
  })

  it('does not rely on status (which is absent in 99.8% of real payloads)', () => {
    // 实测 504 条里只有 1 条带 status；给它一个误导性的 status 也不该改变结论。
    const quotaMessage = '429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-09-19 23:17:45"}'
    expect(classifyQuotaFailure({ message: quotaMessage, code: 'QUOTA', status: 200 }, NOW).kind).toBe('quota')
    // 反过来：只有 status 没有任何措辞的载荷，不能凭空判成额度。
    expect(classifyQuotaFailure({ message: 'something went wrong', code: 'RATE_LIMIT', status: 429 }, NOW).kind).toBe('throttle')
  })
})

describe('reset 时刻解析', () => {
  it('keeps the raw string but refuses to guess a timezone (no offset)', () => {
    const parsed = parseQuotaReset('reset at 2026-09-19 23:17:45', NOW)
    expect(parsed.resetAtMs).toBeNull()
    expect(parsed.resetRaw).toBe('2026-09-19 23:17:45')
  })

  it('parses the +0800 CST form (trailing zone name must not defeat detection)', () => {
    const parsed = parseQuotaReset('reset at 2026-08-28 22:38:22 +0800 CST', NOW)
    expect(parsed.resetRaw).toBe('2026-08-28 22:38:22 +0800 CST')
    // 22:38:22 +0800 == 14:38:22Z
    expect(parsed.resetAtMs).toBe(Date.UTC(2026, 7, 28, 14, 38, 22))
  })

  it('parses the year-less UTC form using the reference year', () => {
    const parsed = parseQuotaReset('The quota will reset at 09-03 13:34:00 UTC.', NOW)
    expect(parsed.resetAtMs).toBe(Date.UTC(2026, 8, 3, 13, 34, 0))
  })

  it('returns nulls when no reset wording is present', () => {
    const parsed = parseQuotaReset('Insufficient balance or no resource package.', NOW)
    expect(parsed.resetAtMs).toBeNull()
    expect(parsed.resetRaw).toBeNull()
  })
})

describe('episode 去重键', () => {
  it('groups the same outage by reset anchor and separates different windows', () => {
    const a = classifyQuotaFailure({ message: '429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-09-19 23:17:45"}', code: 'QUOTA' }, NOW)
    const sameOutage = classifyQuotaFailure({ message: '429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-09-19 23:17:45"}', code: 'QUOTA' }, NOW)
    const otherWindow = classifyQuotaFailure({ message: '429: {"code":"1310","message":"Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-09-03 18:56:48"}', code: 'RATE_LIMIT' }, NOW)
    expect(quotaEpisodeKey('zai/glm-5.3-flash', a, 'm')).toBe(quotaEpisodeKey('zai/glm-5.3-flash', sameOutage, 'm'))
    expect(quotaEpisodeKey('zai/glm-5.3-flash', a, 'm')).not.toBe(quotaEpisodeKey('zai/glm-5.3-flash', otherWindow, 'm'))
  })

  it('falls back to a message signature when no reset anchor exists', () => {
    const noisy = '429: {"code":"1113","message":"Insufficient balance or no resource package. Please recharge."} request_id: aaaaaaaa-1111-2222-3333-444444444444'
    const noise2 = '429: {"code":"1113","message":"Insufficient balance or no resource package. Please recharge."} request_id: bbbbbbbb-5555-6666-7777-888888888888'
    expect(quotaMessageSignature(noisy)).toBe(quotaMessageSignature(noise2))
    const a = classifyQuotaFailure({ message: noisy, code: 'QUOTA' }, NOW)
    const b = classifyQuotaFailure({ message: noise2, code: 'QUOTA' }, NOW)
    expect(quotaEpisodeKey('p/m', a, noisy)).toBe(quotaEpisodeKey('p/m', b, noise2))
  })
})