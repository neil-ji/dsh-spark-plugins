# dsh-spark

Host plane for the dsh-spark cognitive-layer plugin (Phase 1 of the [7-phase cognitive-layer roadmap](../..)).

This package is the host half: it owns the in-memory `ctx.spark` service, persists sparks to a JSONL file under `$DSH_HOME/storages/`, mounts the `/sparks/*` HTTP API the Web UI talks to, and registers the agent-facing `spark_capture` tool.

## Phase 1+2+4 surface

- **`SparkService`** extends cordis `Service`; declared on `ctx.spark` via the cordis module merge.
- **`JsonlSparkStorage`** — append-only JSONL backend with atomic read-modify-write for patches and removes. Phase 2 exposes `writeAll` (system use) for crystallize + enforceLimit.
- **`/sparks` HTTP routes** — same-origin JSON envelope, list/get/capture/patch/delete + Phase 2 `POST /sparks/:id/crystallize` + `GET /sparks/events` SSE stream.
- **`spark_capture` tool** (Phase 1) — agent-callable; persists one spark with title + content + optional tags + scope.
- **`spark_crystallize` tool** (Phase 2) — promotes one spark into a HippoMemo `MemoryRecord`. Idempotent (returns existing `hippoId` on second call). Throws `SPARK_HIPPO_UNAVAILABLE` if `dsh-hippomemo` is not loaded — sparks still capture/archive/delete fine without hippomemo, just can't bridge.
- **`spark_reflect` tool + EmergeService** (Phase 4) — runs rule-based emergence over the active spark set, generates link/cluster/prune proposals, persists to `proposals.jsonl`, dedup'd against pending ones. Manual trigger only (auto-scheduler is Phase 4.5). LLM-backed proposals (semantic similarity, contradict detection) are also Phase 4.5+.
- **`/proposals` HTTP routes** (Phase 4) — `GET /proposals` list with status/type filters, `POST /proposals/reflect` trigger, `POST /proposals/:id/resolve` accept/dismiss, `GET /proposals/events` SSE.
- **`proposals/changed` cordis event** — emitted on new proposals + on resolve. Accepting a prune proposal archives the target spark as a side-effect (the rest are user-manual follow-ups).
- **`sparks/changed` cordis event** — emitted after every mutation (operation ∈ capture/patch/archive/delete/crystallize); future subsystems hook in here.

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

## Future phases (NOT in Phase 1+2+4)

- **Phase 4.5** — Periodic scheduler (intervalMs) for EmergeService + LLM-backed proposals (semantic similarity, contradict detection).
- **Phase 5** — Procedural-script crystallize (multi-step operation → reusable script).
- **Phase 6** — Amygdala valence mining (user emotional signal → `PreferenceRecord` crystallize).
- **Phase 7** — Force-directed graph view in `dsh-spark-ui` with ghost-edges for pending proposals.
