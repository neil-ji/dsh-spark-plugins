# 自研脚本插件 vs 平台 dsh skill：能否达到同一水平

> 调研日期：2026-09-21 · 触发问题：「脚本目录不该属于火花，但拆成自研插件，究竟能不能做到 dsh skill 的水平（比如按需加载），我不满意 skill 这种松散结构」
>
> 本文只回答**能力与代价**，不给最终产品决策；结论见 §7。
>
> 证据根目录（下称 `P`）：`/Users/neilji/.nvm/versions/node/v24.18.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`
> 本文所有 `file:line` 均指该目录下对应包。未打开文件确认的推断一律标注「**推断**」。

---

## 1. 结论摘要

分三层看，答案不一样：

| 层 | 自研能否达到 skill 水平 | 一句话依据 |
|---|---|---|
| **机制层**（目录注入、按需加载、热更新、per-agent 作用域、恢复/分叉安全） | **能**，而且成本不高 | 平台这一层**自己就是一个普通插件**（`P/dsh-tool-skill`），只用公开缝：`agent/pre-step` 事件 + `ctx.tools.register` + `ctx.skills.snapshot` + `@deepseek-ai/dsh-session` 的公开 API |
| **人面与生态层**（`/` 菜单、对话里的 Instructions 卡片、回放稳定、Web/TUI/ACP 三面一致、会话格式迁移、其它消费者） | **基本不能**（成本极高，且只能服务自家） | 这些能力分散在 `dsh-client-ui-skill`、`dsh-api-session-controller` 的 `skills/list` Remote、`dsh-session-format-*` 迁移里，全部以 `ctx.skills` 为唯一入口 |
| **数据模型层**（结构化步骤、触发器、成功率、溯源） | **平台 skill 达不到自研** | skill = frontmatter 5 个键 + 自由 markdown 正文；`metadata` 平台无人消费；没有计数、没有触发、没有验证 |

**因此「二选一」是假选择。** 真正的最优形态是第三种：**结构化数据仍是唯一真源，再注册一个 `SkillProvider` 把每条脚本暴露给平台**（`content` 由结构化步骤渲染成 markdown）。这样按需加载、目录注入、`/` 菜单、卡片渲染全是白拿，而「松散」被挡在渲染层之外——数据本身不松散。

---

## 2. 平台这条链到底怎么跑的（逐环证据）

### 2.1 目录注入：一个公开的 `agent/pre-step` 中间件

`P/dsh-tool-skill/lib/index.js:203-236`：

```
ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
  const decision = await next();
  const snapshot = ctx.tools.get(skillTool.name, agent) === skillTool
    ? await ctx.skills.snapshot({ cwd: agent.session.header.cwd, signal, scope: agent })
    : { skills: [], complete: true };
  ...
  const digest = digestCatalogEntries(entries);
  const history = catalogHistory(agent);
  ...
  const catalog = history.published ? renderCatalogUpdate(entries) : renderCatalogMessage(entries);
```

四个要点，全都是公开面：

- **钩子**：`agent/pre-step` 是全仓 **16 个第一方包**在用的公开事件（`dsh-agent`、`dsh-agent-instructions`、`dsh-time-context`、`dsh-repeat-tool-reminder` …）。我们仓库自己也已经用它两处（`packages/dsh-hippomemo/src/context.ts:64`、`packages/dsh-spark/src/inbox.ts:117`）。
- **工具门控**：先问 `ctx.tools.get(name, agent) === skillTool`（`P/dsh-tools/lib/types/index.d.ts:655` 的公开签名 `get(name: string, scope?: ScopeKey)`），即「这个 agent 真的能用 `skill` 工具，才给它目录」——这是 per-agent 可见性，不是全局开关。
- **作用域**：`scope: agent` 一路传进 `ctx.skills.snapshot/list/get`（`SkillViewOptions`，`P/dsh-skill/lib/types/index.d.ts:100-110`）。
- **增量发布**：对 `(name, description)` 列表做 sha256（`index.js:301-304`），与历史比对后决定「不注入 / 注入完整目录 / 注入**替换帧**」；替换帧的文案明确要求模型作废旧名单（`index.js:262-286`）。

### 2.2 catalog 状态存在会话日志里，不在插件内存里

`P/dsh-tool-skill/lib/index.js:331-348`：

```
function catalogHistory(agent) {
  const visible = new Set(agent.session.surface.nodes);
  for (let index = agent.session.seq - 1; index >= 0; index -= 1) {
    const event = agent.session.eventAt(SessionSeq(index));
    if (event.type !== "user/message" || event.data.source.kind !== "skill-catalog") continue;
    ...
```

`eventAt` / `snapshotEvents` / `surface` 都是 `@deepseek-ai/dsh-session` 的**公开导出**（我们的 `devDependencies` 里已经 pin 了 `@deepseek-ai/dsh-session@0.1.2-rc.1`，见 `package.json`；`P/dsh-session/lib/types/index.d.ts:175/184/109`）。

这条设计带来三个我们**目前没有**的性质：

1. 会话**恢复/分叉**后目录状态仍然正确（历史从日志重建，不依赖进程内存）；
2. 天然去重（同一 digest 不重复注入）；
3. 兼容「被外部写入 / 被迁移过」的历史（`index.js:316-330` 对不可读记录采取「当成不是我的目录」而不是抛错——抛错会让该会话此后每一步都失败）。

对比：我们的 `packages/dsh-spark/src/inbox.ts:100-103` 用的是 `WeakSet`/`WeakMap`（`injected`、`suggestedScripts`），只在 `step === 1` 注入一次，宿主重启或会话恢复后语义会漂。**这是"工程水准"差距的真身，不是能力有无的差距。**

### 2.3 目录帧的形状（模型与 UI 各取一半）

`P/dsh-tool-skill/lib/index.js:238-260`：注入的是一条 **user 消息**，正文是 `<system-reminder>` + `<available_skills>` 的伪 XML，`source` 是结构化元数据：

```
source: { kind: "skill-catalog", form: "catalog", entries }
```

目录行只有 name + description（`renderCatalogEntries`，`index.js:293-295`），描述按 `catalogDescriptionMaxLength`（默认 500）截断并折叠空白（`index.js:359-362`）。

### 2.4 按需加载：`skill` 工具（`list` → 策略校验 → `get`）

`P/dsh-tool-skill/lib/index.js:138-157`：先 `ctx.skills.list(lookup)` 找到同名 summary，校验 `isModelInvocable`，再 `ctx.skills.get(name, lookup)`，返回 `{ name, provider, resourceBase?, content }`；`render` 用 `renderSkillContent(value)` 包成唯一的 `<skill_content>` 形制（`P/dsh-skill` 导出，`index.js:133-137`）。

要点：**加载就是"一次性文本"**，平台侧不解释正文结构——step 也好、散文也好，对模型是一样的。（这既是"松散"的来源，也说明结构化只对我们自己有价值。）

### 2.5 用户显式调用（`/name`）

两条路都在这一个文件里：

- 手势识别：`SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`（`index.js:373`），只扫 `source.kind === "user"` 的消息（`index.js:381-394`）——即普通文本无法伪造。
- 注入：命中的名字走 `ctx.skills.get` + `isUserInvocable` 校验，然后作为 `source: { kind: "skill-invocation", form: "instructions" }` 的 user 消息注入（`index.js:168-202`），并在 `P/dsh-skill` 的 `MessageSourceMap` 里登记类型（`lib/types/index.d.ts:127-140`）——**transcript 消费者按元数据呈现，而不是重新解析模型可见文本**。

### 2.6 发现层（我们不想要、也用不上的那 880 行）

`P/dsh-skill-filesystem`（880 行）提供：项目/自定义/用户根目录扫描、YAML frontmatter 解析、chokidar 监视热更新（`lib/index.js:2-5,37-42,80`）、rank 优先级合并。官方 README 明确写了它只是**其中一个** provider：

> 「注册表（`dsh-skill`）接受任意提供方，其他提供方可以从别处提供 skill。」

`P/dsh-skill-badge`（53 行）就是「从别处提供」的最小范例：`list` 返回一条 candidate（带 `resourceBase` 指向包内 `assets/`），`get` 读包内 markdown。**这 53 行就是我们接缝适配器的规模上限。**

### 2.6b 生态与消费者全清单（谁在读 `ctx.skills`）

全仓 grep `ctx.skills` / `skills.*(list|get|snapshot|register)` 的结果，消费者只有这些：

| 消费者 | 位置 | 读什么 | 不走注册表会怎样 |
|---|---|---|---|
| `dsh-skill`（服务本体） | `P/dsh-skill/lib/index.js:132,147,216,224,236,250,404` | 写：`registerProvider`/`register`；读：`list`/`snapshot`/`get`；变更事件 `skills/change` | 任何平台路径都看不见 |
| `dsh-tool-skill` | `P/dsh-tool-skill/lib/index.js:145,148,181,207` | 模型目录 + `skill` 工具的唯一来源 | 目录不存在；`skill` 工具必失败；`/name` 注入静默跳过（`:184`，无告警、无回退分支） |
| `dsh-api-session-controller` → `SessionSkillCatalog`（**唯一人面端点**） | `P/dsh-api-session-controller/lib/types/skill-catalog.js:151-158` | `presets?.serviceFor(live,'skills') ?? ctx.get('skills')` → `list({cwd,scope}).filter(isUserInvocable)` | 浏览器 `/` 菜单恒空；无注册表时直接 `RemoteError('gateway/internal', 'skill registry is absent…')` |
| `dsh-client-ui-skill`（人面 UI） | `P/dsh-client-ui-skill/lib/client.js:253`（`skills.list({sessionId})`）、toolview key `"skill"` | `/` 源候选 + `skill` 工具行渲染 | 斜杠菜单没有 skill 分组 |
| `dsh-client-ui-chat` / `-trajectory` | `P/dsh-client-ui-chat/lib/client.js:4223,5198-5203`；`dsh-client-ui-trajectory/lib/client.js:493` | durable `user/message.source.kind === "skill-invocation"` → 用户气泡 chip / 轨迹 inject 标签 | **仍可复用**：这两个消费点认的是 *source kind*，不是注册表 |
| `dsh-agent-presets` | `P/dsh-agent-presets/lib/index.js:1670-1671`（`serviceFor`） | 按 agent preset 解析出一份 `skills` 实例 | 自研目录没有 preset 层概念 |
| `dsh-skill-filesystem` / `dsh-skill-badge` | `lib/index.js:48` / `:50` | 写注册表（两个 provider 范例） | —— |
| 会话格式迁移 | `P/dsh-session-format-v2-to-v3/lib/index.js:23-24`（`SOURCE_KINDS` 白名单含 `skill-invocation`/`skill-catalog`）、`v0-to-v1/lib/index.js:851-866`（严格形状校验） | durable source 形状 | 自研 source kind 不在白名单内 |

**未找到**：除 `skills/list` 外没有任何 skill Remote（无 `skills/get`、无 `skills/invoke`）；**没有任何 `skills/change` 的订阅者**（该事件只有 emit 侧，`P/dsh-skill/lib/index.js:404`）——所以「变更驱动刷新」这条实际收益有限，人面刷新走的是预设切换与连接重置事件；`dsh-commands` 里没有任何 skill 引用（skill 不是斜杠命令，斜杠只是输入层的一个 source）。

### 2.6c 一个反直觉的事实：人面这条路的"松散"更彻底

`/` 菜单选中技能后，客户端插入的是**纯文本** `/name `（`P/dsh-client-ui-skill/lib/client.js:313`，skill source 没有 codec），提交后由宿主用正则 `SKILL_GESTURE`（`P/dsh-tool-skill/lib/index.js:373`）在 `source.kind === "user"` 的文本块里重新扫出来（`:381-394`）。也就是说：**平台自己的"用户显式调用"链路就是一次文本往返 + 一次正则解析**，没有引用对象、没有强类型。这条正好印证你对"松散"的不适——但它是平台契约，我们改不动，只能选择接或是不接。

### 2.6d 发现层根目录与优先级（若走磁盘路线）

`P/dsh-skill-filesystem/lib/index.js:143-181` 的 rank 表：

| rank | source | 路径 |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `$DSH_HOME/skills`（跳过 `.system`） |
| 500 | `user-agents` | `~/.agents/skills` |
| 600 | `bundled` | 包内 assets（`dsh-skill-badge` 用这条） |
| 750 | runtime | `ctx.skills.register()`（provider 注册层） |

命名空间是**扁平**的：`<root>/<name>/SKILL.md` 或 `<root>/<name>.md`，嵌套不再下钻（官方 README 列为限制）。

### 2.7 人面层（自研接不上的部分）

`P/dsh-client-ui-skill`（客户端插件，宿主半边是空 `apply`）README.zh.md：

- `/` 候选来自宿主 **`skills/list` Remote**（该 Remote 归 `dsh-api-session-controller`，源码路径 `packages/api/session-controller/src/skill-catalog.ts`，见 `P/dsh-api-remotes/lib/client.js:8858` 的 `sourceLocation`）；
- `disable-model-invocation` 的 skill **只**能从这条路进入（模型面看不到），并在菜单里以当前语言标注「仅限用户」；
- skill 调用在对话里显示为可展开的 **`Instructions` 卡片**；行的名称/生命周期/正文只来自冻结的调用切片，**回放稳定**（目录变了也不改写历史）；
- 「同一条字面命令可以从 Web 编辑器、TUI 和 ACP 一致地加载 skill」。

另外 `P/dsh-session-format-v0-to-v1` / `v2-to-v3` 的迁移代码里也认得 `skill-catalog` —— 这个目录消息是**被平台版本化管理的会话概念**。自研造一个私有 source kind，拿不到迁移、也拿不到渲染。

**本机现状（可行性前提）**：这条缝在用户自己的 web 宿主（3080）上是**活的**——本会话的系统提示里就有 `available_skills` 目录（`browser-harness` / `find-skills` / `plugin-upgrade` / `ui-ux-pro-max`），工具表里有 `skill`。也就是说 provider 路线不需要我们先去启用什么，注册即可被消费。

---

## 3. 更正：frontmatter 到底能控什么（上一轮我说错了一点）

`P/dsh-skill-filesystem` 只认这几个键（`lib/index.js:690-706, 826-856`）：

| 键 | 作用 | 是否到达模型 |
|---|---|---|
| `name` / `description` | 必填；name 须 kebab-case | **只有这两个进目录行**（描述截断 500） |
| `whenToUse` | 可选的路由指引 | **不到达**。目录只渲染 name+description（`dsh-tool-skill:42-47,293-295`），官方 README 也写明「目录省略 `whenToUse`…加载后的包装层也不渲染它」 |
| `disable-model-invocation` | 布尔；模型面隐藏 | 是策略，不是内容 |
| `user-invocable` | 布尔；人面能否调 | 同上 |
| `metadata` | 自由对象，原样透传 | **平台无人消费**（只有自己的 provider 能解释） |

**推论（重要）**：想要「按条件决定要不要用这条流程」，只有两条落点——① 写进 `description`（唯一进模型的路由文本，500 字以内）；② 自己用 `agent/pre-step` 做主动注入（也就是我们现在的 C 档）。**指望自定义 frontmatter 字段驱动平台行为是不成立的。**

---

## 4. 平台自己承认没有的东西（正好是"专"的空间）

`P/dsh-tool-skill/README.zh.md` 的「已知限制」（原文摘录）：

- 目录省略 `whenToUse`、来源与提供方元数据 → 路由只基于名称与有上限的描述；
- **已加载正文没有大小上限**；
- 资源只是指引，不列举也不为模型取回引用文件；
- 加载是一次性文本，无部分内容/流式/缓存句柄；
- 目录替换是全量列表，**token 成本与目录大小成正比**；
- **正文不做版本化**：只改正文不改 digest，不会通知模型；旧工具结果仍是历史事实。

`P/dsh-skill-filesystem/README.zh.md` 的「已知限制」：发现深度一层、项目范围=最近 `.git` 祖先（monorepo 子项目不可选）、**格式错误条目随警告消失**（模型侧拿不到逐条诊断）、无正文修订协议。

对照我们的脚本数据模型（`ScriptView`）：`steps[]`（`instruction|tool-call` 结构化）、`triggers[]`、`invocationCount/successCount/failureCount`、`sourceSparkId`、`workspacePath` —— **这些恰好全是平台声明"不做"的方向**。这就是「做好脚本这一个很专的面」的位置。

---

## 5. 逐项能力矩阵（自研可行性判定）

判定口径：**可复刻** = 公开 API 直接实现；**半可复刻** = 能实现但只服务自家、拿不到平台生态；**不可复刻** = 依赖平台内部或需为每个前端重做。

| # | 能力 | 平台实现（证据） | 自研复刻代价 | 判定 |
|---|---|---|---|---|
| 1 | 每步按需注入目录 | `agent/pre-step`（`dsh-tool-skill:203`） | 我们已在用（`inbox.ts:117`） | 可复刻 |
| 2 | digest 去重 + 替换帧 | `:301-304, 262-286` | ~60 行 | 可复刻 |
| 3 | 目录状态耐久（resume/fork 安全） | 会话日志（`:331-348`） | ~40 行（公开 `dsh-session` API） | 可复刻 |
| 4 | per-agent 工具可见性门控 | `ctx.tools.get(name, agent)`（`:207`） | 1 行 | 可复刻 |
| 5 | per-agent / scope 隔离 | `scope: agent`（`dsh-skill:100-110`） | 我们已有 agent 维度 | 可复刻 |
| 6 | 按需加载正文 | `skill` 工具（`:138-157`） | 我们已有 `spark_invoke_script` | 可复刻 |
| 7 | 统一 `<skill_content>` 渲染 | `renderSkillContent`（`dsh-skill`） | 自己写渲染（`<脚本…>`）——形制私有 | 半可复刻 |
| 8 | 描述截断/转义 | `:293-295, 359-362` | ~10 行 | 可复刻 |
| 9 | 用户 `/name` 手势 | `:373-394` | ~30 行解析 + 自己的注入路径 | 半可复刻 |
| 10 | `/` 输入菜单候选 | `skills/list` Remote（`skill-catalog.js:151-158`）+ ui-skill | 需自建 Remote + client 插件 | **不可复刻** |
| 11 | 对话内 Instructions 卡片 / 回放稳定 | ui-skill toolview key `"skill"`、chat 认 `skill-invocation` | **可复用**：渲染认的是 source kind 与工具名，复刻形状即可拿到；「回放稳定」是平台冻结调用切片的性质 | 半可复刻 |
| 12 | Web / TUI / ACP 三面一致 | 同一字面命令 + 各自前端 | 每个前端各做一遍 | **不可复刻** |
| 13 | 会话格式迁移认得目录消息 | `session-format-v2-to-v3:23-24`、`v0-to-v1:851-866` | 私有 kind 不在白名单内（`skill-invocation` 那一半可复用） | 半可复刻 |
| 14 | 与用户自写 skill 合并、优先级 | `dsh-skill` rank/layer（`:294-321`） | 自研目录天然是孤岛 | 不可复刻（除非成为 provider） |
| 14b | preset（agent preset）级作用域 | `dsh-agent-presets:1670-1671` + `skill-catalog.js:151` | 自研目录没有 preset 层概念 | 不可复刻（除非成为 provider） |
| 15 | 热更新（新增/改名/删除即达） | chokidar（`dsh-skill-filesystem:37-42`） | 我们每次查询都读 JSONL，天然最新 | 可复刻（甚至更强） |
| 16 | 正文大小上限 | 无（平台自己缺） | 我们可加：结构化 steps ≤50 / payload ≤2000 | 自研更强 |
| 17 | 逐条诊断（无效/缺失可区分） | 无（随警告消失） | 我们可加：解析失败逐条报错 | 自研更强 |
| 18 | 调用/成功/失败计数与成功率 | 无 | 已在 `ScriptView` | 自研更强 |
| 19 | 按最近工具序列主动建议（触发匹配） | 无（只有描述路由） | 已有 `script-match.ts` | 自研更强 |
| 20 | 正文版本化 / 改动可知 | 无（官方列为限制） | 我们可加 `revision`/digest | 自研更强 |
| 21 | 失败驱动修订（命令坑→改步骤） | 无 | 已有 `command-mining.ts` 雏形 | 自研更强 |
| 22 | 结构化步骤（可被判分/可执行） | 无（正文是文本） | 已在 `ScriptView.steps` | 自研更强 |

**读法**：1–9 是"自研能追平"的机制层（合计约 150–200 行新代码）；10–14 是"只有注册进 `ctx.skills` 才能拿到"的生态层；16–22 是"平台缺、我们有"的差异层。**没有任何一项要求我们放弃结构化数据模型。**

---

## 6. 复刻成本实测（行数口径）

| 组件 | 行数 | 自研是否需要重写 |
|---|---|---|
| `dsh-tool-skill`（目录 + 加载器） | 396 | 只需其中目录部分（约 200 行）的**技术**，且我们已经有一版（`inbox.ts` 的 pre-step 注入 + `spark_invoke_script`），缺的是 §2.1/2.2 的工程质量 |
| `dsh-skill`（注册表/合并/优先级） | 565 | **不需要**（我们的存储就是唯一源，没有多 provider 合并问题） |
| `dsh-skill-filesystem`（发现/监视/frontmatter） | 880 | **不需要**（我们自己就是存储） |
| `dsh-skill-badge`（provider 范例） | 53 | 若走 provider 路线，这是要写的全部规模（适配器） |

换算：**「纯自研目录达到平台机制水平」≈ 我们现有 510 行脚本代码 + 约 150 行注入层升级**（把 WeakSet 换成会话日志 + digest + 替换帧）；**「自研数据 + 接进平台」≈ 上述 + 53～120 行 provider 适配器**。后者的边际成本很小，却买回了 §5 的 10–14。

---

## 7. 结论与建议形态

1. **按需加载这件事，自研现在就已经有**（`spark_invoke_script` 返回步骤 = `skill` 工具返回正文），差的不是能力而是**目录注入的工程水准**（会话日志化的历史、digest、替换帧、per-agent 门控）。
2. **你对"松散结构"的不满在平台侧是**被官方文档盖章**的**：frontmatter 只有 5 个键、`whenToUse` 到不了模型、`metadata` 无人消费、正文自由且无版本化。走 B2（写 `SKILL.md` 交给文件系统 provider）等于把我们的结构化真源降级成 markdown——**不建议**。
3. **建议形态（B1 变体）**：
   - **真源**：结构化 `ScriptView`（steps / triggers / counters / provenance），存储可保留 JSONL，`/scripts` 这类私有 HTTP 目录可以退役；
   - **模型面**：注册一个 `SkillProvider`（规模参照 `dsh-skill-badge` 53 行），`list` 把每条脚本映射成 candidate（`description` 里塞进路由条件，因为 `whenToUse` 到不了模型），`get` 把结构化 steps **渲染成** markdown 正文；
   - **人面**：`/` 菜单、Instructions 卡片、三面一致全部白拿；
   - **保留我们的差异件**：计数/成功率、`script-match` 主动建议、「结构化步骤 + 验收步骤」这类平台没有的东西（也可以把成功率的权威来源继续放我们这边，因为 provider 的 `get()` 可自然记一次调用）；
   - **明确不做**：不重写目录注入管道、不做自己的 `/` 菜单与卡片、不为 TUI/ACP 各写一遍。
4. **待拍板**（与上一轮同一组，但选项已被这次调研收窄）：
   - 是否接受「provider 暴露 + markdown 只当视图」这一形制（我的建议：接受）；
   - 主动建议（C 档）留还是砍——目录注入后它覆盖的场景少了，但它能表达"最近跑过这几条命令 → 有现成流程"这种平台表达不了的条件；
   - 包名与用户可见词（朴素命名：脚本 / 流程）。

---

## 附：本次调研中**未验证**的点

- TUI / ACP 的具体消费实现（未打开对应包，结论来自 ui-skill README 的声明与「同一字面命令」的表述）；
- provider 注册后在本机 web profile 的**实际生效路径**（需要一次真宿主实验：把 `@deepseek-ai/dsh-skill` 加进 peer/dev 依赖、注册 provider、断言目录里出现我们的条目、并确认 `skills/list` 里出现我们的名字）；
- `dsh-skill-badge` 在默认组合里是否为 `disabled: true`（子调研称 `dsh-base/cordis.patch.yml:279-281` 默认关闭，我未打开该文件确认）。

## 附：行号可信度说明

本报告的 `dsh-tool-skill` 行号由我逐段打开文件核对（`inject` 35-39、`register` 167、`/name` 注入 168-202、目录注入 203-236、`renderCatalogMessage` 238-260、`renderCatalogUpdate` 262-286、`renderCatalogEntries` 293-295、digest 301-304、`catalogHistory` 331-348、描述截断 359-362、`SKILL_GESTURE` 373、`invokedSkillNames` 381-394）。协作调研返回的另一套 `dsh-tool-skill` 行号有约 +7 的偏移（已抽查 `:167` 实为 `ctx.tools.register(skillTool)`），因此本报告不采用其 tool-skill 行号；其余包的引用已抽查通过（`dsh-skill:147,216,224,236,250,404`、`skill-catalog.js:151,152,158`、`ui-skill client.js:253`、`chat client.js:4223,5198-5203`、`v2-to-v3:23-24`、`agent-presets:1670-1671`、`filesystem:155,160,172,177`）。
