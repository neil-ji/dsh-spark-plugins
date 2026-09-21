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

import type { CSSProperties, ReactNode } from 'react'
import { Card, Disclosure, EmptyState, Money, Pill } from 'dsh-ui-kit'
import type { FinanceLedger } from 'dsh-spark-finance/types'
import {
  cheapestInGroup,
  compareMetricRows,
  formatGapRatio,
  formatMs,
  formatPercent,
  formatSpeed,
  formatTokens,
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
  if (metric === 'input') return t('compareMetricInput')
  if (metric === 'cacheRead') return t('compareMetricCacheRead')
  if (metric === 'cacheWrite') return t('compareMetricCacheWrite')
  if (metric === 'output') return t('compareMetricOutput')
  return t('compareMetricCost')
}

/**
 * 组头副标题 = **在用的供应商名单**。
 *
 * 折叠态下组头是唯一可见的信息，而"这个模型我在哪几家用过"正是决定要不要展开的依据
 * （名单本身要展开后才会在表头出现）。刻意**不**写成"N 家供应商在用"：那是数量而非身份，
 * 且与右侧「更省 · X」pill 的结论重复；单供应商时"1 家在用"更接近废话
 * （2026-09-20 已退役过同类表述）。
 */
function groupSummary(rows: readonly ModelComparisonRow[]): string {
  return rows.map((row) => row.provider).join(' · ')
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
  if (metric === 'ttft') return formatMs(cell.value)
  // 四个 token 桶（明细行）：紧凑计数，与别处的 token 展示同口径。
  return formatTokens(cell.value)
}

export function WhoToUseView({ ledger, t }: WhoToUseViewProps): ReactNode {
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
      {/* 手风琴（2026-09-21 用户裁决）：接入的模型一多，"每个模型一坨、全展开平铺"
          就读不动了 —— 改成每个模型组一个可折叠项，**默认只展开首项**。
          首项 = `groupByModel` 排在最前的那个（组内成本降序、组间按总成本降序）=
          本月花钱最多的模型，是用户最可能先看的那一个。

          手风琴本身已经起到内容分割作用 → **移除原先的嵌套 inset Card**
          （用户明确要求）。表头 + 指标行直接落在折叠体里，不再多套一层卡。 */}
      <div className={css.accordion}>
        {groups.map((group, index) => {
          const best = cheapestInGroup(group.rows)
          const speed = speedComparison(group.rows)
          const metrics = compareMetricRows(group.rows)
          return (
            // 外层 div 保留 `data-testid="finance-model-{model}"`（既有断言与 harness 的选择器）。
            // `Disclosure` 目前不透传 rest 属性（与 Pill 同类），所以 testid 挂在包裹层上，
            // 而不是去改 ui-kit 的组件契约。
            <div key={group.model} className={css.accordionItem} data-testid={`finance-model-${group.model}`}>
            <Disclosure
              defaultOpen={index === 0}
              name={<span className={`${css.groupTitle} ${css.modelKey}`} title={group.model}>{group.model}</span>}
              description={groupSummary(group.rows)}
              trailing={best === null ? undefined : <Pill accentColor="var(--spk-acc-finance-fg)">{t('whoBest')} · {best.provider}</Pill>}
            >
              {/* 时间成本放在折叠体内首行常显：慢多少分钟比"谁快"更值得一眼看到。 */}
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
              {/* 转置表：行 = 指标、列 = 供应商。列宽由供应商数量决定（--compare-cols）。 */}
              <div
                className={css.compareGrid}
                style={{ '--compare-cols': String(group.rows.length) } as CSSProperties}
                data-testid={`finance-compare-${group.model}`}
              >
                {/* 表头行：左上角是指标列的列头（此前留空，见 2026-09-20 复核），
                    其余是供应商名。表头与数据行共用同一套 grid（列宽才不会错位）。 */}
                <div className={css.compareRow} data-testid="finance-compare-head">
                  <span className={css.compareColHead}>{t('compareColProvider')}</span>
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
            </Disclosure>
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