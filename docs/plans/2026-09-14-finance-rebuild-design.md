# 财务插件重建 · 产品设计（2026-09-14）

> 结论先行：重建的理由不是"代码臃肿"，而是**视角错位**。现插件是会计账本视角
> （价格表维护、账本重放、图表开关），用户要的是**采购与调度决策视角**
> （订阅值不值 / 该派谁干活 / 怎么调度更省 / 每个项目花了多少）。
> 数据底座可复用，信息架构整体重做。

## 1. 用户与场景

- 已订阅 5–6 家厂商：云厂商自部署开源模型转售 + 大模型厂商直供。
- 付费形态两类：**按量付费**、**按月付费**；按月又分三种子类型
  （月限额+周限额+每 5 小时限额 / 月限额+周限额 / 仅月限额）。
- **仅 DeepSeek 官方**提供可查询余额接口；其余厂商只能从各自管理后台看用量与额度上限。

## 2. 六个真实痛点（设计输入，按用户原话归纳）

1. 模型调用大组合包的全景：各厂商各自花了多少钱。
2. 订阅 vs 按量：订阅具体比该厂商按量付费省了多少。
3. 各厂商模型的 token 输出速率多快；速率带来的时间成本优势多大。
4. 每个项目花了多少钱；成本-时间曲线。
5. 峰谷计价：错峰执行能省多少（部分厂商有、部分没有）。
6. context size 阶梯计费：任务拆分到不同会话能省多少（部分厂商有、部分没有）；
   缓存命中率谁高谁低、同一模型命中率高低带来多大成本差别。

## 3. 产品原则（贯穿全部视图）

1. **只呈现"你的实体"**：你接入过的 provider、你实际用过的模型、你的项目。
   bundle/社区的**预置兜底值只在后台参与计算，绝不作为表单行出现在编辑面**。
2. **候选列表 = 已接入集合**：要新增，从「添加」入口按需选择，候选里只有你接入过的；
   没接入的不出现。禁止"全量目录 + 用户滚动寻找"。
3. **编辑入口贴在数据旁，不独立成配置页**：改某模型单价 → 在"该模型成本明细"行上点「改」
   弹出抽屉；改厂商默认价 → 在该厂商行上改。因此**不存在"高级配置页"**。
4. **空态是主路径**：无数据 → 一句话 + 一个按钮；首次重算 → 明确进度；缺价格 → 用兜底价
   并在该行打「估」角标。

## 4. 信息架构：四个视图

### ① 本月值不值（首屏）
- 主数字：本月总成本；拆成 **按量支出** / **订阅等价**。
- **订阅卡（每厂商一张）**：月费、本月等价按量价、**省了 X** 或 **亏了 Y（用满需 Z）**、
  折扣率。额度为可选静态字段（用户选 B：填一次，不追每周期剩余）。
- 单位成本榜：本月实际用过的模型各一行（混合单位成本）。
- 成本-时间曲线（按天），叠加模型切换标记。

### ② 该用谁（模型 × 厂商对比）
- 只列**你实际用过的**模型。列：混合单位成本 / 缓存命中率 / 输出 tok/s / 首 token 延迟 / 本月调用量。
- 同模型跨厂商并列时高亮胜者，给"更省/更快"结论标签。
- 点行展开：命中率提升 10 个点的可省金额、错峰可省金额、速率差折成分钟（可选时薪折成钱）。

### ③ 怎么调度更省
- 三张「若…可省」卡：**错峰**、**提缓存命中**、**拆上下文**（第三张属第二阶段）。
- 每张卡：可省金额 + 一句可执行建议；标注这是估算。

### ④ 项目账
- 项目（workspace）列表：成本、会话数、Top 模型。
- 进入项目：该项目成本-时间曲线 + 会话明细。

## 5. 明确不做（废弃清单）

- 「高级」页整页删除：统一默认价 / 供应商默认值 / 价格表三份表单。
- 「连接」页三字段收进默认（cordis.patch.yml），UI 不再暴露。
- 供应商 tab 的**本地业务覆盖层**（localStorage 存价格/自动取余额/有效期）整体删除。
- 图表开关 + 布局偏好（localStorage 偏好体系）删除；每视图 1–2 张定式图。
- 8 张图表自由组合 → 固定编排。
- DeepSeek 余额基线（历史峰值启发式）→ 换成"余额 ÷ 近 7 日均耗 = 还能用几天"，不再需要基线。

**旧版是否热修**：不热修。用户报的「高级-供应商默认值」问题在重建里随整页删除；
重建完成前旧版维持现状（除非用户要求提前热修）。

## 6. 数据来源与诚实标注

| 类别 | 来源 | 标注要求 |
|---|---|---|
| 观测值 | 本机 harness 会话（token 用量、cache 桶、费用、decodeMs/decodeTokens/ttftMs） | 可当事实展示 |
| 手填值 | 套餐月费 / 额度 / 生效期（用户选 B：填一次静态） | 标"你填写" |
| 估算值 | 订阅节省、错峰可省、提缓存可省、拆上下文可省、时间成本折钱 | **必须标"估算"**，并给出口径 |
| 推算值 | 余额可用天数（余额÷近 7 日均耗） | 标"按近期消耗推算" |

**口径固定表述**：
- 订阅节省 = 同 token 量 × 该厂商按量目录价 − 月费（不含并发/限流价值）。
- 速率 = 端到端有效吞吐（encodeTokens/decodeMs），受限流与请求形态影响，非厂商标称值。
- 缓存命中率 = cacheRead ÷ (uncachedInput + cacheRead + cacheWrite)。

## 7. 工程边界（留档，非本次讨论重点）

- **保留**：host 的 `balance/ledger/pricing/projection/session-source/provider-meta` 与
  `dsh-finance-wire` 契约（含 175 个 host 测试）。峰谷、缓存、项目账全部长在它上面。
- **新增（host）**：per-model 速率投影（照 `financeUsageHourly` 的 forward-only 做法，
  每模型 fold decodeMs/decodeTokens/ttftMs/steps）；`finance.plans[]` 套餐定义 + 两个纯函数
  （实际节省、用满折扣率）。
- **契约不动**：遥控端点仍 8 条；速率/命中率以**可选字段**并入既有 ledger 行，strict schema 对旧客户端安全。
- **重写（client）**：约 5k 行 → 目标 ~1.8k 行。

## 8. 阶段计划与验收口径

- **P0**（数据已在，零录入即可上线）：视图 ①②③④ 全部落地（① 不含订阅卡，② 含缓存命中率但**不含速率列**），并删除六类配置面。零 host 改动、端点数不变。
- **P1**：视图 ① 的订阅卡（需套餐静态定义）+ 速率投影落地 + ② 的速率列 + 时间成本换算。
- **P2**：context 阶梯价格（`tiers`）+ 每 step 上下文长度采集 + 拆分会话反事实（标注估算）。
- 每阶段验收：`pnpm -r build/typecheck/test` 顺序全绿 → `pnpm check:all` → `pnpm preview:verify` →
  改 host/注册面则 `pnpm sandbox:install` + `node dev-harness/real-host-check.mjs` 退出码 0。
- **产品体验验收**（新增）：每个数字可追溯；估算有标注；编辑面不出现未接入实体；
  无开发文案泄漏；空态有出口。

## 9. 已知反例（必须写进 UI，避免误导）

- 拆分会话**未必更省**：上下文切碎会打掉 prompt cache 命中，可能反而更贵。
- 速率排名受并发与请求形态影响；小请求的 tok/s 天然低于长输出任务。
- 订阅"省了多少"不含并发权与限流豁免的价值，纯成本口径会系统性偏向订阅。
- 社区目录价会漂移，历史月份的重算值可能与当月口径不同。

## 10. 结论与待决

- 用户已选 **B**：套餐定义填一次静态（月费/额度/生效期），不追踪每周期剩余额度；
  "省了多少"用实际用量算。
- 待决：无（技术取舍由实施方自主决定并按上述验收口径自证）。

## 11. P0 落地记录（2026-09-14）

**改了什么**：`dsh-spark-finance-client` 0.4.2 → 0.4.3 —— 面板从「总览/连接/供应商/高级」四页配置面重建为四页决策视图（本月值不值 / 该用谁 / 怎么调度更省 / 项目账）；删除 `FinanceCard`（含 CSS）、`FinanceCardController`、`price-forms`、`PriceEditors`（含 CSS）、`ProviderListView`、`ByModelTable`、`BalanceGrid`、`persist`（三套 localStorage 全删）、`FinanceAuditSection`（含 CSS）与 6 个对应测试文件。新增 `derive.ts`（纯函数派生：命中率 / 混合单位成本 / 分组比价 / 缓存差值估算 / 可用天数）、`FinancePanel` + 四个视图 + `panel.module.css`。host 与 wire **零改动**（仍是既有 9 条端点，全部 strict）。

**验收证据（全部实跑）**：

| 面 | 结果 |
|---|---|
| `pnpm -r build` / `pnpm -r typecheck` | 退出码 0（finance-client client.js 722.3kb） |
| `pnpm -r test` | 退出码 0（finance host 162 + finance-client 38，其余包全绿） |
| `pnpm check:all` | 架构 0 硬失败 0 告警（含 inject 面覆盖）/ 对比度 PASS / audit-tokens PASS / 版本纪律 PASS |
| `pnpm preview:verify` | 71/71 通过；含新回归线「已无配置面（价格表 / 供应商默认价 / 视图偏好全部删除）」 |
| `pnpm sandbox:install` + `node dev-harness/real-host-check.mjs` | 29/29 通过、退出码 0；真宿主 finance pane 实测渲染出新面板（四视图 + 空态引导 + 价格来源脚注），控制台 0 条 |

**尚未做（P1/P2 边界，UI 不放占位、不冒充结论）**：订阅卡与「省了多少」、逐模型输出速率与时间成本、context 阶梯计价与「拆会话能省多少」。

## 12. P1-A 落地记录（2026-09-14）：订阅 vs 按量

- **host**：`FinanceConfigInput/FinanceConfig.plans`（provider / 月费 / 币种 / 可选额度 / 周期标签 / 生效期）+ `normalizeFinancePlans`（坏行跳过而不是猜、日期串与 epoch 都收）+ `FinanceService.Config.plans` schema；导出 `normalizeFinancePlans`。host 端点仍 9 条，无 wire 改动。
- **client**：`derive.planInsight / planRows / providerKey`（省了多少 / 折扣率 / 回本进度全是观测值相减）；`plans.ts` 把 settings scope 收敛成 seam（只读快照 + 整写 `plans`）；视图① 首卡「订阅 vs 按量」——**行内**填月费（月费 + 币种 + 计费形态），候选 provider 只来自账本里真正用过的厂商，设置只读时明说不能改。
- **验收**：`pnpm -r build/typecheck` 退出码 0；`pnpm -r test` 退出码 0（finance 168 / finance-client 44）；`pnpm check:all` PASS；`pnpm preview:verify` **75/75**（新增 4 条套餐断言，含写回 settings 的实测）；`pnpm sandbox:install` + `node dev-harness/real-host-check.mjs` **29/29** 退出码 0。
- **仍未做**：context 阶梯与拆分会话反事实（P2）。

## 13. P1-B 落地记录（2026-09-14）：速率与时间成本

- **host**：新增 `financeRate` 投影单元（每模型 `decodeMs / decodeTokens / ttftMs / ttftSteps`），与平台 `sessionStats` 同一套事件语义（`step/start` → 首个可见 delta → `assistant/message`；只统计报了 output token 的步；被取消的步不计时），差别只有一个：按 `request/header` 的模型键分桶。注意本仓库钉的平台版本**没有** `assistant/attempt` 事件与 `assistantStreamFirstTokenTime` 导出，因此首 token 从 `assistant/chunk` 的首个非空 `text-delta`/`reasoning-delta` 判定。ledger 读该单元并把样本合进 `byModel` 行（可选字段 `rate`；旧会话缺席 → 面板显示 `—`，不显示 0）。
- **client**：`derive.outputTokensPerSecond / firstTokenMs / speedComparison`；视图② 新增「输出速率」列，并在**组头常显**时间成本比较（`{slow}` 的 N 个输出 token 按 `{fast}` 的速率只需 X 分钟），标注「估算」。
- **修正一个真实产品缺陷（由真 fixture 暴露）**：原先 `groupByModel` 按 `modelKey`（`provider/model`）分组，而同一模型由两家供应时 modelKey 天然不同，于是永远各成一组、**根本不存在可比对象** —— 视图② 的「同一个模型哪家更划算」此前形同虚设（P0 的合成 fixture 掩盖了它）。现按 `model` 名分组，`cacheExtremes / estimateCacheSavings / speedComparison` 同步按模型名比。
- **验收**：`pnpm -r build/typecheck/test` 退出码 0（finance **175** / finance-client **49**）；`pnpm check:all` PASS；`pnpm preview:verify` **79/79**（新增速率列、tok/s、时间成本比较三条断言）；`pnpm sandbox:install` + `node dev-harness/real-host-check.mjs` **29/29** 退出码 0、控制台 0 条。
- **仍未做**：无（P0 / P1-A / P1-B / P2 四段全部落地）。

## 14. P2 落地记录（2026-09-14）：上下文阶梯与「拆分会话能省多少」

- **host**：新增 `financeContext` 投影单元 —— 定长 5 桶（≤32k / ≤128k / ≤200k / ≤1M / 无上界），每桶存四类 token 与步数；同一步 last-wins，且跨模型切换时会把旧样本从原模型的桶里正确撤销。新增 `tiers` 配置（按 modelKey 声明升序档位，`maxPromptTokens: 0` 为兜底档）+ `normalizeFinanceTiers`（坏档跳过、升序、兜底档恒最后）。ledger 把分布合进模型行（可选字段 `context`，旧会话缺席）。
- **client**：`contextProfile / tierForBucket / usageCostMicros / splitEstimate`；视图③ 新增第三张卡「拆分会话能省」——展示**超过 128k 的输入占比**；对填了阶梯价的模型给出**上限**估算（按你填的档位逐步定价 vs 全部按最小档定价之差），没填的模型直接明说「拆分不改变单价（而且会打掉缓存复用，通常更贵）」。
- **诚实边界（都写在卡片上）**：① 这是**上限**，不含拆分会话自身的代价（重发前缀、掉缓存命中）；② 阶梯价**不参与**账本既有成本口径（账本仍按 prices / providerDefaults / defaultPrice 算），避免两套数字打架；③ 阶梯价只在设置文档 / `cordis.patch.yml` 里声明，**不开配置 UI**（不新增配置页、不出现未接入实体）；④ `financeContext` 是 forward-only，旧会话没有分布时该模型不出现在卡里。
- **验收**：`pnpm -r build/typecheck/test` 退出码 0（finance **182** / finance-client **55**）；`pnpm check:all` PASS；`pnpm preview:verify` **83/83**（新增拆分卡四条断言）；`pnpm sandbox:install` + `node dev-harness/real-host-check.mjs` **29/29** 退出码 0、控制台 0 条。

## 15. 目标完成度

P0（四视图 + 删除六类配置面）· P1-A（套餐静态定义 + 订阅节省）· P1-B（每模型速率 + 时间成本）· P2（上下文阶梯 + 拆分上限）四段全部落地并各自跑满五项验收；host 端点始终 9 条（8 RPC + `finance/events` stream）、契约未动。附带修掉四个真实缺陷：`modelKey` 分组导致视图② 无法跨供应商比较、价签输入溢出与开发文案泄漏、§16 的「输出速率没数据」（首 token 判定写死了 0.1.2 的事件形状）、§17 的「订阅等价恒为 0」（宿主漏了「填过月费 = 订阅」这条腿）。

## 16. 修 bug 记录（2026-09-17）：视图②「输出速率」没数据

- **现象**：真宿主（DSH **0.1.5-rc.1**）上视图② 每一行的速率列都是 `—`，时间成本比较也从不出现。
- **证据链（不是猜的）**：
  1. 真宿主 projection cache（`~/.dsh/storages/session_projcache/sessions/*.json`）里 19 个已装该单元的会话，
     `financeRate.byModel` **全部是 `{}`**（`financeUsage` / `financeContext` 同期都有真实数据）→ 单元在跑，只是折叠不出样本；
  2. 解压真会话日志（`session.v3.jsonl.zstd`，多帧 zstd）逐条数事件类型：**没有任何 `assistant/chunk`**
     （0.1.5 把整条 delta 流内嵌进 `assistant/message.stream` / `assistant/attempt.stream`）；
  3. 因此 `firstTokenTime` 永远是 null，`assistant/message` 分支每次都"没出过字"地丢弃样本。
- **根因**：P1-B 的首 token 判定写死了 0.1.2 的事件形状（`assistant/chunk`）。本仓库 pin 的平台版本是 0.1.2-rc.1，
  所以合成 fixture 全绿、真宿主全空 —— §13 那行"首 token 从 `assistant/chunk` 判定"就是这个 bug。
- **修法**（三处，缺一条数据都回不来）：
  1. `projection.ts`：首 token 跨两代取 —— 有 `assistant/chunk` 走老路；有内嵌 `stream` 就按平台
     `assistantStreamFirstTokenTime` 的语义自己扫（原始 `{type:'chunk'}` 记录 + 打包行 `time0 + Σdt` 还原），
     并补 `assistant/attempt` 的流（失败/重试尝试也曾经出过字）。**不 import 平台那个导出**：0.1.2 的 dsh-llm 没有它，
     具名 import 会在宿主加载期直接 SyntaxError。
  2. `projection.ts`：`financeRate.stateVersion` 1 → **2**。v1 落盘的是**错的值**（空 `byModel`）而不是缺的值，
     加新键救不了，必须让版本门丢掉旧行重折。
  3. `ledger.ts`：缓存切面是**按行**给的 —— 版本门丢掉 `financeRate` 后切面里还有别的键，`cachedSnapshot` 照样返回，
     账本于是拿着空对象当答案。现在点名要求 `financeRate` / `financeContext` 两条腿，缺腿就 `coldSnapshot` 冷折一次
     （照 `rescanSessions` 的先例；重折结果会写回缓存，所以是一次性代价，旧会话首次建账本走回填进度条）。
- **wire**：`financeLedgerSchema.byModel` 行此前没声明 `rate`/`context`（网关把这份 strict schema 当结果契约宣告，
  宿主发了、契约面看不见；结果路径不做 decode 所以客户端其实收得到，正是这个错位让 P1-B 显得"没坏"）。
  现抽出 `financeModelRowSchema` 并补齐两条腿的声明 + 反射模型条目。
- **验证**：把修好的折叠直接跑在真宿主会话日志上（`.dev/tmp` 一次性脚本，不入库）：
  `deepseek-official/deepseek-flash` 得到 ttft ≈ 0.81–1.21s、decode ≈ 206–253 tok/s；与平台自己的
  `sessionStats` 同一批日志逐字段对照，**只差最后未完结的一步**（例：ttft 718832ms/350 步 vs 平台 720108ms/351 步）。
- **诚实边界**：① 速率是**端到端有效吞吐**（含首 token、限流/排队），不是厂商标称；② 旧会话要等一次冷折才出数
  （真宿主下一次建账本时跑回填）；③ 若宿主是 0.1.2 老平台，走的仍是 chunk 那条腿，两代语义等价。

## 17. 修 bug 记录（2026-09-17）：本月值不值「订阅等价」恒为 0

- **现象**：真宿主「本月值不值」顶部 **订阅等价永远 ¥0**，而下面「订阅计划」卡里明明列着 zai / minimax-cn 两条订阅（按量等价非零）；同时「按量支出」把这两家的用量也算了进去。
- **根因**：**同一个问题在两端有两套口径**。
  - 客户端 `ThisMonthView.billingFor` 是三层：**显式标记 > 填过月费 = 订阅 > 宿主默认**（中间那条腿是给“早就填过月费、还没打标记”的老数据兜底的）；
  - 宿主 `financeBillingMode`（账本唯一的分类口）只有两层：宿主默认 + 显式标记，`plans` 根本没进 `hostMetaByProvider`。
  于是“只填月费、不打标记”的用户看到的是：面板按订阅展示、账本按按量记账 → `planEquivalentCostMicros` 恒 0，
  `meteredCostMicros` 虚高（三块加起来仍等于总额，所以只是口径错位，不显眼）。
- **证据（真宿主）**：`~/.dsh/settings.yaml` 的 `finance.plans` 有 `zai`（¥94.4/月）与 `minimax-cn`（¥119/月），
  `finance.providers` 段为空（从来没打过标记）；`session_projcache` 里 `zai/glm-5.3-flash`（32 会话）与
  `minimax-cn/MiniMax-M3`（8 会话）都有真实 output token。
- **修法**：
  1. `pricing.ts`：`foldProviderBillingModes` 增加第 4 参 `planProviders`，把“填过月费 = 订阅”这条腿补到宿主侧
     （优先级：内置默认 → 月费 → 显式标记；`lockBillingModeAndCurrency` 只挡显式标记那一层 —— 客户端 billingFor
     同样让月费越过锁，两侧必须一致）；
  2. `index.ts currentConfig`：把 `raw.plans` 的 provider 喂给折叠 —— 漏了这一行等于没修（回归线专治它）；
  3. provider 名归一化统一成「先小写再剥 `-official`」：宿主新增 `financeProviderKey`，客户端 `providerKey` 同步；
     `ledgerProviderNames` 改成**双向**候选（`deepseek` ↔ `deepseek-official` 互相都配得上）—— 此前“套餐写 deepseek、
     账本记 deepseek-official”会静默配不上（等价用量算成 0）。
- **回归线**：`tests/plan-billing.test.ts` 走**真实服务链路**（constructor → currentConfig → buildFinanceLedger），
  而不是只测纯函数；实测把第 2 条接线去掉后 3 条挂 2 条（有牙）。客户端补 `providerKey` 大小写与反向候选两条断言。
- **验收**：`pnpm -r build/typecheck/test` 退出码 0（finance **231** / finance-client **58**）。
