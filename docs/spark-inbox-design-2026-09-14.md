# 火花认知层改造设计（v1 草案）

> ### ⚠️ 已被取代（2026-09-21）——读本文前先读新文档
>
> **取代者**：[`docs/spark-v2-design-2026-09-21.md`](./spark-v2-design-2026-09-21.md)（v2）。
> v1 把火花做成了「记忆的进料口」（收件箱 IA + `pending` 待处理 + 成功=清空 + 面板里有「已转为记忆」）；
> v2 的两条 headline 决定是：**① 火花与记忆各自独立、插件间零直连**（融合交给 Agent）；
> **② 朴素命名**（回退 `pending`/`crystallized` 这批评名与「收件箱」IA）。
>
> **已作废**：§1.3「没有回收回路」的诊断（`src/inbox.ts` 的 A/B/C/D 四档**均已落地**，
> 本节的实测数据是 09-14 的快照）；§4.1 的 `inboxState` 四值枚举（v2 回退为
> `active | archived` + 墓碑）；§6「火花结晶去向：现有 `spark_crystallize`，不改」
> （**该通道整条删除**，v2 §4.1）；§10.3 的成功指标（v2 反转为再想起率 / 衍生转化率）；
> §8.1「全部处理完了」的空态正反馈。
>
> **仍然成立**（v2 附录 A.1 承继）：§7 数据安全（丢失更新 + 墓碑删除）、§9 / §13 契约与兼容纪律、
> §10.2 验收链、§4.3 注入可区分、§12 的多数 non-goal（不用定时器 / 无向量检索 / 建议式注入）。
>
> **v1 评审项 P1–P9 的去向**见 v2 附录 A.3（P6 升级为 v2 的 P10/E2：valence 改道）。
>
> 保留本文作为历史记录（v2 的多处设计与它的教训直接相关，尤其 P1「不留推导规则」）。

> 状态：**草案，待拍板**（2026-09-14）——**已被取代，见上方横幅**
> 范围：dsh-spark / dsh-spark-dock 的火花收件箱语义、会话编排层、程序性匹配、以及 dsh-hippomemo 的协作面
> 前置阅读：`AGENTS.md`、`docs/UI-UX-SPEC.md`、`packages/dsh-spark/README.md`、`packages/dsh-spark-wire/src/index.ts`
> 本文只写设计与验收口径，**不含实现**；每期开工前先更新本文（P* 编号追踪评审项）。
> **前提（2026-09-14 补充）**：本插件集**仅自用**，不面向第三方安装者 —— 因此**不承担向后兼容义务**（见 §9）。

---

## 0. 摘要

**定位变更**：火花从「随手记的记事本」升级为**人类与大模型共用的灵感 inbox（收件箱）+ 关联引擎**。

- 对人：灵感稍纵即逝 → 捕获必须低摩擦；inbox 必须**可见**（有多少没处理）、**可清空**（处理/丢弃）。
- 对模型：火花的价值不在存储，而在**消费**——跨会话聚合、寻找共通点、做超出人类联想上限的关联。

**核心诊断**：现在的火花是**只写不读**的结构。捕获之后没有任何回路把火花送回对话，所以它必然是坟场。同一病灶还出现在另外两处预留接口上（`triggers`、涌现提议）。

**四档改造**（建议按序）：

| 档 | 内容 | 价值 | 风险 |
|---|---|---|---|
| A | 火花变真 inbox：待处理语义 + 会话首步注入 + 计数可见 | 立刻把坟场变成收件箱 | 低 |
| B | 提议自动化：脏标记 + 惰性触发（**不用定时器**） | 涌现提议不再靠手点 | 低 |
| C | 脚本 `triggers` 接 `agent/pre-step`：建议式注入「有现成脚本」 | 「减少重复写代码」的落点 | 中 |
| D | 命令失败挖掘：model × 命令模式 → 沉淀为弱项约束 + 修正脚本 | 可度量的能力补偿实验 | 中高 |

另有一项**必须与 A 同期做**的账：**丢数据修复 + 删除审计**（见 §7）。

---

## 1. 现状诊断（全部有证据）

### 1.1 真实环境实测（`~/.dsh`，2026-09-14）

```
GET /sparks                 -> 2 条（均 active / project，创建于 09-12）
GET /proposals              -> 0 条（proposals.jsonl 文件不存在 → reflect 从未在真实环境运行）
GET /scripts                -> 0 个（sparks/scripts.jsonl 不存在）
对照：沙箱 .dev/home        -> 44 条（此前走查/验收造出）
```

### 1.2 三处「预留了接口但没接线」

| 预留 | 位置 | 现状 |
|---|---|---|
| `triggers` 检索匹配 | `dsh-spark-wire/src/index.ts:131` 注释「Phase 5.5: tool auto-suggest when an agent's recent tool sequence matches」；`script-service.ts:4-6` 同样标注 Phase 5.5+ | **字段已存，无任何消费者** |
| 涌现提议自动化 | `README.md`：auto-scheduler 属 Phase 4.5 | 仅手动 `POST /proposals/reflect` |
| 关联图（Graph 子页） | README：Phase 7 | 空态占位，无 CTA |

### 1.3 没有回收回路

- 火花的系统提示段（`dsh-spark/src/tool.ts:32`，`order: 116`）**只有工具用法说明**——告诉模型怎么"存"，没有一个字告诉它"库里有什么"。
- 对照：hippomemo 的 `dsh-hippomemo/src/context.ts:64` 用 `agent/pre-step` 中间件在首步注入召回结果。**同一个机制，火花完全没用**。
- 结果：火花存进去之后不会被注入、不会在下次会话提醒、不会进 todo。

### 1.4 唯一自动运转的部分，产出物不在火花面板

`ValenceService` 在 `dsh-spark/src/index.ts:56` 被**无条件实例化**，订阅 `session/event`（`valence-service.ts:79`），强度 ≥0.4 时把挖掘出的偏好写进 **hippomemo**（`kind='preference'`），不写火花。

> 待确认：真实库有 6 条 preference，措辞与 valence 的挖掘模式吻合，但全部记录的 `updatedBy` 都是 `system`，**字段上无法区分来源**，故不能断言。建议为 valence 写入补一个可辨识的 provenance 标记（见 §9）。

### 1.5 架构不对称

火花的 UI 不在 `dsh-spark` 包里，而硬编码在 **`dsh-spark-dock/src/client/spark/`**（`SparkDockModule` / `SparkModule` / `sparkApi` / `remote`）。五个 dock 模块里只有它是「壳自带 UI」，另外四个都各自 `registerDockModule` 自注册（ADR-003）。后果：改火花 UI 必须动 dock；与「新增插件不改 dock 任何代码」相悖。

附带发现：`SparkModule.tsx` **没有任何 locale 用法**（`'捕获火花'`、`aria-label="标签（逗号分隔）"` 等为硬编码中文字面量），与 AGENTS.md §3.4「文案必须走 locale 字典」冲突。

### 1.6 丢数据（详见 §7）

`.bak-1789313335723`（09-13 22:39 快照）4 条 → 当前 `sparks.jsonl`（09-13 23:28 重写）2 条；幸存两条 `updatedAt` 停在 09-12，说明**写入者手里的快照早于 09-13 14:37**——典型的丢失更新，不是删除。

---

## 2. 设计原则

1. **只写不读是反模式。** 任何写入类能力上线前，必须能回答：*它什么时候被消费？由谁消费？* 答不出来就不该加存储。
2. **触发点决定归属，包只决定实现位置。** 划分维度是「何时被想起 × 注入到哪」，不是「算记忆还是算认知」。
3. **建议优于拦截。** 注入一律是「这里有个更好的写法」，绝不改写/拒绝命令——拦截式注入会把正常工作流卡死，且难以证伪（见 §11 P5）。
4. **不要定时器。** AGENTS.md §1.3 明令：轮询模拟事件是反模式。Phase 4.5 设想的 `intervalMs` 调度器**不采用**，改为**脏标记 + 惰性触发**（§5.3）。
5. **关联的产出必须可操作。** 「普遍联系」落到产品上是 link / 合并 / 淘汰 / 结晶这些**动作**，图只是它们的可视化，不是目的。
6. **度量先行。** 每档改造都要有可测的成功指标（§10），否则无法判断"存在感"是否真的提升。

---

## 3. 模块边界（回答"脚本目录该谁管"）

**结论：脚本留在 spark，不搬进 hippomemo。** 但必须新建**会话编排层**（触发层），而它才是当前真正缺失的东西。

| 资产 | 何时被想起 | 注入到哪 | 归属 | 现状 |
|---|---|---|---|---|
| 声明性记忆（决策/事实/偏好） | 语义相关 | 会话首步 | hippomemo | ✅ 在跑 |
| 程序性脚本（"云函数"） | **命令/意图模式匹配** | **执行之前** | spark scripts | ❌ 触发层缺失 |
| 模型的命令弱项 | **model × 命令模式** | 首步 + 失败后即时 | 声明侧 hippomemo（`modelIds`）/ 程序侧 spark script | ❌ 采集层缺失 |
| 灵感火花 | 人主动看 / 关联引擎被动扫 | inbox UI + 提议 | spark | ⚠️ 有存储无消费 |

**不搬的三条理由**（与"重要性"无关）：

1. **数据结构不同**：`ScriptView` 含 `steps[]` / `triggers[]` / `invocationCount` / `successCount` / `successRate`——是可执行资产 + 统计体；`MemoryRecord` 是文本 + `revision` / `supersedes` / 引用计数。把 `steps` 塞进 `content` 字符串就丢掉可执行性。
2. **检索方式不同**：记忆靠语义相关召回；脚本靠命令模式匹配。共用一套检索器会互相拖累。
3. **契约成本**：hippomemo 的 wire/host 已稳定；并入脚本会使其 schema 随脚本演进（两包版本联动 + 真宿主重验）。

**保留的协作面**：hippomemo 的 `modelIds` 字段（per-model error notebook）已经是为「按模型门控的知识」设计的，且进化引擎对 `modelIds` 非空的记录**豁免 consolidation/probation/downgrade**（`memory-evolve.ts:203-209`）。命令弱项应走这条通道，不另造一套。

---

## 4. 数据模型与契约变更（wire）

### 4.1 火花收件箱状态：**显式状态机**（不再推导）

**前提**：本仓库插件仅自用（见 §9），不存在老客户端，因此这里选**最清晰**的模型而不是最兼容的模型。

把 `sparkStatusSchema ('active' | 'archived')` 替换为单一真源的收件箱状态：

```ts
export const sparkInboxStateSchema = z.enum(['pending', 'crystallized', 'dropped', 'archived'])
```

| 状态 | 含义 | 进入方式 |
|---|---|---|
| `pending` | 待处理（收件箱里的东西） | 捕获时默认 |
| `crystallized` | 已沉淀为记忆 | `spark_crystallize` / 面板「结晶」 |
| `dropped` | 判定为无价值 | 面板「丢弃」（二次确认） |
| `archived` | 收起但仍保留在库 | 面板「归档」 |

配套变更：

- **删除 `resolvedAt`**，改为 `stateChangedAt`（少了"只有 archive 才打点"这个特例；`storage.ts:136` 现只在归档时写 `resolvedAt`）。
- `crystallized: { hippoId, kind, at } | null` **保留**，它是"流向哪里"的链接信息，与状态正交（`state === 'crystallized'` ⇔ 该字段非空，由 service 保证不变式）。

**决策 P1（已定）**：采用显式 `inboxState`。变更前我倾向"加一个 `dropped` 到 status、其余推导"——那是**为了兼容老客户端**才做的取舍；兼容约束取消后，显式枚举更优：

- 推导规则（`pending = active && crystallized === null`）是隐式知识，UI、查询、统计三处都要各自复写一遍，必然漂移；
- 显式状态让面板的四个 tab、`/sparks/stats` 的计数、注入路径的过滤共用同一个 enum；
- 代价（一次性迁移）在自用场景下几乎为零：boot 时按老字段推导一次并重写文件，带 schema 版本号且幂等。

迁移映射（一次性，写在 storage 的 version 迁移里）：

```
status==='active' && crystallized===null  -> pending
status==='active' && crystallized!==null  -> crystallized
status==='archived'                      -> archived
```

### 4.2 新增只读统计端点

```
GET /sparks/stats -> { pending, crystallized, archived, dropped, total,
                       pendingProposals, oldestPendingAt }
```
用途：① 首步注入的计数；② 面板总览；③ dock 模块 header 的未处理计数。
**不要**让注入路径去 list 全量火花再过滤——那是 O(n) 且有预算风险。

### 4.3 会话编排层的注入契约

注入不新增 wire 端点——它在**宿主侧**用 `agent/pre-step` 生成消息。文案与预算属于宿主实现细节，但需要：

- 一个可配置的开关与预算（`spark-inbox-inject` 行：`enabled` / `maxChars` / `maxItems`）；
- 注入内容必须与 hippomemo 的注入在**形态上可区分**（不同标题前缀），否则模型无法分辨两类背景。

### 4.4 脚本匹配（C 档）

`triggers` 已是 `string[]`（≤16 条，每条 ≤80 字符）。C 档不改变 schema，只增加**消费者**；需要补充的是**匹配语义的文档化**：

- trigger 与「最近 K 次工具调用的 `name + 关键参数`」做子串/模式匹配（大小写归一）；
- 匹配打分 = 命中 trigger 数 → 唯一候选取最高分；
- 一 step 最多注入 1 条建议（防刷屏）。

---

## 5. 会话编排层（回收回路）

这是本次改造的核心新增件，落在 `dsh-spark` 宿主侧（新增一个 `spark-inbox` 行，或并入现有 `spark` 行的 apply）。

### 5.1 首步注入（A 档）

- 钩子：`ctx.on('agent/pre-step', async ({ agent, messages, step }, next) => ...)`，`step === 1`，返回 `PreStepDecision`（与 hippomemo `context.ts:64` 同构）。
- 触发条件：`pending > 0` **或** `pendingProposals > 0`；两者都为 0 时**不注入**（零噪音原则）。
- 内容：一行计数 + 最近 N 条待处理火花（标题 + 一行摘要）+ 一句「需要时用 spark_crystallize / 面板处理」，总量受 `maxChars` 约束。
- 去重：每 agent 会话一次（`WeakSet<agent>`，同 hippomemo 实现）。
- 语言：与现有注入保持一致用英文（模型侧），**面板侧**文案走 locale（§8）。

### 5.2 计数可见（A 档）

- **v1 不动 dock 契约**：计数显示在**模块自己的 header 位**（该位已经是模块组件渲染，无需改 kit/dock）。
- v2（可选）：悬浮球球体角标。需要 kit 的 `DockModuleSpec` 新增动态 badge 契约 → 属于 kit 变更，单独排期（见 P4）。

### 5.3 提议自动化（B 档）：脏标记 + 惰性触发

**不用 `intervalMs` 调度器**（违反 AGENTS.md §1.3）。

```
写入火花时置脏：inboxDirty = true（持久化在 sparks 元数据或独立标记文件）
首步钩子里检查：if (inboxDirty && pendingSinceLastReflect >= K) 触发一次后台 reflect
reflect 完成后清脏
```

- 好处：无定时器、无空转、只在"有人真的在用"时干活；且天然与 A 档共用同一个 `agent/pre-step` 入口。
- 风险：如果用户长期不开会话，提议不会生成——可接受（没人看的时候生成也没意义）。
- 阈值：`K` 默认 3（新增/变更火花数），可配。

### 5.4 脚本匹配注入（C 档）

同一入口增加第二条判定：取最近 K 次工具调用 → 与 scripts 的 `triggers` 匹配 → 命中且该脚本本会话未注入过 → 注入一条建议（脚本名 + 描述 + `spark_invoke_script` 提示）。

### 5.5 命令失败采集与注入（D 档，实验）

采集（无 LLM、纯本地）：

```
观察 session/event：'tool/call'（工具名 + 参数）与 'tool/result'（结果 / 是否报错）
只取 shell/bash 类工具，抽取：
  modelKey   = 「provider/model」（来自 agent/model-selection）
  cmdPattern = 归一化命令（首个 token + 子命令 + 关键 flag；去掉路径/时长/IP 等易变段）
  errSig     = 退出码 + stderr 首行的归一化签名
```

聚合与门槛（**噪声防线见下**）：

```
同一 (modelKey, cmdPattern, errSig) 在 >=2 个不同会话复现，且期间 agent 未自愈
  -> 声明侧：hippomemo.put({ kind:'constraint', modelIds:[modelKey], ... })
  -> 程序侧：spark script（triggers=[cmdPattern]，带 successRate 可度量）
```

注入：首步给该 model 一份「已知命令坑」简报（≤3 条）；同会话内若刚发生匹配的失败，下一步即时给正确写法。

**噪声防线（必须实现，否则挖出的是垃圾）**：

- 非零退出**不等于**失败：`grep` 无匹配、`test -f`、探测性命令、被强杀进程（本项目 AGENTS.md 明确：Windows 上被强杀的进程以 `exit 1` 结算）都要白名单化；
- 同一会话内的重复不计入"跨会话复现"；
- 要求 agent **没有自愈**（后续同一模式成功则清零计数）；
- 采集默认**关闭**（`enabled: false`），先在沙箱跑一轮看产出。

---

## 6. 与 hippomemo 的协作面

| 事项 | 结论 |
|---|---|
| 命令弱项存哪 | hippomemo `constraint` + `modelIds`（进化引擎豁免已就位） |
| 火花结晶去向 | 现有 `spark_crystallize`（幂等，返回 `hippoId`），不改 |
| 注入去重 | 两类注入各自独立去重，互不感知；但**文案前缀必须可区分** |
| 偏好挖掘（valence） | 建议补 provenance 标记，使"谁写的"可辨识（P6） |

---

## 7. 数据安全（与 A 档同期，不可延后）

### 7.1 丢失更新

**根因**：`sparks.jsonl` 是**全量重写**（`storage.ts` `writeAllRaw`：写 `.tmp` → rename），而服务在内存持有整份数组；任何一次写入都会把**该进程内存里的整份数组**落盘。README 第 15 行自称 "append-only JSONL backend"，与实现不符。

**修法（至少取一）**：

1. **单进程权威约束**：在 `DSH_HOME` 下对 `sparks.jsonl` 持有排它锁（或写入 PID/实例标识），检测到第二个实例时明确报错而非静默覆盖——与 hippomemo README「一个进程是它 DSH_HOME 记忆文件的唯一权威」对齐；
2. **写前重读**：任何 read-modify-write 都必须"读-改-写"在同一个串行临界区内完成。**已发现的具体缺口**：`spark-service.ts:195-201` 的 `crystallize`（`patch` / `remove` 都在 `serialize` 内，只有它不在）；
3. 文件尾追加 + 定期压实（长期方案，不在本期）。

### 7.2 删除审计

`storage.remove` 直接改写文件，无回收站、无历史。建议：**墓碑化删除**——写入 `deletedAt` 并从列表隐藏，保留 N 天后由压实逻辑物理清除。UI 增加"最近删除"（可选）。

### 7.3 现有损失

两条火花已从 `.bak-1789313335723` 恢复（2026-09-14，A 档收尾时执行）：`spark-resume 战略假设：护城河在第3层反馈`、`AI面试赛道公开信息被厂商SEO污染`。

恢复方式是 `POST /sparks` 打到**当时在跑的 3080 宿主**，而不是离线改文件 —— 因为那个进程还是旧版插件（全量重写 + 无版本头），它的任何一次写入都会用内存里的陈旧快照覆盖文件（就是丢数据的同一个成因）。代价如实记录：**新记录 id 是新生成的、createdAt 是恢复时间**、`sourceSessionId` 标为 `restored-from-bak`；原文、标签与作用域保持原样。

---

## 8. UI / UX

### 8.1 收件箱视图

火花模块的"火花流"子页升级为 inbox：

- 默认视图 = **待处理**（`active && crystallized === null`）；
- 顶部计数条：待处理 / 已沉淀 / 归档 / 丢弃（点击切换过滤）；
- 每行的动作：结晶 / 归档 / 丢弃（需二次确认：`UI-UX-SPEC` §4.2 危险区口径 —— danger Button + 确认 Modal）；
- 空态：待处理为 0 但库里有内容时，给出「全部处理完了」的正反馈 + 去归档/已沉淀的入口。

### 8.2 形制与治理

- 遵循 `docs/UI-UX-SPEC.md`（四态反馈、aria 模式、token 标度）；`pnpm check:contrast` 与 `pnpm audit-tokens` 必跑。
- **必须一并修**：`SparkModule.tsx` 的硬编码中文文案改为 locale 字典（当前违反 AGENTS.md §3.4）。
- a11y：计数条与角标需 `aria-label`（例如「待处理火花 3 条」），供 `preview:verify` 断言。

### 8.3 架构对称（P3，待拍板）

是否把 `dsh-spark-dock/src/client/spark/` 抽成独立 client 包（如 `dsh-spark-client`），使五个模块走同一条 `registerDockModule` 路径。
- 支持：一致性、火花 UI 独立演进、dock 瘦身。
- 代价：一次纯搬迁 + 真宿主重验，**不直接提升"存在感"**。建议排序在 C 档之后。

---

## 9. 契约与兼容

**前提：本插件集仅自用**（没有第三方安装者），因此**不承担向后兼容义务**：

- 允许破坏性契约变更：重命名/替换 wire enum、删除无用字段（如 `resolvedAt`）、改变既有端点语义，都无需保留旧形态或降级分支；
- **当前阶段**（实测全部包尚未发布到 npm）暂不需要为兼容付成本；但 AGENTS.md §2.4 的默认规则**不改**——本阶段的口径与期限管理见 §13；
- 组合根允许删掉无用行/接口重新设计（例如 `spark_record_script_result` 这类别扭的接口），只要真宿主验收全绿。

**仍不豁免的纪律**（与兼容无关）：

- 改 `packages/*/src` 必须 bump 版本：`check:version-bump` 闸门逐 commit 校验，且客户端产物**按版本做缓存键**——同版本重装会拿到旧字节（这是缓存，不是兼容）；
- 破坏性 commit 加 `!` 并在 body 写清迁移路径（AGENTS.md §0.6）；
- 数据文件（`sparks.jsonl` / `hippomemo.json` 等）的迁移**必须幂等、带格式版本号**：那是数据不是客户端，丢了不可逆。

本期契约变更清单：

| 变更 | 类型 |
|---|---|
| `sparkStatusSchema` → `sparkInboxStateSchema('pending'\|'crystallized'\|'dropped'\|'archived')` | breaking |
| 删 `resolvedAt`，增 `stateChangedAt` | breaking |
| `GET /sparks/stats` | 新增 |
| 宿主行 `spark-inbox`（opts：`enabled` / `maxChars` / `maxItems` / `reflectThreshold` / `commandMining.enabled`） | 新增 |

---

## 10. 分期、验收与度量

### 10.1 分期

| 期 | 交付 | 依赖 | 状态 |
|---|---|---|---|
| **A** | inbox 显式状态机（`pending/crystallized/dropped/archived` + 迁移）+ `/sparks/stats` + 首步注入 + 模块计数条 + locale 整改 + **丢数据修复 + 删除审计** | 无 | ✅ 2026-09-14 完成（见 §10.4） |
| **B** | 脏标记 + 惰性 reflect | A 的 `agent/pre-step` 入口 | ✅ 2026-09-14 完成（见 §10.5） |
| **C** | scripts `triggers` → `agent/pre-step` 建议注入 | B 的匹配骨架 | ✅ 2026-09-14 完成（见 §10.5） |
| **D** | 命令失败采集 / 聚合 / 模型弱项沉淀（默认关） | C 的注入层 | ✅ 2026-09-14 完成，**默认仍关**（见 §10.5） |
| **P3** | 火花 client 包化（架构对称） | 任意，建议 C 后 |
| **P4** | 悬浮球球体角标（kit 契约变更） | 单独排期 |

### 10.2 验收口径（每期必须全绿，顺序执行）

```
pnpm -r build           # 再 typecheck —— 二者不可并行（AGENTS.md §4）
pnpm -r typecheck
pnpm -r test
pnpm check:all          # 架构 + 对比度 + audit-tokens + 版本 bump
pnpm preview:verify
pnpm sandbox:install && pnpm sandbox:up --detach   # install 通道无 HMR
node dev-harness/real-host-check.mjs               # 退出码 0
```

- 任何**注册面**改动（新宿主行 / 新 remote / 新 stream）必须以 `/__dev/probe` 的 typert 注册面断言为准，禁止只看"面板能渲染"（AGENTS.md §0.4）。
- 注入类改动的断言必须包含：**注入发生了**（首步消息出现）+ **不注入也成立**（计数为 0 时不出现）。

### 10.4 A 档验收证据（2026-09-14）

| 关口 | 结果 |
|---|---|
| `pnpm -r build` → `-r typecheck` → `-r test`（顺序执行） | 全绿（dsh-spark 单测 75/75，含新增迁移/并发/提醒渲染用例） |
| `pnpm check:all`（架构 / 对比度 / audit-tokens / 版本） | PASS |
| `pnpm preview:verify` | 87/87 |
| `pnpm sandbox:install` | 11 包全部 tarball 拷贝形态 |
| `pnpm sandbox:verify --attach` | 31/31，含 `spark-inbox ACTIVE — dsh-spark/inbox`（注册面断言，非"面板能渲染"） |
| `node dev-harness/real-host-check.mjs` | **32/32，退出码 0** |
| v1→v2 迁移（真实形状数据） | 53 条记录：`{"__sparkStore":2}` 头已写、`status`/`resolvedAt` 零残留、`stateChangedAt`/`deletedAt` 全补齐 |

新增的真宿主断言（`real-host-check.mjs` 3b）：`/sparks/stats` 形状、收件箱四个筛选位可见、**旧 `status` 查询参数已失效**（返回全量 vs `inboxState=archived` 返回 0）——最后一条是"破坏性变更真的生效"的可观测证据。

### 10.5 B/C/D 三档落地说明（2026-09-14）

三档都挂在**同一个 `agent/pre-step` 入口**上（`spark-inbox` 行），但判定逻辑各自是可单测的纯函数：

| 档 | 实现位置 | 判定 |
|---|---|---|
| B 惰性涌现 | `src/reflect-scheduler.ts`（纯）+ `inbox.ts` 的 `triggerReflectIfDirty` | `changedCount ≥ threshold` 且距上次 ≥ `minIntervalMs`；**不用定时器**（AGENTS.md §1.3） |
| C 脚本建议 | `src/script-match.ts`（纯） | 最近 K 次工具调用的 `name + args` 子串命中 `triggers`；打分 = 命中数 → successRate → 具体度；按会话去重 |
| D 命令失败挖掘 | `src/command-mining.ts`（纯）+ `src/meta-store.ts` | `(model, 命令模式, 错误签名)` 跨会话复现 ≥ `minSessions`；成功即自愈清零 |

**D 档为什么默认关**：噪声防线（grep 无匹配 / test -f / 被强杀进程 → 白名单）是这一档的全部价值所在，
不先观察一轮就打开，挖出来的会是垃圾。打开方式：

    - id: spark-inbox
      config:
        commandMining:
          enabled: true

开启后达到门槛的记录会沉淀成 hippomemo 的 `kind='constraint'` + `modelIds=[provider/model]`；
进化引擎对 `modelIds` 非空的记录豁免 probation/consolidation（`memory-evolve.ts:203-209`），
所以这些"按模型的错误笔记本"不会被自动打扫掉。

**注入类改动的验收口径**（AGENTS.md：既要证明注入发生，也要证明不该注入时不注入）：
`test/inbox-orchestration.test.ts` 用假 ctx 驱动真实的 pre-step 处理器，逐条断言：
收件箱为空 → 不注入；有待处理 → 注入且每 agent 一次；命中脚本 → 注入、不命中 → 不注入；
脏标记达标 → 后台跑一次并写回 `lastReflectAt`，不达标或关闭 → 一次都不跑。

### 10.3 成功指标

| 档 | 指标 | 目标方向 |
|---|---|---|
| A | 待处理火花数 / 周；从捕获到处理的中位时长 | 不再单调增长 |
| B | 提议产生数；提议被接受率 | >0 且有非空接受率 |
| C | 脚本命中次数 / 重复写同类代码次数 | 后者下降 |
| D | 同一 (model, cmdPattern, errSig) 的**跨会话复现率** | 注入后下降 |

---

## 11. 开放问题（需拍板）

| 编号 | 问题 | 我的倾向 |
|---|---|---|
| P1 | ~~是否新增 `status='dropped'`~~ **已定**：改用显式 `inboxState` 替换 `status` | 采纳（理由见 §4.1） |
| P2 | 首步注入的语言与预算 | 英文、`maxChars ≈ 800`、最多 3 条 |
| P3 | 提议自动化的触发点 | 会话首步惰性触发，**不用定时器** |
| P4 | 是否做悬浮球球体角标 | v1 不做，先用模块 header 计数 |
| P5 | 注入是否允许拦截命令 | 不允许，一律建议式 |
| P6 | 是否补 valence 写入的 provenance 标记 | 补（否则无法审计偏好来源） |
| P7 | 火花 UI 是否包化（P3 架构对称） | 建议但排后 |
| P8 | 命令失败挖掘默认开关 | 默认关，沙箱先跑一轮 |
| P9 | 是否加 `check:compat` 闸门（已发布 + 破坏性 wire 变更 + 无迁移说明 → 失败） | 建议加；未发布期间恒过，把"忘了改回来"变成 CI 红灯（见 §13.3） |

---

## 12. Non-goals（本期明确不做）

- 拦截式/改写式命令注入；
- `intervalMs` 定时调度器（违反 AGENTS.md §1.3）；
- 向量检索 / embedding 召回（v1 沿用 token Jaccard + 可选 LLM 提议）；
- 强制力导向图（Graph 子页在 B/C 产出真实链接之前保持占位，但需补空态 CTA）；
- 自动捕获（在 inbox 语义与清理机制稳定前，自动捕获只会制造垃圾）。

---

## 13. 兼容义务的期限管理（`docs/agents` 修订已撤回）

**结论：不改 AGENTS.md。** §2.4 末条「被替换的 strict 端点保留一个 minor 给旧客户端」**保持原样作为默认规则**。

### 13.1 为什么撤回

初稿曾提议把「本插件集仅自用 → 不承担兼容义务」写成常驻规范条目。这个写法有个不对称风险：

- 该条一旦落地，就是给**未来所有会话/所有模型**的一张长期许可证；
- 而"忘了改回来"的代价发生在**已经开源之后**——那时激进破坏性迭代的伤害是外部用户承担的、且不可逆；
- 反方向的代价（多留一个兼容分支）只是少量冗余代码。

**两害相权，宁保守。** 规范是长期设施，不适合承载"当前阶段"这种会过期的事实。

### 13.2 改为：把触发器放在触发器所在的位置

「当前允许破坏性变更」是一个**有期限的项目决定**，不是规范授权。因此：

1. **记录在带日期的设计文档 + commit body**（本文件即为其一）；破坏性 commit 必须写清迁移路径——**那条迁移路径就是将来开源时给用户的说明**，本来就要写，不是额外成本。
2. **触发器写进发布路径**：在 `docs/UPGRADE-PROTOCOL.md` 增加一条发布前 checklist —— 「对外发布前复核 AGENTS.md §2.4 兼容策略是否适用」。发布这个动作发生时人一定在读那份文档；而放在 AGENTS.md 里，则需要有人**记得去删**。
3. **机械触发点已存在**：`npm_package_check` 实测本仓库包**尚未发布**（`dsh-hippomemo` / `dsh-spark` / `dsh-spark-dock` / `dsh-ui-kit` / `dsh-spark-plugin-kit` 全部 `exists:false`）。"是否已发布"是一个**可机器检测**的事实，不需要依赖记忆。

### 13.3 可选的机械防线（P9，待拍板）

按 AGENTS.md §5 最后一条的精神（"新增反模式防线 → 加进对应闸门脚本，而不是只写文档"），可加一个与 `check:version-bump` 同族的闸门：

```
check:compat
  查询 npm registry：该包是否已发布？
  若【已发布】且本次 commit 含 wire 契约破坏性变更（删/改 enum、删字段、改端点语义）
  且 commit body 无迁移说明
  -> 失败（退出码非 0），并在输出里直接指向 AGENTS.md §2.4
```

- 效果：「忘了改回来」从**自律问题**变成 **CI 红灯**；
- 成本：一个脚本 + `check:all` 接线一次；
- 未发布期间该闸门恒过，不产生噪声。

### 13.4 当前的实现口径

在 P9 落地之前，本设计对"破坏性"的自律口径是：

> **破坏性变更只在设计收益明确时做**（本次 `inboxState` 替换 `status` 属于此类：隐式推导规则会三处漂移）；**每次都在 commit body 写清迁移路径**；**数据迁移一律幂等 + 带格式版本号**。

不追求"能破坏就破坏"，只是不为不存在的客户端付成本。

