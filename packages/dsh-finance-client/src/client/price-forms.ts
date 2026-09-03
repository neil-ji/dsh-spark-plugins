/**
 * Price-fact form models for the finance config card — plain data, no React,
 * no client-runtime dependency (SSR-safe like billing-modes.ts). Every editor
 * works on drafts of strings/choices and (de)serializes to the same shape the
 * settings wire stores, so the staged-form pipeline stays untouched.
 */

/** One rate line as the form edits it: 4 numeric fields in micros/Mtok. */
export interface RateDraft {
  input: string
  cacheRead: string
  cacheWrite: string
  output: string
}

export const EMPTY_RATE: RateDraft = { input: '', cacheRead: '', cacheWrite: '', output: '' }

/** Positive-integer micros check; empty fields are tolerated (omitted on write). */
const MICROS_RE = /^\d+$/
export function validMicrosDraft(text: string): boolean {
  if (text.trim() === '') return true
  return MICROS_RE.test(text.trim()) && Number.isSafeInteger(Number(text.trim()))
}

/** All 4 rate fields valid (or empty). Used to block save on malformed numbers. */
export function validRateDraft(rate: RateDraft | null | undefined): boolean {
  if (rate === null || rate === undefined) return true
  return validMicrosDraft(rate.input) && validMicrosDraft(rate.cacheRead) && validMicrosDraft(rate.cacheWrite) && validMicrosDraft(rate.output)
}

/** Parse a rate draft into the wire shape; null when a field is malformed. */
export function parseRateDraft(rate: RateDraft | null | undefined, required: boolean): Record<string, number> | null {
  if (rate === null || rate === undefined) return null
  const out: Record<string, number> = {}
  const pick = (key: string, field: string): boolean => {
    const text = rate[field as keyof RateDraft].trim()
    if (text === '') return true
    if (!validMicrosDraft(text)) return false
    out[key] = Number(text)
    return true
  }
  if (!pick('inputMicrosPerMtok', 'input')) return null
  if (!pick('cacheReadMicrosPerMtok', 'cacheRead')) return null
  if (!pick('cacheWriteMicrosPerMtok', 'cacheWrite')) return null
  if (!pick('outputMicrosPerMtok', 'output')) return null
  if (required && out.inputMicrosPerMtok === undefined && out.outputMicrosPerMtok === undefined) return null
  return out
}

/**
 * One configurable provider default as the form edits it.
 * `enabled` distinguishes an untouched blank row from an intentionally empty
 * one; only enabled rows with a provider name are written.
 */
export interface ProviderRateDraft {
  provider: string
  rate: RateDraft
}

/** Provider-defaults editor rows. */
export interface ProviderDefaultsDraft {
  rows: ProviderRateDraft[]
}

export const EMPTY_PROVIDER_DEFAULTS: ProviderDefaultsDraft = { rows: [] }

export function newProviderRateRow(): ProviderRateDraft {
  return { provider: '', rate: { ...EMPTY_RATE } }
}

/** Parse draft rows into the `{provider: rate}` wire map; null when any row is malformed. */
export function parseProviderDefaultsDraft(draft: ProviderDefaultsDraft): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const row of draft.rows) {
    const provider = row.provider.trim()
    if (provider === '') continue
    if (!validRateDraft(row.rate)) return null
    const rate = parseRateDraft(row.rate, false)
    if (rate === null) return null
    out[provider] = rate
  }
  return Object.keys(out).length === 0 ? null : out
}

/**
 * One price-table entry as the form edits it. flat entries carry `flat`;
 * windowed entries carry offPeak/peak plus the peak schedule strings.
 * `kind` is chosen from a select — never typed by hand.
 */
export type PriceEntryKind = 'flat' | 'windowed'

export interface PriceEntryDraft {
  kind: PriceEntryKind
  /** Epoch ms or ISO string, or empty for 'applies from the start'. */
  effectiveFrom: string
  flat: RateDraft
  offPeak: RateDraft
  peak: RateDraft
  /** Half-open hour ranges, e.g. '9-12, 14-18'. Empty = DeepSeek default. */
  peakHours: string
  /** Weekday list, e.g. '1,2,3,4,5'. Empty = weekdays. */
  peakDays: string
}

export function newPriceEntry(kind: PriceEntryKind): PriceEntryDraft {
  return {
    kind,
    effectiveFrom: '',
    flat: { ...EMPTY_RATE },
    offPeak: { ...EMPTY_RATE },
    peak: { ...EMPTY_RATE },
    peakHours: '',
    peakDays: '',
  } as PriceEntryDraft
}

export interface PriceModelDraft {
  modelKey: string
  entries: PriceEntryDraft[]
}

export interface PriceTableDraft {
  models: PriceModelDraft[]
}

export const EMPTY_PRICE_TABLE: PriceTableDraft = { models: [] }

/**
 * Validates a '9-12,14-18' hour-range string. Empty (default) is valid;
 * malformed text is rejected so the save blocks instead of silently
 * dropping the user's schedule.
 */
export function validPeakHoursDraft(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return true
  for (const part of trimmed.split(',')) {
    const [s, e] = part.trim().split('-').map(Number)
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 23 || e < 1 || e > 24 || s >= e) return false
  }
  return true
}

/** Validates a '1,2,3,4,5' weekday-list string. Empty (default) is valid. */
export function validPeakDaysDraft(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return true
  return trimmed.split(',').every(part => {
    const day = Number(part.trim())
    return Number.isInteger(day) && day >= 0 && day <= 6
  })
}

/** Split '9-12,14-18' -> [[9,12],[14,18]]; null when empty (use default). Callers validate first. */
function parseHourRanges(text: string): number[][] | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const ranges: number[][] = []
  for (const part of trimmed.split(',')) {
    const [s, e] = part.trim().split('-').map(Number)
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 23 || e < 1 || e > 24 || s >= e) return null
    ranges.push([s, e])
  }
  return ranges.length === 0 ? null : ranges
}

function parseDayList(text: string): number[] | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const days: number[] = []
  for (const part of trimmed.split(',')) {
    const day = Number(part.trim())
    if (!Number.isInteger(day) || day < 0 || day > 6) return null
    days.push(day)
  }
  return days
}

/** Serialize one model's entries into the raw price-table shape; null when malformed. */
function serializeEntry(entry: PriceEntryDraft): Record<string, unknown> | null {
  if (entry.kind === 'flat') {
    if (!validRateDraft(entry.flat)) return null
    const flat = parseRateDraft(entry.flat, true)
    if (flat === null) return null
    const out: Record<string, unknown> = { ...flat }
    if (entry.effectiveFrom.trim() !== '') out.effectiveFrom = entry.effectiveFrom.trim()
    return out
  }
  if (!validRateDraft(entry.offPeak) || !validRateDraft(entry.peak)) return null
  const offPeak = parseRateDraft(entry.offPeak, true)
  const peak = parseRateDraft(entry.peak, true)
  if (offPeak === null || peak === null) return null
  if (!validPeakHoursDraft(entry.peakHours) || !validPeakDaysDraft(entry.peakDays)) return null
  const out: Record<string, unknown> = {}
  if (entry.effectiveFrom.trim() !== '') out.effectiveFrom = entry.effectiveFrom.trim()
  const hours = parseHourRanges(entry.peakHours)
  const days = parseDayList(entry.peakDays)
  if (hours !== null) out.peakHours = hours
  if (days !== null) out.peakDays = days
  out.offPeak = offPeak
  out.peak = peak
  return out
}

/** Parse the whole table draft into the `{modelKey: [entries]}` wire map; null when malformed. */
export function parsePriceTableDraft(draft: PriceTableDraft): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const model of draft.models) {
    const modelKey = model.modelKey.trim()
    if (modelKey === '') continue
    const entries: unknown[] = []
    for (const entry of model.entries) {
      const serialized = serializeEntry(entry)
      if (serialized === null) return null
      entries.push(serialized)
    }
    if (entries.length > 0) out[modelKey] = entries.length === 1 ? entries[0] : entries
  }
  return Object.keys(out).length === 0 ? null : out
}

/**
 * Result of serializing a draft for the staged text slot. `text` is the
 * wire JSON to save ('' means clear), `ok: false` means the draft is
 * malformed and must block the save.
 */
export type PriceFormResult = { ok: true; text: string } | { ok: false }

function allRateFieldsEmpty(rate: RateDraft): boolean {
  return rate.input.trim() === '' && rate.cacheRead.trim() === '' && rate.cacheWrite.trim() === '' && rate.output.trim() === ''
}

/** Serialize the default-price draft: '' clears, JSON carries the rate, ok:false blocks. */
export function serializeDefaultPriceDraft(draft: RateDraft): PriceFormResult {
  if (allRateFieldsEmpty(draft)) return { ok: true, text: '' }
  if (!validRateDraft(draft)) return { ok: false }
  const rate = parseRateDraft(draft, false)
  return rate === null ? { ok: false } : { ok: true, text: JSON.stringify(rate) }
}

/** Serialize provider-default rows: '' clears, JSON carries the map, ok:false blocks. */
export function serializeProviderDefaultsDraft(draft: ProviderDefaultsDraft): PriceFormResult {
  let hasAny = false
  for (const row of draft.rows) if (row.provider.trim() !== '') { hasAny = true; break }
  if (!hasAny) return { ok: true, text: '' }
  const out: Record<string, unknown> = {}
  for (const row of draft.rows) {
    if (row.provider.trim() === '') continue
    if (!validRateDraft(row.rate)) return { ok: false }
    const rate = parseRateDraft(row.rate, false)
    if (rate === null) return { ok: false }
    out[row.provider.trim()] = rate
  }
  return { ok: true, text: JSON.stringify(out) }
}

/** Serialize the price table: '' clears, JSON carries the map, ok:false blocks. */
export function serializePriceTableDraft(draft: PriceTableDraft): PriceFormResult {
  let hasAny = false
  for (const model of draft.models) if (model.modelKey.trim() !== '' && model.entries.length > 0) { hasAny = true; break }
  if (!hasAny) return { ok: true, text: '' }
  const out: Record<string, unknown> = {}
  for (const model of draft.models) {
    if (model.modelKey.trim() === '') continue
    const entries: unknown[] = []
    for (const entry of model.entries) {
      const serialized = serializeEntryForDraft(entry)
      if (serialized === null) return { ok: false }
      entries.push(serialized)
    }
    if (entries.length > 0) out[model.modelKey.trim()] = entries.length === 1 ? entries[0] : entries
  }
  return { ok: true, text: JSON.stringify(out) }
}

/** One entry serialized for the save payload; null = malformed (blocks save). */
function serializeEntryForDraft(entry: PriceEntryDraft): Record<string, unknown> | null {
  if (entry.kind === 'flat') {
    if (!validRateDraft(entry.flat)) return null
    const flat = parseRateDraft(entry.flat, false)
    if (flat === null) return null
    const out: Record<string, unknown> = { ...flat }
    if (entry.effectiveFrom.trim() !== '') out.effectiveFrom = entry.effectiveFrom.trim()
    return out
  }
  if (!validRateDraft(entry.offPeak) || !validRateDraft(entry.peak)) return null
  if (!validPeakHoursDraft(entry.peakHours) || !validPeakDaysDraft(entry.peakDays)) return null
  const offPeak = parseRateDraft(entry.offPeak, false)
  const peak = parseRateDraft(entry.peak, false)
  if (offPeak === null || peak === null) return null
  const out: Record<string, unknown> = {}
  if (entry.effectiveFrom.trim() !== '') out.effectiveFrom = entry.effectiveFrom.trim()
  const hours = parseHourRanges(entry.peakHours)
  const days = parseDayList(entry.peakDays)
  if (hours !== null) out.peakHours = hours
  if (days !== null) out.peakDays = days
  out.offPeak = offPeak
  out.peak = peak
  return out
}

/** Seed a rate draft from a wire rate object (or undefined). */
export function seedRateDraft(value: unknown): RateDraft {
  const num = (key: string): string => {
    const rec = isRecord(value)
    const n = rec ? value[key] : undefined
    return typeof n === 'number' && Number.isFinite(n) ? String(n) : ''
  }
  return { input: num('inputMicrosPerMtok'), cacheRead: num('cacheReadMicrosPerMtok'), cacheWrite: num('cacheWriteMicrosPerMtok'), output: num('outputMicrosPerMtok') }
}

/** Seed provider-defaults rows from a wire `{provider: rate}` map. */
export function seedProviderDefaults(value: unknown): ProviderDefaultsDraft {
  if (!isRecord(value)) return EMPTY_PROVIDER_DEFAULTS
  return {
    rows: Object.entries(value).map(([provider, rate]) => ({
      provider,
      rate: seedRateDraft(isRecord(rate) ? rate : undefined),
    })),
  }
}

/** Seed a price-table draft from the wire `{modelKey: entry-or-list}` map. */
export function seedPriceTable(value: unknown): PriceTableDraft {
  if (!isRecord(value)) return EMPTY_PRICE_TABLE
  const models: PriceModelDraft[] = Object.entries(value).map(([modelKey, raw]) => ({
    modelKey,
    entries: (Array.isArray(raw) ? raw : [raw]).map(seedEntry).filter((entry): entry is PriceEntryDraft => entry !== null),
  }))
  return { models }
}

function seedEntry(raw: unknown): PriceEntryDraft | null {
  const rec = isRecord(raw) ? raw : null
  if (rec === null) return null
  const windowed = rec.kind === 'windowed' || (isRecord(rec.offPeak) && isRecord(rec.peak))
  const effectiveFrom = typeof rec.effectiveFrom === 'string' || typeof rec.effectiveFrom === 'number' ? String(rec.effectiveFrom) : ''
  if (!windowed) {
    return { kind: 'flat', effectiveFrom, flat: seedRateDraft(rec), offPeak: { ...EMPTY_RATE }, peak: { ...EMPTY_RATE }, peakHours: '', peakDays: '' }
  }
  return {
    kind: 'windowed',
    effectiveFrom,
    flat: { ...EMPTY_RATE },
    offPeak: seedRateDraft(isRecord(rec.offPeak) ? rec.offPeak : undefined),
    peak: seedRateDraft(isRecord(rec.peak) ? rec.peak : undefined),
    peakHours: formatRanges(rec.peakHours),
    peakDays: formatDays(rec.peakDays),
  }
}

function formatRanges(ranges: unknown): string {
  if (!Array.isArray(ranges)) return ''
  return ranges
    .filter((r): r is unknown[] => Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' && typeof r[1] === 'number')
    .map(r => `${r[0]}-${r[1]}`)
    .join(', ')
}

function formatDays(days: unknown): string {
  if (!Array.isArray(days)) return ''
  return days.filter((d): d is number => typeof d === 'number').join(', ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}