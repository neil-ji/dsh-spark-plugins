# 阶梯计价 Schema 变更方案

- 状态：**S1–S4 全部落地（2026-09-19）**；INV-1 偏离已闭合
- 日期：2026-09-19
- 依据：`docs/pricing-research-llm-tiered-pricing.md`（11 家官方定价调研 + 阿里百炼官方页复核）
- 范围：P0（OpenAI 272K / xAI 200K / Gemini 200K）+ P1（Qwen plus 线、qwen3.7-flash）

> 本方案**只做 schema 与语义**，不含阶梯价编辑 UI（见 §7 决策点 4）。
> **解析规则已沉淀进规范源**：`docs/FINANCE-PRICING-SPEC.md` §2.3（七条规则 + 形状 + 边界），
> 实现与本文件冲突时以 Spec 为准。

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

### ⚠️ 一个必须先裁决的冲突（已裁决：走 A，Spec 已记为显式偏离）

**实现把 `tiers` 放在 settings（用户手填），但 Spec 的 INV-1 把 `tiers` 定义为 releaseBase 结构维度**。
这不是笔误——Spec §2.1 明确把 `tiers?` 列在 `PriceEra` 里。

两种走法（**决策点 1**，见 §7）：

- **A. 维持 settings**（原状）：改动最小，但与 INV-1 冲突；「用户填的阶梯价」永远只是估算、无法随发版更新
- **B. 迁入 releaseBase**（生成物 `prices.series.json` → `cordis.patch.yml` → host 配置）：合规、可随发版更新官方阶梯价（草案当时以为必须新增一条 host→client 只读通路；**实测不需要**，见 §6「关键设计判断」）

**裁决（2026-09-19）：先 A 后 B，两步都已完成。** S1–S3 先按 A 落地（settings 形态，
Spec §2.3 记为「已知的、被显式接受的临时偏离」），S4 迁入 releaseBase 后**该偏离已闭合** ——
Spec §2.3 与 INV-1 现在一致。

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

| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| **S1** | schema 扩展（G1–G5）+ `normalizeTierMap` 双形状兼容 + 三条解析规则 | 单测：倍率解析优先级、TTL 选取、币种不匹配跳过、落档语义锁死 | ✅ 已落地 |
| **S2** | `splitEstimate` / UI 接入新 spec（币种守卫、`offPeakDiscount` 参与） | 单测 + `preview:verify` | ✅ 已落地 |
| **S3** | 「拆分会话」卡的**币种不匹配**提示文案 | 真宿主截图 | ✅ 文案已落地（真宿主截图待补） |
| **S4**（走 B） | 生成器产出官方阶梯价 + host 端点 + 面板读取 | `check:all` + `real-host-check` 注册面断言 | ✅ 已落地（**wire 未动**，见下） |

### 落地摘要（2026-09-19）

- **形状**：`settings.finance.tiers` 的值新增 `FinanceTierSpec`（对象）形状，旧的裸数组仍被接受；
  归一化产物统一为 `FinanceTierGroup`（按**剥净后缀**的 modelKey 分桶，一键可挂多组）。
- **类型面**：`dsh-finance/src/types.ts` 新增 `FinanceTierSpec` / `FinanceTierGroup` /
  `FinanceTierCacheWriteTtl`；`FinanceConfig.tiers` 与 `FinanceConfigInput.tiers` 同步换型。
- **宿主编译陷阱**（已踩，勿回退）：`z.union([...])` 的输出类型经 `Config.meta.default`
  推断链会被展宽，必须在 `tierEntryInput` / `tierSpec` / `tierEntryInputs` 三处写显式注解，
  否则 `Schema<FinanceConfigInput>` 整体不兼容（TS2322）。
- **客户端**：`derive.ts` 新增 `resolveCacheReadMicros` / `resolveCacheWriteMicros` /
  `tierGroupFor` / `tierGroupUsability` / `splitEstimateForModel`；`splitEstimate` 增加
  `offPeakDiscount`（两侧同乘，比例不变）与 `discountApplied`。
- **UI**：拆分卡成本列区分四态 —— 有估算 / 无阶梯价 / 币种不匹配 / 生效窗口外；
  错峰折扣在金额旁标注。文案 `contextCurrencyMismatch` / `contextEraMismatch` /
  `contextOffPeakApplied`（zh + en 同步）。
- **wire 未动**（决策点 1 = A）。

### 验收记录

**S1–S3（2026-09-19）**

| 项 | 结果 |
|---|---|
| `pnpm -r build` → `typecheck` → `test`（顺序执行） | 全绿（finance 238、finance-client 75） |
| `pnpm check:all`（架构 / 价格 / 对比度 / token / 版本） | 全 PASS，硬失败 0 |
| `pnpm preview:verify` | **119/119 项通过**（新增：币种不匹配不参与估算、错峰折扣标注） |
| 版本 bump | `dsh-finance` 0.4.13 → 0.4.14、`dsh-finance-client` 0.5.43 → 0.5.44 |

**S4（2026-09-19，迁 releaseBase）**

| 项 | 结果 |
|---|---|
| `pnpm -r build` → `typecheck` → `test`（顺序执行） | 全绿（finance **258**、finance-client **84**） |
| `pnpm check:all` | 全 PASS；价格闸门新增 **A6**（阶梯价结构 + 生成段覆盖 + `config.tiers` 解析断言） |
| `pnpm preview:verify` | **120/120**（新增：releaseBase 的阶梯价不被误报为被用户覆盖） |
| `node dev-harness/real-host-check.mjs` | **61/62**，typert 注册面 11 条 finance 端点全 strict（退出码 0） |
| 版本 bump | `dsh-finance` 0.4.15、`dsh-finance-client` 0.5.45、`dsh-finance-bundle` 0.2.2 |

### S4 的两处关键设计判断（与方案草案不同）

1. **wire 未动 —— 原方案 §5.3 预估的「host 只读端点」不需要了。**
   实测确认：宿主 `settings.installSection(ctx, ns, Config, config)` 把 `cordis.patch.yml`
   的 config 注册为 settings 的 **composition `base` 层**，而客户端 `settingsScope` 快照本就
   同时暴露 `base` / `user` / `value` 三层。`tiers` 又从不进账本（只被面板消费），
   于是 releaseBase 的阶梯价**经既有 settings 通路直达面板**，新增 Remote 端点纯属多余。
   省掉一条 wire 契约、一个 endpoint 与一份 zod schema。
2. **客户端必须读原始的 `user` 层，不能读 `value`。** `value` 已经折了 base，
   拿它当"用户层"会把 releaseBase 的每个 key 都误判成"被用户覆盖"，
   面板于是对每个模型都报「已被发行版官方表取代」。已单测锁死这一条。

### 生成器覆盖范围（诚实记录）

`scripts/gen-finance-tiers.mjs` 目前只覆盖**页面可机器解析**的两家：
**OpenAI**（272K，Standard 段 `Short/Long context` 列）与 **xAI**（200K，转置表）。
Gemini 的 `.md` 实际返回 404 SPA 壳（实测），**按 SPEC §3.4「不猜、不补」不予产出**；
Qwen / GLM / 豆包 / MiniMax（P1）同理待各自源可解析后再扩。

### 踩到的生成物陷阱（已进闸门）

生成段的缩进必须与 `prices:` **同级（8 空格）**。首版写成 10 空格时，`tiers:` 缩进成
`prices` 的子键并被 YAML **静默吞掉** —— 文本里 marker 齐全、生成器报"写好了"，
而 `config` 里根本没有 `tiers`。价格闸门 A6 因此改为**解析后断言 `config.tiers` 非空**，
不再只看文本 marker（另修：YAML 解析失败要记成失败项，而不是抛异常崩掉整个闸门）。

### 与 §3.1 草案的差异（实现时按 Spec 收敛）

1. **生效窗口类型**：草案写 `number`，实现按输入面需要放宽为 `string | number`
   （与既有 `plans.effectiveFrom` 同口径，接受可 `Date.parse` 的日期串）。
2. **键的组织方式**：草案说"key 允许带后缀"，实现进一步把后缀**拆出来**做精确匹配 +
   剥后缀回退（Spec 规则 3），而不是把整串当一个 key。
3. **`offPeakDiscount` 的作用位置**：草案未定义，实现定为"观测值与压缩值两侧同乘"
   （Spec 规则 6）——桶数据无小时维度，只能整体缩放，比例不变。这是保守选择，需评审确认。
4. **生成物币种**：源页面多为 USD，产物折成记账币种（CNY）并在生成段头标注 `fx=` / `currency=`。
   照抄 USD 会让整张官方表被币种守卫静默排除（Spec 规则 8）。

---

## 7. 决策裁决结果（2026-09-19）

| # | 决策 | 裁决 | 落地情况 |
|---|---|---|---|
| **1** | `tiers` 落点 | **B 迁 releaseBase**（S4 已完成） | ✅ 已闭合：生成器写 `cordis.patch.yml` 的 `config.tiers`；settings 降级为 legacy overlay；wire 未动（见上「关键设计判断」） |
| **2** | 币种策略 | **`currency` 字段 + 后缀 key 双管**（字段表达币种，后缀表达地域/站点变体） | ✅ 已落地（规则 3 + 规则 5） |
| **3** | cacheRead 表达 | **绝对价优先 + 倍率兜底**（Anthropic/Qwen 官方给倍率） | ✅ 已落地（规则 1，另加 cacheWrite 倍率与 TTL，规则 2） |
| **4** | 本次是否做阶梯价编辑 UI | **否** —— 先做对 schema 与语义；编辑 UI 等 B 之后（那时数据来自生成物，用户只需选「用哪套」） | ✅ 未做（仍手填 YAML/settings） |

---

## 8. 相关文档

- 调研报告（11 家官方定价 + 复核修正）：[`docs/pricing-research-llm-tiered-pricing.md`](./pricing-research-llm-tiered-pricing.md)
- 价格体系唯一规范源：[`docs/FINANCE-PRICING-SPEC.md`](./FINANCE-PRICING-SPEC.md)（INV-1..9 / §2 数据模型 / **§2.3 阶梯价七条解析规则**）