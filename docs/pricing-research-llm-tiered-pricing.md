# 各 LLM 厂商官方阶梯/差异化计价调研

- 调研日期：2026-09-19（所有 URL 均为该日访问）
- 币种：保留页面原始币种，不换汇
- 说明：本文件由调研 Agent 生成，供人工核验后录入「按上下文长度阶梯计价」功能

---

## OpenAI
- 计费维度：**按请求 prompt 输入总长分档（短上下文 / 长上下文，阈值 272K input tokens）**；同时按 cache hit / cache write 差异化；另有 Standard / Batch / Flex / Fast 四种服务档（各自再分短/长上下文）
- 定价表（per 1M tokens，USD）：
  | 模型 | 档位或条件 | 缓存读 | 缓存写 | 输入 | 输出 |
  |---|---|---|---|---|---|
  | gpt-6-astra | ≤272K（短） | $1.00 | $12.50 | $10.00 | $50.00 |
  | gpt-6-astra | >272K（长） | $2.00 | $25.00 | $20.00 | $75.00 |
  | gpt-5.6-sol | ≤272K | $0.40 | $5.00 | $4.00 | $20.00 |
  | gpt-5.6-sol | >272K | $0.80 | $10.00 | $8.00 | $30.00 |
  | gpt-5.6-terra | ≤272K | $0.20 | $2.50 | $2.00 | $12.00 |
  | gpt-5.6-terra | >272K | $0.40 | $5.00 | $4.00 | $18.00 |
  | gpt-5.6-luna | ≤272K | $0.02 | $0.25 | $0.20 | $1.20 |
  | gpt-5.6-luna | >272K | $0.04 | $0.50 | $0.40 | $1.80 |
  | gpt-5.5（上下文 1.05M） | ≤272K | $0.50 | — | $5.00 | $30.00 |
  | gpt-5.5 | >272K | $1.00 | — | $10.00 | $45.00 |
  | gpt-5.5-pro | ≤272K / >272K | — | — | $30 / $60 | $180 / $270 |
  | gpt-5.4 | ≤272K / >272K | $0.25 / $0.50 | — | $2.50 / $5.00 | $15 / $22.50 |
  | gpt-5.4-pro | ≤272K / >272K | — | — | $30 / $60 | $180 / $270 |
  | gpt-5.4-mini / gpt-5.4-nano | 无阶梯 | $0.075 / $0.02 | — | $0.75 / $0.20 | $4.50 / $1.25 |
  | gpt-5.2 / gpt-5.1 / gpt-5 | 无阶梯 | $0.175 / $0.125 / $0.125 | — | $1.75 / $1.25 / $1.25 | $14 / $10 / $10 |
  | gpt-5.2-pro / gpt-5-pro | 无阶梯 | — | — | $21 / $15 | $168 / $120 |
  | gpt-5-mini / gpt-5-nano | 无阶梯 | $0.025 / $0.005 | — | $0.25 / $0.05 | $2.00 / $0.40 |
  | gpt-4.1 / gpt-4.1-mini / gpt-4.1-nano | 无阶梯 | $0.50 / $0.10 / $0.025 | — | $2.00 / $0.40 / $0.10 | $8.00 / $1.60 / $0.40 |
  | gpt-4o / gpt-4o-mini | 无阶梯 | $1.25 / $0.075 | — | $2.50 / $0.15 | $10.00 / $0.60 |
  | o3 / o4-mini / o3-mini | 无阶梯 | $0.50 / $0.275 / $0.55 | — | $2.00 / $1.10 / $1.10 | $8.00 / $4.40 / $4.40 |
- 阶梯规则原文：Prompts with >272K input tokens are priced at 2x input and 1.5x output for the full request（整单全部 token 按长上下文价结算）
- 缓存规则：Cache writes are billed at 1.25x the uncached input token rate（如 $2.00 → $2.50）
- 引用源：
  - https://developers.openai.com/api/docs/pricing（官方）2026-09-19
  - https://developers.openai.com/api/docs/pricing.md（官方 markdown 版，含完整表格）2026-09-19
  - https://developers.openai.com/api/docs/models/gpt-5.6-terra.md（官方，272K 与 1.25x cache write 原文）2026-09-19
  - https://developers.openai.com/api/docs/models/gpt-6-astra.md（官方）2026-09-19
  - https://developers.openai.com/api/docs/models/gpt-5.5.md（官方）2026-09-19
  - https://developers.openai.com/api/docs/models/gpt-5.4.md（官方）2026-09-19
- 置信度：高
- 备注：① 页面 **403/Cloudflare 拦截严重**，需带浏览器 UA + 代理才能取到；openai.com/api/pricing 直接 403，developers.openai.com 的 `.md` 后缀版本最稳定；② 区域处理（data residency）端点对 2026-03-05 后发布的模型加价 10%；③ Fast mode（原 Priority）为 2x 标准价；④ Batch/Flex 为 50%；⑤ gpt-5.6 Sol 为促销价（至少至 2026-11-21）；⑥ 无 cache write 价的模型表示该模型不支持显式 cache write 计费。

---

## Anthropic
- 计费维度：**按缓存命中/未命中 + 缓存写 TTL 差异化；无 prompt 长度阶梯**（4.6 及以后已取消长上下文加价）
- 定价表（per 1M tokens，USD）：
  | 模型 | 档位或条件 | 缓存读 | 缓存写(5m) | 缓存写(1h) | 输入 | 输出 |
  |---|---|---|---|---|---|---|
  | Claude Fable 5.1 | — | $0.25（0.025x） | $12.50（1.25x） | $20（2x） | $10 | $50 |
  | Claude Mythos 5.1 | — | $0.25（0.025x） | $12.50 | $20 | $10 | $50 |
  | Claude Fable 5 / Mythos 5 | — | $1（0.1x） | $12.50 | $20 | $10 | $50 |
  | Claude Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 | — | $0.50（0.1x） | $6.25（1.25x） | $10（2x） | $5 | $25 |
  | Claude Opus 4.1 / Opus 4（已退役） | — | $1.50 | $18.75 | $30 | $15 | $75 |
  | Claude Sonnet 5 | — | $0.20（0.1x） | $2.50 | $4 | $2 | $10 |
  | Claude Sonnet 4.6 / 4.5 / Sonnet 4 | — | $0.30 | $3.75 | $6 | $3 | $15 |
  | Claude Haiku 4.5 | — | $0.10 | $1.25 | $2 | $1 | $5 |
  | Claude Haiku 3.5（已退役） | — | $0.08 | $1 | $1.60 | $0.80 | $4 |
- 缓存倍率（官方原文）：5-minute cache write = 1.25x base input；1-hour cache write = 2x base input；Cache read (hit) = 0.1x base input（Fable 5.1 / Mythos 5.1 为 0.025x）
- 长上下文：**Claude 4.6 及以后 + Mythos Preview 全 1M 窗口按标准价**，原文「A 900k-token request is billed at the same per-token rate as a 9k-token request」→ 不存在 >200k 加价档
- 引用源：
  - https://platform.claude.com/docs/en/about-claude/pricing（官方）2026-09-19
  - https://claude.com/blog/1m-context-ga（官方博客：1M context GA，无 long-context premium）2026-09-19
  - https://claude.com/pricing（官方）2026-09-19
- 置信度：高
- 备注：① **历史变化点，务必写进备注**：Opus 4.1/Sonnet 4 时代曾有 >200k 长上下文加价，现已在 4.6+ 取消（第三方 langfuse issue #12996 亦记录「stale Large Context pricing tier」）——如果插件里有历史平台数据需做版本区分；② `inference_geo: "us"` 对 4.6+ 全部 token 类别（含 cache 读写）乘 1.1x；③ Fast mode（Opus 5 / 4.8）$10/$50，cache 倍率叠加其上；④ Batch 为 50%；⑤ Bedrock / Google Cloud 区域端点额外 +10%。

---

## Google Gemini
- 计费维度：**按 prompt 长度分档（200K 阈值，2.5 / 3.x Pro 级）**；缓存按「缓存 token 的单价」而非倍率；另有 Priority / Batch / Flex 服务档
- 定价表（per 1M tokens，USD；Gemini Developer API）：
  | 模型 | 档位或条件 | 缓存读 | 缓存写 | 输入 | 输出 |
  |---|---|---|---|---|---|
  | Gemini 3.1 Pro Preview | ≤200k | $0.20 | 存储费 $4.50/1M token/小时 | $2.00 | $12.00 |
  | Gemini 3.1 Pro Preview | >200k | $0.40 | 同上 | $4.00 | $18.00 |
  | Gemini 3.8 Flash（至 2026-12-31 促销） | 无长度阶梯 | $0.075 | 存储 $0.50/1M/小时 | $0.75 | $3.75 |
  | Gemini 3.8 Flash（2027-01-01 起标准价） | 无长度阶梯 | $0.15 | 存储 $1.00/1M/小时 | $1.50 | $7.50 |
  | Gemini 3.7 Flash（至 2026-12-31 促销） | 无长度阶梯 | $0.075 | 存储 $0.50/1M/小时 | $0.75 | $3.75 |
  | Gemini 2.5 Pro | ≤200k | $0.125 | 存储 $4.50/1M/小时 | $1.25 | $10.00 |
  | Gemini 2.5 Pro | >200k | $0.25 | 同上 | $2.50 | $15.00 |
  | Gemini 2.5 Computer Use Preview | ≤200k / >200k | — | — | $1.25 / $2.50 | $10 / $15 |
  | Gemini 1.5 Flash | ≤128K / >128K | — | — | $0.075 / $0.15 | $0.30 / $0.60 |
  | Gemini 1.5 Pro | ≤128K / >128K | — | — | $1.25 / $2.50 | $5.00 / $10.00 |
- 阶梯规则原文（Vertex）：*If a query input context is longer than 200K tokens, **all tokens (input and output)** are charged at long context rates.* Gemini 1.5 时代阈值为 128K，同为「全量按长档结算」
- 引用源：
  - https://ai.google.dev/gemini-api/docs/pricing（官方）2026-09-19
  - https://cloud.google.com/vertex-ai/generative-ai/pricing（官方，另一套「Agent Platform/Vertex」价目与 200K 全量计费原文）2026-09-19
  - https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing（官方，Enterprise 版，含 5 分钟缓存写）2026-09-19
- 置信度：中高
- 备注：① **Gemini Developer API 与 Vertex AI 是两套价目**（开发者为 $2/$12 的 3.1 Pro、Vertex 有 Global / Non-global 区域差 + Batch/Flex/Priority 三档）；② 缓存是「缓存 token 单价 + 按 token·小时的存储费」，**没有 cache write 倍率**，如要录入需额外建 storage 字段或忽略存储费；③ 3.8 / 3.7 Flash 促销价与 2027-01-01 起的标准价并存，录入时必须带生效期；④ 非 global 端点起步于 2026-07-01，比 global 高约 10%；⑤ 开发文档页 curl 直连常超时（302 循环 / 连接被重置），需代理 + 浏览器 UA。

---

## xAI (Grok)
- 计费维度：**按请求 prompt 长度分档（短 / 长上下文，阈值 200K prompt tokens）**；缓存读为单独单价；**无 cache write 计费**（自动缓存）
- 定价表（per 1M tokens，USD）：
  | 模型 | 档位或条件 | 缓存读 | 缓存写 | 输入 | 输出 |
  |---|---|---|---|---|---|
  | grok-4.6 | <200k（短） | $0.50 | 无（自动缓存） | $2.00 | $6.00 |
  | grok-4.6 | ≥200k（长） | $1.00 | 无 | $4.00 | $12.00 |
  | grok-build-0.1 | <200k | $0.20 | 无 | $1.00 | $2.00 |
  | grok-build-0.1 | ≥200k | $0.40 | 无 | $2.00 | $4.00 |
  | grok-4.5 | <200k | $0.30 | 无 | $2.00 | $6.00 |
  | grok-4.5 | ≥200k | $0.60 | 无 | $4.00 | $12.00 |
  | grok-4.3 | <200k | $0.20 | 无 | $1.25 | $2.50 |
  | grok-4.3 | ≥200k | $0.40 | 无 | $2.50 | $5.00 |
  | grok-4.20-multi-agent-0309 / -reasoning / -non-reasoning | <200k / ≥200k | $0.20 / $0.40 | 无 | $1.25 / $2.50 | $2.50 / $5.00 |
- 阶梯规则原文：*Models with long context pricing bill the long context rates for **all tokens in a request** once its prompt reaches the model's long context threshold.*（Long context ≥ 200k tokens）
- 引用源：
  - https://docs.x.ai/developers/pricing（官方，主价目表）2026-09-19
  - https://docs.x.ai/developers/models/grok-4.6（官方，模型页「Higher context pricing / We charge different rates for requests which exceed the 200K context window」）2026-09-19
  - https://docs.x.ai/docs/advanced/prompt-caching（官方，缓存自动启用、无写费）2026-09-19
  - https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing（官方，cached tokens 计费）2026-09-19
- 置信度：高
- 备注：① docs.x.ai 在本机 **必须走 http://127.0.0.1:7897 代理**，直连 DNS 解析到异常 IP 会超时；② US regional endpoint 全部 token 单价 ×1.1（10% premium）；③ 网页搜索等 server-side tool 另按 $5/1k 调用计费（2026-09-21 起 X Search 改为按 posts/profiles 计）；④ 无 Batch API（grok-4.6 明确 Not supported）。

---

## DeepSeek
- 计费维度：**无 prompt 长度阶梯**；差异维度 = 缓存命中/未命中 + 高峰/空闲时段（空闲为高峰的 5 折）
- 定价表（per 1M tokens，CNY）：
  | 模型 | 档位或条件 | 缓存读（命中） | 缓存写 | 输入（未命中） | 输出 |
  |---|---|---|---|---|---|
  | deepseek-flash | 空闲时段 | ¥0.02 | 无独立写费 | ¥1 | ¥4 |
  | deepseek-flash | 高峰时段 | ¥0.04 | — | ¥2 | ¥8 |
  | deepseek-v4-pro | 空闲时段 | ¥0.15 | — | ¥4.5 | ¥13.5 |
  | deepseek-v4-pro | 高峰时段 | ¥0.30 | — | ¥9.0 | ¥27.0 |
- 时段规则：北京时间周一至周五（不含法定节假日）9:00–12:00、14:00–18:00 为高峰，其余（含周末与节假日全天）为空闲；空闲价为高峰价的一半
- 缓存规则：上下文硬盘缓存**对所有用户默认开启、无需改代码**；!请求结束位置落盘 + 公共前缀检测落盘!；前缀完整匹配才命中；**页面未列 cache write 单价**（写缓存不额外收费）
- 引用源：
  - https://api-docs.deepseek.com/zh-cn/quick_start/pricing/（官方）2026-09-19
  - https://api-docs.deepseek.com/quick_start/pricing/（官方英文版）2026-09-19
  - https://api-docs.deepseek.com/zh-cn/guides/kv_cache（官方，缓存落盘/命中规则）2026-09-19
- 置信度：高
- 备注：① 官方页只有 2 个在售模型（deepseek-flash / deepseek-v4-pro），旧名 deepseek-v4-flash 已下线但仍可按 Flash 价调用；② 上下文 1M、最大输出 384K；③ 时段判据是**服务端收到请求的时间**，与处理/返回时刻无关；④ 若插件要表达「缓存写」，DeepSeek 应留空。

---

## 阿里云通义千问 Qwen（百炼 Model Studio）
- 计费维度：**真正的 prompt 长度阶梯**（单次请求输入 token 总量分档，命中档位后**该请求所有 token** 按该档单价结算）；缓存另有显式/隐式两套折扣；Batch 半价（与缓存不能同时生效）
- 定价表（per 1M tokens；中国内地 CNY / 国际 USD 两套价目）：

  **国际站（USD）**
  | 模型 | 档位或条件 | 缓存读 | 缓存写 | 输入 | 输出 |
  |---|---|---|---|---|---|
  | qwen3-max / qwen3-max-2026-01-23 / -preview | 0 < Token ≤ 32K | 命中 10%（显式）/20%（隐式） | 显式创建 125% | $1.2 | $6 |
  | qwen3-max | 32K < Token ≤ 128K | 同上 | 同上 | $2.4 | $12 |
  | qwen3-max | 128K < Token ≤ 256K | 同上 | 同上 | $3 | $15 |
  | qwen3.6-max-preview | 0 < Token ≤ 128K | 同上 | 同上 | $1.3 | $7.8 |
  | qwen3.6-max-preview | 128K < Token ≤ 256K | 同上 | 同上 | $2 | $12 |
  | qwen3.8-max / qwen3.7-max | 0 < Token ≤ 1M（无阶梯） | 同上 | 同上 | $2 / $2.5 | $6 / $7.5 |
  | qwen-plus | 0 < Token ≤ 128K | 同上 | 同上 | $0.115 | $0.287（非思考）/$1.147（思考） |
  | qwen-plus | 128K < Token ≤ 256K | 同上 | 同上 | $0.345 | $2.868 / $3.441 |
  | qwen-plus | 256K < Token ≤ 1M | 同上 | 同上 | $0.689 | $6.881 / $9.175 |
  | qwen3.7-plus / qwen3.6-plus | 0 < Token ≤ 256K | 同上 | 同上 | $0.276 | $1.101 / $1.651 |
  | qwen3.7-plus | 256K < Token ≤ 1M | 同上 | 同上 | $0.826 | $3.301 |
  | qwen3.5-plus | ≤128K / 128–256K / 256K–1M | 同上 | 同上 | $0.115 / $0.287 / $0.573 | $0.688 / $1.72 / $3.44 |
  | qwen3.8-flash | 0 < Token ≤ 1M（无阶梯） | 同上 | 同上 | $0.15 | $0.47 |
  | qwen-max | 无阶梯计价 | 无缓存折扣 | — | $1.6 | $6.4 |

  **中国内地（CNY，华北2·北京）**
  | 模型 | 档位或条件 | 缓存读 | 缓存写 | 输入 | 输出 |
  |---|---|---|---|---|---|
  | qwen3-max | 0 < Token ≤ 32K | 命中 10%（显式）/20%（隐式） | 显式创建 125% | ¥2.5 | ¥10 |
  | qwen3-max | 32K < Token ≤ 128K | 同上 | 同上 | ¥4 | ¥16 |
  | qwen3-max | 128K < Token ≤ 256K | 同上 | 同上 | ¥7 | ¥28 |
  | qwen3-max-2025-09-23 | 32K / 128K / 256K 三档 | 同上 | 同上 | ¥6 / ¥10 / ¥15 | ¥24 / ¥40 / ¥60 |
  | qwen3.5-plus | ≤256K / 256K–1M | 同上 | 同上 | ¥1 / ¥4 | ¥4 / ¥24 |
  | qwen3.6-plus | ≤256K / 256K–1M | 同上 | 同上 | ¥2 / ¥8 | ¥12 / ¥48 |
  | qwen3.6-max-preview | 0–128K / 128–256K | 同上 | 同上 | ¥9 / ¥15 | ¥54 / ¥90 |
  | qwen3.7-max / qwen3.7-max-2026-05-20 / -06-08 | 0 < Token ≤ 1M（无阶梯） | 同上 | 同上 | ¥12 | ¥36 |
  | qwen3.8-max | 0 < Token ≤ 1M（无阶梯） | 同上 | 同上 | ¥12 | ¥36 |
  | qwen3.8-max-prime（优速模式） | 0 < Token ≤ 1M | 同上 | 同上 | ¥24 | ¥72 |
  | qwen-plus | ≤128K / 128–256K / 256K–1M | 无缓存折扣标注 | — | ¥0.8 / ¥2.4 / ¥4.8 | ¥2/¥8、¥20/¥24、¥48/¥64（非思考/思考） |
  | qwen3.8-flash | 0 < Token ≤ 1M（无阶梯） | 同上 | 同上 | ¥0.8 | ¥2.7 |
  | qwen-max | 无阶梯计价 | — | — | ¥2.4 | ¥9.6 |

- 阶梯规则原文：*百炼部分模型实行阶梯计费。单价取决于单次请求的输入 Token 总量。该请求的所有 Token 均按对应阶梯的单价结算。*（K=1,000，M=1,000,000）
- 缓存规则原文：*显式缓存创建按标准输入单价的 125% 计费、命中按 10% 计费*；*隐式缓存命中的输入 Token 通常按输入 Token 标准单价的 20% 计费*
- 引用源：
  - https://www.alibabacloud.com/help/zh/model-studio/model-pricing（官方，国际站价目）2026-09-19
  - https://help.aliyun.com/zh/model-studio/model-pricing（官方，中国内地价目）2026-09-19
  - https://www.alibabacloud.com/help/zh/model-studio/context-cache（官方，缓存折扣 125%/10%/20%）2026-09-19
  - https://www.alibabacloud.com/help/zh/model-studio/models（官方，模型总览）2026-09-19
- 置信度：高
- 备注：① 阶梯区间以「单次请求输入 token 总量」为准（同一请求内全量按高档结算），是本次调研中**最适合直接映射「按上下文长度阶梯」的厂商之一**；② 同一模型名按**地域**（北京/新加坡/香港/东京/美国/欧盟）和**部署范围**（全球/国际/中国内地）多套价，录入必须带地域维度；③ qwen3-max 系列出现「32K 档 → 128K 档 → 256K 档」是典型三档样本；④ 部分价格带**限时错峰折扣**（标注「原价…限时错峰4折/忙时8折」），表内取的是原价；⑤ 国际站与中国内地是两个独立页面，币种不同。

---

## Moonshot Kimi
- 计费维度：**无 prompt 长度阶梯**；差异维度 = 缓存写入 TTL 档（5min / 1h）+ 缓存命中 vs 未命中
- 定价表（per 1M tokens）：

  **中国站（CNY）**
  | 模型 | 档位或条件 | 缓存读 | 缓存写(5m) | 缓存写(1h) | 输入 | 输出 |
  |---|---|---|---|---|---|---|
  | kimi-k3 | 上下文 1,048,576 | ¥2.00 | ¥20.00 | ¥40.00 | ¥20.00 | ¥100.00 |
  | kimi-k2.7-code | 262,144 | ¥1.30 | 无独立写费 | 无 | ¥6.50 | ¥27.00 |
  | kimi-k2.7-code-highspeed | 262,144 | ¥2.60 | — | — | ¥13.00 | ¥54.00 |
  | kimi-k2.6 | 262,144 | ¥1.10 | — | — | ¥6.50 | ¥27.00 |

  **国际站（USD）**
  | 模型 | 档位或条件 | 缓存读 | 缓存写(5m) | 缓存写(1h) | 输入 | 输出 |
  |---|---|---|---|---|---|---|
  | kimi-k3 | 1,048,576 | $0.30 | $3.00 | $6.00 | $3.00 | $15.00 |
  | kimi-k2.7-code | 262,144 | $0.19 | — | — | $0.95 | $4.00 |
  | kimi-k2.7-code-highspeed | 262,144 | $0.38 | — | — | $1.90 | $8.00 |
  | kimi-k2.6 | 262,144 | $0.16 | — | — | $0.95 | $4.00 |
- 缓存规则原文：对重复请求前缀**自动启用**上下文缓存，TTL 分 5min / 1h 两档（不指定默认 5min）；命中后按缓存命中价计费，且**自动续期、不再收缓存写入费**
- Batch：Batch API 为标准价的 60%（支持 kimi-k2.7-code / kimi-k2.6）
- 引用源：
  - https://platform.kimi.com/docs/pricing/chat（官方中文，CNY）2026-09-19
  - https://platform.kimi.com/docs/pricing/chat.md（官方 markdown 原文，含完整表格）2026-09-19
  - https://platform.kimi.ai/docs/pricing/chat（官方英文，USD）2026-09-19
  - https://platform.kimi.ai/docs/pricing/chat.md（官方英文 markdown）2026-09-19
  - https://platform.kimi.com/docs/pricing/batch（官方，Batch 60%）2026-09-19
- 置信度：高
- 备注：① 这是除 Anthropic 外**唯一提供真实 cache write 单价**的厂商（按 TTL 分档），非常适合用 cacheWrite 字段表达；② HTML 页面里的价格表由 `<DocTable>` JSX 渲染、直接 fetch 会丢内容，**必须取 `.md` 后缀版本**；③ 中国站与国际站是两套独立域名与币种。

---

## 智谱 GLM（BigModel）
- 计费维度：**存在 prompt 长度阶梯**（阈值 32K 为主；GLM-4.7 还有 32K–200K 档与「输出长度」子档）；缓存命中单独低价、缓存存储按时长计费（当前限时免费）
- 定价表（per 1M tokens，CNY）：
  | 模型 | 档位或条件 | 缓存读 | 缓存写 | 输入 | 输出 |
  |---|---|---|---|---|---|
  | GLM-5.3 | 1M 上下文，无长度阶梯 | ¥2 | 存储 限时免费（¥/百万 token/小时） | ¥8 | ¥28 |
  | GLM-5.3-Flash | 1M，无阶梯 | ¥0.23 | 存储 限时免费 | ¥0.8 | ¥2.8 |
  | GLM-5.3-FlashX | 1M，无阶梯 | ¥0.57 | 存储 限时免费 | ¥2 | ¥7 |
  | GLM-5.2 | 1M，无阶梯 | ¥2 | 存储 限时免费 | ¥8 | ¥28 |
  | GLM-5.1 | 输入长度 [0, 32K) | ¥1.3 | 存储 限时免费 | ¥6 | ¥24 |
  | GLM-5.1 | 输入长度 ≥ 32K | ¥2 | 存储 限时免费 | ¥8 | ¥28 |
  | GLM-5-Turbo | [0, 32K) / ≥32K | ¥1.2 / ¥1.8 | 存储 限时免费 | ¥5 / ¥7 | ¥22 / ¥26 |
  | GLM-5 | [0, 32K) / ≥32K | ¥1 / ¥1.5 | 存储 限时免费 | ¥4 / ¥6 | ¥18 / ¥22 |
  | GLM-4.7 | 输入 [0,32K) 且输出 [0,0.2K) | ¥0.4 | 存储 限时免费 | ¥2 | ¥8 |
  | GLM-4.7 | 输入 [0,32K) 且输出 ≥0.2K | ¥0.6 | 存储 限时免费 | ¥3 | ¥14 |
  | GLM-4.7 | 输入 [32K, 200K) | ¥0.8 | 存储 限时免费 | ¥4 | ¥16 |
  | GLM-4.5-Air | [0,32K)+输出<0.2K / ≥0.2K / [32K,128K) | ¥0.16 / ¥0.16 / ¥0.24 | 存储 限时免费 | ¥0.8 / ¥0.8 / ¥1.2 | ¥2 / ¥6 / ¥8 |
  | GLM-4.7-FlashX | 200K | ¥0.1 | 存储 限时免费 | ¥0.5 | ¥3 |
  | GLM-4.7-Flash | 200K | 免费 | 免费 | 免费 | 免费 |
- 计费公式（官方原文）：调用费用 = 未命中缓存的输入费用 + 缓存命中费用 + 输出费用 + **缓存存储费用**
- 缓存规则：缓存命中 Token 按优惠价（页面价格约为输入价的 20%–25%；官方缓存文档表述为「通常为标准价格的 50%」——**两处表述不一致，以定价页具体数字为准**）
- 引用源：
  - https://docs.bigmodel.cn/cn/guide/start/pricing（官方，主价格表）2026-09-19
  - https://docs.bigmodel.cn/cn/guide/capabilities/cache（官方，缓存计费说明）2026-09-19
  - https://bigmodel.cn/pricing（官方控制台价格页）2026-09-19
- 置信度：高（价格值）/ 中（缓存折扣倍率表述有冲突）
- 备注：① GLM 是**阶梯 + 缓存双维度**的厂商，且存在「输入档 × 输出档」二维阶梯（GLM-4.7 / 4.5-Air），插件若只支持一维 prompt 长度阶梯会丢信息；② 缓存存储按「元/百万 token/小时」——目前限时免费，**这是第四种计费维度**（Gemini、Doubao 也有）；③ GLM-4.7-Flash 完全免费，注意 0 价处理；④ 表内「缓存命中」是绝对价，不是倍率。

---

## MiniMax
- 计费维度：**存在 prompt 长度阶梯（512K 阈值，仅 M3 系列）**；缓存按缓存读/写单价（M2.x 有写价，M3 只列读价）；另 priority tier 为 1.5x
- 定价表（per 1M tokens）：

  **国际站（USD）**
  | 模型 | 档位或条件 | 缓存读 | 缓存写 | 输入 | 输出 |
  |---|---|---|---|---|---|
  | MiniMax-M3 | ≤ 512k input tokens（Standard） | $0.06 | 未列 | $0.30 | $1.20 |
  | MiniMax-M3 | > 512k input tokens（Standard） | $0.12 | 未列 | $0.60 | $2.40 |
  | MiniMax-M3 | ≤ 512k（Priority，1.5x） | $0.09 | 未列 | $0.45 | $1.80 |
  | MiniMax-M3 | > 512k（Priority，1.5x） | $0.18 | 未列 | $0.90 | $3.60 |
  | MiniMax-M2.7 | 无阶梯 | $0.06 | $0.375 | $0.30 | $1.20 |
  | MiniMax-M2.7-highspeed | 无阶梯 | $0.06 | $0.375 | $0.60 | $2.40 |
  | MiniMax-M2.5 / M2.1 / M2 | 无阶梯（历史模型） | $0.03 | $0.375 | $0.30 | $1.20 |

  **中国站（CNY）**
  | 模型 | 档位或条件 | 缓存读 | 缓存写 | 输入 | 输出 |
  |---|---|---|---|---|---|
  | MiniMax-M3 | ≤ 512k（Standard，永久五折后） | ¥0.42 | 未列 | ¥2.10 | ¥8.40 |
  | MiniMax-M3 | > 512k（Standard，五折后） | ¥0.84 | 未列 | ¥4.20 | ¥16.80 |
  | MiniMax-M3 | ≤ 512k（Priority，1.5x） | ¥0.63 | 未列 | ¥3.15 | ¥12.60 |
  | MiniMax-M3 | > 512k（Priority，1.5x） | ¥1.26 | 未列 | ¥6.30 | ¥25.20 |
  | MiniMax-M2.7 | 无阶梯 | ¥0.42 | ¥2.625 | ¥2.1 | ¥8.4 |
  | MiniMax-M2.7-highspeed | 无阶梯 | ¥0.42 | ¥2.625 | ¥4.2 | ¥16.8 |
  | MiniMax-M2.5 / M2.1 / M2 | 无阶梯 | ¥0.21 | ¥2.625 | ¥2.1 | ¥8.4 |
- 引用源：
  - https://platform.minimax.io/docs/guides/pricing-paygo（官方国际站）2026-09-19
  - https://platform.minimaxi.com/docs/guides/pricing-paygo.md（官方中国站 markdown 原文）2026-09-19
  - https://platform.minimaxi.com/docs/guides/pricing-paygo（官方中国站）2026-09-19
- 置信度：高
- 备注：① 国际站 M3 页面上「~~$0.60~~ $0.30」的删除线为**永久五折**，录入应取折后价并记录原价；② 中国站与腾讯 TokenHub（MiniMax-M3 2.1/4.2 元）价格一致，可交叉验证；③ M3 未公布缓存写价，M2.x 有 → 录入时按模型分别处理；④ `service_tier: priority` 为 1.5x；⑤ 中国站文档的 `.md` 后缀可直取表格，HTML 版也含表格。

---

## 字节豆包 Doubao（火山方舟）
- 计费维度：**真正的 prompt 长度阶梯**（千 token 为单位，典型档 [0,32] / (32,128] / (128,256]）；缓存命中单独低价 + **缓存存储按小时计费**；另有在线推理（常规）/（低优）/ 批量推理三种服务档
- 定价表（per 1M tokens，CNY；**在线推理·常规**）：
  | 模型 | 档位或条件（输入长度为千 token） | 缓存读（命中） | 缓存写 | 输入 | 输出 |
  |---|---|---|---|---|---|
  | doubao-seed-evolving | 输入长度 [0, 1024] 千 token（=1M） | ¥1.20 | 存储 ¥0.017/百万 token/小时 | ¥6.00 | ¥30.00 |
  | doubao-seed-2.1-pro | [0, 1024] | ¥1.20 | 存储 ¥0.017 | ¥6.00 | ¥30.00 |
  | doubao-seed-2.1-turbo | [0, 256] | ¥0.60 | 存储 ¥0.017 | ¥3.00 | ¥15.00 |
  | doubao-seed-2.0-pro | [0,32] / (32,128] / (128,256] | ¥0.64 / ¥0.96 / ¥1.92 | 存储 ¥0.017 | ¥3.2 / ¥4.8 / ¥9.6 | ¥16 / ¥24 / ¥48 |
  | doubao-seed-2.0-lite | [0,32] / (32,128] / (128,256] | ¥0.12 / ¥0.18 / ¥0.36 | 存储 ¥0.017 | ¥0.6 / ¥0.9 / ¥1.8（音频 ¥9/¥13.5/¥27） | ¥3.6 / ¥5.4 / ¥10.8 |
  | doubao-seed-2.0-mini | [0,32] / (32,128] / (128,256] | ¥0.04 / ¥0.08 / ¥0.16 | 存储 ¥0.017 | ¥0.2 / ¥0.4 / ¥0.8 | ¥2 / ¥4 / ¥8 |
  | doubao-seed-2.0-code | [0,32] / (32,128] / (128,256] | ¥0.64 / ¥0.96 / ¥1.92 | 存储 ¥0.017 | ¥3.2 / ¥4.8 / ¥9.6 | ¥16 / ¥24 / ¥48 |
  | doubao-seed-1.8 | [0,32]+输出<0.2 / [0,32]+输出≥0.2 / (32,128] / (128,256] | ¥0.16（四档同价） | 存储 ¥0.017 | ¥0.8 / ¥0.8 / ¥1.2 / ¥2.4 | ¥2 / ¥8 / ¥16 / ¥24 |
  | doubao-seed-character | [0,32] / (32,128] | ¥0.16 / ¥0.16 | 存储 ¥0.017 | ¥0.8 / ¥1.2 | ¥2 / ¥6 |
  | doubao-seed-code | [0,32] / (32,128] / (128,256] | ¥0.24（三档同价） | 存储 ¥0.017 | ¥1.2 / ¥1.4 / ¥2.8 | ¥8 / ¥12 / ¥16 |
  | doubao-seed-1.6 | 同 1.8 四档 | ¥0.16 | 存储 ¥0.017 | ¥0.8 / ¥0.8 / ¥1.2 / ¥2.4 | ¥2 / ¥8 / ¥16 / ¥24 |
- 计费公式（官方原文）：批量推理费用 = 输入单价 × 输入 token + 缓存命中单价 × 缓存命中 token + 输出单价 × 输出 token
- 引用源：
  - https://docs.volcengine.com/docs/ark/model-pricing?lang=zh（官方，主价目表）2026-09-19
  - https://docs.volcengine.com/docs/82379/2123228?lang=zh（官方，豆包大模型 1.8 页）2026-09-19
  - https://www.volcengine.com/docs/82379/1099320（官方，模型计费说明）2026-09-19
- 置信度：高（价格数值）/ 中（URL 稳定性）
- 备注：① 该页是**纯 JS 渲染的 SPA**，curl/web_fetch 只能拿到空壳，**必须用浏览器（browser-harness / CDP）渲染后取 innerText**；② 阶梯单位是「**千 token**」而非 token，`[0,1024]` 即 1M，录入时务必换算，否则差 1000 倍；③ 输入单价分**非音频/音频**两列（lite 有音频价），插件若只支持单输入价需取舍；④ 缓存存储 ¥0.017/百万 token/小时 是独立计费项；⑤ 另有「在线推理（低优）」档（约为常规价 50%，如 2.1-pro 输入 ¥3.00/输出 ¥15.00）与批量推理档；⑥ 部分模型（seed-1.8/1.6）阶梯还叠加**输出长度**子档。

---

## 腾讯混元（Hunyuan / TokenHub）
- 计费维度：**混元自研模型无 prompt 长度阶梯**（TokenHub 表中「阶梯」列为 `-`）；差异维度 = 缓存命中单价；平台同时转售三方模型（三方模型沿用各自阶梯）
- 定价表（per 1M tokens，CNY；TokenHub 在线推理·广州）：
  | 模型 | 档位或条件 | 缓存读（命中） | 缓存写 | 输入 | 输出 |
  |---|---|---|---|---|---|
  | Hy4 preview | 无阶梯 | ¥0.3 | 未列 | ¥6 | ¥18 |
  | Hy3 | 无阶梯 | ¥0.25 | 未列 | ¥1 | ¥4 |
  | Hy-MT2-Pro / Hy-MT2-Plus | 无阶梯 | — | — | ¥0.5 | ¥2 |
  | Hy-MT2-Lite | 无阶梯 | — | — | ¥0.3 | ¥1.2 |
  | Hy-Role-Latest / Hy-Role | 无阶梯 | — | — | ¥2.4 | ¥9.6 |
  | HY-Vision-2.0-Instruct（多模态理解） | 无阶梯 | — | — | ¥7.5 | ¥17.5 |
  | YT-VITA（多模态理解） | 无阶梯 | — | — | ¥1.2 | ¥3.5 |
  | （旧平台遗留）Hunyuan-a13b | 无阶梯 | — | — | ¥0.5 | ¥2 |
  | Hunyuan-translation / -lite | 无阶梯 | — | — | ¥1.2 / ¥1 | ¥3.6 / ¥3 |
  | Tencent HY Vision 1.5 Instruct / turbos-vision / t1-vision | 无阶梯 | — | — | ¥3 | ¥9 |
- 引用源：
  - https://cloud.tencent.com/document/product/1823/130055（官方 TokenHub 模型价格，含混元与三方）2026-09-19
  - https://cloud.tencent.com/product/tokenhub（官方 TokenHub 定价概览）2026-09-19
  - https://cloud.tencent.com/document/product/1729/97731（官方旧「混元生文计费概述」，已提示迁移至 TokenHub）2026-09-19
- 置信度：中高
- 备注：① 官方明确公告「腾讯混元大模型相关功能将逐步迁移至 TokenHub，原平台不再新增模型能力」——**旧页面只剩遗留模型（a13b / role / translation / vision）**，新模型（Hy4 preview / Hy3）只在 TokenHub；② TokenHub 上转售的 GLM-5.1（32K 分档）、MiniMax-M3（512K 分档）、Qwen3.5-Plus/Flash（128K/256K 分档）、Kimi K3 等**与各原厂阶梯一致**，可作交叉验证；③ 混元自研线**既无长度阶梯也无缓存写价**，只有缓存命中价（Hy4 0.3 / Hy3 0.25 元）；④ TokenHub 页面为静态 HTML，curl 可直接取到完整表格。

---

## 横向结论

### 1. 存在真正「prompt 长度阶梯」的厂商（适合按上下文长度阶梯录入）

按「单次请求输入 token 总量落档 → 该请求**全部 token** 按该档单价结算」这一语义严格筛选：

| 厂商 | 阈值档 | 备注 |
|---|---|---|
| **OpenAI** | **272K**（短/长两档，长档输入 ×2、输出 ×1.5，含 cache 读写同倍） | 阈值持久稳定，规则原文清晰，最适合做基准实现 |
| **Google Gemini** | **200K**（2.5/3.x Pro 级）；Gemini 1.5 时代为 128K | 长档为独立绝对价，非倍率 |
| **xAI Grok** | **200K**（4.x 全线） | 倍率规律最整齐：输入/缓存读 ×2，输出 ×2 |
| **阿里云 Qwen** | **32K / 128K / 256K / 1M 多档** | 三档以上，是唯一「多级阶梯」厂商，最需要泛化实现 |
| **智谱 GLM** | **32K**（GLM-5/5.1/Turbo）；GLM-4.7 另有 32K–200K 与输出长度子档 | 存在**二维阶梯**（输入档 × 输出档） |
| **MiniMax** | **512K**（M3 系列） | 只有两档，且阶梯与 priority 1.5x 叠加 |
| **字节豆包 Doubao** | **32K / 128K / 256K**（单位千 token） | 多档 + 音频/非音频双输入价 + 输出长度子档 |

**共 7 家**。其中 OpenAI、xAI、Gemini 是「两档 + 全量按高档」的教科书形态；Qwen、GLM、Doubao 是多档形态；MiniMax 是长阈值两档。

### 2. 只有缓存价差、没有长度阶梯的厂商（更适合用 cacheRead / cacheWrite 表达）

| 厂商 | 差异维度 |
|---|---|
| **Anthropic** | 缓存读 0.1x（Fable/Mythos 5.1 为 0.025x）、缓存写 5m 1.25x / 1h 2x；**长度阶梯已于 4.6+ 取消** |
| **Moonshot Kimi** | 缓存写按 TTL 分 5min/1h 绝对价 + 缓存命中价；K3 的 cache write（¥20/¥40）= 与输入同量级 |
| **DeepSeek** | 缓存命中/未命中 + **高峰/空闲时段**（空闲 5 折）；无长度阶梯、无写价 |
| **腾讯混元** | 仅缓存命中价（Hy4 ¥0.3、Hy3 ¥0.25）；无长度阶梯、无写价 |

**共 4 家**。

### 3. 两者都无（统一价）的模型/厂商
- 以上所有厂商的**部分模型**属于此类：OpenAI 的 gpt-5.4-mini/nano、gpt-5.2 及更早线；Qwen 的 qwen3.8-max / qwen3.7-max / qwen3.8-flash / qwen-max（原文标注「无阶梯计价」）；GLM-5.3 / 5.3-Flash / 5.3-FlashX / 5.2；MiniMax M2.x 全系；混元全系自研模型。
- **完全两者皆无的厂商：无**（每家至少有缓存或阶梯中的一种），但**混元自研线是唯二都没有写价、且无阶梯的组合**（只有缓存命中价）。

### 4. 建议：插件应优先支持哪几家、字段怎么填

**优先级（P0 → P2）**

- **P0（必须，规则干净且影响面最大）**：**OpenAI**（272K）、**xAI**（200K）、**Gemini**（200K）。三家都是「单一阈值 + 全量按高档」，可用同一套最简单的 tier 表达覆盖，验收成本最低、覆盖面最大。
- **P1（多档泛化，做完 P0 后立刻做）**：**阿里云 Qwen**（32K/128K/256K/1M，且分地域）、**字节豆包**（32K/128K/256K，注意千 token 单位）、**智谱 GLM**（32K + GLM-4.7 二维）。这三家是多档代表，验证阶梯数组是否可泛化。
- **P2（缓存字段驱动，不需要阶梯位）**：**Anthropic**（cacheWrite 5m/1h 双档）、**Kimi**（cacheWrite TTL 双档、含中国站/国际站双币）、**DeepSeek**（cacheRead + 时段折扣）。这三家用 `cacheRead` / `cacheWrite` 就能完整表达，不要硬塞进阶梯。
- **P3（低优先）**：**MiniMax**（仅 M3 一个 512K 阈值，顺带支持即可）、**腾讯混元**（无阶梯无写价，只需 cacheRead 一个字段）。

**字段建议**

1. `tiers: [{ maxPromptTokens, input, output, cacheRead, cacheWrite }]` —— 用**上界**表达档位（OpenAI 272000、Gemini 200000、xAI 200000、GLM 32000、MiniMax 512000、Doubao 32000/128000/256000、Qwen 32000/128000/256000/1000000），最后一段用 `null` 表示无上界。**落档语义统一为「全量按该档结算」**（上述 7 家官方原文一致），所以不需要分段累计计算。
2. `cacheWrite` 必须支持 **TTL 变体**（Anthropic 1.25x/2x、Kimi ¥20/¥40），建议 `cacheWrite: { ttl5m, ttl1h }` 或 `cacheWriteVariants[]`；不支持写价的厂商（OpenAI 早期模型、DeepSeek、xAI、混元）留 `null` 而非 0。
3. `cacheRead` 建议同时允许表达**倍率**与**绝对价**：Anthropic 官方以倍率给出（0.1x / 0.025x / 1.25x / 2x），Qwen 亦然（125% / 10% / 20%），而 OpenAI/xAI/Gemini/GLM/Doubao/MiniMax 给的是绝对价。若只能选一种，**存绝对价 + 另存 multiplier 备注**，因为计费器要的是绝对值。
4. **额外维度（不能丢）**：
   - `region` / `deploymentScope`：Qwen（北京/新加坡/香港/东京/美国/欧盟 × 全球/国际/中国内地）、Gemini（Global vs Non-global +10%）、Anthropic（inference_geo us = 1.1x）、xAI（US regional 1.1x）、OpenAI（data residency +10%）。
   - `serviceTier`：OpenAI Standard/Batch(50%)/Flex(50%)/Fast(2x)；Gemini Standard/Priority/Batch/Flex；MiniMax priority(1.5x)；豆包 常规/低优/批量。
   - `cacheStoragePerHour`：Gemini（$4.50 或 $0.50/1M token/小时）、GLM（限时免费）、豆包（¥0.017/百万 token/小时）——这是**独立于读写的一次性/时长计费项**，若插件暂无此字段，至少要在备注里标明「本报价未含缓存存储费」。
   - `timeOfDay`：DeepSeek 与豆包（deepseek 系列）的高峰/空闲 5 折。建议用 `offPeakDiscount: 0.5` 而非复制两套价目。
   - `effectiveFrom/effectiveTo`：Gemini 3.7/3.8 Flash（2026-12-31 前促销、2027-01-01 起标准价）、OpenAI gpt-5.6-sol 促销价——**没有生效期字段就会在切换日算错账**。
   - 中国站 / 国际站**双币种**：Kimi、MiniMax、Qwen、GLM 都存在两套独立价目，不要做汇率换算后合并。
5. **落地顺序建议**：先把 OpenAI + xAI + Gemini 三家的两档规则跑通（含「全量按高档」与 cache 同倍率），再用 Qwen/豆包/GLM 验证多档数组与「千 token 单位」「输入×输出二维档」两个坑，最后补 Anthropic/Kimi 的 cacheWrite TTL 与 DeepSeek 的时段折扣。
---

## 复核修正（2026-09-19，阿里云百炼官方定价页实测）

来源：https://help.aliyun.com/zh/model-studio/model-pricing（页面更新时间 2026-09-18 19:05，访问 2026-09-19）
方法：web_fetch 正文 + 浏览器渲染取 innerText 双重取数。

### 1. Qwen：阶梯确实存在，但**不在旗舰 max 的当前版本上**（原报告样本张冠李戴）

官方原文（已被本轮逐字取回）：

> 阶梯计费规则：百炼部分模型实行阶梯计费。单价取决于单次请求的输入 Token 总量。该请求的所有 Token 均按对应阶梯的单价结算。
> 计费区间中的 K 表示 1,000，M 表示 1,000,000。
> 例：0<Token≤32K 与 32K<Token≤128K 两档，输入 100K 落在第二区间，**所有 Token 均按第二档单价结算**。

即：**全量按所在档结算，非分段累计** —— 与 7 家（OpenAI/xAI/Gemini）一致，本项目 `tiers[maxPromptTokens]` 上界语义可直接复用。

各线实测档位（华北2·北京，CNY/百万 Token）：

| 模型 | 档位 | 输入 | 输出 |
|---|---|---|---|
| qwen3.8-max-prime | 0\<Token≤1M（单档） | ¥24 | ¥72 |
| **qwen3.8-max / qwen3.7-max（含 2026-05-20/06-08）** | **0\<Token≤1M（单档，无阶梯）** | ¥12 | ¥36 |
| qwen3.6-max-preview | 0\<Token≤128K / 128K\<Token≤256K | ¥9 / ¥15 | ¥54 / ¥90 |
| **qwen3-max（≡qwen3-max-2026-01-23）** | **0\<32K / 32K\<128K / 128K\<256K** | ¥2.5 / ¥4 / ¥7 | ¥10 / ¥16 / ¥28 |
| qwen3-max-2025-09-23 | 同上三档 | ¥6 / ¥10 / ¥15 | ¥24 / ¥40 / ¥60 |
| qwen-plus（≡2025-12-01） | 0\<128K / 128K\<256K / 256K\<1M | ¥0.8 / ¥2.4 / ¥4.8 | ¥2–8 / ¥20–24 / ¥48–64（非思考/思考） |
| qwen3.7-plus（限时8折） | 0\<256K / 256K\<1M | 原价 ¥2 / ¥6 | 原价 ¥8 / ¥24 |
| qwen3.6-plus | 0\<256K / 256K\<1M | ¥2 / ¥8 | ¥12 / ¥48 |
| qwen3.5-plus | 0\<128K / 128K\<256K / 256K\<1M | ¥0.8 / ¥2 / ¥4 | ¥4.8 / ¥12 / ¥24 |
| qwen3.7-flash | 0\<32K / 32K\<256K / 256K\<1M | ¥0.2 / ¥0.6 / ¥1.2 | ¥0.8 / ¥2.4 / ¥4.8 |
| qwen3.6-flash | 0\<256K / 256K\<1M | ¥1.2 / ¥4.8 | ¥7.2 / ¥28.8 |
| qwen3.5-flash | 0\<128K / 128K\<256K / 256K\<1M | ¥0.2 / ¥0.8 / ¥1.2 | ¥2 / ¥8 / ¥12 |
| qwen-flash | 0\<128K / 128K\<256K / 256K\<1M | ¥0.15 / ¥0.6 / ¥1.2 | ¥1.5 / ¥6 / ¥12 |
| qwen3-coder-plus | 0\<32K / 32K\<128K / 128K\<256K / 256K\<1M | ¥4 / ¥6 / ¥10 / ¥20 | ¥16 / ¥24 / ¥40 / ¥200 |
| qwen3-coder-flash | 同上四档 | ¥1 / ¥1.5 / ¥2.5 / ¥5 | ¥4 / ¥6 / ¥10 / ¥25 |
| qwen3-coder-next | 0\<32K / 32K\<128K / 128K\<256K | ¥1 / ¥1.5 / ¥2.5 | ¥4 / ¥6 / ¥10 |
| qwen3-vl-plus | 0\<32K / 32K\<128K / 128K\<256K | ¥1 / ¥1.5 / ¥3 | ¥10 / ¥15 / ¥30 |
| qwen3-vl-flash | 同上三档 | ¥0.15 / ¥0.3 / ¥0.6 | ¥1.5 / ¥3 / ¥6 |
| qwen-max（≡2026-01-23 旧线） | **无阶梯计价** | ¥2.4 | ¥9.6 |

**修正结论**：原报告以 `qwen3-max` 为旗舰三档样本是对的（该模型名当前仍等价于 `qwen3-max-2026-01-23`，三档）；但**当前旗舰 qwen3.7-max / qwen3.8-max 已是单档 0\<Token≤1M**。做多档泛化验证时应选 `qwen-plus`（128K/256K/1M）或 `qwen3-coder-plus`（32K/128K/256K/1M，四档最完整），而非 max 线。

缓存（官方原文）：显式缓存创建 = 标准输入单价 **125%**；显式命中 = **10%**；隐式命中 = **20%**。Batch = 50%，与缓存不可同时生效。

### 2. GLM：32K 阈值保真，且百炼转售页同样复现

百炼 GLM 区（转售智谱）实测：

| 模型 | 档位 | 输入 | 输出 |
|---|---|---|---|
| glm-5.3 / glm-5.2 | 不区分阶梯（1M） | ¥8 | ¥28 |
| glm-5.2-fast-preview | 不区分阶梯 | ¥16 | ¥56 |
| **glm-5.1** | **0\<32K / 32K\<200K** | ¥6 / ¥8 | ¥24 / ¥28 |
| glm-5 | 0\<32K / 32K\<198K | ¥4 / ¥6 | ¥18 / ¥22 |
| glm-4.7 | 0\<32K / 32K\<166K | ¥3 / ¥4 | ¥14 / ¥16 |
| glm-4.6 | 0\<32K / 32K\<166K | ¥3 / ¥4 | ¥14 / ¥16 |
| glm-4.5 / glm-4.5-air | 0\<32K / 32K\<96K | ¥3 / ¥4、¥0.8 / ¥1.2 | ¥14 / ¥16、¥6 / ¥8 |

与智谱自有页（`docs.bigmodel.cn/cn/guide/start/pricing`）一致：**32K 就是官方阈值**，且 GLM-5.1 的第二档上界是 200K（非无上界）。

保留原判断：32K 对编码场景偏小（系统提示+工具定义+文件上下文常已越档），**实际"拆分会话省钱"的操作空间有限**；且当前主力 GLM-5.3 已取消长度阶梯。

### 3. 本轮新增发现（原报告缺失）

- **字节豆包价格页已有更权威替代**：阿里百炼亦转售 DeepSeek/Kimi/GLM/MiniMax/Qwen，可交叉验证原报告数值；本轮未再依赖火山方舟 SPA。
- **MiMo（小米）有真阶梯**：`xiaomi/mimo-v2.5-pro` 0\<Token≤256K ¥7/¥21 → 256K\<Token≤1M ¥14/¥42（百炼转售）。原报告未覆盖该厂商。
  **落地结论（2026-09-19 决策）：不纳入本功能范围** —— MiMo 相对一线模型只有价格优势、无性能优势，
  严重依赖低价换取智能的场景不构成"按上下文长度优化成本"的真实诉求，纳入只会稀释验证重点。
  若未来其模型能力进入一线梯队，再按同一套 tier 规则收录。
- **DeepSeek 峰谷在百炼侧复现**：deepseek-v4.1-flash 忙时 ¥2/¥8、闲时 ¥1/¥4；deepseek-v4-pro-0813 忙时 ¥9/¥27、闲时 ¥4.5/¥13.5 —— 支持原报告"时段折扣"结论（建议 `offPeakDiscount: 0.5`）。
- **MiniMax M3 512K 阶梯在百炼侧复现**：≤512k ¥4.2/¥16.8，>512k 翻倍（¥8.4/¥33.6 口径按官网）。
- **qwen3.7-flash 存在 32K 小阈值三档**，是"小阈值+多档"的少见样本（0\<32K / 32K\<256K / 256K\<1M），比 GLM 的 32K 更值得做 UI 验证用例。
- qwen3.5-omni 系列、qwen3.8-omni-flash 等**多模态分模态计价**（文本/音频/图片各自单价），属"非 token 长度"的第三类阶梯，本功能不覆盖，需在备注中标注不适用。
