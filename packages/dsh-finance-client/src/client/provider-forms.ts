/**
 * Per-provider Form List shape, parallel to `billing-modes.ts`.
 *
 * Each row in the UI's Provider List maps 1:1 to a `FinanceProviderEntry`
 * (commit 11's types). The conversion helpers below turn the live editor
 * rows into a JSON-serializable payload that the controller stages the same
 * way it stages billing-modes / price-table / default-price — through a
 * single `providers` field on the settings document.
 *
 * `validity` is encoded as `{ startMs?: number; endMs?: number }` (epoch ms)
 * so the wire shape matches the rest of the finance schema. Empty
 * (undefined) = 永久.
 */

import {
  defaultProviderEntry,
  HOST_KNOWN_PROVIDER_META,
  hostProviderMeta,
} from 'dsh-spark-finance'
import type {
  FinanceProviderEntry,
  FinanceProviderBillingMode,
} from 'dsh-spark-finance/types'
import type { FinanceHostProviderMeta } from 'dsh-spark-finance'

export interface ProviderRow {
  provider: string
  billingMode: FinanceProviderBillingMode
  /** Total in major units (元 / $). UI displays this; storage is micros. */
  totalPriceMajor: number
  currency: 'CNY' | 'USD'
  autoFetchBalance: boolean
  validityStartMs?: number
  validityEndMs?: number
}

/** Convert the stored entries (or stored JSON text) into live editor rows. */
export function providersToRows(entries: readonly FinanceProviderEntry[] | undefined): ProviderRow[] {
  if (entries === undefined) return []
  return entries.map((entry) => ({
    provider: entry.provider,
    billingMode: entry.billingMode,
    totalPriceMajor: entry.totalPriceMicros / 1_000_000,
    currency: entry.currency,
    autoFetchBalance: entry.autoFetchBalance,
    ...entry.validity?.startMs !== undefined ? { validityStartMs: entry.validity.startMs } : {},
    ...entry.validity?.endMs !== undefined ? { validityEndMs: entry.validity.endMs } : {},
  }))
}

/** Convert live editor rows back into the storage shape. Drops empty provider names. */
export function rowsToProviders(rows: readonly ProviderRow[]): FinanceProviderEntry[] {
  const out: FinanceProviderEntry[] = []
  for (const row of rows) {
    if (row.provider.trim() === '') continue
    const validity = row.validityStartMs !== undefined || row.validityEndMs !== undefined
      ? {
          ...row.validityStartMs !== undefined ? { startMs: Math.round(row.validityStartMs) } : {},
          ...row.validityEndMs !== undefined ? { endMs: Math.round(row.validityEndMs) } : {},
        }
      : undefined
    out.push({
      provider: row.provider.trim(),
      billingMode: row.billingMode,
      totalPriceMicros: Math.max(0, Math.min(100_000_000_000, Math.round(row.totalPriceMajor * 1_000_000))),
      currency: row.currency,
      autoFetchBalance: row.autoFetchBalance,
      ...validity ? { validity } : {},
    })
  }
  return out
}

/**
 * Seed list: host-known providers the UI should auto-render with defaults
 * even when the settings document has no entries yet. Today only
 * `deepseek-official`; the list grows as the host's `HOST_KNOWN_PROVIDER_META`
 * registry grows.
 */
export function seedHostKnownProviders(): ProviderRow[] {
  return Object.keys(HOST_KNOWN_PROVIDER_META).map((provider) => {
    const entry = defaultProviderEntry(provider)
    return providersToRows([entry])[0]!
  })
}

/**
 * Resolve the host metadata for one provider (or undefined when unknown).
 * Re-exported from the host package — kept here so the editor component
 * only depends on this module, not on the finance package directly.
 */
export function metaFor(provider: string): FinanceHostProviderMeta | undefined {
  return hostProviderMeta(provider)
}

/**
 * Helper used by the Form List "+ 添加 provider" button: returns the next
 * unused host-known provider id, or undefined when the user has added all
 * the host-known ones (and should free-type a new id).
 */
export function nextHostKnownProvider(existing: readonly ProviderRow[]): string | undefined {
  const taken = new Set(existing.map((row) => row.provider))
  return Object.keys(HOST_KNOWN_PROVIDER_META).find((id) => !taken.has(id))
}
