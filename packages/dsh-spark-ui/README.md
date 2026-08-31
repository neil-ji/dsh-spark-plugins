# dsh-spark-ui

Client plane for the dsh-spark cognitive-layer plugin. Mirrors `dsh-hippomemo`/`dsh-connector-github-ui`:

- `src/index.ts` — node half (empty loader entry, exists so the cordis.patch row loads the package and dsh-client-modules scans the `dsh.client` declaration into `window.__DSH_BOOT__`).
- `src/client/index.ts` — browser half: mounts the **Sparks** section in the Web settings modal sidebar (设置 → 火花).

## Phase 1 surface

- List of sparks with title / content / status / scope / tags / created time
- Inline capture form (title + content + tags + scope selector)
- Per-row archive + delete actions
- Status filter (all / active / archived)
- Live SSE update on `/sparks/events` (auto-reconnect on drop)
- Manual refresh button
- i18n (zh + en)

Future phases will add:

- Phase 4 — emergence proposals inbox (DMN suggestions with accept/edit/defer/reject).
- Phase 7 — force-directed graph view with ghost-edges for undecided proposals.

## Layout

    src/index.ts                  node loader entry (empty apply)
    src/client/index.ts           client apply(ctx: ClientContext) — registers settings.section
    src/client/SparkSection.tsx   page component + SparkController + bindSparkController
    src/client/api.ts             /sparks fetch wrapper + SSE subscriber
    src/client/locales.ts         zh + en dictionaries
    src/client/style.ts           CSS string (injected once at mount via plugin-kit registerSettingsSection)
