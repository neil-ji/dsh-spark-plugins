/**
 * 视图③：怎么调度更省。
 *
 * 两张可立刻行动卡：错峰执行、把缓存用起来。每个金额都标注「估算」并给出
 * 口径；没有可操作空间时直说没有，不硬凑一个数字。
 */

import type { ReactNode } from 'react'
import { BarChart, Card, CHART_PALETTE, Money, formatMicros } from 'dsh-ui-kit'
import type { FinanceLedger, FinanceTierEntry } from 'dsh-spark-finance/types'
import {
  cacheExtremes,
  contextProfile,
  estimateCacheSavings,
  formatPercent,
  modelComparisonRows,
  peakShare,
  splitEstimate,
} from '../derive.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface SaveMoreViewProps {
  ledger: FinanceLedger
  /** context 阶梯价（按 modelKey）；空 = 该模型没有阶梯价，拆分不改变单价。 */
  tiers: Record<string, readonly FinanceTierEntry[]>
  t: FinanceTranslate
}

/** "界外"的参考上界：与常见阶梯阈值 128k 对齐（只用于分布展示）。 */
const CONTEXT_SHARE_CEILING = 128_000

export function SaveMoreView({ ledger, tiers, t }: SaveMoreViewProps): ReactNode {
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
  const contextRows = rows.filter((row) => row.context !== undefined)

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

      <Card title={t('contextCardTitle')} className={css.section}>
        <p className={css.hint}>{t('contextCardHint')}</p>
        {contextRows.length === 0
          ? <p className={css.hint} data-testid="finance-context-empty">{t('contextNoData')}</p>
          : (
            <div className={css.table} data-testid="finance-context-card">
              <div className={`${css.tableHead} ${css.colsModels}`}>
                <span className={css.cell}>{t('colModel')}</span>
                <span className={css.cell}>{t('colProvider')}</span>
                <span className={css.cell}>{t('colContextShare')}</span>
                <span className={css.cell}>{t('colSavingUpper')}</span>
              </div>
              {contextRows.map((row) => {
                const buckets = row.context ?? []
                const modelTiers = tiers[row.modelKey] ?? []
                const profile = contextProfile(buckets, CONTEXT_SHARE_CEILING)
                const estimate = splitEstimate(buckets, modelTiers)
                return (
                  <div className={`${css.tableRow} ${css.colsModels}`} key={`context:${row.modelKey}`} data-testid={`finance-context-${row.modelKey}`}>
                    <span className={`${css.cell} ${css.modelKey}`} title={row.modelKey}>{row.model}</span>
                    <span className={css.cell}>{row.provider}</span>
                    <span className={css.cell}>{t('contextAboveShare', { pct: formatPercent(profile.shareAbove) })}</span>
                    <span className={css.cell}>
                      {estimate === null
                        ? (modelTiers.length === 0 ? t('contextNoTiers') : t('contextNoUsage'))
                        : `${t('contextSavedUpper', { amount: formatMicros(Math.round(estimate.savedMicros)) })} · ${t('estimateTag')}`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        <p className={css.hint}>{t('contextNote')}</p>
      </Card>
    </>
  )
}
