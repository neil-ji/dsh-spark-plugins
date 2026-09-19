/**
 * 视图③：怎么调度更省。
 *
 * 两张可立刻行动卡：错峰执行、把缓存用起来。每个金额都标注「估算」并给出
 * 口径；没有可操作空间时直说没有，不硬凑一个数字。
 */

import type { ReactNode } from 'react'
import { BarChart, Card, CHART_PALETTE, Money, formatMicros } from 'dsh-ui-kit'
import type { FinanceLedger, FinanceTierGroup } from 'dsh-spark-finance/types'
import {
  cacheExtremes,
  contextProfile,
  estimateCacheSavings,
  formatPercent,
  modelComparisonRows,
  peakShare,
  splitEstimateForModel,
} from '../derive.ts'
import type { SplitEstimateOutcome } from '../derive.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface SaveMoreViewProps {
  ledger: FinanceLedger
  /** context 阶梯价分组（按剥净后缀的 modelKey）；空 = 该模型没有阶梯价，拆分不改变单价。 */
  tiers: Record<string, readonly FinanceTierGroup[]>
  t: FinanceTranslate
}

/** "界外"的参考上界：与常见阶梯阈值 128k 对齐（只用于分布展示）。 */
const CONTEXT_SHARE_CEILING = 128_000

/** 非 ok 的取数结果 → 文案。四个状态各有各的说法，别合并成"暂无数据"。 */
function contextOutcomeText(outcome: SplitEstimateOutcome, t: FinanceTranslate): string {
  switch (outcome.status) {
    case 'currency-mismatch':
      return t('contextCurrencyMismatch', { currency: outcome.tierCurrency })
    case 'era-mismatch':
      return t('contextEraMismatch')
    case 'no-tiers':
      return t('contextNoTiers')
    case 'no-usage':
      return t('contextNoUsage')
    case 'ok':
      // 调用点只在非 ok 时调这里；显式列全是为了让新增状态编译期报错。
      return t('noData')
  }
}

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
            <div className={css.amount} title={t('peakCardHint')}>
              <span className={css.amountValue} data-testid="finance-peak-savings">
                <Money micros={peak.shiftSavingsMicros} currency={currency} />
              </span>
              <span className={css.estimate}>{t('estimateTag')}</span>
              {share === null ? null : <span className={css.tagMuted}>{t('peakShareLabel', { pct: formatPercent(share) })}</span>}
            </div>
          )
          : <p className={css.hint} data-testid="finance-peak-empty">{t('peakCardEmpty')}</p>}
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
              <div className={css.amount} title={t('cacheSavingsNote')}>
                <span className={css.amountValue} data-testid="finance-cache-savings">
                  <Money micros={Math.round(savings.amountMicros)} currency={currency} />
                </span>
                <span className={css.estimate}>{t('estimateTag')}</span>
                <span className={css.tagMuted}>{t('cacheSavingsFrom', { from: savings.from.provider, to: savings.to.provider })}</span>
              </div>
              <div className={css.pillRow}>
                <span className={css.tagMuted}>{t('cacheBestLabel', { provider: extremes.best.provider, pct: formatPercent(extremes.best.hitRate) })}</span>
                <span className={css.tagMuted}>{t('cacheWorstLabel', { provider: extremes.worst.provider, pct: formatPercent(extremes.worst.hitRate) })}</span>
              </div>
            </>
          )}
      </Card>

      <Card title={t('contextCardTitle')} className={css.section}>
        {contextRows.length === 0
          ? <p className={css.hint} data-testid="finance-context-empty">{t('contextNoData')}</p>
          : (
            <div className={css.table} data-testid="finance-context-card">
              <div className={`${css.tableHead} ${css.colsContext}`}>
                <span className={css.cell}>{t('colModel')}</span>
                <span className={css.cell} title={t('contextCardHint')}>{t('colContextShare')}</span>
                <span className={css.cell} title={t('contextNote')}>{t('colSavingUpper')}</span>
              </div>
              {contextRows.map((row) => {
                const buckets = row.context ?? []
                const profile = contextProfile(buckets, CONTEXT_SHARE_CEILING)
                // 选组 + 币种/生效窗口守卫 + 错峰折扣都在 derive 里（可单测），
                // 视图只负责把 status 翻成文案。
                const outcome = splitEstimateForModel(buckets, tiers, row.modelKey, ledger.currency, ledger.generatedAt)
                return (
                  <div className={`${css.tableRow} ${css.colsContext}`} key={`context:${row.modelKey}`} data-testid={`finance-context-${row.modelKey}`}>
                    {/* 模型 + 厂商合并为一列 provider/model：可换行、两行截断、悬浮全文。 */}
                    <span className={`${css.cell} ${css.modelKey} ${css.clamp2}`} title={`${row.provider}/${row.model}`}>
                      {row.provider}/{row.model}
                    </span>
                    <span className={`${css.cell} ${css.cellWrap}`}>{t('contextAboveShare', { pct: formatPercent(profile.shareAbove) })}</span>
                    <span className={`${css.cell} ${css.cellWrap}`} data-testid={`finance-context-cost-${row.modelKey}`}>
                      {outcome.status === 'ok'
                        ? (
                          <span className={css.tagMuted}>
                            {formatMicros(Math.round(outcome.estimate.savedMicros))} · <span className={css.estimate}>{t('estimateTag')}</span>
                            {outcome.estimate.discountApplied === 1 ? null : (
                              <span data-testid={`finance-context-discount-${row.modelKey}`}>
                                {' · '}{t('contextOffPeakApplied', { pct: formatPercent(outcome.estimate.discountApplied) })}
                              </span>
                            )}
                          </span>
                        )
                        : <span className={css.hint}>{contextOutcomeText(outcome, t)}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
      </Card>
    </>
  )
}
