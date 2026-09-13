/**
 * 视图②：该用谁。
 *
 * 只列用户**实际用过**的模型（ledger.byModel），同一个模型跨供应商并列时按
 * 实际混合单位成本比大小；缓存命中率是观测值，不估算。
 */

import { useState, type ReactNode } from 'react'
import { Card, EmptyState, Money, Pill, formatMicros } from 'dsh-ui-kit'
import type { FinanceLedger } from 'dsh-spark-finance/types'
import { cheapestInGroup, formatPercent, groupByModel, mixedUnitCostMicros } from '../derive.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface WhoToUseViewProps {
  ledger: FinanceLedger
  t: FinanceTranslate
}

export function WhoToUseView({ ledger, t }: WhoToUseViewProps): ReactNode {
  const [openModel, setOpenModel] = useState<string | null>(null)
  const groups = groupByModel(
    ledger.byModel.map((row) => ({
      modelKey: row.modelKey,
      provider: row.provider,
      model: row.model,
      costMicros: row.costMicros,
      usage: row.usage,
      hitRate: null,
      unitCostMicros: mixedUnitCostMicros(row.costMicros, row.usage),
      billingMode: row.billingMode,
    })).map((row) => ({ ...row, hitRate: hitRateOf(row.provider, ledger) })),
  )

  if (groups.length === 0) {
    return (
      <div data-testid="finance-who-empty">
        <EmptyState message={t('whoEmptyTitle')} hint={t('whoEmptyHint')} />
      </div>
    )
  }

  return (
    <Card title={t('whoTitle')} className={css.section}>
      <p className={css.hint}>{t('whoHint')}</p>
      <div className={css.table}>
        <div className={`${css.tableHead} ${css.colsModels}`}>
          <span className={css.cell}>{t('colProvider')}</span>
          <span className={`${css.cell} ${css.cellNum}`}>{t('colCost')}</span>
          <span className={`${css.cell} ${css.cellNum}`}>{t('colUnitCost')}</span>
          <span className={`${css.cell} ${css.cellNum}`}>{t('colHitRate')}</span>
        </div>
        {groups.map((group) => {
          const best = cheapestInGroup(group.rows)
          const open = openModel === group.modelKey
          return (
            <div className={css.group} key={group.modelKey} data-testid={`finance-model-${group.modelKey}`}>
              <div className={css.groupHead}>
                <span className={`${css.groupTitle} ${css.modelKey}`} title={group.modelKey}>{group.modelKey}</span>
                {best === null
                  ? <Pill accentColor="var(--spk-label-3)">{group.rows.length < 2 ? t('whoSingle') : t('whoNoVerdict')}</Pill>
                  : <Pill accentColor="var(--spk-acc-finance-fg)">{t('whoBest')}: {best.provider}</Pill>}
                <button
                  type="button"
                  className={css.tagMuted}
                  aria-expanded={open}
                  aria-label={`${t('detailToggle')}: ${group.modelKey}`}
                  onClick={() => setOpenModel(open ? null : group.modelKey)}
                >
                  {t('detailToggle')}
                </button>
              </div>
              {group.rows.map((row) => (
                <div className={`${css.tableRow} ${css.colsModels}`} key={`${group.modelKey}:${row.provider}`}>
                  <span className={css.cell}>{row.provider}</span>
                  <span className={`${css.cell} ${css.cellNum}`}><Money micros={row.costMicros} currency={ledger.currency} /></span>
                  <span className={`${css.cell} ${css.cellNum}`}>
                    {row.unitCostMicros === null ? t('noData') : `${formatMicros(Math.round(row.unitCostMicros))}/`}
                  </span>
                  <span className={`${css.cell} ${css.cellNum}`}>{formatPercent(row.hitRate)}</span>
                </div>
              ))}
              {open
                ? (
                  <div className={css.detail}>
                    {group.rows.map((row) => (
                      <p className={css.detailText} key={`detail:${row.provider}`}>
                        {row.provider} · {t('detailBuckets', {
                          input: row.usage.uncachedInputTokens,
                          cacheRead: row.usage.cacheReadTokens,
                          cacheWrite: row.usage.cacheWriteTokens,
                          output: row.usage.outputTokens,
                        })}
                      </p>
                    ))}
                    <p className={css.detailText}>{t('hitRateHint')}</p>
                  </div>
                )
                : null}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/** 该 provider 的整体命中率（账本没有逐模型逐 provider 命中率时用它的 provider 汇总）。 */
function hitRateOf(provider: string, ledger: FinanceLedger): number | null {
  const row = ledger.byProvider.find((candidate) => candidate.provider === provider)
  if (row === undefined) return null
  const denominator = row.usage.uncachedInputTokens + row.usage.cacheReadTokens + row.usage.cacheWriteTokens
  return denominator <= 0 ? null : row.usage.cacheReadTokens / denominator
}
