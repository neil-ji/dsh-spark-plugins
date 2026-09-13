/**
 * 视图③：怎么调度更省。
 *
 * 两张可立刻行动卡：错峰执行、把缓存用起来。每个金额都标注「估算」并给出
 * 口径；没有可操作空间时直说没有，不硬凑一个数字。
 */

import type { ReactNode } from 'react'
import { BarChart, Card, CHART_PALETTE, Money, formatMicros } from 'dsh-ui-kit'
import type { FinanceLedger } from 'dsh-spark-finance/types'
import { cacheExtremes, estimateCacheSavings, formatPercent, modelComparisonRows, peakShare } from '../derive.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface SaveMoreViewProps {
  ledger: FinanceLedger
  t: FinanceTranslate
}

export function SaveMoreView({ ledger, t }: SaveMoreViewProps): ReactNode {
  const currency = ledger.currency === '' ? 'CNY' : ledger.currency
  const peak = ledger.peakValley
  const share = peakShare(ledger)
  const bands = [
    { key: 'peak', label: t('bandPeak'), value: peak.peakCostMicros },
    { key: 'offPeak', label: t('bandOffPeak'), value: peak.offPeakCostMicros },
    { key: 'flat', label: t('bandFlat'), value: peak.flatCostMicros },
    { key: 'legacy', label: t('bandLegacy'), value: peak.legacyCostMicros },
  ].filter((band) => band.value > 0)

  const rows = modelComparisonRows(ledger)
  const extremes = cacheExtremes(rows)
  const savings = estimateCacheSavings(rows)

  return (
    <>
      <Card title={t('peakCardTitle')} className={css.section}>
        {peak.shiftSavingsMicros > 0
          ? (
            <div className={css.amount}>
              <span className={css.amountValue} data-testid="finance-peak-savings">
                <Money micros={peak.shiftSavingsMicros} currency={currency} />
              </span>
              <span className={css.tag}>{t('estimateTag')}</span>
              {share === null ? null : <span className={css.tagMuted}>{t('peakShareLabel', { pct: formatPercent(share) })}</span>}
            </div>
          )
          : <p className={css.hint} data-testid="finance-peak-empty">{t('peakCardEmpty')}</p>}
        <p className={css.hint}>{t('peakCardHint')}</p>
        {bands.length === 0
          ? null
          : (
            <BarChart
              rows={bands.map((band, index) => ({ ...band, color: CHART_PALETTE[index % CHART_PALETTE.length] }))}
              ariaLabel={t('peakCardTitle')}
              formatValue={formatMicros}
            />
          )}
      </Card>

      <Card title={t('cacheCardTitle')} className={css.section}>
        {savings === null || extremes === null
          ? <p className={css.hint} data-testid="finance-cache-empty">{t('cacheCardEmpty')}</p>
          : (
            <>
              <div className={css.amount}>
                <span className={css.amountValue} data-testid="finance-cache-savings">
                  <Money micros={Math.round(savings.amountMicros)} currency={currency} />
                </span>
                <span className={css.tag}>{t('estimateTag')}</span>
                <span className={css.tagMuted}>{t('cacheSavingsFrom', { from: savings.from.provider, to: savings.to.provider })}</span>
              </div>
              <p className={css.hint}>{t('cacheSavingsLabel', { amount: formatMicros(Math.round(savings.amountMicros)) })}</p>
              <div className={css.pillRow}>
                <span className={css.tagMuted}>{t('cacheBestLabel', { provider: extremes.best.provider, pct: formatPercent(extremes.best.hitRate) })}</span>
                <span className={css.tagMuted}>{t('cacheWorstLabel', { provider: extremes.worst.provider, pct: formatPercent(extremes.worst.hitRate) })}</span>
              </div>
              <p className={css.hint}>{t('cacheSavingsNote')}</p>
            </>
          )}
      </Card>
    </>
  )
}
