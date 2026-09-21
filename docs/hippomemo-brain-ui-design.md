# hippomemo 脑科学记忆插件 · UI 设计文档（v3）

> 状态：**设计定稿**（2026-09-01）；**IA 于 2026-09-21 收敛为四页签（偏好 → 待办）**，改动见 §2
> 原则：**功能点第一，UIUX 规范只做服务。** 脑科学名词 + 实时脑区动画 + 旁白 = 神秘感/专业感包装，但**每个动画必须绑定真实事件**，不产生无意义装饰。

---

## 0. 背景与纠偏记录

### 走过的弯路（必须记录，避免重犯）

1. **v1（hippomemo-cognitive-ui-preview.html 第一版）**：营销色 + 5-7 个饱和 Pill 挤一行 + emoji 抢戏 + 5 tab 平铺。失败原因：**把"脑科学"做成装饰标签强塞给用户**。
2. **v2（同一文件名重写）**：走 ui-ux-pro-max 的 Knowledge Base 调性（slate + 单一强调色 + <=3 pill + KPI 条），**视觉干净了，但丢了功能点**——偏好、来源溯源、召回行为这些插件灵魂被当装饰删掉。失败原因：**拿通用 UIUX 规范当唯一真理动刀，舍本逐末**。
3. **v3（本文档）**：回到功能点为根本，UIUX 规范只做服务。

### 用户核心诉求

- **看得明白**：AI 用了什么记忆、抑制了什么、记忆从哪来、什么需要我处理
- **用的舒服**：沉淀不繁琐、偏好被理解且不被误读、不污染其他工作区
- **信任**：我记的东西真的被用了吗（引用证据）
- **包装**：脑科学名词对普通人抽象，但搭配**实时脑区动画 + 旁白**会成为神秘感、专业感的包装手段

---

## 1. 功能点清单（根本）

| # | 功能点 | 代码载体 | 用户价值 | 当前状态 |
| - | --- | --- | --- | --- |
| F1 | 记忆沉淀（手动/工具写入 5 种 kind） | memory_remember tool | 我沉淀的东西被持久记住 | 已有 |
| F2 | 自动召回（相关记忆注入上下文） | hippomemo-context | AI 在我工作时自动想起该记的事 | 已有 |
| F3 | 前额叶抑制（cognitive 模式主动过滤低相关） | relevance.ts + context.ts | AI 不往我上下文塞噪音 | 已有 |
| F4 | 偏好识别（杏仁核 valence miner 从情绪挖偏好 + 手敲） | dsh-spark valence | AI 从我的语气里学到"我讨厌什么/坚持什么" | 已有（spark 侧） |
| F5 | 偏好衰减/修订（30d half-life，floor 40%） | valence.ts decayImportance | 过期偏好不误伤我（防"懂→误读"） | 已有 |
| F6 | 记忆自净化（过期归档/观察期/近重复合并/LLM 复核） | memory-evolve.ts | 记忆库不腐烂，垃圾自动清理 | 已有 |
| F7 | 来源溯源（spark → 结晶 → memory 反向链） | sourceSparkId | 我知道"这条记忆来自哪次灵感" | 半有（字段有了，UI 无跳转） |
| F8 | 跨工作区证据（globalProven + seenWorkspaces） | memory-core.ts | 全局记忆不污染别的工作区 | 已有 |
| F9 | 召回/引用统计（recallCount/citationCount/转化率） | memory-core.usage() | 我知道 AI 到底有没有用我记的东西 | 已有 |
| **F10** | **召回事件记录（注入/抑制时间线）** | **待建** | **用户能看到"AI 这轮用了什么、抑制了什么"** | 缺 |

**F10 是本次设计暴露的新功能点**：当前 hippomemo-context 只在 pre-step 注入，**没有记录"这轮注入了什么、抑制了什么"**。
「AI 最近在用」象限 + 旁白都依赖它。

---

## 2. 主面板信息架构（四个一级页签，按**动词**切）

> **2026-09-21 裁决（本文档的 IA 真源）**：一级页签不按「数据 kind」切，按**用户此刻要干的动词**切。
> 原设计是「四象限单页 + 偏好专区」；面板空间小，2026-09-01 已拆成 4 个 tab，其中「偏好」成为
> 与「记忆」并列的一级 tab。问题是二者本就是**同一个数据集**（偏好 = `kind=preference ∩ active`，
> 实测 9/239 条），于是读起来是「库 vs 一份更弱的库」：偏好页没有搜索/分页、静默封顶 200 条；
> 记忆页筛 kind=偏好 又拿不到衰减与来源。更硬的问题在同一记录的**裁决面重叠三处**，且其中两处结论相反。
> 收敛结果：**记忆 = 库（查改）· 待办 = 唯一的人工裁决面（办）· 进化 = 机器的活（管）。**

| tab | 动词 | 内容 | 备注 |
| --- | --- | --- | --- |
| 总览 | 看 | 脑区状态条（默认细条，可展开四脑区）+ AI 最近在用（召回时间线） | 状态与验证 |
| 记忆 | 查 | 全量清单 + 搜索/筛选/分页 + 详情 modal + CRUD | **所有 kind 一视同仁**，偏好不再特殊渲染 |
| **待办** | 办 | 唯一的人工裁决面（要你表态的件） | 见 §2.1 |
| 进化 | 管机器 | 引擎身份 + 自动处理队列（观察中，只读）+ 指标 + 图表 + 扫掠报告 | 名字随语义搬家 |

### 2.1 待办 = 唯一的人工裁决面

**进件门槛**（三条缺一不进）：① 一条明确的建议动作 ② 证据（为什么是现在）③ 不表态会怎样。
只报事、没人需要拍板的，不进待办 —— 否则一年后它就是个通知中心。

两条进件来源：

| 来源 | 判定 | 行内动作 |
| --- | --- | --- |
| 宿主候选（`/hippomemo/candidates` 去掉观察期行） | 过期 / 疑似重复 / 降级建议（`downgrade-scope`） | 采纳建议：归档 / 合并 / **降为工作区** |
| 偏好（`/hippomemo/preferences`） | 未确认 **且** 衰减压到地板（损失 ≥ 60%，约 40 天未命中）；规则住在 `src/preference.ts` | 主按钮：有建议就采纳（归档 / 合并 / 降为工作区），无建议则「归档」；反向动作**确认**（信任为通用偏好） |

- **单一裁决面**：一条记录只在一个地方能被裁决。以前同一条未证明的全局偏好，在偏好页是
  「确认 → 提为 global + proven」、在进化页是「确认 → 降为 workspace」——**同一个词、相反方向**。
  现在合并成待办里的一行，两颗按钮各自标签诚实（`降为工作区` / `确认`），归属不再分裂。
- **同一记录只出一行**：偏好若同时被引擎建议降级，那一行同时带两个方向的按钮，而不是在两张卡里各出现一次。
- **观察期不进待办**：`expiresAt` 未到的记录由引擎到期自动归档、被引用自动取消，没人需要拍板。
  它们是只读状态行，挂进化页的「自动处理队列」。
- **一行的信息密度**：pill 是候选类别（`偏好待审` / `范围待审` / `疑似重复` / `过期`），
  证据行给结构化事实（偏好：来源 · 命中 · 上次浮现 · 衰减；候选：引擎 reason 的本地化文案）。
  点标题进详情弹窗 —— 修订与删除（破坏性动作）都在那儿，队列里不铺删除入口。
- **偏好的完整清单不在待办**：待办只装要你表态的那几条，底部一行「全部偏好（N 条）→ 记忆」
  跳到记忆页并预筛 `kind=偏好`。这样「记忆 = 唯一记录视图」没有例外，而偏好的专属派生字段
  （来源/衰减/命中）只在**需要它做决策**的地方出现。

### 2.2 归属与命名（2026-09-21）

- **专属本插件**：待办是 hippomemo 自己的面。财务/凭证等确认**保留在各自插件内部**，
  不混入、不做跨插件统一收件箱。共享的是**约定**（每个插件各有自己的待办 + 同一条进件门槛），
  不是同一个面；所以文案里不许出现「所有需要确认的东西」这类普适措辞。
- **名字**：一级 tab 与卡头统一叫「待办」（en: To-do）。语用依据：中文里「待办」已含
  「别人派给你、等你处理」（飞书/钉钉），而「收件箱」是邮件/被动接收语义，已否决。
  因为「待办」的默认心智是「我自己记的」，卡内首行必须写明来源是系统建议。
- **「自动处理队列」搬家**：这个名字不是被删掉，而是还给进化页 —— 它描述的正是引擎自己处理的那一列
  （观察期自动到期归档）。一个东西一个名字。

---

## 3. 叙事层：脑区动画 + 旁白（神秘感/专业感包装）

### 核心原则：动画 = 真实事件反馈，不是装饰

| 脑区 | 真实事件 | 动画触发（不是常驻！） | 旁白（短句） |
| --- | --- | --- | --- |
| 前额叶 | 一次 recall 注入完成 | 脉冲一次，显示「注入 5 / 抑制 23」 | "前额叶过滤了 23 条低相关候选" |
| 杏仁核 | valence 检测到强情绪 → 提取偏好 | 红色微光闪一次（偏好落库；要你表态时在待办里出现一行） | "从你的语气中识别到一个偏好" |
| 海马体 | spark 结晶 → memory | 闪光一次，点亮新记忆 | "灵感已结晶为长期记忆" |
| 新皮层 | 记忆库变更（写入/归档） | 波纹扩散一次 | "记忆库已更新" |

### 四条铁律（防止回到"花里胡哨"）

1. **动画 = 真实事件反馈**。每条动画对应一次真实的 hippomemo/changed 或 recall 事件，没事件就不动。
2. **默认低干扰，可展开**。脑区状态条默认是**一条 ~28px 高的细条**（4 个脑区小圆点 + 最近事件旁白），想看大图展开成完整脑区 SVG（带标注）。
3. **有真实数据支撑**。旁白"抑制 23 条"来自 cognitive filter 的真实过滤计数（依赖 F10）。
4. **尊重 reduced-motion**。用户偏好减少动画时，脑区条退化为纯文本状态行。

### 名词呈现尺度

- **默认说人话**：UI 主文案用"AI 最近想起…""这条记忆来自一次灵感"，不用脑区名词
- **旁白 + 展开图**里出现"前额叶/杏仁核/海马体"，且**永远跟一个具体动作绑定**（"前额叶过滤了…""杏仁核识别到…"）
- 懂的人觉得专业，不懂的人觉得神秘但能通过旁白理解发生了什么

---

## 4. 三层工作量（功能层优先）

| 层 | 内容 | 状态 | 依赖 |
| - | --- | --- | --- |
| **功能层（host）** | F10 召回事件记录：注入/抑制/引用时间线表 + 事件源 + HTTP API | 必须做 | — |
| **结构层（client）** | 四页签主面板（总览/记忆/待办/进化）+ lineage 可点开 | 必须做 | 功能层 |
| **视觉层（UIUX）** | 脑区状态条 + 动画 + 旁白，全部 tokens-first | 包装 | 结构层 |

### F10 设计规格（功能层，可执行）

**目标**：让 UI「AI 最近在用」时间线 + 脑区旁白有真实数据源。每次自动召回（pre-step 注入）记录一条事件：注入了哪些、抑制了哪些、为什么抑制。

#### 数据模型（storage-domain，spec.ts 新增表）

```ts
// spec.ts — recallEventRecord（挂在 hippomemo domain，version 2 → 3）
const recallEventRecord = z.object({
  id: memoryId,              // 事件 id（uuid）
  ts: z.number(),            // 注入时刻（Date.now()）
  sessionId: z.string().min(1),
  workspacePath: z.string().nullable().default(null),
  query: z.string().max(200).default(''),          // 触发召回的 query（脱敏后）
  mode: z.enum(['firehose', 'cognitive']),          // 当时 recallMode
  injectedIds: z.array(memoryId).max(32).default([]),      // 实际注入的（放行）
  suppressedIds: z.array(memoryId).max(64).default([]),    // 候选里被抑制的
  suppressedReasons: z.record(z.enum(['threshold','decay','kind']), z.array(memoryId)).default({}),
    // 抑制原因分组：threshold=相关度低于阈值 / decay=衰减至 floor / kind=非 preference 不匹配
})
```

**表注册**（spec.ts tables 加 `recallEvents: domainTable<MemoryId, RecallEventRecord>`，version 2→3）。

#### 服务层（memory-service.ts）

```ts
// MemoryService 新增
private recallEventTable?: KvTable<MemoryId, RecallEventRecord>
private readonly recallEventLog: RecallEventRecord[] = []   // 内存镜像（同 citations 模式）

// init 里 open：this.recallEventTable = domain.table('recallEvents')

/** 供 hippomemo-context 调用：记录一次召回事件 */
async recordRecallEvent(input: RecallEventInput): Promise<RecallEventRecord> {
  const event = { id: this.newId(), ts: Date.now(), ...input }
  await this.requireRecallEventTable().put(event.id, event)
  this.recallEventLog.push(event)
  this.emit({ operation: 'recall-event', id: event.id })
  return event
}

/** 供 UI 消费：分页查询 */
recallEvents(query: RecallEventListQuery = {}): RecallEventListResult {
  // 过滤（可选 sessionId/workspacePath）→ 按 ts desc 排序 → cursor 分页（同 citations）
}
```

**副作用**：
- 注入侧：现有 `markRecalled` 已记账（recallCount + lastRecalledAt）——不重复。
- 抑制侧：**不调用 markRecalled**（被抑制 ≠ 被召回，避免污染 recallCount 语义；设计文档 §4 原草案注记保留）。
- 事件表是**追加日志**（append-only），不参与 search 索引、不进 memory-core。

#### 事件源接线（context.ts）

在现有 pre-step 注入逻辑里，`renderRecallMessage` 之后（L109-113）补：

```ts
const injectedIds = (recall.source as { memoryIds?: string[] }).memoryIds ?? []
// 抑制侧：injectable（候选）减去 injectedIds（放行）= 被抑制的
const suppressedIds = injectable.map(h => h.record.id).filter(id => !injectedIds.includes(id))
// 抑制原因分组：对每个被抑制 id，按 scoreRelevanceAdjusted 结果归类
const suppressedReasons = groupSuppressed(injectable, injectedIds, recallConfig)

// 记事件（fire-and-forget，失败仅降级时间线）
void ctx.memory.recordRecallEvent({
  sessionId: agent.session.id,
  workspacePath: cwd ?? null,
  query: query.slice(0, 200),
  mode: isCognitive ? 'cognitive' : 'firehose',
  injectedIds,
  suppressedIds,
  suppressedReasons,
}).catch((error) => ctx.logger.warn('hippomemo: recall event record failed: ' + String(error)))
```

`groupSuppressed` 是纯函数（放 relevance.ts）：对每个被抑制 id 计算 `scoreRelevanceAdjusted`，< threshold 归 'threshold'；因 decay floor 归 'decay'；非 preference 归 'kind'。

#### HTTP API（http.ts 新增两个 route）

```
GET /hippomemo/recall/events?limit=&cursor=&sessionId=&workspacePath=
  → { ok: true, value: { items: RecallEventRecord[], total, nextCursor } }
GET /hippomemo/recall/events/latest
  → { ok: true, value: RecallEventRecord | null }   // 最近一条（脑区旁白用）
```

复用现有 `readJsonBody`/`isTrustedBrowserRequest`/`send` 基建。

#### 类型（types.ts）

```ts
export interface RecallEventRecord { id; ts; sessionId; workspacePath: string | null; query: string; mode: 'firehose'|'cognitive'; injectedIds: string[]; suppressedIds: string[]; suppressedReasons: Record<string, string[]> }
export interface RecallEventInput { sessionId; workspacePath?: string | null; query: string; mode; injectedIds; suppressedIds; suppressedReasons }
export interface RecallEventListQuery { sessionId?: string; workspacePath?: string; limit?: number; cursor?: number }
export interface RecallEventListResult { items: RecallEventRecord[]; total: number; nextCursor?: number }
export type HippomemoChangedOperation = 'put' | 'deleted' | 'recall-event'  // emit 扩展
```

#### 客户端（api.ts）

```ts
recallEvents(query?: RecallEventListQuery): Promise<RecallEventListResult>  // GET /hippomemo/recall/events
recallLatestEvent(): Promise<RecallEventRecord | null>                     // GET /hippomemo/recall/events/latest
```

#### 测试计划

- **spec-heal**：recallEventRecord schema 解析（含默认值、空数组、max 截断）
- **memory-service**（新 test/recall-event.test.ts）：recordRecallEvent 写表 + recallEvents 分页 + latest 返回 null（无事件时）
- **relevance**：groupSuppressed 纯函数（threshold/decay/kind 三分类）
- **context**（integration，若有 harness）：注入后事件表 +1，suppressedIds = 候选-放行

#### 里程碑（验收 mock 后）

1. spec.ts + types.ts（表 + 类型）
2. memory-service.ts（记录 + 查询 + latest）
3. context.ts（事件源接线 + groupSuppressed）
4. http.ts + api.ts（两个端点 + 客户端）
5. 测试 + build 全绿
6. 结构层（四页签 UI）接入真实数据


---

### F11 设计规格（待处理候选池，可执行）

**目标**：让 UI「待办」页有真实数据源（原「需要我处理」象限）。当前 `/hippomemo/evolve/last` 只返回**最近一次已执行的扫掠报告**（actions=已计划/已应用），不是「当前等待用户决策的候选」。

**方案**：新增 `GET /hippomemo/evolve/candidates` —— 实时计算当前待处理候选，不执行任何写操作（纯查询）。

#### 数据来源（memory-core 只读查询）

每次请求时对 `ctx.memory.list({ status: 'active', limit: MAX })` 跑一遍**只读版 planEvolution**（dryRun 语义），把「候选」从「已应用」里分离：

```ts
// memory-evolve.ts 新增纯函数
// 对一条 active 记忆判断它当前属于哪类待处理候选（或不属于）
export function candidateKind(record: MemoryRecord, now: number, opts: EvolveOptions): CandidateKind | null
// CandidateKind = 'probation' | 'near-duplicate' | 'expired' | 'preference-review' | null
```

候选类型（对齐 mock「需要我处理」三类 + 偏好一类；落地口径见下表下方注）：

| CandidateKind | 判定（全部只读） | mock 对应 |
| --- | --- | --- |
| `expired` | expiresAt 已过且无引用（观察期结束） | 「已过期 30 天 · 无引用」 |
| `near-duplicate` | 标题 Jaccard ≥ 阈值 + 双引用（需人工决断） | 「疑似重复 · 建议合并」 |
| `preference-review` | 引擎建议 `downgrade-scope`（声称通用、但只在来源工作区出现过）——**该建议不限 kind** | 「声称通用，只在来源工作区出现过」 |
| `observation` | `expiresAt` 未到（观察中）：只读状态行，没人需要拍板 | 「观察期中的噪音」 |

> **落地口径（2026-09-21）**：`preference-review` 的 pill 文案按 `memoryKind` 分岔 ——
> 偏好说「偏好待审」，其余说「范围待审」（枚举名保留 `preference-review` 不动协议字段）。
> 「衰减到地板、未确认」这一条进件规则**不在宿主候选里**，而是与宿主算 `decayPercent` 共用
> `src/preference.ts` 的同一份数学，由待办队列在客户端合并进来（§2.1）。这样避免两处阈值各说各话。

> **实现提示**：`preference-review` 的「衰减状态」现有 MemoryRecord 无直接字段（importance 是静态的，不随 30d 衰减）。
> 两种实现路径（验收后选一）：
> a) 复用 spark valence 的 `decayImportance` 纯函数（dsh-spark/src/valence.ts 导出），在 hippomemo 侧对 preference 按 lastRecalledAt 计算当前衰减值，低于阈值即候选；
> b) 在 MemoryRecord 新增 `preferenceConfirmed?: boolean` + 依赖 lastRecalledAt 计算。
> 路径 a 零 schema 变更，推荐。

#### HTTP API（http.ts 或 evolve 模块新增）

```
GET /hippomemo/evolve/candidates?limit=&cursor=
  → { ok: true, value: { items: PendingCandidate[], total, nextCursor } }
GET /hippomemo/evolve/candidates/stats
  → { ok: true, value: { byKind: Record<CandidateKind, number> } }  // 脑区/象限角标用
```

`PendingCandidate = { id, kind: CandidateKind, title, reason, at, actionable: boolean }`
（actionable=false 表示信息性展示，无可一键操作——如 probation 观察中）

#### 副作用

- **只读**：不写表、不归档、不改 expiresAt。候选的「处理」（确认/合并/归档）仍走现有 `PATCH /hippomemo/records/:id`（改 status/expiresAt/relatedIds）。
- 与 `/evolve/last` 的关系：`/evolve/last` 是「历史扫掠报告」，`/evolve/candidates` 是「当前待决策」——前者看过去，后者看现在。

#### 测试计划

- **candidateKind** 纯函数：4 类候选的判定 + 边界（active 非候选返回 null）
- **candidates API**：返回当前候选、byKind 统计、只读（调用后无写操作）

#### 里程碑（F11 并入 F10 之后的 M7）

7. memory-evolve.ts candidateKind + http.ts /evolve/candidates（+ stats）
8. 结构层「待办」接入真实候选

---

## 5. 验收标准（mock 阶段）

用户验收 mock 时确认：

1. **四个一级页签**是否各自只干一件事（总览看 / 记忆查 / 待办办 / 进化管机器），
   且「记忆」与「待办」之间没有"同一批东西看两遍"的重复感
2. **脑区状态条**的"神秘感/专业感"感觉对不对（默认细条 + 展开大图 + 动画触发）
3. **旁白**是否"说人话"且与动作绑定
4. **待办行**是否一眼看懂"系统建议什么、我可以不同意"（两颗按钮、标签诚实、证据齐全）；
   偏好与普通记忆在记忆页是**同一种行形制**（不再有专区材质差异）
5. **动画克制**——不觉得花哨（reduced-motion 可关）

---

## 6. 相关文件

- 设计文档：本文档
- mock（完整，已完成）：docs/hippomemo-brain-ui-preview.html —— 四象限主面板 + 脑区状态条（默认细条/展开图）+ 偏好专区 + 动画演示（4 脑区触发 + 旁白联动）。
  - 图标用内联 stroke SVG（与 dsh-ui-kit icons 风格一致），无 emoji。
  - 交互接线已验证：toggleBrain（展开脑区图）/ demoEvent（4 脑区动画 + 旁白更新）均可用（Chrome 实机触发确认）。
  - 已补 prefers-reduced-motion 降级（动画关、文本保留）。
  - **动画实机验证（CDP 真实时间轴）**：触发前额叶脉冲后 box-shadow 半径 4.4→8.1→11.4→13.4px 单调扩散、alpha 0.35→0.02 衰减，动画确实在播放（非类名摆设）。注意 headless --virtual-time-budget 会冻结 CSS 动画（显示停在 0% 帧），需用真实时间轴 CDP 验证。
  - 已做全：全部记忆（20 条 mock 数据，可搜索/筛选/分页）+ 详情 modal + lineage 展开（spark→结晶→memory）+ 需要我处理操作（确认/合并/归档）实时交互。
  - **注意**：mock 里的「偏好专区」是 2026-09-21 裁决前的形制，已被「待办」取代（见 §2）；mock 文件保留作历史参照，不回改。
  - 0 emoji（全内联 SVG）；真实动画事件仍依赖 F10。
- 旧 mock（历史参照，勿删）：docs/hippomemo-cognitive-ui-preview.html
- 真实代码：packages/dsh-hippomemo/src/client/（v3 落地前暂不动）
