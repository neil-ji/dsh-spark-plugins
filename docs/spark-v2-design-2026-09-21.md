# 火花 v2 设计：独立定位与三层路线

> 状态：**v2 草案，待拍板**（2026-09-21）
> **取代** `docs/spark-inbox-design-2026-09-14.md`（v1）。v1 哪些部分仍成立、哪些作废见 §附录 A。
> 评审项编号**从 P10 起**（P1–P9 属 v1，不重用；P6 的去向见 §附录 A.3）。
> 范围：dsh-spark（宿主）/ dsh-spark-wire（契约）/ dsh-spark-dock 的火花 UI
> **本文只写设计与验收口径，不含实现。**
> 相关（不重叠）：`docs/SPARK-DECISION-ENGINE-SPEC.md` 管「用哪个脑做判断」（决策分级链，接缝 S1–S5）；
> 本文管「火花是什么、往哪长」。交叉点见 §5.4。

---

## 0. 两条 headline 决定

### 决定一：火花与记忆**各自独立**，插件之间**零直接通道**

火花和记忆是两个一等公民，各自做好自己领域内的工作。二者**真实存在的关联**我们承认
（创意本身就是一种记忆），但**创意需要的工作流与机制和记忆不同**，因此**不在插件层强行打通**。

> **二者的关联，交由 Agent 判断。**

这条主张的机制落点是：**两边的会话注入各自独立发生**（记忆走 `memory/context.ts`，
火花走 `spark/inbox.ts`，两个独立的 `agent/pre-step`），于是模型在**同一段上下文里同时看到两者**——
「从记忆里提炼出创意」「判断某条创意值得留下」这些融合动作，**发生在模型推理层，不发生在插件契约层**。

推论（本设计的减法是主要工作量）：

| 方向 | 现状 | v2 |
|---|---|---|
| spark → memory | **3 条直连**（工具/端点、valence 自动写、command-mining 自动写） | **全删** |
| memory → spark | 1 条只读回指（`sourceSparkId` + 面板徽标） | **行为断开** |
| 可视化 | Graph 子页画跨插件的记忆节点 + `crystallized` 边 | **回到纯火花域** |

**实测成本为零**：真实库里 9 条火花中 `crystallized` 状态 **0** 条；242 条记忆中带
`sourceSparkId` 的 **0** 条（§2.1）。这条路径不是"用得少"，是**从未被用过**。

### 决定二：**朴素命名**——先让用户接受产品，再谈教育

v2 草案初稿起了一批生动的名字（壁炉 / 在燃 / 复燃 / 熄灭）。**否决**。
用户看不懂的名字不会因为"有画面感"而被接受，只会让产品先被误解一次。

**规则**：用户可见的每一个名词，必须是**通用词**，优先选用户**在别处已经见过**的词。

推论：v1 引入的「收件箱」IA、`pending` / `crystallized` 命名**一并回退**（§2.5、§4.2）。
隐喻只允许出现在**本设计的动机描述**里，一句话为限，**不得进入契约、字段、locale 文案**。

---

## 1. 定位

### 1.1 各守其域

| | 火花 | 记忆 |
|---|---|---|
| 是什么 | **想法 / 创意**（尚未被现实检验） | **信念**（已被检验，今后注入所有相关会话） |
| 领域机制 | 捕获 → 复现 → 衍生；轻、可丢、可过期 | 沉淀 → 去重 → 进化；重、耐久、受治理 |
| 错一条的代价 | ≈ 0（丢掉是免费的） | 高（污染耐久层 + 后续全会话召回） |
| 谁负责 | `dsh-spark` | `dsh-hippomemo` |
| 谁做融合 | **Agent**（跨域判断），不是任何一方的契约 | |

### 1.2 三层路线

| 层 | 内容 | 现状 |
|---|---|---|
| **L1 创意留存** | 捕获低摩擦 + **旧火花会被重新想起**（不是"待清空"） | 捕获 ✅ / 复现 ❌ |
| **L2 Agent 是平等的提出者** | ① 用户明确指令时提出；② **自己发掘**「当前会话与已有火花相关的潜在创意」 | 工具存在但语用错 / **看见旧火花的通道缺失** |
| **L3 火花衍生** | 从已有火花生成新火花——关联、联想、想象 | **完全不存在** |

> 一句话动机：这是一个**一直亮着**的想法池，不是一个**待清空**的收件箱。
> （此句只用于说明动机，不进入任何契约与文案。）

---

## 2. 现状诊断（对代码，2026-09-21）

### 2.1 直连审计：5 条边，实测使用量为 0

**spark → memory（3 条出边）**

| # | 位置 | 性质 | 现状 |
|---|---|---|---|
| E1 | `tool.ts` `spark_crystallize` + `spark-service.ts` `crystallize()` + `types.ts` `buildHippoInputFromSpark` + `http.ts` `POST /sparks/:id/crystallize` + wire `sparkCrystallizeSchema` / `sparkCrystallizedSchema` / `crystallized` 状态 + `SparkHippoUnavailableError`（HTTP 412） | 交互式 | 全链存在 |
| E2 | `valence-service.ts:97,112` `ctx.memory.put(...)` + `valence.ts` `candidateToHippoPreference` | **自动**（唯一自动运转的挖掘管线） | 挖到偏好**直接写耐久记忆** |
| E3 | `command-mining.ts:291` `memory.put({kind:'constraint', modelIds})` | **自动**（D 档，默认关） | 按模型弱项直写记忆 |

**memory → spark（1 条入边，只读）**

| # | 位置 | 性质 |
|---|---|---|
| E4 | `sourceSparkId`：`types.ts` / `spec.ts` / `memory-core.ts:120,252` / `preference.ts:35`；UI `MemorySection.tsx` 的「结晶于」徽标与谱系弹窗；locale `sourceSpark` / `sourceSparkBadge` / `sourceSparkHint` / `modalLineageSpark` | 存储字段 + 取数分支 + 文案键 |

**跨插件可视化（1 处）**

| # | 位置 | 性质 |
|---|---|---|
| E5 | `graph.ts` 的 `crystallized` 边 + `MEMORY_PREFIX` / `memoryNodeId()`：图里会**渲染记忆节点**；dock `style.ts` 有 4 条 `.dock-graph-*crystallized` 样式 | 跨插件图 |

**实测存量（`~/.dsh`，2026-09-21）**

```
sparks.jsonl   : 9 条 → pending 8 / archived 1 / crystallized 0 / dropped 0
hippomemo.json : 242 条记忆 → sourceSparkId 非空 0 条
```

**结论：解耦是纯减法，零数据迁移成本。** 唯一需要迁移的是状态枚举（9 条记录，映射见 §4.2）。

### 2.2 注入形态不对称：火花的内容从不进会话

| | hippomemo | spark |
|---|---|---|
| 钩子 | `agent/pre-step` | `agent/pre-step`（`src/inbox.ts:117`） |
| 注入物 | 与当前查询**语义相关**的记忆（**全文**） | 计数 + 最近 3 条待处理火花的**标题** |
| 语义 | 召回 | **状态通报**（代码注释自陈："不是召回，是状态通报"） |
| 频率 | 每 agent 一次 | 每 agent 一次（`step === 1`） |

### 2.3 `emerge` 只会整理，不会生成（**并因此被错名为「涌现」**）

`src/proposals.ts` 只产三种提议，全是**确定性整理**：`link`（标题 token 重叠，去重）/ `cluster`（共享标签，归类）/
`prune`（太久没动，清理）。"从已有火花生成新火花"是**熵增**，且契约上不可能：

```ts
proposalViewSchema = { id, type, sparkIds, explanation, confidence, leverage, status, ... }
//                      ↑ 没有 title / content —— 提议在结构上装不下一个新想法
```

### 2.4 提示词把火花写成"记忆草稿"

`src/tool.ts:24` 的 GUIDANCE 原文（模型侧唯一行为指引）：

> "Sparks are NOT durable cross-session memory by default. **When a spark has matured into a stable
> fact, decision, or preference, promote it to durable memory with spark_crystallize** (Phase 2)."

工具名叫 `spark_capture`（捕获/记录），描述里写 `episodic memory`。**全篇没有一行说火花是想法、
可以说想法、可以生想法。**

### 2.5 面板 IA 与命名体检

`SparkModule.tsx:94` 的四个筛选位（`locales.ts`）：

```
灵感收件箱 / 待处理 / 已转为记忆 / 已归档 / 已丢弃
```

三个问题，都是命名层就能看出来的：

1. **「已转为记忆」是一等公民**，而「衍生」不存在 —— IA 就是产品主张，它在替记忆做广告。
2. **「收件箱 / 待处理」是队列语义**：宣布"这个库的成功是把它清空"。而想法池的成功是**想法还在**。
3. **`dropped`（已丢弃）与墓碑 `deletedAt`（已删除）是同一意图的两级摩擦** —— 4 个状态里有 2 个是"不要了"。

### 2.6 工作文献已漂移

- `docs/spark-inbox-design-2026-09-14.md` §1.3 断言"火花只写不读、没有回收回路"——
  而 `src/inbox.ts` 的 A/B/C/D 四档**均已落地**（文件内有 2026-09-16 的改法注释）。
- `packages/dsh-spark/README.md` 同样漂移（自称 append-only，实为全量重写；称 Phase 4
  "manual trigger only"，实为惰性自动触发）。

**这两处会持续误导后续会话**（本次设计的第一版判断就是被它带偏的）。处置见 §8 的 F0。

---

## 3. 设计原则

1. **各守其域，不修桥。** 两插件之间零直接通道；融合交给 Agent。任何"为了联动而新增的跨插件字段/端点/工具"都要先回答：**为什么不能让 Agent 自己判断？**
2. **朴素命名优先。** 用户可见名词一律通用词；隐喻不进入契约与 locale。**先被接受，再被教育。**
3. **想法的成功是"还在"，不是"清空了"。** 任何以"待处理数下降"为成功指标的改动都应被质疑。
4. **生成必须是熵增。** 产物必须是**一条新记录**，不是指向旧记录；与输入高度重合的产出 = 复述 = 噪声。
5. **机器写的东西必须可辨识、可过期。** 用 `origin` 分辨，用**过期**控制噪声——**不用审批**（审批会让产量等于人的点击量）。
6. **契约用中性词，推导态只有一个计算者。** v1 的 P1 教训：隐式推导规则会在 UI / 查询 / 统计三处漂移。
7. **不用定时器**（`AGENTS.md` §1.3），**不引入向量检索**（沿用 token Jaccard）。
8. **每加一个存储能力，先回答"它什么时候被消费"。** 答不出来就不加 —— `dropped` 就是这样被砍掉的（§4.2）。

---

## 4. 契约与语义变更（wire）

> 前提沿用 v1 §9：**本插件集仅自用，不承担向后兼容义务**；但数据迁移一律**幂等 + 带格式版本号**，
> 破坏性 commit 必须 bump 版本（`check:version-bump`）并在 body 写清迁移路径。

### 4.1 P10 — 解耦：删掉 spark → memory 的全部直连

| 目标 | 动作 |
|---|---|
| **E1** | 删 `spark_crystallize` 工具、`POST /sparks/:id/crystallize` 端点、`SparkService.crystallize()`、`buildHippoInputFromSpark` / `HippoPutInput`、`SparkHippoUnavailableError` + HTTP 412 分支、wire 的 `sparkCrystallizeSchema` / `sparkCrystallizedSchema`、`SparkView.crystallized` 字段、GUIDANCE 的两条结晶说明 |
| **E2** | `ValenceService` **不再写记忆**：挖到偏好候选后产出**火花**（`origin: 'agent'`，标题如「用户偏好：…」）。是否沉淀为记忆，由 Agent / 用户判断 |
| **E3** | `command-mining` **不再写记忆**：达到门槛的 `(model, 命令模式, 错误签名)` 产出**火花**（或先保持默认关，等 F3 之后重估）。`meta-store.ts` 的 `promotedAt` 注释同步改为"已生成脚本 / 已产出火花" |
| **E4** | hippomemo 侧：**停止写入** `sourceSparkId`；**移除**「结晶于」徽标、谱系弹窗、相关 locale 键与 `preference.ts:35` 的取数分支。字段在 schema 中标记 `deprecated`，**存量值不迁移**（实测全为 null，无风险） |
| **E5** | `graph.ts` 删除 `crystallized` 边、`MEMORY_PREFIX` / `memoryNodeId()` 与记忆节点；dock 删除 4 条 `.dock-graph-*crystallized` 样式。图回到**纯火花域**（`tag` / `proposal` / `derived` 三类边） |

**替代路径（不新增任何东西）**：Agent 若判断某条火花值得成为信念，**自己调 hippomemo 的
`memory_remember`** —— 该工具**已经存在**。它需要看到火花内容，而这正是 P13（语义召回 + `spark_search`）
的产出，两条改动互为前提。

**机械防线（进闸门）**：`scripts/check-architecture.mjs` 增加一条跨插件零引用检查 ——
`packages/dsh-spark/src` 不得出现 `ctx.memory` / `hippomemo` 服务符号；
`packages/dsh-hippomemo/src` 不得出现 `ctx.spark` / `sourceSparkId` 写入。
（`AGENTS.md` §5：新增反模式防线要进闸门脚本，而不是只写文档。）

### 4.2 P11 — 状态枚举回退到两个值 + 墓碑

```ts
// v1（作废）
sparkInboxStateSchema = z.enum(['pending', 'crystallized', 'dropped', 'archived'])
// v2
sparkStatusSchema = z.enum(['active', 'archived'])          // 显式枚举，不推导（保留 v1 P1 的正确部分）
deletedAt: number | null                                    // 墓碑，已有
```

**为什么砍掉 `crystallized`**：P10 已经删掉了它唯一的进入路径。留着它就是一个永远为空的状态。

**为什么砍掉 `dropped`**：它与墓碑 `deletedAt` 是**同一意图的两级摩擦**（"我不要这条了"）。
原则 8 问一句"它什么时候被消费"——答案只有一个筛选位，没有第二个消费者。
如果 L3 将来需要"负反馈"（别再生成这类），那应该是**衍生提议上的一个评价**，
而不是**火花生命周期里的一个状态**。YAGNI。

> **备选（若拍板要求保留显式的"不感兴趣"）**：三值 `active | archived | dropped`。
> 代价：多一个用户要理解的状态，且它与"已删除"的区别需要一句文案去解释。

**迁移（一次性、幂等、`__sparkStore` 2 → 3）**：

```
pending      -> active
archived     -> archived
dropped      -> deletedAt = <迁移时刻>   （墓碑，可恢复）
crystallized -> archived                 （其记忆已在 hippomemo 中独立存在；火花本身只为历史）
```

实测影响面：9 条记录（8 → `active`、1 保持 `archived`），**0 条走 deletedAt / archived-from-crystallized 分支**。

**连带改动**（一处枚举，全链同步）：`storage.ts` 迁移、`spark-service.ts`、`http.ts` 查询参数、
`stats` 字段名、`graph.ts` 的 `STATE_RANK`、`inbox.ts` 注入分支、UI `FILTERS` / `EMPTY_KEYS` / locale、
以及 6 个测试文件。**这正是不留推导规则的价值**：改一处枚举即可。

### 4.3 P12 — provenance：`origin` + `derivedFrom` + `generation`

```ts
origin: z.enum(['human', 'agent', 'derived']),           // 谁写的
derivedFrom: z.array(sparkIdSchema).max(8).default([]),  // 衍生自哪些火花（空=原创）
generation: z.number().int().min(0).max(2).default(0),   // 衍生代数，硬上限 2（§5.3）
```

`human` 用户写的 / `agent` agent 主动提出 / `derived` 由其他火花衍生。
不变式：`generation > 0` ⟺ `origin === 'derived'`（service 保证）。

**理由**：现状 `sourceAgentId` 实测恒等于 `sourceSessionId`，**机器提的和人提的在数据上分不开**——
既无法在 UI 区分，也无法度量人机产出比。L2 要成立，这是前提。

### 4.4 P13 — 火花的语义召回 + 检索工具（L2 的解锁条件）

现状：火花**没有相关召回**，只有"最近 3 条标题"的状态通报；且 agent **没有任何查/搜/列工具**
（工具表只有 `spark_capture` / `spark_reflect` / 脚本三件套）。要 agent"自己发掘与已有火花相关的创意"，
它首先得**看得见**。

三件事：

1. **抽出 `src/relevance.ts`**：`proposals.ts` 里已有一版 `tokenize`（latin word + CJK bigram）与
   `jaccard` —— **提出来做单一真源**，不要抄第二份（原则 6）。导出纯函数
   `selectRelevant(sparks, query, { limit, minScore })`。
2. **注入升级为两段**（同一个 `agent/pre-step`，同一预算内）：
   - ① 想法池状态（保留现状：计数 + 最近 N 条标题）；
   - ② **相关火花**：按当前会话最后一条用户消息召回，**注入全文**（标题 + 内容）。
   两段与 hippomemo 的召回**首行前缀必须三者互不相同**（沿用 v1 §4.3 纪律），否则模型分不清三类背景。
3. **新增 agent 工具 `spark_search({ query, limit })`** + 只读端点 `GET /sparks/search?q=&limit=`。
   **主动性要求可查询，不是要求更多注入。**

**频率取舍**：v1 的"每 agent 一次"对状态通报是对的，对语义召回是浪费（话题会变）。
v1 只做「**首步注入一次 + 工具按需**」；"话题切换时重注入"列为 Non-goal（成本高、易刷屏）。

### 4.5 P14 — 重新激活 + 召回计数（**不引入新概念**）

现状：一条火花一旦归档，**没有任何路径让它回到活跃**。这是 L1「创意留存」的缺口。

- **自动**：相关召回命中时，给被注入的火花记 `recalledCount += 1` / `lastRecalledAt = now`。
  名字**刻意与 hippomemo 对齐**（它也是 `recallCount`）。这记的是"**被召回**"，**不是"被引用"**——
  不要自欺，召回 ≠ 采纳。UI 文案也用直白说法：「被想起 3 次」。
- **人工**：`reactivate(id)` —— 把 `archived` 拉回 `active` 并记一次召回。UI 动作名「**重新激活**」。

**排序**：面板在 `active` 之内按 `lastRecalledAt`（空值退化到 `createdAt`）倒序。
**不引入"火旺程度 / tier"这类新概念**——排序需要的是时间戳，不是等级（原则 2 + 8）。

### 4.6 P15 — 衍生结果直接落库，**不走提议**

初稿设想给 `ProposalView` 加 `candidate: {title, content, tags}`。**放弃**，两条硬理由：

1. **提议 = 又一处裁决面。** 面板已有记忆 / 待办 / 进化三处对同一记录给结论的面
   （见火花 `29888069`）。再加一处只会加重病灶。
2. **审批门槛会让 L3 的产量等于人的点击量**——正是要消灭的病（原则 5）。

改为：衍生结果**直接是火花**（`origin: 'derived'`，落库即 `active`），谱系记在火花自己身上，
可视化交给 Graph 的第四类边：

```
graph edge 4. `derived`：火花 → 它的父火花（来自 spark.derivedFrom），权重 = 1
```

于是 `ProposalView` **契约不变**，`proposalTypeSchema` 保持 `['link','cluster','prune']`
（它继续只做整理，那是它的正当职责）。

> **备选**：`derive` 提议 + candidate 载荷 + 人工确认队列。代价：多一处裁决面 + 产量受限于点击率。**建议不采用。**

### 4.7 P16 — 语用与命名（成本最低、见效最快）

前面的契约改动若不同时改文字，模型和用户都会按老剧本使用。**必须同批交付。**

**GUIDANCE（`tool.ts`）重写草案**（删掉全部结晶相关表述）：

```
Sparks are ideas — not drafts of anything else. The spark store is where an idea stays alive
until it is useful. Treat proposing ideas as a first-class contribution.

- spark_capture: propose an idea. Do this when the user asks for ideas, and when you notice the
  current conversation could branch somewhere it has not gone yet. This is not a logging duty.
- Ideas beget ideas: use spark_search to find related sparks, then capture the combination.
  Association, analogy and recombination across distant sparks are explicitly wanted.
- Prefer association over summary. A spark that merely restates an existing spark is noise.
- Do NOT capture concrete actionable work — that goes through the regular task tool.
```

**注入 hint**：删掉 `waiting for triage` / `otherwise leave them for the user` 这类队列语。

**面板文案（朴素化）**：

| 位置 | v1 | v2 |
|---|---|---|
| 面板标题 | 灵感收件箱 | **灵感** |
| 筛选：`active` | 待处理 | **活跃** |
| 筛选：`crystallized` | 已转为记忆 | **（删除）** |
| 筛选：`archived` | 已归档 | 已归档 |
| 筛选：`dropped` | 已丢弃 | **（并入「已删除」）** |
| 动作：reactivate | — | **重新激活** |
| 动作：derive | — | **衍生** |
| 动作：crystallize | 结晶 | **（删除；需要时直接告诉 Agent）** |
| 行徽标：origin | — | **我 / Agent / 衍生** |
| 模块副标题 | `Inspiration inbox · crystallize · emergence · scripts` | **`灵感 · 关联 · 脚本`** |

**可机械断言**（进闸门，见 §9.2）：源码与 locale 中不得再出现
`waiting for triage` / `promote it with` / `crystallize` / `已转为记忆` / 火花语境下的`待处理`。

### 4.8 P18 — 挖掘管线的**准入面**：只挖真人说的话（F7）

> 编号说明：本节用本文档自己的期序列（F0–F7）。**F6 = 术语与语义修正**（上文）；
> `docs/architecture-acceptance-*` 里的 F* 是另一套架构评审编号，互不相干。

**触发**：2026-09-23 实测 3080 实库 —— 54 条火花里 **40 条**来自 valence 挖掘，其中
22 条逐字节重复；154 条 pending 提议里 **148 条**是纯伪影。这批条目的内容是 **AI 自己的
指令文本**被贴上「用户偏好」标签存回来（AGENTS.md 10079 字符 / HippoMemo 免责声明 /
技能目录），且 `origin` 全被标成 `human`。

这是 `docs/spark-inbox-design-2026-09-14.md` §9「待确认为 valence 补 provenance 标记」
的延迟爆发：P10/E2 改道（产出火花而非写记忆）解决了「写去哪」，没有解决「准入面」。

**根因链（用真实会话日志逐条复现，非推测）**

| # | 缺陷 | 实证 |
|---|---|---|
| **D1** | `session/event` 的 `user/message` **同时承载注入脚手架**，管线把它当成人说的话 | 真会话 7 条 `user/message` 里 5 条是注入；三个会话重放 23 条候选**全部**来自注入块，真人话语贡献 **0** |
| **D2** | 闸门（`detectIntensity`）与抽取（`extractPreferences`）粒度错位：整条 blob 一个分、整条 blob 跑正则 | AGENTS.md 那段 10079 字符得 **0.60** 分，一次产出 6 条「用户偏好」 |
| **D3** | provenance 错标：`candidateToSparkInput` 不设 `origin`，靠 wire schema 的 `default('human')` 兜底 | 40/40 条机器产物在库里与人手写的无法区分（除 `sourceSessionId` 魔法字符串） |
| **D4** | 跨会话零去重：每个新会话重新注入同一份脚手架 → 重复挖出同一批短语 | 3 个会话 23 个候选只有 9 个唯一（冗余 **61%**）；实库 40 条里 22 条逐字节重复 |
| **D5** | link 提议被标题模板前缀放大 | 148 条 link 全部是两条挖掘条目互指，**146 条**剥掉模板前缀后真实相似度 = **0.00** |

**设计决定（四道防线 + 一条判据）**

1. **D1 只认真人话语**：判据是**结构性白名单** `data.source.kind === 'user'`，不是启发式。
   权威定义见 `@deepseek-ai/dsh-llm` 的 `MessageSourceMap`（merge-extensible，明言
   「switch on `kind` and fall through unknowns」）—— **因此写白名单而不是枚举已知注入类型**，
   对将来新增的 kind 天然免疫。**这条不变量不得回退成黑名单。**
2. **D2 闸门与抽取作用于同一条话语**：`minePreferences(text, config)` 收口长度闸
   （`maxUtteranceChars`，默认 2000，**纵深防御**：真人粘一整篇文档同样不该被当成偏好来源）
   + 强度闸 + 抽取，并返回短路理由（可断言）。
3. **D3 provenance 显式**：`candidateToSparkInput` 声明 `origin: 'agent'`。
   —— 这**不是设计变更，而是实现违反了 §4.1 表格里早已写明的 `origin: 'agent'`**。
4. **D4 捕获前与池比实质面相似度**，阈值复用 `derive.ts` 的 `RESTATEMENT_THRESHOLD`（0.85）：
   仓库里只能有一份「多像算同一条」的定义。**不能照抄 `checkRestatement`**（它只比标题）
   —— 本管线标题是模板化的，模板前缀贡献 6 个 token 里的 5 个，比标题必然永远判重。
5. **D5 link 判据 = 实质面 + 池级模板抑制**
   - `substanceTokens` = 标题 + 正文，**刻意不含 tags**。tags 是显式共享标签，那是 `cluster`
     提议的职责；两边都算等于同一份证据计两次（实测把 link 从 2 条放大到 72 条）。
     **它因此与召回用的 `documentTokens`（标题×2 + 正文 + tags）不同，这是刻意的，不要"统一"。**
   - `boilerplateTokens` = 在池里**过半**文档都出现的 token（`ratio 0.5` 是实测量值：
     0.4→3 条 / 0.5→**1** 条 / 0.6→9 条 / 0.7→62 条，基准为清理前实库的 30 条候选）。
   - 关键性质：**在健康池上是 no-op**（实测剔除挖掘记录后的池抑制 **0 个 token**、判定逐对零变化）；
     池小于 `MIN_DOCS_FOR_BOILERPLATE`(5) 时不启用（否则 N=2 的池永远不比中 ——
     而「只有两条火花」正是 link 的主要用途）。
   - **不引入 IDF 权重或向量检索**（§10 Non-goals）；DF 只是池统计量。

**判定必须可脱离宿主单测**：D1/D2 的判定收进 `valence.ts` 的纯函数
（`isRealUserMessage` / `minePreferences` / `isDuplicateOfPool`），service 只做装配。
理由同 `command-mining.ts`：真宿主上只有日志能看见的分支，必须被单测钉住 ——
新增 7 条**装配**测试（真 cordis Context 驱动 `session/event`），因为「判定对 ≠ 接线对」。

**验证方法（可复用）**：解压 `~/.dsh/sessions/**/session.v3.jsonl.zstd`（`zstd -dc`），
把 `user/message` 事件重放新旧两版逻辑，与真实库逐条对账。最硬的一次：污染源会话
`session-df9672ce` 的真实载荷用旧逻辑产出**恰好就是库里那 10 条**（逐条对上，含重复项），
新逻辑 **0 条**。

**同类缺陷的第二处（已排查，结论是不需要改）**：`inbox.ts` 的 `lastUserText(messages)`
曾疑似同样把注入当用户话语。查 `dsh-agent-loop` 的 `preStep` 后确认 `payload.messages`
只是 `inbox.claim()` 的真人输入（注入进的是 `decision.messages` 累加器，插件代码用
`[...decision.messages]` 追加是对的），**故不动它**。

**配套修复（同批，独立提交）**

- `dev-harness/real-host-check.mjs` 的图谱边断言原为硬写 `['tag','proposal']`，而契约是
  三类边（`derived` 是 F2 加的）。按 AGENTS.md 铁律 5 改为**从契约源码读枚举**，解析失败即抛错。
- 4 个**从未被任何闸门执行**的测试文件接进 `test` 脚本（`relevance` / `derive` /
  `derive-service` / `graph`）—— 它们是 `test/*.test.ts` 而根 `vitest.config.ts` 只收
  `packages/*/tests/**/*.spec.ts`，**F5 的编排测试一直在裸奔**。spark 包测试 124 → 171。

---

## 5. L3：衍生引擎（P17）

### 5.1 输入面：**只有火花**

| 输入 | 用途 | v1 |
|---|---|---|
| `active` 火花（**同 scope**） | 唯一输入：关联 / 联想 / 重组 | ✅ |

**记忆不作为引擎输入**（决定一）。理由不是"记忆没用"，而是**不需要**：
hippomemo 自己的召回已经把相关记忆注入了同一段会话，**模型在提议火花时自然能用到它们**。
把记忆塞进引擎的输入面，等于在插件层重建一座刚拆掉的桥。

（`ScriptView` 作为"方法源"排后，且同样只能在火花域内利用。）

### 5.2 闸门：用**过期**代替**审批**

衍生火花直接落库，但带：

```ts
expiresAt: now + 14d     // 仅 origin='derived' 的记录非空
```

到期仍**从未被召回、未被重新激活、`recalledCount` 为 0** → 自动改为墓碑（`deletedAt`，可恢复）。

- **过期是惰性的**：在 `inbox.ts` 已有的 reflect 脏标记那一趟顺手清（复用同一入口，**不用定时器**）。
- 噪声由"会过期"兜底，而不是由"要人点"兜底（原则 5）。

### 5.3 反自噬：防近亲繁殖

衍生火花若再作为下一轮输入，几轮之后必然退化成**自我复述**（语义塌缩）。三条硬约束：

1. `generation = max(父火花 generation) + 1`，**硬上限 2**（`generation=2` 不再参与衍生）。
2. v1 中 **`origin='derived'` 的火花不作为衍生输入**（只允许原创想法作父本）。
3. 产出必须与输入集合**去重**：与任一父辈或已有火花的标题 token Jaccard **< 0.85**
   （否则它是复述，丢弃并记录拒绝原因）。

### 5.4 与决策分级层的关系

`docs/SPARK-DECISION-ENGINE-SPEC.md` 的接缝 S1–S5 都是**判断**（去重 / 排序 / 定夺）；L3 是**生成**，
不进决策分级链——生成没有"初判 vs 精判"之分。可复用的是它的 **provider 抽象与成本护栏**
（预算、超预算退回、`dataIncludeGlobal=false` 时 global 内容不外发）。
**若未来纳入，应作为新接缝 S6 单独登记，不要塞进 S4。**

### 5.5 涌现的定义与归属（2026-09-21 修正，**术语三分**）

初稿把 `link/cluster/prune` 叫「涌现提议」、把生成叫「衍生」，两者都不对。修正后的口径：

| 术语 | 是什么 | 谁做 | 判据 |
|---|---|---|---|
| **整理** | `link / cluster / prune`：去重、归类、清理陈旧条目 | **静态规则**（确定性、零成本，规则化在这里是对的） | token Jaccard 阈值、共享标签数、陈旧天数 |
| **衍生** | 两两重组出候选（association / analogy / recombination） | 规则**只做初筛**候选对；**判断与生成交给模型** | 规则初筛 + 模型生成 + 复述去重 |
| **涌现** | **量变 → 质变**：一堆小火花悄悄攒成了一个新层级的东西（模式 / 原则 / 概念） | **Agent 的判断**（插件不实现、不打标、不设阈值） | **没有可规则化的判据** |

**三条硬口径（D1–D4）**：

- **D1**：插件里**不存在**涌现引擎，也**不新增** `emergent` 之类的标记。涌现若发生，产物就是
  Agent 自己写下的一条普通火花（`origin='agent'`）。
- **D2**：`origin` 与 `derivedFrom` **正交**——`origin` 只回答"**谁判断的**"
  （`human` / `agent` / `derived`＝机器自动生成），`derivedFrom` 只回答"**据什么来的**"
  （任何提出者都可以自述，它不改变 origin）。
- **D3**：反自噬闸（`generation ≤ 2`、`derived` 不作父本）**只作用于 `origin='derived'`**
  这条会滚雪球的机器路径。**人 / Agent 的判断产物不受限**——判断不该被防滚雪的规则挡住，
  也可以拿早期衍生物当父本；其 `generation` 按父辈计算但夹到 schema 上限。
- **D4**：`expiresAt`（TTL）**只作用于 `derived`**：机器批量生成的噪声由过期兜底，
  Agent 判断的产物不自动消失。

**量变为什么不能交给规则**：量变本身就是一个**判断**（这批碎片是否已经攒到该长出新东西），
它不满足"确定性可判"（`SPARK-DECISION-ENGINE-SPEC` §1 对静态规则的限定），因此既不该写成
阈值，也不该登记进决策分级链的静态侧。插件的职责退回到**提供条件**：视野（注入 + `spark_search`）、
病据（计数 / 时间 / 来源这些原始数字，`AGENTS.md` §3.8：宿主下发病据、不下发结论）、写入面
（`spark_capture`，含可选的 `derivedFrom` 自述来源）。

### 5.6 实现轮廓（不锁死）

```
候选对选择（确定性，免费）:
  相似度落在【中段区间】的火花对优先 —— 太像=重复，太不像=无关，中段才是组合的甜点
  + 标签远距离对（不同标签但标题共享关键词）
        ↓ 每轮最多 M 对（默认 8）
LLM 重组（可选注入 ctx.inject(['llm'])；缺失 → 本轮不生成，不报错）
  strict schema: { sparks: [{ title, content, tags, derivedFrom }] } ≤ K 条（默认 3）
  每条必须带一句生成理由（理由进日志，不进契约）
        ↓ 去重 / generation 检查 / 预算检查
落库为 origin='derived' + expiresAt
```

---

## 6. UI / IA

- **面板标题**：「灵感」。筛选位：**活跃 / 已归档 / 已删除**（+ 计数）。**取消「已转为记忆」**。
- **默认排序**：`lastRecalledAt` 倒序（空值退化 `createdAt`）。**不引入等级/热度概念**。
- **每行动作**（按重要性）：**衍生 / 重新激活 / 归档 / 删除**。（结晶动作删除。）
- **行徽标**：`origin` → 我 / Agent / 衍生；`generation ≥ 2` 的行加一句"衍生自衍生"的提示文案。
- **Graph 子页**：`tag` / `proposal` / `derived` 三类边，**不再有记忆节点**。
- **空态**：不说"全部处理完了"（那是收件箱的正反馈）；说"这里还没有想法" + 一个 `spark_capture` 的提示。
- 遵循 `docs/UI-UX-SPEC.md`（四态反馈 / aria / token 标度）；`pnpm preview:verify` +
  `pnpm check:contrast` 必跑；文案一律走 locale（`SparkModule.tsx` 的历史硬编码中文**必须一并清掉**）。

---

## 7. 与 hippomemo 的关系：零直连

```
   [ 记忆 HippoMemo ]                    [ 火花 Spark ]
          │                                     │
          └── 各自的 agent/pre-step 注入 ────────┘
                          ↓
                同一段会话上下文中的 Agent
                          ↓
         （若判断某条火花值得成为信念，自己调 memory_remember）
```

| 事项 | 结论 |
|---|---|
| 插件间通道 | **零**（无工具、无端点、无字段、无图边） |
| 各自注入 | 完全独立、互不感知；三类注入（记忆召回 / 火花状态 / 相关火花）**首行前缀必须可区分** |
| 融合 | **Agent 判断**（模型层），不在契约层 |
| `sourceSparkId` | 停止写入 + 移除展示；**存量不迁移**（实测全空） |
| `memory_remember` | **不加任何包装**：Agent 直接用它 |
| 模型弱项（v1 D 档） | 不再直写 hippomemo；改为产出火花（或保持默认关） |
| 不变量 | **INV-F1：`dsh-spark` 永不写 `dsh-hippomemo`；`dsh-hippomemo` 永不读 `dsh-spark`** |

---

## 8. 分期

| 期 | 交付 | 依赖 | 备注 |
|---|---|---|---|
| **F0** | **文档止血**：v1 文档取代横幅、`dsh-spark/README.md` 漂移回写 | 无 | ✅ 2026-09-21（不改 src，无需 bump） |
| **F1** | **解耦（P10）+ 状态枚举回退（P11）+ 命名与语用（P16）** | 无 | ✅ 2026-09-21（commit 186484c；wire 0.3.0 / spark 0.5.0 / dock 0.4.0 / hippomemo 0.4.0；AC-1 补 `ctx.memory` 禁令、新增 AC-2 `sparkwording` 闸门） |
| **F2** | provenance（P12）+ Graph 第四类边 + 门控色调（`origin` 徽标） | F1 | ✅ 2026-09-21（commit 694385d；wire 0.3.1 / spark 0.5.1 / dock 0.4.1；`resolveProvenance` 是三条不变式的唯一计算者，存储 v3→v4 回填存量 origin） |
| **F3** | 语义召回（P13）+ `spark_search` 工具 + 端点 | F1 | ✅ 2026-09-21（commit 见 git log；spark 0.6.0；抽 `src/relevance.ts` 为召回/涌现共用的单一真源，**顺带修正 v1 的 CJK 切词 bug**：旧实现把连续汉字累积成一个 token，中文召回实际上从未工作） |
| **F4** | 重新激活 + 召回计数（P14） | F1 | ✅ 2026-09-21（spark 0.7.0；`reactivate()` + 注入命中记 `recalledCount`/`lastRecalledAt`，**不动 updatedAt**；面板按 `lastRecalledAt` 倒序，空值退化 `createdAt`；存储 v4→v5 回填） |
| **F6** | **术语与语义修正**：整理/衍生/涌现三分 + origin⊥derivedFrom + 反自噬只作用于机器生成 + TTL 只作用于机器生成（D1–D4） | F1–F5 | ✅ 2026-09-21（UI 正名「整理」；`spark_capture` 增 `derivedFrom` 自述来源；preview capture 改吃真源 `resolveProvenance`） |
| **F5** | 衍生引擎（P15 + P17） | F2/F3 | ✅ 2026-09-21（spark 0.8.0；纯逻辑在 `src/derive.ts`、IO 在 `derive-service.ts`；LLM 面用 try/catch 结构读、缺失即 `skipped`；`POST /sparks/derive` 带 `dryRun` 作为零成本断言面；过期清理复用 `spark-inbox` 首步那一趟，**无定时器**；存储 v5→v6 回填 `expiresAt=null`） |
| **F7** | **挖掘管线准入面（§4.8 P18）**：D1 只认 `source.kind==='user'` + D2 闸门与抽取同一条话语 + D3 provenance 显式 + D4 跨会话实质面去重 + D5 link 剔模板（详见 §4.8） | F1–F6 | ✅ 2026-09-23（commit 98a39b6；spark 0.9.0→**0.10.0**；新纯函数 `minePreferences` / `isRealUserMessage` / `buildDedupPool` / `isDuplicateOfPool` / `substanceTokens` / `boilerplateTokens` / `jaccardWithout`；配置面 `valence{enabled,intensityThreshold,maxUtteranceChars}` **默认开启**；spark 包测试 124→171） |

**排序依据**：**先拆桥并改对窗户上的字（F1）→ 再让 agent 看得见旧想法（F3）→ 最后才让它生想法（F5）。**
反过来做的话，F5 会产出一堆没人看得见、也辨不出真假的机器文本。

---

## 9. 验收与度量

### 9.1 验收链（沿用 v1 §10.2，每期顺序执行）

```
pnpm -r build → pnpm -r typecheck → pnpm -r test     # 不可并行（AGENTS.md §4）
pnpm check:all          # 架构 + 对比度 + audit-tokens + 版本 bump
pnpm preview:verify
pnpm sandbox:install && pnpm sandbox:up --detach
node dev-harness/real-host-check.mjs                 # 退出码 0
```

- 注册面改动必须以 `/__dev/probe` 的 typert 注册面断言为准（铁律 4）。
- 注入类改动必须**两头断言**：注入发生了 + **不该注入时不注入**。
- **删除类改动（F1）也必须断言**：被删端点应返回 404 / 未注册，而不是"面板看着没变"。

### 9.2 可机械断言的反模式防线

`AGENTS.md` §5：新增反模式防线 → **加进闸门脚本或单测**，而不是只写文档。

| # | 断言 | 形式 |
|---|---|---|
| AC-1 | **跨插件零引用**（INV-F1）：`dsh-spark/src` 无 `ctx.memory` / hippomemo 符号；`dsh-hippomemo/src` 无 `ctx.spark` / `sourceSparkId` 写入 | **闸门脚本** |
| AC-2 | **朴素文案**：源码 + locale 不再出现 `crystallize` / `已转为记忆` / `waiting for triage` / 火花语境的`待处理` | **闸门脚本**（grep） |
| AC-3 | **不复述**：任何 `derived` 火花与输入集合的标题 Jaccard < 0.85 | 单测 |
| AC-4 | **不滚雪球**：`generation ≤ 2`，且 `origin='derived'` 不作为衍生输入 | 单测 |
| AC-5 | **过期真的会清**：`expiresAt` 到期 + 零召回 → `deletedAt` 非空（可恢复） | 纯函数单测 + 惰性触发断言 |
| AC-6 | **注入三方互不混淆**：记忆召回 / 火花状态 / 相关火花 三者首行前缀互不相同 | 单测 |
| AC-7 | **客户端无状态推导**：状态只有一个枚举真源，客户端不自行推导（v1 P1 教训） | 架构闸门 |
| AC-8（F7） | **挖掘只吃真人话语**：`source.kind !== 'user'` 的 `user/message` 一条都不落库（白名单，非黑名单） | 纯函数单测 + **装配**单测（真 cordis Context 驱动 `session/event`） |
| AC-9（F7） | **模板抑制在健康池上是 no-op**：剔除挖掘记录后的池抑制 0 个 token、link 判定逐对零变化；只有被模板淹没的池才收敛 | 单测（双向：模板池 → 0 条 link；健康池 → 真对仍成 link） |
| AC-10（F7） | **挖掘产物不是人类原创**：`candidateToSparkInput` 必带 `origin: 'agent'` | 单测 |

### 9.3 成功指标（KPI 反转）

| v1 指标（收件箱） | v2 指标（想法池） | 目标方向 |
|---|---|---|
| 待处理数下降 | **再想起率**：`active` 中 `recalledCount > 0` 的占比 | 上升 |
| 提议接受率 | **衍生转化率**：`derived` 火花中进入 `active` 后仍未被清理的占比 | > 0 |
| — | **想法存活天数**：从创建到墓碑（或"仍活跃"）的中位天数 | 太短=漏，太长=堆垃圾（先观测再定区间） |
| — | **人机产出比**（`human : agent : derived`） | 三者都 > 0（任何一档为 0 都是病） |

**关键**：v1 的指标奖励"把火花清空"，v2 的指标奖励"想法还在并被再次想起"。

---

## 10. Non-goals（本期明确不做）

- **火花与记忆之间的任何直接通道**：不提工具、不加字段、不画图边、不做面板联动（决定一）。
- **自动捕获**（无差别把会话内容存成火花）——**仍然禁止**。注意与 L2 的边界：
  L2 是**有判断地提出想法**（可拒绝、可为零条），不是"把会话倒进库里"。
- 用户可见的隐喻命名（壁炉 / 在燃 / 复燃 / 熄灭 / 火旺程度）。
- 向量检索 / embedding 召回（沿用 token Jaccard；§5.5 的"中段相似度"启发式也不需要 embedding）。
- `intervalMs` 定时调度器（`AGENTS.md` §1.3）；过期清理走惰性触发。
- 衍生自噬（`generation > 2`）与 `derived` 作父本。
- 跨 scope 衍生（v1 限同 scope；global 内容不外发，沿用 `dataIncludeGlobal=false` 纪律）。
- **话题切换时重注入**（v1 只做首步一次 + 工具按需）。
- **涌现引擎**（§5.5 D1）：插件不判定"是否已经量变"、不设临界阈值、不新增 emergent 标记；
  也不把它登记进决策分级链——那是个判断，归 Agent（`SPARK-DECISION-ENGINE-SPEC` 已列入"明确不接"）。
- 悬浮球角标（v1 P4 未做，结论不变）。
- 力导向图的交互升级（只加第四类边）。

---

## 11. 开放问题（P10–P18，需拍板）

| 编号 | 问题 | 我的倾向 |
|---|---|---|
| **P10** | 是否删除 spark → memory 的三条直连 + hippomemo 的回指与图边 | ✅ **已拍板并落地（F1）**：全删。实测 0 条数据受影响；融合交给 Agent（`memory_remember` 已存在） |
| **P11** | 状态枚举回退到 `active \| archived` + 墓碑，还是保留 `dropped` | ✅ **已拍板并落地（F1）**：回退到两个值；`dropped` 并入墓碑（存储 v2→v3 迁移） |
| **P12** | `origin` 是否三值 | ✅ **已拍板并落地（F2）**：三值 `human/agent/derived`；`resolveProvenance` 保证 `generation > 0 ⟺ derived` 与上限 2 |
| **P13** | 语义召回的频率 | ✅ **已拍板并落地（F3）**：首步一次 + `spark_search` 工具；重注入列为 Non-goal |
| **P14** | 是否引入"热度/等级"概念 | ✅ **已拍板并落地（F4）**：不引入。排序用 `lastRecalledAt`（空值退化 `createdAt`）+ `recalledCount` 倒序即可 |
| **P15** | 衍生结果走"直接落库 + 过期"还是"提议 + 审批" | ✅ **已拍板并落地（F5）**：直接落库 + `expiresAt`（14 天，仅 derived）；到期且零召回 → 墓碑 |
| **P16** | 命名回退的范围 | ✅ **已拍板并落地（F1）**：提示词 + 工具描述 + 注入 hint + 面板 locale 同批交付；AC-2 `sparkwording` 闸门守线 |
| **P17** | L3 的 LLM 面是否必需 | ✅ **已拍板并落地（F5）**：可选（`ctx.llm` / `ctx.agentDefaultModel` 结构读，缺失 → `skipped`，不报错）；沿用 hippomemo evolve 先例 |
| **P18** | valence 挖掘的**准入面**：是否默认开启、以及"只挖真人话语"的判据形态 | ✅ **已拍板并落地（F7，§4.8）**：**默认开启**（它属于 L2「Agent 是平等的提出者」的产品定位，与 `commandMining` 默认关的理由不同）；准入判据取**结构性白名单** `source.kind === 'user'`（merge-extensible 类型，不用枚举注入类型）；去重阈值复用 derive 的 0.85 而不另立 |

---

## 附录 A：v1 遗产的处置

### A.1 仍然成立（承继）

- **§7 数据安全**：丢失更新修复（read-modify-write 同一临界区）与墓碑删除 —— v2 的
  `expiresAt` / `deletedAt` 全部建立在墓碑之上，**不可回退**。
- **§9 / §13 契约与兼容纪律**：自用不承担兼容义务，但数据迁移必须幂等 + 带版本号；
  不改 `AGENTS.md`；破坏性 commit 写清迁移路径。
- **§10.2 验收链**与"注册面断言优先于渲染"（v2 加一条：**删除也要断言**）。
- **§4.3 注入可区分**（三类注入首行前缀不同）。
- **不用定时器**；**D 档噪声防线**；**C 档脚本匹配**。
- **§12 的多数 non-goal**（拦截式注入、向量检索、力导向图交互、自动捕获）。

### A.2 作废或需重述

| v1 位置 | 处置 |
|---|---|
| §1.3「没有回收回路」诊断 | **作废**（`inbox.ts` A/B/C/D 已落地）——§2.6 的止血项 |
| §4.1 `inboxState` 四值枚举 | **回退**为 `active \| archived` + 墓碑（P11） |
| §4.1 的 `pending` / `dropped` 命名 | **删除**（P11） |
| §4.1 `crystallized` 状态与字段 | **删除**（P10） |
| §6「火花结晶去向：现有 `spark_crystallize`，不改」 | **推翻**：该通道整条删除（P10） |
| §8.1「空态：全部处理完了」正反馈 | **作废**（那是收件箱的正反馈） |
| §10.3 成功指标 | **反转**（§9.3） |
| §12「自动捕获」non-goal | **保留但重述**：区分"无差别自动捕获"（仍禁）与"Agent 有判断地提出想法"（L2，允许） |

### A.3 v1 评审项 P1–P9 的去向

| v1 | 状态 |
|---|---|
| P1（显式 `inboxState`） | **部分承继**：显式枚举 + 不留推导规则 ✅；但枚举值回退（P11） |
| P2（注入语言与预算） | ✅ 沿用（英文、`maxChars≈800`）；P13 在该预算内加第二段 |
| P3（惰性触发，无定时器） | ✅ 沿用为硬约束（过期清理也走这条路） |
| P4（悬浮球角标） | 未做，v2 结论不变 |
| P5（建议式注入） | ✅ 沿用 |
| P6（valence provenance） | **升级为 P10/E2**：不只是补标记，而是**改道**（产出火花，不写记忆） |
| P7（火花 UI 包化） | 未做；v2 的 UI 改动量增大后优先级上升，但不在本期 |
| P8（命令挖掘默认关） | ✅ 沿用；其"写 hippomemo"的出边按 P10/E3 处理 |
| P9（`check:compat` 闸门） | 未做，结论不变 |

---

## 附录 B：命名规范（v2 生效）

### B.1 三层规则

1. **契约字段**：中性、通用、可检索（`status` / `origin` / `recalledCount` / `derivedFrom`）。
2. **locale 文案**：通用词，优先选用户**在别处已经见过**的（活跃 / 归档 / 删除 / 衍生 / 重新激活）。
3. **本设计文档的动机描述**：允许一句隐喻，**不得进入 1 与 2**。

### B.2 对照表

| 概念 | 初稿（否决） | v1 | **v2** | 契约字段 |
|---|---|---|---|---|
| 火花的默认状态 | 在燃 | 待处理 / `pending` | **活跃** | `status: 'active'` |
| 不活跃但保留 | — | 归档 / `archived` | **已归档** | `status: 'archived'` |
| 不要了 | 熄灭 | 丢弃 / `dropped` | **已删除**（墓碑） | `deletedAt` |
| 沉淀为记忆 | 结晶（罕见例外） | 已转为记忆 / `crystallized` | **（无此动作）** | — |
| agent 写想法 | — | 捕获 / capture | **提出**（工具名暂不改，语义改） | `origin: 'agent'` |
| 火花生火花 | 派生 | — | **衍生** | `origin: 'derived'` + `derivedFrom` |
| 旧火花重新活跃 | 复燃 | — | **重新激活** | `reactivate()` + `recalledCount` |
| 被想起来的次数 | 火旺程度 / tier | — | **被想起 N 次** | `recalledCount` / `lastRecalledAt` |
| 整理类涌现 | — | 涌现提议 / emerge | **不变** | `ProposalView`（`link/cluster/prune`） |
