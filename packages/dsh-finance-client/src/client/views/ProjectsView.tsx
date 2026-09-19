/**
 * 视图④：项目账。
 *
 * 项目 = 工作区（ledger.byWorkspace）；点进去看该项目的时间趋势与会话明细。
 * 列表是表格形制：项目（名称+会话数合并渲染）、消耗（按量现金 + 订阅估价合并渲染）、
 * 总 token、总耗时（速率推算，标注估算）。
 */

import { useState, type ReactNode } from 'react'
import { Button, Card, CellText, EmptyState, Money, TrendChart, formatMicros } from 'dsh-ui-kit'
import type { FinanceLedger, FinancePlanEntry, FinanceSessionRow } from 'dsh-spark-finance/types'
import { formatTokens, projectCostRows, sessionsOfWorkspace, sessionsTrend } from '../derive.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface ProjectsViewProps {
  ledger: FinanceLedger
  /** 已填套餐（订阅估价需要月费与计费形态）。 */
  plans: readonly FinancePlanEntry[]
  t: FinanceTranslate
}

/** 账本里 workspaceId 可能是 null（未归属工作区的会话），用哨兵字符串做选择键。 */
const NO_WORKSPACE = 'none'

export function ProjectsView({ ledger, plans, t }: ProjectsViewProps): ReactNode {
  const [selected, setSelected] = useState<string | null>(null)
  const currency = ledger.currency === '' ? 'CNY' : ledger.currency
  const rows = projectCostRows(ledger, plans)

  if (rows.length === 0) {
    return (
      <div data-testid="finance-projects-empty">
        <EmptyState message={t('projectsEmptyTitle')} hint={t('projectsEmptyHint')} />
      </div>
    )
  }

  const current = selected === null ? undefined : rows.find((row) => keyOf(row) === selected)
  if (current !== undefined) {
    return <ProjectDetail row={current} ledger={ledger} currency={currency} t={t} onBack={() => setSelected(null)} />
  }
  return (
    <Card title={t('projectsTitle')} className={css.section}>
      <div className={css.table} data-testid="finance-projects">
        <div className={cx(css.tableHead, css.colsProjectCost)}>
          <span className={css.cell}>{t('colProject')}</span>
          <span className={cx(css.cell, css.cellNum)} title={t('projectCostHint')}>{t('colCost')}</span>
          <span className={cx(css.cell, css.cellNum)}>{t('colTokensTotal')}</span>
          <span className={cx(css.cell, css.cellNum)} title={t('durationHint')}>{t('colDuration')}</span>
        </div>
        {rows.map((row) => (
          <div
            key={keyOf(row)}
            className={cx(css.tableRow, css.colsProjectCost, css.projectRow)}
            data-testid={`finance-project-${keyOf(row)}`}
            onClick={() => setSelected(keyOf(row))}
            onKeyDown={(event) => { if (event.key === 'Enter') setSelected(keyOf(row)) }}
            role="button"
            tabIndex={0}
            aria-label={`${displayTitle(row, t)} · ${t('colCost')} ${formatMicros(row.totalMicros)}`}
          >
            <span className={css.cell}>
              {/* 合并渲染：项目名 + 会话数副行。 */}
              <span className={css.balanceName}><CellText text={displayTitle(row, t)} /></span>
              <span className={css.detailText}>{t('projectSessions', { count: row.sessionCount })}</span>
            </span>
            <span className={cx(css.cell, css.cellNum)}>
              {/* 列表只给总成本；按量/订阅估价拆分进详情看。 */}
              <Money micros={row.totalMicros} currency={currency} exact />
            </span>
            <span className={cx(css.cell, css.cellNum)}>{formatTokens(row.totalTokens)}</span>
            <span className={cx(css.cell, css.cellNum)}>{formatDuration(row.durationSeconds, t)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function ProjectDetail({ row, ledger, currency, t, onBack }: {
  row: { workspaceId: string | null; title: string; meteredMicros: number; planEstimateMicros: number; totalMicros: number }
  ledger: FinanceLedger
  currency: string
  t: FinanceTranslate
  onBack: () => void
}): ReactNode {
  const sessions = sessionsOfWorkspace(ledger, row.workspaceId)
  const points = sessionsTrend(sessions)
  const title = row.title === '' ? t('otherProjects') : row.title
  return (
    <Card
      title={
        <span className={css.backRow}>
          {/* 返回是导航动作，不是本视图的主操作：按 UI-UX-SPEC §3.1「一屏一个 primary」
              取次形制（卡片题头内用 sm，与 22px 的题头行同阶）。 */}
          <Button variant="secondary" size="sm" onClick={onBack} aria-label={t('projectBack')}>{t('projectBack')}</Button>
          <span className={css.projectTitle}>{title}</span>
        </span>
      }
      className={css.section}
    >
      {/* 消耗拆分（列表只显示总额；按量/订阅估价在这里看）。 */}
      <div className={css.projectCostSplit} data-testid="finance-project-cost-split" title={t('projectCostHint')}>
        <span className={css.detailText}>
          {t('consumeMetered')} <Money micros={row.meteredMicros} currency={currency} exact />
          {' · '}
          {t('planEstimateShort')} <Money micros={row.planEstimateMicros} currency={currency} exact />
          {' · '}
          {t('colCost')} <Money micros={row.totalMicros} currency={currency} exact />
        </span>
      </div>
      {/* 明细分块改为嵌套 Card（与「成本总览」同形制，只是嵌在项目卡内）。 */}
      <div className={css.section} data-testid="finance-project-detail">
        <Card variant="inset" title={t('trendTitle')} actions={<span className={css.tagMuted}>{t('trendRange', { days: points.length })}</span>}>
          {/* 数据不足（<2 天）画不出趋势：给空占位而不是一块空白画布。 */}
          {points.length < 2
            ? <EmptyState message={t('projectTrendEmpty')} />
            : <TrendChart points={points} ariaLabel={t('projectTrendTitle', { title })} formatValue={formatMicros} gradientId="finance-project-trend" />}
        </Card>
        <Card variant="inset" title={t('projectSessionsTitle')} actions={<span className={css.tagMuted}>{t('projectSessions', { count: sessions.length })}</span>}>
          <div className={css.table}>
            <div className={`${css.tableHead} ${css.colsSessions}`}>
              <span className={css.cell}>{t('colSession')}</span>
              <span className={css.cell}>{t('colDate')}</span>
              <span className={css.cell}>{t('colModel')}</span>
              <span className={`${css.cell} ${css.cellNum}`}>{t('colCost')}</span>
            </div>
            {sessions.map((session) => (
              <SessionRow key={session.sessionId} session={session} currency={currency} t={t} />
            ))}
          </div>
        </Card>
      </div>
    </Card>
  )
}

function SessionRow({ session, currency, t }: { session: FinanceSessionRow; currency: string; t: FinanceTranslate }): ReactNode {
  const model = session.modelKeys.length === 0 ? null : session.modelKeys[0]
  return (
    <div className={`${css.tableRow} ${css.colsSessions}`}>
      {/* 文本列统一最多两行截断 + 悬浮全文（会话名悬浮换 sessionId）。 */}
      <span className={`${css.cell} ${css.clamp2}`} title={session.sessionId}>
        {session.title === null || session.title === '' ? t('untitledSession') : session.title}
      </span>
      <span className={`${css.cell} ${css.clamp2}`} title={new Date(session.createdAt).toLocaleString()}>
        {new Date(session.createdAt).toLocaleDateString()}
      </span>
      <span className={`${css.cell} ${css.modelKey} ${css.clamp2}`} title={model ?? undefined}>
        {model ?? t('noData')}
      </span>
      <span className={`${css.cell} ${css.cellNum}`}><Money micros={session.costMicros} currency={currency} exact /></span>
    </div>
  )
}

function displayTitle(row: { title: string }, t: FinanceTranslate): string {
  return row.title === '' ? t('otherProjects') : row.title
}

function keyOf(row: { workspaceId: string | null }): string {
  return row.workspaceId ?? NO_WORKSPACE
}

/** 秒 → 人读时长（<1h 给分钟，其余给一位小数的小时）；无样本给「暂无数据」。 */
function formatDuration(seconds: number | null, t: FinanceTranslate): string {
  if (seconds === null || seconds <= 0) return t('noData')
  if (seconds < 3600) return t('durationMinutes', { m: Math.max(1, Math.round(seconds / 60)) })
  return t('durationHours', { h: (seconds / 3600).toFixed(1) })
}

const cx = (...names: string[]): string => names.join(' ')
