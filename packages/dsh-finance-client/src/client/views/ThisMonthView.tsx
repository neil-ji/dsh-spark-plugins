/**
 * 视图①：本月值不值。
 *
 * 回答三件事：这个月花了多少（成本 / 按量 / 订阅等价）、钱在哪个模型上、
 * 余额还能撑多久。**没有订阅卡**——套餐定义属 P1，本视图不假装知道订阅省了多少。
 */

import type { ReactNode } from 'react'
import { Button, Card, Money, TrendChart, formatMicros } from 'dsh-ui-kit'
import type { FinanceLedger, FinanceListProvidersResult, FinanceProviderBalance } from 'dsh-spark-finance/types'
import {
  balanceDaysLeft,
  mixedUnitCostMicros,
  modelComparisonRows,
  providerDailyMicros,
} from '../derive.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface ThisMonthViewProps {
  ledger: FinanceLedger
  providerList: FinanceListProvidersResult | undefined
  t: FinanceTranslate
  refreshProvider: (provider: string) => Promise<void>
}

const TOP_MODEL_COUNT = 6

export function ThisMonthView({ ledger, providerList, t, refreshProvider }: ThisMonthViewProps): ReactNode {
  const trendPoints = ledger.byDay.map((row) => ({ key: row.day, label: row.day.slice(5), value: row.costMicros }))
  const topModels = modelComparisonRows(ledger)
    .filter((row) => row.unitCostMicros !== null)
    .sort((a, b) => (b.unitCostMicros as number) - (a.unitCostMicros as number))
    .slice(0, TOP_MODEL_COUNT)
  const rows = providerList?.providers ?? []

  return (
    <>
      <Card title={t('balanceTitle')} className={css.section}>
        <div className={css.table}>
          <div className={`${css.tableHead} ${css.colsBalance}`}>
            <span className={css.cell}>{t('colProvider')}</span>
            <span className={`${css.cell} ${css.cellNum}`}>{t('balanceTitle')}</span>
            <span className={css.cell} />
            <span className={css.cell} />
          </div>
          {rows.length === 0
            ? <p className={css.hint}>{t('noData')}</p>
            : rows.map((row) => (
              <div className={`${css.tableRow} ${css.colsBalance}`} key={row.provider} data-testid={`finance-balance-${row.provider}`}>
                <span className={`${css.cell} ${css.balanceName}`}>{row.provider}</span>
                <span className={`${css.cell} ${css.cellNum} ${css.balanceValue}`}>
                  {balanceValue(row.balance, ledger.currency, t)}
                </span>
                <span className={`${css.cell} ${css.balanceNote}`}>{balanceNote(row.provider, row.balance, ledger, t)}</span>
                <span className={css.cellNum}>
                  {row.hostMeta?.supportsBalanceFetch === true
                    ? (
                      <Button
                        onClick={() => { void refreshProvider(row.provider) }}
                        aria-label={`${t('balanceRefresh')}: ${row.provider}`}
                      >
                        {t('balanceRefresh')}
                      </Button>
                    )
                    : null}
                </span>
              </div>
            ))}
        </div>
      </Card>

      <Card
        title={t('trendTitle')}
        actions={<span className={css.tagMuted}>{t('trendRange', { days: ledger.byDay.length })}</span>}
        className={css.section}
      >
        {trendPoints.length === 0
          ? <p className={css.hint}>{t('noData')}</p>
          : (
            <TrendChart
              points={trendPoints}
              ariaLabel={t('trendTitle')}
              formatValue={formatMicros}
              gradientId="finance-trend"
            />
          )}
        <p className={css.hint}>{t('trendHint')}</p>
      </Card>

      <Card title={t('topModelsTitle')} className={css.section}>
        <div className={css.table}>
          <div className={`${css.tableHead} ${css.colsModels}`}>
            <span className={css.cell}>{t('colModel')}</span>
            <span className={css.cell}>{t('colProvider')}</span>
            <span className={`${css.cell} ${css.cellNum}`}>{t('colCost')}</span>
            <span className={`${css.cell} ${css.cellNum}`}>{t('colUnitCost')}</span>
          </div>
          {topModels.length === 0
            ? <p className={css.hint}>{t('noData')}</p>
            : topModels.map((row) => (
              <div className={`${css.tableRow} ${css.colsModels}`} key={row.modelKey}>
                <span className={`${css.cell} ${css.modelKey}`} title={row.modelKey}>{row.model}</span>
                <span className={css.cell}>{row.provider}</span>
                <span className={`${css.cell} ${css.cellNum}`}><Money micros={row.costMicros} currency={ledger.currency} /></span>
                <span className={`${css.cell} ${css.cellNum}`}>{row.unitCostMicros === null ? t('noData') : `${formatMicros(Math.round(row.unitCostMicros))}${t('perMtok')}`}</span>
              </div>
            ))}
        </div>
        <p className={css.hint}>{t('topModelsHint')}</p>
      </Card>
    </>
  )
}

function balanceValue(balance: FinanceProviderBalance, currency: string, t: FinanceTranslate): ReactNode {
  if (balance.status === 'ok' && balance.totalMicros !== undefined) {
    return <Money micros={balance.totalMicros} currency={balance.currency === undefined || balance.currency === '' ? currency : balance.currency} />
  }
  if (balance.status === 'missing-credential') return t('balanceMissingKey')
  if (balance.status === 'unsupported') return t('balanceUnsupported')
  return t('balanceError')
}

/** 余额那一行的说明列：能推算就说还能用几天（估算），不能就直说为什么不能。 */
function balanceNote(provider: string, balance: FinanceProviderBalance, ledger: FinanceLedger, t: FinanceTranslate): string {
  if (balance.status !== 'ok' || balance.totalMicros === undefined) {
    if (balance.code !== undefined) return balance.code
    return t('balanceDaysUnknown')
  }
  const daily = providerDailyMicros(ledger, provider)
  const days = balanceDaysLeft(balance.totalMicros, daily)
  if (days === null) return t('balanceDaysUnknown')
  const shown = days >= 10 ? days.toFixed(0) : days.toFixed(1)
  return `${t('balanceDaysLeft', { days: shown })} · ${t('estimateTag')}`
}
