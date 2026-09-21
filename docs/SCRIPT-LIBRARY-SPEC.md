# 脚本沉淀库 · Spec（规范）

> 状态：**v1.1（2026-09-22）**，本文件是脚本能力的**唯一规范源**。
> v1.1 变化：F3 治理口径落地（§6.2–§6.5）、`invokedWorkspaces` 字段（§2.1）、
> 审计读模型强制携带宿主算好的 `successRate`（INV-7 + 闸门 `ratemetric`，§6.5）。
> 实现与本文冲突时**先改本文**（commit 用 `docs(script):`），再改码。
> 相关背景材料：`docs/skills-vs-script-plugin-2026-09-21.md`（为什么**不**接平台 `ctx.skills` 缝的调研）。
>
> 英文名：Script Library（包 `dsh-script` / 用户可见词「脚本」）。

---

## 0. 背景与适用范围

### 0.1 为什么有这份 Spec

「脚本」当前寄生在 `dsh-spark` 里（host 510 行 + wire schema + dock pane），但它与火花的机制不同：

- 火花的输入是**会话里的想法**；脚本的输入是**工具调用序列与命令失败**（agent 行为）；
- 火花的消费者是"以后再看"；脚本的消费者是"下次照着做"；
- 二者唯一的语义耦合是 `ScriptView.sourceSparkId`（可空），而 2026-09-21 已定：**跨插件不做通道，关联交由 Agent 判断**——所以那条耦合也应当去掉。

同时，脚本与 HippoMemo 在**域词汇**上大量共通（作用域、生命周期、溯源、修订），但当前两边不一致（见 §2.2）。本 Spec 的目标是：**把脚本做成一个独立插件，成为"脚本沉淀库"，并把治理面留成可扩展的一等公民。**

### 0.2 与其它文档的关系

| 文档 | 关系 |
|---|---|
| `docs/spark-v2-design-2026-09-21.md` | **需同步修订**：其模块副标题（`灵感 · 关联 · 脚本`）与工具表（"脚本三件套"）假定脚本属于火花。该文件由另一会话持有，本 Spec 只登记待改点，不直接编辑（避免冲突） |
| `docs/skills-vs-script-plugin-2026-09-21.md` | 背景调研。**结论已被本 Spec 收窄**：不接 `ctx.skills`，只借鉴其目录注入的工程质量（§5） |
| `docs/UI-UX-SPEC.md` / `docs/spark-dock-design.md` | 人面 pane 的视觉与 a11y 规范仍适用 |
| `AGENTS.md` | 工程铁律：版本 bump、契约单源、闸门、ADR-003 自注册 |

### 0.3 已定决策（可回退，回退须改本节）

| # | 决策 | 理由 |
|---|---|---|
| **D1** | 作用域收敛为 `global \| workspace \| project`，**丢掉 `session`** | 与 HippoMemo 的 `MemoryScope` 完全一致；临时性用 `expiresAt` 表达，而不是发明第四种作用域 |
| **D2** | F1 即落库 `status` / `revision` / `supersedes` / `supersededBy` / `updatedBy` / `tags` / `expiresAt` 字段（默认值齐全），治理**行为**留到 F3 | 字段后补要动存量数据；先落字段的成本几乎为零（当前存量只有 3 条种子） |
| **D3** | 域词汇的**单源 = 本 Spec + 新增闸门 `check:domain-vocabulary`**；暂不抽共享 `*wire` 包 | 照抄 `FINANCE-PRICING-SPEC` + `check:finance-price-drift` 的既有范式；且现在改 `dsh-hippomemo` 有并行会话冲突风险 |
| **D4** | **删除 `sourceSparkId`** | 沿用"跨插件零通道、关联交 Agent 判断"的既定原则；它是脚本侧唯一的火花耦合点 |
| **D5** | 包名 `dsh-script` / 用户可见词「脚本」；工具 `script_save` / `script_list` / `script_invoke` / `script_result` | 朴素命名（不用隐喻）；去掉 `spark_` 前缀（后两个工具与火花毫无关系） |
| **D6** | 发现策略 F1/F2 用「目录注入 + triggers 主动建议 + `script_list` 检索」；不做"高价值子集"裁剪 | 库小时全量目录成本可控；裁剪策略属于治理阶段（F3）且需要真实数据支撑 |
| **D7**（F3） | 过期结算是**惰性扫描**（服务 ready 之后一次 + `POST /scripts/sweep`），**不引定时器** | 过期条目本来已被 `isVisible` 挡在可见面外，扫描只是让 `status` 与审计面诚实；轮询会违 INV-12，而"真·时间驱动"要写豁免注释，没必要为一次枚举付出这个代价 |
| **D8**（F3） | `global` **不做** `globalProven` 式确认；改为「降级作用域建议」（人工确认） | 目录注入与记忆注入不同：记忆是进上下文的事实断言，脚本只是可选的"操作清单"。自动注入代价可控，收敛交给建议面（关闭 P-4） |
| **D9**（F3） | **人面不计量**：dock pane 只读（查看步骤 / 治理动作），不再调 `POST /invoke` | 计量口径（INV-8）描述的是 **agent 按脚本执行**这件事；人在 pane 上点一下不是执行证据，留在库里会污染退役建议的病据 |
| **D10**（F3） | 成功率**随读模型下发**（`ScriptSummary.successRate` 由宿主计算），UI 侧禁止任何除法；闸门 `ratemetric` 逐文件拦截 | INV-7 原文只写了口径单源，但 F1 验收时 UI 仍在重算（`ScriptsPane` 的 `successCount / invocationCount`）。把口径做进读模型，UI 就**没有算错的机会**，而不是靠人自觉 |

---

## 1. 不变量（INV）——实现与评审逐条对照

| # | 不变量 | 断言方式 |
|---|---|---|
| **INV-1** | **零跨插件运行时引用**：`dsh-script/src` 不出现 `ctx.spark` / `ctx.memory` / 火花或记忆的符号；反向亦然 | 架构闸门（新增 `cross-plugin-refs` 检查或扩展现有边界检查） |
| **INV-2** | **作用域词汇与 HippoMemo 一致**：`global \| workspace \| project` 三值，字面量与解析语义见 §3.2 | 闸门 `check:domain-vocabulary`（跨包枚举等价，逐字面比较） |
| **INV-3** | **注入的 message source 必须是平台白名单内的 kind**（本插件用 `{ kind: 'plugin', plugin: 'dsh-script', form: … }`），**禁止自造 kind** | 单测 + 闸门（源码 grep 禁止 `kind: 'script-`） |
| **INV-4** | **目录注入幂等**：同一 `(name, description)` 集合的指纹不变则**不重复注入**；变化时发**替换帧**（明确作废旧清单） | 注入层单测（纯函数）+ 真宿主验收 |
| **INV-5** | **注入状态耐久**：宿主重启或会话恢复后，不得重复发布同一份目录（状态持久化在 §4.2 的 sidecar） | 单测（state 读写）+ 真宿主验收（连续两次启动注入次数不增加） |
| **INV-6** | **每 agent 门控**：仅当脚本工具对该 agent 可用（`ctx.tools.get('script_list', agent)` 命中本插件注册）时才注入目录 | 注入层单测（假 ctx） |
| **INV-7** | **成功率口径单源**：`successRate = successCount / invocationCount`（`invocationCount === 0` 时为 `0`），**全仓只有一处定义**（`dsh-script/src/script-service.ts` 的 `ScriptService.successRate`）；跨边界一律传结果，UI 侧**禁止任何除法**（读模型 `ScriptSummary` 直接带宿主算好的 `successRate`） | 单测 + 闸门 `ratemetric`（除定义文件外，任何 `packages/*/src` 出现该除法即硬失败；`*-client` 包内一律禁止） |
| **INV-8** | **调用即计量**：`script_invoke` 必增 `invocationCount` 并写 `lastInvokedAt`；`script_result` 必增 `successCount` 或 `failureCount` | 单测（存储往返） |
| **INV-9** | **结构化真源**：`steps[]` 是唯一真源（`instruction` \| `tool-call`，每条有 `payload`）；markdown/目录文本都是**渲染视图**，不得反向解析 | 单测（渲染是纯函数：`steps → text`） |
| **INV-10** | **不超过 Schema 上限**：`steps ≤ 50`、`payload ≤ 2000`、`triggers ≤ 16`、`tags ≤ 32`、`searchTerms ≤ 32`（数据在写入边界被 zod 拒绝，而不是截断） | wire schema + 单测 |
| **INV-11** | **治理动作可审计**：归档 / 取代 / 退役 / 过期都只改 `status` 与修订字段（可逆），物理删除只允许对已归档条目 | 单测（状态机） |
| **INV-12** | **无轮询**：宿主→客户端只有 typert stream 一条推送路径；插件源码不得引入定时器轮询（真·时间驱动须写豁免注释，见 AGENTS §1.3） | 闸门 + 代码评审 |
| **INV-13** | **结算幂等**：过期结算可重复执行，第二次不产生任何写入（`archived = 0`）；结算只改 `status`，不动 `revision` / 修订字段 | 单测（连续两次结算） |
| **INV-14** | **建议不定罪**：建议引擎是**只读纯函数** —— 生成建议不写库、不改状态；除过期结算（INV-13）外，所有治理动作必须由人面显式发 HTTP 请求才落库 | 单测（审计调用前后库内容逐字节相同）+ 代码评审（`advices` 路径无 `patch`/`append`） |

---

## 2. 域模型

### 2.1 记录形状（`ScriptView`，规范）

```
ScriptView {
  id: string                    // uuid
  name: string                  // ≤120
  description: string           // ≤2000（也是目录里给模型看的那一行，见 §5.2）
  steps: ScriptStep[]           // 1..50，结构见下
  triggers: string[]            // ≤16，路由用（等值/子串匹配最近工具调用）
  tags: string[]                // ≤32，检索用（与记忆同义）
  searchTerms?: string[]        // ≤32，写入时生成的双语同义词（与记忆同形）
  scope: 'global'|'workspace'|'project'   // 默认 'workspace'
  workspacePath: string|null    // = 写入时 session cwd
  status: 'active'|'archived'|'superseded'|'candidate'  // 默认 'active'
  revision: number              // 默认 1，内容修订即 +1
  supersedes: string|null       // 取代了哪条（id）
  supersededBy: string|null
  updatedBy: 'human'|'agent'|'system'
  sourceSessionId: string|null  // 溯源（种子为 null）
  sourceAgentId: string|null
  sourceTurn: number|null
  invocationCount: number       // 计量
  successCount: number
  failureCount: number
  invokedWorkspaces: string[]   // ≤32，调用证据（降级作用域建议用，Spec §6.2）
  createdAt: number
  updatedAt: number
  expiresAt: number|null        // 临时性表达（替代 'session' 作用域）
  lastInvokedAt: number|null
}

ScriptStep { kind: 'instruction'|'tool-call'; payload: string (≤2000); note?: string (≤500) }
```

**与现状的差异（迁移项）**：新增 `tags/searchTerms/status/revision/supersedes/supersededBy/updatedBy/sourceSessionId/sourceAgentId/sourceTurn/expiresAt`；删除 `sourceSparkId`（D4）；`scope` 由 `session|project|global` 收敛为 `global|workspace|project`（D1）。

### 2.2 为什么这些字段要与记忆同义（实证）

HippoMemo 的域模型（`packages/dsh-hippomemo/src/types.ts`）：

- `MemoryScope = 'global' | 'workspace' | 'project'`（`:12`）、`MemoryStatus = 'active' | 'archived' | 'superseded' | 'candidate'`（`:14`）、`MemoryAuthor = 'human' | 'agent' | 'system'`（`:16`）；
- 溯源 `sourceSessionId/sourceAgentId/sourceTurn`（`:32-34`）、修订 `revision/updatedBy/supersedes/supersededBy`（`:37-40`）、`expiresAt`（`:43`）、`tags`（`:23`）/`searchTerms`（`:46`）；
- 生命周期动作与演进建议都挂在 `status` 上（`memory-evolve.ts:660` 的 `downgrade-scope`）。

脚本侧现状（`packages/dsh-spark-wire/src/index.ts:155-175`）只有 `scope/workspacePath/triggers/三个计数/时间戳`，**没有** `tags/status/revision/溯源/expiresAt`，且 `scope` 多了 `session`、少了 `workspace`。三件材质（语义/程序/偏好）共用一套治理动词是治理能跨材质统一的前提。

### 2.3 作用域语义（本 Spec 的定义，含与 HippoMemo 的差异）

| scope | 语义（本 Spec 定义） | 可见/可注入条件 |
|---|---|---|
| `global` | 跨工作区 | 全工作区可见。**自动注入**需"已确认"证据（记忆用 `globalProven` + `seenWorkspaces`，见 `memory-core.ts:139,489`）；脚本侧的确认方式见 §6.4（F3 定，F1 不做自动注入收敛） |
| `workspace` | 绑定写入时的 `workspacePath`（= session cwd） | `workspacePath === 当前 cwd`（精确匹配） |
| `project` | 绑定**项目根**（最近的含 `.git` 的祖先目录；无则回退 `workspacePath`） | `projectRoot(workspacePath) === projectRoot(当前 cwd)` |

解析实现：一个 10 行纯函数 `projectRoot(path, exists)`（可用 `node:fs` 存在性检查），可单测。

> **P-1（跨插件对齐待办）**：HippoMemo 目前把 `project` 与 `workspace` **都**按 `workspacePath` 精确匹配处理（`memory-core.ts:572-574`），即 `project` 在那边等同于"另一个标签"。本 Spec 给 `project` 的定义（项目根）更精确，但**两边口径因此不一致**。统一需要在 HippoMemo 侧另行修订（该包正被另一会话修改，本轮只登记）。

---

## 3. 功能面一：沉淀（F1）

### 3.1 工具契约

| 工具 | 入参 | 行为 |
|---|---|---|
| `script_save` | `name`(必), `description`(必), `steps`(必, JSON 字符串→校验后存), `triggers?`, `tags?`, `scope?`, `expiresAt?`, `supersedes?` | 校验 → 去重检查（§3.2）→ 写库（`updatedBy: 'agent'`，溯源从 `exec.agent` 取）→ emit `scripts/changed` |
| `script_list` | `q?`, `scope?`, `status?`, `tag?`, `limit?` | 检索（名称/描述/标签/触发词子串匹配），返回**紧凑视图**（不含全文 steps 以省 token，`steps` 计入 `stepCount`） |
| `script_invoke` | `id`(必) | 返回完整步骤 + `priorSuccessRate` + `invocationCount`；**同时计量**（INV-8） |
| `script_result` | `id`(必), `success`(必) | 记结果（成功/失败计数） |

`steps` 传参格式（与今天一致，但语义收紧）：`[{kind:"instruction"|"tool-call", payload:"…", note?:"…"}]`。
**约定**：`tool-call` 的 `payload` 是**工具名或命令**；`instruction` 是**给模型的话**。最后一步建议是"验收"（见 §6.2），F1 不强制。

### 3.2 沉淀质量（"很专的面"的正面定义）

1. **可执行性**：每一步要么是明确的工具/命令（`tool-call`），要么是明确的判断（`instruction`）。禁止"处理一下"这类空话——由 `script_save` 的**纯函数校验器**拒绝（规则：`instruction` 长度 ≥ 8、不得只含停用词、`tool-call` 不得含空格以外的自然语言句式）。校验规则清单化、可单测。
2. **去重**：与既有条目比较，满足任一即判重（返回既有条目 id 而非新建）：① `name` 归一化后相同；② `triggers` 的 Jaccard ≥ 0.8 且 `steps` 的归一化文本 sha256 相同。
3. **溯源**：写入时必须带 `sourceSessionId`（种子除外），便于治理阶段回答"这条是谁在什么场景沉淀的"。

---

## 4. 功能面二：存储与迁移

### 4.1 存储

- 记录：`$DSH_HOME/storages/script/scripts.jsonl`（JSONL，一行一条，写入走 tmp+rename 原子替换，沿用现有 `JsonlScriptStorage` 实现）。
- 注入状态：`$DSH_HOME/storages/script/inject-state.json`（§5.3）。
- 迁移：若旧文件 `$DSH_HOME/storages/sparks/scripts.jsonl` 存在，**首次启动一次性搬迁**（读旧 → 逐条按 §4.3 规则升级 → 原子写新 → 旧文件改名为 `scripts.jsonl.migrated`，不删除）。搬迁幂等（新文件已存在则跳过）。
- 存量事实（2026-09-21 实测）：旧文件只有 3 条种子，**用户自建脚本 0 条**，迁移风险≈0。

### 4.2 JSONL vs storage-domain

F1 继续用 JSONL（无新依赖、现有实现已在用）。`dsh-storage-domain` 迁移留到 F3 治理（需要事务/索引时再评估），届时应作为独立 Spec 增补。

### 4.3 记录升级规则（旧 → 新）

| 旧字段 | 新值 |
|---|---|
| `scope: 'session'` | `scope: 'workspace'`（cwd 绑定），`expiresAt` 保持 `null` |
| 其余 scope | 原样 |
| 缺失 `status/revision/tags/…` | 分别取 `'active'` / `1` / `[]` / … 的 Schema 默认值 |
| `updatedBy` | 无法判定来源的历史数据取 `'system'` |
| `sourceSparkId` | **丢弃**（D4）；不写入任何替代字段 |

---

## 5. 功能面三：发现（注入与检索）

### 5.1 注入入口

宿主在 `agent/pre-step` 注入（当前 `dsh-spark/inbox.ts:117` 的 C 档迁出并升级）。注入内容两类：

1. **目录帧**（库里有 active 脚本时）：紧凑清单 `- \`name\`: description`，描述折叠空白并截断 500 字符；
2. **主动建议帧**（`script-match` 命中最近工具调用时）："有现成脚本"的建议式文案（不拦截、不自动执行）。

### 5.2 注入的硬约束（来自平台实测）

- **source 只能是白名单 kind**（INV-3）：会话格式迁移对未分类 source **直接抛错**（`@deepseek-ai/dsh-session-format-v2-to-v3/lib/index.js:125`：`cannot safely transform unclassified message source`，白名单在 `:14-31`）。因此一律 `{ kind: 'plugin', plugin: 'dsh-script', form: 'catalog'|'suggestion', summary: … }`，**不得**自造 `script-catalog` 之类 kind。
- **目录行只放能驱动路由的信息**：平台 skill 的教训是 `whenToUse` 根本到不了模型（只有 `name + description` 进目录，见调研报告 §3）；我们的目录行**自己渲染**，因此应把"何时用得上"直接写进描述行（例如 `适用：改完插件源码后` + triggers 摘要），而不是另起字段。
- **替换帧措辞**：目录变化时发布"以下完整清单取代本会话此前所有脚本清单"，避免模型混用旧名字（照抄平台的措辞策略）。

### 5.3 幂等与耐久（INV-4/5/6）

- 指纹 = 对 `(name, description)` 有序列表做 sha256（纯函数）。
- 状态 = `inject-state.json`：`{ [sessionId]: { digest, publishedAt, agentId } }`，按 `publishedAt` 保留最近 N（默认 200）条，启动时清理过期项。
- 每步判定：`ctx.tools.get('script_list', agent)` 命中 → 取本会话 active 脚本集合 → 算指纹 → `digest === state[sessionId].digest` 则**不注入**；否则注入（首帧用完整措辞，非首帧用替换帧）并更新状态。
- **已知限制（显式接受）**：不读会话事件日志重建历史（平台用 `session.eventAt/snapshotEvents`，但那会把我们绑到平台内部形状；且我们的 source 是通用 `plugin` kind，无法可靠区分是不是自己的目录帧）。分叉会话因 sessionId 变化会收到一份完整目录——**方向安全**（多注入一次完整清单，不会漏）。

### 5.4 检索

`script_list` 的匹配口径（纯函数、可单测）：`q` 对 `name`/`description`/`tags`/`triggers` 做大小写不敏感子串匹配；`scope` 为显式过滤（`current` 语义 = global ∨ workspacePath 匹配）；默认按 `updatedAt` 倒序。

---

## 6. 功能面四：计量与治理

### 6.1 计量（F1 落地）

`invocationCount` / `successCount` / `failureCount` / `lastInvokedAt` + `successRate`（口径单源，INV-7）。
**不做**：自动推断成功与否（工具调用是否真成功由调用方报告，`script_result` 是唯一入口）。

### 6.2 治理动作（F3 定稿口径）

| 治理动作 | 触发口径 | 落库方式 |
|---|---|---|
| **过期** | `expiresAt !== null && expiresAt <= now` 且 `status === 'active'` | **唯一的自动动作**：`status → 'archived'`，emit `scripts/changed{operation:'expire'}`。结算点见 D7（启动后一次 + `POST /scripts/sweep`），幂等（INV-13） |
| **退役候选** | `invocationCount ≥ 5` 且 `successRate < 0.5` | 生成 `retire` 建议 → 人面 `action: archive` |
| **僵尸脚本** | `status === 'active'` 且 `invocationCount === 0` 且 `updatedAt < now - 30 天` | 生成 `zombie` 建议 → 人面 `action: archive` |
| **降级作用域** | `scope === 'global'` 且 `invokedWorkspaces.length === 1` | 生成 `downgrade-scope` 建议 → 人面 `action: set-scope-workspace`（`scope → 'workspace'`，`workspacePath` 不动） |
| **去重合并** | §3.2 判重规则的**回溯版**：全库两两比对，命中则对**较新**的一条提建议（保留较早的那条为留存者） | 生成 `merge-duplicate` 建议（带 `targetId` = 留存者）→ 人面 `action: merge`（等价于把重复者 `status → 'superseded'` + `supersededBy = targetId`，取代链复用同一套字段） |
| **取代** | 写入时显式传 `supersedes` | `save` 内自动：旧记录 `status: 'superseded'` + `supersededBy`，新记录 `supersedes` + `revision + 1`（F1 已实现，F3 只在人面呈现取代链） |
| **审计面** | — | dock 的「脚本」模块 pane：状态分布、成功率分布、有验收步骤占比、僵尸数、待裁决治理项 |

**治理动作一律"建议式 + 人工确认"**（除过期自动归档），与记忆的演进面一致。
建议只是**读**，不写库（INV-14）；动作必须经 HTTP 显式触发。

阈值常量集中在 `dsh-script/src/governance.ts`（`RETIRE_MIN_INVOCATIONS = 5`、`RETIRE_MAX_SUCCESS_RATE = 0.5`、
`ZOMBIE_IDLE_DAYS = 30`），改口径 = 改 Spec 本表 + 常量，禁止散落在 UI。

### 6.3 验收步骤（F3 引入写入约定，F1 不强制）

`script_save` 时允许（不要求）最后一步为 `instruction`，内容以"验收："开头；F3 的治理面统计"有验收步骤的脚本占比"（口径见 §6.5，由宿主算 `acceptance.ratio`，UI 不重算）。

### 6.4 建议引擎（纯函数，Spec §6.2 的落地形态）

`dsh-script/src/governance.ts` 只导出纯函数，输入 `(records, now)`，输出数据；**无 I/O、无 ctx**：

| 函数 | 语义 |
|---|---|
| `toSummary(record)` | 记录 → `ScriptSummary`（补 `stepCount` 与**宿主算好的** `successRate`）；唯一的读模型构造点 |
| `expiredIds(records, now)` | 需要结算的 id 列表（INV-13 的输入） |
| `governanceAdvices(records, now)` | 全部建议（按 kind 优先级 + `updatedAt` 倒序稳定排序）；建议 id 形如 `retire:<id>` / `merge-duplicate:<id>-><targetId>`（稳定，供 UI 做 key 与去重） |
| `auditStats(records, now)` | 审计统计（§6.5 的形状） |

已归档 / 已取代（`superseded`）条目**不产生**退役、僵尸、合并建议（它们已经退场，再建议是噪音）；
过期结算与降级建议也不看 `superseded`（取代链要保持完整，不被降级动作扰动）。

### 6.5 审计读模型与人面（F3）

`GET /scripts` 与 `GET|POST /scripts/audit` 下发的是**读模型**，不是存储记录：

- `GET /scripts` → `ScriptSummary[]`（**不含 steps**：带 `stepCount` 与宿主算好的 `successRate`）。
  人面要看步骤时单独取 `GET /scripts/:id`（**不计量**，D9）。
- `POST /scripts/sweep` → 结算过期（INV-13）后返回审计负载；`GET /scripts/audit` 为只读同形（不结算）。
- 审计负载 `ScriptAudit`：`{ settledAt, archived, stats, advices }`，其中
  `stats = { total, byStatus, byScope, rateBuckets, acceptance: { withAcceptanceStep, total, ratio }, zombies }`。
  `rateBuckets` 三档边界 `low < 0.5 ≤ mid < 0.9 ≤ high`，`untested` 单列（`invocationCount === 0`）。
  `total` / `byStatus` / `byScope` 统计**全库**；`rateBuckets` / `acceptance` / `zombies` 只统计 **`active` 条目**
  （审计要看的是"在用的库有多健康"，退场条目进来只会稀释比例）。
- 建议**不下发句子**：`ScriptAdvice.evidence` 只带病据数字（`invocationCount` / `successRate` /
  `idleDays` / `workspaces`），措辞由 pane 走 locale 字典渲染 —— 宿主写死中文句子会泄漏到 `en` 面（AGENTS §3.4）。
- 治理动作端点：`POST /scripts/:id/status { status, supersededBy? }`、`POST /scripts/:id/scope { scope }`、
  `DELETE /scripts/:id`（物理删除仅限已归档，INV-11）。**所有动作都由点击触发，宿主不自作主张。**

**UI 侧禁止重算任何业务口径**（INV-7 / D10）：成功率、验收占比、分档全部读宿主下发的字段；
闸门 `ratemetric` 会对 `*-client` 包内的除法直接硬失败。


---

## 7. 包与接线

| 包 | 角色 | 内容 |
|---|---|---|
| `dsh-script-wire` | wire | 记录/查询/结果 schema + `scripts/changed` 事件 + `script/events` 流帧 + host/remote contributions（照抄 `dsh-spark-wire` 的形态） |
| `dsh-script` | host | `ScriptService`（`ctx.script`）、治理引擎（`governance.ts` 纯函数，§6.4）、注入状态、存储、迁移、`script-match`、种子、HTTP `/scripts`（读模型 + 审计 + 动作）、`script/events` 流服务、四个工具、`agent/pre-step` 注入 |
| `dsh-script-client` | client | 字典注册 + dock 模块自注册（ADR-003）+ 「脚本」pane + `subscribeFrames` 订阅 `script/events` |

**从 `dsh-spark` 迁出/删除**：`script-service.ts`(150) / `script-storage.ts`(149) / `script-match.ts`(117) / `seed-scripts.ts`(94) / `http.ts` 的 `/scripts` 段（`26,51-56,207-269`）/ `tool.ts` 的脚本三件套（`143-213`）/ `inbox.ts` 的 C 档（`32,51,61,72,93-95,103,141-152`）/ wire 的 `Script*` 与 `scriptsChangedEventSchema`、`script` 流帧（`138-197,309-312,330,335,378`）/ `events.ts` 的 `script` 主题（`4,28,46`）/ `index.ts` 的 ScriptService 装配 / dock 的 `ScriptsPane`（`SparkModule.tsx:443-509`）、`sparkApi.listScripts|invokeScript`、locale 键（`paneScripts/scriptsTitle/unitScripts/scriptsEmpty/scriptsEmptyHint/invokedScript`）、`SparkDockModule.tsx:20,36,54` 的 pane 注册。

**dock 侧零改动**（ADR-003）：新插件用自己的 client 包自注册模块；dock 只是少一个 pane、多一个模块入口（模块数 5 → 6，这是本 Spec 接受的 UI 后果）。

**初始化顺序约束（2026-09-21 实测，务必遵守）**：`whenReady()` 就是 `init()` 的 promise，
而 `list()` / `save()` 等公开方法都以 `await whenReady()` 开头。所以**种子不能在 `init()` 里跑**：
`seed → list → whenReady` 会与 `init` 自锁 —— `ready` 永不 resolve，`init` 里排在种子**之后**
的 HTTP 注册永不执行，表现为 `/scripts` 404、服务在宿主里"看不见"，而且**没有任何报错**
（都被 `init` 的 catch 收进 `ctx.logger`）。正确顺序：`init = 建目录 + 迁移 + 注册 HTTP`；
种子挂在 `ready.then()` 之后再跑。

**纯 UI 插件的 loader 行（2026-09-21 实测）**：`dsh-script-client` 只有 `dsh.client`
声明，没有 `dsh.bundle`。它必须**由某个 bundle patch 里的 loader 行**（`- id: script-client,
name: 'dsh-script-client'`，写在 `dsh-script/cordis.patch.yml`）带进组合 —— 缺这一行时
`dsh-client-modules` 不会把它扫进客户端模块表，表现为**不报错、只是 dock 里永远没有这个模块**
（同 npm-ui / github-ui 的形态）。改动注册面后必须按 AGENTS §0 铁律 4 用探针断言
`clientGraph.entries` 里出现该包。

**事件/推送**：`script/events` stream（AGENTS §2.4 模板）——wire 描述符（service `scriptEvents`、namespace `script`、`mode: 'stream'`、`resultMode: 'strict'`、ready 基线帧 + 数据帧）、host `ScriptEventsService`、纯函数 `events.ts` 桥接（复用 kit `bridgeEvents`）、client `subscribeFrames`。

---

## 8. 验收与防线（缺一不可）

| # | 验收 |
|---|---|
| **A1** | 单测：Schema 边界（INV-10）、`steps → 文本` 渲染纯函数（INV-9）、`projectRoot` 解析（§2.3）、判重规则（§3.2）、目录指纹（INV-4）、注入状态读写与清理（INV-5）、每 agent 门控（INV-6）、`successRate` 口径（INV-7）、状态机可逆性（INV-11） |
| **A2** | 闸门：`check:domain-vocabulary`（INV-2 跨包字面量等价）、`cross-plugin-refs`（INV-1）、`esmrequire`（已存在）、`ratemetric`（INV-7 成功率除法单源）、`check:version-bump`（每个改发布输入的 commit 带 bump） |
| **A3** | 迁移：旧 `scripts.jsonl` → 新路径的搬迁幂等；`session` → `workspace`；`sourceSparkId` 不再出现 |
| **A4** | 真宿主：`sandbox:install` + 重启宿主 → `/scripts` 200、`script/events` 接到 ready 帧、连续两次启动**不重复注入**目录（INV-5）、`real-host-check` 退出码 0 |
| **A5** | 预览与界面：`pnpm preview:verify` 全过；「脚本」pane 在 dock 中可开、文案走 locale 字典、无 CJK 泄漏（`en` 面）；治理面（概览统计 / 待裁决 / 状态徽章 / 动作）在预览 fixture 下有可断言的 testid |
| **A6** | 全链：`pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test`（顺序执行）→ `pnpm check:all` |
| **A7**（F3） | 治理引擎单测：退役 / 僵尸 / 降级 / 合并四类建议的**触发与不触发**、结算幂等（INV-13，两次结算第二次 0 写入）、审计调用**不写库**（INV-14，调用前后 JSONL 逐字节相同）、`toSummary` 的 `successRate` 与 `ScriptService.successRate` 恒等 |
| **A8**（F3） | 读模型防线：`GET /scripts` 的响应**不含 `steps`**（防止 UI 拿全文再自己算），且带 `stepCount` + `successRate`；闸门 `ratemetric` 在注入一处违规除法时**必须红**（闸门自身的回归测试） |

---

## 9. 实施顺序

| 阶段 | 内容 | 出口 |
|---|---|---|
| **F1 迁出与域对齐** | 建三个包 + registry/patch + 迁移存储 + 记录字段落地（D1/D2/D4）+ 删除火花侧脚本代码 + 域词汇闸门；行为与今天等价（除作用域收敛与新字段） | A1/A2/A3/A6 全绿；dock 里「脚本」模块可见 |
| **F2 发现升级** | 目录注入升级（指纹/状态/替换帧/门控）+ `script_list` 检索 + 主动建议迁移 | INV-4/5/6 有单测 + A4 真宿主通过 |
| **F3 治理** | 治理动作与审计面（§6.2）：建议引擎纯函数（§6.4）+ 审计读模型（§6.5）+ 过期惰性结算 + pane 从只读目录升级为治理面（概览 / 待裁决 / 状态动作 / 步骤详情） | A7/A8 全绿 + A4/A5 重跑（真宿主与预览都断言治理面） |

---

## 10. 非目标（本轮不做，留位）

1. **不接 `ctx.skills`**：不注册 provider、不写 `SKILL.md`、不做 `/` 菜单、不为 TUI/ACP 适配（理由见调研报告；这是**有意的**取舍，不是遗漏）。
2. **不自动执行脚本**（不代跑 `tool-call` 步骤）——模型读到步骤后自己执行。
3. **不与 HippoMemo / 火花互通**：不读对方的库、不写对方的记录；"这条流程源自那条想法/那条记忆"由 Agent 自己判断。
4. **不做跨工作区共享/导入导出/远端仓库**（治理阶段之后再评估）。
5. **不做脚本市场的元数据 manifest、不做嵌套分类目录**（若未来需要，另开 Spec）。
6. **不做 LLM 自动生成步骤**（`script_save` 只接受显式入参）。

---

## 11. 实现要点（模板引用，F1 照抄即可）

写 F1 时不需要重新发明任何机制，本仓已有同形制范本：

| 要做的事 | 模板（直接照抄的结构） |
|---|---|
| host 包 + cordis.patch（`bundle.patch`） | `packages/dsh-spark/package.json` + `cordis.patch.yml` |
| wire 包（schema + 事件 + 流帧 + 两个 contribution） | `packages/dsh-spark-wire/src/index.ts`（描述符在 `:353-366`，contributions 在 `:369-388`） |
| typert 流服务（无装饰器） | `packages/dsh-spark/src/events-service.ts`（`TypertRemoteService`，`super(ctx,'sparkEvents',{namespace:'spark'})`）+ 纯函数桥 `src/events.ts`（复用 kit `bridgeEvents`） |
| 插件自有 HTTP JSON API | `packages/dsh-spark/src/http.ts:51-56`（`ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path }), label)`）；**同前缀只能有一个注册者**（AGENTS §4） |
| JSONL 存储（含原子写与串行化） | `packages/dsh-spark/src/script-storage.ts`（整体搬走即可） |
| `agent/pre-step` 注入 | `packages/dsh-spark/src/inbox.ts:117`（升级点：指纹 / 状态 / 替换帧 / 门控） |
| client 包清单（`exports["./client"]` + `dsh.client.inject`） | `packages/dsh-finance-client/package.json` |
| dock 模块自注册（ADR-003） | `packages/dsh-plugin-kit/src/client/dock-module.ts:133` 的 `registerDockModule<I>(ctx, spec)`；调用范例 `packages/dsh-finance-client/src/client/FinanceDockModule.tsx:152`、`packages/dsh-hippomemo/src/client/HippoDockModule.tsx:46` |
| 客户端订阅流 | `packages/dsh-spark-dock/src/client/spark/SparkDockModule.tsx:73` 的 `subscribeFrames` |
| 闸门范式（Spec 单源 + 漂移检查） | `scripts/check-finance-price-drift.mjs` + `docs/FINANCE-PRICING-SPEC.md` |

**F1 执行顺序建议**（每步都可独立验证）：

1. 建 `dsh-script-wire`（schema 按 §2.1，含域词汇字面量）+ 在 `plugin-registry.json` 登记；
2. 建 `dsh-script` host：搬 `script-storage` / `script-service` / `script-match` / `seed-scripts` / `/scripts` 路由 / 四个工具 / 流服务 / 注入层（先保持行为等价，只加字段与作用域收敛 + 迁移）；
3. 建 `dsh-script-client`：搬 `ScriptsPane` + locale + `sparkApi` 的脚本方法 + `subscribeFrames`；
4. 删 `dsh-spark` / `dsh-spark-wire` / `dsh-spark-dock` 里的脚本代码（清单见 §7），更新 `cordis.patch.yml`；
5. 补测与闸门（§8 A1/A2/A3），跑全链 + 真宿主。

## 12. 跨插件对齐待办（P 项）

| # | 事项 | 现状 |
|---|---|---|
| **P-1** | `project` 作用域解析口径 | HippoMemo 按 `workspacePath` 精确匹配（`memory-core.ts:572-574`）；本 Spec 定义为项目根。统一需 HippoMemo 侧修订 |
| **P-2** | `sourceSessionId` 可空性 | HippoMemo 必填（`types.ts:32`）；脚本侧可空（种子/系统写入）。若统一为必填，种子需伪造会话 id（不接受），故暂时保留差异 |
| **P-3** | 是否抽共享 `*wire` 包 | 出现第三个消费者再评估（D3） |
| **P-4** | `global` 自动注入的"确认"机制 | **已关闭（D8，F3）**：不引入 `globalProven`；`global` 照常参与目录注入，收敛改由「降级作用域建议」（人工确认）承担 |
| **P-5** | `docs/spark-v2-design-2026-09-21.md` 的同步修订 | 该文件的模块副标题与工具表假定脚本属于火花；由持有该文件的会话改 |
