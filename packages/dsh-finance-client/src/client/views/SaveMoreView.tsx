/**
 * 视图③：怎么调度更省。
 *
 * 两张可立刻行动卡：错峰执行、把缓存用起来。每个金额都标注「估算」并给出
 * 口径；没有可操作空间时直说没有，不硬凑一个数字。
 */

import type { ReactNode } from 'react'
import { Card, Money, StackedBar, formatMicros } from 'dsh-ui-kit'
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
  /**
   * 被 releaseBase 取代的手填 tiers 键（INV-1）。可选：旧夹具不必补该字段。
   * 有值时必须说出来 —— 用户填的价没生效属于"必须可解释"，不能静默。
   */
  shadowedTierKeys?: readonly string[]
  t: FinanceTranslate
}

/** "界外"的参考上界：与常见阶梯阈值 128k 对齐（只用于分布展示）。 */
const CONTEXT_SHARE_CEILING = 128_000

/**
 * 非 ok 的取数结果 → 文案，**只对"必须给原因"的异常返回字符串**。
 *
 * 分界（2026-09-20 口径）：
 *  - **异常必须解释**（否则是静默失败）：币种不匹配 / 不在生效窗口 / 多套区域价目
 *    无法判断线路 —— 这些情况下"没有数字"本身会让人以为插件坏了，必须给原因。
 *  - **纯空态不解释**：没填阶梯价、该档没有用量 → 直接「—」，不在单元格里写散文。
 *
 * @returns 需要展示的异常原因；纯空态返回 null（调用点渲染「—」）。
 */
function contextOutcomeText(outcome: SplitEstimateOutcome, t: FinanceTranslate): string | null {
  switch (outcome.status) {
    case 'currency-mismatch':
      return t('contextCurrencyMismatch', { currency: outcome.tierCurrency })
    case 'era-mismatch':
      return t('contextEraMismatch')
    case 'ambiguous':
      // 同一模型有多套区域价目，而运行期拿不到"在用哪条线路"的信号（暂不区分国际/国内）。
      return t('contextAmbiguousTiers', { keys: outcome.keys.join('、') })
    case 'no-tiers':
    case 'no-usage':
      // 纯空态：无可省金额即无可说，列头悬浮已给出口径。
      return null
    case 'ok':
      // 调用点只在非 ok 时调这里；显式列全是为了让新增状态编译期报错。
      return null
  }
}

export function SaveMoreView({ ledger, tiers, shadowedTierKeys = [], t }: SaveMoreViewProps): ReactNode {
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
        {/* 空态不再写"你的价目表没有峰谷窗口，或近期没有高峰时段用量"——
            没有可省金额时就不摆金额，也不解释为什么（提示性文案只在异常且必须给原因时出现）。 */}
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
          : null}
        {bands.length === 0
          ? null
          : (
            /* 100% 堆叠条：条本体占满卡片宽度，各档宽度即真实占比。
               不用 BarChart —— 它按 niceCeil 归一，实测最大档只占 ~52%，看构成是错的信号。 */
            <StackedBar
              rows={bands}
              ariaLabel={t('peakCardTitle')}
              formatValue={formatMicros}
            />
          )}
      </Card>

      <Card title={t('cacheCardTitle')} className={css.section}>
        {/* 无可操作空间时不解释（原"命中率差不足 2 个百分点…"已移除）。 */}
        {savings === null || extremes === null
          ? null
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
        {/* INV-1：官方表（releaseBase）是唯一结构源。用户手填的同名键会被它取代 —— 
            这种事必须说出来，否则"我填的价没生效"就是静默失败。 */}
        {shadowedTierKeys.length === 0
          ? null
          : (
            <p className={css.hint} data-testid="finance-context-shadowed">
              {t('contextShadowedTiers', { keys: shadowedTierKeys.join('、') })}
            </p>
          )}
        {contextRows.length === 0
          ? null
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
                        : (() => {
                          const reason = contextOutcomeText(outcome, t)
                          // 异常给原因；纯空态给「—」。
                          return <span className={reason === null ? css.tagMuted : css.hint}>{reason ?? '—'}</span>
                        })()}
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
