/**
 * Finance plugin card controller: bridges the `finance` settings namespace
 * (balance connection + price facts) and the dashboard view preferences
 * (browser-local) onto one snapshot store, staging namespace edits until
 * save — the same staged-form model as the shell/agent-loop plugin cards.
 *
 * The `balance` sub-fields are edited as one group: the settings wire writes
 * top-level section fields only, so saving a staged baseURL/apiKeyEnv/timeout
 * change writes the whole `balance` object (preserving untouched members).
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { FinanceCommunitySyncResult, FinanceConfigInput, FinanceSyncStatus } from 'dsh-spark-finance/types'
import { billingModesToRows, rowsToBillingModes } from './billing-modes.ts'
import type { BillingModeRow } from './billing-modes.ts'
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
import { readFinancePrefs, writeFinancePrefs } from './persist.ts'
import type { FinanceChartPrefs, FinanceLayout, FinancePrefs, FinanceSyncSnapshot } from './persist.ts'

export type FinanceCardFieldName =
  | 'currency'
  | 'balance.baseURL'
  | 'balance.apiKeyEnv'
  | 'balance.timeoutMs'
  | 'defaultPrice'
  | 'providerDefaults'
  | 'billingModes'
  | 'prices'

const BALANCE_FIELDS: readonly FinanceCardFieldName[] = ['balance.baseURL', 'balance.apiKeyEnv', 'balance.timeoutMs']
const JSON_FIELDS: ReadonlySet<FinanceCardFieldName> = new Set(['defaultPrice', 'providerDefaults', 'billingModes', 'prices'])
/** Threshold above which `ensureAutoSync` re-fires without a host click. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000

// Re-exported so existing consumers (tests, faces) keep one import face; the
// implementations live in billing-modes.ts, which stays free of the
// client-runtime dependency for SSR-safe rendering.
export { billingModesToRows, rowsToBillingModes } from './billing-modes.ts'
export type { BillingModeRow } from './billing-modes.ts'

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
  currency: FinanceCardFieldState
  balanceBaseURL: FinanceCardFieldState
  balanceApiKeyEnv: FinanceCardFieldState
  balanceTimeoutMs: FinanceCardFieldState
  defaultPrice: FinanceCardFieldState
  providerDefaults: FinanceCardFieldState
  billingModes: FinanceCardFieldState
  /**
   * Live editor rows for the billing-mode form (INCLUDING in-progress
   * blank routes the serialized JSON drops). Controlled from the controller
   * so an added row survives re-renders until it is saved or reset.
   */
  billingRows: readonly BillingModeRow[]
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
}

/** The registration-side face the finance card's slot entry injects. */
export interface FinanceCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useFinanceCard. */
    financeCard: SnapshotStore<FinanceCardState>
  }
  /** Stage draft text for one field. */
  edit: (field: FinanceCardFieldName, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  resetField: (field: FinanceCardFieldName) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
  /** Apply a dashboard layout immediately. */
  setLayout: (layout: FinanceLayout) => void
  /** Toggle one dashboard chart's visibility immediately. */
  toggleChart: (key: keyof FinanceChartPrefs) => void
  /** Stage the billing-mode editor rows (serialized into the staged JSON). */
  setBillingModes: (rows: readonly BillingModeRow[]) => void
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

export class FinanceCardController {
  private readonly staged = new Map<FinanceCardFieldName, StagedEdit>()
  private readonly store: SnapshotStore<FinanceCardState>
  private saving = false
  private failed = false
  /**
   * Latest editor rows passed through setBillingModes — kept verbatim (blank
   * routes included) so the form never eats a row mid-edit. Only consulted
   * while a billingModes draft is staged; otherwise the projection reseeds
   * from the stored value.
   */
  private billingEditorRows: BillingModeRow[] = []
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
   * @param scope - bound settings scope for the `finance` namespace.
   * @param financeRemote - host Remote for community sync. Absent on hosts
   *   that pre-date the sync Remote (older plugin builds): the card keeps
   *   working but hides the sync section (`syncAvailableValue` stays false).
   */
  constructor(
    private readonly scope: SettingsScope<FinanceConfigInput>,
    financeRemote?: Pick<ClientRemote['finance'], 'syncCommunityPrices' | 'getSyncStatus'>,
  ) {
    if (financeRemote !== undefined) {
      this.financeRemote = financeRemote
      this.syncAvailableValue = true
      // Seed lastSync from prefs (cheap; the dashboard's first paint shows the
      // prior sync without waiting for the host ping).
      this.syncStateValue = { ...this.syncStateValue, lastSync: readFinancePrefs().lastSync }
    }
    this.store = createSnapshotStore<FinanceCardState>(this.projection())
    scope.subscribe(() => this.publish())
    if (financeRemote !== undefined) {
      this.refreshSyncStatus()
    }
  }
  private readonly financeRemote?: Pick<ClientRemote['finance'], 'syncCommunityPrices' | 'getSyncStatus'>

  private snapshot() {
    return this.scope.getSnapshot()
  }

  private sectionValue(field: FinanceCardFieldName): unknown {
    const value = this.snapshot().value
    if (value === undefined) return undefined
    switch (field) {
      case 'currency': return value.currency
      case 'balance.baseURL': return value.balance?.baseURL
      case 'balance.apiKeyEnv': return value.balance?.apiKeyEnv
      case 'balance.timeoutMs': return value.balance?.timeoutMs
      case 'defaultPrice': return value.defaultPrice
      case 'providerDefaults': return value.providerDefaults
      case 'billingModes': return value.billingModes
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
      // Billing-mode tags must carry known modes only — fail fast client-side
      // instead of letting the Host reject the whole settings write later.
      if (field === 'billingModes') {
        for (const mode of Object.values(parsed)) {
          if (mode !== 'metered' && mode !== 'plan') return undefined
        }
      }
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

    const currency = this.staged.get('currency')
    if (currency !== undefined) pushIfChanged('currency', currency, this.sectionValue('currency'))

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

    for (const field of ['defaultPrice', 'providerDefaults', 'billingModes', 'prices'] as const) {
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
      currency: this.fieldState('currency'),
      balanceBaseURL: this.fieldState('balance.baseURL'),
      balanceApiKeyEnv: this.fieldState('balance.apiKeyEnv'),
      balanceTimeoutMs: this.fieldState('balance.timeoutMs'),
      defaultPrice: this.fieldState('defaultPrice'),
      providerDefaults: this.fieldState('providerDefaults'),
      billingModes: this.fieldState('billingModes'),
      billingRows: this.staged.has('billingModes') ? this.billingEditorRows : billingModesToRows(this.format('billingModes')),
      defaultPriceDraft: this.staged.has('defaultPrice') ? (this.defaultPriceDraftValue ?? { ...EMPTY_RATE }) : this.seedJson('defaultPrice', value => seedRateDraft(value)),
      providerDefaultsDraft: this.staged.has('providerDefaults') ? (this.providerDefaultsDraftValue ?? seedProviderDefaults(undefined)) : this.seedJson('providerDefaults', seedProviderDefaults),
      priceTableDraft: this.staged.has('prices') ? (this.priceTableDraftValue ?? seedPriceTable(undefined)) : this.seedJson('prices', seedPriceTable),
      prices: this.fieldState('prices'),
      prefs: readFinancePrefs(),
      syncState: this.syncStateValue,
      syncAvailable: this.syncAvailableValue,
    }
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
        if (field === 'billingModes') {
          // Reset drops the draft: reseed the live editor from the stored value.
          this.billingEditorRows = billingModesToRows(this.format(field))
        } else if (field === 'defaultPrice') {
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
      setBillingModes: (rows) => {
        // Keep the verbatim rows (blank routes included) for the live form;
        // only the serialized JSON drops blanks and stays the save payload.
        this.billingEditorRows = [...rows]
        const text = rowsToBillingModes(rows)
        // An empty serialization means 'inherit again' when nothing is stored:
        // stage it as a clear so dirty stays false for a no-op edit.
        const storedAlready = this.stored('billingModes')
        this.stage('billingModes', text === '' && !storedAlready ? { text: '', clear: true } : { text, clear: text === '' })
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
    if (remote === undefined) return Promise.resolve(null)
    if (this.syncInFlight !== null) return this.syncInFlight
    this.syncStateValue = { ...this.syncStateValue, syncing: true, lastError: null }
    this.publish()
    const promise = (async (): Promise<FinanceCommunitySyncResult | null> => {
      try {
        const remoteResult = await remote.syncCommunityPrices()
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
    if (this.financeRemote === undefined) return
    const prefs = readFinancePrefs()
    if (!prefs.autoSync) return
    const lastApplied = prefs.lastSync?.appliedAt ?? 0
    const stale = lastApplied === 0 || (Date.now() - lastApplied) > ONE_DAY_MS
    if (stale) void this.syncNow()
  }

  /**
   * Fire-and-forget host status probe. Used to surface a real `kept` count
   * shortly after mount when the local prefs.lastSync is null or stale.
   */
  private refreshSyncStatus(): void {
    const remote = this.financeRemote
    if (remote === undefined) return
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
