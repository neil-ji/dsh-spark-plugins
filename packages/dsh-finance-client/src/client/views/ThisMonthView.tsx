/**
 * 视图①：本月值不值（子导航的第一个 tab）。
 *
 * 这个 tab 拥有整页的钱：更新时间与刷新、五个总量数字、供应商总表（订阅 vs 按量
 * 合并为一张表）、成本趋势、单位成本榜与两条脚注（价格来源 / 估算口径）。
 * 没有会话时只留「数字 + 为什么是 0」的引导，不摆一堆空卡。
 */

import { useState, type ReactNode } from 'react'
import { Button, Card, CellText, Checkbox, EmptyState, Input, Modal, Money, Pill, RowActions, SegmentedControl, Stat, StatGrid, TrendChart, formatMoneyMicros } from 'dsh-ui-kit'
import type {
  FinanceLedger,
  FinanceListProvidersEntry,
  FinanceListProvidersResult,
  FinancePlanEntry,
  FinancePlanPeriod,
  FinancePriceTableStatus,
  FinanceProviderBalance,
  FinanceProviderBillingMode,
  FinanceProviderEntry,
  FinanceQuotaEpisodeRow,
  FinanceQuotaProviderRow,
  FinanceQuotaWindow,
  FinanceQuotaWindowSpan,
} from 'dsh-spark-finance/types'
import {
  balanceDaysLeft,
  relativeTime,
  mixedUnitCostMicros,
  modelComparisonRows,
  planRows,
  providerDailyMicros,
  providerKey,
  resetCountdown,
} from '../derive.ts'
import { FINANCE_PLAN_PERIODS, majorToMicros, microsToMajor } from '../plans.ts'
import type { FinancePriceAction } from '../controller.ts'
import { QuotaWindowCard } from './QuotaWindowCard.tsx'
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
  /** 打标（SPEC §5.4 两池）：计费方式 + 手动余额 / autoFetch + 可选月费条目。 */
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
  /** 价格表操作进行中的动作（更新 / 还原 / undefined = 空闲）。 */
  priceAction: FinancePriceAction | undefined
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
  onTagProvider,
  refreshing,
  onRefresh,
  lastSyncAppliedAt,
  priceTable,
  priceAction,
  priceError,
  onUpdatePrices,
  onRestorePrices,
}: ThisMonthViewProps): ReactNode {
  const currency = ledger.currency === '' ? 'CNY' : ledger.currency
  /** 「修改」表单 modal：正在编辑的 provider（null = 收起）。 */
  const [editing, setEditing] = useState<string | null>(null)
  /** 「详情」modal：正在查看的 provider（null = 收起）。 */
  const [detail, setDetail] = useState<string | null>(null)
  /** 还原价格表（回退/破坏性）的二次确认；确认后才真调 onRestorePrices。 */
  const [confirmRestore, setConfirmRestore] = useState(false)
  /** 没有覆盖层时「还原」没有可回退的东西 —— 禁用必须给原因（UI-UX-SPEC §3.1 Don't）。 */
  const restoreBlocked = priceTable !== undefined && priceTable.overlayKeyCount + priceTable.userKeyCount === 0
  const priceBusy = priceAction !== undefined
  const restoreDisabled = priceBusy || restoreBlocked
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
  const planEntries = [...plans]
  const billingFor = (provider: string): FinanceProviderBillingMode => {
    const key = providerKey(provider)
    const explicit = billingExplicit.get(key)
    if (explicit !== undefined) return explicit
    if (planEntries.some((plan) => providerKey(plan.provider) === key)) return 'plan'
    return billingDefault.get(key) ?? 'metered'
  }
  const { withPlan } = planRows(ledger, plans)
  const insightByProvider = new Map(withPlan.map((insight) => [insight.provider, insight]))
  // 供应商总表（2026-09 订阅/按量合并）：订阅 + 按量一张表，付费类型用 Tag 区分。
  const knownProviders = [...new Set([
    ...ledger.byProvider.map((row) => row.provider),
    ...planEntries.map((plan) => plan.provider),
    ...allProviders.map((row) => row.provider),
  ])].sort((a, b) => a.localeCompare(b))
  const spendByProvider = new Map(ledger.byProvider.map((row) => [providerKey(row.provider), row.costMicros]))
  const providerRowOf = new Map(allProviders.map((row) => [providerKey(row.provider), row]))
  const planEntryOf = (provider: string): FinancePlanEntry | undefined =>
    planEntries.find((plan) => plan.provider === provider)
  /** Action 列「…」菜单（UI-UX-SPEC §3.5）：修改 / 详情收敛进下拉。 */
  const onMenuSelect = (provider: string, id: string): void => {
    if (id === 'edit') setEditing(provider)
    if (id === 'detail') setDetail(provider)
  }
  /** 修改表单保存：按目标付费类型分派到对应的写回 seam（表单内联动已完成校验）。 */
  const onSaveProvider = async (
    provider: string,
    mode: FinanceProviderBillingMode,
    plan: FinancePlanEntry | undefined,
    balance: { manualBalanceMicros?: number; autoFetchBalance?: boolean } | undefined,
  ): Promise<void> => {
    if (mode === 'plan' && plan !== undefined) await onTagProvider(provider, { mode: 'plan' }, plan)
    else if (mode === 'metered') await onTagProvider(provider, { mode: 'metered', ...balance })
    else if (mode === 'free') {
      await onTagProvider(provider, { mode: 'free' })
      // free 强制月费 0：清掉遗留套餐条目，避免「已有月费条目视为订阅」的兼容口径把行拉回订阅。
      if (planEntryOf(provider) !== undefined) await removePlan(provider)
    }
    setEditing(null)
  }
  const empty = ledger.sessionCount === 0

  return (
    <>
      <div className={css.toolbar}>
        <span className={css.toolbarMeta} data-testid="finance-updated">
          {ledger.generatedAt > 0 ? t('lastUpdated', { time: relativeTime(ledger.generatedAt, t) }) : t('lastUpdatedNever')}
        </span>
        {/* 刷新是**次操作**（UI-UX-SPEC §4.2 仪表盘模板）；价格表两枚操作与之同排同尺寸
            （sm，同属一个 group ⇒ 不混高）。「更新价格表」是真写操作保留 primary，
            「还原到发版快照」按 §4.2 危险操作取 danger。

            三枚按钮都是**异步动作**，一律走 ui-kit Button 的 loading 形制（spinner +
            aria-busy + 锁点击）。会话多时「更新价格表」要「同步目录价 → 原子替换覆盖层 →
            重算整个账本」，实测秒级到十秒级 —— 只置 disabled 会让按钮看起来失灵、
            用户重复点（2026-09-21 用户实测反馈）。aria-busy 断言见 panel.test.tsx 与
            real-host-check 的 6i。 */}
        <span className={css.planActions} role="group" aria-label={t('priceActionsLabel')}>
          <Button
            variant="primary"
            size="sm"
            loading={priceAction === 'update'}
            disabled={priceBusy}
            onClick={() => { void onUpdatePrices() }}
            aria-label={t('updatePrices')}
          >
            {t('updatePrices')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={priceAction === 'restore'}
            disabled={restoreDisabled}
            aria-describedby={restoreBlocked ? 'finance-restore-hint' : undefined}
            onClick={() => { setConfirmRestore(true) }}
            aria-label={t('restorePrices')}
          >
            {t('restorePrices')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={refreshing}
            disabled={refreshing}
            onClick={onRefresh}
            aria-label={t('refresh')}
          >
            {t('refresh')}
          </Button>
        </span>
      </div>
      {/* 禁用必须给原因：没有覆盖层时「还原」没有可回退的东西（UI-UX-SPEC §3.1）。
          一行就够，不铺段落文案。
          位置在 **toolbar 之外**：toolbar 是 `space-between` 的，把提示塞成第三个子项
          会与按钮同排、挤在右侧（真宿主实测 x=494 与按钮同行）。 */}
      {restoreBlocked
        ? <p id="finance-restore-hint" className={css.hint} role="status">{t('restoreDisabledHint')}</p>
        : null}

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
      </StatGrid>

      {empty
        ? (
          <div data-testid="finance-empty">
            <EmptyState message={t('emptyTitle')} hint={t('emptyHint')} />
          </div>
        )
        : (
          <>
            <Card
              title={t('trendTitle')}
              actions={<span className={css.tagMuted} title={t('trendHint')}>{t('trendRange', { days: ledger.byDay.length })}</span>}
              className={css.section}
            >
              {/* 数据不足（<2 天）画不出趋势：给空占位而不是一块空白画布。 */}
              {trendPoints.length < 2
                ? <EmptyState message={t('trendEmpty')} />
                : (
                  <TrendChart
                    points={trendPoints}
                    ariaLabel={t('trendTitle')}
                    formatValue={(v) => formatMoneyMicros(v, currency)}
                    gradientId="finance-trend"
                  />
                )}
            </Card>

            {/* 订阅计划 + 按量付费合并为一张供应商总表：付费类型用 Tag 区分，
                「余额 / 月费」按付费类型取值，「按量等价」列给跨类型比较基准。 */}
            <Card title={t('providerCardTitle')} className={css.section}>
              <div className={css.table} data-testid="finance-provider-table">
                <div className={cx(css.tableHead, css.colsProviders)}>
                  <span className={css.cell}>{t('colProvider')}</span>
                  <span className={css.cell}>{t('colBillingType')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('colBalanceFee')}</span>
                  <span className={cx(css.cell, css.cellNum)} title={t('colEquivHint')}>{t('planEquivalent')}</span>
                  <span className={cx(css.cell, css.cellActions)}>{t('colActions')}</span>
                </div>
                {knownProviders.length === 0
                  ? <p className={css.hint}>{t('planEmpty')}</p>
                  : knownProviders.map((provider) => {
                    const mode = billingFor(provider)
                    const isFree = mode === 'free'
                    const isPlan = mode === 'plan'
                    const insight = insightByProvider.get(provider)
                    const row = providerRowOf.get(providerKey(provider))
                    const spend = spendByProvider.get(providerKey(provider)) ?? 0
                    // 「余额 / 月费」列：订阅行取月费（free 强制 0，SPEC §5.4），按量行取余额。
                    const feeOrBalance = isPlan || isFree
                      ? (isFree
                        ? <Money micros={0} currency={currency} exact />
                        : insight === undefined ? '—' : <Money micros={insight.monthlyMicros} currency={insight.currency} exact />)
                      : (row !== undefined ? balanceValue(ledger, row.balance, t) : '')
                    // 「按量等价」列：订阅行给目录价等价，按量行即本月支出。
                    // 省额只在悬浮里给（`planSaved`），不再挂「超值」tag —— 表格列窄，
                    // tag 会把金额挤到换行（2026-09-21 用户裁决：非付费类型列的 tag 一律移除）。
                    const equiv = isPlan && insight !== undefined
                      ? (
                        <span title={insight.savingsMicros > 0 ? t('planSaved', { amount: formatMoneyMicros(insight.savingsMicros, currency) }) : undefined}>
                          <Money micros={insight.equivalentMicros} currency={currency} exact />
                        </span>
                      )
                      : <Money micros={spend} currency={currency} exact />
                    return (
                      <div key={provider}>
                        <div className={cx(css.tableRow, css.colsProviders)} data-testid={`finance-provider-${provider}`}>
                          {/* 供应商列**只放名字**：额度触达 pill（最长 170px）塞进本列会
                              溢出被裁 + 把行高从 50px 撑到 65px，整张表看起来错位
                              （2026-09-21 真宿主实测）。额度信号改由详情弹窗承载
                              （SPEC §10.5 修订）。 */}
                          <span className={cx(css.cell, css.balanceName, css.clamp2)} title={provider}>
                            {provider}
                          </span>
                          <span className={css.cell}>
                            <Pill tone={mode === 'plan' ? 'brand' : mode === 'free' ? 'success' : 'neutral'} title={billingLabel(mode, t)}>
                              {billingLabel(mode, t)}
                            </Pill>
                          </span>
                          <span className={cx(css.cell, css.cellNum)}>{feeOrBalance}</span>
                          <span className={cx(css.cell, css.cellNum, css.balanceValue)}>{equiv}</span>
                          <span className={cx(css.planActions, css.cellActions)}>
                            {/* 操作列始终有下拉；锁定（如 deepseek-official）或设置只读时
                                收窄为「详情」一项 —— 修改入口不给，详情永远在。 */}
                            {!plansWritable || billingLocked.has(providerKey(provider))
                              ? (
                                <RowActions
                                  label={`${t('actionsMenu')}: ${provider}`}
                                  items={[{ id: 'detail', label: t('providerDetail') }]}
                                  onSelect={(id) => onMenuSelect(provider, id)}
                                />
                              )
                              : (
                                <RowActions
                                  label={`${t('actionsMenu')}: ${provider}`}
                                  items={[
                                    { id: 'edit', label: t('providerEdit') },
                                    { id: 'detail', label: t('providerDetail') },
                                  ]}
                                  onSelect={(id) => onMenuSelect(provider, id)}
                                />
                              )}
                          </span>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </Card>

            {/* SPEC §10.8：窗口归因 —— 把"这段时间用在哪、用了多少、用了多久"拆开。
                放在供应商表与模型榜之间：它是供应商触达角标的下一步追问。 */}
            <QuotaWindowCard ledger={ledger} plans={plans} t={t} />

            <Card title={t('topModelsTitle')} className={css.section}>
              <div className={css.table}>
                <div className={cx(css.tableHead, css.colsContext)}>
                  <span className={css.cell}>{t('colModel')}</span>
                  <span className={cx(css.cell, css.cellNum)}>{t('colCost')}</span>
                  <span className={cx(css.cell, css.cellNum)} title={t('topModelsHint')}>{t('colUnitCost')}</span>
                </div>
                {topModels.length === 0
                  ? <p className={css.hint}>{t('noData')}</p>
                  : topModels.map((row) => (
                    <div className={cx(css.tableRow, css.colsContext)} key={row.modelKey}>
                      {/* 模型 + 厂商合并 provider/model：两行截断 + 悬浮全文。 */}
                      <span className={cx(css.cell, css.modelKey, css.clamp2)} title={`${row.provider}/${row.model}`}>
                        {row.provider}/{row.model}
                      </span>
                      <span className={cx(css.cell, css.cellNum)}><Money micros={row.costMicros} currency={currency} exact /></span>
                      <span className={cx(css.cell, css.cellNum)}>
                        {row.unitCostMicros === null ? t('noData') : (<><Money micros={Math.round(row.unitCostMicros)} currency={currency} size="sm" />{t('perMtok')}</>)}
                      </span>
                    </div>
                  ))}
              </div>
            </Card>
          </>
        )}

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
                loading={priceAction === 'restore'}
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
        {/* 修改表单 modal：一张表单涵盖全部付费类型的字段，按类型联动显隐。 */}
        {editing !== null
          ? (
            <ProviderEditModal
              provider={editing}
              initialMode={billingFor(editing)}
              plan={planEntryOf(editing)}
              userEntry={providerRowOf.get(providerKey(editing))?.userEntry}
              canAutoFetch={supportsFetch(providerRowOf.get(providerKey(editing)))}
              t={t}
              onClose={() => { setEditing(null) }}
              onSave={(mode, plan, balance) => onSaveProvider(editing, mode, plan, balance)}
            />
          )
          : null}
        {/* 详情 modal：厂商全部已知属性（来源 / 宿主元数据 / 用户配置 / 余额 / 对比结论）。 */}
        {detail !== null
          ? (
            <ProviderDetailModal
              provider={detail}
              mode={billingFor(detail)}
              row={providerRowOf.get(providerKey(detail))}
              plan={planEntryOf(detail)}
              insight={insightByProvider.get(detail)}
              spend={spendByProvider.get(providerKey(detail)) ?? 0}
              currency={currency}
              ledger={ledger}
              t={t}
              onClose={() => { setDetail(null) }}
            />
          )
          : null}
        {/* 页脚只剩异常态提示：没有可说的就不渲染（无意义的分割线也不给）。 */}
        {priceTable?.base.ok === false || (priceTable !== undefined && priceTable.rejected.length > 0) || priceError != null
          ? (
            <div className={css.footer}>
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
            </div>
          )
          : null}
      </>
    )
  }

/** 计费方式标签（面板只暴露三态；宿主回落的 mixed 归到按量展示）。 */
export function billingLabel(mode: FinanceProviderBillingMode, t: FinanceTranslate): string {
  if (mode === 'plan') return t('billing_plan')
  if (mode === 'free') return t('billing_free')
  return t('billing_metered')
}

function supportsFetch(row: FinanceListProvidersEntry | undefined): boolean {
  return row?.hostMeta?.supportsBalanceFetch === true
}

/**
 * 修改供应商 modal：**一张表单涵盖全部付费类型的字段**，付费类型切换即字段联动 ——
 * 订阅亮月费/币种/计费形态，按量亮手动余额/自动获取，免费只留说明。
 *
 * 按钮形制：表单写操作是次形制（secondary，与页脚 primary 错层），取消无底（ghost）。
 */
function ProviderEditModal({ provider, initialMode, plan, userEntry, canAutoFetch, t, onClose, onSave }: {
  provider: string
  initialMode: FinanceProviderBillingMode
  plan: FinancePlanEntry | undefined
  userEntry: FinanceProviderEntry | undefined
  canAutoFetch: boolean
  t: FinanceTranslate
  onClose: () => void
  onSave: (
    mode: FinanceProviderBillingMode,
    plan: FinancePlanEntry | undefined,
    balance: { manualBalanceMicros?: number; autoFetchBalance?: boolean } | undefined,
  ) => Promise<void>
}): ReactNode {
  const [mode, setMode] = useState<FinanceProviderBillingMode>(initialMode)
  // 订阅字段（保留既有填写值，切走再切回不丢）
  const [fee, setFee] = useState(plan === undefined ? '' : microsToMajor(plan.monthlyMicros))
  const [planCurrency, setPlanCurrency] = useState(plan?.currency ?? 'CNY')
  const [period, setPeriod] = useState<FinancePlanPeriod>(plan?.periodLabel ?? 'month')
  // 按量字段
  const [balance, setBalance] = useState(
    userEntry?.manualBalanceMicros !== undefined ? microsToMajor(userEntry.manualBalanceMicros) : '',
  )
  const [autoFetch, setAutoFetch] = useState(userEntry?.autoFetchBalance === true && canAutoFetch)
  const feeMicros = majorToMicros(fee)
  const feeInvalid = mode === 'plan' && (fee.trim() === '' || feeMicros === null)
  const balanceMicros = balance.trim() === '' ? 0 : majorToMicros(balance)
  const balanceInvalid = mode === 'metered' && balanceMicros === null
  const invalid = feeInvalid || balanceInvalid
  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('providerEditTitle')} · ${provider}`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('planCancel')}</Button>
          <Button
            variant="secondary"
            disabled={invalid}
            onClick={() => {
              void onSave(
                mode,
                mode === 'plan' && feeMicros !== null
                  ? {
                    provider,
                    monthlyMicros: feeMicros,
                    currency: planCurrency.trim() === '' ? 'CNY' : planCurrency.trim(),
                    periodLabel: period,
                    effectiveFrom: 0,
                  }
                  : undefined,
                mode === 'metered'
                  ? { manualBalanceMicros: balanceMicros ?? 0, autoFetchBalance: canAutoFetch && autoFetch }
                  : undefined,
              )
            }}
          >
            {t('planSave')}
          </Button>
        </>
      )}
    >
      <div className={css.planFormVertical} data-testid={`finance-provider-form-${provider}`}>
        {/* 联动总开关：付费类型决定下面哪些字段组出现。 */}
        <div className={css.fieldGroup}>
          <span className={css.balanceNote}>{t('colBillingType')}</span>
          <SegmentedControl<FinanceProviderBillingMode>
            options={BILLING_MODES.map((value) => ({ value, label: billingLabel(value, t) }))}
            value={mode}
            onChange={setMode}
            ariaLabel={`${t('colBillingType')}: ${provider}`}
          />
        </div>
        {mode === 'plan'
          ? (
            <>
              <label className={css.fieldGroup}>
                <span className={css.balanceNote}>{t('planMonthly')}</span>
                <Input
                  className={css.planInput}
                  type="text"
                  inputMode="decimal"
                  aria-label={`${t('planMonthly')}: ${provider}`}
                  value={fee}
                  aria-invalid={feeInvalid}
                  onChange={(event) => setFee(event.currentTarget.value)}
                />
              </label>
              <label className={css.fieldGroup}>
                <span className={css.balanceNote}>{t('planCurrency')}</span>
                <Input
                  className={css.planInput}
                  type="text"
                  aria-label={`${t('planCurrency')}: ${provider}`}
                  value={planCurrency}
                  onChange={(event) => setPlanCurrency(event.currentTarget.value)}
                />
              </label>
              <div className={css.fieldGroup}>
                <span className={css.balanceNote}>{t('planPeriod')}</span>
                <SegmentedControl<FinancePlanPeriod>
                  options={FINANCE_PLAN_PERIODS.map((value) => ({ value, label: periodLabel(value, t) }))}
                  value={period}
                  onChange={setPeriod}
                  ariaLabel={`${t('planPeriod')}: ${provider}`}
                />
              </div>
              {feeInvalid ? <span className={css.tag}>{t('planInvalidFee')}</span> : null}
            </>
          )
          : null}
        {mode === 'metered'
          ? (
            <>
              <label className={css.fieldGroup}>
                <span className={css.balanceNote}>{t('manualBalanceLabel')}</span>
                <Input
                  className={css.planInput}
                  type="text"
                  inputMode="decimal"
                  aria-label={`${t('manualBalanceLabel')}: ${provider}`}
                  value={balance}
                  aria-invalid={balanceInvalid}
                  onChange={(event) => setBalance(event.currentTarget.value)}
                />
              </label>
              <span className={css.fieldGroup} title={canAutoFetch ? undefined : t('autoFetchUnsupported')}>
                <Checkbox
                  label={t('autoFetchLabel')}
                  checked={canAutoFetch && autoFetch}
                  disabled={!canAutoFetch}
                  onChange={setAutoFetch}
                />
              </span>
              {balanceInvalid ? <span className={css.tag}>{t('planInvalidBalance')}</span> : null}
            </>
          )
          : null}
        {mode === 'free' ? <p className={css.hint}>{t('freeModeHint')}</p> : null}
      </div>
    </Modal>
  )
}

/** 详情 modal：厂商全部已知属性，只读呈现（来源 / 宿主元数据 / 用户配置 / 余额 / 对比结论）。 */
function ProviderDetailModal({ provider, mode, row, plan, insight, spend, currency, ledger, t, onClose }: {
  provider: string
  mode: FinanceProviderBillingMode
  row: FinanceListProvidersEntry | undefined
  plan: FinancePlanEntry | undefined
  insight: { savingsMicros: number; discountRate: number | null; breakEvenRatio: number | null } | undefined
  spend: number
  currency: string
  ledger: FinanceLedger
  t: FinanceTranslate
  onClose: () => void
}): ReactNode {
  const balance = row?.balance
  /**
   * 详情字段**分组**呈现（2026-09-21 用户反馈「可读性做的不好，不易读」）。
   *
   * 原来 17 行全部同级平铺：既看不出"哪些是宿主给的、哪些是我自己配的"，
   * 也找不到余额/月费在哪；屏幕阅读器同样读作 17 条并列。
   * 按**信息来源与用途**分三组（三组各自内部才有可比性）：
   *  1. 计费方式：宿主判定 + 我打的标记（谁决定这行怎么算钱）
   *  2. 余额与支出：金额事实（INV-9 来源三态都落在这里）
   *  3. 订阅与节省：套餐配置 + 与按量价的对比结论
   */
  const groups: Array<{ title: string; rows: Array<{ label: string; value: ReactNode }> }> = [
    {
      title: t('detailGroupBilling'),
      rows: [
        { label: t('colBillingType'), value: billingLabel(mode, t) },
        {
          label: t('detailDefaultMode'),
          value: row?.hostMeta === undefined ? t('detailNone') : billingLabel(row.hostMeta.defaultBillingMode, t),
        },
        { label: t('detailDefaultCurrency'), value: row?.hostMeta?.defaultCurrency ?? t('detailNone') },
        {
          label: t('detailLock'),
          value: row?.hostMeta?.lockBillingModeAndCurrency === true ? t('detailYes') : t('detailNo'),
        },
        { label: t('detailSources'), value: (row?.sources ?? []).length > 0 ? (row?.sources ?? []).join(', ') : t('detailNone') },
      ],
    },
    {
      title: t('detailGroupBalance'),
      rows: [
        {
          label: t('balanceLabel'),
          value: balance === undefined ? t('detailNone') : balanceValue({ currency } as FinanceLedger, balance, t),
        },
        { label: t('meteredSpend'), value: <Money micros={spend} currency={currency} exact /> },
        {
          label: t('detailSupportsFetch'),
          value: row?.hostMeta === undefined ? t('detailNone') : row.hostMeta.supportsBalanceFetch ? t('autoFetchLabel') : t('balanceUnsupported'),
        },
        {
          label: t('manualBalanceLabel'),
          value: row?.userEntry?.manualBalanceMicros === undefined
            ? t('detailNone')
            : <Money micros={row.userEntry.manualBalanceMicros} currency={row.userEntry.currency} exact />,
        },
        {
          label: t('autoFetchLabel'),
          value: row?.userEntry === undefined ? t('detailNone') : row.userEntry.autoFetchBalance ? t('detailYes') : t('detailNo'),
        },
      ],
    },
    {
      title: t('detailGroupPlan'),
      rows: [
        {
          label: t('planMonthly'),
          value: plan === undefined ? t('detailNone') : <Money micros={plan.monthlyMicros} currency={plan.currency} exact />,
        },
        { label: t('planPeriod'), value: plan?.periodLabel === undefined ? t('detailNone') : periodLabel(plan.periodLabel, t) },
        { label: t('planCurrency'), value: row?.userEntry?.currency ?? t('detailNone') },
        {
          label: t('detailQuota'),
          value: plan?.quotaTokens === undefined ? t('detailNone') : String(plan.quotaTokens),
        },
        {
          label: t('planSavingsCol'),
          value: insight === undefined ? t('planNoUsage') : <Money micros={insight.savingsMicros} currency={currency} exact />,
        },
        {
          // label 走**无占位符**的 key：原来用 `planDiscount`（值是「折扣 {pct}」）而 t()
          // 没传 pct → 占位符原样上屏（图片6 实测「折扣 {pct}」）。标签与数值分开即可。
          label: t('planDiscountCol'),
          value: insight?.discountRate == null ? t('planNoUsage') : `${Math.round(insight.discountRate * 100)}%`,
        },
        {
          label: t('planBreakEvenCol'),
          value: insight?.breakEvenRatio == null ? t('planNoUsage') : `${Math.round(insight.breakEvenRatio * 100)}%`,
        },
      ],
    },
  ]
  return (
    // 只读详情弹窗不放「取消」footer：点遮罩 / 右上角关闭钮 / Esc 都能关，
    // 一个纯关闭按钮只重复这三条路径（2026-09 用户反馈）。
    <Modal open onClose={onClose} title={`${t('providerDetailTitle')} · ${provider}`}>
      <div className={css.detailList} data-testid={`finance-provider-detail-${provider}`}>
        {groups.map((group) => (
          <section key={group.title} className={css.detailGroup} aria-label={group.title}>
            <h4 className={css.detailGroupTitle}>{group.title}</h4>
            {group.rows.map((item) => (
              <div key={item.label} className={css.detailRow}>
                <span className={css.detailLabel}>{item.label}</span>
                <span className={css.detailValue}>{item.value}</span>
              </div>
            ))}
          </section>
        ))}
      </div>

      {/* SPEC §10.5：额度触达逐条明细 —— 只读，不可编辑。
          这是"被挡在门外"的原始证据：时间 / 窗口 / 厂商码 / 尝试次数 / 是否终态 / 重置。 */}
      <QuotaHitList ledger={ledger} provider={provider} t={t} />
    </Modal>
  )
}

function periodLabel(period: FinancePlanPeriod, t: FinanceTranslate): string {
  if (period === 'month-week') return t('periodMonthWeek')
  if (period === 'month-week-5h') return t('periodMonthWeek5h')
  return t('periodMonth')
}

/** 额度窗口标签（SPEC §10.3 的六种窗口）。 */
function quotaWindowLabel(window: FinanceQuotaWindow, t: FinanceTranslate): string {
  if (window === '5h') return t('quotaWindow5h')
  if (window === 'week') return t('quotaWindowWeek')
  if (window === 'month') return t('quotaWindowMonth')
  if (window === 'balance') return t('quotaWindowBalance')
  if (window === 'trial') return t('quotaWindowTrial')
  return t('quotaWindowUnknown')
}

/**
 * 每 provider 的触达明细（详情弹窗用），按时间倒序。
 *
 * 2026-09-21 起额度信号的**唯一呈现处**就是详情弹窗（`QuotaHitList`）：
 * 表内 pill 已移除（SPEC §10.5 修订），所以这个 helper 不再被表格路径调用。
 */
function quotaEpisodesOf(ledger: FinanceLedger, provider: string): readonly FinanceQuotaEpisodeRow[] {
  const key = providerKey(provider)
  return (ledger.quota?.episodes ?? []).filter((episode) => providerKey(episode.provider) === key)
}

function balanceValue(ledger: FinanceLedger, balance: FinanceProviderBalance, t: FinanceTranslate): ReactNode {
  if (balance.status === 'ok' && balance.totalMicros !== undefined) {
    const currency = balance.currency === undefined || balance.currency === '' ? ledger.currency : balance.currency
    // INV-9：手填值与自动获取值可区分 —— 走**悬浮提示**（权威正文在详情弹窗的
    // 「手动余额」行）。2026-09-21 起不再挂「手填」角标：表格列窄，tag 挤金额。
    return (
      <span title={balance.source === 'manual' ? t('manualBalanceLabel') : undefined}>
        <Money micros={balance.totalMicros} currency={currency} />
      </span>
    )
  }
  // 非金额的余额状态是**文字**（最长「该厂商没有余额查询接口」≈132px），而这一列
// 在窄面板下只有 ~104px → 会被 `.cell` 的 ellipsis 截断。挂 title 保住全文
// （UI-UX-SPEC §4.5：关键结论不允许被省略号吃掉）。
  if (balance.status === 'missing-credential') return <span title={t('balanceMissingKey')}>{t('balanceMissingKey')}</span>
  if (balance.status === 'unsupported') return <span title={t('balanceUnsupported')}>{t('balanceUnsupported')}</span>
  return <span title={t('balanceError')}>{t('balanceError')}</span>
}

/**
 * 该 provider 的额度触达摘要（详情弹窗用）。
 *
 * 2026-09-21：表内 pill 移除后，这条摘要**接管**了 pill 原先承载的三态文案
 * （能算倒计时 → 倒计时；只有原文 → 原文；都没有 → 只报次数），口径与原
 * `quotaPillLabel` 逐字一致 —— 信号没丢，只是从"一眼可见"降到"点进详情可见"。
 */
function quotaSummaryText(row: FinanceQuotaProviderRow, episodes: readonly FinanceQuotaEpisodeRow[], t: FinanceTranslate): string {
  const countdown = resetCountdown(row.nextResetAtMs, Date.now())
  if (countdown !== null) return t('quotaPillReset', { hits: row.hits, countdown })
  const raw = episodes.find((episode) => episode.resetRaw !== null)?.resetRaw
  if (raw !== undefined && raw !== null) return t('quotaPillResetRaw', { hits: row.hits, raw })
  return t('quotaPill', { hits: row.hits })
}

/**
 * 额度触达逐条明细（SPEC §10.5）—— 只读列表，挂在供应商详情弹窗里。
 *
 * 为什么放在详情而不是主表：主表列宽是稀缺资源（UI-UX-SPEC §3.5），
 * 而这里是"偶尔要查证"的信息（哪次、哪个窗口、厂商码、重试了几次）。
 * 2026-09-21 用户裁决后，这里更是额度信号的**唯一**呈现处。
 *
 * 三种"已知程度"如实呈现，不猜：能算出倒计时就给倒计时，只有原文就给原文，
 * 都没有就只显示次数（`resetAtMs` 缺失不是错误，是厂商没给时区）。
 */
function QuotaHitList({ ledger, provider, t }: {
  ledger: FinanceLedger
  provider: string
  t: FinanceTranslate
}): ReactNode {
  const episodes = quotaEpisodesOf(ledger, provider)
  const row = (ledger.quota?.rows ?? []).find((entry) => providerKey(entry.provider) === providerKey(provider))
  if (row === undefined) return null

  return (
    <div className={css.quotaHits} data-testid={`finance-quota-hits-${provider}`}>
      <div className={css.quotaHitsHead}>
        <span className={css.detailLabel}>{t('quotaDetailTitle')}</span>
        {/* 摘要行 = 原表内 pill 的文案（hits + 重置倒计时/原文）。 */}
        <span className={css.hint} data-testid={`finance-quota-${provider}`}>
          {quotaSummaryText(row, episodes, t)}
        </span>
      </div>
      <div className={css.table}>
        <div className={`${css.tableHead} ${css.colsQuotaHits}`}>
          <span className={css.cell}>{t('quotaColTime')}</span>
          <span className={css.cell}>{t('quotaColWindow')}</span>
          <span className={css.cell}>{t('quotaColVendor')}</span>
          <span className={`${css.cell} ${css.cellNum}`}>{t('quotaColAttempts')}</span>
          <span className={css.cell}>{t('quotaColReset')}</span>
        </div>
        {episodes.map((episode) => {
              const countdown = resetCountdown(episode.resetAtMs, Date.now())
              const resetText = countdown !== null
                ? countdown
                : episode.resetRaw ?? '—'
              return (
                <div key={`${episode.modelKey}-${String(episode.firstAtMs)}`} className={`${css.tableRow} ${css.colsQuotaHits}`}>
                  <span className={css.cell}>{new Date(episode.lastAtMs).toLocaleString()}</span>
                  <span className={css.cell}>
                    {quotaWindowLabel(episode.window, t)}
                    {/* 终态 vs 重试中：只有见过 turn/end 才是确认终止。 */}
                    {!episode.final ? <Pill className={css.quotaPill}>{t('quotaRetrying')}</Pill> : null}
                  </span>
                  <span className={css.cell}>{episode.vendorCode ?? '—'}</span>
                  <span className={`${css.cell} ${css.cellNum}`}>{episode.attempts}</span>
                  <span className={css.cell} title={episode.resetRaw ?? undefined}>{resetText}</span>
                </div>
              )
        })}
      </div>
    </div>
  )
}
