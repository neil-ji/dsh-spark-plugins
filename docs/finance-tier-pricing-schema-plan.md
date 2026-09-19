# 阶梯计价 Schema 变更方案

- 状态：**待裁决**（4 个决策点见 §7）
- 日期：2026-09-19
- 依据：`docs/pricing-research-llm-tiered-pricing.md`（11 家官方定价调研 + 阿里百炼官方页复核）
- 范围：P0（OpenAI 272K / xAI 200K / Gemini 200K）+ P1（Qwen plus 线、qwen3.7-flash）

> 本方案**只做 schema 与语义**，不含阶梯价编辑 UI（见 §7 决策点 4）。

---

## 1. 现状盘点（改动落点）

| 层 | 文件 | 现状 |
|---|---|---|
| 配置 schema | `packages/dsh-finance/src/index.ts:247` | `tiers: z.dict(z.array(z.object({ maxPromptTokens, inputMicrosPerMtok, outputMicrosPerMtok, cacheReadMicrosPerMtok?, cacheWriteMicrosPerMtok? })))` |
| 类型面 | `packages/dsh-finance/src/types.ts:187` | `FinanceTierEntryInput` / `FinanceTierEntry`（同上五字段） |
| 客户端归一化 | `packages/dsh-finance-client/src/client/plans.ts:32` | `normalizeTierMap`（坏档跳过、升序、`0` 排最后） |
| 落档语义 | `derive.ts:348` `tierForBucket` | 找**第一个 `maxPromptTokens >= 当前桶`** 的档 → **已经是「全量按该档」**，与 7 家官方原文一致，**无需改算法** |
| 消费者 | `derive.ts:379` `splitEstimate` | 只算「拆分会话的上限节省」估算，**不进账本成本口径** |
| Spec 落点 | `FINANCE-PRICING-SPEC.md:43` INV-1 | 规定 `tiers` 属**结构维度，只能由 releaseBase 产出**，用户覆盖不得新增/替换结构 |

### ⚠️ 一个必须先裁决的冲突

**实现把 `tiers` 放在 settings（用户手填），但 Spec 的 INV-1 把 `tiers` 定义为 releaseBase 结构维度**。
这不是笔误——Spec §2.1 明确把 `tiers?` 列在 `PriceEra` 里。

两种走法（**决策点 1**，见 §7）：

- **A. 维持 settings**（现状）：改动最小，但与 INV-1 冲突；「用户填的阶梯价」永远只是估算、无法随发版更新
- **B. 迁入 releaseBase**（生成物 `prices.series.json` → `cordis.patch.yml` → host 配置）：合规、可随发版更新官方阶梯价，但需新增一条 host→client 的只读通路（**动 wire**）

---

## 2. 缺口清单

| # | 缺口 | 影响 | 必修 |
|---|---|---|---|
| G1 | 无 `currency` | USD 价（OpenAI/xAI/Gemini）与 CNY 账本混算，数值全错 | ✅ |
| G2 | `cacheRead` 只能绝对价 | Anthropic `0.1x`、Qwen `10%/20%/125%` 需人工换算，易错 | ✅ |
| G3 | `cacheWrite` 无 TTL 变体 | Anthropic 5m=1.25x / 1h=2x、Kimi ¥20/¥40 无法表达 | ✅ |
| G4 | 无 `effectiveFrom/To` | Gemini 3.7/3.8 Flash 在 2027-01-01 切换日算错账 | ✅ |
| G5 | 无 `offPeakDiscount` | DeepSeek 空闲 5 折只能复制两套价目 | 次要 |
| G6 | 无 `region` / `serviceTier` | 多地域、Batch/Fast/Priority 无法区分（当前非目标） | 次要 |

---

## 3. Schema 设计

### 3.1 新形状（全部 optional，向后兼容）

```ts
/** 一个 modelKey 的阶梯价表（可含多套币种/区域变体，各自独立成组） */
export interface FinanceTierSpec {
  /** G1：计价币种。缺省 'CNY'。同组内必须一致。 */
  currency?: string
  /** G2：倍率写法（基于 input 单价），与绝对价字段二选一；绝对价优先 */
  /** G3：cacheWrite TTL 变体（绝对值 micros/Mtok）；未声明 TTL 时取 m5 */
  tiers: FinanceTierEntryInput[]
  /** G5：时段折扣，0<r<1（DeepSeek 空闲 0.5）。缺省 1 = 不打折 */
  offPeakDiscount?: number
  /** G4：生效窗口（epoch ms）。缺省 = 永久 */
  effectiveFrom?: number
  effectiveTo?: number
  /** G6：区域/服务档，仅作标签与去重，不参与计算 */
  region?: string
  serviceTier?: string
}

export interface FinanceTierEntryInput {
  /** 档位上界；0 = 兜底档（无上界），恒排最后 */
  maxPromptTokens: number
  inputMicrosPerMtok: number
  outputMicrosPerMtok: number
  /** 绝对价（优先） */
  cacheReadMicrosPerMtok?: number
  cacheWriteMicrosPerMtok?: number
  /** G2：倍率（次选）。cacheRead 相对 input 的倍率：Anthropic 0.1、Qwen 显式 0.1 / 隐式 0.2 */
  cacheReadMultiplier?: number
  /** G3：写入倍率：Anthropic 5m=1.25 / 1h=2 */
  cacheWriteMultiplier?: number
  /** G3：写入 TTL 绝对价（Kimi 5min=¥20 / 1h=¥40 → micros/Mtok） */
  cacheWriteTtl?: { m5?: number; h1?: number }
}
```

### 3.2 三条解析规则（必须写进 Spec，避免二义）

1. **缓存单价解析顺序**：`cacheReadMicrosPerMtok` > `cacheReadMultiplier × inputMicrosPerMtok` > 缺省继承 `inputMicrosPerMtok`
2. **cacheWrite TTL 选取**：有 `cacheWriteTtl` 时取 `m5`（保守，命中率假设最低）；仅在用户显式声明 TTL 档位时才用 `h1`
3. **落档语义**：**全量按所在档**（7 家官方原文一致）——`tierForBucket` 现状即正确，本次不动；但需补一条单测**锁死该语义**（防止后人误改成「分段累计」）

### 3.3 多币种 / 多区域的表达方式

`tiers` 仍是 `Record<modelKey, ...>`，但 **key 允许带限定后缀**：

```
"openai/gpt-5.6-terra"            → CNY 默认组
"openai/gpt-5.6-terra#USD"        → 美元组
"qwen/qwen3-max#cn-beijing"       → 北京地域
"qwen/qwen3-max#intl"             → 国际站
```

- 解析顺序：先按 `modelKey#suffix` 精确匹配 → 回退 `modelKey`（剥净后缀）匹配 → 都没有则该模型无阶梯价
- **禁止跨币种合并**（Kimi/MiniMax/Qwen/GLM 的中/国际站是两套独立价目，硬换汇会把账算错）
- 账本币种（`ledger.currency`）与档位 `currency` **不一致时，该档不参与估算**，并在 UI 标注「币种不匹配，未计入估算」——这比静默换算安全

---

## 4. 与不变量（INV）的对齐

| INV | 本方案如何满足 |
|---|---|
| INV-1 单一结构源 | **决策点 1 = B 时**：`tiers` 表进 `prices.series.json` 生成物；settings 里的 `tiers` 降级为 legacy overlay，仅当 releaseBase 无该 key 时生效（形状守卫把关，不新增结构） |
| INV-2 形状守卫 | 旧 `FinanceTierEntry[]`（裸数组）与新 `FinanceTierSpec` 形状不符 → 按 legacy 归一化读取，不静默替换 |
| INV-4 追加式历史 | 新增 `effectiveFrom/To` 使阶梯价可追加 era；切换日由 `effectiveTo` 收口，不覆盖旧值 |
| INV-8 生成物幂等 | 若走 B，官方阶梯价由生成器写入 `prices.series.json`，CI 重跑逐字节一致 |

---

## 5. 兼容与迁移

1. **旧数据零破坏**：新旧字段全 optional；`normalizeTierMap` 先判形状——`Array.isArray(v)` → 旧格式（补 `currency='CNY'`）；对象 → 新 `FinanceTierSpec`
2. **客户端**：`FinanceSettingsSection.tiers?: unknown` 不变；`normalizeTierMap` 返回值从 `Record<string, readonly FinanceTierEntry[]>` 升级为 `Record<string, FinanceTierSpec>`，**所有读取点同步**（`SaveMoreView`、`splitEstimate`）
3. **wire**：决策点 1 = A 时**完全不动 wire**；= B 时新增只读端点 `finance/getTierTable`（含 zod schema + 反射声明 + 注册面断言 + `real-host-check`）
4. **版本 bump**：`dsh-finance`（schema）+ `dsh-finance-client`（归一化/消费）；走 B 时另加 `dsh-finance-wire`、`dsh-finance-bundle`

---

## 6. 实施阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| **S1** | schema 扩展（G1–G5）+ `normalizeTierMap` 双形状兼容 + 三条解析规则 | 单测：倍率解析优先级、TTL 选取、币种不匹配跳过、落档语义锁死 |
| **S2** | `splitEstimate` / UI 接入新 spec（币种守卫、`offPeakDiscount` 参与） | 单测 + `preview:verify` |
| **S3** | 「拆分会话」卡的**币种不匹配**提示文案 | 真宿主截图 |
| **S4**（走 B 才做） | 生成器产出官方阶梯价 + host 端点 + 面板读取 | `check:all` + `real-host-check` 注册面断言 |

---

## 7. 待裁决（4 条，决定工程量）

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| **1** | `tiers` 落点 | A 维持 settings / **B 迁 releaseBase** | **先 A 后 B**：S1–S3 用 A 落地（今天就能用），B 作为独立后续任务——否则会被生成器 + wire 的大工程拖住 |
| **2** | 币种策略 | **per-key 后缀（`#USD`）** / `currency` 字段 / 强制统一 CNY | **`currency` 字段 + 后缀 key 双管**：字段表达币种，后缀表达地域/站点变体 |
| **3** | cacheRead 表达 | **绝对价优先 + 倍率兜底** / 只存绝对价 | 双写法（Anthropic/Qwen 官方给倍率，硬换算易错） |
| **4** | 本次是否做阶梯价编辑 UI | 是 / 否（仍手填 YAML） | **否**：先把 schema 与语义做对；编辑 UI 等 B 之后再谈（那时数据来自生成物，用户只需选「我要用哪套」） |

---

## 8. 相关文档

- 调研报告（11 家官方定价 + 复核修正）：[`docs/pricing-research-llm-tiered-pricing.md`](./pricing-research-llm-tiered-pricing.md)
- 价格体系唯一规范源：[`docs/FINANCE-PRICING-SPEC.md`](./FINANCE-PRICING-SPEC.md)（INV-1..9 / §2 数据模型）