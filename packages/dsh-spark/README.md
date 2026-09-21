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
- **`/sparks` HTTP routes** — same-origin JSON envelope, list/get/capture/patch/delete + Phase 2 `POST /sparks/:id/crystallize`. (The former `GET /sparks/events` SSE stream is **gone** — see the event surface below.)
- **`spark_capture` tool** (Phase 1) — agent-callable; persists one spark with title + content + optional tags + scope.
- **`spark_crystallize` tool** (Phase 2) — promotes one spark into a HippoMemo `MemoryRecord`. Idempotent (returns existing `hippoId` on second call). Throws `SPARK_HIPPO_UNAVAILABLE` if `dsh-hippomemo` is not loaded — sparks still capture/archive/delete fine without hippomemo, just can't bridge. ⚠️ **2026-09-21：这条通道整体删除**（v2 §4.1/P10）——两插件改为零直连，融合交给 Agent 自己调 `memory_remember`。实测真实库中该路径使用量为 0。
- **`spark_reflect` tool + EmergeService** (Phase 4) — runs rule-based emergence over the active spark set, generates **link/cluster/prune** proposals (整理类：去重 / 归类 / 清理), persists to `proposals.jsonl`, dedup'd against pending ones. Triggers: manual tool call **or** the lazy dirty-marker path in `spark-inbox` (below) — **there is no periodic scheduler** and none is planned (AGENTS.md §1.3). LLM-backed **generative** proposals (new ideas from old sparks) are v2 L3, not implemented — see the v2 design doc §5.
- **`spark-inbox` orchestration row** (2026-09-14, A/B/C/D) — the consumption loop, all on one `agent/pre-step` hook (`src/inbox.ts`, one injection per agent per session):
  - **A 收件箱注入** — 计数 + 最近 N 条待处理火花的标题（**状态通报，不是语义召回**）；文案首行刻意与 hippomemo 的召回区分开。
  - **B 惰性涌现** — 脏标记（`changedCount ≥ threshold` 且距上次 ≥ `minIntervalMs`）触发一次后台 reflect；**无定时器**。
  - **C 脚本建议** — 最近 K 次工具调用命中某脚本 `triggers` → 建议直接 `spark_invoke_script`（按会话去重）。
  - **D 命令失败挖掘** — `(model, 命令模式, 错误签名)` 跨会话复现 → hippomemo `constraint` + `modelIds`；**默认关闭**（噪声防线未观察一轮前不开）。⚠️ 这条出边按 v2 §4.1/E3 将改为**产出火花**（不再直写 hippomemo）。
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
- **`sparks/changed` cordis event** — emitted after every mutation (operation ∈ capture/patch/archive/delete/crystallize); future subsystems hook in here.
- **`ValenceService` (cordis `ctx.valence`)** (Phase 6) — amygdala-style emotional signal mining. Subscribes to `session/event` for user messages; when `detectIntensity` crosses the threshold (default 0.4), `extractPreferences` parses latent preferences ("don't touch X" / "总是 X" / "always Y" / "never Z" in zh/en) and persists them as HippoMemo `kind='preference'` records via `ctx.memory.put`. `decayImportance` (Phase 6.5+) ages them with a 30-day decay that never drops below 40% to avoid the failure mode "懂用户 → 误读用户".

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
- **v2 L2/L3**（见 v2 设计文档）：火花的语义召回 + `spark_search` 工具、`origin` provenance、复燃与热度、**从已有火花派生新火花**（生成引擎）。
