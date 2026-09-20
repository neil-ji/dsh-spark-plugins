/**
 * 视图②：该用谁。
 *
 * 只列用户**实际用过**的模型（ledger.byModel），同一个模型跨供应商并列比较。
 *
 * 2026-09-20 转置：**行 = 指标，列 = 供应商**（原为行=供应商、列=指标）。
 * 动机（用户原话）：*"每一行是一个可横向对比的指标，每一列是一个供应商，这样所有
 * 可量化指标都可以垂直增加行，空间利用更合理，且跨列之间同指标对比更加易读，
 * 每一行取最优值，将同行其余值百分化，用户一眼看出相差百分之多少。"*
 *
 * 于是：每行取最优（单位成本/首 token 延迟取最小；命中率/输出速率取最大），
 * 同行其余格给出**与最优的有符号相对差**（`+12.7%` / `−8.1%`）。
 * 总成本刻意标为 neutral —— 它由用量规模决定，不参与最优判定（见 derive 注释）。
 *
 * 展开行的"时间成本"仍是估算：把慢那家实际产出的 token 量按快那家实测速率折算。
 * 旧会话没有速率投影 —— 那一格显示 `—`，不显示 0。
 */

import { useState, type CSSProperties, type ReactNode } from 'react'
import { Button, Card, EmptyState, Money, Pill } from 'dsh-ui-kit'
import type { FinanceLedger } from 'dsh-spark-finance/types'
import {
  cheapestInGroup,
  compareMetricRows,
  firstTokenMs,
  formatGapRatio,
  formatMs,
  formatPercent,
  formatSpeed,
  groupByModel,
  modelComparisonRows,
  speedComparison,
} from '../derive.ts'
import type { CompareMetricCell, CompareMetricKey, CompareMetricRow, ModelComparisonRow } from '../derive.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface WhoToUseViewProps {
  ledger: FinanceLedger
  t: FinanceTranslate
}

/** 指标行标题取词。 */
function metricLabel(metric: CompareMetricKey, t: FinanceTranslate): string {
  if (metric === 'unitCost') return t('compareMetricUnitCost')
  if (metric === 'hitRate') return t('compareMetricHitRate')
  if (metric === 'speed') return t('compareMetricSpeed')
  if (metric === 'ttft') return t('compareMetricTtft')
  return t('compareMetricCost')
}

/**
 * 一格的值文本。各指标的量纲与格式都不同，集中在这里（口径与列头同源）。
 * @param cell - 该格的派生结果（值为 null 时显示「—」而不是 0）。
 * @param row - 对应供应商行（取 cost 等原始值）。
 */
function metricCellValue(
  metric: CompareMetricKey,
  cell: CompareMetricCell,
  row: ModelComparisonRow,
  currency: string,
  t: FinanceTranslate,
): ReactNode {
  if (metric === 'cost') return <Money micros={row.costMicros} currency={currency} exact />
  if (cell.value === null) return '—'
  if (metric === 'unitCost') {
    return <><Money micros={Math.round(cell.value)} currency={currency} size="sm" />{t('perMtok')}</>
  }
  if (metric === 'hitRate') return formatPercent(cell.value)
  if (metric === 'speed') return `${formatSpeed(cell.value)}${t('perSecond')}`
  return formatMs(cell.value)
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
        {groups.map((group) => {
          const best = cheapestInGroup(group.rows)
          const open = openModel === group.model
          const speed = speedComparison(group.rows)
          const metrics = compareMetricRows(group.rows)
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
              {/* 转置表：行 = 指标、列 = 供应商。列宽由供应商数量决定（--compare-cols）。
                  组头（模型名 + 结论）与表格是两类内容 → 表格包一层 inset 子卡。 */}
              <Card variant="inset">
              <div
                className={css.compareGrid}
                style={{ '--compare-cols': String(group.rows.length) } as CSSProperties}
                data-testid={`finance-compare-${group.model}`}
              >
                <div className={css.compareRow}>
                  <span className={css.compareMetricLabel} />
                  {group.rows.map((row) => (
                    <span key={`head:${row.provider}`} className={css.compareProvider}>{row.provider}</span>
                  ))}
                </div>
                {metrics.map((metric) => (
                  <CompareMetricRowView
                    key={metric.metric}
                    metric={metric}
                    rows={group.rows}
                    currency={currency}
                    t={t}
                  />
                ))}
              </div>
              </Card>
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

/** 一行指标：左侧指标名 + 每列一格（最优标记 + 相对差）。 */
function CompareMetricRowView({ metric, rows, currency, t }: {
  metric: CompareMetricRow
  rows: readonly ModelComparisonRow[]
  currency: string
  t: FinanceTranslate
}): ReactNode {
  return (
    <div className={css.compareRow} data-testid={`finance-compare-row-${metric.metric}`}>
      <span className={css.compareMetricLabel} title={metric.metric === 'hitRate' ? t('hitRateHint') : undefined}>
        {metricLabel(metric.metric, t)}
      </span>
      {metric.cells.map((cell, index) => {
        const row = rows[index]
        return (
          <span key={`${metric.metric}:${cell.provider}`} className={css.compareCell}>
            <span className={css.compareValue}>{metricCellValue(metric.metric, cell, row, currency, t)}</span>
            {cell.best ? <Pill tone="success" className={css.compareBest}>{t('compareBestTag')}</Pill> : null}
            {/* 相对差只在判出最优且该格不是最优时出现（最优格标「最优」即可，不再报 +0.0%）。 */}
            {metric.hasBest && !cell.best && cell.gapRatio !== null
              ? <span className={css.compareGap} title={t('compareGapHint')}>{formatGapRatio(cell.gapRatio)}</span>
              : null}
          </span>
        )
      })}
    </div>
  )
}