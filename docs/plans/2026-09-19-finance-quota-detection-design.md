# 财务插件 · 额度触达检测设计（2026-09-19）

> 状态：**已落地（2026-09-19）**。规范口径见 `docs/FINANCE-PRICING-SPEC.md` §10（含 §10.8
> 窗口归因与双值性价比）与 INV-10；实现落在 `dsh-finance` 0.4.19 / `dsh-finance-client` 0.5.47 /
> `dsh-finance-wire` 0.2.7。本文保留设计推理与实测证据；**最终形态以 §10 为准**（差异见 §11）。
>
> 需求原话：*「财务新增个功能，检测到会话出现：本轮运行失败 429: {"code":"1308","message":
> "Usage limit reached for 5 hour. Your limit will reset at 2026-09-19 23:17:45"}。一般调用超出
> 限额，就会报 429，各家 code、message 可能不同，可以加一个功能——自动判定当前订阅计划/按量调用
> 触达限额，可以作为一种精确的额度统计的标志。」*

---

## 1. 结论先行

**值得做，而且它补的是 finance 当前唯一的空白维度。**

finance 现有的所有数字都是「花了多少」（token / 成本 / 余额），
唯独**额度**——订阅计划能用多少、按量钱包还剩多少——全靠用户自报：
`plans[].quotaTokens` 与 `FinanceProviderConfig.manualBalanceMicros`（INV-9）都是手填。

一次「额度触达」是厂商**亲口承认"我到顶了"**的观测锚点。它的价值不是再画一张图，而是：

| # | 帮助 | 说明 |
|---|---|---|
| a | **把额度从自报变成观测** | 触达时刻 + 该窗口内的账本用量 = 窗口额度的**实测下界**，反复触达可逼近真值（INV-3 的「可解释」要求同样适用：必须标注这是下界/估算，不是厂商额度） |
| b | **补上账本缺失的「失败」维度** | 被拒请求不产 token，但那一轮的时间与上下文全废；现在账本只记「花了多少」，不记「被挡在门外几次」 |
| c | **让 plan vs metered 从算钱升级到算容量** | SPEC §5.4 的订阅卡给的是「按量等价节省」，**等价成立的前提是能用满**；触达次数就是容量不足/冗余的直接证据 |
| d | **余额对账有了活动锚点** | reset 时间 = 下一个可用时刻，`BalanceGauge` 的订阅侧视觉不再只靠手填 |
| e | **把「额度到顶」与「容量繁忙」分开** | 前者该等 / 该充钱，后者该降频；混为一谈会做错决策（实测两者都走 429，★见 §3） |

**能力边界（必须写进 UI 与文档，避免过度承诺）**：本功能只给**二值触达信号 + 窗口粒度**
（5 小时 / 周 / 月 / 余额 / 免费额度），**给不出剩余额度的精确值**。DSH 的路线元数据里没有任何
quota 字段（`llm/adapters-updated` 只报路由拓扑），真正精确的剩余量只能来自厂商 quota API。

---

## 2. 信号源：DSH 已经把厂商错误归一化了

不需要解析厂商原始报文。DSH 内核定义了 provider-neutral 的失败事实
（`@deepseek-ai/dsh-llm/types`）：

```ts
interface LlmFailure {
  message: string                    // 人类可读；厂商原文通常内嵌于此
  code: string                       // 稳定机器码：AUTH / RATE_LIMIT / QUOTA / SERVER / TRANSPORT / ...
  status?: number                    // HTTP 状态，**可选**
  providerRetryAfterMs?: number
  requestId?: string
}
```

两个落点（都在会话日志里、都可被投影消费）：

| 事件 | 数据 | 语义 |
|---|---|---|
| `turn/end` | `data.reason = { kind: 'error', error: LlmFailure }` | **终态**：整轮失败（重试已耗尽或不可重试） |
| `llm/retry` | `data = { retryId, turn, step, provider, policyKey, retry, maxRetries, delayMs, failure: LlmFailure }` | **过程**：一次尝试失败、即将重试；**自带 `provider`** |

框架侧还有一条 canonical 额度分类器（`dsh-llm/error`）：

```ts
export const QUOTA_EXCEEDED_CODE = 'QUOTA'
export function isQuotaExceededError(detail: string): boolean
```

`dsh-llm-pi-ai` / `dsh-llm-deepseek` 的 `classifyError` 顺序是
**先判额度、再判 429 → RATE_LIMIT**，所以 `code === 'QUOTA'` 已经是内核给过的判断。

---

## 3. 实测证据（本机 390 个会话目录，504 条真实失败载荷）

### 3.1 `status` 字段几乎不可用

504 条失败载荷里，**只有 1 条带 `status`**（一条 400）。其余全部缺失。

**结论：判定不能依赖 `status`；`code` + `message` 是唯一可用面。** 若把 `status === 429` 当判据，
99.8% 的样本直接漏判。

### 3.2 `code` 可用但不能单独用

按 `code` 聚类全部真实载荷：

| code | 条数 | 其中真正的额度触达 |
|---|---|---|
| `TRANSPORT` | 215 | 0 |
| `RATE_LIMIT` | 164 | **有**（软性 5h / 周 / 请求级限流混在一起） |
| `SERVER` | 48 | 0（529 overloaded） |
| `QUOTA` | 16 | 全部是 |
| `INVALID_REQUEST` / `PI_AI_ERROR` / `AUTH` / `UNKNOWN` / `TIMEOUT` / `EMPTY_RESPONSE` | 61 | `PI_AI_ERROR` 里藏着 1 条明确的额度耗尽（402/401008） |

**两个反例（决定设计）**：

- **只认 `code === 'QUOTA'` 会漏**：`429 … 当前已达到 Token Plan 用量上限 … (2067)` 这类
  **完全没有 code**；声明式 5 小时/周额度那几条落到了 `RATE_LIMIT`。
  根因是 `isQuotaExceededError` 的正则要求 `quota|usage limit` **紧跟** `exceeded|exhausted|reached`，
  而 `"You have exceeded the 5-hour usage quota"` 的词序不匹配 → 掉进 429 → `RATE_LIMIT`。
- **只认 `429` 会漏也会错**：402/401008「免费额度已耗尽且未开后付费」是**明确的额度事件但不是 429**；
  反过来 `429006 模型服务繁忙或已达服务容量上限` 是 **429 但不是额度**。

### 3.3 真实厂商 taxonomy（去重后的形态全集）

| 厂商原文 message（节选） | DSH code | 窗口 | 归类 |
|---|---|---|---|
| `429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at …"}` | QUOTA | 5h | quota |
| `429: {"code":"1310","message":"Weekly/Monthly Limit Exhausted…"}` | RATE_LIMIT | 周/月 | quota |
| `429 … rate_limit_error … 当前已达到 Token Plan 用量上限 … (2067)` | **无 code** | 月 | quota |
| `OpenAI API error (429): {"code":"AccountQuotaExceeded","message":"You have exceeded the 5-hour usage quota…reset at … +0800 CST"}` | RATE_LIMIT | 5h | quota |
| `rate_limit_exceeded: Your token-plan 1-week quota has been exhausted…reset at 09-03 13:34:00 UTC` | RATE_LIMIT | 周 | quota |
| `429: {"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}` | QUOTA | 余额 | quota |
| `OpenAI API error (402): {"code":"401008","message":"The free trial quota … has been exhausted…"}` | PI_AI_ERROR | 免费额度 | quota |
| `429 {"type":"rate_limit_error","code":"429006","message":"…busy or has reached its serving capacity limit…"}` | RATE_LIMIT | — | **capacity** |
| `429 … {"code":"RequestBurstTooFast","message":"System protection triggered by request burst…"}` | RATE_LIMIT | — | **capacity** |
| `429 event:error … {"code":"Throttling","message":"Request rate increased too quickly…"}` | RATE_LIMIT | — | **throttle** |
| `429: {"code":"1302","message":"Rate limit reached for requests"}` | RATE_LIMIT | 瞬时 | **throttle** |
| `OpenAI API error (429): 429 status code (no body)` | RATE_LIMIT | — | **throttle**（无信息，不猜） |
| `529 … overloaded_error …` | SERVER | — | other |

### 3.4 事件放大 ~6 倍：必须去重

同一次断供会在日志里留下**多次 retry + 一次 turn/end**。实测典型形状：
`5× llm/retry + 1× turn/end`（同一 message、同一 provider、时间跨度数秒）。

按 `(会话, provider, 窗口标识)` 去重后的真实规模：

| 口径 | 数量 |
|---|---|
| 原始 quota-ish 事件 | **123** |
| 真实断供事件 | **21** |

**结论：没有去重的「触达次数」会虚高约 6 倍，是不可用的数字。**

### 3.5 分类器在真实数据上已验证

把本设计的判定顺序（§4）用脚本跑在全部 496 条失败载荷上：

| 分类 | 条数 |
|---|---|
| other（TRANSPORT / SERVER / INVALID_REQUEST / …） | 296 |
| `quota:5h` | 54 |
| `quota:month` | 52 |
| **capacity** | **49** |
| throttle | 29 |
| `quota:week` | 11 |
| `quota:balance` | 4 |
| `quota:trial` | 1 |

quota 合计 **171 条**，与 capacity(49) / throttle(29) 干净分离——这正是价值 (e) 的实现前提。
**这些真实载荷脱敏后直接作为验收 fixture（A9）。**

### 3.6 reset 时间戳只覆盖一半

123 条里 **65 条可解析出 reset 时刻，58 条没有**。且格式不统一（见 §4.4）。
**结论：`resetAt` 是可选增强，不是判定依据；缺失时必须保留原文而非猜。**

---

## 4. 判定口径（本设计的核心）

### 4.1 纯函数契约

```ts
// packages/dsh-finance/src/quota.ts —— 纯函数、无网络、无 ctx，可跑 Node type-stripping
export type FinanceQuotaClass =
  | { kind: 'quota';     window: '5h' | 'week' | 'month' | 'balance' | 'trial' | 'unknown'
      vendorCode: string | null; resetAtMs: number | null; resetRaw: string | null }
  | { kind: 'capacity' }   // 服务容量/突发保护：**不是额度**
  | { kind: 'throttle' }   // 请求级限流：不是额度
  | { kind: 'other' }      // 与本功能无关

export function classifyQuotaFailure(failure: LlmFailure): FinanceQuotaClass
```

### 4.2 判定顺序（顺序即语义，不可调换）

| 序 | 条件 | 结果 | 理由 |
|---|---|---|---|
| 1 | message 命中**容量/突发**词表：`429006` / `serving capacity` / `RequestBurstTooFast` / `"Throttling"` / `busy or has reached` / `请求频率` | `capacity` | 必须先于 429 判定：这是**瞬时**问题，记成额度会误导「该充钱」 |
| 2 | message 命中**余额**词表：`1113` / `insufficient balance` / `no resource package` / `recharge` | `quota:balance` | 钱包空 ≠ 周期额度，付钱即可恢复 |
| 3 | message 命中**免费额度**词表：`401008` / `free trial quota` / `免费体验额度` | `quota:trial` | 非 429 也要认（402 路径） |
| 4 | message 命中**周/月**：`1310` / `1-week quota` / `Weekly/Monthly` / `weekly limit` | `quota:week` | 窗口粒度决定"要等多久" |
| 5 | message 命中**5 小时**：`1308` / `5-hour` / `5 hour` / `5h quota` | `quota:5h` | 最主流的短窗 |
| 6 | message 命中**月度套餐**：`2067` / `Token Plan 用量上限` / `monthly limit` | `quota:month` | 无 code 的路径只能靠 message |
| 7 | `code === 'QUOTA'`（内核 canonical 码） | `quota:unknown` | 内核已判过额度；窗口未知不猜 |
| 8 | `code === 'RATE_LIMIT'` 且 message 含 `429` 但**无任何额度措辞** | `throttle` | 无信息的就是限流，不升级为额度 |
| 9 | 其余 | `other` | — |

**三重防错**（写进 Spec 的反模式清单，并由 A9 锁死）：

- ❌ **禁 `status`-only**：实测 99.8% 载荷无 `status`。
- ❌ **禁 429-only**：漏 402/401008，且误收 429006（capacity）。
- ❌ **禁 `code === 'QUOTA'`-only**：漏 2067 与两条声明式窗口（它们落在 `RATE_LIMIT`）。

> 与 SPEC §3 的价格体系同构：**宁可不算，不可算错**（INV-3 精神）。不确定一律 `other`，
> 另立 `capacity`/`throttle` 两个「明确不是额度」的类，而不是硬塞进 quota。

### 4.3 `attempts` 的去重键

```
dedupeKey = (modelKey, window, resetAtMs ?? resetRaw ?? messageSignature)
```

- 同一 key 的连续失败 → 合并为**一个 episode**，`attempts++`；
- `turn/end` 命中同一 key → 该 episode 标 `final: true`（终态确认）；
- **计数口径 = episode 数，不是事件数**（§3.4：两者差 ~6 倍）。

`messageSignature` 兜底：剥掉 request-id / 时间戳 / UUID 后取前 120 字符——
用于 `resetRaw` 也拿不到的样本（58/123），避免把不同断供合并、或把同一次拆成多次。

### 4.4 reset 时间解析：能解析才解析

实测三种格式：`2026-09-19 23:17:45`（无时区）、`09-03 13:34:00 UTC`、`2026-08-28 22:38:22 +0800 CST`。

规则：

- **有时区标记**（`UTC` / `±HHMM` / 时区缩写）→ 解析为 `resetAtMs`；
- **无时区** → `resetAtMs = null`，**保留 `resetRaw` 原文**，UI 直接显示原文；
- **绝不假设本机时区**去补一个时间戳——那会造出一个看起来精确、实际可能偏 8 小时的数字。

`resetAtMs` 有值时才有下游能力：① 倒计时；② 窗口起点 = `resetAtMs − windowLength`，
用于 §6 的窗口用量估算。

---

## 5. 数据模型

### 5.1 采集：新会话投影 `financeQuota`（新 key、新 unit）

**严禁**修改既有 `financeUsage` / `financeUsageHourly` / `financeRate` / `financeContext`
的 `stateVersion`：投影缓存对版本不匹配是**丢弃而非迁移**，一次 bump 会让每个会话全量重放
（`projection.ts` 里已有这条先例注释）。新增独立 key 是零代价的。

```ts
interface FinanceQuotaState {
  currentModel: string | null                 // 由 request/header 维护（turn/end 不带 provider）
  episodes: FinanceQuotaEpisode[]             // 有界：只保留最近 N=50 条/会话
}

interface FinanceQuotaEpisode {
  modelKey: string                            // provider/model
  window: '5h' | 'week' | 'month' | 'balance' | 'trial' | 'unknown'
  firstAtMs: number
  lastAtMs: number
  attempts: number
  final: boolean                              // 见过 turn/end 终态
  resetAtMs: number | null
  resetRaw: string | null
  vendorCode: string | null                   // 厂商自报码：1308 / 1310 / 2067 / 1113 / 401008 …
}
```

`apply(state, event)` 两个入口：

1. `llm/retry` → `classifyQuotaFailure(event.data.failure)`；
   `kind==='quota'` 时按去重键合并/新建，`provider` 直接取事件自带字段；
2. `turn/end` 且 `reason.kind === 'error'` → 同判定，用 `state.currentModel` 归属，
   命中已有 episode 则标 `final: true`。

**边界（本设计明确不做）**：`capacity` / `throttle` / `other` **不写任何状态**。
分类器返回值里保留这三类，是为了让 A9 能断言「分离成立」，而不是为了记账本。
（记录容量繁忙次数是另一个产品决策，不在本次范围。）

### 5.2 聚合：`FinanceLedger.quota`（不进成本口径）

```ts
interface FinanceQuotaRow {                   // 按 provider 聚合，仅当月
  provider: string
  hits: number                                // episode 数（已去重）
  attempts: number                            // 原始失败尝试数（可解释 hits 的构成）
  lastHitAtMs: number
  nextResetAtMs: number | null
  windows: readonly { window: ...; hits: number; resetAtMs: number | null }[]
}

interface FinanceLedger {
  // …既有字段不动…
  quota: { rows: readonly FinanceQuotaRow[]; totalHits: number; monthStartMs: number }
}
```

**硬约束（INV-10）**：`quota` **完全不参与** `totalCostMicros` / `byModel` / `byProvider` /
`peakValley` 任一金额口径。额度是容量事实，成本是金额事实——两者正交，混一是本功能最容易犯的错。

### 5.3 类型与 wiring 落点

| 位置 | 改动 |
|---|---|
| `dsh-finance/src/quota.ts` | **新增**：`classifyQuotaFailure` + reset 解析 + 去重键（纯函数） |
| `dsh-finance/src/projection.ts` | **新增** `financeQuotaProjectionDefinition`（`stateVersion: 1`）；既有 4 个 unit 一律不动 |
| `dsh-finance/src/types.ts` | 新增 episode / row 类型 + `FinanceLedger.quota` + `SessionProjectionMap` 与 `SessionProjectionStateMap` 两处 declaration merging |
| `dsh-finance/src/ledger.ts` | 从 projection cut 读 `financeQuota` 聚合成 `quota.rows`；**不碰 costOf** |
| `dsh-finance/src/index.ts` | `sessionProjections.register(financeQuotaProjectionDefinition)` 加一行 |
| wire | **零改动**（`getLedger` 已返回整个 `FinanceLedger`，新字段随 envelope 走） |
| 客户端 | 角标 + 详情；locale 字典补键 |

**实时刷新零新增链路**：既有 `ctx.on('session/event')` 2s 防抖已经会广播
`finance/ledgerUpdated`。额度触达同样落在这条广播上——只是别把它挂在 `assistant/message`
（那是用量事件）：额度触达由 `turn/end` 触发，需要在该钩子里补一个 `turn/end` 分支。

### 5.4 「实测下界」估算（P2，可选，明确标注为估算）

`resetAtMs` 非空时：窗口起点 = `resetAtMs − windowLength`，
用 `financeUsageHourly` 累加该窗口内的 token → `windowTokensLowerBound`。

三条纪律：

1. 标注为**下界 / 估算**（INV-3 精神），绝不冒充厂商额度；
2. **不写入** `plans[].quotaTokens`——那是用户字段，只能由用户在 UI 里显式采纳
   （「建议值 12.4M，采纳」），绝不静默改写（INV-6 精神）；
3. 窗口长度对 `week`/`month` 用 7d/30d 只能给粗估；`5h` 是精确的。

---

## 6. UI 设计（克制优先）

遵循既有偏好：**提示性文案只在异常/必须给原因时出现，不做推测性预警。**

- **不新增列**：供应商表已有 5 列（供应商 / 付费类型 / 余额·月费 / 按量等价 / 操作），
  加第 6 列会挤压本已紧张的列宽（UI-UX-SPEC §3.5 列宽规则的教训）。
  改为在**供应商名右侧挂一个 Pill**，且**仅在 `hits > 0` 时渲染**：

  | 状态 | 呈现 |
  |---|---|
  | 无命中 | **什么都不显示**（不显示「正常」，不做绿点） |
  | 有命中，`resetAtMs` 可解析 | `额度触达 2 次 · 3h12m 后重置` |
  | 有命中，`resetAtMs` 为 null | `额度触达 2 次 · 重置 2026-09-19 23:17:45`（原文） |

- **详情进已有的供应商详情弹窗**（`providerDetailTitle`）：逐条 episode 列出
  「时间 / 窗口 / 厂商码 / 尝试次数 / 是否终态 / 重置时刻」，**只读、不可编辑**。
- **Pill tone 取 `warning`**（额度是「受限」，不是「错误」；错误红留给失败本身）。
- Pill 必须有 `aria-label` 与 `data-testid="finance-quota-{provider}"`（real-host-check /
  preview:verify 的选择器面）。
- **PLAN 与 METERED 都适用**：订阅触达 = 容量不足；按量触达 = 钱包/资源包触底。
  两种情况文案不同但机制同一套。

**反例（不写进 UI 的话，用户会误读）**：触达次数 ≠ 额度大小。一次 5h 窗口触达只说明
「该窗口用满了」，不同窗口之间不可比；`unknown` 窗口的条目必须显示「窗口未知」而不是留白。

---

## 7. 验收与防线

沿用 SPEC §7 的 A 编号，追加四条：

| 编号 | 断言 | 落点 |
|---|---|---|
| **A9** | **分类器一致性**：§3.3 的真实载荷（脱敏 fixture）逐条断言分类；**其中 49 条 capacity 必须一条都不落进 quota** | `dsh-finance/tests/quota-classify.test.ts` |
| **A10** | **去重正确性**：`5× llm/retry + 1× turn/end` → `hits=1, attempts=5, final=true`；不同 reset 时刻 → 2 条 | 投影单测 |
| **A11** | **INV-10 正交性**：注入若干额度触达后，`totalCostMicros` 与全部金额聚合**逐字节不变** | 账本单测 |
| **A12** | **投影兼容性**：新增 `financeQuota` 后，既有 4 个 unit 的 `stateVersion` 未变、既有 checkpoint 不失效 | 投影单测 + 代码断言 |

**闸门新增防线**（反模式必须进脚本，不能只写文档，SPEC §7 同款）：
在 `scripts/check-architecture.mjs`（或财务专用闸门）扫 `dsh-finance/src/quota.ts`，
禁止出现 `status === 429` 之类的单一判据、禁止把 quota 结果写进 `costOf` 调用链。

---

## 8. 非目标

- **精确剩余额度**（需要厂商 quota API，DSH 无此面）。
- **容量繁忙 / 请求限流的记账**（分类已能识别，但只用于"不被误记成额度"）。
- **自动改套餐 / 自动充钱 / 自动降频**（只呈现，不动作）。
- **跨厂商额度归一**（各厂商窗口语义不可比，不造统一标尺）。
- **历史回填**：投影是 **forward-only**——旧会话没有该键，不重放补造
  （与 `financeRate` / `financeContext` 同款边界）。

---

## 9. 实施顺序（口径定案后）

| # | 内容 | 依赖 |
|---|---|---|
| ① | SPEC §10 + INV-10 + A9–A12 落文档（`docs(finance):`） | 本文评审通过 |
| ② | `quota.ts` 纯函数 + A9 fixture 测试 | ① |
| ③ | `financeQuota` 投影 + A10 / A12 测试 | ② |
| ④ | ledger 聚合 + A11 正交性测试 | ③ |
| ⑤ | 客户端 Pill + 详情 + locale + preview:verify 选择器 | ④ |
| ⑥ | 真宿主验收（`sandbox:install` + real-host-check 断言注册面与角标） | ⑤ |
| ⑦ | （可选 P2）窗口下界估算 + 采纳交互 | ⑤ |

每步都走完整验收链：`pnpm -r build` → `typecheck` → `test`（顺序执行）→ `pnpm check:all`
→ `pnpm preview:verify`；改 host/注册面加跑 `node dev-harness/real-host-check.mjs`。
改 `src` 的每个 commit **必须 bump 对应包 version**（AGENTS.md 铁律 1）。

---

## 10. 风险与取舍

| 风险 | 处置 |
|---|---|
| 厂商改文案导致漏判 | 判定表集中在 `quota.ts` 一处；A9 fixture 从真实日志持续补充；未命中一律 `other`（宁漏不错） |
| 把容量繁忙误报成额度 | §4.2 第 1 条优先级 + A9 硬断言（49 条 capacity 一条都不许漏进 quota） |
| 触达次数被 retry 放大 | §4.3 去重键 + A10（实测放大 ~6×，是**必须**处理的量级） |
| 新投影键拖慢旧会话 | 新 key 不 bump 既有 unit 版本；旧会话无该键 → 优雅退化为 0，不触发重放（首例：`financeRate` 的 `REQUIRED_PROJECTION_KEYS` 处理方式） |
| 用户把「触达次数」当额度大小 | §6 反例写进 UI 文案；`unknown` 窗口显式显示「窗口未知」 |

---

## 11. 落地记录（2026-09-19）与设计稿的差异

### 11.1 形态变更：Card 为主，Pill 为入口

原设计（§6）是"供应商行一个 Pill"。实际落地时用户提出更强的诉求——
*"为何不能统计每次撞墙时最近一个周期的实际用量？想看 5 小时用了哪些模型、用在了哪里、用了多少、用了多久"*——
于是升级为**独立的窗口归因 Card**（`QuotaWindowCard`），Pill 退化为入口与概览：

| | 原设计 | 落地 |
|---|---|---|
| 主呈现 | 供应商行 Pill（次数 + 重置倒计时） | Pill（保留）+ **窗口归因 Card** |
| 归因能力 | 无 | 5h / 周 / 月三窗口 × 模型 × 用量/时长/金额 |
| 锚点 | 触达时刻 | 默认"此刻回溯"，触达为可选锚点（`windowAnchors`） |

### 11.2 新增第二个投影 unit：`financeRateHourly`

原设计只规划了 `financeQuota`。落地时发现**"用了多久"切不出窗口**——`financeRate`
只有 `byModel`（无时间维度）。于是新增 `financeRateHourly`（模型 × UTC 小时），
事件语义与 `financeRate` 逐条相同，只多一个维度。理由同 `financeUsageHourly`：
给既有 unit 加维度必须 bump `stateVersion` = 全会话重放。

### 11.3 双值性价比口径（用户裁决，SPEC §10.8）

用户明确两个值：
- **窗口估价** = 订阅月费 × (窗口长度 ÷ 30 天)，接近月费的周期均值；
- **按量等价** = 窗口内用量 × 目录价；
- 差值 = 明确的性价比相对标准。

与既有月度 `planInsight` 是**同一公式、不同分母**，两处数字天然自洽。
**修正**：设计稿初版曾写"订阅金额是另一口径、必须与按量分开讲"，属过度设计——
`planInsight` 本来就是"用量 × 目录价"，只需沿用，不必另立话术。

### 11.4 实施中发现并修复的真实 bug：wire 静默剥离

`financeLedgerSchema` 是普通 `z.object`，Zod 默认**丢弃未声明键**。新增的
`quota` / `windows` 若不在 wire 声明，会在过 wire 时被静默剥离——
**宿主算得对、host 单测全绿，真宿主 UI 永远空白**。这正是 P1-B 的 `rate` 当年的漏法。

处置：两个字段声明进 wire schema + 反射模型；补 `tests/wire-ledger.test.ts` 三条
回归断言（字段存活 / 模型级时长存活 / 旧宿主载荷仍可解析）。闸门无法覆盖这类问题
（它是运行期形状），所以必须靠测试锁。

### 11.5 验收证据（全部实跑）

| 面 | 结果 |
|---|---|
| `pnpm -r build` → `typecheck` → `test`（顺序执行） | 全绿；finance 327 + finance-client 85 |
| `pnpm check:all` | 五闸门全 PASS（含新增 A9b 反模式防线） |
| `pnpm preview:verify` | 122/122（新增两条 SPEC §10 产物回归线） |
| `pnpm sandbox:install` + 重启 + `real-host-check.mjs` | 62/62、退出码 0 |
| 真宿主注册面 | `/__dev/probe` 确认 `finance` service 在册；`session_projcache` 实测两个新 unit 均 `ver: 1` 在折叠 |
| 端到端（真实 1308 会话） | 投影 → wire 全程保持：`vendorCode=1308 / window=5h / resetRaw` 原文 |

### 11.6 A9b 闸门（反模式进脚本，不只写文档）

静态检查 `quota.ts` 与 `costOf`，四条断言并**做过两次负向验证**（故意注入违规确认能 FAIL）：
① 禁 `status` 单一判据；② 容量词表必须排在额度词表之前；③ `QUOTA_WORDING` 不含裸 `limit`；
④ `costOf` 不得出现任何 `quota` 引用（INV-10）。

第 ③ 条是**测试逼出来的真 bug**：初版用 `/limit/` 兜底，把
`429: {"code":"1302","message":"Rate limit reached for requests"}` 误吞成额度类。
A9 单测当场抓住，改为只认与额度绑定的措辞。
