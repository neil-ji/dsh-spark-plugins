/**
 * 视图③：怎么调度更省。
 *
 * 两张可立刻行动卡：错峰执行、把缓存用起来。每个金额都标注「估算」并给出
 * 口径；没有可操作空间时直说没有，不硬凑一个数字。
 */

import type { ReactNode } from 'react'
import { Card, EmptyState, Money, StackedBar, formatMoneyMicros } from 'dsh-ui-kit'
import type { FinanceLedger, FinanceTierGroup } from 'dsh-spark-finance/types'
import {
  cacheExtremes,
  contextProfile,
  estimateCacheSavings,
  formatPercent,
  formatTokens,
  modelComparisonRows,
  peakShare,
  smallestTierCeiling,
  splitEstimateForModel,
  tierGroupFor,
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
  /**
   * 拆分卡只渲染**命中阶梯价**的模型（2026-09-21 用户裁决）。
   *
   * 动机（用户原话）：「此处改为仅渲染我们已知支持梯度上下文 size 的模型，没命中的
   * 模型没必要展示在这里」。原先把"有用量但没填阶梯价"的模型也列出来，那一列全是
   * 「—」—— 一行只有模型名和破折号，纯噪声，还让真正有结论的行被淹没
   * （用户截图里 5 行有 4 行是「—」）。
   *
   * 判据用 `tierGroupFor(...).status === 'found'`（**有价表**），而不是
   * `outcome.status === 'ok'`：币种不匹配 / 生效窗口不覆盖也属"我们确实知道它有
   * 梯度价"，必须展示并说明原因 —— 否则用户会以为这张表根本没收录该模型
   * （SPEC §2.3 规则 5：静默不展示 = 静默失败）。
   */
  const tieredRows = rows.filter((row) => (row.context ?? []).length > 0 && tierGroupFor(tiers, row.modelKey).status !== 'none')

  return (
    <>
      <Card title={t('peakCardTitle')} className={css.section}>
        {/* 空态（2026-09-21 用户裁决「缺乏空占位」）：无可省金额、也没有构成数据时
            给 EmptyState，**而不是静默 null** —— 静默的后果是整张卡只剩一行标题，
            看起来像渲染坏了（用户截图实测：卡高 48px、正文仅 8 字符）。
            与 2026-09-20 退役的**解释性散文**区分：那时删掉的是"你的价目表没有峰谷
            窗口，或近期没有高峰时段用量"这类**技术推理**；现在补的是"这里缺什么"的
            空占位。口径见 UI-UX-SPEC §4.4「Empty」。 */}
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
          ? (peak.shiftSavingsMicros > 0
            // 有金额但没有构成数据：金额本身已是内容，不必再补占位。
            ? null
            : <EmptyState message={t('peakEmpty')} />)
          : (
            /* 100% 堆叠条：条本体占满卡片宽度，各档宽度即真实占比。
               不用 BarChart —— 它按 niceCeil 归一，实测最大档只占 ~52%，看构成是错的信号。 */
            <StackedBar
              rows={bands}
              ariaLabel={t('peakCardTitle')}
              formatValue={(v) => formatMoneyMicros(v, currency)}
            />
          )}
      </Card>

      <Card title={t('cacheCardTitle')} className={css.section}>
        {/* 空态同上：无可估算的跨供应商差异时给占位，不留一行光标题。 */}
        {savings === null || extremes === null
          ? <EmptyState message={t('cacheEmpty')} />
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
        {/* 本卡混合了「被取代提示 + 明细表」两类内容 → 表格包一层 inset 子卡，
            与外层卡形成可辨层级（ui-kit Card variant=inset）。 */}
        {tieredRows.length === 0
          ? <EmptyState message={t('contextEmpty')} />
          : (
            <Card variant="inset" title={t('contextTableTitle')}>
            <div className={css.table} data-testid="finance-context-card">
              {/* 列头**不写死阈值**：分界线由各模型自己的价表决定（32k/128k/256k…），
                  同一张表里不同模型的分界可能不同 —— 所以阈值落在**每个单元格**里，
                  列头只说"相对你价表最小档要多付的输入占比"。 */}
              <div className={`${css.tableHead} ${css.colsContext}`}>
                <span className={css.cell}>{t('colModel')}</span>
                <span className={css.cell} title={t('contextCardHint')}>{t('colContextShare')}</span>
                <span className={css.cell} title={t('contextNote')}>{t('colSavingUpper')}</span>
              </div>
              {tieredRows.map((row) => {
                const buckets = row.context ?? []
                const outcome = splitEstimateForModel(buckets, tiers, row.modelKey, ledger.currency, ledger.generatedAt)
                // 分界线取**该模型价表的最小档**（与 splitEstimate 同源），不在视图里写死。
                // 注意：`tierGroupFor` 对"多套变体"返回 ambiguous、对"没有价"返回 none，
                // 两种都没有分界线 → 不编造，占比列给「—」。
                const lookup = tierGroupFor(tiers, row.modelKey)
                const ceiling = lookup.status === 'found' ? smallestTierCeiling(lookup.group.tiers) : null
                const profile = ceiling === null ? null : contextProfile(buckets, ceiling)
                return (
                  <div className={`${css.tableRow} ${css.colsContext}`} key={`context:${row.modelKey}`} data-testid={`finance-context-${row.modelKey}`}>
                    {/* 模型 + 厂商合并为一列 provider/model：可换行、两行截断、悬浮全文。 */}
                    <span className={`${css.cell} ${css.modelKey} ${css.clamp2}`} title={`${row.provider}/${row.model}`}>
                      {row.provider}/{row.model}
                    </span>
                    <span className={`${css.cell} ${css.cellWrap}`} data-testid={`finance-context-above-${row.modelKey}`}>
                      {profile === null || profile.shareAbove === null
                        ? '—'
                        : t('contextAboveShare', { pct: formatPercent(profile.shareAbove), tokens: formatTokens(ceiling ?? 0) })}
                    </span>
                    <span className={`${css.cell} ${css.cellWrap}`} data-testid={`finance-context-cost-${row.modelKey}`}>
                      {outcome.status === 'ok'
                        ? (
                          <span className={css.tagMuted}>
                            {formatMoneyMicros(Math.round(outcome.estimate.savedMicros), currency)} · <span className={css.estimate}>{t('estimateTag')}</span>
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
            </Card>
          )}
      </Card>
    </>
  )
}
