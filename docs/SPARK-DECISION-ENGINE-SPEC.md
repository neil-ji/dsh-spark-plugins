# SPARK-DECISION-ENGINE-SPEC — Spark 决策分级层与智能规则引擎规范

> 状态：设计定稿，未实现。本文件是「决策分级层（静态规则 → 智能精判 → 升级路径）」
> 的唯一规范源。实现与本文冲突时**先改本文**（commit 用 `docs(spark):`）。
> 背景研究与实验数据见 §9 与 spark 记录（`e1b19ab6` / `4d6faf37`）。

---

## 0. 结论速览

1. 引入**决策分级层**作为 spark 侧的一等抽象：静态规则（开箱即用）→ 智能精判
   （可选增强，首个后端为 Jev）→ 升级路径（低置信回退）。
2. Jev（TypeSafe AI System One 模型）定位为**可选强化功能**：未配置/关闭时
   系统行为与现状零差异；不产生任何硬依赖。
3. 配置入口：**spark 指挥舱导航新增「设置」pane**，spark 全局配置专用。
   不涉及 dock 改动、不收编其他插件配置、不产生架构修订。
4. 凭据走宿主凭据缝（`JEV_API_KEY`），settings 走 `settingsScope`（per-profile）。
5. 所有 Jev 调用发生在**宿主侧**可选 service；wire / client 不出现外部 HTTP。

---

## 1. 术语与定位

| 术语 | 含义 |
|---|---|
| 静态规则引擎 | 现有零成本确定性逻辑（Jaccard、valence 加权、TTL 规则等）。永远存在，不可关闭。 |
| 智能规则引擎 | 可选的模型精判后端。首个 provider 为 Jev（`jev-latest` / System One 模型）。 |
| 决策分级链 | 每个接缝点共用的判定流程：静态规则产出候选/初判 → 智能精判（conf ≥ 阈值采纳）→ 低置信走升级路径。 |
| 升级路径 | conf 低于阈值时的处置：采纳静态规则结果（默认）/ 交大模型 / 人工（本版只实现第一种）。 |
| Provider | 智能规则引擎的具体后端实现。本版仅 `jev`；接口按可插拔设计，未来可纳入本地小模型等。 |

**定位红线**：智能规则引擎是「增强」而非「替换」。它必须能被关闭、能失败、能超预算，
且三者发生时系统自动、无声地退回静态规则结果。

## 2. 接缝清单（S1–S5）

| # | 位置 | 现有静态规则 | 智能精判 | 原语 |
|---|---|---|---|---|
| S1 | `dsh-hippomemo/src/memory-evolve.ts` `titleTokenJaccard` + `dupTitleThreshold` | 标题 token Jaccard 阈值 → supersede/link | Jaccard 初筛候选对 → 逐对 Noul 判重定夺 | Noul |
| S2 | `dsh-hippomemo/src/relevance.ts` | token 重叠打分 | 召回相关性精排 + 校准置信度 | Score |
| S3 | `dsh-spark/src/valence.ts` | 手工加权（caps/bangs/问号等封顶求和） | spark 价值/紧急度判断 | Choice/Score |
| S4 | `dsh-spark/src/emerge-service.ts` 反射引擎 | title Jaccard link、共享 tag 聚类（Phase 4 rule-based） | link/cluster/contradict 提案精判 | Noul/Choice |
| S5 | `memory-evolve.ts` 生命周期 pass | TTL/probation 规则 | 「该记忆是否仍值得保留」review | Choice |

**明确不接**：finance 价格解析（结构化抽取非判断）、各闸门脚本（确定性必须保留）、
wire 包（协议纯净，禁外部调用）、任何需要给出自然语言理由的场景（Jev 只给数字）。

竖切顺序：**S1 先行**（数据真实、规则误报痛点明确、已有实验基线），其余接缝按
S5 → S4 → S3/S2 推进，每个接缝独立可回退。

## 3. 决策分级链契约

```
decide(seam, input):
  1. 初筛    静态规则产出候选集与初判（现有代码，不动语义）
  2. 精判    引擎关闭/未配置/超预算/调用失败 → 跳到 4
             conf >= threshold（默认 0.5）→ 采纳精判结果
  3. 降级    conf < threshold → 升级路径（本版：采纳初判，记录待升级事件）
  4. 兜底    任何异常 → 静态规则结果原样返回，引擎错误只记日志不上抛
```

不变量：

- **INV-D1**：引擎关闭时全链路行为与现状逐字节一致（现有单测必须原样全绿）。
- **INV-D2**：精判永不吞掉静态规则的兜底——引擎任何形态的失败都不能让接缝无结果。
- **INV-D3**：每次精判记录 `{seam, provider, conf, 采纳与否, tokens, latency}`，
  供设置 pane 健康展示与成本统计。
- **INV-D4**：配置中的 `dataIncludeGlobal = false`（默认）时，scope=global 的记忆
  内容不得进入任何外发请求。

## 4. 配置（spark 设置 pane）

### 4.1 位置与归属

- 入口：spark 指挥舱导航新增**「设置」**项（面板级固定导航项，spark 自有 UI）。
- 作用域：**spark 全局配置**，per-profile，声明在 `settingsScope`（键前缀
  `spark.decisionEngine.*`）。不使用宿主设置页（ADR-003 仍有效，无修订）。
- pane 按分节容器设计：本版仅「决策引擎」一节，为将来 valence 阈值、reflect
  调度等 spark 全局项预留骨架。

### 4.2 配置项

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `false` | 总开关。关闭 = 纯静态规则，UI 文案须明示「不影响任何功能」。 |
| `apiKey` | credential | — | 走凭据缝 `JEV_API_KEY`，明文永不落 settings、永不回显。 |
| `model` | string | `jev-latest` | Jev 模型别名。 |
| `confThreshold` | number | `0.5` | ≥ 采纳精判；< 走升级路径。UI 提供滑杆（0.3–0.9）。 |
| `concurrency` | number | `4` | 批量调用并发上限。 |
| `batchBudgetTokens` | number | `200_000` | 单批任务 token 预算，超出自动退回静态规则并记录。 |
| `dataIncludeGlobal` | boolean | `false` | scope=global 记忆是否允许外发（见 INV-D4）。 |

### 4.3 凭据交互（复刻 npm 连接器先例）

粘贴 key → 「测试连接」（草稿 key 单向过 wire 校验，不落盘）→ 通过后
`api.credentials.set` 写入 `JEV_API_KEY` 凭据缝。失败给出行内错误，不 toast。

### 4.4 健康展示

设置 pane 常显引擎状态：已启用/未配置、最近 24h 调用数、平均 conf、退回次数
（读 INV-D3 的记录，经宿主只读端点）。设置页必须能**看见引擎活着**，而非只有开关。

## 5. 架构与宿主集成

- 宿主侧新增可选 service（如 `SparkDecisionService`）：`ctx.inject(['settings',
  'credentials'], ...)` 可选注入，未配置时不启动，headless 组合零负担。
- Jev HTTP 调用全部封装在宿主侧 provider 内；wire 仅承载 §4.4 的只读状态端点
  （按 §2.4 惯例，descriptor 单源于 wire 包，`resultMode: 'strict'`）。
- 静态规则保持纯函数（host 测试跑 Node type-stripping，禁 enum/namespace；
  精判只做包装 pass 叠加，与 memory-evolve 现有 pass 结构同构）。
- cordis 规则：跨服务属性访问声明 `static inject`；引擎对兄弟服务数据的获取
  优先由组合根传闭包。

## 6. UI 验收（实现时逐条对照）

- a11y：开关 `role="switch"` + 可断言 label；测试连接结果区
  `role="status" aria-live="polite"`；设置 pane 可达性选择器进 preview:verify。
- UI 改动必须：先开 `pnpm preview` 对照 → `pnpm check:contrast` →
  `pnpm preview:verify` 全过。
- 注册面改动：`pnpm sandbox:install` + 重启宿主 +
  `node dev-harness/real-host-check.mjs` 退出码 0，**断言注册面而非仅渲染**
  （铁律 4）。
- INV-D1 的证明方式：引擎关闭状态下，现有 hippomemo / spark 全部单测原样通过，
  不允许为接入而修改任何既有断言。

## 7. 成本与安全护栏

1. 批量任务前按 `batchBudgetTokens` 预估，超出 → 本批整体退回静态规则并记录
   （不是截半执行——分级链要么精判整批，要么不判）。
2. 并发由 `concurrency` 封顶；引擎调用设总超时（默认 5s/请求），超时按失败处理。
3. 数据范围见 INV-D4；外发内容仅限接缝判定所需的最小上下文（判重只发
   title+content 对，不发记忆元数据全量）。
4. API key 只存在于凭据缝；日志、INV-D3 记录、错误信息中永不出现。

## 8. Jev API 速查（实测得出，文档未完整记载）

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <JEV_API_KEY>
{ "state": string|object|array, "model": "jev-latest", "questions": { <name>: Question } }

Question:
  Choice: { type:"choice", options:[...], criteria:{选项→判据 dict} }
  Score:  { type:"score", min, max, criteria:[分档 rubric list] }
  Noul:   { type:"noul", instructions:"字符串" }

Response: { model, answers:{ <name>:{ choice?|score?|noul?, confidence?, probabilities? } },
            usage:{ input_tokens, output_tokens } }
```

坑位记录：

- **Score 返回的是 rubric 分档索引**（如 legend 0/1/2 对应 criteria 三档），
  不是线性 min–max 值。解读必须按返回的 `legend` 映射，禁止当连续值用。
- criteria 按 primitive 分型（见上），noul 只认 `instructions`，传 criteria 会 400。
- 错误信封：422 = schema（pydantic detail 数组），400 = 业务校验（detail 字符串）。

## 9. 实验基线（2026-09-21，jev-1.13.0）

36/36 请求成功；判重 28 对：真重复 0.89 / 部分重叠 0.49–0.63 / 无关对 ≤0.27，
同主题不同事实正确不判重（0.24–0.27）；review 8 条：7 keep（conf 0.82–0.94）、
1 expire（conf 0.16，动作对但诚实表达歧义）。消耗：18,652 input tokens，
$0.000783（$0.042/M，输出免费），平均 518 tok/请求；并发 4 下 28 对 2.8s 墙钟；
p50 283ms / p90 768ms（跨界 RTT 主导，本机直连美西）。中文真实数据校准方向性成立。
已知约束：early access、仅美西部署 → 只用于非交互后台路径；输出免费为发布期定价，
护栏（§7）按收费假设设计。

## 10. 未决项

- [ ] 升级路径第二档（交大模型）与第三档（人工）的触发形态——本版只记录事件。
- [ ] S2 精排的批处理形态（召回集大小与 token 成本的平衡）待 S1 竖切后定。
- [ ] INV-D3 记录的留存策略（本地 jsonl 滚动窗口 or 复用 tools 的 dispatch log 模式）。
- [ ] provider 抽象的提取时机：仅在第二个真实后端出现时立接口，避免过早抽象。
