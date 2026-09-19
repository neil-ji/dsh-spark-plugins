/**
 * 额度触达判定：把 DSH 归一化后的 `LlmFailure` 判成「额度触到顶 / 容量繁忙 / 请求限流 / 无关」。
 *
 * 规范源：`docs/FINANCE-PRICING-SPEC.md` §10.3（判定顺序即语义，不可调换）。
 * 产品设计：`docs/plans/2026-09-19-finance-quota-detection-design.md` §4。
 *
 * 为什么不能简化成"看到 429 就记一笔"——三条实测反例（390 会话 / 504 条真实载荷）：
 *
 * 1. **`status` 几乎不存在**：504 条里只有 1 条带 `status`，所以 `status === 429` 会漏
 *    掉 99.8% 的样本。判据只能是 `code` + `message`。
 * 2. **429 既会漏也会错**：`402/401008`（免费额度耗尽）是额度但**不是** 429；
 *    反过来 `429006 / RequestBurstTooFast / Throttling` 是 429 但**不是**额度
 *    （服务容量/突发保护，等一会儿就好，不是"该充钱"）。
 * 3. **`code === 'QUOTA'` 也会漏**：`2067`（Token Plan 用量上限）压根没有 code，
 *    两条声明式窗口（`1308` / `AccountQuotaExceeded`）落到了 `RATE_LIMIT`
 *    （内核 `isQuotaExceededError` 要求 `quota|usage limit` 紧跟 `exceeded`，
 *    而 `"You have exceeded the 5-hour usage quota"` 词序不匹配）。
 *
 * 所以本模块是**有序组合判定**：message 词表优先，code 兜底，不确定一律 `other`。
 * 宁可漏（不显示），不可错（显示成额度会误导用户去充钱）。
 *
 * 纯函数、无网络、无 ctx——跑在 Node type-stripping 下（host 测试用 `node --test`）。
 *
 * @module @deepseek-ai/dsh-spark-finance/quota
 */

/** 厂商自报的额度窗口粒度。`unknown` = 内核判过额度但窗口认不出来（不猜）。 */
export type FinanceQuotaWindow = '5h' | 'week' | 'month' | 'balance' | 'trial' | 'unknown'

/**
 * 一次失败尝试的判定结果。
 *
 * - `quota` —— 额度触达（订阅周期容量或按量钱包到顶）。**只有这一类进账本。**
 * - `capacity` —— 服务容量/突发保护（`429006` / `RequestBurstTooFast` / `Throttling`）。
 *   瞬时问题：该降并发或稍后重试，**不是**该充钱。识别它是为了不被误记成额度。
 * - `throttle` —— 请求级限流，无额度措辞（含 `429 status code (no body)` 这类无信息样本）。
 * - `other` —— 与本功能无关（TRANSPORT / SERVER / INVALID_REQUEST ...）。
 */
export type FinanceQuotaClass =
  | {
    kind: 'quota'
    window: FinanceQuotaWindow
    /** 厂商自报码：1308 / 1310 / 2067 / 1113 / 401008 / AccountQuotaExceeded ... */
    vendorCode: string | null
    /** 可解析出的重置时刻；无时区或解析失败时为 null（**绝不假设本机时区补值**）。 */
    resetAtMs: number | null
    /** 原文里的重置描述（`2026-09-19 23:17:45` / `09-03 13:34:00 UTC`），UI 直接显示。 */
    resetRaw: string | null
  }
  | { kind: 'capacity' }
  | { kind: 'throttle' }
  | { kind: 'other' }

/** 判定输入：DSH 的 provider-neutral 失败事实（结构与 `dsh-llm` 的 `LlmFailure` 一致）。 */
export interface QuotaFailureLike {
  message?: unknown
  code?: unknown
  status?: unknown
}

/* ───────────────────────── 词表（顺序敏感，见 Spec §10.3） ───────────────────────── */

/**
 * ① 服务容量 / 突发保护 —— **必须最先判**。
 * 这些都是"服务端当下忙"，重试或降频即可恢复，与额度无关。
 * `429006`：腾讯 tokenhub（「模型服务繁忙或已达服务容量上限」）。
 *
 * 边界：只收 **429 家族**里"非额度"的那批。`529 overloaded_error` 虽然也是"忙"，
 * 但它已经被内核判成 `code === 'SERVER'`，语义上不属于本类——放进来会把
 * `capacity` 从"429 但不是额度"稀释成"任何忙"，A9 的分离断言也就失去意义。
 */
const CAPACITY_PATTERNS: readonly RegExp[] = [
  /429006/,
  /serving capacity/i,
  /RequestBurstTooFast/i,
  /"Throttling"/i,
  /\bThrottling\b/,
  /busy or has reached/i,
  /请求频率/,
  /服务容量上限/,
]

/** ② 钱包 / 资源包触底 —— 付钱即可恢复，与周期额度不是一回事。 */
const BALANCE_PATTERNS: readonly RegExp[] = [
  /"1113"/,
  /insufficient balance/i,
  /no resource package/i,
  /\brecharge\b/i,
  /Insufficient balance or no resource package/i,
]

/** ③ 免费体验额度耗尽（实测走 402，**不是** 429）。 */
const TRIAL_PATTERNS: readonly RegExp[] = [
  /401008/,
  /free trial quota/i,
  /免费体验额度/,
]

/** ④ 周 / 月窗口。 */
const WEEK_PATTERNS: readonly RegExp[] = [
  /"1310"/,
  /1-week quota/i,
  /Weekly\/Monthly\s+Limit/i,
  /weekly limit/i,
  /token-plan 1-week/i,
  /周限额/,
]

/** ⑤ 5 小时窗口（最常见的短窗）。 */
const FIVE_HOUR_PATTERNS: readonly RegExp[] = [
  /"1308"/,
  /5[-\s]?hour/i,
  /5h quota/i,
  /5\s*小时/,
]

/** ⑥ 月度套餐上限（`2067` 这条完全没有 code，只能靠 message）。 */
const MONTH_PATTERNS: readonly RegExp[] = [
  /"2067"/,
  /Token Plan 用量上限/,
  /monthly limit/i,
  /月限额/,
]

/**
 * 额度语义措辞：出现这些才允许把 `RATE_LIMIT` 认成"额度但窗口未知"。
 *
 * **不能包含裸 `limit`**：`"Rate limit reached for requests"`（厂商码 `1302`）说的是
 * 请求速率，不是额度 —— 用 `/limit/` 会把它吞成额度类。实测踩过这个坑（A9 单测锁住）。
 * 只认与额度/配额明确绑定的措辞。
 */
const QUOTA_WORDING = /\bquota\b|\busage[\s_-]*limit\b|exhausted|insufficient|额度|限额/i

/* ───────────────────────── reset 时刻解析 ───────────────────────── */

/**
 * 从 message 里抠出重置时刻。
 *
 * 实测三种形态，**只在带时区信息时才产出 `resetAtMs`**：
 *  - `... reset at 2026-09-19 23:17:45`（**无时区** → 只留原文）
 *  - `... reset at 09-03 13:34:00 UTC`
 *  - `... reset at 2026-08-28 22:38:22 +0800 CST`
 *
 * 无时区时刻**绝不**按本机时区硬补——那会造出一个看起来精确、实际可能偏 8 小时的数字，
 * 比不给更糟（Spec §10.2 C4）。
 */
const RESET_AT = /reset(?:s)?\s+at\s+([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\s*(?:Z|UTC|[+-][0-9]{4}))?(?:\s+[A-Z]{2,4})?)/i
const RESET_AT_SHORT = /reset(?:s)?\s+at\s+([0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2}\s*(?:Z|UTC|[+-][0-9]{4})?)/i

interface ParsedReset {
  resetAtMs: number | null
  resetRaw: string | null
}

/**
 * 该片段是否自带时区标记（`Z` / `UTC` / `±HHMM`）。
 *
 * 时区标记**可能不落在末尾**：实测 `2026-08-28 22:38:22 +0800 CST` 后面还跟着
 * 时区名缩写。用 `$` 锚定会漏掉这一形态（首版 bug），于是明明带时区的时刻被当成
 * 无时区、`resetAtMs` 退化成 null。所以按"位置不限"判，偏移量要求前面有空白，
 * 避免把日期自身的连字符误认为偏移。
 */
function hasTimezone(segment: string): boolean {
  return /\bUTC\b/i.test(segment) || /(?:^|\s)[+-][0-9]{4}\b/.test(segment) || /\bZ\s*$/.test(segment)
}

/**
 * 解析重置时刻。无时区 → `resetAtMs: null` 但保留 `resetRaw`。
 * @param message - 厂商原始 message（通常内嵌 JSON）。
 * @param nowMs - 解析"短格式"（无年份）时的参考年；注入以便测试。
 */
export function parseQuotaReset(message: string, nowMs: number): ParsedReset {
  const full = RESET_AT.exec(message)
  if (full !== null) {
    const raw = full[1].trim()
    return { resetAtMs: hasTimezone(raw) ? parseWithTimezone(raw) : null, resetRaw: raw }
  }
  const short = RESET_AT_SHORT.exec(message)
  if (short !== null) {
    const raw = short[1].trim()
    if (!hasTimezone(raw)) return { resetAtMs: null, resetRaw: raw }
    // 短格式缺年份：补上参考年（`09-03` 可能是跨年边界，取最近一个未来时刻）。
    const parsed = parseWithTimezone(`${new Date(nowMs).getUTCFullYear()}-${raw}`)
    if (parsed === null) return { resetAtMs: null, resetRaw: raw }
    const yearMs = 365 * 24 * 60 * 60 * 1000
    return { resetAtMs: parsed < nowMs - yearMs / 2 ? parsed + yearMs : parsed, resetRaw: raw }
  }
  return { resetAtMs: null, resetRaw: null }
}

/** 只接受带时区标记的时刻；`Date.parse` 对无时区串会按本机时区解释，故先验后用。 */
function parseWithTimezone(value: string): number | null {
  // 剥掉尾随时区名缩写（CST / GMT / PST / EST ...）—— `+0800 CST` 这类组合
  // `Date.parse` 认偏移但不认名字。注意 `+0800` 必须保留（它就是时区）。
  const normalized = value.replace(/\s+UTC$/i, 'Z').replace(/\s+[A-Z]{2,4}$/, (match) => (
    /^\s+(?:Z|UTC)$/i.test(match) ? match : ''
  ))
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : null
}

/* ───────────────────────── 判定主体 ───────────────────────── */

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some(pattern => pattern.test(text))
}

/** 抠厂商自报码：优先取内嵌 JSON 的 `"code":"xxxx"`，否则取裸 4 位数字码。 */
function extractVendorCode(message: string): string | null {
  const quoted = /"code"\s*:\s*"([^"]+)"/.exec(message)
  if (quoted !== null) return quoted[1]
  const bare = /(?:^|[\s:{])([0-9]{4})(?:[\s,}]|$)/.exec(message)
  return bare === null ? null : bare[1]
}

/**
 * 判定一次失败尝试。
 *
 * @param failure - DSH 归一化的失败事实（`{ message, code, status? }`）。
 * @param nowMs - 解析无年份重置时刻的参考时刻；缺省 `Date.now()`。
 * @returns 判定结果。**不确定一律 `other`**（Spec §10.3 第 9 条）。
 */
export function classifyQuotaFailure(failure: QuotaFailureLike, nowMs: number = Date.now()): FinanceQuotaClass {
  const message = typeof failure.message === 'string' ? failure.message : ''
  const code = typeof failure.code === 'string' ? failure.code : ''

  // ① 容量/突发最先判：它是 429 但明确不是额度，判晚了就会被下面的 429 分支吃掉。
  if (matchesAny(CAPACITY_PATTERNS, message)) return { kind: 'capacity' }

  const quota = (window: FinanceQuotaWindow): FinanceQuotaClass => {
    const reset = parseQuotaReset(message, nowMs)
    return {
      kind: 'quota',
      window,
      vendorCode: extractVendorCode(message),
      resetAtMs: reset.resetAtMs,
      resetRaw: reset.resetRaw,
    }
  }

  // ② 余额 → ③ 免费额度 → ④ 周 → ⑤ 5 小时 → ⑥ 月
  if (matchesAny(BALANCE_PATTERNS, message)) return quota('balance')
  if (matchesAny(TRIAL_PATTERNS, message)) return quota('trial')
  if (matchesAny(WEEK_PATTERNS, message)) return quota('week')
  if (matchesAny(FIVE_HOUR_PATTERNS, message)) return quota('5h')
  if (matchesAny(MONTH_PATTERNS, message)) return quota('month')

  // ⑦ 内核 canonical 额度码：窗口认不出来，但内核已判过是额度 —— 记 unknown，不猜窗口。
  if (code === 'QUOTA') return quota('unknown')

  // ⑧ 限流但无任何额度措辞 → throttle（含 "429 status code (no body)" 这类无信息样本）。
  if (code === 'RATE_LIMIT' && !QUOTA_WORDING.test(message)) return { kind: 'throttle' }

  // ⑨ 其余一律无关。
  return { kind: 'other' }
}

/* ───────────────────────── 去重 ───────────────────────── */

/**
 * 消息指纹：剥掉 request-id / UUID / 时间戳后取前 120 字符。
 *
 * 用途是去重键的**最后兜底**——`resetRaw` 也拿不到的样本（实测 123 条里 58 条）
 * 需要它，否则同一次断供会被拆成多条 episode、或不同断供被错误合并。
 */
export function quotaMessageSignature(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{30,}\b/gi, '<hex>')
    .replace(/20[0-9]{2}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\s*(?:Z|UTC|[+-][0-9]{4}))?/gi, '<ts>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/**
 * episode 去重键：`(modelKey, window, resetAtMs ?? resetRaw ?? signature)`。
 *
 * 实测同一次断供会留下 `5× llm/retry + 1× turn/end`（原始事件 123 → 真实断供 21，
 * **~6 倍放大**）。计数口径必须是 episode，不是事件数（Spec §10.2 C3）。
 *
 * @param modelKey - `provider/model`；调用方负责归属（`turn/end` 不带 provider）。
 * @param result - 分类结果，必须已确认 `kind === 'quota'`。
 * @param message - 原始 message，用于指纹兜底。
 */
export function quotaEpisodeKey(modelKey: string, result: FinanceQuotaClass, message: string): string {
  if (result.kind !== 'quota') return `${modelKey}|non-quota`
  const anchor = result.resetAtMs !== null
    ? String(result.resetAtMs)
    : result.resetRaw ?? quotaMessageSignature(message)
  return `${modelKey}|${result.window}|${anchor}`
}