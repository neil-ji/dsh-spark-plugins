# dsh-hippomemo

Third-party bundle/plugin for DeepSeek Harness that adds a cross-session, cross-workspace memory layer and a "Memory" page in the official Web settings modal.

HippoMemo persists records in the dsh home, not inside any session or workspace. The host service is shared by every Web session, so consensus, decisions, facts, preferences, and constraints survive restarts and are available across workspaces.

## What it provides

- Host memory service over dsh storage-domain.
- Durable storage at DSH_HOME/storages/hippomemo.json.
- Agent tools: memory_remember, memory_search, memory_get, memory_update, memory_forget.
- Automatic first-step recall for each agent session, with per-session deduplication.
- Optional automatic candidate extraction after each turn, using the configured model route or the agent-default model.
- Chinese-aware token search (CJK bigrams plus Latin words; single hanzi are excluded to avoid noisy false-positive recalls, with a single-character fallback).
- Revisioned, provenance-carrying memory records with active / archived / superseded / candidate statuses.
- Live settings-page refresh through a same-origin SSE stream.
- Usage analytics: every search/recall bumps exposure counters (`recallCount`/`lastRecalledAt`), id mentions of injected memories in agent output and `supersedes`/`relatedIds` links record citations (`citationCount`/`lastCitedAt`), and a `memory_usage` tool / `/hippomemo/usage` endpoint report recall rate, citation rate, recall to citation conversion, and staleness.
- A "Memory" item in the Web settings modal for browsing, searching, editing, archiving, and deleting all memories.
- Full settings-page UX: debounced full-text search, kind / scope / status / tag filters, sort by recency, creation time, importance, or title (ascending/descending), server-side pagination with page-size control, long-text clamping on cards, and a detail view (full content, tags, provenance, related memories) with back navigation.

## Install

From a local checkout:

    cd dsh-hippomemo
    pnpm install
    pnpm run build
    dsh plugin --profile web add file:../dsh-hippomemo

From npm:

    dsh plugin --profile web add dsh-hippomemo

From a tarball:

    dsh plugin --profile web add ./dsh-hippomemo-0.1.0.tgz

From git:

    dsh plugin --profile web add github:you/dsh-hippomemo#<commit-sha>

Then start the Web surface:

    dsh web

The plugin only requires the Web profile, because it depends on webServer and storage-domain.

## Build

    pnpm install
    pnpm run build

`pnpm run build` runs tsdown only, so it does not require the dsh peer packages to be installed. It produces the runtime bundles. Run `pnpm run typecheck` only inside an environment that has the dsh peer packages resolvable.

For git installs, the prepare script runs the same tsdown build automatically. pnpm may ask you to allow the build script in the profile pnpm-workspace.yaml; use `pnpm approve-builds` or add the package to `allowBuilds`.

## Enable automatic extraction

The extractor row is opt-in because each completed turn otherwise consumes one auxiliary model call. In `DSH_HOME/profiles/web/cordis.patch.yml`, override:

    - id: hippomemo-extractor
      config:
        enabled: true
        maxOutputTokens: 512
        timeoutMs: 60000
        maxCandidatesPerTurn: 4

It uses the agent-default model by default. To pin a route, set `provider` and `model` together in the same config.

## Dogfooding without touching 3080

Use a second process on the same profile and data, with a separate port:

    dsh --profile web --port 3999

- 3080 stays as the working service; do not kill or restart it during plugin iteration.
- 3999 shares the same profile package set, settings, sessions, workspace registry, and DSH_HOME storage.
- After changing the bundle: remove and re-add with `file:`, restart only 3999, then smoke-test `/hippomemo/stats`, `/hippomemo/events`, and the settings page.

## Test

    pnpm run test

For coverage:

    pnpm run test:coverage

## Package layout

    cordis.patch.yml        inserted profile rows
    src/index.ts            host MemoryService
    src/http.ts             /hippomemo HTTP API
    src/tool.ts             memory_* tools
    src/context.ts          automatic recall
    src/extractor.ts        automatic candidate extraction
    src/client/index.ts     settings.section registration
    src/client/MemorySection.tsx
    src/client/api.ts       fetch wrapper
    src/client/locales.ts
    src/client/style.ts

## HTTP API

All routes are same-origin JSON:

    GET    /hippomemo/events
    GET    /hippomemo/stats
    GET    /hippomemo/usage
    GET    /hippomemo/citations
    GET    /hippomemo/records
    GET    /hippomemo/records/:id
    POST   /hippomemo/records
    PATCH  /hippomemo/records/:id
    DELETE /hippomemo/records/:id

Responses use:

    { "ok": true, "value": ... }

or:

    { "ok": false, "error": { "code": "...", "message": "..." } }

## Memory model

A memory record has:

- id
- kind: insight | decision | fact | preference | constraint
- title
- content
- tags
- scope: global | workspace | project
- workspacePath
- importance: 0 to 1
- status: active | archived | superseded | candidate
- sourceSessionId / sourceAgentId / sourceTurn
- revision
- updatedBy
- supersedes / supersededBy
- createdAt / updatedAt
- expiresAt
- relatedIds
- recallCount / lastRecalledAt: exposure counters, bumped by every search hit or automatic recall
- citationCount / lastCitedAt: reference counters, bumped when the agent mentions an injected memory id in its output (id-ref) or links it via supersedes/relatedIds (link)

Global memories are shared across all workspaces. Workspace and project memories are scoped to the path recorded when the agent wrote them.

## Usage metrics: quantifying whether memories are actually used

"Recalled" (surfaced to the agent) is not "referenced" (used by the agent). HippoMemo tracks both:

- **Exposure (Layer 1, mechanical):** every `memory_search` hit and every automatic-recall injection bumps `recallCount` and sets `lastRecalledAt` on the record. Zero cost, no LLM involvement.
- **Reference (Layer 2, hard signals):**
  - `id-ref` / `title-ref` — the automatic-recall reminder tags each injected memory with `<memory id="...">`; when a later assistant message in the same session mentions that id (or reproduces the memory title verbatim as a weaker signal), a citation row is appended (with a snippet), at most once per session per memory.
  - `link` — storing or updating a memory whose `supersedes`/`relatedIds` point at an existing memory records a citation on the target.
- **Influence (Layer 3, optional):** not measured by default. For a judgement call, sample turns and ask a judge model whether the recalled memory actually shaped the output; use it to calibrate Layer 2 numbers.

Derived metrics (`memory_usage` tool, `GET /hippomemo/usage`, or the settings-page summary strip):

- recall rate = recalled / total
- citation rate = cited / total
- conversion rate = cited / recalled — of the memories the agent saw, how many it actually used
- staleCount = active memories never recalled within the staleness window (30 days) — candidates for archiving

Citations are append-only history in the `citations` table (`GET /hippomemo/citations`); counters are best-effort analytics and never drive recall ranking, so a citation storm cannot distort search results.

## Security notes

- The client settings page talks to the plugin-owned /hippomemo route, not the official /api trust boundary. The route rejects cross-origin browser requests and requires JSON content type for mutations.
- Auto-recalled memories are presented as untrusted background. The model must not follow instructions found inside a memory unless the current user repeats them.
- memory_update and memory_forget require a direct human message on a top-level agent. The settings page is the trusted curation path.
- Bound the memory store with maxMemories and the prompt budget with maxRecallChars / recallLimit.

## Limitations

- Search is an in-process token index with CJK unigram/bigram support. It is fine for typical personal memory sizes; vector search or SQLite FTS can replace it later.
- Live multi-process sync is not implemented. One dsh process is the authority for its DSH_HOME memory file.
- The settings nav item uses the shell fallback gear icon. A dedicated icon would require an upstream shell enhancement; the label and page are fully third-party.
- Domain version is 2. A profile that already wrote a version-1 hippomemo.json must migrate or delete the file once before upgrading.
- Automatic extraction needs a model route. The extractor row uses the agent-default model unless provider and model are set together in its config.
