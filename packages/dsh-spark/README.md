# dsh-spark

Host plane for the dsh-spark cognitive-layer plugin (Phase 1 of the [7-phase cognitive-layer roadmap](../..)).

This package is the host half: it owns the in-memory `ctx.spark` service, persists sparks to a JSONL file under `$DSH_HOME/storages/`, mounts the `/sparks/*` HTTP API the Web UI talks to, and registers the agent-facing `spark_capture` tool.

## Phase 1 surface

- **`SparkService`** extends cordis `Service`; declared on `ctx.spark` via the cordis module merge.
- **`JsonlSparkStorage`** — append-only JSONL backend with atomic read-modify-write for patches and removes.
- **`/sparks` HTTP routes** — same-origin JSON envelope (`{ ok, value?, error? }`), `GET /sparks` list, `GET /sparks/:id`, `POST /sparks` capture, `PATCH /sparks/:id` update/archive, `DELETE /sparks/:id`, `GET /sparks/events` SSE stream.
- **`spark_capture` tool** — agent-callable; persists one spark with title + content + optional tags + scope.
- **`sparks/changed` cordis event** — emitted after every mutation; future subsystems (SSE consumer, DMN emergence engine, crystallize) hook in here without coupling to the storage layer.

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

## Future phases (NOT in Phase 1)

- **Phase 2** — `spark_crystallize` tool that bridges to `ctx.memory.put` (HippoMemo).
- **Phase 3** — `HippomemoConfig` gains a `cognitiveFilter: true` opt-in; recall is relevance-scored and suppressed via the prefrontal layer.
- **Phase 4** — DMN passive emergence engine (`sparkd` background task) + proposals inbox.
- **Phase 5** — Procedural-script crystallize (multi-step operation → reusable script).
- **Phase 6** — Amygdala valence mining (user emotional signal → `PreferenceRecord` crystallize).
- **Phase 7** — Force-directed graph view in `dsh-spark-ui` with ghost-edges for pending proposals.
