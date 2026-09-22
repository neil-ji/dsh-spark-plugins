# dsh-spark

Host plane for the dsh-spark cognitive-layer plugin (Phase 1 of the [7-phase cognitive-layer roadmap](../..)).

> **定位（2026-09-21 修正）**：火花是**想法/创意**，与记忆**各自独立**——两插件之间**零直接通道**
> （无工具、无字段、无图边），二者的关联**交由 Agent 判断**。本文与
> [`docs/spark-v2-design-2026-09-21.md`](../../docs/spark-v2-design-2026-09-21.md)
> 冲突时**以那份设计文档为准**（它是火花定位的唯一规范源，用 `docs(spark):` 修订）。

This package is the host half: it owns the in-memory `ctx.spark` service, persists sparks to a JSONL file under `$DSH_HOME/storages/`, mounts the `/sparks/*` HTTP API the Web UI talks to, and registers the agent-facing `spark_capture` tool.

## Phase 1+2+4+5+6 surface

- **`SparkService`** extends cordis `Service`; declared on `ctx.spark` via the cordis module merge.
- **`JsonlSparkStorage`** — JSONL 后端（每行一条 `SparkView`），patch/remove 走**原子读-改-写**。注意：写入是**全量重写 + 原子 rename**（`.tmp` → rename），**不是 append**——本文旧版自称 "append-only" 与实现不符（2026-09-21 更正）；这也正是 v1 丢数据的成因（根因分析见 v1 设计文档 §7.1）。
- **`/sparks` HTTP routes** — same-origin JSON envelope: list（`status`/`scope`/`includeDeleted` 过滤；**默认按 `lastRecalledAt` 倒序、空值退化 `createdAt`**）、`POST /sparks/:id/reactivate`（v2 P14：拉回 active 并记一次召回）、`GET /sparks/stats`、`GET /sparks/graph`、**`GET /sparks/search?q=&limit=`（只读语义检索，v2 P13）**、get/capture/patch/restore/purge。`/sparks/:id/crystallize` 已随解耦删除（v2 P10）。 (The former `GET /sparks/events` SSE stream is **gone** — see the event surface below.)
- **`spark_capture` tool** (Phase 1) — agent-callable; persists one spark with title + content + optional tags + scope.
- **术语三分（v2 §5.5，D1–D4）**：**整理**（`link/cluster/prune`，静态规则，UI 名「整理」）· **衍生**（规则只初筛候选对、判断与生成交给模型）· **涌现**（量变→质变，**Agent 的判断**：插件不实现、不打标、不设阈值；Agent 用 `spark_capture(..., derivedFrom=[...])` 自己写下并自述来源）。`origin` 与 `derivedFrom` 正交——前者答"谁判断的"，后者答"据什么来的"；反自噬闸（`generation ≤ 2` / `derived` 不作父本）与 TTL **只作用于 `origin='derived'`**（机器自动生成）那条路径。
- **`spark_derive` tool + `DeriveService`（`ctx.derive`）** (v2 §5，P15/P17) — 从已有火花重组出新想法：候选对选择（中段相似度 + 标签远距离）→ 可选 LLM 出 strict JSON → 复述去重（Jaccard ≥ 0.85 拒）→ 直接落库为 `origin='derived'` + `expiresAt`。**LLM 面可选注入**（`ctx.llm` / `ctx.agentDefaultModel` 用 try/catch 结构读，不写进 inject）：缺失或调用失败都降级成 `skipped` 字段，**不报错**。`POST /sparks/derive` 支持 `dryRun`（只选候选对、零 LLM），生成类能力因此有确定性断言面。纯逻辑在 `src/derive.ts`。
- **`spark_search` tool** (v2 P13) — 按 token Jaccard 检索相关火花（标题/内容/标签，仅 `active`）。**主动性要求可查询，不是要求更多注入**：agent 在提出想法前先用它确认「是否已有类似想法」，并据此做跨火花的组合。口径在 `src/relevance.ts`（纯函数，也是注入段与涌现共用的单一真源）。
- **`spark_crystallize` tool — 已删除**（2026-09-21，v2 §4.1/P10）。火花不再直写 HippoMemo：两插件零直连，融合交给 Agent 自己调 `memory_remember`；实测该路径使用量为 0，删除无数据迁移。
- **`spark_reflect` tool + EmergeService**（Phase 4，UI 名「整理」；**不是涌现**） — runs rule-based emergence over the active spark set, generates **link/cluster/prune** proposals (整理类：去重 / 归类 / 清理), persists to `proposals.jsonl`, dedup'd against pending ones. Triggers: manual tool call **or** the lazy dirty-marker path in `spark-inbox` (below) — **there is no periodic scheduler** and none is planned (AGENTS.md §1.3). LLM-backed **generative** proposals (new ideas from old sparks) are v2 L3, not implemented — see the v2 design doc §5.
- **`spark-inbox` orchestration row** — the consumption loop, all on one `agent/pre-step` hook (`src/inbox.ts`, one injection per agent per session):
  - **① 想法池通报** — `active` 计数 + 最近 N 条标题（**状态通报，不是语义召回**）；空池也注入（否则模型永远不会主动提出想法）。
  - **② 相关火花**（v2 §4.4/P13）—— 按当前用户消息召回，注入**全文（标题 + 内容）**，预算 = `maxChars −` 第①段。首行 `Related sparks from the idea pool (dsh-spark):` 与 hippomemo 的记忆召回、第①段三者互不相同（AC-6）。这一段是 L2 的解锁条件：只有标题等于没给想法，agent 无从联想。
  - **过期清理**（v2 §5.2/P15）—— 首步那一趟顺手 `sweepExpiredDerived()`：到期 + 零召回 + 仍活跃的 derived 记录转墓碑（可恢复）。**不用定时器**；被重新激活或召回过的衍生火花不再过期。
  - **召回计数**（v2 §4.5/P14）—— 真正渲染进上下文的那几条记 `recalledCount += 1` / `lastRecalledAt`（渲染时被预算挤掉的不算）；`updatedAt` **不动**（召回不是编辑，否则 prune 与脏标记会把它当成改动）。记的是「被想起」，不是「被采纳」——UI 文案也就是直白的「被想起 N 次」。
  - **B 惰性涌现** — 脏标记（`changedCount ≥ threshold` 且距上次 ≥ `minIntervalMs`）触发一次后台 reflect；**无定时器**。
  - **C 脚本建议** — 最近 K 次工具调用命中某脚本 `triggers` → 建议直接 `spark_invoke_script`（按会话去重）。
  - **D 命令失败挖掘** — `(model, 命令模式, 错误签名)` 跨会话复现 → **产出一条火花**（v2 §4.1/E3：不再直写 hippomemo）；**默认关闭**（噪声防线未观察一轮前不开）。
- **`/proposals` HTTP routes** (Phase 4) — `GET /proposals` list with status/type filters, `POST /proposals/reflect` trigger, `POST /proposals/:id/resolve` accept/dismiss.
- **`proposals/changed` cordis event** — emitted on new proposals + on resolve. Accepting a prune proposal archives the target spark as a side-effect (the rest are user-manual follow-ups).
- **`spark_to_script` / `spark_invoke_script` / `spark_record_script_result` tools** (Phase 5) — agent crystallizes a multi-step procedure into a named, ordered-step Script (`spark_to_script`); invokes return the steps for the agent to execute (`spark_invoke_script`); the agent reports success/failure to keep the catalog's successRate accurate (`spark_record_script_result`). Scripts persist at `$DSH_HOME/storages/sparks/scripts.jsonl`.
- **`ScriptService` (cordis `ctx.script`)** (Phase 5) — create/list/get/invoke/recordResult/delete + emits `scripts/changed`. Success/failure counters per script drive `successRate = successCount / invocationCount`.
- **`/scripts` HTTP routes** (Phase 5) — GET list (scope + q search), GET :id, POST create, POST :id/invoke, POST :id/result (record success/failure), DELETE.

### Event surface (ADR-001, 2026-09)

There is **no SSE**. Three cordis domain events (`sparks/changed`, `proposals/changed`,
`scripts/changed`) are folded into **one** Typert stream endpoint, `spark/events`
(`mode: 'stream'`, per-item codec, carried over the platform's shared remote mux).
The frame union lives in `dsh-spark-wire` so host and client cannot drift; the browser
half subscribes through `dsh-spark-plugin-kit/client`'s `$stream` runtime
(fan-out + refcount + generation resync), never with a raw `EventSource`.
- **`sparks/changed` cordis event** — emitted after every mutation (operation ∈ capture/patch/state/delete/restore/purge；`crystallize` 随解耦删除); future subsystems hook in here.
- **`ValenceService` (cordis `ctx.valence`)** (Phase 6) — amygdala-style emotional signal mining. Subscribes to `session/event` for user messages; when `detectIntensity` crosses the threshold (default 0.4), `extractPreferences` parses latent preferences ("don't touch X" / "总是 X" / "always Y" / "never Z" in zh/en) and **captures them as sparks** (`origin: 'agent'`，v2 §4.1/E2：不再 `ctx.memory.put`)。 `decayImportance` (Phase 6.5+) ages them with a 30-day decay that never drops below 40% to avoid the failure mode "懂用户 → 误读用户".

## Storage layout

Default file path: `$DSH_HOME/storages/sparks.jsonl`. Override via `cordis.patch.yml`:

    - id: spark
      name: dsh-spark
      config:
        filePath: /custom/path/sparks.jsonl
        maxRecords: 5000

Each line in the JSONL file is one full `SparkView` JSON object. Patches and removes rewrite the file atomically (write `.tmp` + rename).

## Tests

    pnpm test

Covers JSONL round-trip, malformed-line tolerance, atomic patch/remove, concurrent-append serialization, and the storage limit enforcer.

## Future phases (NOT in Phase 1+2+4+5+6)

- **~~Phase 4.5 Periodic scheduler (intervalMs)~~** — **明确否决**（AGENTS.md §1.3：轮询模拟事件是反模式）。已由 `spark-inbox` 的**脏标记 + 会话首步惰性触发**取代（2026-09-14 落地）。
- **Phase 6.5** — ValenceService feedback loop: mined preferences participate in Phase 3 cognitive filter (boost matching preferences, suppress stale ones via decay).
- **~~Phase 7 Force-directed graph~~** — **已落地**：`src/graph.ts`（宿主唯一计算者，三类边：`crystallized` / `tag` / `proposal`）+ dock 的 `GraphPane.tsx`。v2 计划增第四类 `derived` 边（v2 设计文档 §4.3）。
- **已落地**：F1 解耦 + 枚举回退 + 朴素命名、F2 provenance、F3 语义召回 + `spark_search`、F4 重新激活 + 召回计数、**F5 衍生引擎**（v2 §8 全五期完成）。
- **仍明确不做**：向量检索（沿用 token Jaccard）、定时调度器（过期清理走惰性触发）、无差别自动捕获。
