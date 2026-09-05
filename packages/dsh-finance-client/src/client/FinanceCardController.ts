/**
 * Finance plugin card controller: bridges the `finance` settings namespace
 * (balance connection + price facts) and the dashboard view preferences
 * (browser-local) onto one snapshot store, staging namespace edits until
 * save — the same staged-form model as the shell/agent-loop plugin cards.
 *
 * The `balance` sub-fields are edited as one group: the settings wire writes
 * top-level section fields only, so saving a staged baseURL/apiKeyEnv/timeout
 * change writes the whole `balance` object (preserving untouched members).
 *
 * The Provider configuration section (commit 13's editable Form List) has
 * been replaced by a read-only view driven entirely by `finance.listProviders`
 * — the host is the single source of truth for which providers exist, and
 * the user no longer maintains the list by hand. See `ProviderListView.tsx`.
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  FinanceCommunitySyncResult,
  FinanceConfigInput,
  FinanceListProvidersEntry,
  FinanceListProvidersResult,
  FinanceSyncStatus,
} from 'dsh-spark-finance/types'
import {
  EMPTY_RATE,
  seedPriceTable,
  seedProviderDefaults,
  seedRateDraft,
  serializeDefaultPriceDraft,
  serializePriceTableDraft,
  serializeProviderDefaultsDraft,
} from './price-forms.ts'
import type {
  PriceFormResult,
  PriceTableDraft,
  ProviderDefaultsDraft,
  RateDraft,
} from './price-forms.ts'
import { readAllDshProviderOverrides, readFinancePrefs, writeDshProviderOverride, writeFinancePrefs } from './persist.ts'
import type { DshProviderOverride, FinanceChartPrefs, FinanceLayout, FinancePrefs, FinanceSyncSnapshot } from './persist.ts'

export type FinanceCardFieldName =
  | 'balance.baseURL'
  | 'balance.apiKeyEnv'
  | 'balance.timeoutMs'
  | 'defaultPrice'
  | 'providerDefaults'
  | 'prices'

const BALANCE_FIELDS: readonly FinanceCardFieldName[] = ['balance.baseURL', 'balance.apiKeyEnv', 'balance.timeoutMs']
const JSON_FIELDS: ReadonlySet<FinanceCardFieldName> = new Set(['defaultPrice', 'providerDefaults', 'prices'])
/** Threshold above which `ensureAutoSync` re-fires without a host click. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000

export interface FinanceCardFieldState {
  /** Draft text the control renders. */
  text: string
  /** Whether saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** Whether the draft is not a value this field accepts, which blocks saving. */
  invalid: boolean
}

/**
 * Live state of the community-price sync action. Distinct from the persisted
 * `prefs.lastSync`: this is what the Sync now button renders against
 * (syncing / last-result / last-error). The persisted snapshot is a subset.
 */
export interface FinanceSyncState {
  /** A `syncCommunityPrices` call is in flight. */
  syncing: boolean
  /** Last successful sync the client knows about (host snapshot OR local prefs). */
  lastSync: FinanceSyncSnapshot | null
  /** Last failure message; cleared the next time a sync succeeds. */
  lastError: string | null
}

const INITIAL_SYNC_STATE: FinanceSyncState = { syncing: false, lastSync: null, lastError: null }

export interface FinanceCardState {
  /** False while the finance namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host settings document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
  balanceBaseURL: FinanceCardFieldState
  balanceApiKeyEnv: FinanceCardFieldState
  balanceTimeoutMs: FinanceCardFieldState
  defaultPrice: FinanceCardFieldState
  providerDefaults: FinanceCardFieldState
  /** Live default-price rate draft (never shown as raw JSON). */
  defaultPriceDraft: RateDraft
  /** Live provider-default rows. */
  providerDefaultsDraft: ProviderDefaultsDraft
  /** Live price-table draft. */
  priceTableDraft: PriceTableDraft
  prices: FinanceCardFieldState
  /** Dashboard view preferences (browser-local; apply immediately). */
  prefs: FinancePrefs
  /** Live sync state (in flight + last success/failure). */
  syncState: FinanceSyncState
  /** Whether the price sync UI is supported by the host (true once `finance.syncCommunityPrices` is reachable). */
  syncAvailable: boolean
  /**
   * Read-only provider list snapshot from `finance.listProviders`. The Provider
   * configuration section consumes this directly via `ProviderListView`;
   * `undefined` while the first fetch is still in flight.
   */
  providerList: FinanceListProvidersResult | undefined
  /**
   * First-fetch error for `listProviders`. Distinct from the dashboard's
   * audit error so a card-only failure (provider list) doesn't blank the
   * dashboard; the user sees an inline retry inside the Provider section
   * instead. Cleared on every retry attempt.
   */
  providerListError: string | undefined
  /**
   * Per-provider rows derived from `providerList` (dsh-llm runtime snapshot
   * — the only source of truth for which providers exist) merged with the
   * user's localStorage overlay (price + autoFetch + validity). The view
   * binds to this; underlying dsh-llm registries are NEVER written back.
   */
  dshProviderRows: readonly FinanceDshProviderRow[] | undefined
}

/**
 * One row in the Provider configuration list, as rendered in the read-only
 * view. Derived from a `FinanceListProvidersEntry` (host-owned facts:
 * provider id, sources, hostMeta, balance slot) plus the optional
 * `DshProviderOverride` (user-owned business fields: price, autoFetch,
 * validity). The two halves never conflict — the host's
 * `FinanceListProvidersEntry.userEntry` slot stays at `undefined` for
 * dsh-only providers, and the localStorage overlay stays scoped to our
 * own business fields.
 */
export interface FinanceDshProviderRow {
  /** dsh-llm runtime provider id; unique per row. */
  provider: string
  /**
   * Human-readable display name sourced from the dsh-llm runtime, falling
   * back to the provider id when the runtime omits a name.
   */
  name: string
  /** Sources from the host's `listProviders` snapshot. */
  sources: readonly string[]
  /** Host-known metadata; undefined for runtime-only providers. */
  hostMeta?: {
    defaultBillingMode: 'metered' | 'plan' | 'free'
    /** Free-form account currency seeded by the dsh-llm host metadata. */
    defaultCurrency: string
    supportsBalanceFetch: boolean
    lockBillingModeAndCurrency?: boolean
  }
  /**
   * The user-overlaid business fields, sourced from localStorage. Absent
   * when the user has not set one — the view falls back to safe defaults
   * (price 0, autoFetch off) so a fresh browser still renders a usable row.
   */
  override: { totalPriceMicros: number; autoFetchBalance: boolean; validityStartMs?: number; validityEndMs?: number } | undefined
  /** Live balance slot from the host (no override — the host owns this). */
  balance: FinanceListProvidersEntry['balance']
}

/** The registration-side face the finance card's slot entry injects. */
export interface FinanceCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useFinanceCard. */
    financeCard: SnapshotStore<FinanceCardState>
  }
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  resetField: (field: FinanceCardFieldName) => void
  /** Stage draft text for one field. */
  edit: (field: FinanceCardFieldName, text: string) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
  /** Apply a dashboard layout immediately. */
  setLayout: (layout: FinanceLayout) => void
  /** Toggle one dashboard chart's visibility immediately. */
  toggleChart: (key: keyof FinanceChartPrefs) => void
  /** Stage the default-price rate draft. */
  setDefaultPrice: (draft: RateDraft) => void
  /** Stage the provider-default rows. */
  setProviderDefaults: (draft: ProviderDefaultsDraft) => void
  /** Stage the price-table draft. */
  setPriceTable: (draft: PriceTableDraft) => void
  /**
   * Pull the upstream community-price table once, replacing the host's
   * in-memory community layer and updating `state.syncState`. Resolves to the
   * raw sync result; UI reads `syncState.syncing` to disable the button.
   */
  syncNow: () => Promise<FinanceCommunitySyncResult | null>
  /**
   * Flip the auto-sync preference (browser-local; persisted under prefs).
   * Effective the next time the controller decides whether to auto-fire.
   */
  setAutoSync: (next: boolean) => void
  /** Bootstrap pull: kick off a sync if `prefs.autoSync` is true AND the
   * persisted snapshot is older than 24h (or absent). Idempotent across mounts. */
  ensureAutoSync: () => void
  /**
   * Save the user-overlay business fields for one dsh-llm provider
   * (totalPriceMicros, autoFetchBalance, optional validity window). The
   * dsh-llm runtime registry is NEVER written — this is a localStorage-only
   * store keyed by provider id. Re-publishes so the row re-renders at once.
   */
  setDshProviderOverride: (provider: string, override: DshProviderOverride) => void
  /**
   * Remove the user-overlay for one provider; the row reverts to the dsh
   * snapshot's defaults. Idempotent when no override exists.
   */
  clearDshProviderOverride: (provider: string) => void
  /**
   * Retry the host's `listProviders` after a failure. The card view binds
   * this to the inline "retry" button next to `providerListError`; the
   * controller's loadList is single-flight, so a held-down button still
   * fires one round-trip.
   */
  retryListProviders: () => void
}

type PlannedWrite = { run: (() => Promise<boolean>) | undefined }
type StagedEdit = { text: string; clear: boolean }
type FieldWrite = { kind: 'set'; value: unknown } | { kind: 'clear' }

/** JSON-equality for detached section values (JSON data by construction). */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Pick the host Remote methods the controller depends on. `listProviders` was
 * added for the read-only Provider configuration view (commit on top of the
 * sync Remote); every method is optional so legacy hosts that lack the
 * newer endpoints keep working (the read-only provider section falls back
 * to a loading slot, the sync section stays hidden).
 */
export type FinanceRemote = Partial<Pick<
  ClientRemote['finance'],
  'listProviders' | 'syncCommunityPrices' | 'getSyncStatus' | 'refreshBalance'
>>

export class FinanceCardController {
  private readonly staged = new Map<FinanceCardFieldName, StagedEdit>()
  private readonly store: SnapshotStore<FinanceCardState>
  private saving = false
  private failed = false
  /** Live drafts for the three price-form editors; null = not yet edited (seed from stored). */
  private defaultPriceDraftValue: RateDraft | null = null
  private providerDefaultsDraftValue: ProviderDefaultsDraft | null = null
  private priceTableDraftValue: PriceTableDraft | null = null
  /** Live sync state: in-flight flag + last result. Updated by syncNow(). */
  private syncStateValue: FinanceSyncState = INITIAL_SYNC_STATE
  /** Whether the host exposes the sync Remote. False = host predates commit 4. */
  private syncAvailableValue = false
  /** Single-flight guard so concurrent syncNow() calls don't double-fetch. */
  private syncInFlight: Promise<FinanceCommunitySyncResult | null> | null = null
  /** Auto-sync bootstrap state: once-only so we don't refetch on every settings doc update. */
  private autoSyncAttempted = false
  /**
   * Latest snapshot of `finance.listProviders`. Repopulated on construction
   * AND on every settings-doc update — the host-known set can grow without a
   * separate signal (a new dsh-llm provider lands via settings before
   * any session runs through it), so the card snapshot stays current.
   */
  private providerListValue: FinanceListProvidersResult | undefined
  /**
   * Mirror of `providerListValue` for failure: when `loadList` rejects or the
   * host returns `ok: false`, we surface the message here so the Provider
   * section can show an inline retry. Cleared at the start of every retry.
   */
  private providerListErrorValue: string | undefined
  /**
   * User-maintained business fields per dsh-llm provider, kept in localStorage
   * (NOT in the host settings namespace — the dsh-llm runtime registry is
   * the single source of truth for which providers exist, and we never
   * write back to it). Cached in-memory on construction and re-read on
   * every write so the projection sees the latest values without re-reading
   * the persisted state on every `publish()`.
   */
  private dshOverridesCache: Record<string, DshProviderOverride> = readAllDshProviderOverrides()

  /**
   * @param scope - bound settings scope for the `finance` namespace.
   * @param financeRemote - host Remote for community sync + provider list.
   *   `listProviders` is required for the read-only Provider configuration
   *   section; `syncCommunityPrices`/`getSyncStatus`/`refreshBalance` stay
   *   optional so a legacy host without the sync Remote keeps working (the
   *   sync section stays hidden, just like before).
   */
  constructor(
    private readonly scope: SettingsScope<FinanceConfigInput>,
    financeRemote?: FinanceRemote,
  ) {
    if (financeRemote !== undefined) {
      this.financeRemote = financeRemote
      this.syncAvailableValue = financeRemote.syncCommunityPrices !== undefined
      // Seed lastSync from prefs (cheap; the dashboard's first paint shows the
      // prior sync without waiting for the host ping).
      this.syncStateValue = { ...this.syncStateValue, lastSync: readFinancePrefs().lastSync }
    }
    this.store = createSnapshotStore<FinanceCardState>(this.projection())
    // Settings-doc updates can grow the host-known provider set (a new dsh-llm
    // provider lands via settings before any session runs through it), so
    // refresh the provider list on every change — single-flight inside
    // loadList keeps a settings burst from fanning out into N requests.
    scope.subscribe(() => {
      this.publish()
      if (this.financeRemote?.listProviders !== undefined) void this.loadList()
    })
    if (financeRemote !== undefined) {
      this.refreshSyncStatus()
      void this.loadList()
    }
  }
  private readonly financeRemote?: FinanceRemote

  private snapshot() {
    return this.scope.getSnapshot()
  }

  private sectionValue(field: FinanceCardFieldName): unknown {
    const value = this.snapshot().value
    if (value === undefined) return undefined
    switch (field) {
      case 'balance.baseURL': return value.balance?.baseURL
      case 'balance.apiKeyEnv': return value.balance?.apiKeyEnv
      case 'balance.timeoutMs': return value.balance?.timeoutMs
      case 'defaultPrice': return value.defaultPrice
      case 'providerDefaults': return value.providerDefaults
      case 'prices': return value.prices
    }
  }

  /** Render a stored value as draft text; the empty string when the section carries none. */
  private format(field: FinanceCardFieldName): string {
    const value = this.sectionValue(field)
    if (field === 'balance.timeoutMs') return typeof value === 'number' ? String(value) : ''
    if (JSON_FIELDS.has(field)) return value === undefined ? '' : JSON.stringify(value, null, 2)
    return typeof value === 'string' ? value : ''
  }

  /** The write this draft text stages, or undefined when the text is not a value this field accepts. */
  private parse(field: FinanceCardFieldName, text: string): FieldWrite | undefined {
    const trimmed = text.trim()
    if (trimmed === '') return { kind: 'clear' }
    if (field === 'balance.timeoutMs') {
      if (!/^\d+$/.test(trimmed)) return undefined
      const number = Number(trimmed)
      if (!Number.isSafeInteger(number) || number < 1) return undefined
      return { kind: 'set', value: number }
    }
    if (JSON_FIELDS.has(field)) {
      let parsed: unknown
      try { parsed = JSON.parse(trimmed) } catch { return undefined }
      if (!isPlainObject(parsed)) return undefined
      return { kind: 'set', value: parsed }
    }
    return { kind: 'set', value: trimmed }
  }

  private userLayer(): Record<string, unknown> | undefined {
    const user = this.snapshot().user
    return isPlainObject(user) ? user : undefined
  }

  private stored(field: FinanceCardFieldName): boolean {
    const user = this.userLayer()
    if (user === undefined) return false
    if (field === 'balance.baseURL') return this.userBalanceKey(user, 'baseURL')
    if (field === 'balance.apiKeyEnv') return this.userBalanceKey(user, 'apiKeyEnv')
    if (field === 'balance.timeoutMs') return this.userBalanceKey(user, 'timeoutMs')
    return Object.hasOwn(user, field)
  }

  private userBalanceKey(user: Record<string, unknown>, key: string): boolean {
    const balance = user.balance
    return isPlainObject(balance) && Object.hasOwn(balance, key)
  }

  private storedBalance(): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, 'balance')
  }

  private overridden(field: FinanceCardFieldName): boolean {
    return this.stored(field)
  }

  /** Read one control's state: draft text, override flag, and validity. */
  private fieldState(field: FinanceCardFieldName): FinanceCardFieldState {
    const staged = this.staged.get(field)
    if (staged === undefined) {
      return { text: this.format(field), overridden: this.overridden(field), invalid: false }
    }
    if (staged.clear) return { text: staged.text, overridden: false, invalid: false }
    const write = this.parse(field, staged.text)
    return { text: staged.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  /** Next `balance` section from the current value with staged overrides; undefined when nothing remains. */
  private nextBalance(): Record<string, unknown> | undefined {
    const current = this.snapshot().value?.balance
    const pick = (field: FinanceCardFieldName, key: 'baseURL' | 'apiKeyEnv' | 'timeoutMs'): unknown => {
      const staged = this.staged.get(field)
      if (staged === undefined) return current?.[key]
      if (staged.clear) return undefined
      const write = this.parse(field, staged.text)
      return write?.kind === 'set' ? write.value : undefined
    }
    const next: Record<string, unknown> = {}
    const baseURL = pick('balance.baseURL', 'baseURL')
    const apiKeyEnv = pick('balance.apiKeyEnv', 'apiKeyEnv')
    const timeoutMs = pick('balance.timeoutMs', 'timeoutMs')
    if (baseURL !== undefined) next.baseURL = baseURL
    if (apiKeyEnv !== undefined) next.apiKeyEnv = apiKeyEnv
    if (timeoutMs !== undefined) next.timeoutMs = timeoutMs
    return Object.keys(next).length === 0 ? undefined : next
  }

  /** Every staged edit a save would write; an entry whose draft is invalid carries no run (blocks save). */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    const pushIfChanged = (field: FinanceCardFieldName, staged: StagedEdit, current: unknown): void => {
      if (staged.clear) {
        if (this.stored(field)) plan.push({ run: () => this.clearField(field) })
        return
      }
      const write = this.parse(field, staged.text)
      if (write === undefined) {
        plan.push({ run: undefined })
        return
      }
      if (write.kind === 'clear') {
        if (this.stored(field)) plan.push({ run: () => this.clearField(field) })
        return
      }
      if (jsonEqual(write.value, current)) return
      plan.push({ run: () => this.storeField(field, write.value) })
    }

    if (BALANCE_FIELDS.some(field => this.staged.has(field))) {
      const balanceInvalid = BALANCE_FIELDS.some(field => {
        const staged = this.staged.get(field)
        return staged !== undefined && !staged.clear && this.parse(field, staged.text) === undefined
      })
      if (balanceInvalid) {
        plan.push({ run: undefined })
      } else {
        const next = this.nextBalance()
        const current = this.snapshot().value?.balance
        if (next === undefined) {
          if (this.storedBalance()) plan.push({ run: () => this.clearField('balance') })
        } else if (!jsonEqual(next, current)) {
          plan.push({ run: () => this.storeField('balance', next) })
        }
      }
    }

    for (const field of ['defaultPrice', 'providerDefaults', 'prices'] as const) {
      const staged = this.staged.get(field)
      if (staged !== undefined) pushIfChanged(field, staged, this.sectionValue(field))
    }
    return plan
  }

  private shell(): Pick<FinanceCardState, 'available' | 'writable' | 'dirty' | 'invalid' | 'saving' | 'failed'> {
    const snapshot = this.snapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /** Parse the stored value of a JSON field into a draft seed; empty when absent/invalid. */
  private seedJson<T>(field: FinanceCardFieldName, seed: (value: unknown) => T): T {
    const text = this.format(field).trim()
    if (text === '') return seed(undefined)
    try { return seed(JSON.parse(text)) } catch { return seed(undefined) }
  }

  private projection(): FinanceCardState {
    return {
      ...this.shell(),
      balanceBaseURL: this.fieldState('balance.baseURL'),
      balanceApiKeyEnv: this.fieldState('balance.apiKeyEnv'),
      balanceTimeoutMs: this.fieldState('balance.timeoutMs'),
      defaultPrice: this.fieldState('defaultPrice'),
      providerDefaults: this.fieldState('providerDefaults'),
      defaultPriceDraft: this.staged.has('defaultPrice') ? (this.defaultPriceDraftValue ?? { ...EMPTY_RATE }) : this.seedJson('defaultPrice', value => seedRateDraft(value)),
      providerDefaultsDraft: this.staged.has('providerDefaults') ? (this.providerDefaultsDraftValue ?? seedProviderDefaults(undefined)) : this.seedJson('providerDefaults', seedProviderDefaults),
      priceTableDraft: this.staged.has('prices') ? (this.priceTableDraftValue ?? seedPriceTable(undefined)) : this.seedJson('prices', seedPriceTable),
      prices: this.fieldState('prices'),
      prefs: readFinancePrefs(),
      syncState: this.syncStateValue,
      syncAvailable: this.syncAvailableValue,
      providerList: this.providerListValue,
      providerListError: this.providerListErrorValue,
      dshProviderRows: this.buildDshProviderRows(),
    }
  }

  /**
   * Merge the host's `finance.listProviders` snapshot with the user's
   * localStorage overlay to produce the rows the view renders. Stable
   * order: host-known first, then user-config, then ledger-observed, then
   * llm-runtime — same ranking the host uses internally. A provider with
   * no `hostMeta` (runtime-only, no dsh-llm registration) just gets a
   * sensible default (`plan` / `CNY` / `autoFetch off`).
   */
  private buildDshProviderRows(): readonly FinanceDshProviderRow[] | undefined {
    const list = this.providerListValue
    if (list === undefined) return undefined
    return list.providers.map((entry) => {
      const override = this.dshOverridesCache[entry.provider]
      return {
        provider: entry.provider,
        name: entry.provider,
        sources: entry.sources,
        ...entry.hostMeta !== undefined
          ? { hostMeta: { ...entry.hostMeta } }
          : {},
        override,
        balance: entry.balance,
      }
    })
  }

  /**
   * Write one provider's dsh-overlay entry to localStorage and refresh the
   * in-memory cache so the next `publish()` re-renders with the new row.
   * The host's dsh-llm runtime registry is NEVER touched — this is a
   * pure client-side store keyed by `providerId`.
   */
  setDshProviderOverride(provider: string, override: DshProviderOverride): void {
    writeDshProviderOverride(provider, override)
    this.dshOverridesCache = { ...this.dshOverridesCache, [provider]: override }
    this.publish()
  }

  /**
   * Remove one provider's dsh-overlay entry. The row reverts to dsh-llm
   * runtime defaults on the next projection. Idempotent — clearing a
   * non-existent entry is a no-op (the host's `listProviders` will simply
   * surface the next dsh-llm-sourced entry without an override).
   */
  clearDshProviderOverride(provider: string): void {
    if (this.dshOverridesCache[provider] === undefined) return
    writeDshProviderOverride(provider, undefined)
    const next = { ...this.dshOverridesCache }
    delete next[provider]
    this.dshOverridesCache = next
    this.publish()
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private stage(field: FinanceCardFieldName, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  /**
   * Stage a serialized price-form result: '' becomes a clear (inherit), a
   * payload becomes the draft JSON, and a malformed draft stages a marker
   * that fails JSON validation — blocking the save via the invalid flag.
   */
  private stagePriceResult(field: FinanceCardFieldName, result: PriceFormResult): void {
    if (result.ok) {
      this.stage(field, result.text === '' ? { text: '', clear: true } : { text: result.text, clear: false })
    } else {
      this.stage(field, { text: '!invalid-price-draft', clear: false })
    }
  }

  private async clearField(field: string): Promise<boolean> {
    await this.scope.unset(field)
    return !this.stored(field as FinanceCardFieldName)
  }

  private async storeField(field: string, value: unknown): Promise<boolean> {
    await this.scope.set(field, value)
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field) && jsonEqual(user[field], value)
  }

  /** Write every staged edit, then re-seed from what the Host accepted. */
  private async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run])
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) landed = await write() && landed
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /**
   * Build the face the card's slot registration injects: the card snapshot,
   * the form actions, and the immediate view-preference actions.
   */
  inject(): FinanceCardFace {
    return {
      hooks: { financeCard: this.store },
      edit: (field, text) => this.stage(field, { text, clear: false }),
      resetField: (field) => {
        if (field === 'defaultPrice') {
          this.defaultPriceDraftValue = null
        } else if (field === 'providerDefaults') {
          this.providerDefaultsDraftValue = null
        } else if (field === 'prices') {
          this.priceTableDraftValue = null
        }
        this.stage(field, { text: this.format(field), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        // Mirror resetField: also reset the in-flight price-form drafts
        // so the next projection re-seeds from the stored section instead
        // of rendering the stale half-edited draft (single source of
        // truth — staged and draft caches stay in lockstep).
        this.defaultPriceDraftValue = null
        this.providerDefaultsDraftValue = null
        this.priceTableDraftValue = null
        this.failed = false
        this.publish()
      },
      setLayout: (layout) => {
        writeFinancePrefs({ ...readFinancePrefs(), layout })
        this.publish()
      },
      toggleChart: (key) => {
        const prefs = readFinancePrefs()
        writeFinancePrefs({ ...prefs, charts: { ...prefs.charts, [key]: !prefs.charts[key] } })
        this.publish()
      },
      setDefaultPrice: (draft) => {
        this.defaultPriceDraftValue = draft
        this.stagePriceResult('defaultPrice', serializeDefaultPriceDraft(draft))
      },
      setProviderDefaults: (draft) => {
        this.providerDefaultsDraftValue = draft
        this.stagePriceResult('providerDefaults', serializeProviderDefaultsDraft(draft))
      },
      setPriceTable: (draft) => {
        this.priceTableDraftValue = draft
        this.stagePriceResult('prices', serializePriceTableDraft(draft))
      },
      syncNow: () => this.syncNow(),
      setAutoSync: (next) => this.setAutoSync(next),
      ensureAutoSync: () => this.ensureAutoSync(),
      setDshProviderOverride: (provider, override) => this.setDshProviderOverride(provider, override),
      clearDshProviderOverride: (provider) => this.clearDshProviderOverride(provider),
      retryListProviders: () => { void this.loadList() },
    }
  }

  // -------- community sync --------

  /**
   * Single-flight `syncNow`: collapse concurrent calls onto one inflight
   * promise so a held-down button does not hammer the host. Returns the
   * resolved result (or null when the host has no sync Remote) and surfaces
   * `syncing`/`lastSync`/`lastError` on `state.syncState`.
   */
  private syncNow(): Promise<FinanceCommunitySyncResult | null> {
    const remote = this.financeRemote
    const sync = remote?.syncCommunityPrices
    if (sync === undefined) return Promise.resolve(null)
    if (this.syncInFlight !== null) return this.syncInFlight
    this.syncStateValue = { ...this.syncStateValue, syncing: true, lastError: null }
    this.publish()
    const promise = (async (): Promise<FinanceCommunitySyncResult | null> => {
      try {
        // The host `@Remote syncCommunityPrices` descriptor always declares
        // `options` as a business arg (even though it is optional on the
        // implementation: `options?`), so the apiproxy gate refuses a zero-arg
        // call with `expected 1 business argument(s) plus an optional AbortSignal`.
        // Pass an empty options object to signal "use defaults"; the host's
        // `defaultSyncOptions()` fills in `providers` + `fx` when these are
        // undefined, so this is semantically identical to the previous no-arg
        // call but satisfies the contract.
        const remoteResult = await sync({})
        if (!remoteResult.ok) {
          this.syncStateValue = {
            syncing: false,
            lastSync: this.syncStateValue.lastSync,
            lastError: remoteResult.error.message,
          }
          return null
        }
        const value = remoteResult.value
        const snapshot: FinanceSyncSnapshot = {
          appliedAt: value.appliedAt ?? 0,
          source: value.source,
          kept: value.kept,
          providers: value.providers,
          fx: value.fx,
        }
        this.persistLastSync(snapshot)
        this.syncStateValue = { syncing: false, lastSync: snapshot, lastError: null }
        return value
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.syncStateValue = { ...this.syncStateValue, syncing: false, lastError: message }
        return null
      } finally {
        this.syncInFlight = null
        this.publish()
      }
    })()
    this.syncInFlight = promise
    return promise
  }

  /**
   * Flip the auto-sync preference. Persists via `writeFinancePrefs` so the
   * value travels across page reloads; the next `ensureAutoSync` consults
   * it before any fetch. Pass-through to a no-op when no sync Remote exists.
   */
  private setAutoSync(next: boolean): void {
    const prefs = readFinancePrefs()
    if (prefs.autoSync === next) return
    writeFinancePrefs({ ...prefs, autoSync: next })
    this.publish()
  }

  /**
   * Auto-sync bootstrap: if `prefs.autoSync` is true and the persisted
   * snapshot is older than 24h (or missing), fire a single syncNow. Idempotent
   * per controller instance so settings doc updates don't re-trigger.
   */
  ensureAutoSync(): void {
    if (this.autoSyncAttempted) return
    this.autoSyncAttempted = true
    const remote = this.financeRemote
    if (remote === undefined || remote.syncCommunityPrices === undefined) return
    const prefs = readFinancePrefs()
    if (!prefs.autoSync) return
    const lastApplied = prefs.lastSync?.appliedAt ?? 0
    const stale = lastApplied === 0 || (Date.now() - lastApplied) > ONE_DAY_MS
    if (stale) void this.syncNow()
  }

  /**
   * Pull the merged provider list. Single-flight: concurrent calls share one
   * in-flight promise so settings-doc bursts don't fan out into N requests.
   * Failure (host error or thrown) surfaces as `providerListError` on the
   * projection — the Provider section shows an inline retry so the card
   * never sits on a permanent loading slot. A successful retry clears the
   * error and re-publishes the rows.
   */
  private listInFlight: Promise<void> | null = null
  private async loadList(): Promise<void> {
    if (this.listInFlight !== null) return this.listInFlight
    const list = this.financeRemote?.listProviders
    if (list === undefined) return
    this.store.update(state => { state.providerListError = undefined })
    const task = (async () => {
      try {
        const result = await list()
        if (!result.ok) {
          this.store.update(state => { state.providerListError = result.error.message })
          return
        }
        this.providerListValue = result.value
        this.publish()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.store.update(state => { state.providerListError = message })
      }
    })()
    this.listInFlight = task.finally(() => { this.listInFlight = null })
    return this.listInFlight
  }

  /**
   * Fire-and-forget host status probe. Used to surface a real `kept` count
   * shortly after mount when the local prefs.lastSync is null or stale.
   */
  private refreshSyncStatus(): void {
    const remote = this.financeRemote
    if (remote === undefined || remote.getSyncStatus === undefined) return
    void remote.getSyncStatus().then((result) => {
      if (!result.ok) return
      const value: FinanceSyncStatus | null = result.value
      if (value === null) return
      const snapshot: FinanceSyncSnapshot = {
        appliedAt: value.appliedAt,
        source: value.source,
        kept: value.kept,
        providers: value.providers,
        fx: value.fx,
      }
      const current = readFinancePrefs().lastSync
      // Don't overwrite a fresher local snapshot with an older one.
      if (current && current.appliedAt >= snapshot.appliedAt) return
      this.persistLastSync(snapshot)
      this.syncStateValue = { ...this.syncStateValue, lastSync: snapshot }
      this.publish()
    })
  }

  /** Persist the snapshot into prefs via localStorage (single source of truth in the client). */
  private persistLastSync(snapshot: FinanceSyncSnapshot): void {
    const prefs = readFinancePrefs()
    if (JSON.stringify(prefs.lastSync) === JSON.stringify(snapshot)) return
    writeFinancePrefs({ ...prefs, lastSync: snapshot })
  }
}
