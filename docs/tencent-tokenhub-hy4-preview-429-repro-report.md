# 腾讯 tokenhub 网关：hy4-preview 持续返回 429（429006）可复现报告

> 报告日期：2026-08-29（测试时间均为本机本地时间 UTC+8）
> 报告人：____________________（联系方式：____________________）
> 接收方：腾讯云 tokenhub / Tencent MaaS 网关团队
> 用途：请协助排查 hy4-preview 在 tokenhub 套餐上的容量/限流策略问题。本报告所有现象均可通过文末脚本在 3 分钟内复现。

---

## 一、问题概述

使用腾讯云 tokenhub 网关（`https://tokenhub.tencentmaas.com`）调用 OpenAI Responses API 兼容接口请求 `hy4-preview` 模型时：

- **请求体携带 `max_output_tokens: 64000` 时 100% 被拒**，返回 HTTP 429、错误码 `429006`「模型服务繁忙或已达服务容量上限」，8/8 次全部失败（含长时间空闲后的"新鲜窗口"）；
- **同一参数集去掉 `max_output_tokens` 或改为 `2048` 时正常返回 200**（含完整 reasoning + 输出，流式/非流式均可）；
- 客户端为 AI 编码 Agent（DeepSeek Harness），每条请求都会附带 `max_output_tokens`（来自模型配置的 `maxTokens: 64000`），因此**持续报 429，会话完全不可用**。

我们希望确认：这是套餐容量限制、参数校验缺陷，还是限流策略设计如此？若是限流，请提供可机读的重试指引（如 `Retry-After`）与文档化的限额参数。

---

## 二、环境信息

| 项 | 值 |
|---|---|
| 网关地址 | `https://tokenhub.tencentmaas.com` |
| 接口路径 | `POST /v1/responses`（OpenAI Responses API 风格；`/v1/chat/completions` 亦测试，见 §4.3） |
| 鉴权 | `Authorization: Bearer <TENCENT_API_KEY>`（Key 已脱敏：`sk-OJQf****lRV`，完整 Key 可在贵司内部按账号定位，必要时单独提供） |
| 模型 | `hy4-preview`（`GET /v1/models` 中 status=online） |
| 套餐线索 | 疑似 token 计划/额度网关；该 Key 仅授权 `hy4-preview` 一个模型（见 §4.4） |
| 客户端 | AI 编码 Agent（DeepSeek Harness，内核 pi-ai 库，OpenAI SDK 兼容），请求带 `stream:true`、`store:false`、`tools`、`max_output_tokens`（取自模型配置 maxTokens=64000）；每轮 agent 回合为多条顺序请求（标题生成 + 主请求 + 工具调用循环），429 时按 500ms→10s 指数退避重试 5 次 |

**429 响应体（原文）**：

```json
{"error":{"type":"rate_limit_error","code":"429006",
"message":"The model service is currently busy or has reached its serving capacity limit. Please reduce the request frequency and try again later.",
"message_zh":"当前模型服务繁忙或已达服务容量上限，请降低请求频率后稍后重试。",
"source":"gateway","request_id":"e783034f-dc1e-413d-ac32-ce37d2c02739"}}
```

**200 响应（成功示例，仅摘录核心字段）**：

```json
{"id":"b2f3dadf-0eb9-4318-9e0a-eeba744bf0a5","object":"response","created_at":1787989929,
"completed_at":1787989933,"model":"hy4-preview","status":"completed",
"output":[{"type":"reasoning",...},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"OK"}]}],
"error":null}
```

---

## 三、最小复现（核心实验，2~3 分钟）

> 用同一 Key，依次发送以下 3 个请求，每个间隔 60 秒。

```bash
KEY="<你的 TENCENT_API_KEY>"
BASE=https://tokenhub.tencentmaas.com/v1/responses
H1="Authorization: Bearer $KEY"
H2="Content-Type: application/json"

# ① 不带 max_output_tokens —— 预期 HTTP 200
curl -sS -w '\n[HTTP %{http_code} t=%{time_total}s]\n' -X POST $BASE \
  -H "$H1" -H "$H2" \
  -d '{"model":"hy4-preview","input":"say OK"}'
sleep 60

# ② max_output_tokens=2048 —— 预期 HTTP 200
curl -sS -w '\n[HTTP %{http_code} t=%{time_total}s]\n' -X POST $BASE \
  -H "$H1" -H "$H2" \
  -d '{"model":"hy4-preview","input":"say OK","max_output_tokens":2048}'
sleep 60

# ③ max_output_tokens=64000 —— 实际观测：HTTP 429（429006）
curl -sS -w '\n[HTTP %{http_code} t=%{time_total}s]\n' -X POST $BASE \
  -H "$H1" -H "$H2" \
  -d '{"model":"hy4-preview","input":"say OK","max_output_tokens":64000}'
```

**实测结果（2026-08-29）：**

| # | 时间 | 请求参数 | 结果 | 响应证据 |
|---|---|---|---|---|
| ① | 15:51:37 | 缺省 | 429 | 处于前序请求冷却期（见 §4.2），冷却过后可成功 |
| ② | 15:52:08 | `max_output_tokens: 2048` | **200** | response_id `b2f3dadf-0eb9-4318-9e0a-eeba744bf0a5` |
| ③ | 15:53:13 | `max_output_tokens: 64000` | **429** | 429006（与 ② 仅间隔 65 秒，② 成功而 ③ 被拒） |
| ④ | 15:54:14 | 缺省 | **200** | response_id `a6c7ef54-9469-46d6-b249-3feec1544645` |

> 注意：若 ① 返回 429，说明 Key 正处于冷却期（见 §4.2），请等待 2~3 分钟后重试 ①。
> **关键结论：在 ② 与 ④ 前后均能成功的时间窗口内，③（`max_output_tokens: 64000`）依然 100% 被拒。**

---

## 四、完整观测记录

### 4.1 `max_output_tokens` 对结果的影响（累计统计）

| 参数组合 | 成功/总数 | 备注 |
|---|---|---|
| 不带 `max_output_tokens` | 5/7（200） | 2 次失败均在冷却期（距上次请求 ≤10s、≤2.5min） |
| `max_output_tokens: 2048` | 1/1（200） | 与 64000 在同一时间窗口内对比 |
| `max_output_tokens: 4096 / 32768` | 0/3（429） | 测试于限流风暴窗口内，供参考 |
| `max_output_tokens: 64000` | **0/8（全 429）** | 含 3 次明显在冷却期之外的测试（空闲 2min / 6.5min / 成功间隙 65s） |
| `max_output_tokens: 64000` + `stream:true` + `store:false`（完整客户端体） | 0/2（429） | 模拟 AI Agent 的真实请求体 |

**带 64000 的失败明细（便于日志对账）：**

| 时间 | 请求体 | 结果 | request_id |
|---|---|---|---|
| 15:33:26 | +64000 | 429 | `60284672-044e-4cc5-8d66-6862df69daf6` |
| 15:34:01 前后 | +64000 ×2 | 429 | `ca742345-ae32-41cc-92c0-cbc3224a2ac1`、`5f00821d-6488-47be-94e1-e35dc69a158a` |
| 15:34:1x | +4096 | 429 | `405b7f06-9191-4d8c-9dae-98d820aa1027` |
| 15:34:1x | +32768 ×2 | 429 | `aa39a730-7c5f-4b8b-8453-ae70dda0f30b`、`5532292e-44f9-4021-b811-649674d756c2` |
| 15:39:32（空闲 2min） | +64000 | 429 | `e783034f-dc1e-413d-ac32-ce37d2c02739` |
| 15:41:43（上次成功 +60s） | +64000 | 429 | `62919b25-bbce-4591-b82b-f6c07c419707` |
| 15:42:38 | +64000+stream+store:false | 429 | 未记录 |
| 15:49:17（空闲 6.5min） | +64000+stream+store:false | 429 | `413c6c09-eb3b-4e6a-999c-39cb0044f898` |
| 15:53:13（2048 成功 +65s） | +64000 | 429 | 未记录 |

**成功明细：**

| 时间 | 请求体 | 结果 | 证据 |
|---|---|---|---|
| 15:33:21 | 缺省 | 200 | response_id `0745d55b-46b6-4676-a818-21b399cac7f1` |
| 15:33:25 | 缺省 + `stream:true` | 200 | response_id `d7c2759f-3844-4c6a-8601-c82279f46b80` |
| 15:37:19 | 缺省 | 200 | response_id `51df9bf4-418b-4e30-8f9b-4019e7b43b22` |
| 15:40:33 | 缺省 | 200 | response_id `209c4bc6-ace9-45c8-ac9a-049c7954abf8` |
| 15:52:08 | +2048 | 200 | response_id `b2f3dadf-0eb9-4318-9e0a-eeba744bf0a5` |
| 15:54:14 | 缺省 | 200 | response_id `a6c7ef54-9469-46d6-b249-3feec1544645` |

### 4.2 限流/准入槽观测（非 64000 请求）

- 冷启动突发：15:33:21 与 15:33:25 两次请求 4 秒内连续成功，随后进入约 4 分钟锁定；
- 冷却期特征：上次请求结束后约 10s（15:37:29）或约 2.5min（15:51:37）内的请求仍可能 429；冷却后（约 3min）可成功；
- 429 响应耗时 0.5~1.1 秒（快速拒绝，无排队迹象）；200 响应耗时 4~9 秒（含 reasoning 生成）；
- 429 响应无 `Retry-After` 等可机读字段（仅 JSON body），客户端只能盲退避。

### 4.3 `/v1/chat/completions` 路径

`hy4-preview` 经 `/v1/chat/completions` 调用 4/4 全部返回 429006（含冷却期外的一次）：

| 时间 | request_id |
|---|---|
| 15:33:27~33 | `36652f00-e367-40d6-9c7b-a0499b149ab1`、`faa4bd1e-5ea2-4c15-b8b6-a7f44cb51b4f`、`6a6fa35f-97a7-4c46-bfef-d1eccd2ba45c` |
| 15:36:08（空闲 70s） | `652a38aa-ee9c-4769-be03-602f40a37f24` |

无法区分「该路径不支持 hy4-preview」与「同一容量限制」，请确认。

### 4.4 `/v1/models` 列表与实际可用模型不一致

`GET /v1/models` 恒为 200，列表包含 `hy4-preview / hy3 / glm-5.3-flash / deepseek-v4-flash-0731 / kimi-k3 / minimax-m3` 等；但调用非 hy4-preview 模型时返回 HTTP 400 + `401006`：

```json
{"error":{"type":"gateway_error","code":"401006",
"message":"model glm-5.3-flash not in allowed list",
"message_zh":"输入的服务 ID 不存在，或模型与服务不匹配，请在控制台的在线推理服务列表中确认服务 ID。",
"request_id":"cd73fed9-4deb-4b23-a2e4-292a5bc3ee8d"}}
```

| 模型 | request_id |
|---|---|
| glm-5.3-flash | `cd73fed9-4deb-4b23-a2e4-292a5bc3ee8d` |
| deepseek-v4-flash-0731 | `59edcf10-f51e-4030-9b0d-84d83f624f9e` |
| hy3 | `5c3e8ab4-f4c9-48a2-b45d-5ea0a89348a3` |

即：**该 Key 仅授权 hy4-preview，但模型列表接口未按授权过滤**，对用户有误导性，建议核对。

### 4.5 客户端会话中的一次成功（供对照）

客户端会话日志显示 15:19:59 有一次 **`maxTokens=64000` + 流式 + tools 的请求成功**（返回 tool-calls），1 秒后的下一个请求起持续 429，此后同参数再未成功。结合 §4.1 的 0/8，**怀疑网关对高 `max_output_tokens` 的容量策略随时间/负载状态浮动**，请用该时段日志核对。

---

## 五、对 Agent 场景的影响

AI Agent 每回合会产生多条顺序 LLM 请求（标题生成、主请求、工具调用循环），且每条请求都携带 `max_output_tokens=64000`：

1. 首条请求即 429；
2. 客户端按 500ms→10s 指数退避重试 5 次（实测策略：`[normal,5,[EMPTY_RESPONSE,RATE_LIMIT,SERVER,TIMEOUT,TRANSPORT],500,10000,0.1]`），**全部仍 429**（冷却期远大于退避上限）；
3. 回合以错误终止 → 用户侧表现为「持续报错 429，会话不可用」。

---

## 六、期望行为 vs 实际行为

| | 期望 | 实际 |
|---|---|---|
| `max_output_tokens=64000` | 正常生成（模型配置声明上限 64000） | 100% 429006 |
| `max_output_tokens=2048` | 正常生成 | 200 ✅ |
| 缺省 | 正常生成 | 冷却期外 200 ✅ |
| 限流响应 | 携带 `Retry-After` / 可机读指引 | 仅 JSON，无任何 header |
| `/v1/models` | 返回当前 Key 可用的模型 | 返回大量未授权模型（调用时 401006） |

---

## 七、请贵司确认的问题

1. `hy4-preview` 在 tokenhub 套餐上的 **`max_output_tokens` 上限**是多少？控制台/文档中如何查询？为什么 64000 的请求 100% 被 429006 拒绝，而 2048/缺省在同一时间窗口可成功？是否按 `max_output_tokens` 做了「容量预留」式准入？
2. 429006 的判定维度：per-key RPM / TPM / 并发数 / 模型容量？**是否可以返回 `Retry-After` 或等价字段**，并给出文档化的限额与官方推荐的退避/重试策略？
3. 实测约 60~120s 的恢复周期是否符合贵司的限流设计？对 Agent 类高请求量客户是否有其他接入方式（如更高套餐、独立部署、专用网关）？
4. `hy4-preview` 是否支持 `/v1/chat/completions`？（我们 4/4 全 429）
5. `/v1/models` 是否应按当前 Key 的授权模型列表过滤返回？
6. 15:19:59 一次同参数（64000+流式+tools）成功、此后同参数全 429，请根据 response/request 日志确认当时网关容量状态，判断是容量波动还是策略变更。

---

## 八、附录

- 测试工具：curl（macOS 自带版本），单机直连，无代理，HTTP/1.1。
- 测试账号/Key 归属：tokenhub 控制台内可按上文 request_id / response_id 对账；完整 Key 处于脱敏状态，排查需要时另行单独提供。
- 复现脚本见 §三；若 1 分钟内 ②③ 结果稳定复现（200 / 429），即为本报告所述问题。

---

## 九、工单沟通记录与回复草案（2026-08-29）

### 9.1 腾讯云工程师回复（转述原文要点）

| 时间 | 内容 |
|---|---|
| 16:09:09 | 问题已收到，转高级工程师跟进 |
| 16:12:52 | "hy4 用量都很大，各模型都会有偶发的抖动，跟套餐限流没关系；套餐限流是最大额度，因为是共享池所以会抖（大量定时任务、长输入场景），其他用户也可能受影响" |
| 16:24:37 | "是大盘整体共享池资源一直高负载运行，和后付费没有关系" |

### 9.2 我方已提交的复现证据

- 本地稳定复现附件已随工单提交（即本报告 §三 的交替实验与 §四 完整数据、request_id 明细）。

### 9.3 回复草案（可直接粘贴至工单）

~~~text
感谢排查。在等待高级工程师期间，补充一个本地可控实验，可以排除"共享池随机抖动"的解释：

同一 Key、同一模型、同一端点，间隔 60~65 秒依次请求：
- 15:52:08  max_output_tokens=2048 → HTTP 200（response_id b2f3dadf-0eb9-4318-9e0a-eeba744bf0a5）
- 15:53:13  max_output_tokens=64000 → HTTP 429（429006）
- 15:54:14  不带该字段 → HTTP 200（response_id a6c7ef54-9469-46d6-b249-3feec1544645）

累计数据：带 max_output_tokens=64000 的请求 8/8 全部 429（含空闲 6.5 分钟后的请求）；不带或 2048 的请求在冷却期外全部成功。若 429 是随机负载抖动（假设单次成功概率 50%），8 连败概率约 0.4%；且失败与参数精确相关、与时间窗口无关，更像确定性准入行为。另：429 均在 0.5~1.1 秒内由网关直接返回，错误类型为 rate_limit_error（429006），无 Retry-After 字段；若为上游模型推理抖动，更可能表现为 5xx/超时。

请确认：网关是否按 max_output_tokens 做容量预留/计入限流准入（如 TPM 维度）？我们的请求实际只消耗输入 30 token、输出 69 token，若按"预留 64000"准入则永远无法通过，这与按量计费的实际用量口径不符。

另请一并确认：
1. 按贵司文档"TokenHub 模型限流与配额：每个模型在详情页查看具体规则"，hy4-preview 在订阅套餐上的限流规则（RPM/TPM/并发/单请求 max_output_tokens 上限）具体数值是多少？可对照我们提供的 request_id 在网关日志核验（e783034f-dc1e-413d-ac32-ce37d2c02739、62919b25-bbce-4591-b82b-f6c07c419707、413c6c09-eb3b-4e6a-999c-39cb0044f898 等）。
2. 429 响应能否补充 Retry-After 或文档化恢复时间？当前客户端只能盲退避（实测 500ms→10s 指数退避 5 次仍全部 429）。
3. /v1/models 返回了未被授权的模型（glm-5.3-flash 等调用返回 401006 not in allowed list），列表是否应按当前套餐授权过滤？

关于 8 月 31 日 token plan 上架 hy4 新模型后的订阅可用性，也请书面确认：订阅套餐是否有独立容量或优先级保障，还是与按量付费共享同一共享池？是否有 SLA 承诺与高峰保护机制？若共享池持续高负载，订阅用户是否同样会遇到上述确定性 429？
~~~

### 9.4 工程师答复中的疑点（内部参考，不随工单提交）

1. **「偶发抖动」与数据矛盾**：0/8 与 5/7 的参数相关结果、交替实验（2048→200 / 64000→429 / 缺省→200）是最强对照；共享池负载无法解释"同一分钟窗口内参数不同、结果不同"。
2. **错误分类矛盾**：429 错误类型即 rate_limit_error（429006），工程师却说"跟限流没关系"；且 0.5~1.1s 快速拒绝是网关准入层行为，不是上游推理抖动（那会是 5xx/超时/高延迟）。
3. **口头承诺风险**："后付费不保证可用性"若成立，应要求书面化并文档化限额；公开资料可引用：
   - "TokenHub 模型限流与配额：每个模型在详情页查看具体规则" https://cloud.tencent.cn/developer/article/2675468
   - "TokenHub 模型监控指标：TTFT、TPOT、RPM" https://cloud.tencent.com.cn/developer/article/2676153
   - TokenHub 在线推理官方文档 https://cloud.tencent.cn/document/product/1823/130087
   - Enterprise Token Plan https://www.tencentcloud.com/jp/document/product/1300/81471
   - 若限流规则与数值是对外文档化的，429 行为就不该由用户盲猜。
4. **下一步追问方向**：请高级工程师给出 (a) hy4-preview 文档化限额（RPM/TPM/max_output_tokens 上限）与判定维度；(b) Retry-After 或恢复时间；(c) 8/31 上架后订阅容量保障/SLA；(d) 用 request_id 日志核验 15:52~15:54 交替实验窗口内的网关判定记录。

### 9.5 正式追问（可直接粘贴至工单）

【正式追问 1】关于 429006 的判定逻辑与 max_output_tokens
请确认网关准入是否与请求声明的 max_output_tokens 相关。我们以同一 Key、同一模型、同一端点做了对照实验：max_output_tokens=64000 的请求 8/8 返回 429006，而 2048 或不带该字段的请求在相同时间窗口内（间隔 60~65 秒交替）均成功。若按"声明值预留容量/计入 TPM"准入，请明确该策略与按实际 token 计费的计量口径是否一致，并给出 hy4-preview 单请求 max_output_tokens 上限。

【正式追问 2】文档化限额与可见性
请提供 hy4-preview 在当前订阅套餐的限流规则数值（RPM/TPM/并发/单请求上限/恢复时间）及控制台具体查询路径。公开文档（"TokenHub 模型限流与配额：每个模型在详情页查看具体规则"）承诺限流规则可查，但我们无法在控制台或文档中找到 hy4-preview 的任何数值。若存在独立配额，请给出数值；若不存在，请书面说明。

【正式追问 3】可机读重试指引
429 响应仅返回 JSON body，无 Retry-After 等字段，客户端只能盲退避。我们实测指数退避（500ms→10s，5 次）全部仍 429，恢复周期约 60~120 秒。请确认：是否可补充 Retry-After 字段？官方推荐的退避策略与恢复时间预期是多少？

【正式追问 4】8/31 hy4 上架与订阅容量保障
8 月 31 日 token plan 将上架 hy4 新模型。请书面确认：订阅套餐与按量付费是否共享同一容量池？订阅是否有 SLA、预留容量或高峰保护机制？新模型上线前是否完成容量评估？若共享池持续高负载，订阅用户是否同样遇到当前这种 429？

【附注】/v1/models 返回了大量本套餐未授权模型（调用返回 401006 not in allowed list），列表接口与授权校验口径不一致，请一并确认是否按授权过滤。

---

[Formal Question 1] Admission logic and max_output_tokens
Please confirm whether gateway admission is tied to the requested max_output_tokens. Controlled experiment with the same key/model/endpoint: requests with max_output_tokens=64000 failed 8/8 with HTTP 429 (code 429006), while requests with 2048 or without the field succeeded within the same window (interleaved every 60-65 s). If admission reserves capacity / counts TPM based on the declared value, please clarify how this aligns with pay-as-you-go billing on actual tokens, and state the per-request max_output_tokens cap for hy4-preview.

[Formal Question 2] Documented limits and visibility
Please provide the documented rate-limit values for hy4-preview on our subscription (RPM/TPM/concurrency/per-request caps/recovery time) and the exact console path. Public docs ("TokenHub model rate limits and quotas: see each model's detail page") promise per-model limits are visible, but we cannot find any figures for hy4-preview in the console or docs. If a dedicated quota exists, please share the numbers; if not, please confirm in writing.

[Formal Question 3] Machine-readable retry guidance
429 responses contain only a JSON body with no Retry-After or equivalent header; clients can only blind-backoff. We observed that exponential backoff (500 ms to 10 s, 5 retries) still failed every time, with recovery of roughly 60-120 s. Can Retry-After (or equivalent) be added? What is the officially recommended backoff/recovery expectation?

[Formal Question 4] Aug 31 launch and subscription capacity guarantees
A new hy4 model is scheduled to launch on the token plan on Aug 31. Please confirm in writing: do subscription and pay-as-you-go share the same capacity pool? Is there an SLA, reserved capacity, or peak-protection for subscribers? Was capacity assessed before this launch? If the shared pool remains saturated, will subscribers hit the same deterministic 429?

[Note] GET /v1/models returns models not authorized on this plan (calls return 401006 "not in allowed list"); the list endpoint and the authorization check are inconsistent. Please confirm whether the list will be filtered by authorization.
