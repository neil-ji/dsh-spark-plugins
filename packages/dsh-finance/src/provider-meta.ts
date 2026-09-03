/**
 * Host-known provider metadata registry.
 *
 * The host is the source of truth for two things the user should NOT have to
 * hand-configure:
 *
 * 1. **Default billing mode + currency** seeded into a provider config entry
 *    when the user adds a provider the host recognises. (UI defaults to these
 *    in commit 13's Form List.)
 * 2. **Balance-fetch capability**: which providers expose a balance endpoint
 *    the host can call. Today only `deepseek-official`; future commits add
 *    more as their APIs land.
 *
 * The per-entry `autoFetchBalance` toggle (FinanceProviderEntry) is the user
 * override on top of `supportsBalanceFetch` — even when the host CAN fetch,
 * the user can disable it per-provider.
 *
 * @module @deepseek-ai/dsh-spark-finance/provider-meta
 */

import type { FinanceBillingMode } from './types.ts'

export interface FinanceHostProviderMeta {
  /** Provider id, matches the leading segment of `modelKey` (`provider/model`). */
  provider: string
  /** Default billing mode seeded when the user has no entry for this provider. */
  defaultBillingMode: FinanceBillingMode
  /**
   * Default currency seeded with the entry. Free-form string — anything the
   * upstream balance API can report (CNY / USD / JPY / EUR / ...). The
   * host-known registry just supplies a sensible default; the user can
   * override per provider via `FinanceProviderEntry.currency`.
   */
  defaultCurrency: string
  /**
   * True iff the host has a balance-fetch endpoint for this provider. The host
   * still respects the per-entry `autoFetchBalance` toggle — when false, no
   * fetch fires even with this flag set. When the host cannot fetch, the
   * per-provider view is always `status: 'unsupported'`.
   */
  supportsBalanceFetch: boolean
  /**
   * When true, the UI locks `billingMode` and `currency` to the host defaults
   * for this provider. Used for `deepseek-official` (metered / CNY are
   * determined by the DeepSeek balance API contract — the user can't override
   * them via the card). Future host-known providers can opt in the same way.
   */
  lockBillingModeAndCurrency?: boolean
}

/**
 * Providers the host has special knowledge of. Keyed by provider id; missing
 * keys fall through to the unsupported path in `getBalance` and the UI's
 * `plan`-mode default for unknown providers.
 *
 * Exposed from the package root so the client can bundle this metadata
 * without a runtime host roundtrip — the Form List (commit 13) uses it to
 * seed defaults and decide which fields are locked.
 */
export const HOST_KNOWN_PROVIDER_META: Readonly<Record<string, FinanceHostProviderMeta>> = {
  'deepseek-official': {
    provider: 'deepseek-official',
    defaultBillingMode: 'metered',
    defaultCurrency: 'CNY',
    supportsBalanceFetch: true,
    lockBillingModeAndCurrency: true,
  },
}

/** Lookup helper so call sites don't sprinkle optional-chaining everywhere. */
export function hostProviderMeta(provider: string): FinanceHostProviderMeta | undefined {
  return HOST_KNOWN_PROVIDER_META[provider]
}
