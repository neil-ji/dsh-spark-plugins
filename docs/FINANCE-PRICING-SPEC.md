# 财务价格体系 · Spec（规范）

> 状态：**§1–§9 已定案（2026-09-16），实现未开始；§10 额度触达检测已定案（2026-09-19），
> 实现未开始**。本文是该领域的**唯一规范源**——
> 任何实现、评审、闸门脚本与本文件冲突时，以本文件为准；要改规范，先改本文件
> （commit 用 `docs(finance):` 或 `feat(finance)!:` 并在 body 写明迁移路径）。

## 0. 背景与适用范围

### 0.1 为什么有这份 Spec

2026-09-16 用官方账单（`usage_data_2026-08-18_2026-09-16.zip`）复核插件成本，发现**虚高 10~16 倍**：

| 项 | 值 |
|---|---|
| 官方账单合计（22 行「日期×模型」） | **¥179.56** |
| 插件按当时价格规则的算法 | **¥1187.38**（×6.6） |
| 直接根因 | `prices` 缺 `deepseek-official/deepseek-flash` → 未命中 → 无 `providerDefaults` → 回落 2025 年 `defaultPrice`（缓存读 0.5 vs 真实 0.02，**25×**；缓存命中占 token 量 ~98%） |
| 反证（算法无误） | 有价格条目的 `deepseek-v4-flash`，逐日与账单**吻合到分**（×1.00） |
| 同源缺口 | `deepseek-v4.1-flash-expires-on-0910`（09-08）同样无条目 → ×5.3 |

**深层根因**：手抄的价格覆盖层本身就是病因 —— models.dev 当天（2026-09-10）就收录了
`deepseek-flash`，而仓库里手抄的 DeepSeek 价格表漏了它，且缺失表现为**静默兜底**而非报错。

**结论（本 Spec 的立场）**：手抄的价格覆盖层等同 CSS 的 `!important` —— 特例覆盖腐蚀秩序、
长期不可维护。**取消手抄精确层**：基础数据采信社区/厂商源，由**生成器**产出；
我们只维护**规则层**。

### 0.2 与其它文档的关系

- **取代** `docs/finance-price-sync.md` 中关于"层级解析顺序 / defaultPrice 兜底 / community 层落点与持久化 /
  用户手填 userPrices"的全部描述（该文档的三层图与"runtime 是日常自维护、CLI 是固化一份"的划分不再成立）。
  该文档里仍然有效的部分：`@Remote` 方法清单、`FinanceSyncState`、自动同步与三态徽标、失败不污染层。
- **服从** `docs/plans/2026-09-14-finance-rebuild-design.md` 的产品原则（只呈现"你的实体"、编辑入口贴数据旁、
  缺价格打「估」角标、峰谷/阶梯可省卡片）。本 Spec 与它唯一需要协调的点见 §5.3。
- **服从** `AGENTS.md` 的全部工程铁律（改 src 必 bump、验收链顺序执行、闸门进脚本而非文档）。

---

## 1. 不变量（INV）——实现与评审按此逐条对照

| 编号 | 不变量 | 违反后果 |
|---|---|---|
| **INV-1 单一结构源** | era 列表、`peakHours`/`peakDays`、`tiers`、cache 档这些**结构维度只能由基础表（releaseBase）产出**。任何用户侧覆盖不得新增或替换结构。 | 用户一次"更新"即抹掉峰谷与纪元，历史重算全错 |
| **INV-2 形状守卫** | overlay 键与 base 键形状不兼容（`flat` vs `windowed`，或缺结构字段）→ **拒绝该键 + 记诊断**，绝不静默替换。 | 静默降级，且方向必然朝错 |
| **INV-3 兜底必须可解释** | 每个价格都必须能回答"来自哪、什么时候、是不是估算"。缺失 → 上游社区值 + 「估」角标，或「未收录」（不显示金额）。**禁止使用无来源的 legacy 常量。** | 本次 10~16 倍虚高的直接机制 |
| **INV-4 追加式历史** | 价格变更 = **追加 era**，不覆盖。`effectiveFrom`（生效日，以证据为准）与 `observedAt`（首次观察日）分列。 | 单一快照 + 重新计价 = 静默改写历史（见 §4.1 实证） |
| **INV-5 完整性** | 基础表随产物携带哈希，加载时校验；不匹配 → UI 明示"基础表已被本地修改" + 可一键回落。 | "不能让用户轻易改动"只是口号 |
| **INV-6 可还原** | 所有用户侧覆盖可一键丢弃回到基础表；「还原到发版快照」与「重新拉取最新」是**两个**动作。 | 覆盖腐化成隐蔽的 !important |
| **INV-7 失败原子性** | 拉取失败 / 哈希不符 / schemaVersion 不认识 → **保留上一份 + 明确报错**（不静默换、不静默留）。 | 用户以为更新了，实际是旧值 |
| **INV-8 生成物幂等** | CI 里重跑生成器必须得到**逐字节相同**的产物。 | 生成器退化成另一种手抄 |
| **INV-9 余额来源优先级** | 每个厂商的余额呈现必须能回答来源：自动获取成功值 > 手动填写 > 「—」；自动获取开启且支持时忽略手动值。手动值不进账本成本口径。 | 手填值静默覆盖真实余额，对账错乱 |
| **INV-10 额度与成本正交** | 额度触达（§10）是**容量事实**，成本是**金额事实**：`quota` 数据**不得**进入 `totalCostMicros` / `byModel` / `byProvider` / `peakValley` 任一金额口径，也不得静默改写 `plans[].quotaTokens`（用户字段，只可由用户显式采纳）。 | 触达次数被算成钱、"额度"冒充成本，两个账互相污染 |

---

## 2. 数据模型

### 2.1 价格条目（era 序列）

沿用现有 `FinancePriceEntry`（`pricing.ts`）并**扩展 meta**：

```ts
type PriceEra = {
  effectiveFrom: number          // epoch ms；生效日（优先厂商声明/账单证据）
  observedAt?: number            // epoch ms；我们首次观察到该值的日期
  src?: string                   // 来源 URL（必填于生成物）
  confidence?: 'verified' | 'observed' | 'inferred'
  kind: 'flat' | 'windowed'
  rate: FinancePriceRate         // flat 用 { input, cacheRead, cacheWrite, output } micros/Mtok
                                 // windowed 用 { offPeak, peak, peakHours, peakDays, utcOffsetMinutes }
  tiers?: FinanceTierEntry[]     // 按单次请求输入 token 档；0 = 兜底档（现有语义）
}
```

### 2.3 阶梯价解析规则（2026-09-19 增补；S4 已把 `tiers` 迁入 releaseBase）

**落点（INV-1 已闭合）**：`tiers` 与 `prices` 同属**结构维度**，主源是 **releaseBase** ——
生成器 `scripts/gen-finance-tiers.mjs` 把厂商阶梯价写进 `packages/dsh-finance-bundle/`
的 `cordis.patch.yml`（`config.tiers`，随发版冻结）。

settings 里的 `tiers` 降级为 **legacy overlay**：**只在 releaseBase 没有该 modelKey 时生效**。
被 releaseBase 取代的手填键必须能报出来（面板「已被发行版官方表取代」文案），
不允许静默忽略用户输入。宿主侧分层在 `FinanceService.getTierLayers()`；
客户端侧在 `createPlanSeam` 读 settings scope 的 **`base` / `user` 两层**（不是已解析的
`value` —— 后者折了 base，会把官方表的每个 key 误判成"被用户覆盖"）。

> 历史：S1–S3 期间 `tiers` 曾临时落在 settings，作为对 INV-1 的显式接受偏离；S4 落地后偏离闭合。

**形状（两种并存，向后兼容）**：值可以是旧的裸数组（隐式 `CNY`、无折扣、无生效窗口），
也可以是新对象：

```ts
type FinanceTierSpec = {
  currency?: string            // 缺省 'CNY'
  tiers: FinanceTierEntryInput[]
  offPeakDiscount?: number     // 0 < r <= 1；缺省 1
  effectiveFrom?: number       // epoch ms 或可 Date.parse 的字符串；缺省 = 无下界
  effectiveTo?: number
  region?: string              // 仅标签
  serviceTier?: string         // 仅标签
}
```

**key 后缀**：`modelKey#suffix`（如 `openai/gpt-5.6#USD`）按**最后一个** `#` 切分，
只用于**配置侧**区分币种变体。禁止跨币种合并或硬换汇。

> ⚠️ **区域支持范围（2026-09-19 定案）：只支持中国内地价目，不区分国际/国内。**
>
> 原因：运行期只有 `modelKey = provider/model`（取自会话日志 `request/header`），
> **拿不到"在用哪条线路"的信号** —— 区域体现在 `baseURL` 里，既不进 modelKey，
> 也没有独立的 provider id（`dashscope` / `zai` 是用户自定义名，`minimax-cn` 的 `-cn`
> 只是命名习惯）。因此 `#suffix` 的"精确匹配"分支在运行期**永远走不到**。
>
> 由此产生的硬约束：**同一 modelKey 下存在多组时一律拒绝估算**（消费者报 `ambiguous`
> 并提示"暂只支持中国内地价目"），**不得**按写入顺序取第一组 —— 那等于让 settings 的
> 书写顺序决定用哪套价，界面上看不出任何异常。生成器也只产出中国内地价目。
>
> 未来若要支持：需在账本层拿到线路标识（`request/header` 是否暴露 baseURL/endpoint 待查证），
> 或为不同区域配不同 provider id。**已删除** `region` / `serviceTier` 字段 —— 它们只被搬运、
> 无任何消费者，留着会让人误以为能区分区域。

**七条解析规则**（实现与评审按此逐条对照）：

1. **缓存读单价**：`cacheReadMicrosPerMtok` > `cacheReadMultiplier × inputMicrosPerMtok` > 继承 `inputMicrosPerMtok`
2. **缓存写单价**：`cacheWriteMicrosPerMtok` > `cacheWriteMultiplier × inputMicrosPerMtok` > `cacheWriteTtl.m5` > 继承 `inputMicrosPerMtok`。
   只取 `m5`（保守，命中率假设最低）；`h1` 仅在用户显式声明 TTL 档位时才用，当前不参与解析
3. **选组**：`modelKey#suffix` 精确匹配 → 剥净后缀回退 `modelKey` → 都没有则该模型无阶梯价。
   **命中多个变体组时报 `ambiguous` 并拒绝估算**（见上面的区域支持范围）——不许静默取第一组
4. **形状分流**：值为数组 = 旧形状；值为对象 = 新形状。新形状缺 `tiers` 或档位全不可信 → **整组丢弃**（不猜），旧形状同理
5. **币种 / 生效窗口守卫**：组 `currency` 与账本 `ledger.currency` 不一致 → **不换算、不参与估算**，UI 标注「币种不匹配，未计入估算」；
   `effectiveFrom/To` 不覆盖当前时刻 → 同样不参与估算并标注。宁可不算，不可算错
6. **错峰折扣**：`offPeakDiscount` 作用于该组的估算金额。桶数据无小时维度，故对观测值与压缩值**两侧同乘**该系数——
   绝对省额随之缩放（5 折线路省一半），**比例不变**。这是刻意的保守选择
7. **落档语义**：**全量按所在档**（不是分段累计）——7 家官方原文一致（OpenAI / xAI / Gemini / Qwen / GLM / MiniMax / 豆包）。
   `tierForBucket` 是这条语义的唯一实现，**已有单测锁死**；改成「分段累计」前先改本 Spec
8. **生成物币种**：生成器把厂商报价**折算成记账币种**再写进产物（沿用 prices 管道的 `--fx` 口径），
   而非照抄源页面币种 —— 否则整张表会被规则 5 静默排除，表现为"官方表生成了但面板一个数都不给"。
   折算是**显式标注**的（生成段头 `fx=` / `currency=`），与"静默硬换汇"不同：后者禁止，前者是产物契约。
   **源页面本身就是记账币种时 fx 必须为 1**（GLM / Qwen 的页面单位就是"元/百万 Tokens"，
   再乘 fx 会虚高 7.2 倍）—— 生成器按 per-source `sourceCurrency` 判定。
9. **档位表的形状约束**（阶梯价生成物专用，闸门 A6 逐项断言）：
   - 档位上界**严格升序**；兜底档（`maxPromptTokens = 0`）**必须在最后**；
   - 价格**逐档递增**（官方阶梯都是越长越贵；读错列会立刻暴露）；
   - 厂商最高档是**有界**的（Qwen `128K<Token≤256K`）时，生成器把最高档**改写为兜底档** ——
     语义等价（落档即全量按该档），但让"超出最高档"有明确的价可落；
   - 只给缓存**倍率**的厂商（Qwen 命中 10%/20%）落 `cacheReadMultiplier`（取更贵的 0.20，保守）；
     倍率必须在 YAML↔序列↔面板整条链上活着，漏渲染会让缓存读静默退化成输入价（虚高 5 倍）。
10. **不可达源保留既有 key**（INV-7 在阶梯价上的延伸）：某家源不可达时，该 provider 的
    既有条目**原样保留**，绝不因一次网络抖动从产物里消失（源可达却不再产出该 key = 上游删除，才移除）。

**边界**：阶梯价只服务面板的「拆分会话能省多少」估算，**不进入账本成本口径**
（账本仍走 `prices` / `providerDefaults` / `defaultPrice`）。

**窗口语法扩展（必须实现）**：`peakHours: [[start, end]]` 中 **`start > end` 表示跨零点区间**
（如阿里错峰 22:00–08:00，表达为 peak=[[8,22]] 或保留原义由生成器归一）。
现有 `isPeakLocalHour` 只支持 `start <= h < end`，**必须补跨零点分支 + 单测**。

**单位**：一律 integer micros per unit，本轮 `unit = 'per_mtok'`。
（`per_image / per_audio_second / per_query / per_gb_day` 属非目标，见 §9，但字段留位。）

### 2.2 数据产物与落点

**落点由包角色决定**（2026-09-16 实现时校正）：架构闸门规定 `ALLOWED_EDGES.host = ['wire','plugin-kit']`，
**host 包不能 import bundle**，且 `dsh-finance-bundle` 是纯数据包（只有 `cordis.patch.yml` + `package.json`，无构建）。
因此产物分两处：

```
packages/dsh-finance-bundle/prices.series.json      // 生成物：追加式序列 + 来源元数据 + hash（维护者输入，不进 files）
packages/dsh-finance-bundle/cordis.patch.yml        // 由 ① 生成 prices 段（发版随包，host 经配置读入 = releaseBase）
packages/dsh-finance/src/pricing-hash.generated.ts  // 生成物：期望哈希常量（普通 src，享受 bump 纪律）
```

- **哈希锚点必须在 host 代码里**：config 里同时带数据与哈希是可被一起改写的，常量在 lib 里才构成真正的篡改检测（INV-5）。
- **指纹函数唯一**：`financePricesFingerprint()`（`pricing.ts`）只覆盖**结构与数值**、丢掉 `meta`（来源/observedAt）
  并排序键序；生成器与 host 侧校验**必须调用同一个函数**，否则 YAML 往返一趟（键序变化/meta 丢失）就假报警。
  哈希 = `sha256(financePricesFingerprint(prices))`，且只覆盖**生成器负责的 provider 段**（`BASE_PRICE_PROVIDERS = ['deepseek-official']`）；
  社区块由同步脚本另行负责，不参与该指纹。
- host 侧入口：`FinanceService.getBasePriceIntegrity() → { ok, expected, actual, source, updated }`。
- `frozen` 语义：`cordis.patch.yml` 的 prices 段整段由生成器写出，文件内标注 `generated by scripts/gen-finance-prices.mjs` + 来源 + 时间；禁止手改。

产物顶层：

```ts
{
  schemaVersion: 1,              // 主版本不认识即拒绝加载
  generatedAt: string,           // ISO
  currency: 'CNY',
  hash: string,                  // 对 prices 段规范化 JSON 的 sha256
  sources: { id: string, url: string, fetchedAt: string }[],
  prices: Record<string /* provider/model */, PriceEra[]>,
}
```

**落点变更**：基础表从 `cordis.patch.yml` 的 markers 之间**迁出**到上述生成产物，
配置文件只保留"可覆盖空壳"与用户侧入口。`scripts/sync-finance-prices.mjs`
从"splice YAML"改造为"调用同一个生成器"。

### 2.3 三层与合并算法

```
userOverlay  （用户侧：一键拉取 / 逐行编辑；落盘独立缓存；可整份删除 = 还原）
  > releaseBase  （发版冻结的生成产物；唯一结构源；哈希保护）
    > builtinFallback （编译进 lib 的最后兜底；使用时必须打「估」并把来源标注为"内置兜底"）
```

合并规则（**替换现有 `mergePriceLayers` 的 `Object.assign` 整键替换**）：

```
for key of union(base, overlay):
  if key not in base:                       → 允许 overlay 新增（仅当形状自洽且有 src）// INV-1 例外需评审
  else if !sameShape(base[key], overlay[key])→ 拒绝 + 诊断（INV-2）
  else                                       → 逐 era 合并：overlay 只可"同 effectiveFrom 更新数值"或"追加更新的 era"，
                                               不得删除 base 的 era、不得改写结构字段
```

同一 key 的最终 era 序列 = base 的 era ∪ overlay 追加的 era，按 `effectiveFrom` 升序。
**用户编辑与一键更新共用同一层**（见 §5.2），因此 `userPrices`（settings descriptor 持久层）
必须**收编**进 overlay 或改为只读展示 —— 现在它是持久、静默、无还原入口的真 `!important`。

---

## 3. 生成器 Spec

### 3.1 输入与优先级

| 源 | 用途 | 关键约束 |
|---|---|---|
| 厂商定价页（DeepSeek 先行） | **一手**：当前档位价 + 峰谷窗口（脚注） | **URL 必须带尾斜杠**（`.../pricing/`）：不带斜杠会被 CDN 坏缓存返回**完全不同的文档**，且随 TTL 间歇复现 |
| ai-price-index | 历史纪元回填（`from`/`to`/`src`/`confidence`） | 只记谷时；USD；CC BY 4.0 需署名 |
| llm-prices.com | 交叉校验（`from_date`/`to_date`） | DeepSeek 覆盖薄 |
| models.dev | 非 DeepSeek 长尾兜底 | **无峰谷、无历史**；调价静默滞后（实证：其 `deepseek-v4-pro` 至今仍是 08-16 前旧价） |
| LiteLLM | 服务等级/区域/按次工具维度的**规则校验** | 无时段维度 |

### 3.2 追加式语义（核心）

生成器**不产出快照**，而是对已提交的产物做 **diff → append**：

1. 解析源 → 得到"当前档位价 + 窗口"；
2. 与产物中该 key 的**最后一个 era** 比较；
3. 不同 → **追加**新 era：`effectiveFrom` 取**证据日期**（厂商声明 > 账单证据 > 首次观察日），
   `observedAt` 取本次运行日期，`confidence` 相应标注；
4. 相同 → 只刷新 `observedAt`/来源元数据，不新增 era；
5. **禁止**修改或删除既有 era（除一次性 seed，见 §8.2）。

### 3.3 输出与幂等

- 输出见 §2.2；**CI 中重跑必须逐字节一致**（INV-8）。
- 解析器与归一化逻辑必须是**纯函数**（可测、无网络），网络只在薄壳里。

### 3.4 明确不做

不猜、不补、不手写；来源不可达时**不产出**该部分（并在产物 `sources` 里标 `error`），
绝不回落到"上一次的值"假装成功（INV-7）。

---

## 4. 消费者 Spec（host）

### 4.1 为什么必须带纪元（实证）

| 日期 | 账单实测单价（CNY/Mtok，miss/hit/out） |
|---|---|
| 2026-08-19 | 1.5 / 0.05 / 4.5（v4-flash 峰谷档） |
| 2026-09-12 | 1 / 0.02 / 4（Flash 价） |

单一快照**无法同时还原**这两笔 → 载荷必须是带日期序列，重新计价才正确。

### 4.2 消费侧改造

- `FinanceService.setOverlayPrices()`：写入时**预合成一次** merged 结果并缓存；
  `currentConfig()` 读缓存（现在它每次调用都 `Object.assign`，见 `index.ts:394`）。
- `mergePriceLayers` → 改名/改语义为形状守卫合并（§2.3），保留纯函数并补单测。
- **未命中语义**：该 key 无任何可用价格 →
  ① 若仅上游客源值可用 → 用它 + 「估」角标（INV-3，与产品设计的"兜底价 + 估角标"对齐）；
  ② 连估算值都没有 → 「未收录」，**不显示金额**，账户汇总里排除并单列提示。
  `DEFAULT_PRICE` 退化为最后兜底，使用时必须打「估」+ 标注来源=内置兜底。
- overlay 落盘：`<DSH_HOME>/storages/finance/prices-overlay.v1.json`
  （与包内基础表物理分离；整文件删除 = 还原）。

### 4.3 overlay 文件契约

```json
{
  "schemaVersion": 1,
  "fetchedAt": "2026-09-16T…",
  "entries": [
    { "key": "deepseek-official/deepseek-flash", "src": "…", "observedAt": 0, "patch": { } }
  ]
}
```

- `schemaVersion` 主版本不认识 → 拒绝加载并提示升级插件（INV-7）。
- `patch` 只允许数值字段；形状字段出现即判为不兼容（INV-2）。

---

## 5. UI Spec

### 5.1 同步区（改造 `PriceSyncSection`）

必须显示：**基础快照日期与来源**、**overlay 日期与来源**、**覆盖键数**，以及两个按钮：

| 按钮 | 语义 | 失败行为 |
|---|---|---|
| 更新价格表（重新拉取最新） | 拉取 → 校验 schemaVersion/hash → 形状守卫 → 原子替换 overlay | 保留上一份 + 明确报错（INV-7） |
| 还原到发版快照 | 删除 overlay（或清空用户侧覆盖） → 回到 releaseBase | 不可失败 |

三态徽标（never / last / failed）与自动同步沿用现有实现（`locales.ts` 已有
`priceNote / priceNoteNever / priceStale`）。

### 5.2 覆盖项可见列表

列出被覆盖的键：**键 / 旧值 / 新值 / 来源 / 时间**。逐行编辑（产品设计的"编辑入口贴数据旁"抽屉）
与一键更新**写入同一层** → 同一份列表、同一个还原按钮。这消除了现有 `userPrices` 的隐蔽性。

### 5.3 与产品设计的唯一协调点

产品设计写的是"缺价格 → 用兜底价并在该行打「估」角标"。本 Spec 细化：

- **兜底 = 上游客源值**（有来源、有日期），打「估」；
- **不是** 无来源的 `DEFAULT_PRICE` 常量；该常量仅作最后兜底且同样必须打「估」并标注来源。
- 汇总数字若包含估算项，必须能与"纯实测项"分开呈现（避免把估算当实账）。

### 5.4 两池分类（本月页）与手动余额（2026-09 定案；2026-09-19 修订：待选池退役）

**背景**：计费方式打标入口曾只挂在「按量付费」卡且被 `supportsBalanceFetch` 白名单过滤，
无余额接口的厂商永远无法被打成订阅 → 订阅计划卡成为死表。初版解法引入第三个「待定池」
抽屉；2026-09-19 复盘裁决：待定池只是把分类成本转嫁给用户，**退役**——每行的计费方式与
附属操作收敛进 Action 列的「…」下拉菜单（UI-UX-SPEC §3.5），本月页只剩**两张表**。

**两池规则**（按 provider 生效计费方式折叠后归类，优先级：显式标记 > 已有月费条目 > 宿主默认；
未打标且无宿主元数据的厂商按宿主默认（无则 `metered`）直接落入对应池，不再单独成池）：

| 池 | 成员 | 列 / 操作 |
|---|---|---|
| 订阅计划 | billingMode = plan，或 free（2026-09-19 二次修订：免费收归本卡，**强制月费 0**） | 厂商名、月费、**按量等价节省**（按量等价 − 月费，> 0 加「超值」tag）；Action 列「…」菜单：改标记 / 填·编辑月费 / 移除套餐（free 行只留改标记） |
| 按量付费 | billingMode = metered（free 不进本池） | 厂商名、余额、本月支出；Action 列「…」菜单：改标记 / 手动余额（INV-9） |

**手动余额（INV-9）**：`FinanceProviderEntry.manualBalanceMicros`（integer micros，≥0）。
余额解析优先级：**自动获取成功值 > 手动填写 > 「—」**；`autoFetchBalance = true` 且厂商支持时忽略手动值。
厂商不支持自动获取（现仅 deepseek-official）→ UI 的 autoFetch 勾选 disable + 悬浮提示「暂不支持该厂商自动获取余额」。
手动余额是**余额事实的替代呈现**，不进账本成本口径、不参与 INV-3 来源链（它本来就是用户自报），
但 UI 必须与自动获取值可区分（悬浮 / 角标）。

**免费（free）**：「…」菜单里的第三个标记选项（2026-09-19 二次修订）。free 收归**订阅计划卡**呈现：
月费列强制显示 0（不读 plans 条目、不提供月费编辑/移除入口，改标即可离开），节省列显示「—」
（按量等价对 0 月费无比较意义）。free 厂商不产生余额视图、不进按量池。

---

## 6. 规则层 Spec（我们负责的部分）

社区源零覆盖、只能由我们维护的规则（**规则不是数据**，不随模型数量膨胀）：

1. **别名映射**：`deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 已退役，请求由 V4.1-Flash 承接、
   按 Flash 价计费 → 映射到 Flash 条目（并从 2026-09-10 起追加纪元，保留更早纪元做历史）。
2. **峰时 = 2 × 谷时**（厂商书面规则）；谷/峰两档都必须落库，不得只存一档。
3. **峰谷窗口**：DeepSeek = UTC 01:00–04:00 & 06:00–10:00 周一至周五（= 北京 09–12 / 14–18）；
   自 2026-08-23 起周末全天谷时。窗口是 **per-entry** 的，**不得**依赖全局默认（阿里峰 08–22、
   智谱峰 14–18 工作日，各不相同）。
4. **fx**：仅用于非 DeepSeek 的 USD 源。**DeepSeek 不走 fx**（厂商 CNY 表 ≠ USD × 7.2：
   隐含汇率 flash 6.667 / pro 6.818，直接乘 7.2 会差 ~8%）。
5. **服务等级倍数**（batch 0.5 / flex 0.5 / priority 1.8–2×）：本轮仅登记规则，不参与计算（§9）。

---

## 7. 验收与防线（缺一不可）

| 编号 | 断言 | 落点 |
|---|---|---|
| **A1** | 账单回归：fixture = 本 Spec 附录 B；修复后逐日 Δ=0（精确档位源） | `packages/dsh-finance/tests/` |
| **A2** | **内置模型目录 ⊆ 可定价集合**（llm-deepseek 的每个 model id 都能命中 base 或明确标记「估」）——这条若早存在，本次 bug 不会发生 | 闸门脚本 |
| **A3** | ×2 交叉校验：LiteLLM 的峰时值 ≈ 我们按规则推的峰时值 | 闸门/测试 |
| **A4** | 生成器幂等（重跑逐字节一致）；生成物必须能被 yaml 解析 | CI |
| **A4b** | 仓库数据 ↔ lib 内哈希常量一致 + 改一个数值即指纹变化（`tests/price-integrity.test.ts`） | 包内测试 |
| **A5** | 漂移检测：每日 diff 上游；滞后/不可达 → **红**（断更必须表现为红） | CI 定时任务 |
| **A6** | 形状守卫单测：flat overlay 打 windowed base → 拒绝 + 诊断 | 单测 |
| **A7** | 还原语义单测：删除 overlay 后，账本与基线条目逐字节一致 | 单测 |
| **A8** | 跨零点窗口单测：`[[8,22]]` 与 `[[22,8]]` 归一后行为一致 | 单测 |

工程链：改 src → **bump 版本** → `pnpm -r build` → `typecheck` → `test` → `pnpm check:all` →（动 host/注册面时）`pnpm sandbox:install` + 重启 + `node dev-harness/real-host-check.mjs`。

---

## 8. 实施顺序与迁移

### 8.1 顺序（生成器先行）

| # | 内容 | 产出 |
|---|---|---|
| ① | 生成器（DeepSeek 先行）：厂商页 → 追加式序列 → §2.2 产物 | 产物 diff；`deepseek-flash` 与别名纪元**自动补齐**（禁止手写） |
| ② | 一次性 seed：从带日期外部源迁移历史纪元（见 §8.2） | 历史基线 |
| ③ | 消费端：预合成 + 形状守卫（§2.3 / §4.2） | 合并语义 |
| ④ | UI：更新/还原 + 覆盖列表 + 快照日期来源（§5） | 用户入口 |
| ⑤ | 完整性：哈希校验（INV-5） | 防篡改 |
| ⑥ | CI 四条：A1/A2/A3/A4（+A5 定时） | 防线 |

**禁止的捷径**：为了"立即止血"而手补一行价格数据 —— 那正是本 Spec 要消灭的模式（用户 2026-09-16 明确否决）。
缺条目必须由 ① 产出。

### 8.2 一次性 seed

厂商页只给"当前"，**过去的切点只能迁移一次**：来源限带日期的外部源
（ai-price-index 的 08-16 / 09-10 切点 + 账单逐日实收价校正）。seed 必须：

- 只允许从带 `src` 的源迁入；
- 逐条标注 `effectiveFrom` 与 `observedAt` 的区别；
- 由 A1 账单回归验证（对不上就不许合入）。

### 8.3 迁移与发布影响

- `cordis.patch.yml` 中现有的 ~460 行社区价格块**退役**；DeepSeek 手抄条目**删除**。
- `scripts/sync-finance-prices.mjs` 改为调用生成器（不再 splice YAML）。
- 数据在代码产物里 → 每次调价 = 一次 bump + 发版（用户已确认接受该节奏；
  历史计价靠追加 era 保证正确）。
- fixture 入库前**必须脱敏**（账单含 `user_id` 与 api_key 掩码，需替换为占位符）。

---

## 9. 非目标（本轮不做，但表结构留位）

- 服务等级（batch/flex/priority）参与计算 —— 本轮只登记倍数规则。
- 模态计量单位（per image / audio second / video second / pixel / query / GB-day）。
- 区域乘数（阿里部署范围、Bedrock 跨区档、OpenAI regional uplift）。
- 促销/活动价 —— 厂商文档明确不写（阿里：活动优惠见控制台），只能标注"估算不含活动价"。
- 积分制套餐（GLM Coding Plan 的输入/缓存/输出系数 + MCP 按次）。

---

## 10. 额度触达检测（2026-09-19 定案，实现未开始）

> 产品设计全文见 `docs/plans/2026-09-19-finance-quota-detection-design.md`；
> 本节是该设计**进入规范口径**的部分——实现与评审以本节为准。

### 10.1 定位

一次「额度触达」= 厂商亲口承认"该窗口到顶了"，是本插件唯一的**额度观测锚点**：
`plans[].quotaTokens` 与 `manualBalanceMicros`（INV-9）都是用户自报，触达是实测。
它把额度从自报升级为观测，并补上账本缺失的"失败"维度（被拒请求不产 token，但一轮时间全废）。

**能力边界（必须在 UI 与文档同时写明，禁止过度承诺）**：只给**二值触达信号 + 窗口粒度**
（5h / 周 / 月 / 余额 / 免费额度），**给不出剩余额度的精确值**——DSH 路线元数据无任何 quota 字段。

### 10.2 信号源与实测约束（2026-09-19，390 会话 / 504 条真实载荷）

信号已由内核归一化，**不解析厂商原始报文**：`turn/end.reason.error: LlmFailure`
（终态）与 `llm/retry.failure: LlmFailure`（过程，自带 `provider`），字段
`{ message, code, status?, providerRetryAfterMs?, requestId? }`；内核另有 canonical
`QUOTA_EXCEEDED_CODE = 'QUOTA'` 与 `isQuotaExceededError()`，适配器顺序是"先判额度、再判 429→RATE_LIMIT"。

四条**实测约束**（决定实现形态，违反即返工）：

| # | 实测 | 规范要求 |
|---|---|---|
| C1 | 504 条载荷中**仅 1 条**带 `status` | **禁 `status`-only 判定**；`code` + `message` 是唯一可用面 |
| C2 | `code` 单独用会漏也会错：`2067` 与两条声明式窗口**无 code**（落 `RATE_LIMIT`）；`402/401008` 是额度但非 429；`429006`/`RequestBurstTooFast`/`Throttling` 是 429 但**非额度** | **禁 429-only、禁 `code==='QUOTA'`-only**；判定必须是 message 词表 + code 的**有序组合** |
| C3 | 同一次断供 = `n× llm/retry` + `1× turn/end`（典型 5+1）；原始事件 123 → 真实断供 **21**（**~6× 放大**） | 计数口径**必须是 episode（去重后）**，另记 `attempts` 供解释 |
| C4 | 123 条中仅 65 条可解析 reset 时刻，且三种格式（带/不带时区） | `resetAtMs` 为**可选增强**；无时区一律置 null 并保留原文，**禁止假设本机时区补值** |

### 10.3 判定口径（顺序即语义，不可调换）

纯函数 `classifyQuotaFailure(failure: LlmFailure)` → `quota{window}` / `capacity` / `throttle` / `other`：

1. **容量/突发词表**（`429006` / `serving capacity` / `RequestBurstTooFast` / `"Throttling"` / `busy or has reached` / `请求频率`）→ `capacity`。
   **必须先于 429 判定**：这是瞬时问题，记成额度会误导"该充钱"。
2. **余额词表**（`1113` / `insufficient balance` / `no resource package` / `recharge`）→ `quota:balance`。
3. **免费额度词表**（`401008` / `free trial quota` / `免费体验额度`）→ `quota:trial`（非 429 也要认）。
4. **周/月**（`1310` / `1-week quota` / `Weekly/Monthly` / `weekly limit`）→ `quota:week`。
5. **5 小时**（`1308` / `5-hour` / `5 hour` / `5h quota`）→ `quota:5h`。
6. **月度套餐**（`2067` / `Token Plan 用量上限` / `monthly limit`）→ `quota:month`。
7. `code === 'QUOTA'` → `quota:unknown`（内核已判过额度；窗口未知不猜）。
8. `code === 'RATE_LIMIT'` 且含 `429` 但**无任何额度措辞** → `throttle`。
9. 其余 → `other`。

**不确定一律 `other`**，另立 `capacity`/`throttle` 两个"明确不是额度"的类，禁止硬塞进 quota
（§3 同构：宁可不算，不可算错）。

**去重键**：`(modelKey, window, resetAtMs ?? resetRaw ?? messageSignature)`；
同键连续失败合并为一个 episode，`turn/end` 命中同键则标 `final: true`。
`messageSignature` = 剥掉 request-id / 时间戳 / UUID 后取前 120 字符。

`capacity` / `throttle` / `other` **不写任何状态**——分类器保留这三类只为让 A9 能断言分离成立。

### 10.4 数据落点

- **采集**：新增会话投影 `financeQuota`（**新 key、新 unit、`stateVersion: 1`**）。
  **严禁**修改既有 `financeUsage` / `financeUsageHourly` / `financeRate` / `financeContext`
  的 `stateVersion`——缓存对版本不匹配是**丢弃而非迁移**，一次 bump = 全会话重放。
  边界同 `financeRate`：**forward-only**，旧会话无该键，不重放补造，不退化为错误。
- **聚合**：`FinanceLedger.quota.rows`（按 provider、当月）：`hits`（episode 数）、`attempts`、
  `lastHitAtMs`、`nextResetAtMs`、`windows[]`。
- **wire 零改动**（`getLedger` 返回整个 `FinanceLedger`）；实时刷新复用既有
  `session/event` → 2s 防抖 → `finance/ledgerUpdated` 广播，**在既有钩子补 `turn/end` 分支**
  （额度触达由 `turn/end` 触发，不是 `assistant/message`）。
- **INV-10 硬约束**：`quota` 不参与任何金额口径；窗口用量估算（`resetAtMs − windowLength`
  内的 token）只作**下界/估算**呈现，**不得**静默写入 `plans[].quotaTokens`。

### 10.5 UI

- **不新增表格列**（供应商表已有 5 列，列宽是稀缺资源）：在供应商名右侧挂 Pill，
  **仅 `hits > 0` 时渲染**——无命中什么都不显示，不显示"正常"、不摆绿点。
- 有 `resetAtMs` → `额度触达 2 次 · 3h12m 后重置`；无 → `额度触达 2 次 · 重置 <原文>`。
- 逐条 episode 明细进**已有的供应商详情弹窗**，只读不可编辑。Pill tone = `warning`
  （额度是"受限"，不是"错误"）。必须带 `aria-label` + `data-testid="finance-quota-{provider}"`。
- 订阅与按量同一套机制：订阅触达 = 容量不足，按量触达 = 钱包/资源包触底。
- **反例写进 UI**：触达次数 ≠ 额度大小，不同窗口不可比；`unknown` 窗口必须显式显示"窗口未知"。

### 10.6 验收（追加至 §7）

| 编号 | 断言 | 落点 |
|---|---|---|
| **A9** | 分类器一致性：真实载荷脱敏 fixture 逐条断言；**其中 49 条 capacity 一条都不许落进 quota** | `dsh-finance/tests/quota-classify.test.ts` |
| **A10** | 去重正确性：`5× llm/retry + 1× turn/end` → `hits=1, attempts=5, final=true`；不同 reset 时刻 → 2 条 | 投影单测 |
| **A11** | INV-10 正交性：注入额度触达后，`totalCostMicros` 与全部金额聚合**逐字节不变** | 账本单测 |
| **A12** | 投影兼容性：新增 `financeQuota` 后既有 4 个 unit 的 `stateVersion` 未变、既有 checkpoint 不失效 | 投影单测 |

**闸门新增防线**（反模式进脚本，不只写文档）：扫 `dsh-finance/src/quota.ts`，
禁止 `status === 429` 式单一判据，禁止 quota 结果进入 `costOf` 调用链。

### 10.7 非目标

- 精确剩余额度（需厂商 quota API，DSH 无此面）。
- 容量繁忙 / 请求限流的**记账**（分类已能识别，仅用于"不被误记成额度"）。
- 自动改套餐 / 充钱 / 降频（只呈现，不动作）。
- 跨厂商额度归一（窗口语义不可比，不造统一标尺）。

---

## 附录 A · DeepSeek 官方 CNY 表（fixture，2026-09-16 取自厂商文档）

单位：CNY / 百万 tokens。

| 模型 | 缓存命中 谷/峰 | 缓存未命中 谷/峰 | 输出 谷/峰 |
|---|---|---|---|
| `deepseek-flash`（= V4.1-Flash） | 0.02 / 0.04 | **1 / 2** | **4 / 8** |
| `deepseek-v4-pro` | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |

- 窗口：UTC 01:00–04:00 & 06:00–10:00，周一至周五（= 北京 09–12 / 14–18）；周末自 2026-08-23 起全天谷时。
- 谷 = 峰 × 0.5。
- 别名：`deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 已退役，按 Flash 价计费。
- 现状对照：`deepseek-v4-pro` 的现有条目与本表**逐字一致**（无需改动）；
  `deepseek-flash` **缺失**（本次 bug 直接原因）；两个别名条目仍停在退役前的旧价。

## 附录 B · 账单回归 fixture

来源：`usage_data_2026-08-18_2026-09-16.zip`（用户提供；`amount-*.csv` 逐类型 token+单价，
`cost-*.csv` 每日钱包扣费）。

| 指标 | 值 |
|---|---|
| 覆盖区间 | 2026-08-18 → 2026-09-16 |
| 「日期×模型」行数 | 22 |
| 官方合计 | **¥179.56** |
| 修复前（回落 legacy 兜底价） | ¥1187.38（×6.6） |
| 修复后期望 | **逐行 Δ = 0**（CNY 档位源直接取厂商值） |
| 关键分段 | 08-19…09-07 `deepseek-v4-flash`（旧峰谷档）／09-08 `deepseek-v4.1-flash-expires-on-0910`／09-10 起 `deepseek-flash` |

## 附录 C · 改造点索引（现状代码）

| 位置 | 现状 | 目标 |
|---|---|---|
| `packages/dsh-finance/src/index.ts:278,303` | `compositionPrices`（来自 YAML） | 改为加载 §2.2 生成产物（哈希校验） |
| `packages/dsh-finance/src/index.ts:291,356,365` | `communityPrices` 内存层 + setter | 改为 `userOverlay`（落盘 + 预合成） |
| `packages/dsh-finance/src/index.ts:280` | `userPrices`（settings 持久层，静默无还原） | 收编进 overlay 或改为只读展示（INV-6） |
| `packages/dsh-finance/src/pricing.ts:371-381` | `mergePriceLayers` = `Object.assign` 整键替换 | 形状守卫合并（§2.3） |
| `packages/dsh-finance/src/index.ts:394` | `currentConfig()` 每次读都 merge | 预合成缓存 |
| `packages/dsh-finance/src/pricing.ts:138-143` | `isPeakLocalHour` 单区间 `start<=h<end` | 支持跨零点 |
| `packages/dsh-finance/src/pricing.ts:130-135,475` | `DEFAULT_PRICE` 静默兜底 | 降级为最后兜底 + 「估」+ 来源标注 |
| `scripts/sync-finance-prices.mjs` | splice YAML | 调用生成器（codegen） |
| `packages/dsh-finance-client/src/client/locales.ts:162-164` | 陈旧角标已有 | 补「更新 / 还原」两按钮 + 覆盖列表 |
