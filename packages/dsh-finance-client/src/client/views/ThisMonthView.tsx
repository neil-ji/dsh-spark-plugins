/**
 * 视图①：本月值不值（子导航的第一个 tab）。
 *
 * 这个 tab 拥有整页的钱：更新时间与刷新、五个总量数字、订阅 vs 按量、余额、
 * 成本趋势、单位成本榜与两条脚注（价格来源 / 估算口径）。没有会话时只留
 * 「数字 + 为什么是 0」的引导，不摆一堆空卡。
 */

import { useState, type ReactNode } from 'react'
import { Button, Card, EmptyState, Input, Money, SegmentedControl, Stat, StatGrid, TrendChart, formatMicros } from 'dsh-ui-kit'
import type {
  FinanceLedger,
  FinanceListProvidersResult,
  FinancePlanEntry,
  FinancePlanPeriod,
  FinancePriceTableStatus,
  FinanceProviderBalance,
} from 'dsh-spark-finance/types'
import {
  balanceDaysLeft,
  mixedUnitCostMicros,
  modelComparisonRows,
  planRows,
  providerDailyMicros,
} from '../derive.ts'
import { FINANCE_PLAN_PERIODS, majorToMicros, microsToMajor } from '../plans.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface ThisMonthViewProps {
  ledger: FinanceLedger
  providerList: FinanceListProvidersResult | undefined
  t: FinanceTranslate
  refreshProvider: (provider: string) => Promise<void>
  plans: readonly FinancePlanEntry[]
  plansWritable: boolean
  savePlan: (plan: FinancePlanEntry) => Promise<void>
  removePlan: (provider: string) => Promise<void>
  refreshing: boolean
  onRefresh: () => void
  lastSyncAppliedAt: number | undefined
  /** 价格表状态：基础快照完整性/来源 + 覆盖层 + 被形状守卫拒绝的键。 */
  priceTable: FinancePriceTableStatus | undefined
  /** 价格表操作进行中（更新 / 还原）。 */
  priceBusy: boolean | undefined
  /** 价格表操作失败信息。 */
  priceError: string | null | undefined
  onUpdatePrices: () => Promise<void>
  onRestorePrices: () => Promise<void>
}

const TOP_MODEL_COUNT = 6
const cx = (...names: string[]): string => names.join(' ')

export function ThisMonthView({
  ledger,
  providerList,
  t,
  refreshProvider,
  plans,
  plansWritable,
  savePlan,
  removePlan,
  refreshing,
  onRefresh,
  lastSyncAppliedAt,
  priceTable,
  priceBusy,
  priceError,
  onUpdatePrices,
  onRestorePrices,
}: ThisMonthViewProps): ReactNode {
  const currency = ledger.currency === '' ? 'CNY' : ledger.currency
  const [editing, setEditing] = useState<string | null>(null)
  const trendPoints = ledger.byDay.map((row) => ({ key: row.day, label: row.day.slice(5), value: row.costMicros }))
  const topModels = modelComparisonRows(ledger)
    .filter((row) => row.unitCostMicros !== null)
    .sort((a, b) => (b.unitCostMicros as number) - (a.unitCostMicros as number))
    .slice(0, TOP_MODEL_COUNT)
  const balanceRows = providerList?.providers ?? []
  const { withPlan, withoutPlan } = planRows(ledger, plans)
  const planByProvider = new Map(withPlan.map((insight) => [insight.provider, insight]))
  const planEntries = [...plans]
  const orderedProviders = [...withPlan.map((insight) => insight.provider), ...withoutPlan]
  const empty = ledger.sessionCount === 0

  return (
    <>
      <div className={css.toolbar}>
        <span className={css.toolbarMeta} data-testid="finance-updated">
          {ledger.generatedAt > 0 ? t('lastUpdated', { minutes: minutesSince(ledger.generatedAt) }) : t('lastUpdatedNever')}
        </span>
        <Button onClick={onRefresh} disabled={refreshing} aria-label={t('refresh')}>
          {refreshing ? t('refreshing') : t('refresh')}
        </Button>
      </div>

      <StatGrid className={css.stats}>
        <div data-testid="finance-stat-cost">
          <Stat label={t('metricCost')} value={<Money micros={ledger.totalCostMicros} currency={currency} />} />
        </div>
        <div data-testid="finance-stat-metered">
          <Stat
            label={t('metricMetered')}
            value={ledger.meteredCostMicros === undefined ? t('noData') : <Money micros={ledger.meteredCostMicros} currency={currency} />}
          />
        </div>
        <div data-testid="finance-stat-plan">
          <Stat
            label={t('metricPlan')}
            value={ledger.planEquivalentCostMicros === undefined ? t('noData') : <Money micros={ledger.planEquivalentCostMicros} currency={currency} />}
          />
        </div>
        <div data-testid="finance-stat-sessions">
          <Stat label={t('metricSessions')} value={ledger.sessionCount} />
        </div>
        <div data-testid="finance-stat-workspaces">
          <Stat label={t('metricWorkspaces')} value={ledger.workspaceCount} />
        </div>
      </StatGrid>

      {empty
        ? (
          <div data-testid="finance-empty">
            <EmptyState message={t('emptyTitle')} hint={t('emptyHint')} />
          </div>
        )
        : (
          <>
            <Card title={t('planCardTitle')} className={css.section}>
              <p className={css.hint}>{t('planCardHint')}</p>
              <div className={css.table} data-testid="finance-plan-card">
                <div className={cx(css.tableHead, css.colsPlan)}>
                  <span className={css.cell}>{t('colProvider')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('planMonthly')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('planEquivalent')}</span>
                  <span className={css.cell}>{t('planVerdict')}</span>
                  <span className={css.cell} />
                </div>
                {orderedProviders.length === 0
                  ? <p className={css.hint}>{t('noData')}</p>
                  : orderedProviders.map((provider) => {
                    const insight = planByProvider.get(provider)
                    const existing = planEntries.find((plan) => plan.provider === provider)
                    const open = editing === provider
                    return (
                      <div key={provider} className={css.group}>
                        <div className={cx(css.tableRow, css.colsPlan)} data-testid={`finance-plan-${provider}`}>
                          <span className={cx(css.cell, css.balanceName)}>{provider}</span>
                          <span className={cx(css.cell, css.cellNum)}>
                            {insight === undefined ? '—' : <Money micros={insight.monthlyMicros} currency={insight.currency} />}
                          </span>
                          <span className={cx(css.cell, css.cellNum)}>
                            <Money micros={insight?.equivalentMicros ?? 0} currency={currency} />
                          </span>
                          <span className={cx(css.cell, css.balanceNote)}>{verdictText(insight, currency, t)}</span>
                          <span className={css.planActions}>
                            {plansWritable
                              ? (
                                <Button
                                  onClick={() => setEditing(open ? null : provider)}
                                  aria-label={`${existing === undefined ? t('planFill') : t('planEdit')}: ${provider}`}
                                >
                                  {existing === undefined ? t('planFill') : t('planEdit')}
                                </Button>
                              )
                              : null}
                            {plansWritable && existing !== undefined
                              ? (
                                <Button
                                  onClick={() => { void removePlan(provider) }}
                                  aria-label={`${t('planRemove')}: ${provider}`}
                                >
                                  {t('planRemove')}
                                </Button>
                              )
                              : null}
                          </span>
                        </div>
                        {open
                          ? (
                            <PlanEditor
                              provider={provider}
                              initial={existing}
                              t={t}
                              onCancel={() => setEditing(null)}
                              onSave={async (plan) => { await savePlan(plan); setEditing(null) }}
                            />
                          )
                          : null}
                      </div>
                    )
                  })}
              </div>
              {plansWritable ? <p className={css.hint}>{t('planOnlyUsed')}</p> : <p className={css.tag}>{t('planReadOnly')}</p>}
            </Card>

            <Card title={t('balanceTitle')} className={css.section}>
              <div className={css.table}>
                <div className={cx(css.tableHead, css.colsBalance)}>
                  <span className={css.cell}>{t('colProvider')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('balanceTitle')}</span>
                  <span className={css.cell} />
                  <span className={css.cell} />
                </div>
                {balanceRows.length === 0
                  ? <p className={css.hint}>{t('noData')}</p>
                  : balanceRows.map((row) => (
                    <div className={cx(css.tableRow, css.colsBalance)} key={row.provider} data-testid={`finance-balance-${row.provider}`}>
                      <span className={cx(css.cell, css.balanceName)}>{row.provider}</span>
                      <span className={cx(css.cell, css.cellNum, css.balanceValue)}>
                        {balanceValue(ledger, row.balance, t)}
                      </span>
                      <span className={cx(css.cell, css.balanceNote)}>{balanceNote(row.provider, row.balance, ledger, t)}</span>
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
                <div className={cx(css.tableHead, css.colsModels)}>
                  <span className={css.cell}>{t('colModel')}</span>
                  <span className={css.cell}>{t('colProvider')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('colCost')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('colUnitCost')}</span>
                </div>
                {topModels.length === 0
                  ? <p className={css.hint}>{t('noData')}</p>
                  : topModels.map((row) => (
                    <div className={cx(css.tableRow, css.colsModels)} key={row.modelKey}>
                      <span className={cx(css.cell, css.modelKey)} title={row.modelKey}>{row.model}</span>
                      <span className={css.cell}>{row.provider}</span>
                      <span className={cx(css.cell, css.cellNum)}><Money micros={row.costMicros} currency={currency} /></span>
                      <span className={cx(css.cell, css.cellNum)}>
                        {row.unitCostMicros === null ? t('noData') : `${formatMicros(Math.round(row.unitCostMicros))}${t('perMtok')}`}
                      </span>
                    </div>
                  ))}
              </div>
              <p className={css.hint}>{t('topModelsHint')}</p>
            </Card>
          </>
        )}

      <div className={css.footer}>
        <p className={css.footerNote}>{priceNote(lastSyncAppliedAt, t)}</p>
        {/* 价格表操作（SPEC §5.1）：用户自行决定何时更新，并可一键还原到发版快照。 */}
        <div className={css.planActions} role="group" aria-label={t('priceActionsLabel')}>
          <Button disabled={priceBusy} onClick={() => { void onUpdatePrices() }} aria-label={t('updatePrices')}>
            {t('updatePrices')}
          </Button>
          <Button
            disabled={priceBusy || (priceTable !== undefined && priceTable.overlayKeyCount + priceTable.userKeyCount === 0)}
            onClick={() => { void onRestorePrices() }}
            aria-label={t('restorePrices')}
          >
            {t('restorePrices')}
          </Button>
        </div>
        {priceTable?.base.ok === false
          ? <p className={css.footerNote} role="status">{t('priceTampered')}</p>
          : null}
        {priceTable !== undefined && priceTable.rejected.length > 0
          ? (
            <p className={css.footerNote} role="status">
              {t('priceRejected', { count: priceTable.rejected.length, keys: priceTable.rejected.map(row => row.key).join(', ') })}
            </p>
          )
          : null}
        {priceError != null
          ? <p className={css.footerNote} role="status">{t('priceActionFailed', { message: priceError })}</p>
          : null}
        <p className={css.footerNote}>{t('estimateNote')}</p>
        {ledger.unreadableSessions.length > 0
          ? <p className={css.footerNote}>{t('unreadableNote', { count: ledger.unreadableSessions.length })}</p>
          : null}
      </div>
    </>
  )
}

function minutesSince(epochMs: number): number {
  return Math.max(0, Math.round((Date.now() - epochMs) / 60_000))
}

const STALE_MS = 24 * 60 * 60 * 1000

/** 价格来源脚注：说清账本用的是哪一层价格，以及新鲜度。 */
export function priceNote(lastSyncAppliedAt: number | undefined, t: FinanceTranslate): string {
  if (lastSyncAppliedAt === undefined) {
    return `${t('priceNoteNever')} · ${t('priceStale')}`
  }
  const when = t('lastUpdated', { minutes: minutesSince(lastSyncAppliedAt) })
  if (Date.now() - lastSyncAppliedAt > STALE_MS) return `${t('priceNote', { when })} · ${t('priceStale')}`
  return t('priceNote', { when })
}

/** 结论列：省了多少 / 亏了多少 / 还没有用量 —— 全是账本观测值相减，不含估算。 */
function verdictText(insight: { savingsMicros: number; equivalentMicros: number; discountRate: number | null; breakEvenRatio: number | null } | undefined, currency: string, t: FinanceTranslate): string {
  if (insight === undefined) return ''
  if (insight.equivalentMicros <= 0) return t('planNoUsage')
  const amount = `${formatMicros(Math.abs(insight.savingsMicros))} ${currency}`
  if (insight.savingsMicros >= 0) {
    const discount = insight.discountRate === null ? '' : ` · ${t('planDiscount', { pct: `${Math.round(insight.discountRate * 100)}%` })}`
    return `${t('planSaved', { amount })}${discount}`
  }
  const progress = insight.breakEvenRatio === null ? '' : ` ${t('planBreakEven', { pct: `${Math.round(insight.breakEvenRatio * 100)}%` })}`
  return `${t('planLost', { amount })}${progress}`
}

/** 行内套餐编辑器：月费 + 币种 + 计费形态，保存写回 settings 的 `plans`。 */
function PlanEditor({ provider, initial, t, onSave, onCancel }: {
  provider: string
  initial: FinancePlanEntry | undefined
  t: FinanceTranslate
  onSave: (plan: FinancePlanEntry) => Promise<void>
  onCancel: () => void
}): ReactNode {
  const [fee, setFee] = useState(initial === undefined ? '' : microsToMajor(initial.monthlyMicros))
  const [currency, setCurrency] = useState(initial?.currency ?? 'CNY')
  const [period, setPeriod] = useState<FinancePlanPeriod>(initial?.periodLabel ?? 'month')
  const micros = majorToMicros(fee)
  const invalid = fee.trim() !== '' && micros === null
  return (
    <div className={css.planForm} data-testid={`finance-plan-form-${provider}`}>
      <label className={css.section}>
        <span className={css.balanceNote}>{t('planMonthly')}</span>
        <Input
          className={css.planInput}
          type="text"
          inputMode="decimal"
          aria-label={`${t('planMonthly')}: ${provider}`}
          value={fee}
          aria-invalid={invalid}
          onChange={(event) => setFee(event.currentTarget.value)}
        />
      </label>
      <label className={css.section}>
        <span className={css.balanceNote}>{t('planCurrency')}</span>
        <Input
          className={css.planInput}
          type="text"
          aria-label={`${t('planCurrency')}: ${provider}`}
          value={currency}
          onChange={(event) => setCurrency(event.currentTarget.value)}
        />
      </label>
      <SegmentedControl<FinancePlanPeriod>
        options={FINANCE_PLAN_PERIODS.map((value) => ({ value, label: periodLabel(value, t) }))}
        value={period}
        onChange={setPeriod}
        ariaLabel={`${t('planPeriod')}: ${provider}`}
      />
      <span className={css.planActions}>
        <Button
          disabled={micros === null}
          onClick={() => {
            void onSave({
              provider,
              monthlyMicros: micros ?? 0,
              currency: currency.trim() === '' ? 'CNY' : currency.trim(),
              periodLabel: period,
              effectiveFrom: 0,
            })
          }}
        >
          {t('planSave')}
        </Button>
        <Button onClick={onCancel}>{t('planCancel')}</Button>
      </span>
      {invalid ? <span className={css.tag}>{t('planInvalidFee')}</span> : null}
    </div>
  )
}

function periodLabel(period: FinancePlanPeriod, t: FinanceTranslate): string {
  if (period === 'month-week') return t('periodMonthWeek')
  if (period === 'month-week-5h') return t('periodMonthWeek5h')
  return t('periodMonth')
}

function balanceValue(ledger: FinanceLedger, balance: FinanceProviderBalance, t: FinanceTranslate): ReactNode {
  if (balance.status === 'ok' && balance.totalMicros !== undefined) {
    const currency = balance.currency === undefined || balance.currency === '' ? ledger.currency : balance.currency
    return <Money micros={balance.totalMicros} currency={currency} />
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
