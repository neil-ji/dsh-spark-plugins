import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BarChart, Button, DonutChart, Input, SearchInput, SegmentedControl, Textarea, TrendChart,
  IconChevronDownOutline14, IconChevronLeftOutline14,
  IconChevronRightOutline14, IconChevronUpOutline14,
  IconEditOutline16, IconPlusOutline16, IconTrashOutline16,
  Menu, Pill,
} from 'dsh-ui-kit'
import type { ChartDatum } from 'dsh-ui-kit'
import type { HippomemoApi, MemoryTagCount } from './api.ts'
import type { HippomemoLocaleKey } from './locales.ts'
import type {
  CitationRecord, EvolveAction, EvolveActionType, EvolveReport, MemoryKind, MemoryListQuery, MemoryPatchInput,
  MemoryPutInput, MemoryRecord, MemoryScope, MemorySortKey, MemorySortOrder, MemoryStats,
  MemoryStatus, MemoryUsageStats,
} from '../types.ts'

type Translate = (key: HippomemoLocaleKey) => string

export interface MemorySectionProps {
  api: HippomemoApi
  t: Translate
}

const KINDS: MemoryKind[] = ['insight', 'decision', 'fact', 'preference', 'constraint']
const SCOPES: MemoryScope[] = ['global', 'workspace', 'project']
const STATUSES: MemoryStatus[] = ['active', 'archived', 'superseded', 'candidate']
const SORTS: { value: MemorySortKey; label: HippomemoLocaleKey }[] = [
  { value: 'updatedAt', label: 'sortUpdatedAt' },
  { value: 'createdAt', label: 'sortCreatedAt' },
  { value: 'importance', label: 'sortImportance' },
  { value: 'title', label: 'sortTitle' },
]
const PAGE_SIZES = [10, 20, 50]

type SectionTab = 'memories' | 'usage' | 'evolve'

interface SelectOption {
  value: string
  label: string
}

function HippomemoSelect({ value, placeholder, options, onChange }: {
  value: string
  placeholder: string
  options: SelectOption[]
  onChange: (value: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<'bottom' | 'top'>('bottom')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const selected = options.find(option => option.value === value)
  const label = selected?.label ?? placeholder

  const openMenu = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      setSide(spaceBelow >= 220 || spaceBelow >= spaceAbove ? 'bottom' : 'top')
    }
    setOpen(true)
  }

  return (
    <Menu
      open={open}
      portal
      side={side}
      anchor={(
        <Button
          ref={triggerRef}
          variant="outline"
          size="sm"
          className={open ? 'hippomemo-select hippomemo-select-open' : 'hippomemo-select'}
          onClick={openMenu}
        >
          <span className="hippomemo-select-label">{label}</span>
          <span className="hippomemo-select-chevron" aria-hidden="true">
            <IconChevronDownOutline14 />
          </span>
        </Button>
      )}
      items={options.map(option => ({ id: option.value, label: option.label }))}
      selectedId={value}
      onSelect={(id) => { onChange(id); setOpen(false) }}
      onClose={() => { setOpen(false) }}
    />
  )
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString()
}

type PageItem = number | 'gap'

function pageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }
  const start = Math.max(2, Math.min(page - 1, totalPages - 4))
  const end = Math.min(start + 3, totalPages - 1)
  const items: PageItem[] = [1]
  if (start > 2) items.push('gap')
  for (let n = start; n <= end; n += 1) items.push(n)
  if (end < totalPages - 1) items.push('gap')
  items.push(totalPages)
  return items
}

export function MemorySection({ api, t }: MemorySectionProps): ReactNode {
  const [tab, setTab] = useState<SectionTab>('memories')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [kind, setKind] = useState('')
  const [scope, setScope] = useState('')
  const [status, setStatus] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<MemorySortKey>('updatedAt')
  const [order, setOrder] = useState<MemorySortOrder>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [records, setRecords] = useState<MemoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [usage, setUsage] = useState<MemoryUsageStats | null>(null)
  const [tags, setTags] = useState<MemoryTagCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [detailId, setDetailId] = useState<string | null>(null)
  const [editing, setEditing] = useState<MemoryRecord | 'new' | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Debounced search: typing only refetches after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q)
      setPage(1)
    }, 250)
    return () => { clearTimeout(timer) }
  }, [q])

  const changeKind = (value: string): void => { setKind(value); setPage(1) }
  const changeScope = (value: string): void => { setScope(value); setPage(1) }
  const changeStatus = (value: string): void => { setStatus(value); setPage(1) }
  const changeTag = (value: string): void => { setTag(value); setPage(1) }
  const changeSort = (value: string): void => { setSort(value as MemorySortKey); setPage(1) }
  const changePageSize = (value: string): void => { setPageSize(Number(value)); setPage(1) }
  const toggleOrder = (): void => { setOrder(prev => prev === 'desc' ? 'asc' : 'desc'); setPage(1) }

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    const query: MemoryListQuery = {
      ...(debouncedQ.length > 0 ? { q: debouncedQ } : {}),
      ...(kind.length > 0 ? { kind: kind as MemoryKind } : {}),
      ...(scope.length > 0 ? { scope: scope as MemoryScope } : {}),
      ...(status.length > 0 ? { status: status as MemoryStatus } : {}),
      ...(tag.length > 0 ? { tag } : {}),
      sort,
      order,
      limit: pageSize,
      cursor: (page - 1) * pageSize,
    }
    void Promise.all([api.list(query), api.stats(), api.usage()])
      .then(([list, nextStats, nextUsage]) => {
        if (current === false) return
        setRecords(list.items)
        setTotal(list.total)
        setStats(nextStats)
        setUsage(nextUsage)
      })
      .catch((cause: unknown) => {
        if (current === false) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (current === false) return
        setLoading(false)
      })
    return () => { current = false }
  }, [api, debouncedQ, kind, scope, status, tag, sort, order, page, pageSize, reloadKey])

  useEffect(() => {
    let current = true
    void api.tags()
      .then(nextTags => { if (current) setTags(nextTags) })
      .catch(() => { /* tags are auxiliary; keep whatever we had */ })
    return () => { current = false }
  }, [api, reloadKey])

  const reload = (): void => {
    setReloadKey(prev => prev + 1)
  }

  useEffect(() => {
    const close = api.events(() => { reload() })
    return close
  }, [api])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  // Keep the cursor in range after deletions shrink the result set.
  useEffect(() => {
    if (page > 1 && total > 0 && page > totalPages) setPage(totalPages)
  }, [page, total, totalPages])

  const save = async (input: MemoryPutInput | MemoryPatchInput, id?: string): Promise<void> => {
    if (id === undefined) await api.create(input as MemoryPutInput)
    else await api.update(id, input as MemoryPatchInput)
    setEditing(null)
    reload()
  }

  const remove = async (id: string): Promise<void> => {
    if (window.confirm(t('confirmDelete')) === false) return
    await api.remove(id)
    if (detailId === id) setDetailId(null)
    reload()
  }

  const setStatusFor = async (record: MemoryRecord, next: MemoryStatus): Promise<void> => {
    await api.update(record.id, { status: next })
    reload()
  }

  const openDetail = (id: string): void => {
    setEditing(null)
    setDetailId(id)
  }

  const hasFilters = q.length > 0 || kind.length > 0 || scope.length > 0 || status.length > 0 || tag.length > 0

  return (
    <div className="hippomemo-section" data-plugin="dsh-hippomemo">
      <h2 className="hippomemo-title">{t('title')}</h2>
      <p className="hippomemo-intro">{t('intro')}</p>

      <SegmentedControl<SectionTab>
        className="hippomemo-tabs"
        ariaLabel="hippomemo section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'memories', label: t('tabMemories') },
          { value: 'usage', label: t('tabUsage') },
          { value: 'evolve', label: t('tabEvolve') },
        ]}
      />

      {detailId !== null ? (
        editing !== null && editing !== 'new' && editing.id === detailId ? (
          <MemoryEditor
            t={t}
            initial={editing}
            onCancel={() => { setEditing(null) }}
            onSave={save}
          />
        ) : (
          <MemoryDetail
            api={api}
            t={t}
            id={detailId}
            refreshKey={reloadKey}
            onBack={() => { setEditing(null); setDetailId(null) }}
            onEdit={setEditing}
            onChanged={reload}
            onDeleted={(id) => { if (detailId === id) setDetailId(null); reload() }}
            onOpenRelated={openDetail}
          />
        )
      ) : tab === 'memories' ? (
        <>
          <div className="hippomemo-toolbar">
            <SearchInput
                value={q}
                onChange={setQ}
                placeholder={t('searchPlaceholder')}
                onClear={() => { setQ('') }}
                clearLabel={t('clearSearch')}
              />
            <HippomemoSelect
              value={kind}
              placeholder={t('allKinds')}
              options={[{ value: '', label: t('allKinds') }, ...KINDS.map(value => ({ value, label: t(value) }))]}
              onChange={changeKind}
            />
            <HippomemoSelect
              value={scope}
              placeholder={t('allScopes')}
              options={[{ value: '', label: t('allScopes') }, ...SCOPES.map(value => ({ value, label: t(value) }))]}
              onChange={changeScope}
            />
            <HippomemoSelect
              value={status}
              placeholder={t('allStatuses')}
              options={[{ value: '', label: t('allStatuses') }, ...STATUSES.map(value => ({ value, label: t(value) }))]}
              onChange={changeStatus}
            />
            {tags.length > 0 ? (
              <HippomemoSelect
                value={tag}
                placeholder={t('allTags')}
                options={[
                  { value: '', label: t('allTags') },
                  ...tags.map(item => ({ value: item.tag, label: item.tag + ' (' + String(item.count) + ')' })),
                ]}
                onChange={changeTag}
              />
            ) : null}
            <HippomemoSelect
              value={sort}
              placeholder={t('sortLabel')}
              options={SORTS.map(option => ({ value: option.value, label: t(option.label) }))}
              onChange={changeSort}
            />
            <Button
              variant="outline"
              size="sm"
              title={order === 'desc' ? t('orderDesc') : t('orderAsc')}
              aria-label={order === 'desc' ? t('orderDesc') : t('orderAsc')}
              onClick={toggleOrder}
              icon={order === 'desc' ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
            />
            <Button variant="primary" size="md" icon={<IconPlusOutline16 />} onClick={() => { setEditing('new') }}>
              {t('newMemory')}
            </Button>
          </div>

          {loading ? <p className="hippomemo-status">{t('loading')}</p> : null}
          {error.length > 0 && loading === false ? (
            <p className="hippomemo-error">
              {t('loadFailed')}: {error}
              <Button variant="ghost" size="sm" onClick={reload}>{t('retry')}</Button>
            </p>
          ) : null}

          {editing !== null ? (
            <MemoryEditor
              t={t}
              initial={editing === 'new' ? undefined : editing}
              onCancel={() => { setEditing(null) }}
              onSave={save}
            />
          ) : null}

          {loading === false && error.length === 0 && records.length === 0 ? (
            <p className="hippomemo-empty">{hasFilters ? t('emptySearch') : t('empty')}</p>
          ) : null}

          {records.length > 0 ? (
            <div className="hippomemo-list">
              {records.map(record => (
                <div className="hippomemo-row" key={record.id}>
                  <button type="button" className="hippomemo-row-main" onClick={() => { openDetail(record.id) }} title={record.title}>
                    <span className="hippomemo-row-title">{record.title}</span>
                    <span className={'hippomemo-row-kind hippomemo-kind-' + record.kind}>
                      {record.kind === 'preference' ? '⭐ ' : ''}{t(record.kind)}
                    </span>
                    <span className="hippomemo-row-scope">{t(record.scope)}</span>
                    {record.sourceSparkId !== undefined && record.sourceSparkId !== null && record.sourceSparkId.length > 0 ? (
                      <span className="hippomemo-row-spark" title={t('sourceSparkHint')}>🔗</span>
                    ) : null}
                    {record.scope === 'global' ? (
                      <span className={'hippomemo-row-proven hippomemo-proven-' + (record.globalProven ? 'yes' : 'no')}>
                        {record.globalProven ? t('proven') : t('unproven') + '·' + (record.seenWorkspaces?.length ?? 0)}
                      </span>
                    ) : null}
                    <span className={'hippomemo-row-status hippomemo-status-' + record.status}>{t(record.status)}</span>
                    <span className="hippomemo-row-importance">{record.importance.toFixed(2)}</span>
                    <span className="hippomemo-row-date">{formatDate(record.updatedAt)}</span>
                  </button>
                  <div className="hippomemo-row-actions">
                    <Button size="sm" variant="ghost" icon={<IconEditOutline16 />} title={t('edit')} aria-label={t('edit')} onClick={() => { setEditing(record) }} />
                    <Button
                      size="sm"
                      variant="ghost"
                      title={record.status === 'archived' ? t('restore') : t('archive')}
                      aria-label={record.status === 'archived' ? t('restore') : t('archive')}
                      onClick={() => { void setStatusFor(record, record.status === 'archived' ? 'active' : 'archived') }}
                    >
                      {record.status === 'archived' ? t('restore') : t('archive')}
                    </Button>
                    <Button size="sm" variant="ghost" className="hippomemo-button-danger" icon={<IconTrashOutline16 />} title={t('delete')} aria-label={t('delete')} onClick={() => { void remove(record.id) }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {total > 0 ? (
            <div className="hippomemo-pager">
              <span className="hippomemo-pager-meta">
                {t('total')} {total} {t('results')} · {t('pagePrefix')} {page} / {totalPages} {t('pageSuffix')}
              </span>
              <div className="hippomemo-pager-controls">
                <HippomemoSelect
                  value={String(pageSize)}
                  placeholder={t('pageSizeLabel')}
                  options={PAGE_SIZES.map(size => ({ value: String(size), label: t('pageSizeLabel') + ' ' + String(size) }))}
                  onChange={changePageSize}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => { setPage(page - 1) }}
                  icon={<IconChevronLeftOutline14 />}
                >
                  {t('prevPage')}
                </Button>
                {pageItems(page, totalPages).map((item, index) => (
                  item === 'gap' ? (
                    <span key={'gap-' + String(index)} className="hippomemo-pager-gap">…</span>
                  ) : (
                    <Button
                      key={item}
                      variant={item === page ? 'primary' : 'ghost'}
                      size="sm"
                      aria-current={item === page ? 'page' : undefined}
                      onClick={() => { setPage(item) }}
                    >
                      {item}
                    </Button>
                  )
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => { setPage(page + 1) }}
                  icon={<IconChevronRightOutline14 />}
                >
                  {t('nextPage')}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : tab === 'usage' ? (
        <div className="hippomemo-panel">
          {stats !== null ? (
            <div className="hippomemo-meta">
              <span>{t('total')} {stats.total} {t('results')}</span>
              <span>{t('activeCount')} {stats.active}</span>
              <span>{t('archivedCount')} {stats.archived}</span>
            </div>
          ) : null}

          {usage !== null ? (
            <div className="hippomemo-usage">
              <span className="hippomemo-usage-label">{t('usage')}</span>
              <span title={t('usageRecalled')}>{t('usageRecalled')} {usage.recalled}/{usage.total}</span>
              <span>{t('usageCited')} {usage.cited}</span>
              <span>{t('usageNeverRecalled')} {usage.neverRecalled}</span>
              <span>{t('usageStale')} {usage.staleCount}</span>
              <span>{t('usageRecallRate')} {(usage.recallRate * 100).toFixed(0)}%</span>
              <span>{t('usageCitationRate')} {(usage.citationRate * 100).toFixed(0)}%</span>
              <span>{t('usageConversion')} {(usage.conversionRate * 100).toFixed(0)}%</span>
              {usage.staleCount > 0 ? <span className="hippomemo-usage-hint">{t('usageStaleHint')}</span> : null}
            </div>
          ) : null}

          <MemoryCharts api={api} t={t} stats={stats} reloadKey={reloadKey} />
        </div>
      ) : (
        <EvolvePanel api={api} t={t} />
      )}
    </div>
  )
}


// ---- 统计图表 ----

function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function MemoryCharts({ api, t, stats, reloadKey }: {
  api: HippomemoApi
  t: Translate
  stats: MemoryStats | null
  reloadKey: number
}): ReactNode {
  const [allRecords, setAllRecords] = useState<MemoryRecord[]>([])
  const [citations, setCitations] = useState<CitationRecord[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setError('')
    void Promise.all([api.list({ limit: 200, sort: 'updatedAt', order: 'desc' }), api.citations({ limit: 200 })])
      .then(([list, citationsResult]) => {
        if (current === false) return
        setAllRecords(list.items)
        setCitations(citationsResult.items)
      })
      .catch((cause: unknown) => {
        if (current === false) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => { current = false }
  }, [api, reloadKey])

  const kindRows = useMemo<ChartDatum[]>(() => {
    if (stats === null) return []
    return KINDS.map(kind => ({ key: kind, label: t(kind), value: stats.byKind[kind] }))
      .filter(row => row.value > 0)
  }, [stats])

  // Phase 6.5 visibility: recall volume broken down by kind so the user can
  // see at a glance which kind the cognitive filter is surfacing most. The
  // (row|bar) chart here is read-only and reflects the allRecords window
  // (last 200 by updatedAt desc) rather than the full corpus, so it is a
  // taste signal, not a hard count.
  const recallByKind = useMemo<ChartDatum[]>(() => {
    if (allRecords.length === 0) return []
    const sums = new Map<MemoryKind, number>()
    for (const record of allRecords) {
      const recall = record.recallCount ?? 0
      if (recall <= 0) continue
      sums.set(record.kind, (sums.get(record.kind) ?? 0) + recall)
    }
    return KINDS
      .map(kind => ({ key: kind, label: t(kind), value: sums.get(kind) ?? 0 }))
      .filter(row => row.value > 0)
  }, [allRecords, t])

  const statusRows = useMemo<ChartDatum[]>(() => {
    if (stats === null) return []
    const counts: Record<string, number> = {
      active: stats.active,
      archived: stats.archived,
      superseded: stats.superseded,
      candidate: stats.candidate,
    }
    return STATUSES.map(status => ({ key: status, label: t(status), value: counts[status] ?? 0 }))
      .filter(row => row.value > 0)
  }, [stats])

  const topRecalled = useMemo<ChartDatum[]>(() =>
    [...allRecords]
      .filter(record => (record.recallCount ?? 0) > 0)
      .sort((a, b) => (b.recallCount ?? 0) - (a.recallCount ?? 0))
      .slice(0, 8)
      .map(record => ({
        key: record.id,
        label: record.title,
        value: record.recallCount ?? 0,
        detail: `${t('usageCited')} ${record.citationCount ?? 0}`,
      })),
  [allRecords, t])

  const trendPoints = useMemo(() => {
    const buckets = new Map<string, number>()
    for (const citation of citations) {
      const key = dayKey(citation.ts)
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, label: key.slice(5), value }))
  }, [citations])

  if (error.length > 0) {
    return <p className="hippomemo-error">{t('loadFailed')}: {error}</p>
  }

  return (
    <div className="hippomemo-chart-grid">
      {kindRows.length > 0 ? (
        <section className="hippomemo-chart-card">
          <div className="hippomemo-chart-title">{t('chartKindTitle')}</div>
          <DonutChart
            rows={kindRows}
            centerValue={String(stats?.total ?? 0)}
            centerLabel={t('chartTotal')}
            ariaLabel={t('chartKindTitle')}
            formatValue={value => String(value)}
          />
        </section>
      ) : null}

      {statusRows.length > 0 ? (
        <section className="hippomemo-chart-card">
          <div className="hippomemo-chart-title">{t('chartStatusTitle')}</div>
          <DonutChart
            rows={statusRows}
            centerValue={String(stats?.total ?? 0)}
            centerLabel={t('chartTotal')}
            ariaLabel={t('chartStatusTitle')}
            formatValue={value => String(value)}
          />
        </section>
      ) : null}

      <section className="hippomemo-chart-card">
        <div className="hippomemo-chart-title">{t('chartTopRecalledTitle')}</div>
        {topRecalled.length === 0 ? (
          <p className="hippomemo-empty">{t('chartNoData')}</p>
        ) : (
          <BarChart
            rows={topRecalled}
            ariaLabel={t('chartTopRecalledTitle')}
            formatValue={value => String(value)}
            axisFormatter={value => String(Math.round(value))}
          />
        )}
      </section>

      <section className="hippomemo-chart-card">
        <div className="hippomemo-chart-title">{t('chartRecallByKindTitle')}</div>
        {recallByKind.length === 0 ? (
          <p className="hippomemo-empty">{t('chartNoData')}</p>
        ) : (
          <BarChart
            rows={recallByKind}
            ariaLabel={t('chartRecallByKindTitle')}
            formatValue={value => String(value)}
            axisFormatter={value => String(Math.round(value))}
          />
        )}
      </section>

      <section className="hippomemo-chart-card hippomemo-chart-card-wide">
        <div className="hippomemo-chart-title">{t('chartCitationsTrendTitle')}</div>
        {trendPoints.length < 2 ? (
          <p className="hippomemo-empty">{t('chartNoData')}</p>
        ) : (
          <TrendChart
            points={trendPoints}
            ariaLabel={t('chartCitationsTrendTitle')}
            formatValue={value => String(value)}
            gradientId="dsh-hippomemo-citations-grad"
          />
        )}
      </section>
    </div>
  )
}

// ---- 进化面板 ----

const ACTION_LABELS: Record<EvolveActionType, HippomemoLocaleKey> = {
  archive: 'evolveActionArchive',
  probation: 'evolveActionProbation',
  'cancel-probation': 'evolveActionCancelProbation',
  supersede: 'evolveActionSupersede',
  link: 'evolveActionLink',
  'downgrade-scope': 'evolveActionDowngradeScope',
}

function EvolvePanel({ api, t }: { api: HippomemoApi; t: Translate }): ReactNode {
  const [report, setReport] = useState<EvolveReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  // kind[id] so each action/verdict row can render the affected memory's kind
  // pill without N round-trips per render.
  const [kindMap, setKindMap] = useState<Map<string, MemoryKind>>(new Map())

  const load = async (): Promise<void> => {
    try {
      setReport(await api.evolveLast())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    let current = true
    void api.evolveLast().then(found => {
      if (current) setReport(found)
    }).catch((cause: unknown) => {
      if (current) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { current = false }
  }, [api])

  // Resolve the kind of every memory referenced in the report. Distinct ids
  // only — even a 200-action sweep batches into at most a couple of dozen
  // GET calls. Failures stay silent; the kind column simply shows "—".
  useEffect(() => {
    if (report === null) {
      setKindMap(new Map())
      return
    }
    const ids = new Set<string>()
    for (const action of report.actions) ids.add(action.id)
    if (report.review !== undefined) for (const verdict of report.review) ids.add(verdict.id)
    if (ids.size === 0) return
    let current = true
    void Promise.all([...ids].map(async id => {
      try {
        const record = await api.get(id)
        return record === null ? null : [id, record.kind] as const
      } catch {
        return null
      }
    })).then(entries => {
      if (current === false) return
      const next = new Map<string, MemoryKind>()
      for (const entry of entries) if (entry !== null) next.set(entry[0], entry[1])
      setKindMap(next)
    })
    return () => { current = false }
  }, [api, report])

  const run = async (dryRun: boolean): Promise<void> => {
    setRunning(true)
    setError('')
    try {
      setReport(await api.evolveRun(dryRun))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="hippomemo-panel">
      <p className="hippomemo-intro">{t('evolveIntro')}</p>
      <div className="hippomemo-toolbar">
        <Button variant="outline" size="md" disabled={running} onClick={() => { void run(true) }}>
          {running ? t('evolveRunning') : t('evolveRunDry')}
        </Button>
        <Button variant="primary" size="md" disabled={running} onClick={() => { void run(false) }}>
          {running ? t('evolveRunning') : t('evolveRunApply')}
        </Button>
      </div>

      {error.length > 0 ? <p className="hippomemo-error">{t('loadFailed')}: {error}</p> : null}

      {report === null && error.length === 0 ? (
        <p className="hippomemo-empty">{t('evolveNoReport')}</p>
      ) : null}

      {report !== null ? (
        <div className="hippomemo-evolve-report">
          <div className="hippomemo-meta">
            <span>{t('evolveRunAt')} {formatDate(report.runAt)}</span>
            <span>{report.dryRun ? t('evolveDryRun') : t('evolveApplied')}</span>
            <span>{t('evolveActionsLabel')} {report.actions.length}</span>
            {report.review !== undefined ? <span>{t('evolveReviewedLabel')} {report.review.length}</span> : null}
          </div>

          {report.review !== undefined && report.review.length > 0 ? (
            <div className="hippomemo-evolve-review">
              <div className="hippomemo-evolve-block-title">{t('evolveReviewedLabel')}</div>
              {report.review.map(verdict => {
                const kind = kindMap.get(verdict.id)
                return (
                <div className="hippomemo-evolve-verdict" key={verdict.id}>
                  <Pill className={'hippomemo-verdict-' + verdict.verdict}>
                    {verdict.verdict === 'keep' ? t('evolveKeep') : t('evolveNoise')}
                  </Pill>
                  <Pill className={'hippomemo-evolve-kind hippomemo-kind-' + (kind ?? 'unknown')}>{kind === undefined ? '—' : t(kind)}</Pill>
                  <span className="hippomemo-evolve-verdict-id">{verdict.id.slice(0, 8)}</span>
                  {verdict.reason !== undefined ? <span className="hippomemo-evolve-verdict-reason">{verdict.reason}</span> : null}
                </div>
                )
              })}
            </div>
          ) : null}

          {report.actions.length > 0 ? (
            <div className="hippomemo-evolve-actions">
              <div className="hippomemo-evolve-block-title">{t('evolveActionsLabel')}</div>
              {report.actions.map(action => {
                const kind = kindMap.get(action.id)
                return (
                <div className="hippomemo-evolve-action" key={action.id + action.action}>
                  <Pill className={'hippomemo-action-' + action.action}>{t(ACTION_LABELS[action.action])}</Pill>
                  <Pill className={'hippomemo-evolve-kind hippomemo-kind-' + (kind ?? 'unknown')}>{kind === undefined ? '—' : t(kind)}</Pill>
                  <span className="hippomemo-evolve-action-id">{action.id.slice(0, 8)}</span>
                  <span className="hippomemo-evolve-action-reason">{action.reason}</span>
                </div>
                )
              })}
            </div>
          ) : (
            <p className="hippomemo-empty">—</p>
          )}
        </div>
      ) : null}
    </div>
  )
}


interface DetailProps {
  api: HippomemoApi
  t: Translate
  id: string
  refreshKey: number
  onBack: () => void
  onEdit: (record: MemoryRecord) => void
  onChanged: () => void
  onDeleted: (id: string) => void
  onOpenRelated: (id: string) => void
}

function MemoryDetail({ api, t, id, refreshKey, onBack, onEdit, onChanged, onDeleted, onOpenRelated }: DetailProps): ReactNode {
  const [record, setRecord] = useState<MemoryRecord | null>(null)
  const [related, setRelated] = useState<MemoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    void api.get(id)
      .then(found => {
        if (current === false) return
        setRecord(found)
        setRelated([])
        if (found === null) return
        const relatedIds = (found.relatedIds ?? []).slice(0, 6)
        if (relatedIds.length === 0) return
        void Promise.all(relatedIds.map(relatedId => api.get(relatedId)))
          .then(foundRelated => {
            if (current === false) return
            setRelated(foundRelated.filter((item): item is MemoryRecord => item !== null))
          })
          .catch(() => { /* related list is auxiliary */ })
      })
      .catch((cause: unknown) => {
        if (current === false) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (current === false) return
        setLoading(false)
      })
    return () => { current = false }
  }, [api, id, refreshKey])

  if (loading) return <p className="hippomemo-status">{t('loading')}</p>
  if (error.length > 0) return <p className="hippomemo-error">{t('loadFailed')}: {error}</p>
  if (record === null) return <p className="hippomemo-empty">{t('memoryNotFound')}</p>

  const archiveToggle = async (): Promise<void> => {
    await api.update(record.id, { status: record.status === 'archived' ? 'active' : 'archived' })
    onChanged()
  }

  const remove = async (): Promise<void> => {
    if (window.confirm(t('confirmDelete')) === false) return
    await api.remove(record.id)
    onDeleted(record.id)
  }

  return (
    <div className="hippomemo-detail">
      <div className="hippomemo-detail-nav">
        <Button size="sm" variant="ghost" icon={<IconChevronLeftOutline14 />} onClick={onBack}>
          {t('back')}
        </Button>
        <div className="hippomemo-detail-actions">
          <Button size="sm" variant="ghost" icon={<IconEditOutline16 />} onClick={() => { onEdit(record) }}>
            {t('edit')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { void archiveToggle() }}>
            {record.status === 'archived' ? t('restore') : t('archive')}
          </Button>
          <Button size="sm" variant="ghost" className="hippomemo-button-danger" icon={<IconTrashOutline16 />} onClick={() => { void remove() }}>
            {t('delete')}
          </Button>
        </div>
      </div>

      <div className="hippomemo-detail-head">
        <h3 className="hippomemo-detail-title">{record.title}</h3>
        <div className="hippomemo-detail-pills">
          <Pill className={'hippomemo-kind-pill hippomemo-kind-' + record.kind}>{record.kind === 'preference' ? '⭐ ' : ''}{t(record.kind)}</Pill>
          <Pill className="hippomemo-scope-pill">{t(record.scope)}</Pill>
          {record.scope === 'global' ? (
            <Pill className={'hippomemo-proven-pill hippomemo-proven-' + (record.globalProven ? 'yes' : 'no')}>
              {record.globalProven ? t('proven') : t('unproven') + '·' + (record.seenWorkspaces?.length ?? 0)}
            </Pill>
          ) : null}
          <Pill className={'hippomemo-status-pill hippomemo-status-' + record.status}>{t(record.status)}</Pill>
        </div>
      </div>

      <div className="hippomemo-content hippomemo-detail-content">{record.content}</div>

      {record.tags.length > 0 ? (
        <div className="hippomemo-tag-list">
          <span className="hippomemo-tag-label">{t('tags')}</span>
          {record.tags.map(tagItem => (
            <Pill key={tagItem} className="hippomemo-tag-pill">#{tagItem}</Pill>
          ))}
        </div>
      ) : null}

      <dl className="hippomemo-facts">
        <div className="hippomemo-fact">
          <dt>{t('importanceLabel')}</dt>
          <dd>{record.importance.toFixed(2)}</dd>
        </div>
        <div className="hippomemo-fact">
          <dt>{t('revisionLabel')}</dt>
          <dd>{record.revision}</dd>
        </div>
        <div className="hippomemo-fact">
          <dt>{t('sourceSession')}</dt>
          <dd>{record.sourceSessionId}</dd>
        </div>
        {record.sourceSparkId !== undefined && record.sourceSparkId !== null && record.sourceSparkId.length > 0 ? (
          <div className="hippomemo-fact hippomemo-fact-spark">
            <dt>{t('sourceSpark')}</dt>
            <dd>
              <Pill className="hippomemo-source-spark-pill" title={t('sourceSparkHint')}>
                🔗 {t('sourceSparkBadge')}: <code className="hippomemo-source-spark-id">{record.sourceSparkId.slice(0, 8)}</code>
              </Pill>
            </dd>
          </div>
        ) : null}
        <div className="hippomemo-fact">
          <dt>{t('createdAt')}</dt>
          <dd>{formatDate(record.createdAt)}</dd>
        </div>
        <div className="hippomemo-fact">
          <dt>{t('updatedAt')}</dt>
          <dd>{formatDate(record.updatedAt)}</dd>
        </div>
        <div className="hippomemo-fact">
          <dt>{t('usageRecalled')}</dt>
          <dd>{(record.recallCount ?? 0)} · {record.lastRecalledAt === null || record.lastRecalledAt === undefined ? '—' : formatDate(record.lastRecalledAt)}</dd>
        </div>
        <div className="hippomemo-fact">
          <dt>{t('usageCited')}</dt>
          <dd>{(record.citationCount ?? 0)} · {record.lastCitedAt === null || record.lastCitedAt === undefined ? '—' : formatDate(record.lastCitedAt)}</dd>
        </div>
      </dl>

      {related.length > 0 ? (
        <div className="hippomemo-related">
          <span className="hippomemo-related-label">{t('related')}</span>
          <div className="hippomemo-related-list">
            {related.map(item => (
              <button type="button" key={item.id} className="hippomemo-related-item" onClick={() => { onOpenRelated(item.id) }}>
                <span className="hippomemo-related-title">{item.title}</span>
                <span className="hippomemo-related-meta">{t(item.kind)} · {formatDate(item.updatedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface EditorProps {
  t: Translate
  initial?: MemoryRecord
  onCancel: () => void
  onSave: (input: MemoryPutInput | MemoryPatchInput, id?: string) => Promise<void>
}

function MemoryEditor({ t, initial, onCancel, onSave }: EditorProps): ReactNode {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '')
  const [kind, setKind] = useState<MemoryKind>(initial?.kind ?? 'insight')
  const [scope, setScope] = useState<MemoryScope>(initial?.scope ?? 'global')
  const [importance, setImportance] = useState(String(initial?.importance ?? 0.5))
  const [saving, setSaving] = useState(false)

  const submit = async (): Promise<void> => {
    setSaving(true)
    try {
      const patch: MemoryPatchInput = {
        title,
        content,
        tags: tags.split(',').map(item => item.trim()).filter(item => item.length > 0),
        kind,
        scope,
        importance: Number(importance) || 0.5,
      }
      await onSave(patch, initial?.id)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="hippomemo-form">
      <label>{t('titleLabel')}<Input value={title} onChange={event => { setTitle(event.currentTarget.value) }} /></label>
      <label>{t('kind')}
        <HippomemoSelect
          value={kind}
          placeholder={t('kind')}
          options={KINDS.map(value => ({ value, label: t(value) }))}
          onChange={(value) => { setKind(value as MemoryKind) }}
        />
      </label>
      <label>{t('scope')}
        <HippomemoSelect
          value={scope}
          placeholder={t('scope')}
          options={SCOPES.map(value => ({ value, label: t(value) }))}
          onChange={(value) => { setScope(value as MemoryScope) }}
        />
      </label>
      <label>{t('importanceLabel')}<Input type="number" min="0" max="1" step="0.1" value={importance} onChange={event => { setImportance(event.currentTarget.value) }} /></label>
      <label>{t('contentLabel')}<Textarea value={content} onChange={event => { setContent(event.currentTarget.value) }} /></label>
      <label>{t('tagsLabel')}<Input value={tags} onChange={event => { setTags(event.currentTarget.value) }} /></label>
      <div className="hippomemo-toolbar">
        <Button variant="primary" size="md" disabled={saving} onClick={() => { void submit() }}>{t('save')}</Button>
        <Button variant="ghost" size="md" onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </div>
  )
}