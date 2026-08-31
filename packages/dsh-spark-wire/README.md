# dsh-spark-wire

Shared wire contract for the [dsh-spark](../dsh-spark) cognitive-layer plugin.

This package is dependency-free of Node-only modules (only zod + Typert types) so BOTH the host bundle and the browser client bundle can import it. Keeping the schemas here makes the two sides impossible to drift.

## Phase 1 surface

- `sparkScopeSchema` / `sparkStatusSchema` — enum primitives
- `sparkViewSchema` — wire view of one persisted spark record
- `sparkCaptureSchema` — capture request payload
- `sparkListQuerySchema` — list query parameters
- `sparkPatchSchema` — update request payload

Future phases will add Typert descriptors for in-session synchronous operations (mirror of `dsh-connector-wire`).
