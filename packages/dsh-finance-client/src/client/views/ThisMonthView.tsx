/**
 * 视图①：本月值不值（子导航的第一个 tab）。
 *
 * 这个 tab 拥有整页的钱：更新时间与刷新、五个总量数字、订阅 vs 按量、余额、
 * 成本趋势、单位成本榜与两条脚注（价格来源 / 估算口径）。没有会话时只留
 * 「数字 + 为什么是 0」的引导，不摆一堆空卡。
 */

import { useState, type ReactNode } from 'react'
import { Button, Card, CellText, Checkbox, EmptyState, Input, Modal, Money, Pill, RowActions, SegmentedControl, Stat, StatGrid, TrendChart, formatMicros } from 'dsh-ui-kit'
import type {
  FinanceLedger,
  FinanceListProvidersResult,
  FinancePlanEntry,
  FinancePlanPeriod,
  FinancePriceTableStatus,
  FinanceProviderBalance,
  FinanceProviderBillingMode,
} from 'dsh-spark-finance/types'
import {
  balanceDaysLeft,
  mixedUnitCostMicros,
  modelComparisonRows,
  planRows,
  providerDailyMicros,
  providerKey,
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
  /** 打 provider 级计费方式标记（订阅 / 按量 / 免费）。 */
  onSetBillingMode: (provider: string, mode: FinanceProviderBillingMode) => Promise<void>
  /**
   * 打标（SPEC §5.4 两池）：计费方式 + 可选手动余额 / autoFetch，订阅可附带月费
   * 条目；按量池行的「手动余额」编辑走这条（订阅池月费走 savePlan）。
   */
  onTagProvider: (
    provider: string,
    patch: { mode: FinanceProviderBillingMode; manualBalanceMicros?: number; autoFetchBalance?: boolean },
    plan?: FinancePlanEntry,
  ) => Promise<void>
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
const BILLING_MODES: readonly FinanceProviderBillingMode[] = ['metered', 'plan', 'free']
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
  onSetBillingMode,
  onTagProvider,
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
  /** 按量池行内余额表单：正在编辑的 provider（null = 收起）。 */
  const [balanceEditing, setBalanceEditing] = useState<string | null>(null)
  /** 还原价格表（回退/破坏性）的二次确认；确认后才真调 onRestorePrices。 */
  const [confirmRestore, setConfirmRestore] = useState(false)
  /** 没有覆盖层时「还原」没有可回退的东西 —— 禁用必须给原因（UI-UX-SPEC §3.1 Don't）。 */
  const restoreBlocked = priceTable !== undefined && priceTable.overlayKeyCount + priceTable.userKeyCount === 0
  const restoreDisabled = Boolean(priceBusy) || restoreBlocked
  const trendPoints = ledger.byDay.map((row) => ({ key: row.day, label: row.day.slice(5), value: row.costMicros }))
  const topModels = modelComparisonRows(ledger)
    .filter((row) => row.unitCostMicros !== null)
    .sort((a, b) => (b.unitCostMicros as number) - (a.unitCostMicros as number))
    .slice(0, TOP_MODEL_COUNT)
  const allProviders = providerList?.providers ?? []
  // provider 级「计费方式」标记：用户设置优先，其次宿主建议值；锁定的 provider 只读展示。
  const billingExplicit = new Map<string, FinanceProviderBillingMode>()
  const billingDefault = new Map<string, FinanceProviderBillingMode>()
  const billingLocked = new Set<string>()
  for (const row of allProviders) {
    const key = providerKey(row.provider)
    const explicit = row.userEntry?.billingMode
    if (explicit === 'plan' || explicit === 'metered' || explicit === 'free') billingExplicit.set(key, explicit)
    const fallback = row.hostMeta?.defaultBillingMode ?? 'metered'
    billingDefault.set(key, fallback === 'plan' || fallback === 'free' ? fallback : 'metered')
    if (row.hostMeta?.lockBillingModeAndCurrency === true) billingLocked.add(key)
  }
  /**
   * 生效的计费方式：**显式标记 > 已有月费条目（视为订阅）> 宿主默认**。
   * 中间那条是为了兼容「早就填过月费、还没打标记」的老数据 —— 否则它们的订阅卡会
   * 突然变成按量、连编辑入口都消失。
   */
  const billingFor = (provider: string): FinanceProviderBillingMode => {
    const key = providerKey(provider)
    const explicit = billingExplicit.get(key)
    if (explicit !== undefined) return explicit
    if (planEntries.some((plan) => providerKey(plan.provider) === key)) return 'plan'
    return billingDefault.get(key) ?? 'metered'
  }
  const { withPlan } = planRows(ledger, plans)
  const planByProvider = new Map(withPlan.map((insight) => [insight.provider, insight]))
  const planEntries = [...plans]
  // 两池分类（SPEC §5.4，2026-09-19 修订）：订阅 / 按量。生效计费方式 = 显式标记 > 已有月费条目 > 宿主默认。
  // 待选池已退役：未打标且无宿主元数据的厂商按宿主默认（无则 metered）直接落入按量池；
  // free 打标者不进任何池（零成本无呈现），可随时经「…」菜单改标。
  const knownProviders = [...new Set([
    ...ledger.byProvider.map((row) => row.provider),
    ...planEntries.map((plan) => plan.provider),
    ...allProviders.map((row) => row.provider),
  ])]
  const spendByProvider = new Map(ledger.byProvider.map((row) => [providerKey(row.provider), row.costMicros]))
  const providerRowOf = new Map(allProviders.map((row) => [providerKey(row.provider), row]))
  const supportsFetch = (provider: string): boolean =>
    providerRowOf.get(providerKey(provider))?.hostMeta?.supportsBalanceFetch === true
  const planPool = knownProviders.filter((provider) => billingFor(provider) === 'plan')
  const meteredPool = knownProviders.filter((provider) => billingFor(provider) === 'metered')
  /** Action 列「…」菜单（UI-UX-SPEC §3.5）：操作 >1 项必须收敛进下拉。 */
  const modeMenuId = (mode: FinanceProviderBillingMode): string => `mode:${mode}`
  const menuItems = (provider: string, kind: 'plan' | 'metered') => {
    const existing = planEntries.find((plan) => plan.provider === provider)
    const items = BILLING_MODES.map((mode) => ({ id: modeMenuId(mode), label: billingLabel(mode, t) }))
    if (kind === 'plan') {
      items.push(
        { id: 'edit-plan', label: existing === undefined ? t('planFill') : t('planEdit') },
        ...(existing !== undefined ? [{ id: 'remove-plan', label: t('planRemove') }] : []),
      )
    } else {
      items.push({ id: 'edit-balance', label: t('manualBalanceLabel') })
    }
    return items
  }
  const onMenuSelect = (provider: string, kind: 'plan' | 'metered', id: string): void => {
    if (id.startsWith('mode:')) {
      void onSetBillingMode(provider, id.slice(5) as FinanceProviderBillingMode)
      return
    }
    if (id === 'edit-plan') setEditing(editing === provider ? null : provider)
    if (id === 'remove-plan') void removePlan(provider)
    if (id === 'edit-balance') setBalanceEditing(balanceEditing === provider ? null : provider)
  }
  const empty = ledger.sessionCount === 0

  return (
    <>
      <div className={css.toolbar}>
        <span className={css.toolbarMeta} data-testid="finance-updated">
          {ledger.generatedAt > 0 ? t('lastUpdated', { minutes: minutesSince(ledger.generatedAt) }) : t('lastUpdatedNever')}
        </span>
        {/* 刷新是**次操作**（UI-UX-SPEC §4.2 仪表盘模板：刷新类动作归次形制），
            本 tab 唯一 primary 是页脚的价格表主操作。 */}
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing} aria-label={t('refresh')}>
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
              <div className={css.table} data-testid="finance-plan-card">
                <div className={cx(css.tableHead, css.colsPlan)}>
                  <span className={css.cell}>{t('colProvider')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('planMonthly')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('planSavingsCol')}</span>
                  <span className={css.cell} />
                </div>
                {planPool.length === 0
                  ? <p className={css.hint}>{t('planEmpty')}</p>
                  : planPool.map((provider) => {
                    const insight = planByProvider.get(provider)
                    const existing = planEntries.find((plan) => plan.provider === provider)
                    const open = editing === provider
                    const savings = insight?.savingsMicros
                    return (
                      <div key={provider} className={css.group}>
                        <div className={cx(css.tableRow, css.colsPlan)} data-testid={`finance-plan-${provider}`}>
                          <span className={cx(css.cell, css.balanceName)}>
                              <CellText text={provider} />
                            </span>
                          <span className={cx(css.cell, css.cellNum)}>
                            {insight === undefined ? '—' : <Money micros={insight.monthlyMicros} currency={insight.currency} exact />}
                          </span>
                          <span className={cx(css.cell, css.cellNum)}>
                            {savings === undefined
                              ? '—'
                              : (
                                <>
                                  <Money micros={savings} currency={currency} exact />
                                  {/* 按量等价 > 月费 = 订阅真省了（SPEC §5.4 两池列）。 */}
                                  {savings > 0 ? <Pill tone="success" className={css.cellNum}>{t('superValue')}</Pill> : null}
                                </>
                              )}
                          </span>
                          <span className={css.planActions}>
                            {/* Action 列「…」菜单（UI-UX-SPEC §3.5）：打标/编辑/移除收敛进下拉。 */}
                            {!plansWritable || billingLocked.has(providerKey(provider))
                              ? <span className={css.tagMuted}>{billingLabel('plan', t)}</span>
                              : (
                                <RowActions
                                  label={`${t('actionsMenu')}: ${provider}`}
                                  items={menuItems(provider, 'plan')}
                                  selectedId={modeMenuId('plan')}
                                  onSelect={(id) => onMenuSelect(provider, 'plan', id)}
                                />
                              )}
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
            </Card>

            <Card title={t('meteredCardTitle')} className={css.section}>
              <div className={css.table}>
                <div className={cx(css.tableHead, css.colsBalance)}>
                  <span className={css.cell}>{t('colProvider')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('balanceLabel')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('meteredSpend')}</span>
                  <span className={css.cell} />
                </div>
                {meteredPool.length === 0
                  ? <p className={css.hint}>{t('meteredEmpty')}</p>
                  : meteredPool.map((provider) => {
                    const row = providerRowOf.get(providerKey(provider))
                    const spend = spendByProvider.get(providerKey(provider)) ?? 0
                    return (
                      <div key={provider}>
                        <div className={cx(css.tableRow, css.colsBalance)} data-testid={`finance-metered-${provider}`}>
                          <span className={cx(css.cell, css.balanceName)}>
                            <CellText text={provider} />
                          </span>
                          <span className={cx(css.cell, css.cellNum)}>
                            {row !== undefined ? balanceValue(ledger, row.balance, t) : ''}
                          </span>
                          <span className={cx(css.cell, css.cellNum, css.balanceValue)}>
                            <Money micros={spend} currency={currency} exact />
                          </span>
                          <span className={css.planActions}>
                            {/* Action 列「…」菜单（UI-UX-SPEC §3.5）：打标 + 手动余额收敛进下拉。 */}
                            {!plansWritable || billingLocked.has(providerKey(provider))
                              ? <span className={css.tagMuted}>{billingLabel('metered', t)}</span>
                              : (
                                <RowActions
                                  label={`${t('actionsMenu')}: ${provider}`}
                                  items={menuItems(provider, 'metered')}
                                  selectedId={modeMenuId('metered')}
                                  onSelect={(id) => onMenuSelect(provider, 'metered', id)}
                                />
                              )}
                          </span>
                        </div>
                        {balanceEditing === provider
                          ? (
                            <MeteredBalanceEditor
                              provider={provider}
                              canAutoFetch={supportsFetch(provider)}
                              t={t}
                              onCancel={() => setBalanceEditing(null)}
                              onSave={async (patch) => {
                                await onTagProvider(provider, { mode: 'metered', ...patch })
                                setBalanceEditing(null)
                              }}
                            />
                          )
                          : null}
                      </div>
                    )
                  })}
              </div>
            </Card>

            <Card
              title={t('trendTitle')}
              actions={<span className={css.tagMuted} title={t('trendHint')}>{t('trendRange', { days: ledger.byDay.length })}</span>}
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
            </Card>

            <Card title={t('topModelsTitle')} className={css.section}>
              <div className={css.table}>
                <div className={cx(css.tableHead, css.colsModels)}>
                  <span className={css.cell}>{t('colModel')}</span>
                  <span className={css.cell}>{t('colProvider')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('colCost')}</span>
                  <span className={cx(css.cell, css.cellNum)} title={t('topModelsHint')}>{t('colUnitCost')}</span>
                </div>
                {topModels.length === 0
                  ? <p className={css.hint}>{t('noData')}</p>
                  : topModels.map((row) => (
                    <div className={cx(css.tableRow, css.colsModels)} key={row.modelKey}>
                      {/* 文本列两行截断 + 悬浮全文（UI-UX-SPEC §3.5）。 */}
                      <span className={cx(css.cell, css.modelKey)}>
                        <CellText text={row.model} />
                      </span>
                      <span className={css.cell}><CellText text={row.provider} /></span>
                      <span className={cx(css.cell, css.cellNum)}><Money micros={row.costMicros} currency={currency} exact /></span>
                      <span className={cx(css.cell, css.cellNum)}>
                        {row.unitCostMicros === null ? t('noData') : `${formatMicros(Math.round(row.unitCostMicros))}${t('perMtok')}`}
                      </span>
                    </div>
                  ))}
              </div>
            </Card>
          </>
        )}

      <div className={css.footer}>
        <p className={css.footerNote}>{priceNote(lastSyncAppliedAt, t)}</p>
        {/* 价格表操作（SPEC §5.1 / UI-UX-SPEC §3.1「一屏一个 primary」）：
            · 「更新价格表」= 本视图唯一 primary（拉最新目录价 → 原子替换覆盖层，真写操作）；
            · 「还原到发版快照」= 回退/破坏性操作，实心 primary 会让两个写操作抢同一视觉层级，
              故按 §4.2 危险操作取 danger；disabled 语义原样保留（没有覆盖层时不给点）。
              两枚按钮同属一个 group ⇒ 同尺寸（md），组内不混高。 */}
        <div className={css.planActions} role="group" aria-label={t('priceActionsLabel')}>
          <Button variant="primary" disabled={priceBusy} onClick={() => { void onUpdatePrices() }} aria-label={t('updatePrices')}>
            {t('updatePrices')}
          </Button>
          <Button
            variant="danger"
            disabled={restoreDisabled}
            aria-describedby={restoreBlocked ? 'finance-restore-hint' : undefined}
            onClick={() => { setConfirmRestore(true) }}
            aria-label={t('restorePrices')}
          >
            {t('restorePrices')}
          </Button>
        </div>
        {restoreBlocked
          ? <p id='finance-restore-hint' className={css.hint} role='status'>{t('restoreDisabledHint')}</p>
          : null}
        {/* 破坏性操作二次确认（UI-UX-SPEC §4.2 模板 4「危险区 … danger Button + 二次确认（Modal）」）。
            文案走 locale；Modal 自己负责焦点圈闭，Esc 由它这层接管（不会连带收掉指挥舱）。 */}
        <Modal
          open={confirmRestore}
          onClose={() => { setConfirmRestore(false) }}
          title={t('restoreConfirmTitle')}
          footer={(
            <>
              <Button variant="ghost" onClick={() => { setConfirmRestore(false) }}>{t('cancel')}</Button>
              <Button
                variant="danger"
                disabled={priceBusy}
                onClick={() => { setConfirmRestore(false); void onRestorePrices() }}
              >
                {t('restoreConfirmAction')}
              </Button>
            </>
          )}
        >
          <p>{t('restoreConfirmBody')}</p>
        </Modal>
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

/** 计费方式标签（面板只暴露三态；宿主回落的 mixed 归到按量展示）。 */
export function billingLabel(mode: FinanceProviderBillingMode, t: FinanceTranslate): string {
  if (mode === 'plan') return t('billing_plan')
  if (mode === 'free') return t('billing_free')
  return t('billing_metered')
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

/**
 * 行内套餐编辑器：月费 + 币种 + 计费形态，保存写回 settings 的 `plans`。
 *
 * 按钮形制：这是**卡片内的行内表单**，与页脚的价格表主操作同处一个图层 ——
 * 按 UI-UX-SPEC §3.1「一屏一个 primary」，它的「保存」是次形制（secondary），
 * 「取消」更是无底（ghost，hippomemo 编辑弹窗同规）；两枚同尺寸（md），行内不混高。
 */
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
          variant="secondary"
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
        <Button variant="ghost" onClick={onCancel}>{t('planCancel')}</Button>
      </span>
      {invalid ? <span className={css.tag}>{t('planInvalidFee')}</span> : null}
    </div>
  )
}

/**
 * 按量池行内「手动余额」表单（SPEC §5.4 / INV-9 用户自报）+ autoFetch 勾选。
 * 厂商不支持自动获取 → 勾选 disable + 悬浮提示（当前仅 deepseek-official 支持）。
 */
function MeteredBalanceEditor({ provider, canAutoFetch, t, onSave, onCancel }: {
  provider: string
  canAutoFetch: boolean
  t: FinanceTranslate
  onSave: (patch: { manualBalanceMicros?: number; autoFetchBalance?: boolean }) => Promise<void>
  onCancel: () => void
}): ReactNode {
  const [balance, setBalance] = useState('')
  const [autoFetch, setAutoFetch] = useState(canAutoFetch)
  const micros = balance.trim() === '' ? 0 : majorToMicros(balance)
  const invalid = balance.trim() !== '' && micros === null
  return (
    <div className={css.planForm} data-testid={`finance-metered-form-${provider}`}>
      <label className={css.section}>
        <span className={css.balanceNote}>{t('manualBalanceLabel')}</span>
        <Input
          className={css.planInput}
          type="text"
          inputMode="decimal"
          aria-label={`${t('manualBalanceLabel')}: ${provider}`}
          value={balance}
          aria-invalid={invalid}
          onChange={(event) => setBalance(event.currentTarget.value)}
        />
      </label>
      <span title={canAutoFetch ? undefined : t('autoFetchUnsupported')}>
        <Checkbox
          label={t('autoFetchLabel')}
          checked={canAutoFetch && autoFetch}
          disabled={!canAutoFetch}
          onChange={setAutoFetch}
        />
      </span>
      <span className={css.planActions}>
        <Button
          variant="secondary"
          disabled={invalid}
          onClick={() => {
            void onSave({
              manualBalanceMicros: micros ?? 0,
              autoFetchBalance: canAutoFetch && autoFetch,
            })
          }}
        >
          {t('planSave')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>{t('planCancel')}</Button>
      </span>
      {invalid ? <span className={css.tag}>{t('planInvalidBalance')}</span> : null}
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
    // INV-9：手填值与自动获取值可区分（悬浮提示 + 「手填」角标）。
    return (
      <span title={balance.source === 'manual' ? t('manualBalanceLabel') : undefined}>
        <Money micros={balance.totalMicros} currency={currency} />
        {balance.source === 'manual' ? <Pill className={css.cellNum}>{t('balanceManual')}</Pill> : null}
      </span>
    )
  }
  if (balance.status === 'missing-credential') return t('balanceMissingKey')
  if (balance.status === 'unsupported') return t('balanceUnsupported')
  return t('balanceError')
}
