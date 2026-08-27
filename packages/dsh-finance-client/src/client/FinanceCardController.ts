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
import type { FinanceConfigInput } from 'dsh-finance/types'
import { billingModesToRows, rowsToBillingModes } from './billing-modes.ts'
import type { BillingModeRow } from './billing-modes.ts'
import { readFinancePrefs, writeFinancePrefs } from './persist.ts'
import type { FinanceChartPrefs, FinanceLayout, FinancePrefs } from './persist.ts'

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
  prices: FinanceCardFieldState
  /** Dashboard view preferences (browser-local; apply immediately). */
  prefs: FinancePrefs
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

  /** @param scope - the bound settings scope for the `finance` namespace. */
  constructor(private readonly scope: SettingsScope<FinanceConfigInput>) {
    this.store = createSnapshotStore<FinanceCardState>(this.projection())
    scope.subscribe(() => this.publish())
  }

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
      prices: this.fieldState('prices'),
      prefs: readFinancePrefs(),
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
    }
  }
}
