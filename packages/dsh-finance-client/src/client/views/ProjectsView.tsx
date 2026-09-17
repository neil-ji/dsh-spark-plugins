/**
 * 视图④：项目账。
 *
 * 项目 = 工作区（ledger.byWorkspace）；点进去看该项目的时间趋势与会话明细。
 * 趋势点由会话时间戳聚合而来——账本没有按工作区的日粒度，所以这里用的是
 * 「你自己的会话」这一手数据，不做任何补造。
 */

import { useState, type ReactNode } from 'react'
import { Button, Card, EmptyState, ListRow, Money, TrendChart, formatMicros } from 'dsh-ui-kit'
import type { FinanceLedger, FinanceSessionRow, FinanceWorkspaceRow } from 'dsh-spark-finance/types'
import { projectRows, sessionsOfWorkspace, sessionsTrend } from '../derive.ts'
import type { FinanceTranslate } from '../locales.ts'
import css from '../panel.module.css'

export interface ProjectsViewProps {
  ledger: FinanceLedger
  t: FinanceTranslate
}

/** 账本里 workspaceId 可能是 null（未归属工作区的会话），用哨兵字符串做选择键。 */
const NO_WORKSPACE = 'none'

export function ProjectsView({ ledger, t }: ProjectsViewProps): ReactNode {
  const [selected, setSelected] = useState<string | null>(null)
  const currency = ledger.currency === '' ? 'CNY' : ledger.currency
  const projects = projectRows(ledger)

  if (projects.length === 0) {
    return (
      <div data-testid="finance-projects-empty">
        <EmptyState message={t('projectsEmptyTitle')} hint={t('projectsEmptyHint')} />
      </div>
    )
  }

  const current = selected === null ? undefined : projects.find((candidate) => keyOf(candidate) === selected)
  if (current !== undefined) {
    return <ProjectDetail row={current} ledger={ledger} currency={currency} t={t} onBack={() => setSelected(null)} />
  }

  return (
    <Card title={t('projectsTitle')} className={css.section}>
      <div className={css.table} data-testid="finance-projects">
        {projects.map((row) => (
          <ListRow
            key={keyOf(row)}
            title={displayTitle(row, t)}
            meta={`${t('colSessions')} ${row.sessionCount}`}
            trailing={<Money micros={row.costMicros} currency={currency} />}
            accentColor="var(--spk-acc-finance)"
            onClick={() => setSelected(keyOf(row))}
          />
        ))}
      </div>
    </Card>
  )
}

function ProjectDetail({ row, ledger, currency, t, onBack }: {
  row: FinanceWorkspaceRow
  ledger: FinanceLedger
  currency: string
  t: FinanceTranslate
  onBack: () => void
}): ReactNode {
  const sessions = sessionsOfWorkspace(ledger, row.workspaceId)
  const points = sessionsTrend(sessions)
  const title = displayTitle(row, t)
  return (
    <Card
      title={
        <span className={css.backRow}>
          <Button onClick={onBack} aria-label={t('projectBack')}>{t('projectBack')}</Button>
          <span className={css.projectTitle}>{title}</span>
        </span>
      }
      className={css.section}
    >
      <div className={css.section} data-testid="finance-project-detail">
        <p className={css.hint}>{t('projectTrendTitle', { title })}</p>
        {points.length === 0
          ? <p className={css.hint}>{t('projectTrendEmpty')}</p>
          : <TrendChart points={points} ariaLabel={t('projectTrendTitle', { title })} formatValue={formatMicros} gradientId="finance-project-trend" />}
      </div>
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
  )
}

function SessionRow({ session, currency, t }: { session: FinanceSessionRow; currency: string; t: FinanceTranslate }): ReactNode {
  return (
    <div className={`${css.tableRow} ${css.colsSessions}`}>
      <span className={css.cell} title={session.sessionId}>
        {session.title === null || session.title === '' ? t('untitledSession') : session.title}
      </span>
      <span className={css.cell}>{new Date(session.createdAt).toLocaleDateString()}</span>
      <span className={`${css.cell} ${css.modelKey}`} title={session.modelKeys[0]}>{session.modelKeys.length === 0 ? t('noData') : session.modelKeys[0]}</span>
      <span className={`${css.cell} ${css.cellNum}`}><Money micros={session.costMicros} currency={currency} /></span>
    </div>
  )
}

function displayTitle(row: FinanceWorkspaceRow, t: FinanceTranslate): string {
  return row.title === '' ? t('otherProjects') : row.title
}

function keyOf(row: FinanceWorkspaceRow): string {
  return row.workspaceId ?? NO_WORKSPACE
}
