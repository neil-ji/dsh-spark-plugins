/**
 * 窗口归因 Card（SPEC §10.8）—— 追加在「本月值不值」子页。
 *
 * 回答用户的原话问题：*"撞墙时最近一个周期到底用了哪些模型、用在了哪里、用了多少、用了多久"*。
 *
 * 三个窗口（近 5 小时 / 近一周 / 近一月）由宿主一次性切好（`ledger.windows`），
 * 本组件只做呈现与窗口切换 —— 聚合口径全在宿主，客户端不重算（避免第二份逻辑）。
 *
 * 双值性价比（用户 2026-09-19 裁决）：
 *  - **窗口估价** = 订阅月费 × 窗口长度 ÷ 30 天（周期均值）；
 *  - **按量等价** = 该窗口用量按目录价折算；
 *  - 二者之差是"这个窗口用订阅划不划算"的明确相对标准。
 *
 * 口径与既有月度 `planInsight` 是**同一公式、不同分母**，两处数字天然自洽。
 *
 * 克制的文案口径（沿用既有偏好）：不摆"正常/优秀"评价，不做推测性预警；
 * 只在有数据时呈现数字，空窗口给一句说明而不是空表。
 */

import { useState, type ReactNode } from 'react'
import { Card, CellText, Money, Pill, SegmentedControl, Stat, StatGrid, formatMoneyMicros } from 'dsh-ui-kit'
import type {
  FinanceLedger,
  FinancePlanEntry,
  FinanceQuotaWindowSpan,
  FinanceQuotaWindowSummary,
} from 'dsh-spark-finance/types'
import { formatDuration, formatTokens, providerKey, windowPlanVerdict } from '../derive.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface QuotaWindowCardProps {
  ledger: FinanceLedger
  plans: readonly FinancePlanEntry[]
  t: FinanceTranslate
}

const SPANS: readonly FinanceQuotaWindowSpan[] = ['5h', 'week', 'month']

/** 窗口长度（毫秒）—— 与宿主 `WINDOW_SPANS` 逐字一致（名义月长 30 天）。 */
const SPAN_MS: Record<FinanceQuotaWindowSpan, number> = {
  '5h': 5 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
}

/**
 * 该窗口里占比最高的订阅 provider 的月费（用于双值性价比）。
 *
 * 一个窗口可能横跨多家厂商：取**花费最高的订阅厂商**作为性价比参照 ——
 * 这是唯一有意义的选法（拿用量最大的那家月费去比别家的量会得出假结论）。
 * 没有任何订阅厂商时返回 undefined（UI 显示"未填月费，无法算出性价比"）。
 */
function dominantPlanFee(
  window: FinanceQuotaWindowSummary,
  plans: readonly FinancePlanEntry[],
): number | undefined {
  const feeByProvider = new Map(plans.map((plan) => [providerKey(plan.provider), plan.monthlyMicros]))
  for (const row of window.models) {
    const fee = feeByProvider.get(providerKey(row.provider))
    if (fee !== undefined && fee > 0) return fee
  }
  return undefined
}

export function QuotaWindowCard({ ledger, plans, t }: QuotaWindowCardProps): ReactNode {
  const [span, setSpan] = useState<FinanceQuotaWindowSpan>('5h')
  const windows = ledger.windows ?? []
  const current = windows.find((window) => window.span === span)

  // 旧宿主 / 没有窗口数据：不出卡（不摆空壳，与"无触达不显示角标"同一克制口径）。
  if (current === undefined) return null

  const planFee = dominantPlanFee(current, plans)
  const verdict = windowPlanVerdict(current.costMicros, SPAN_MS[span], planFee)
  const currency = ledger.currency === '' ? 'CNY' : ledger.currency
  const hasDuration = current.decodeMs > 0
  // 表头与数据行必须共用同一套列宽：两个 grid 各自算宽会错位（UI-UX-SPEC §3.5 第 5 条）。
  const cols = hasDuration ? css.colsQuotaWindow : css.colsQuotaWindowNoDuration

  return (
    <Card
      title={t('windowCardTitle')}
      className={css.section}
      actions={(
        <SegmentedControl
          aria-label={t('windowCardTitle')}
          value={span}
          onChange={(value) => setSpan(value as FinanceQuotaWindowSpan)}
          options={SPANS.map((value) => ({
            value,
            label: value === '5h' ? t('windowSpan5h') : value === 'week' ? t('windowSpanWeek') : t('windowSpanMonth'),
          }))}
        />
      )}
    >
      <div data-testid="finance-quota-window">
        <StatGrid>
          {/* 性价比结论挂在**「按量等价」数值的正下方**（2026-09-21 用户裁决）：
              这句话说的就是这个数字与订阅估价的关系，之前单独占一行正文、飘在三个
              指标卡下面，既与指标区割裂、又要读者自己把句子和上面的数字对上。
              只在真能算出来时给（savingsMicros === null → 不带 description）。 */}
          <Stat
            label={t('windowEquivalent')}
            value={<Money micros={verdict.equivalentMicros} currency={currency} exact />}
            description={verdict.savingsMicros === null
              ? undefined
              : (verdict.savingsMicros >= 0
                ? t('windowSavingsUp', { amount: formatMoneyMicros(verdict.savingsMicros, currency) })
                : t('windowSavingsDown', { amount: formatMoneyMicros(-verdict.savingsMicros, currency) }))}
          />
          <Stat
            label={t('windowPlanned')}
            value={verdict.plannedMicros === null
              ? '—'
              : <Money micros={Math.round(verdict.plannedMicros)} currency={currency} exact />}
          />
          <Stat label={t('windowColTokens')} value={formatTokens(
            current.usage.uncachedInputTokens + current.usage.cacheReadTokens
            + current.usage.cacheWriteTokens + current.usage.outputTokens,
          )} />
        </StatGrid>

        {/* 本卡混合了「指标区 + 模型明细」两类内容 → 表格包一层 inset 子卡，
            与外层表单形成可辨层级（ui-kit Card variant=inset；先例见项目详情）。 */}
        {current.models.length === 0
          ? null
          : (
            <Card variant="inset" title={t('windowTableTitle')}>
              <div className={css.table}>
                <div className={`${css.tableHead} ${cols}`}>
                  <span className={css.cell}>{t('windowColModel')}</span>
                  <span className={`${css.cell} ${css.cellNum}`}>{t('windowColTokens')}</span>
                  {hasDuration ? <span className={`${css.cell} ${css.cellNum}`}>{t('windowColDuration')}</span> : null}
                  <span className={`${css.cell} ${css.cellNum}`}>{t('windowColCost')}</span>
                </div>
                {current.models.map((row) => {
                  const total = row.usage.uncachedInputTokens + row.usage.cacheReadTokens
                    + row.usage.cacheWriteTokens + row.usage.outputTokens
                  return (
                    <div key={row.modelKey} className={`${css.tableRow} ${cols}`}>
                      {/* 模型名允许换行、最多 2 行（UI-UX-SPEC §3.5）。**不传 `css.cell`** ——
                          那个类带 `white-space: nowrap`，会把 CellText 的 2 行截断压回
                          单行（2026-09-21 实测：clamp 静默失效）。换行语义归 CellText 所有。 */}
                      <CellText className={css.cellTextOnly} text={row.modelKey} />
                      <span className={`${css.cell} ${css.cellNum}`}>{formatTokens(total)}</span>
                      {hasDuration
                        ? <span className={`${css.cell} ${css.cellNum}`}>{formatDuration(row.decodeMs)}</span>
                        : null}
                      <span className={`${css.cell} ${css.cellNum}`}>
                        <Money micros={row.costMicros} currency={currency} exact />
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
      </div>
    </Card>
  )
}