/**
 * Form editors for the finance price facts — no raw JSON anywhere. Every
 * editor is controlled (`value`/`onChange` over a draft model) and relies on
 * price-forms.ts for (de)serialization on the save boundary.
 */

import { Input, SegmentedControl } from 'dsh-ui-kit'
import type {
  PriceEntryDraft,
  PriceModelDraft,
  PriceTableDraft,
  PriceEntryKind,
  ProviderDefaultsDraft,
  RateDraft,
} from './price-forms.ts'
import {
  newPriceEntry,
  validMicrosDraft,
  validPeakDaysDraft,
  validPeakHoursDraft,
  validRateDraft,
} from './price-forms.ts'
import type { FinanceKey } from './locales.ts'
import css from './PriceEditors.module.css'

/**
 * Four numeric rate fields grid. Blank fields = omit the line; non-numeric
 * input instantly shows an invalid hint and blocks the save (draft serializes
 * to null).
 */
export function RateFields({ rate, onChange, t, idPrefix }: {
  rate: RateDraft
  onChange: (next: RateDraft) => void
  t: (key: FinanceKey) => string
  idPrefix: string
}) {
  const set = (field: keyof RateDraft, text: string): void => {
    onChange({ ...rate, [field]: text })
  }
  const invalid = !validRateDraft(rate)
  const fields: Array<[keyof RateDraft, string]> = [
    ['input', t('rateInput')],
    ['cacheRead', t('rateCacheRead')],
    ['cacheWrite', t('rateCacheWrite')],
    ['output', t('rateOutput')],
  ]
  return (
    <div className={css.rateGrid}>
      {fields.map(([key, label]) => (
        <label key={key} className={`${css.rateField} ${invalid ? css.invalid : ''}`} htmlFor={`${idPrefix}-${key}`}>
          <span className={css.rateLabel}>{label}</span>
          <Input
            id={`${idPrefix}-${key}`}
            className={css.rateInput}
            type="text"
            inputMode="numeric"
            value={rate[key]}
            spellCheck={false}
            onChange={(event) => set(key, event.currentTarget.value)}
          />
          <span className={css.rateUnit}>{t('rateUnit')}</span>
        </label>
      ))}
    </div>
  )
}

/** Provider default rows: provider name + inline rate fields, add/remove. */
export function ProviderDefaultsEditor({ value, onChange, disabled, t }: {
  value: ProviderDefaultsDraft
  onChange: (next: ProviderDefaultsDraft) => void
  disabled: boolean
  t: (key: FinanceKey) => string
}) {
  const update = (index: number, next: Partial<ProviderDefaultsDraft['rows'][number]>): void => {
    onChange({ rows: value.rows.map((row, i) => (i === index ? { ...row, ...next } : row)) })
  }
  return (
    <div className={css.editor}>
      <div className={css.headerRow}>
        <span className={`${css.colProvider} ${css.colHead}`}>{t('providerColumn')}</span>
        <span className={`${css.colRate} ${css.colHead}`}>{t('rateColumn')}</span>
        <span className={css.colHead} />
      </div>
      {value.rows.map((row, index) => (
        <div key={`${row.provider}-${index}`} className={css.row}>
          <Input
            className={css.colProvider}
            type="text"
            value={row.provider}
            placeholder="openai"
            spellCheck={false}
            disabled={disabled}
            aria-label={t('providerColumn')}
            onChange={(event) => update(index, { provider: event.currentTarget.value })}
          />
          <div className={css.colRate}>
            <RateFields
              rate={row.rate}
              idPrefix={`finance-provider-${index}`}
              t={t}
              onChange={(rate) => update(index, { rate })}
            />
          </div>
          <button
            type="button"
            className={css.remove}
            disabled={disabled}
            aria-label={`${t('removeProvider')}: ${row.provider}`}
            onClick={() => onChange({ rows: value.rows.filter((_, i) => i !== index) })}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className={css.add} disabled={disabled} onClick={() => onChange({ rows: [...value.rows, { provider: '', rate: { input: '', cacheRead: '', cacheWrite: '', output: '' } }] })}>
        {t('addProviderDefault')}
      </button>
    </div>
  )
}

const PRICE_KINDS: Array<{ value: PriceEntryKind; labelKey: FinanceKey }> = [
  { value: 'flat', labelKey: 'kindFlat' },
  { value: 'windowed', labelKey: 'kindWindowed' },
]

/** One price entry card: kind select + effectiveFrom + the rate fields it needs. */
function PriceEntryEditor({ entry, index, t, disabled, onChange, onRemove }: {
  entry: PriceEntryDraft
  index: number
  t: (key: FinanceKey) => string
  disabled: boolean
  onChange: (next: PriceEntryDraft) => void
  onRemove: () => void
}) {
  const scheduleInvalid = !validPeakHoursDraft(entry.peakHours) || !validPeakDaysDraft(entry.peakDays)
  return (
    <div className={css.entryCard}>
      <div className={css.entryHead}>
        <SegmentedControl
          options={PRICE_KINDS.map(k => ({ value: k.value, label: t(k.labelKey) }))}
          value={entry.kind}
          ariaLabel={`${t('priceEntryKind')} #${index + 1}`}
          disabled={disabled}
          // Keep everything (rates, effectiveFrom, schedule) — switching kind
          // only changes which rate block is live.
          onChange={(kind) => onChange({ ...entry, kind })}
        />
        <label className={css.effectiveFrom} htmlFor={`price-entry-${index}-from`}>
          <span>{t('effectiveFrom')}</span>
          <Input
            id={`price-entry-${index}-from`}
            type="text"
            value={entry.effectiveFrom}
            placeholder={t('effectiveFromHint')}
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => onChange({ ...entry, effectiveFrom: event.currentTarget.value })}
          />
        </label>
        <button type="button" className={css.remove} disabled={disabled} aria-label={`${t('removePriceEntry')} #${index + 1}`} onClick={onRemove}>×</button>
      </div>
      {entry.kind === 'flat' ? (
        <RateFields rate={entry.flat} idPrefix={`price-entry-${index}-flat`} t={t} onChange={(flat) => onChange({ ...entry, flat })} />
      ) : (
        <div className={css.windowedBlock}>
          <div className={css.rateBlock}><span className={css.rateBlockTitle}>{t('offPeakRate')}</span><RateFields rate={entry.offPeak} idPrefix={`price-entry-${index}-offpeak`} t={t} onChange={(offPeak) => onChange({ ...entry, offPeak })} /></div>
          <div className={css.rateBlock}><span className={css.rateBlockTitle}>{t('peakRate')}</span><RateFields rate={entry.peak} idPrefix={`price-entry-${index}-peak`} t={t} onChange={(peak) => onChange({ ...entry, peak })} /></div>
          <div className={`${css.scheduleRow} ${scheduleInvalid ? css.invalid : ''}`}>
            <label className={css.scheduleField} htmlFor={`price-entry-${index}-hours`}>
              <span>{t('peakHours')}</span>
              <Input id={`price-entry-${index}-hours`} type="text" value={entry.peakHours} placeholder="9-12, 14-18" spellCheck={false} disabled={disabled} onChange={(event) => onChange({ ...entry, peakHours: event.currentTarget.value })} />
            </label>
            <label className={css.scheduleField} htmlFor={`price-entry-${index}-days`}>
              <span>{t('peakDays')}</span>
              <Input id={`price-entry-${index}-days`} type="text" value={entry.peakDays} placeholder="1,2,3,4,5" spellCheck={false} disabled={disabled} onChange={(event) => onChange({ ...entry, peakDays: event.currentTarget.value })} />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}


/** The full price table editor: model rows, each with an entry list. */
export function PriceTableEditor({ value, onChange, disabled, t }: {
  value: PriceTableDraft
  onChange: (next: PriceTableDraft) => void
  disabled: boolean
  t: (key: FinanceKey) => string
}) {
  const updateModel = (index: number, next: Partial<PriceModelDraft>): void => {
    onChange({ models: value.models.map((model, i) => (i === index ? { ...model, ...next } : model)) })
  }
  const updateEntry = (modelIndex: number, entryIndex: number, next: PriceEntryDraft): void => {
    updateModel(modelIndex, { entries: value.models[modelIndex].entries.map((e, i) => (i === entryIndex ? next : e)) })
  }
  return (
    <div className={css.editor}>
      {value.models.map((model, modelIndex) => (
        <div key={`${model.modelKey}-${modelIndex}`} className={css.modelBlock}>
          <div className={css.modelHead}>
            <Input
              className={css.modelKeyInput}
              type="text"
              value={model.modelKey}
              placeholder="openai/gpt-4o"
              spellCheck={false}
              disabled={disabled}
              aria-label={t('modelKeyColumn')}
              onChange={(event) => updateModel(modelIndex, { modelKey: event.currentTarget.value })}
            />
            <button type="button" className={css.remove} disabled={disabled} aria-label={`${t('removeModel')}: ${model.modelKey}`} onClick={() => onChange({ models: value.models.filter((_, i) => i !== modelIndex) })}>×</button>
          </div>
          {model.entries.map((entry, entryIndex) => (
            <PriceEntryEditor
              key={entryIndex}
              entry={entry}
              index={entryIndex}
              t={t}
              disabled={disabled}
              onChange={(next) => updateEntry(modelIndex, entryIndex, next)}
              onRemove={() => updateModel(modelIndex, { entries: model.entries.filter((_, i) => i !== entryIndex) })}
            />
          ))}
          <button
            type="button"
            className={css.addEntry}
            disabled={disabled}
            onClick={() => updateModel(modelIndex, { entries: [...model.entries, newPriceEntry('flat')] })}
          >
            {t('addPriceEntry')}
          </button>
        </div>
      ))}
      <button
        type="button"
        className={css.add}
        disabled={disabled}
        onClick={() => onChange({ models: [...value.models, { modelKey: '', entries: [] }] })}
      >
        {t('addModel')}
      </button>
    </div>
  )
}