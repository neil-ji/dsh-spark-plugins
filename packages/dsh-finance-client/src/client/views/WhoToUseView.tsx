/**
 * 视图②：该用谁。
 *
 * 只列用户**实际用过**的模型（ledger.byModel），同一个模型跨供应商并列，按
 * 实际混合单位成本比大小；列里再给出**缓存命中率**与**输出吞吐**（观测值）。
 * 展开行的"时间成本"是估算：把慢那家实际产出的 token 量按快那家实测速率折算。
 * 旧会话没有速率投影——那一格显示 `—`，不显示 0。
 */

import { useState, type ReactNode } from 'react'
import { Button, Card, EmptyState, Money, Pill, formatMicros } from 'dsh-ui-kit'
import type { FinanceLedger } from 'dsh-spark-finance/types'
import {
  cheapestInGroup,
  firstTokenMs,
  formatMs,
  formatPercent,
  formatSpeed,
  groupByModel,
  modelComparisonRows,
  outputTokensPerSecond,
  speedComparison,
} from '../derive.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface WhoToUseViewProps {
  ledger: FinanceLedger
  t: FinanceTranslate
}

export function WhoToUseView({ ledger, t }: WhoToUseViewProps): ReactNode {
  const [openModel, setOpenModel] = useState<string | null>(null)
  const groups = groupByModel(modelComparisonRows(ledger))
  const currency = ledger.currency === '' ? 'CNY' : ledger.currency

  if (groups.length === 0) {
    return (
      <div data-testid="finance-who-empty">
        <EmptyState message={t('whoEmptyTitle')} hint={t('whoEmptyHint')} />
      </div>
    )
  }

  return (
    <Card title={t('whoTitle')} className={css.section}>
      <div className={css.table}>
        <div className={`${css.tableHead} ${css.colsCompare}`}>
          <span className={css.cell}>{t('colProvider')}</span>
          <span className={`${css.cell} ${css.cellNum}`}>{t('colCost')}</span>
          <span className={`${css.cell} ${css.cellNum}`}>{t('colUnitCost')}</span>
          <span className={`${css.cell} ${css.cellNum}`} title={t('hitRateHint')}>{t('colHitRate')}</span>
          <span className={`${css.cell} ${css.cellNum}`}>{t('colSpeed')}</span>
        </div>
        {groups.map((group) => {
          const best = cheapestInGroup(group.rows)
          const open = openModel === group.model
          const speed = speedComparison(group.rows)
          return (
            <div className={css.group} key={group.model} data-testid={`finance-model-${group.model}`}>
              <div className={css.groupHead}>
                <span className={`${css.groupTitle} ${css.modelKey}`} title={group.model}>{group.model}</span>
                {best === null
                  ? <Pill accentColor="var(--spk-label-3)">{group.rows.length < 2 ? t('whoSingle') : t('whoNoVerdict')}</Pill>
                  : <Pill accentColor="var(--spk-acc-finance-fg)">{t('whoBest')} · {best.provider}</Pill>}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={open}
                  aria-label={`${t('detailToggle')}: ${group.model}`}
                  onClick={() => setOpenModel(open ? null : group.model)}
                >
                  {t('detailToggle')}
                </Button>
              </div>
              {/* 时间成本放在组头下面常显：慢多少分钟比"谁快"更值得一眼看到。 */}
              {speed === null
                ? null
                : (
                  <p className={css.detailText} data-testid="finance-time-compare" title={t('timeCompareNote')}>
                    {t('timeCompareSaved', {
                      fast: speed.fastest.provider,
                      slow: speed.slowest.provider,
                      tokens: speed.tokens,
                      minutes: speed.atFastestMinutes.toFixed(1),
                      saved: speed.savedMinutes.toFixed(1),
                    })}
                    {' '}<span className={css.estimate}>{t('estimateTag')}</span>
                  </p>
                )}
              {group.rows.map((row) => {
                const speedValue = outputTokensPerSecond(row.rate)
                return (
                  <div className={`${css.tableRow} ${css.colsCompare}`} key={`${group.model}:${row.provider}`}>
                    <span className={css.cell}>{row.provider}</span>
                    <span className={`${css.cell} ${css.cellNum}`}><Money micros={row.costMicros} currency={currency} exact /></span>
                    <span className={`${css.cell} ${css.cellNum}`}>
                      {row.unitCostMicros === null ? t('noData') : (<><Money micros={Math.round(row.unitCostMicros)} currency={currency} />{t('perMtok')}</>)}
                    </span>
                    <span className={`${css.cell} ${css.cellNum}`}>{formatPercent(row.hitRate)}</span>
                    <span className={`${css.cell} ${css.cellNum}`} data-testid={`finance-speed-${row.provider}`}>
                      {speedValue === null ? '—' : `${formatSpeed(speedValue)}${t('perSecond')}`}
                    </span>
                  </div>
                )
              })}
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
                        })} · {t('ttftLabel', { ms: formatMs(firstTokenMs(row.rate)) })}
                      </p>
                    ))}
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
