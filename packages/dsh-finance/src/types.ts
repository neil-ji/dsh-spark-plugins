/**
 * Client-safe finance vocabulary shared by the host ledger service and the
 * web finance-audit surface. Types only; the projection key declaration lives
 * here so client aggregates import one face without dragging the host service.
 *
 * @module @deepseek-ai/dsh-spark-finance/types
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { FinanceBackfillStreamFrame } from 'dsh-spark-finance-wire'
import type { FinanceQuotaWindow } from './quota.ts'
export type { FinanceQuotaWindow }
export type { FinanceQuotaClass } from './quota.ts'
// Re-export so the public `dsh-spark-finance/types` surface still carries
// the wire-published frame type (downstream embedders don't have to know
// about the wire package).
export type { FinanceBackfillStreamFrame }
// F11 commit: extend cordis Events so `ctx.emit('finance/backfillProgress', …)`
// and `ctx.on('finance/backfillProgress', …)` are statically typed. Same
// declaration shape as dsh-spark (`sparks/changed`), dsh-hippomemo
// (`hippomemo/changed`), dsh-github and dsh-npm.
declare module '@deepseek-ai/cordis' {
  interface Events {
    'finance/backfillProgress'(progress: FinanceBackfillProgress): void
    /** 一轮对话落账后触发（宿主去重）：客户端据此增量刷新账本。 */
    'finance/ledgerUpdated'(): void
  }
}

/**
 * The finance Remote namespace, declared once for the whole plugin.
 *
 * This block used to live in `typert.remote-client.ts` — one of the two
 * hand-copied manifests ADR-005 / P5 deleted. The descriptors themselves now
 * come from `dsh-spark-finance-wire` (a single source); what remains here is
 * only the static type face, which must name the host types and therefore
 * cannot live in the dependency-free wire package.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  // F11 commit: stream endpoint that replaces the 600 ms client polling of
  // `finance/getBackfillProgress`. Lives on the `financeEvents` Cordis service
  // (see dsh-spark-finance-wire / FINANCE_HOST_CONTRIBUTION); the descriptor
  // declares it under the `finance` namespace so a consumer mounts one Remote
  // and gets both snapshot RPCs and the live event stream from it.
  interface TypertRemoteNamespace$66696e616e6365 {
    getBalance: () => Promise<RemoteResult<FinanceBalanceView>>
    getLedger: () => Promise<RemoteResult<FinanceLedger>>
    getOverview: () => Promise<RemoteResult<FinanceOverview>>
    getBackfillProgress: () => Promise<RemoteResult<FinanceBackfillProgress>>
    syncCommunityPrices: (options?: FinanceSyncOptions) => Promise<RemoteResult<FinanceCommunitySyncResult>>
    getSyncStatus: () => Promise<RemoteResult<FinanceSyncStatus | null>>
    getPriceTableStatus: () => Promise<RemoteResult<FinancePriceTableStatus>>
    clearPriceOverlay: () => Promise<RemoteResult<FinanceClearOverlayResult>>
    listProviders: () => Promise<RemoteResult<FinanceListProvidersResult>>
    refreshBalance: (request: FinanceRefreshBalanceRequest) => Promise<RemoteResult<FinanceProviderBalance>>
    events: (signal?: AbortSignal) => AsyncIterable<FinanceBackfillStreamFrame>
  }
  interface TypertRemoteMap {
    'finance/getBalance': () => Promise<RemoteResult<FinanceBalanceView>>
    'finance/getLedger': () => Promise<RemoteResult<FinanceLedger>>
    'finance/getOverview': () => Promise<RemoteResult<FinanceOverview>>
    'finance/getBackfillProgress': () => Promise<RemoteResult<FinanceBackfillProgress>>
    'finance/syncCommunityPrices': (options?: FinanceSyncOptions) => Promise<RemoteResult<FinanceCommunitySyncResult>>
    'finance/getSyncStatus': () => Promise<RemoteResult<FinanceSyncStatus | null>>
    'finance/getPriceTableStatus': () => Promise<RemoteResult<FinancePriceTableStatus>>
    'finance/clearPriceOverlay': () => Promise<RemoteResult<FinanceClearOverlayResult>>
    'finance/listProviders': () => Promise<RemoteResult<FinanceListProvidersResult>>
    'finance/refreshBalance': (request: FinanceRefreshBalanceRequest) => Promise<RemoteResult<FinanceProviderBalance>>
    'finance/events': (signal?: AbortSignal) => AsyncIterable<FinanceBackfillStreamFrame>
  }
  interface TypertRemoteNamespaceMap {
    finance: TypertRemoteNamespace$66696e616e6365
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Provider-reported token buckets accumulated by model and by UTC day. */
    financeUsage: FinanceUsageProjection
    /**
     * Provider-reported token buckets accumulated by model and by UTC hour
     * (`YYYY-MM-DDTHH`). The hour key is what lets the ledger price each
     * usage hour at its own peak/off-peak rate. Registered as a SEPARATE unit
     * from `financeUsage` on purpose: bumping the shared unit's
     * `stateVersion` would discard every cached checkpoint (the cache drops
     * rows on version mismatch, never migrates), forcing a full log replay of
     * every session. Sessions checkpointed before this unit existed simply
     * lack it and fall back to `financeUsage` totals priced at the base
     * (off-peak) rate — same graceful degradation as the `tokenUsage` path.
     */
    financeUsageHourly: FinanceHourlyProjection
    /**
     * 每模型的解码时长 / 输出 token / 首 token 延迟（P1-B）。与平台
     * `sessionStats`（全会话口径）同一套事件语义，但按模型分桶 —— 面板要回答
     * "哪个厂商的这个模型更快"。**forward-only**：只有装了本版本的会话才有该键，
     * 旧会话不显示速率（不回溯补造）。
     */
    financeRate: FinanceRateProjection
    /**
     * 每模型的上下文长度分布（P2）：阶梯价与"把长会话拆开能省多少"的分析输入。
     * 同样 forward-only：旧会话没有该键，相关卡片不显示该模型。
     */
    financeContext: FinanceContextProjection
    /**
     * 额度触达 episode（SPEC §10）：厂商明确回报"额度到顶"的观测记录。
     * **forward-only**：旧会话没有该键，不回溯补造（同 `financeRate`）。
     */
    financeQuota: FinanceQuotaProjection
    /**
     * 每模型 × UTC 小时的速率样本（窗口归因的时长口径）。
     * **forward-only**：旧会话没有该键，Card 的时长列不显示。
     */
    financeRateHourly: FinanceRateHourlyProjection
    /**
     * Provider-reported token totals from the harness core token-meter.
     * Checkpointed for every session (including ones persisted before this
     * plugin existed), so the ledger can read historical totals with zero log
     * replay. Structurally identical to FinanceTokenBuckets.
     */
    tokenUsage: FinanceTokenBuckets
  }
}

/** Disjoint token buckets for one model call or aggregate. */
export interface FinanceTokenBuckets {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

/** Durable finance projection value for one session log. */
export interface FinanceUsageProjection {
  /** Keyed by `${provider}/${model}`, the request-header route at usage time. */
  byModel: Record<string, FinanceTokenBuckets>
  /** Keyed by YYYY-MM-DD in UTC. */
  byDay: Record<string, FinanceTokenBuckets>
  totals: FinanceTokenBuckets
}

/** Durable per-hour finance projection value for one session log. */
export interface FinanceHourlyProjection {
  /** Keyed by modelKey, then by UTC hour key `YYYY-MM-DDTHH`. */
  byModelHour: Record<string, Record<string, FinanceTokenBuckets>>
}

/**
 * 速率样本（一个模型的累计）：解码墙钟与输出 token 用来算输出吞吐，
 * 首 token 延迟用来算"多久开始出字"。
 * 口径与平台 `sessionStats` 一致：decode = 首 token → 组装消息，
 * 只统计同时报了 output token 的步；被取消的步不计时。
 */
export interface FinanceRateStats {
  /** Summed decode wall time over usage-reporting steps, ms. */
  decodeMs: number
  /** Summed provider output tokens over the same steps. */
  decodeTokens: number
  /** Summed first-token latency over `ttftSteps`, ms. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
}

/** Durable rate projection value for one session log. */
export interface FinanceRateProjection {
  byModel: Record<string, FinanceRateStats>
}

/**
 * 上下文长度分档的固定边界（prompt token）。分成 boundaries.length + 1 个桶：
 * 每桶上界 = 该边界，最后一桶无上界。契约单源：host 折叠与 client 聚合都读这一份。
 *
 * 覆盖常见阶梯阈值（32k / 128k / 200k / 1M）；用户配置的档位阈值若不落在这些点上，
 * 客户端按"桶上界 <= 阈值"保守聚合（宁可少算省额，不多算）。
 */
export const FINANCE_CONTEXT_BOUNDARIES: readonly number[] = [32_000, 128_000, 200_000, 1_000_000]

/** 一个上下文长度桶里累计的用量。 */
export interface FinanceContextBucket {
  /** 桶上界（prompt token）；null = 最后一桶（无上界）。 */
  maxPromptTokens: number | null
  /** 落在该桶的步所消耗的四类 token。 */
  usage: FinanceTokenBuckets
  /** 落在该桶的步数。 */
  steps: number
}

/** Durable context-length projection value for one session log. */
export interface FinanceContextProjection {
  /** Keyed by modelKey; every entry carries exactly `FINANCE_CONTEXT_BOUNDARIES.length + 1` buckets. */
  byModel: Record<string, FinanceContextBucket[]>
}

/**
 * `financeQuota` 投影的 client-visible 值：该会话观察到的额度触达 episode。
 *
 * 只装 `kind === 'quota'` 的判定结果——`capacity`（服务容量繁忙）与
 * `throttle`（请求限流）**永不入账本**，它们只是分类器用来"不被误记成额度"的旁证
 * （SPEC §10.3）。
 */
export interface FinanceQuotaProjection {
  episodes: readonly FinanceQuotaEpisodeRow[]
}

/**
 * `financeRateHourly` 投影值：每模型 × UTC 小时的速率样本。
 * 窗口归因 Card 用它回答"这段时间里某模型解码了多久"——`financeRate`（无时间维度）
 * 只能给会话总量，切不出任意窗口。
 */
export interface FinanceRateHourlyProjection {
  byModelHour: Record<string, Record<string, FinanceRateStats>>
}

/**
 * 一条 context 阶梯价档：prompt token 不超过 `maxPromptTokens` 时整步按该档费率计。
 * `maxPromptTokens = 0` 表示兜底档（吃掉前面所有档没覆盖的部分）。
 * 这是在既有平价表之外的**附加估算输入**，不改变账本已算出的成本。
 */
export interface FinanceTierEntryInput {
  maxPromptTokens: number
  inputMicrosPerMtok: number
  cacheReadMicrosPerMtok?: number
  cacheWriteMicrosPerMtok?: number
  outputMicrosPerMtok: number
  /**
   * G2：缓存读倍率（相对该档 `inputMicrosPerMtok`，Anthropic 0.1 / Qwen 0.1–0.2）。
   * 绝对价 `cacheReadMicrosPerMtok` 优先；两者都缺省则继承输入价。语义见 SPEC §2.3 规则 1。
   */
  cacheReadMultiplier?: number
  /**
   * G3：缓存写倍率（Anthropic 5m=1.25 / 1h=2）。绝对价 `cacheWriteMicrosPerMtok` 优先。
   * 语义见 SPEC §2.3 规则 1。
   */
  cacheWriteMultiplier?: number
  /**
   * G3：缓存写 TTL 绝对价（Kimi 5min=¥20 / 1h=¥40，micros/Mtok）。
   * 仅当 `cacheWriteMicrosPerMtok` / `cacheWriteMultiplier` 都缺省时参与解析，
   * 且只取 `m5`（保守）；语义见 SPEC §2.3 规则 2。
   */
  cacheWriteTtl?: { m5?: number; h1?: number }
}

/** 缓存写 TTL 绝对价（micros/Mtok）。只声明实际用到的档位。 */
export interface FinanceTierCacheWriteTtl {
  m5?: number
  h1?: number
}

/** 归一化后的阶梯档（按 `maxPromptTokens` 升序，兜底档恒在最后）。 */
export interface FinanceTierEntry {
  maxPromptTokens: number
  inputMicrosPerMtok: number
  cacheReadMicrosPerMtok?: number
  cacheWriteMicrosPerMtok?: number
  outputMicrosPerMtok: number
  /** 归一化后仍保留的倍率写法（绝对价缺省时由消费者解析）；绝对价存在则不写入。 */
  cacheReadMultiplier?: number
  cacheWriteMultiplier?: number
  cacheWriteTtl?: FinanceTierCacheWriteTtl
}

/**
 * 一组阶梯价（一个 `modelKey` 的价表，可含币种/区域限定）。
 *
 * 这是 settings 里的**新形状**；旧形状（裸 `FinanceTierEntryInput[]`）仍被接受并按
 * `currency = 'CNY'` 归一化（SPEC §2.3 规则 4）。
 */
export interface FinanceTierSpec {
  /** G1：计价币种。缺省 'CNY'。与账本币种不一致时整组不参与估算。 */
  currency?: string
  /** 档位列表（至少一档；`maxPromptTokens = 0` 为兜底档）。 */
  tiers: FinanceTierEntryInput[]
  /** G5：时段折扣，0 < r < 1（DeepSeek 空闲 5 折 = 0.5）。缺省 1 = 不打折。 */
  offPeakDiscount?: number
  /** G4：生效窗口。数字 = epoch ms，字符串 = 可 `Date.parse` 的日期；缺省 = 无界。 */
  effectiveFrom?: string | number
  effectiveTo?: string | number
}

/**
 * 归一化后的一组阶梯价。`key` 保留原始 modelKey（可能带 `#suffix` 限定），
 * 由消费者按「精确匹配 → 剥后缀回退」解析（SPEC §2.3 规则 3）。
 */
export interface FinanceTierGroup {
  /** 组 key：原始 modelKey，含 `#suffix` 时后缀表达币种/地域变体。 */
  key: string
  /** 剥净 `#suffix` 后的 modelKey。 */
  modelKey: string
  /** 限定后缀（`#` 之后的部分）；无后缀时为 undefined。 */
  suffix?: string
  currency: string
  tiers: readonly FinanceTierEntry[]
  offPeakDiscount: number
  effectiveFrom?: number
  effectiveTo?: number
}

/**
 * Price rate expressed in integer micros per million tokens. Cache fields are
 * optional: when absent the input rate is used (DeepSeek has no separate
 * cache-write line; its API never reports cache writes).
 */
export interface FinancePriceRate {
  inputMicrosPerMtok: number
  cacheReadMicrosPerMtok?: number
  cacheWriteMicrosPerMtok?: number
  outputMicrosPerMtok: number
}

/**
 * Time-of-day pricing for one model: separate rates for peak and off-peak
 * local hours. Peak windows are half-open hour ranges (end exclusive) that
 * apply only on the listed days of the week. Defaults follow DeepSeek's
 * official peak window: weekdays (Mon-Fri) 9:00-12:00 and 14:00-18:00
 * Beijing time, i.e. UTC+8.
 */
export interface FinanceWindowedRate {
  /** Rate applied outside every peak window. */
  offPeak: FinancePriceRate
  /** Rate applied inside any peak window. */
  peak: FinancePriceRate
  /** Half-open local-hour ranges; default [[9,12],[14,18]]. */
  peakHours?: ReadonlyArray<readonly [number, number]>
  /**
   * Days of the week (0=Sunday..6=Saturday on the entry's local clock) the
   * peak windows apply on; default weekdays [1,2,3,4,5] (Mon-Fri), matching
   * DeepSeek's official peak hours. Omit only when a schedule genuinely peaks
   * every day.
   */
  peakDays?: ReadonlyArray<number>
  /** UTC offset in minutes for the local hour clock; default 480 (UTC+8). */
  utcOffsetMinutes?: number
}

/**
 * One normalized price-table entry: a rate (flat 24/7 or peak/off-peak) that
 * applies from a moment onward. Several entries per model form an era history
 * — the latest entry whose `effectiveFrom` is <= the usage time prices it.
 */
export type FinancePriceEntry =
  | { effectiveFrom: number; kind: 'flat'; rate: FinancePriceRate }
  | { effectiveFrom: number; kind: 'windowed'; rate: FinanceWindowedRate }

/**
 * Raw price entry as configured in YAML/settings, before normalization. The
 * shapes deliberately mirror schemastery's inferred input types (mutable
 * arrays, optional effectiveFrom) so the settings schema stays assignable.
 */
export type FinancePriceEntryInput =
  | {
    effectiveFrom?: string | number
    inputMicrosPerMtok: number
    cacheReadMicrosPerMtok?: number
    cacheWriteMicrosPerMtok?: number
    outputMicrosPerMtok: number
  }
  | {
    effectiveFrom?: string | number
    offPeak: FinancePriceRate
    peak: FinancePriceRate
    peakHours?: number[][]
    peakDays?: number[]
    utcOffsetMinutes?: number
  }

/** Raw finance configuration as validated from settings, before normalization.
 *
 * Note: no top-level `currency` — every monetary field is per-provider.
 * `FinanceProviderEntry.currency` carries the provider's account currency, the
 * legacy `FinanceBalanceView.currency` mirrors the per-provider slot, and the
 * ledger's display currency follows the row's provider. The bundle defaults
 * each known provider via `HOST_KNOWN_PROVIDER_META.defaultCurrency`.
 */
export interface FinanceConfigInput {
  balance?: FinanceConfig['balance']
  defaultPrice?: FinancePriceRate
  /**
   * Flat per-provider fallback rates, keyed by provider (the part of the model
   * key before the first '/' of 'provider/model'). A model with no
   * prices[modelKey] entry prices at its provider's default rate first, then
   * at the global defaultPrice. This is what lets the ledger give non-DeepSeek
   * providers (openai/*, anthropic/*, google/*, ...) a sensible cost without
   * enumerating every model.
   */
  providerDefaults?: Record<string, FinancePriceRate>
  /**
   * One price entry per model key, or an era history list of entries.
   *
   * Per-route billing classification (plan vs metered) used to live here as a
   * `billingModes` map; it was retired when the UI editor was dropped
   * (no surface to set it on, while the bundle never shipped defaults that
   * actually classified anything as plan). The classification is now
   * derived exclusively from `hostMeta.defaultBillingMode` on each provider,
   * so the editor surface never had to exist.
   */
  prices?: Record<string, FinancePriceEntryInput | FinancePriceEntryInput[]>
  /**
   * 静态订阅套餐（用户填一次）：月费 + 可选额度 + 计费周期形态 + 生效期。
   * 刻意**不**追踪每周期剩余额度——"省了多少"由实际用量推算（见客户端 derive.planInsight）。
   */
  plans?: FinancePlanEntryInput[]
  /**
   * 按 modelKey 声明的 context 阶梯价（可选）。只在"拆分会话能省多少"这张卡里用，
   * **不改动**账本已有的成本口径（那仍然走 prices / providerDefaults / defaultPrice）。
   *
   * 值有两种形状：旧的裸 `FinanceTierEntryInput[]`（隐式 CNY）、新的 `FinanceTierSpec`
   * （可带币种 / 时段折扣 / 生效窗口）。key 允许带 `#suffix` 限定后缀。
   */
  tiers?: Record<string, FinanceTierEntryInput[] | FinanceTierSpec>
  /**
   * Per-provider configuration entries — one row per provider the user wants
   * to track (DeepSeek-official, MiniMax-M3, OpenAI, ...). Each row carries
   * billing mode, plan/top-up budget, currency, optional auto-fetch flag, and
   * an optional validity range. Empty array = no per-provider tracking yet;
   * commit 12 will start filling this from settings + host-known metadata.
   * The schema upper bound for `totalPriceMicros` is 100_000_000_000 (i.e.
   * 100,000 CNY/USD in micros), matching the 0-100,000 UI range.
   */
  providers?: FinanceProviderEntry[]
}

/**
 * Per-provider billing classification surfaced in the provider config card.
 * `metered` = pay-as-you-go wallet (the historical DeepSeek default);
 * `plan` = subscription (cost is a list-price equivalent, never cash flow);
 * `free` = no money changes hands at all. The `free` value is rendered in the
 * card but never produces a balance view (auto-fetch is hidden, plan window
 * does not apply).
 */
export type FinanceProviderBillingMode = 'metered' | 'plan' | 'free'

/**
 * One row in the per-provider configuration list. `totalPriceMicros` is in
 * currency micros (CNY or USD depending on `currency`) and is interpreted as
 * either the subscription total (`plan`) or the topped-up wallet amount
 * (`metered`). `validity` is optional: when absent the provider is treated as
 * permanent (typical for `metered`). Auto-fetch is currently only honoured by
 * `deepseek-official`; the host-known provider metadata decides whether the
 * field is even rendered.
 */
export interface FinanceProviderEntry {
  /** Provider id, matches the leading path segment of `modelKey` (`provider/model`). */
  provider: string
  billingMode: FinanceProviderBillingMode
  /** Currency micros; UI displays in major units (元 / $). Capped at 100,000. */
  totalPriceMicros: number
  /**
   * INV-9 (FINANCE-PRICING-SPEC §5.4)：用户自报余额（micros）。仅当自动获取
   * 不可用（厂商不支持 / autoFetch 关闭 / 拉取失败）时作为余额呈现；从不进账本
   * 成本口径。optional = 旧数据无此字段，行为不变。
   */
  manualBalanceMicros?: number
  /**
   * Account currency for this provider. Free-form string — the host-known
   * metadata seeds it for recognized providers (deepseek-official = CNY by
   * default), but anything the upstream API emits is allowed through.
   * Validation stops at "non-empty" so typos surface in the editor instead
   * of silently dropping balances.
   */
  currency: string
  /** Persisted user toggle; the host actually fires the balance fetch. */
  autoFetchBalance: boolean
  /** Optional validity window in epoch ms. Both bounds optional; absent = 永久. */
  validity?: { startMs?: number; endMs?: number }
}

/**
 * Balance view for one provider. The current host only fetches DeepSeek; other
 * providers surface as `status: 'unsupported'` with a stable `code` so the UI
 * can pick a sensible empty state. `totalMicros` is in the provider's declared
 * currency (whatever the upstream API reports; surfaced verbatim to the UI).
 */
export interface FinanceProviderBalance {
  status: 'ok' | 'missing-credential' | 'unsupported' | 'error'
  provider: string
  totalMicros?: number
  /** Currency code the upstream returned. Free-form string — anything the
   * API emits (CNY / USD / JPY / EUR / ...) flows through unchanged. The
   * BalanceGrid's currency-aware formatter falls back to "—" for unknown
   * codes so a typo doesn't crash the UI. */
  currency?: string
  /**
   * INV-9（FINANCE-PRICING-SPEC §5.4）：余额来源。'auto' = 接口拉取（缺省，
   * 兼容旧快照），'manual' = 用户自报（`manualBalanceMicros`）。UI 据此区分呈现。
   */
  source?: 'auto' | 'manual'
  /** Stable lower-kebab code (e.g. 'auth', 'http', 'unsupported-provider'). */
  code?: string
  /** Human-readable message; UI may show or hide depending on the code. */
  message?: string
  /** Epoch ms when this view was produced; never reused across calls. */
  fetchedAt: number
}

/** 计费周期形态（仅作标签：本插件不追踪周期剩余额度）。 */
export type FinancePlanPeriod = 'month' | 'month-week' | 'month-week-5h'

/**
 * 用户填写的一条静态套餐：某 provider 每月花多少钱、可选的月额度。
 * 这是 P1 的"订阅 vs 按量"对比输入——除月费外都不需要精确，缺省即不显示。
 */
export interface FinancePlanEntryInput {
  /** Provider id（与账本 byProvider 对齐；`-official` 后缀会自动归一）。 */
  provider: string
  /** 月费，币种 micros（CNY/USD 由 currency 决定）。 */
  monthlyMicros: number
  currency: string
  /** 可选：该套餐包含的月 token 额度（用于"用满能省多少"）。 */
  quotaTokens?: number
  /** 可选：计费周期形态，仅用于标签与提醒。 */
  periodLabel?: FinancePlanPeriod
  /** 可选生效期（epoch ms 或日期串）；空 = 始终生效。 */
  effectiveFrom?: string | number
}

/** 归一化后的套餐条目（effectiveFrom 已折算为 epoch ms，0 = 始终）。 */
export interface FinancePlanEntry {
  provider: string
  monthlyMicros: number
  currency: string
  quotaTokens?: number
  periodLabel?: FinancePlanPeriod
  effectiveFrom: number
}

/** Resolved finance configuration (prices normalized to era-sorted entries). */
export interface FinanceConfig {
  currency: string
  balance: {
    baseURL: string
    apiKeyEnv: string
    timeoutMs: number
  }
  defaultPrice: FinancePriceRate
  providerDefaults: Record<string, FinancePriceRate>
  /**
   * Per-provider billing mode map populated by the service layer from
   * `HOST_KNOWN_PROVIDER_META`. Absent for unknown providers — they fall
   * through to 'metered' at lookup time, matching the historical default.
   * Free routes are typed `free` here but the wallet-vs-plan rollup
   * excludes them, so the ledger never books them as cash flow.
   */
  hostMetaByProvider: Record<string, FinanceProviderBillingMode>
  prices: Record<string, readonly FinancePriceEntry[]>
  /** Resolved static subscription plans (defaults to [] when settings omit them). */
  plans: readonly FinancePlanEntry[]
  /**
   * Resolved context tier groups, keyed by the **stripped** modelKey (defaults to {}
   * when settings omit them). One key normally carries exactly one group; more than
   * one is an unsupported configuration (we only price China-mainland rates) and is
   * reported as ambiguous rather than guessed (SPEC §2.3).
   */
  tiers: Record<string, readonly FinanceTierGroup[]>
  /** Resolved per-provider list (defaults to [] when settings omit it). */
  providers: readonly FinanceProviderEntry[]
}

export type FinanceBalanceStatus = 'ok' | 'missing-credential' | 'error'

/**
 * Host-only projection of the DeepSeek balance endpoint. The legacy
 * single-provider fields (currency / totalMicros / ...) remain the DeepSeek
 * view: the host still fetches DeepSeek first and copies that into the
 * `providers.deepseek-official` slot of `providers` (commit 12). Other
 * providers carry their own per-provider view there. `providers` is optional
 * so older hosts and older settings can stay zero-dependency.
 */
export interface FinanceBalanceView {
  status: FinanceBalanceStatus
  updatedAt: number
  /**
   * @deprecated Commit 19: prefer `providers.deepseek-official.totalMicros`.
   * Kept populated for clients that haven't migrated to the per-provider view
   * yet; will be removed once the dashboard reads only `providers`.
   */
  isAvailable?: boolean
  /** @deprecated Commit 19: prefer `providers.deepseek-official.currency`. */
  currency?: string
  /** @deprecated Commit 19: prefer `providers.deepseek-official.totalMicros`. */
  totalMicros?: number
  /** @deprecated Commit 19: prefer `providers.deepseek-official` extras. */
  grantedMicros?: number
  /** @deprecated Commit 19: prefer `providers.deepseek-official` extras. */
  toppedUpMicros?: number
  /** @deprecated Commit 19: prefer `providers.deepseek-official.code/message`. */
  code?: string
  /** @deprecated Commit 19: prefer `providers.deepseek-official.message`. */
  message?: string
  /**
   * Per-provider balance views keyed by provider id. Present once the host
   * has provider-aware balance fetching (commit 12). The DeepSeek-official
   * entry is the same shape as the legacy single fields above.
   */
  providers?: Record<string, FinanceProviderBalance>
}

/**
 * Source flag for one row in the merged provider list returned by
 * `finance.listProviders`. A single provider id can appear under several
 * sources (e.g. host-known + user-config + ledger-observed).
 *
 * - `host-known`: the provider is in `HOST_KNOWN_PROVIDER_META` (the host has
 *   special metadata for it: default billing/currency, balance-fetch capability,
 *   etc).
 * - `user-config`: the user added a `FinanceProviderEntry` row in
 *   `config.providers` for this id.
 * - `ledger-observed`: at least one persisted session observed a model under
 *   this provider (the ledger's `byProvider` rollup surfaced it).
 * - `llm-runtime`: the local dsh-llm runtime has a configured provider with
 *   this id (e.g. a `cordis.patch.yml` provider block that the user has set
 *   up but has not yet used). Surfaced only when the runtime exposes a
 *   list-providers surface; absent otherwise.
 */
export type FinanceProviderSource = 'host-known' | 'user-config' | 'ledger-observed' | 'llm-runtime'

/**
 * One row in the merged provider list. Every entry carries a `balance` slot
 * (the same shape as `FinanceProviderBalance`), populated lazily:
 * - For fetch-capable providers with `autoFetchBalance=true`, the host actually
 *   fires the upstream request.
 * - For everything else, the slot is `status: 'unsupported'` with a stable code
 *   (`free-provider` / `unsupported-provider` / `no-balance-fetch` /
 *   `auto-fetch-disabled`) so a sensible empty state is renderable client-side.
 */
export interface FinanceListProvidersEntry {
  provider: string
  /** Source flags. Always at least one. */
  sources: readonly FinanceProviderSource[]
  /**
   * Host-known metadata, when the provider id is in
   * `HOST_KNOWN_PROVIDER_META`. Fields mirror `FinanceHostProviderMeta` minus
   * the `provider` echo.
   */
  hostMeta?: {
    defaultBillingMode: FinanceProviderBillingMode
    defaultCurrency: string
    supportsBalanceFetch: boolean
    lockBillingModeAndCurrency?: boolean
  }
  /** User-configured entry, when present in `config.providers`. */
  userEntry?: FinanceProviderEntry
  /** Latest Balance view for this provider (fetched or unsupported). */
  balance: FinanceProviderBalance
}

/**
 * Result of `finance.listProviders`: the merged provider set with per-provider
 * balance snapshots. `generatedAt` lets the dashboard tell a fresh list apart
 * from a cached one without trusting local clocks for ordering.
 */
export interface FinanceListProvidersResult {
  /** One entry per id seen (de-duplicated by provider). */
  providers: readonly FinanceListProvidersEntry[]
  /** Epoch ms the snapshot was produced. */
  generatedAt: number
}

/**
 * Request body for `finance.refreshBalance`: re-fetch the balance for one
 * provider. The provider id must match a row in `FinanceListProvidersResult`
 * (or one that the host can resolve from `HOST_KNOWN_PROVIDER_META` /
 * `config.providers`). Unknown ids return an `unsupported` slot rather than
 * throwing.
 */
export interface FinanceRefreshBalanceRequest {
  provider: string
}

export interface FinanceSessionRow {
  sessionId: string
  title: string | null
  createdAt: number
  cwd?: string
  workspaceId: string | null
  workspaceTitle: string | null
  taskId: string
  parentSessionId?: string
  delegationDepth?: number
  origin?: 'subagent'
  modelKeys: readonly string[]
  usage: FinanceTokenBuckets
  costMicros: number
}

/**
 * One stored session the ledger could not read and therefore skipped.
 *
 * A single unreadable log — a legacy v0 artifact the host's session-format
 * migration refuses, a truncated file — must not blank the whole dashboard.
 * The session is excluded from every rollup (its spend is simply missing) and
 * reported here so the panel can warn instead of failing the build outright.
 */
export interface FinanceUnreadableSessionRow {
  sessionId: string
  createdAt: number
  /** Reader-side error message, surfaced verbatim in the dashboard warning. */
  reason: string
}

export interface FinanceTaskRow {
  taskId: string
  title: string | null
  createdAt: number
  sessionCount: number
  usage: FinanceTokenBuckets
  costMicros: number
}

export interface FinanceWorkspaceRow {
  workspaceId: string | null
  title: string
  sessionCount: number
  usage: FinanceTokenBuckets
  costMicros: number
}

/**
 * Billing route classification. 'plan' routes are subscriptions: their
 * amounts in the ledger are LIST-PRICE EQUIVALENTS, not cash flow, so the
 * client labels them apart and excludes them from wallet-facing math.
 */
export type FinanceBillingMode = 'metered' | 'plan' | 'free'

export interface FinanceModelRow {
  modelKey: string
  /** Provider part of the model key (the part before the first '/'). */
  provider: string
  /** Model part of the model key (the part after the first '/'). */
  model: string
  /**
   * How this route bills ('mixed' never appears here — that is a rollup-only
   * state). Absent on old snapshots = 'metered'.
   */
  billingMode?: FinanceBillingMode
  usage: FinanceTokenBuckets
  costMicros: number
  /**
   * Potential savings of shifting this model's peak-hour usage off-peak
   * (peak cost minus the same tokens at off-peak rates). Present only on the
   * exact per-hour path; absent when the model has no hour detail.
   */
  shiftSavingsMicros?: number
  /**
   * 输出速率样本（P1-B）。只在装了 financeRate 投影之后产生的会话里有值；
   * 旧会话缺席 —— 面板此时不显示速率列，而不是拿 0 冒充。
   */
  rate?: FinanceRateStats
  /**
   * 上下文长度分布（P2）。同样 forward-only：旧会话缺席时"拆分会话"卡不显示该模型，
   * 而不是假装它的上下文很短。
   */
  context?: readonly FinanceContextBucket[]
}

/** Per-provider cost rollup across every model observed under that provider. */
export interface FinanceProviderRow {
  provider: string
  usage: FinanceTokenBuckets
  costMicros: number
  /** Distinct models observed under this provider. */
  modelCount: number
  /**
   * Rollup of member models' modes: all-plan -> 'plan', mixed -> 'mixed',
   * otherwise omitted (pure-metered is the default and needs no marker).
   */
  billingMode?: FinanceBillingMode | 'mixed'
}

export interface FinanceDayRow {
  day: string
  usage: FinanceTokenBuckets
  costMicros: number
}

/**
 * Cost band of one priced usage hour. peak/offpeak come from a windowed
 * (peak/off-peak) price entry; flat from a flat 24/7 era line or the
 * default-price fallback. Sessions without hour detail are not banded — they
 * land in the ledger's unclassified bucket instead.
 */
export type FinanceTimeBand = 'peak' | 'offpeak' | 'flat'

/**
 * One hour-of-day bucket aggregated across the whole ledger from the
 * windowed-era hourly usage (the hour detail financeUsageHourly provides).
 * The 24 rows cover one rolling 24-hour window (hourOfDayWindowStartMs ..
 * now): each local hour of day appears exactly once, so the row can be
 * rendered either as a fixed 0-23 clock pattern or as a time-ordered
 * rolling window when hourStartMs is present.
 */
export interface FinanceHourOfDayRow {
  /** Local hour 0-23 on the model schedule's clock (default UTC+8). */
  localHour: number
  /**
   * Epoch ms of the real hour this bucket aggregates (the UTC hour start of
   * the usage hour). Lets the client lay the 24 buckets out in time order
   * across the rolling window and label ticks/tooltips with the real clock.
   * Absent on legacy snapshots — clients fall back to a bare HH:00 label.
   */
  hourStartMs?: number
  usage: FinanceTokenBuckets
  costMicros: number
  /** Cost priced inside a peak window; > 0 tints the bar as a peak hour. */
  peakCostMicros: number
  /** Cost priced at a flat era line; > 0 tints the bar as a flat-rate hour. */
  flatCostMicros: number
  /**
   * Potential savings of shifting THIS hour's peak usage off-peak (peak cost
   * minus the same tokens at off-peak rates). The sum across the 24 rows
   * equals the ledger-wide shiftSavingsMicros.
   */
  shiftSavingsMicros: number
}

/**
 * Peak/off-peak split of the ledger's estimated cost, plus the potential
 * savings of shifting peak-hour usage off-peak. The five cost buckets are
 * disjoint and sum to totalCostMicros (legacy included).
 */
export interface FinancePeakValleySplit {
  /** Cost billed inside peak windows (windowed-era hourly usage). */
  peakCostMicros: number
  /** Cost billed outside every peak window (windowed-era hourly usage). */
  offPeakCostMicros: number
  /** Hour-known usage priced at a flat price line (no window schedule). */
  flatCostMicros: number
  /** Hour-unknown usage priced at the base rate (no hourly detail). */
  unclassifiedCostMicros: number
  /**
   * Cost of sessions created BEFORE the windowed era began (see
   * `FinanceLedger.windowedSinceMs`). Peak/valley billing does not apply to
   * them: they are priced entirely at their pre-era flat rate and excluded
   * from the peak/off-peak buckets above and from the hour-of-day chart.
   */
  legacyCostMicros: number
  /**
   * What peak-hour usage would have cost at off-peak rates: the extra amount
   * paid because usage fell in peak hours (shift savings).
   */
  shiftSavingsMicros: number
}

export interface FinanceLedger {
  generatedAt: number
  currency: string
  totals: FinanceTokenBuckets
  totalCostMicros: number
  /**
   * Pay-as-you-go share of totalCostMicros: money that actually left (or is
   * draining) a metered wallet. The balance gauge reconciles against THIS.
   */
  meteredCostMicros?: number
  /**
   * Subscription-route share of totalCostMicros, valued at list prices — a
   * 'what this would have cost without the plan' equivalent, not cash flow.
   * Present only from hosts with billing-mode awareness.
   */
  planEquivalentCostMicros?: number
  /**
   * 免费额度路线的用量按目录价折算出的金额。既不是现金支出，也不是订阅等价 ——
   * 单列以免混进按量桶做出一笔假账（free provider 的用户才看得到）。
   */
  freeCostMicros?: number
  sessionCount: number
  workspaceCount: number
  taskCount: number
  /**
   * Epoch ms when the windowed (peak/off-peak) era begins — the earliest
   * `effectiveFrom` among the config's windowed price entries. Sessions
   * created before this moment are legacy: priced flat, excluded from the
   * peak/valley split and hour-of-day chart. `null` when no windowed
   * pricing is configured, i.e. peak/valley never applies.
   */
  windowedSinceMs: number | null
  /**
   * Epoch ms where the rolling 24-hour window used by the hour-of-day chart
   * and the peak/off-peak split begins. Only usage that occurred at or after
   * this moment (hour-bucket timestamps) enters byHourOfDay and the
   * peak/off-peak/flat cost buckets; legacy (pre-windowed-era) sessions and
   * hour-less (unclassified) costs stay outside either way.
   */
  hourOfDayWindowStartMs: number
  byDay: readonly FinanceDayRow[]
  byModel: readonly FinanceModelRow[]
  /**
   * Per-provider cost rollup (provider part of the model key), sorted by cost
   * descending. Lets the dashboard show which LLM provider drives the spend.
   */
  byProvider: readonly FinanceProviderRow[]
  byWorkspace: readonly FinanceWorkspaceRow[]
  tasks: readonly FinanceTaskRow[]
  sessions: readonly FinanceSessionRow[]
  /**
   * Sessions whose stored log could not be read, hence skipped (see
   * {@link FinanceUnreadableSessionRow}). They are absent from `sessionCount`
   * and from every cost/token rollup above, so the dashboard warns about the
   * missing spend rather than failing the whole build.
   */
  unreadableSessions: readonly FinanceUnreadableSessionRow[]
  /**
   * 24 local hour-of-day cost buckets for the rolling 24-hour window
   * (hourOfDayWindowStartMs .. now), i.e. what the dashboard labels
   * "last 24 hours" - not the whole ledger's lifetime total.
   */
  byHourOfDay: readonly FinanceHourOfDayRow[]
  /** Peak/off-peak cost split (24h window) and potential off-peak-shift savings. */
  peakValley: FinancePeakValleySplit
  /**
   * 额度触达记录（SPEC §10，INV-10）。**与上面每一个金额口径严格正交**：
   * 这里是"容量事实"（被厂商挡在门外几次），不是"金额事实"。
   *
   * 缺失（`undefined`）= 本版本之前的宿主产物，或该账本范围内没有任何触达 ——
   * 两者 UI 都按"无触达"呈现（不显示 Pill，不摆空卡）。
   */
  quota?: FinanceQuotaSummary
  /**
   * 窗口归因：按 5h / 周 / 月三个窗口切出的用量、时长与金额
   * （SPEC §10.8）。与 `quota` 一样**不参与**任何金额口径的累加——
   * 它是同一批观测数据的另一种切法，不是新的一笔账。
   */
  windows?: readonly FinanceQuotaWindowSummary[]
}

/* ───────────────────── 窗口归因（SPEC §10.8） ───────────────────── */

/** 窗口长度：名义长度，不是自然周期（SPEC §10.8 决策 D1）。 */
export type FinanceQuotaWindowSpan = '5h' | 'week' | 'month'

/**
 * 一个窗口内按模型切出的用量与时长。
 *
 * `decodeMs` / `ttftMs` 来自 `financeRateHourly`（每模型 × UTC 小时）；
 * 旧会话没有该投影键时两者为 0，UI 不显示时长列。
 */
export interface FinanceQuotaWindowModelRow {
  modelKey: string
  provider: string
  usage: FinanceTokenBuckets
  /** 目录价折算金额（订阅路线即"按量等价"）。 */
  costMicros: number
  /** 解码墙钟总时长；无 `financeRateHourly` 键时为 0。 */
  decodeMs: number
  /** 首 token 延迟合计；无该键时为 0。 */
  ttftMs: number
  steps: number
}

/**
 * 一个时间窗口的归因结果。
 *
 * `startMs` / `endMs` 是闭开区间；`endMs` 缺省为账本生成时刻（"现在回溯"），
 * 也可以锚在某次额度触达上（"那次撞墙前的 5 小时"）。
 */
export interface FinanceQuotaWindowSummary {
  span: FinanceQuotaWindowSpan
  startMs: number
  endMs: number
  /** 该窗口是否被锚定在额度触达事件上（true 时 UI 显示锚点说明）。 */
  anchoredAtHit: boolean
  usage: FinanceTokenBuckets
  costMicros: number
  decodeMs: number
  ttftMs: number
  steps: number
  models: readonly FinanceQuotaWindowModelRow[]
  /** 该窗口内使用的 provider 数（用于说明"额度被谁吃掉了"）。 */
  providerCount: number
}

/* ───────────────────────── 额度触达（SPEC §10） ───────────────────────── */

/**
 * 一次"断供事件"（episode）——同一次触达里多次失败尝试合并成一条。
 *
 * 为什么必须合并：实测同一次断供会留下 `5× llm/retry + 1× turn/end`，
 * 原始事件与真实断供相差 **~6 倍**（123 → 21）。展示原始次数会给出错误数字。
 */
export interface FinanceQuotaEpisodeRow {
  provider: string
  modelKey: string
  window: FinanceQuotaWindow
  /** 该 episode 里第一次失败的时刻。 */
  firstAtMs: number
  /** 最后一次失败（通常是 `turn/end` 终态）的时刻。 */
  lastAtMs: number
  /** 失败尝试次数（原始事件数，用于解释 hits 的构成）。 */
  attempts: number
  /** 是否见过终态 `turn/end`（false = 重试中途，可能仍在恢复）。 */
  final: boolean
  /** 可解析的重置时刻；null = 厂商没给或没带时区。 */
  resetAtMs: number | null
  /** 重置描述的原文（UI 在 resetAtMs 缺失时直接显示）。 */
  resetRaw: string | null
  /** 厂商自报码：1308 / 1310 / 2067 / 1113 / 401008 ... */
  vendorCode: string | null
}

/** 按 provider 聚合的触达统计。 */
export interface FinanceQuotaProviderRow {
  provider: string
  /** episode 数（**已去重**）—— 这是"被挡了几次"的正确口径。 */
  hits: number
  /** 原始失败尝试数，`hits` 的构成解释。 */
  attempts: number
  lastHitAtMs: number
  /** 最近一个可解析的重置时刻（该 provider 所有 episode 里最大的未来时刻）。 */
  nextResetAtMs: number | null
  windows: readonly {
    window: FinanceQuotaWindow
    hits: number
    resetAtMs: number | null
  }[]
}

/** 账本里的额度触达汇总。 */
export interface FinanceQuotaSummary {
  /** 只收 `kind === 'quota'`；`capacity` / `throttle` 永不入账本（SPEC §10.3）。 */
  rows: readonly FinanceQuotaProviderRow[]
  /** 全部 provider 的 episode 总数。 */
  totalHits: number
  /** 逐条 episode（按时间倒序），供供应商详情展开。 */
  episodes: readonly FinanceQuotaEpisodeRow[]
  /**
   * 当月起点（epoch ms，本地时区自然月）。触达统计只覆盖当月 ——
   * 与账本的月度口径一致，且让"这月被挡了几次"可跨会话累计。
   */
  monthStartMs: number
}

export interface FinanceOverview {
  balance: FinanceBalanceView
  ledger: FinanceLedger
}

/** Result of the automatic hourly backfill (sessions whose logs were replayed). */
export interface FinanceRescanResult {
  /** Persisted sessions considered. */
  sessionCount: number
  /** Sessions whose logs were replayed to backfill financeUsageHourly. */
  rescanned: number
}

/**
 * Mutable progress sink updated while backfillFinanceHourly runs. The host
 * service constructs one with `phase: 'backfill'` and the four counters at
 * zero, hands it to `backfillFinanceHourly(ctx, signal, sink)`, and listens
 * to `onProgress` to re-emit the latest snapshot on the cordis bus.
 *
 * The `phase` and `startedAt` fields live on the sink too (not just the
 * counters) because the host wants to mutate them atomically alongside the
 * counters — a snapshot returned over the wire is the whole sink minus
 * `onProgress`. `FinanceBackfillProgress` (the wire face) is therefore a
 * `Pick<FinanceBackfillSink, ...>` over the published keys.
 */
export interface FinanceBackfillSink {
  /** idle: not started; backfill: replaying logs; aggregate: ledger cold build; done: finished. */
  phase: 'idle' | 'backfill' | 'aggregate' | 'done'
  /**
   * 全流程 0–100 整数百分比：回填段加权 0–70，账本聚合段加权 70–100。
   * 客户端只渲染这个数 —— 它代表整个初始化流程，不再用「会话数」呈现。
   */
  percent: number
  /** Sessions considered so far. */
  scanned: number
  /** Persisted sessions to consider. */
  total: number
  /** Sessions whose logs were replayed. */
  rescanned: number
  /**
   * 最新一行后台动作日志（host 产生的结构化动作行，如 `backfill 3/9 replay <id>`）。
   * 客户端逐行累积展示为初始化小字日志；它走数据通道，不进 locale 字典。
   */
  line?: string
  startedAt: number
  /**
   * Optional push hook fired after every mutation of the counters / phase.
   * Wired by the host service so the live progress crosses the wire on
   * the `finance/events` typert stream (F11 commit). The host function
   * `ensureHourlyBackfilled` assigns an `onProgress` that re-emits the
   * latest snapshot on the cordis bus — keeping `backfillFinanceHourly`
   * itself pure (no `Context` plumbing inside a per-session replay loop).
   * Mutating the fields still triggers the hook synchronously; consumers
   * should not rely on relative ordering of the fields, only on the
   * post-mutation snapshot being current.
   */
  onProgress?: (snapshot: FinanceBackfillProgress) => void
}

/**
 * Live progress of the first-open initialization, covering the WHOLE pipeline
 * (hourly backfill replay + ledger cold aggregation) as one 0–100 percent.
 *
 * Strict wire face: `Pick<FinanceBackfillSink, ...>` over the published keys
 * (no `onProgress` ever crosses the wire). The host projects the sink onto
 * this shape before emitting.
 */
export type FinanceBackfillProgress = Pick<
  FinanceBackfillSink,
  'phase' | 'percent' | 'scanned' | 'total' | 'rescanned' | 'line' | 'startedAt'
>

/**
 * Optional inputs to `finance.syncCommunityPrices`: a provider allow-list and
 * a CNY-USD FX override. Both keys are optional; omitted keys fall back to the
 * host-side defaults (`COMMUNITY_SYNC_DEFAULT_PROVIDERS` / `COMMUNITY_SYNC_DEFAULT_FX`).
 */
export interface FinanceSyncOptions {
  /** Providers to restrict the sync to. */
  providers?: readonly string[]
  /** CNY micros per USD applied to the conversion. */
  fx?: number
}

/**
 * Per-call outcome of one `finance.syncCommunityPrices` invocation.
 * `ok: true` means the fetched rows were applied to the in-memory
 * community-prices layer (and the ledger cache was invalidated so the next
 * `getLedger` rebuilds at the new rates). `ok: false` means the fetch or
 * parse failed; the layer was left untouched and the prior status stays
 * current — `getSyncStatus` continues to report the last successful sync.
 */
export interface FinanceCommunitySyncResult {
  ok: boolean
  /** Where the data came from (the upstream dataset URL). */
  source: string
  /** Epoch ms when the layer was updated. Undefined on `ok: false`. */
  appliedAt?: number
  /** CNY micros per USD applied to the conversion. */
  fx: number
  /** Providers the sync attempted to ingest. */
  requestedProviders: readonly string[]
  /** Providers in `requestedProviders` that the upstream dataset did NOT expose. */
  requestedMissing: readonly string[]
  /** Final per-model-key count that landed in the community layer. */
  kept: number
  /** Dated release snapshots dropped because an undated sibling exists. */
  droppedDated: number
  /** Non-token product variants skipped (TTS / realtime / transcription). */
  droppedNonToken: number
  /** Models dropped because the upstream cost had no usable input/output pair. */
  droppedNoCost: number
  /** Provider-set actually written (subset of `requestedProviders` ∩ upstream). */
  providers: readonly string[]
  /** Error tag + message when `ok: false`. */
  error?: { message: string }
}

/**
 * 基础表完整性 + 覆盖层状态（SPEC §5.1 / INV-5）：`finance.getPriceTableStatus` 的返回体。
 * UI 用它显示「基础快照日期与来源 / 覆盖层来源与时间 / 被拒键 / 覆盖键数」。
 */
export interface FinancePriceTableStatus {
  /** 基础表（发版冻结的生成物）指纹与 lib 内常量是否一致；false = 被本地修改过。 */
  base: {
    ok: boolean
    /** 生成该基础表时的来源（厂商页 URL 或 fixture 路径）。 */
    source: string
    /** 生成时间（ISO）。 */
    updated: string
    expected: string
    actual: string
  }
  /** 最近一次成功同步的覆盖层；null = 正在使用发版快照（没有任何用户侧覆盖）。 */
  overlay: FinanceSyncStatus | null
  /** 当前内存覆盖层覆盖的键数（一键更新写入的 community 层）。 */
  overlayKeyCount: number
  /** 用户持久层（设置文档里逐行编辑）覆盖的键数。 */
  userKeyCount: number
  /** 被形状守卫拒绝的键（INV-2）：UI 必须明示「这次更新里哪些键没生效」。 */
  rejected: readonly FinancePriceRejection[]
}

/** 一个被形状守卫拒绝的价格覆盖键（结构不允许被覆盖层改写）。 */
export interface FinancePriceRejection {
  key: string
  /** 基础层形状（保留者）。 */
  base: string
  /** 被拒绝的覆盖层形状。 */
  incoming: string
}

/** `finance.clearPriceOverlay`（还原到发版快照）的结果。 */
export interface FinanceClearOverlayResult {
  /** 是否真的清掉了非空覆盖层。 */
  cleared: boolean
  /** 被清掉的键数。 */
  clearedKeys: number
}

/**
 * Snapshot of the last successful community-sync. Distinct from the result of
 * a particular call: `syncCommunityPrices` returns once, the dashboard polls
 * `getSyncStatus` continuously. Absent until the user (or auto-sync) runs at
 * least one successful sync.
 */
export interface FinanceSyncStatus {
  /** Source URL of the last successful sync. */
  source: string
  /** Epoch ms of the last successful sync. */
  appliedAt: number
  /** Final kept count at that sync. */
  kept: number
  /** Providers written at that sync. */
  providers: readonly string[]
  /** CNY-USD FX used by that sync (informational). */
  fx: number
}