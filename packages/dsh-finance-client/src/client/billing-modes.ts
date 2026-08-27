/**
 * Billing-mode editor row model and its JSON (de)serialization. Kept free of
 * any client-runtime/window dependency on purpose: the config card renders
 * this form in SSR test environments, and the staged field below it is plain
 * JSON text, so converting rows <-> text must be side-effect-free.
 */

export interface BillingModeRow {
  /** Provider or full model key; blank rows are dropped at serialization. */
  route: string
  mode: 'metered' | 'plan'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse a stored/draft JSON object into editor rows, preserving key order. */
export function billingModesToRows(text: string): BillingModeRow[] {
  if (text.trim() === '') return []
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return [] }
  if (!isPlainObject(parsed)) return []
  return Object.entries(parsed)
    .filter((entry): entry is [string, 'metered' | 'plan'] => entry[1] === 'metered' || entry[1] === 'plan')
    .map(([route, mode]) => ({ route, mode }))
}

/**
 * Serialize editor rows back to the staged JSON text. Blank-route rows are
 * dropped and duplicate routes keep their last occurrence (object semantics);
 * an empty result serializes as '' — the staged clear that lets the field
 * inherit the composition layer again.
 */
export function rowsToBillingModes(rows: readonly BillingModeRow[]): string {
  const out: Record<string, 'metered' | 'plan'> = {}
  for (const row of rows) {
    const route = row.route.trim()
    if (route === '' || (row.mode !== 'metered' && row.mode !== 'plan')) continue
    out[route] = row.mode
  }
  const keys = Object.keys(out)
  return keys.length === 0 ? '' : JSON.stringify(out, null, 2)
}