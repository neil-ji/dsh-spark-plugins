/**
 * dsh-hippomemo · v3 UI: 4-quadrant settings section.
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  记忆库（脑区状态条：默认细条，可展开看四脑区）           │
 *   ├──────────────────────┬─────────────────────────────────┤
 *   │  需要我处理（行动）    │  AI 最近在用（验证）            │
 *   ├──────────────────────┴─────────────────────────────────┤
 *   │  我的偏好（一等公民 · 专区分 · 自动挖 vs 手敲）         │
 *   ├────────────────────────────────────────────────────────┤
 *   │  全部记忆（搜索 / 筛选 / 分页 / 详情 modal + lineage）   │
 *   └────────────────────────────────────────────────────────┘
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BarChart, Button, DonutChart, IconBranchOutline16, IconChevronDownOutline14,
  IconChevronLeftOutline14, IconChevronRightOutline14, IconChevronUpOutline14,
  IconEditOutline16, IconPlusOutline16, IconThinkOutline16, IconTrashOutline16,
  IconWarningOutline16, Input, Menu, Modal, Pill, SearchInput, SegmentedControl,
  StateDot, Textarea, TrendChart,
} from 'dsh-ui-kit'
import type { ChartDatum } from 'dsh-ui-kit'
import type { HippomemoApi, MemoryTagCount } from './api.ts'
import type { HippomemoLocaleKey } from './locales.ts'
import type {
  CitationRecord, EvolveReport, MemoryKind, MemoryListQuery, MemoryPatchInput,
  MemoryPutInput, MemoryRecord, MemoryScope, MemorySortKey, MemorySortOrder, MemoryStats,
  MemoryStatus, MemoryUsageStats, PendingCandidate, PendingCandidateListResult,
  PreferenceListResult, PreferenceRecord, RecallNarrative,
} from '../types.ts'

type Translate = (key: HippomemoLocaleKey, vars?: Record<string, string | number>) => string
export interface MemorySectionProps { api: HippomemoApi; t: Translate }
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
const BRAIN_REGIONS = ['pfc', 'amy', 'hippo', 'cortex'] as const
type BrainRegion = typeof BRAIN_REGIONS[number]
interface SelectOption { value: string; label: string }

function HippomemoSelect({ value, placeholder, options, onChange }: {
  value: string; placeholder: string; options: SelectOption[]; onChange: (value: string) => void
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
      open={open} portal side={side}
      anchor={(
        <Button ref={triggerRef} variant='outline' size='sm'
          className={open ? 'hippomemo-select hippomemo-select-open' : 'hippomemo-select'}
          onClick={openMenu}>
          <span className='hippomemo-select-label'>{label}</span>
          <span className='hippomemo-select-chevron' aria-hidden='true'>
            <IconChevronDownOutline14 />
          </span>
        </Button>
      )}
      items={options.map(option => ({ id: option.value, label: option.label }))}
      selectedId={value}
      onSelect={(id) => { onChange(id); setOpen(false) }}
      onClose={() => { setOpen(false) }} />
  )
}

function formatDate(value: number): string { return new Date(value).toLocaleString() }
function formatRelative(ms: number, now: number): string {
  const delta = Math.max(0, now - ms)
  const minute = 60_000, hour = 60 * minute, day = 24 * hour
  if (delta < minute) return 'just now'
  if (delta < hour) return Math.floor(delta / minute) + ' min ago'
  if (delta < day) return Math.floor(delta / hour) + ' h ago'
  if (delta < 30 * day) return Math.floor(delta / day) + ' d ago'
  if (delta < 365 * day) return Math.floor(delta / (30 * day)) + ' mo ago'
  return Math.floor(delta / (365 * day)) + ' y ago'
}
type PageItem = number | 'gap'
function pageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const start = Math.max(2, Math.min(page - 1, totalPages - 4))
  const end = Math.min(start + 3, totalPages - 1)
  const items: PageItem[] = [1]
  if (start > 2) items.push('gap')
  for (let n = start; n <= end; n += 1) items.push(n)
  if (end < totalPages - 1) items.push('gap')
  items.push(totalPages)
  return items
}
const BRAIN_REGION_TONE: Record<BrainRegion, string> = {
  pfc: 'var(--dsw-static-blue-500, #2563EB)',
  amy: 'var(--dsw-static-red-500, #DC2626)',
  hippo: 'var(--dsw-static-violet-500, #7C3AED)',
  cortex: 'var(--dsw-static-slate-500, #64748B)',
}

// ========== BrainStrip ==========
function BrainStrip({ t, stats, usage, preferences, candidates, narrative, reloadKey }: {
  t: Translate; stats: MemoryStats | null; usage: MemoryUsageStats | null;
  preferences: PreferenceListResult | null; candidates: PendingCandidateListResult | null;
  narrative: RecallNarrative | null; reloadKey: number;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [pulseRegion, setPulseRegion] = useState<BrainRegion | null>(null);
  const lastTsRef = useRef<number>(0);
  useEffect(() => {
    if (narrative === null) return;
    if (narrative.ts === lastTsRef.current) return;
    lastTsRef.current = narrative.ts;
    setPulseRegion(narrative.region);
    const timer = window.setTimeout(() => { setPulseRegion(null) }, 900);
    return () => { window.clearTimeout(timer) };
  }, [narrative, reloadKey]);
  const injected = usage?.recalled ?? 0;
  const suppressed = Math.max(0, (usage?.neverRecalled ?? 0) - (usage?.staleCount ?? 0));
  const preferenceCount = preferences?.total ?? 0;
  const crystallised = stats?.byKind['fact'] ?? 0;
  const total = stats?.total ?? 0;
  const todoCount = candidates?.total ?? 0;
  const regions: Array<{ id: BrainRegion; nameKey: HippomemoLocaleKey; val: string; descKey: HippomemoLocaleKey; roleKey: HippomemoLocaleKey }> = [
    { id: 'pfc', nameKey: 'brainRegionPfc', val: t('brainValPfc', { injected: String(injected), suppressed: String(suppressed) }), descKey: 'brainRegionPfcDesc', roleKey: 'brainRolePfc' },
    { id: 'amy', nameKey: 'brainRegionAmy', val: t('brainValAmy', { n: preferenceCount }), descKey: 'brainRegionAmyDesc', roleKey: 'brainRoleAmy' },
    { id: 'hippo', nameKey: 'brainRegionHippo', val: t('brainValHippo', { n: crystallised }), descKey: 'brainRegionHippoDesc', roleKey: 'brainRoleHippo' },
    { id: 'cortex', nameKey: 'brainRegionCortex', val: t('brainValCortex', { n: total }), descKey: 'brainRegionCortexDesc', roleKey: 'brainRoleCortex' },
  ];
  return (
    <section className='hippomemo-brain-panel' aria-label={t('title')}>
      <div className='hippomemo-panel-head'>
        <h3 className='hippomemo-panel-title'>{t('title')}</h3>
        <Pill className='hippomemo-pill'>实时</Pill>
        <span className='hippomemo-panel-count'>{t('todoTitle')} · {todoCount}</span>
      </div>
      <div className='hippomemo-brain-strip'>
        <div className='hippomemo-brain-row'>
          {regions.map(region => {
            const pulse = pulseRegion === region.id
            return (
              <Button key={region.id} variant='ghost' size='sm'
                className={'hippomemo-brain-region' + (pulse ? ' hippomemo-brain-region-anim hippomemo-brain-region-anim-' + region.id : '')}
                data-region={region.id}
                onClick={() => { setPulseRegion(region.id); window.setTimeout(() => setPulseRegion(null), 900) }}
                aria-label={t(region.nameKey) + ' · ' + region.val}>
                <StateDot state='done' size={10} className={'hippomemo-brain-dot hippomemo-brain-dot-' + region.id} />
                <span className='hippomemo-brain-name'>{t(region.nameKey)}</span>
                <span className='hippomemo-brain-val'>{region.val}</span>
              </Button>
            )
          })}
          <span className='hippomemo-brain-spacer' />
          <Button size='sm' variant='outline' onClick={() => { setExpanded(!expanded) }}
            icon={<IconChevronDownOutline14 className={expanded ? 'hippomemo-chev hippomemo-chev-up' : 'hippomemo-chev'} />}>
            {expanded ? t('brainCollapse') : t('brainExpand')}
          </Button>
        </div>
        <div className='hippomemo-brain-narration'>
          <span className='hippomemo-brain-narration-lbl'>{t('brainNarrationLabel')}</span>
          <span className='hippomemo-brain-narration-txt'>
            {narrative !== null ? narrative.text : t('brainEmptyNarration')}
          </span>
        </div>
        {expanded ? (
          <div className='hippomemo-brain-expand'>
            {regions.map(region => (
              <div className='hippomemo-brain-card' key={region.id}>
                <h5 className='hippomemo-brain-card-title'>
                  <StateDot state='done' size={10} className={'hippomemo-brain-dot hippomemo-brain-dot-' + region.id} />
                  {t(region.nameKey)}
                </h5>
                <p className='hippomemo-brain-card-desc'>{t(region.descKey)}</p>
                <div className='hippomemo-brain-card-role'>{t(region.roleKey)}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

// ========== Todo Quadrant ==========
function TodoQuadrantImpl({ t, items, now, onResolve }: {
  t: Translate; items: PendingCandidate[]; now: number;
  onResolve: (action: PendingCandidate) => void;
}): ReactNode {
  if (items.length === 0) {
    return (
      <section className='hippomemo-quadrant'>
        <div className='hippomemo-panel-head'>
          <h3 className='hippomemo-panel-title'>{t('todoTitle')}</h3>
          <Pill className='hippomemo-pill'>行动</Pill>
          <span className='hippomemo-panel-count'>0 项</span>
        </div>
        <p className='hippomemo-quadrant-empty'>
          <IconWarningOutline16 size={14} /> {t('todoEmpty')}
        </p>
      </section>
    );
  }
  return (
    <section className='hippomemo-quadrant'>
      <div className='hippomemo-panel-head'>
        <h3 className='hippomemo-panel-title'>{t('todoTitle')}</h3>
        <Pill className='hippomemo-pill'>行动</Pill>
        <span className='hippomemo-panel-count'>{items.length} 项</span>
      </div>
      <ul className='hippomemo-todo-list'>
        {items.map(item => {
          const kindClass = item.kind === 'expired' ? 'danger' : item.kind === 'near-duplicate' ? 'warn' : 'info';
          const kindKeyMap: Record<typeof item.kind, HippomemoLocaleKey> = {
            'expired': 'todoKindExpired',
            'near-duplicate': 'todoKindNearDuplicate',
            'observation': 'todoKindObservation',
            'preference-review': 'todoKindPreferenceReview',
          };
          const actionKeyMap: Record<typeof item.suggestedAction, HippomemoLocaleKey> = {
            'archive': 'todoActArchive',
            'probation': 'todoActKeep',
            'cancel-probation': 'todoActKeep',
            'supersede': 'todoActMerge',
            'link': 'todoActMerge',
            'downgrade-scope': 'todoActConfirm',
          };
          return (
            <li className={'hippomemo-todo-item hippomemo-todo-item-' + kindClass} key={item.id}>
              <StateDot state={kindClass === 'danger' ? 'error' : 'warning'} size={14} className={'hippomemo-todo-icon hippomemo-todo-icon-' + kindClass} />
              <div className='hippomemo-todo-body'>
                <div className='hippomemo-todo-title'>{item.title}</div>
                <div className='hippomemo-todo-desc'>
                  <Pill className={'hippomemo-todo-kind hippomemo-kind-' + item.memoryKind}>{t(kindKeyMap[item.kind])}</Pill>
                  <span className='hippomemo-todo-reason'>{item.reason}</span>
                  <span className='hippomemo-todo-meta'>{formatRelative(item.detectedAt, now)}</span>
                </div>
              </div>
              <Button size='sm' variant='outline' className='hippomemo-todo-act'
                onClick={() => { onResolve(item) }}>
                {t(actionKeyMap[item.suggestedAction])}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ========== Recall Quadrant ==========
function RecallQuadrant({ t, citations, narrative, now }: {
  t: Translate; citations: CitationRecord[]; narrative: RecallNarrative | null; now: number;
}): ReactNode {
  if (citations.length === 0 && narrative === null) {
    return (
      <section className='hippomemo-quadrant'>
        <div className='hippomemo-panel-head'>
          <h3 className='hippomemo-panel-title'>{t('recallTitle')}</h3>
          <Pill className='hippomemo-pill'>验证</Pill>
          <span className='hippomemo-panel-count'>—</span>
        </div>
        <p className='hippomemo-quadrant-empty'>{t('recallEmpty')}</p>
      </section>
    );
  }
  const rows: Array<{ key: string; when: string; what: ReactNode; sub: string; kind: 'injected' | 'suppressed' | 'cited' }> = [];
  if (narrative !== null) {
    rows.push({
      key: 'narrative-' + String(narrative.ts),
      when: formatRelative(narrative.ts, now),
      what: <span className='hippomemo-recall-m'>{t('recallTitle')}</span>,
      sub: narrative.text,
      kind: narrative.region === 'pfc' ? 'injected' : 'cited',
    });
  }
  for (const citation of citations.slice(0, 4)) {
    rows.push({
      key: citation.id,
      when: formatRelative(citation.ts, now),
      what: <span className='hippomemo-recall-m'>{t('recallCited', { n: 1 })}</span>,
      sub: citation.snippet ?? citation.memoryId.slice(0, 8),
      kind: 'cited',
    });
  }
  return (
    <section className='hippomemo-quadrant'>
      <div className='hippomemo-panel-head'>
        <h3 className='hippomemo-panel-title'>{t('recallTitle')}</h3>
        <Pill className='hippomemo-pill'>验证</Pill>
        <span className='hippomemo-panel-count'>
          {formatRelative(narrative?.ts ?? citations[0]?.ts ?? now, now)}
        </span>
      </div>
      <ul className='hippomemo-recall-list'>
        {rows.map(row => (
          <li className={'hippomemo-recall-item hippomemo-recall-item-' + row.kind} key={row.key}>
            <span className='hippomemo-recall-when'>{row.when}</span>
            <div className='hippomemo-recall-what'>
              {row.what} <span className='hippomemo-recall-sub'>{row.sub}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ========== Preference Quadrant ==========
function PreferenceQuadrant({ t, items, totalRecall, onAction }: {
  t: Translate; items: PreferenceRecord[]; totalRecall: number;
  onAction: (action: 'confirm' | 'revise' | 'forget', id: string) => void;
}): ReactNode {
  if (items.length === 0) {
    return (
      <section className='hippomemo-pref-zone'>
        <div className='hippomemo-panel-head'>
          <h3 className='hippomemo-panel-title'>{t('prefTitle')}</h3>
          <Pill className='hippomemo-pill hippomemo-pill-preference'>{t('preference')}</Pill>
        </div>
        <p className='hippomemo-quadrant-empty'>{t('prefEmpty')}</p>
      </section>
    );
  }
  const totalHit = items.reduce((acc, item) => acc + item.hitCount, 0);
  const rate = totalRecall > 0 ? Math.round((totalHit / totalRecall) * 100) : 0;
  return (
    <section className='hippomemo-pref-zone'>
      <div className='hippomemo-panel-head'>
        <h3 className='hippomemo-panel-title'>{t('prefTitle')}</h3>
        <Pill className='hippomemo-pill hippomemo-pill-preference'>{t('preference')}</Pill>
        <span className='hippomemo-panel-count'>
          {t('prefActive', { n: items.length, rate: String(Math.min(100, rate)) })}
        </span>
      </div>
      <div className='hippomemo-pref-strip'>
        <div className='hippomemo-pref-head'>
          <span className='hippomemo-pref-head-title'>{t('prefTitle')}</span>
          <span className='hippomemo-pref-head-meta'>{t('prefSourceAuto')} · {t('prefSourceManual')}</span>
        </div>
        <ul className='hippomemo-pref-list'>
          {items.map(item => {
            const isAuto = item.source === 'auto';
            return (
              <li className={'hippomemo-pref-row' + (item.confirmed ? ' hippomemo-pref-row-confirmed' : '')} key={item.id}>
                <Pill className={'hippomemo-pref-source hippomemo-pref-source-' + (isAuto ? 'auto' : 'manual')}>
                  {isAuto ? t('prefSourceAuto') : t('prefSourceManual')}
                </Pill>
                <div className='hippomemo-pref-body'>
                  <div className='hippomemo-pref-text'>{item.title}</div>
                  <div className='hippomemo-pref-stats'>
                    <span className='hippomemo-pref-hit'>{t('prefHitCount', { n: item.hitCount })}</span>
                    <span> · </span>
                    <span>{item.lastSurfacedAt !== null
                      ? t('prefLastSurfaced', { when: formatRelative(item.lastSurfacedAt, Date.now()) })
                      : t('prefProven')}</span>
                    {item.decayPercent !== null
                      ? <span className='hippomemo-pref-decay'> · {t('prefDecaying', { n: item.decayPercent })}</span>
                      : <span> · {t('prefNotDecaying')}</span>}
                  </div>
                </div>
                <div className='hippomemo-pref-ops'>
                  {!item.confirmed ? (
                    <Button size='sm' variant='ghost' className='hippomemo-pref-op hippomemo-pref-op-confirm'
                      onClick={() => { onAction('confirm', item.id) }}>{t('prefConfirm')}</Button>
                  ) : null}
                  <Button size='sm' variant='ghost' className='hippomemo-pref-op'
                    onClick={() => { onAction('revise', item.id) }}>{t('prefRevise')}</Button>
                  <Button size='sm' variant='ghost' className='hippomemo-pref-op hippomemo-pref-op-forget'
                    onClick={() => { onAction('forget', item.id) }}>{t('prefForget')}</Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ========== Memory List Panel ==========
function MemoryListPanel({ t, api, detailId, onDetail }: {
  t: Translate; api: HippomemoApi; detailId: string | null;
  onDetail: (id: string) => void;
}): ReactNode {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [kind, setKind] = useState('');
  const [scope, setScope] = useState('');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<MemorySortKey>('updatedAt');
  const [order, setOrder] = useState<MemorySortOrder>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState<MemoryTagCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQ(q); setPage(1) }, 250);
    return () => { window.clearTimeout(timer) };
  }, [q]);
  const changeKind = (value: string): void => { setKind(value); setPage(1); };
  const changeScope = (value: string): void => { setScope(value); setPage(1); };
  const changeStatus = (value: string): void => { setStatus(value); setPage(1); };
  const changeTag = (value: string): void => { setTag(value); setPage(1); };
  const changeSort = (value: string): void => { setSort(value as MemorySortKey); setPage(1); };
  const changePageSize = (value: string): void => { setPageSize(Number(value)); setPage(1); };
  const toggleOrder = (): void => { setOrder(prev => prev === 'desc' ? 'asc' : 'desc'); setPage(1); };
  const reload = (): void => { setReloadKey(prev => prev + 1); };
  useEffect(() => {
    let current = true;
    setLoading(true); setError('');
    const query: MemoryListQuery = {
      ...(debouncedQ.length > 0 ? { q: debouncedQ } : {}),
      ...(kind.length > 0 ? { kind: kind as MemoryKind } : {}),
      ...(scope.length > 0 ? { scope: scope as MemoryScope } : {}),
      ...(status.length > 0 ? { status: status as MemoryStatus } : {}),
      ...(tag.length > 0 ? { tag } : {}),
      sort, order, limit: pageSize, cursor: (page - 1) * pageSize,
    };
    void Promise.all([api.list(query), api.tags()])
      .then(([list, nextTags]) => {
        if (current === false) return;
        setRecords(list.items); setTotal(list.total); setTags(nextTags);
      })
      .catch((cause: unknown) => {
        if (current === false) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, debouncedQ, kind, scope, status, tag, sort, order, page, pageSize, reloadKey]);
  useEffect(() => {
    const close = api.events(() => { reload(); });
    return close;
  }, [api]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > 1 && total > 0 && page > totalPages) setPage(totalPages);
  }, [page, total, totalPages]);
  const hasFilters = q.length > 0 || kind.length > 0 || scope.length > 0 || status.length > 0 || tag.length > 0;
  return (
    <section className='hippomemo-memory-panel'>
      <div className='hippomemo-panel-head'>
        <h3 className='hippomemo-panel-title'>{t('title')}</h3>
        <Pill className='hippomemo-pill'>浏览</Pill>
        <span className='hippomemo-panel-count'>{total} 条</span>
      </div>
      <div className='hippomemo-toolbar'>
        <SearchInput className='hippomemo-search' value={q} onChange={setQ}
          placeholder={t('searchPlaceholder')}
          onClear={() => { setQ(''); }} clearLabel={t('clearSearch')} />
        <HippomemoSelect value={kind} placeholder={t('allKinds')}
          options={[{ value: '', label: t('allKinds') }, ...KINDS.map(v => ({ value: v, label: t(v) }))]}
          onChange={changeKind} />
        <HippomemoSelect value={scope} placeholder={t('allScopes')}
          options={[{ value: '', label: t('allScopes') }, ...SCOPES.map(v => ({ value: v, label: t(v) }))]}
          onChange={changeScope} />
        <HippomemoSelect value={status} placeholder={t('allStatuses')}
          options={[{ value: '', label: t('allStatuses') }, ...STATUSES.map(v => ({ value: v, label: t(v) }))]}
          onChange={changeStatus} />
        {tags.length > 0 ? (
          <HippomemoSelect value={tag} placeholder={t('allTags')}
            options={[{ value: '', label: t('allTags') }, ...tags.map(item => ({ value: item.tag, label: item.tag + ' (' + String(item.count) + ')' }))]}
            onChange={changeTag} />
        ) : null}
        <HippomemoSelect value={sort} placeholder={t('sortLabel')}
          options={SORTS.map(option => ({ value: option.value, label: t(option.label) }))}
          onChange={changeSort} />
        <Button variant='outline' size='sm'
          title={order === 'desc' ? t('orderDesc') : t('orderAsc')}
          aria-label={order === 'desc' ? t('orderDesc') : t('orderAsc')}
          onClick={toggleOrder}
          icon={order === 'desc' ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />} />
        <Button variant='primary' size='md' icon={<IconPlusOutline16 />}
          onClick={() => { onDetail('new'); }}>{t('newMemory')}</Button>
      </div>
      {loading ? <p className='hippomemo-status'>{t('loading')}</p> : null}
      {error.length > 0 && loading === false ? (
        <p className='hippomemo-error'>{t('loadFailed')}: {error}
          <Button variant='ghost' size='sm' onClick={reload}>{t('retry')}</Button></p>
      ) : null}
      {loading === false && error.length === 0 && records.length === 0
        ? <p className='hippomemo-empty'>{hasFilters ? t('emptySearch') : t('empty')}</p> : null}
      {records.length > 0 ? (
        <div className='hippomemo-list'>
          {records.map(record => {
            const archived = record.status === 'archived' || record.status === 'superseded';
            const meta: string[] = [];
            meta.push(t(record.scope));
            if (record.scope === 'global') {
              meta.push(record.globalProven ? t('proven') : t('unproven') + '·' + (record.seenWorkspaces?.length ?? 0));
            }
            meta.push(t('importanceLabel') + ' ' + record.importance.toFixed(2));
            meta.push(formatDate(record.updatedAt));
            return (
              <div className={'hippomemo-row' + (archived ? ' hippomemo-row-archived' : '')} key={record.id}>
                <button type='button' className='hippomemo-row-main' onClick={() => { onDetail(record.id); }} title={record.title}>
                  <span className='hippomemo-row-title-wrap'>
                    <span className='hippomemo-row-title'>{record.title}</span>
                    <span className='hippomemo-row-meta'>
                      {record.kind !== 'preference' ? (
                        <Pill className={'hippomemo-kind-pill hippomemo-kind-' + record.kind}>{t(record.kind)}</Pill>
                      ) : null}
                      {meta.map((part, index) => (
                        <span key={index}>
                          {index > 0 ? <span className='hippomemo-row-meta-sep'>·</span> : null}
                          {part}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
                <div className='hippomemo-row-actions'>
                  {record.kind === 'preference' ? (
                    <Pill className='hippomemo-pill hippomemo-pill-preference'>
                      <IconThinkOutline16 size={12} />
                      {t('preference')}
                    </Pill>
                  ) : null}
                  {record.sourceSparkId !== undefined && record.sourceSparkId !== null && record.sourceSparkId.length > 0 ? (
                    <span className='hippomemo-row-spark' title={t('sourceSparkHint')}>
                      <IconBranchOutline16 size={14} />
                    </span>
                  ) : null}
                  <Button size='sm' variant='ghost' title={t('edit')} aria-label={t('edit')}
                    className='hippomemo-icon-btn'
                    onClick={() => { onDetail(record.id); }}
                    icon={<IconEditOutline16 size={14} />} />
                  <Button size='sm' variant='ghost' title={t('delete')} aria-label={t('delete')}
                    className='hippomemo-icon-btn hippomemo-icon-btn-danger'
                    onClick={async () => {
                      if (window.confirm(t('confirmDelete')) === false) return;
                      await api.remove(record.id);
                      reload();
                    }}
                    icon={<IconTrashOutline16 size={14} />} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {total > 0 ? (
        <div className='hippomemo-pager'>
          <span className='hippomemo-pager-meta'>
            {t('total')} {total} {t('results')} · {t('pagePrefix')} {page} / {totalPages} {t('pageSuffix')}
          </span>
          <div className='hippomemo-pager-controls'>
            <HippomemoSelect value={String(pageSize)} placeholder={t('pageSizeLabel')}
              options={PAGE_SIZES.map(size => ({ value: String(size), label: t('pageSizeLabel') + ' ' + String(size) }))}
              onChange={changePageSize} />
            <Button variant='ghost' size='sm' disabled={page <= 1}
              onClick={() => { setPage(page - 1); }} icon={<IconChevronLeftOutline14 />}>{t('prevPage')}</Button>
            {pageItems(page, totalPages).map((item, index) => (
              item === 'gap'
                ? <span key={'gap-' + String(index)} className='hippomemo-pager-gap'>…</span>
                : <Button key={item} variant={item === page ? 'primary' : 'ghost'} size='sm'
                    aria-current={item === page ? 'page' : undefined}
                    onClick={() => { setPage(item); }}>{item}</Button>
            ))}
            <Button variant='ghost' size='sm' disabled={page >= totalPages}
              onClick={() => { setPage(page + 1); }} icon={<IconChevronRightOutline14 />}>{t('nextPage')}</Button>
          </div>
        </div>
      ) : null}
      <span hidden>{detailId === null ? '0' : '1'}</span>
    </section>
  );
}

// ========== Memory Detail Modal ==========
function MemoryDetailModal({ api, t, id, refreshKey, onBack, onEdit, onDeleted }: {
  api: HippomemoApi; t: Translate; id: string; refreshKey: number;
  onBack: () => void; onEdit: (id: string) => void; onDeleted: (id: string) => void;
}): ReactNode {
  const [record, setRecord] = useState<MemoryRecord | null>(null);
  const [related, setRelated] = useState<MemoryRecord[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setError('');
    void api.get(id).then(found => {
      if (current === false) return;
      setRecord(found); setRelated([]);
      if (found === null) return;
      const relatedIds = (found.relatedIds ?? []).slice(0, 6);
      if (relatedIds.length === 0) return;
      void Promise.all(relatedIds.map(rid => api.get(rid)))
        .then(foundRelated => {
          if (current === false) return;
          setRelated(foundRelated.filter((item): item is MemoryRecord => item !== null));
        })
        .catch(() => { /* auxiliary */ });
    }).catch((cause: unknown) => {
      if (current === false) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { current = false; };
  }, [api, id, refreshKey]);
  if (error.length > 0) {
    return (
      <Modal open={true} onClose={onBack} title={t('loadFailed')} closeLabel={t('cancel')}>
        <p className='hippomemo-error'>{error}</p>
      </Modal>
    );
  }
  if (record === null) {
    return (
      <Modal open={true} onClose={onBack} title={t('memoryNotFound')} closeLabel={t('cancel')}>
        <p className='hippomemo-empty'>{t('memoryNotFound')}</p>
      </Modal>
    );
  }
  const remove = async (): Promise<void> => {
    if (window.confirm(t('confirmDelete')) === false) return;
    await api.remove(record.id);
    onDeleted(record.id);
  };
  const archiveToggle = async (): Promise<void> => {
    await api.update(record.id, { status: record.status === 'archived' ? 'active' : 'archived' });
    onDeleted(record.id);
  };
  const hasSpark = record.sourceSparkId !== undefined && record.sourceSparkId !== null && record.sourceSparkId.length > 0;
  return (
    <Modal
      open={true} onClose={onBack}
      title={record.title} closeLabel={t('cancel')}
      className='hippomemo-detail-modal'
      contentClassName='hippomemo-detail-modal-body'
      footer={(
        <div className='hippomemo-detail-modal-footer'>
          <Button size='sm' variant='ghost' icon={<IconEditOutline16 />} onClick={() => { onEdit(record.id); }}>{t('edit')}</Button>
          <Button size='sm' variant='ghost' onClick={() => { void archiveToggle(); }}>
            {record.status === 'archived' ? t('restore') : t('archive')}
          </Button>
          <Button size='sm' variant='ghost' className='hippomemo-button-danger'
            icon={<IconTrashOutline16 />} onClick={() => { void remove(); }}>{t('delete')}</Button>
        </div>
      )}
    >
      <div className='hippomemo-detail-pills'>
        <Pill className={'hippomemo-kind-pill hippomemo-kind-' + record.kind}>
          {record.kind === 'preference' ? <IconThinkOutline16 className='hippomemo-pill-icon' size={12} /> : null}
          {t(record.kind)}
        </Pill>
        <Pill className='hippomemo-scope-pill'>{t(record.scope)}</Pill>
        {record.scope === 'global' ? (
          <Pill className={'hippomemo-proven-pill hippomemo-proven-' + (record.globalProven ? 'yes' : 'no')}>
            {record.globalProven ? t('proven') : t('unproven') + '·' + (record.seenWorkspaces?.length ?? 0)}
          </Pill>
        ) : null}
        <Pill className={'hippomemo-status-pill hippomemo-status-' + record.status}>{t(record.status)}</Pill>
      </div>
      <div className='hippomemo-modal-content hippomemo-detail-content'>{record.content}</div>
      {record.tags.length > 0 ? (
        <div className='hippomemo-tag-list'>
          <span className='hippomemo-tag-label'>{t('tags')}</span>
          {record.tags.map(tagItem => (
            <Pill key={tagItem} className='hippomemo-tag-pill'>#{tagItem}</Pill>
          ))}
        </div>
      ) : null}
      <dl className='hippomemo-facts'>
        <div className='hippomemo-fact'><dt>{t('importanceLabel')}</dt><dd>{record.importance.toFixed(2)}</dd></div>
        <div className='hippomemo-fact'><dt>{t('revisionLabel')}</dt><dd>{record.revision}</dd></div>
        <div className='hippomemo-fact'><dt>{t('sourceSession')}</dt><dd>{record.sourceSessionId}</dd></div>
        {hasSpark ? (
          <div className='hippomemo-fact hippomemo-fact-spark'>
            <dt>{t('sourceSpark')}</dt>
            <dd>
              <Pill className='hippomemo-source-spark-pill' title={t('sourceSparkHint')}>
                <IconBranchOutline16 size={12} /> {t('sourceSparkBadge')}: 
                <code className='hippomemo-source-spark-id'>{(record.sourceSparkId ?? '').slice(0, 8)}</code>
              </Pill>
            </dd>
          </div>
        ) : null}
        <div className='hippomemo-fact'><dt>{t('createdAt')}</dt><dd>{formatDate(record.createdAt)}</dd></div>
        <div className='hippomemo-fact'><dt>{t('updatedAt')}</dt><dd>{formatDate(record.updatedAt)}</dd></div>
        <div className='hippomemo-fact'><dt>{t('usageRecalled')}</dt><dd>{record.recallCount} · {record.lastRecalledAt === null ? '—' : formatDate(record.lastRecalledAt)}</dd></div>
        <div className='hippomemo-fact'><dt>{t('usageCited')}</dt><dd>{record.citationCount} · {record.lastCitedAt === null ? '—' : formatDate(record.lastCitedAt)}</dd></div>
      </dl>
      <div className='hippomemo-lineage'>
        <h4 className='hippomemo-lineage-title'><IconBranchOutline16 size={14} /> {t('modalLineage')}</h4>
        {hasSpark ? (
          <div className='hippomemo-lineage-row'>
            <Pill className='hippomemo-lineage-node hippomemo-lineage-spark'>
              {t('modalLineageSpark', { id: (record.sourceSparkId ?? '').slice(0, 8) })}
            </Pill>
            <span className='hippomemo-lineage-arrow'>──结晶──▶</span>
            <Pill className='hippomemo-lineage-node hippomemo-lineage-crystal'>
              {t('modalLineageCrystallize', { kind: record.kind, importance: record.importance.toFixed(2) })}
            </Pill>
            <span className='hippomemo-lineage-arrow'>──▶</span>
            <Pill className='hippomemo-lineage-node hippomemo-lineage-hippo'>
              {t('modalLineageMemory', { id: record.id.slice(0, 8) })}
            </Pill>
          </div>
        ) : (
          <div className='hippomemo-lineage-row'>
            <Pill className='hippomemo-lineage-node hippomemo-lineage-crystal'>{t('modalLineageDirect')}</Pill>
            <span className='hippomemo-lineage-arrow'>──▶</span>
            <Pill className='hippomemo-lineage-node hippomemo-lineage-hippo'>
              {t('modalLineageMemory', { id: record.id.slice(0, 8) })}
            </Pill>
          </div>
        )}
        <p className='hippomemo-lineage-note'>{hasSpark ? t('modalLineageSparkNote') : t('modalLineageDirectNote')}</p>
      </div>
      {related.length > 0 ? (
        <div className='hippomemo-related'>
          <span className='hippomemo-related-label'>{t('related')}</span>
          <div className='hippomemo-related-list'>
            {related.map(item => (
              <Button key={item.id} size='sm' variant='ghost'
                className='hippomemo-related-item'
                onClick={() => { onEdit(item.id); }}>
                <span className='hippomemo-related-title'>{item.title}</span>
                <span className='hippomemo-related-meta'>{t(item.kind)} · {formatDate(item.updatedAt)}</span>
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

// ========== Memory Editor Modal ==========
function MemoryEditorModal({ api, t, initial, onCancel, onSaved }: {
  api: HippomemoApi; t: Translate;
  initial?: MemoryRecord; onCancel: () => void; onSaved: () => void;
}): ReactNode {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '');
  const [kind, setKind] = useState<MemoryKind>(initial?.kind ?? 'insight');
  const [scope, setScope] = useState<MemoryScope>(initial?.scope ?? 'global');
  const [importance, setImportance] = useState(String(initial?.importance ?? 0.5));
  const [saving, setSaving] = useState(false);
  const submit = async (): Promise<void> => {
    setSaving(true);
    try {
      const patch: MemoryPatchInput = {
        title, content,
        tags: tags.split(',').map(item => item.trim()).filter(item => item.length > 0),
        kind, scope, importance: Number(importance) || 0.5,
      };
      if (initial === undefined) await api.create(patch as MemoryPutInput);
      else await api.update(initial.id, patch);
      onSaved();
    } finally { setSaving(false); }
  };
  return (
    <Modal
      open={true} onClose={onCancel}
      title={initial === undefined ? t('newMemory') : t('edit')}
      closeLabel={t('cancel')}
      className='hippomemo-edit-modal'
      contentClassName='hippomemo-edit-modal-body'
      footer={(
        <div className='hippomemo-edit-modal-footer'>
          <Button variant='ghost' size='md' onClick={onCancel}>{t('cancel')}</Button>
          <Button variant='primary' size='md' disabled={saving} onClick={() => { void submit(); }}>{t('save')}</Button>
        </div>
      )}
    >
      <label className='hippomemo-form-label'>{t('titleLabel')}
        <Input value={title} onChange={event => { setTitle(event.currentTarget.value); }} />
      </label>
      <label className='hippomemo-form-label'>{t('kind')}
        <HippomemoSelect value={kind} placeholder={t('kind')}
          options={KINDS.map(value => ({ value, label: t(value) }))}
          onChange={(value) => { setKind(value as MemoryKind); }} />
      </label>
      <label className='hippomemo-form-label'>{t('scope')}
        <HippomemoSelect value={scope} placeholder={t('scope')}
          options={SCOPES.map(value => ({ value, label: t(value) }))}
          onChange={(value) => { setScope(value as MemoryScope); }} />
      </label>
      <label className='hippomemo-form-label'>{t('importanceLabel')}
        <Input type='number' min='0' max='1' step='0.1' value={importance}
          onChange={event => { setImportance(event.currentTarget.value); }} />
      </label>
      <label className='hippomemo-form-label'>{t('contentLabel')}
        <Textarea value={content} onChange={event => { setContent(event.currentTarget.value); }} />
      </label>
      <label className='hippomemo-form-label'>{t('tagsLabel')}
        <Input value={tags} onChange={event => { setTags(event.currentTarget.value); }} />
      </label>
    </Modal>
  );
}

function MemoryEditorFetched({ api, t, editorTarget, onCancel, onSaved }: {
  api: HippomemoApi; t: Translate; editorTarget: string | 'new';
  onCancel: () => void; onSaved: () => void;
}): ReactNode {
  const [record, setRecord] = useState<MemoryRecord | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (editorTarget === 'new') { setLoaded(true); return; }
    let current = true;
    void api.get(editorTarget).then(found => {
      if (current === false) return;
      setRecord(found ?? undefined); setLoaded(true);
    }).catch(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [api, editorTarget]);
  if (!loaded) return null;
  return <MemoryEditorModal api={api} t={t}
    {...(record !== undefined ? { initial: record } : {})}
    onCancel={onCancel} onSaved={onSaved} />;
}

// ========== Memory Charts ==========
function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function MemoryCharts({ api, t, stats, reloadKey }: {
  api: HippomemoApi; t: Translate; stats: MemoryStats | null; reloadKey: number;
}): ReactNode {
  const [allRecords, setAllRecords] = useState<MemoryRecord[]>([]);
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setError('');
    void Promise.all([
      api.list({ limit: 200, sort: 'updatedAt', order: 'desc' }),
      api.citations({ limit: 200 }),
    ]).then(([list, citationsResult]) => {
      if (current === false) return;
      setAllRecords(list.items); setCitations(citationsResult.items);
    }).catch((cause: unknown) => {
      if (current === false) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { current = false; };
  }, [api, reloadKey]);
  const kindRows = useMemo<ChartDatum[]>(() => {
    if (stats === null) return [];
    return KINDS.map(kind => ({ key: kind, label: t(kind), value: stats.byKind[kind] }))
      .filter(row => row.value > 0);
  }, [stats]);
  const recallByKind = useMemo<ChartDatum[]>(() => {
    if (allRecords.length === 0) return [];
    const sums = new Map<MemoryKind, number>();
    for (const record of allRecords) {
      const recall = record.recallCount;
      if (recall <= 0) continue;
      sums.set(record.kind, (sums.get(record.kind) ?? 0) + recall);
    }
    return KINDS.map(kind => ({ key: kind, label: t(kind), value: sums.get(kind) ?? 0 }))
      .filter(row => row.value > 0);
  }, [allRecords, t]);
  const statusRows = useMemo<ChartDatum[]>(() => {
    if (stats === null) return [];
    const counts: Record<string, number> = {
      active: stats.active, archived: stats.archived,
      superseded: stats.superseded, candidate: stats.candidate,
    };
    return STATUSES.map(status => ({ key: status, label: t(status), value: counts[status] ?? 0 }))
      .filter(row => row.value > 0);
  }, [stats]);
  const topRecalled = useMemo<ChartDatum[]>(() =>
    [...allRecords]
      .filter(record => record.recallCount > 0)
      .sort((a, b) => b.recallCount - a.recallCount)
      .slice(0, 8)
      .map(record => ({
        key: record.id, label: record.title, value: record.recallCount,
        detail: t('usageCited') + ' ' + String(record.citationCount),
      })),
  [allRecords, t]);
  const trendPoints = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const citation of citations) {
      const key = dayKey(citation.ts);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, label: key.slice(5), value }));
  }, [citations]);
  if (error.length > 0) return <p className='hippomemo-error'>{t('loadFailed')}: {error}</p>;
  return (
    <div className='hippomemo-chart-grid'>
      {kindRows.length > 0 ? (
        <section className='hippomemo-chart-card'>
          <div className='hippomemo-chart-title'>{t('chartKindTitle')}</div>
          <DonutChart rows={kindRows} centerValue={String(stats?.total ?? 0)} centerLabel={t('chartTotal')}
            ariaLabel={t('chartKindTitle')} formatValue={value => String(value)} />
        </section>
      ) : null}
      {statusRows.length > 0 ? (
        <section className='hippomemo-chart-card'>
          <div className='hippomemo-chart-title'>{t('chartStatusTitle')}</div>
          <DonutChart rows={statusRows} centerValue={String(stats?.total ?? 0)} centerLabel={t('chartTotal')}
            ariaLabel={t('chartStatusTitle')} formatValue={value => String(value)} />
        </section>
      ) : null}
      <section className='hippomemo-chart-card'>
        <div className='hippomemo-chart-title'>{t('chartTopRecalledTitle')}</div>
        {topRecalled.length === 0 ? <p className='hippomemo-empty'>{t('chartNoData')}</p> :
          <BarChart rows={topRecalled} ariaLabel={t('chartTopRecalledTitle')}
            formatValue={value => String(value)} axisFormatter={value => String(Math.round(value))} />}
      </section>
      <section className='hippomemo-chart-card'>
        <div className='hippomemo-chart-title'>{t('chartRecallByKindTitle')}</div>
        {recallByKind.length === 0 ? <p className='hippomemo-empty'>{t('chartNoData')}</p> :
          <BarChart rows={recallByKind} ariaLabel={t('chartRecallByKindTitle')}
            formatValue={value => String(value)} axisFormatter={value => String(Math.round(value))} />}
      </section>
      <section className='hippomemo-chart-card hippomemo-chart-card-wide'>
        <div className='hippomemo-chart-title'>{t('chartCitationsTrendTitle')}</div>
        {trendPoints.length < 2 ? <p className='hippomemo-empty'>{t('chartNoData')}</p> :
          <TrendChart points={trendPoints} ariaLabel={t('chartCitationsTrendTitle')}
            formatValue={value => String(value)} gradientId='dsh-hippomemo-citations-grad' />}
      </section>
    </div>
  );
}

// ========== Evolve Panel ==========
const ACTION_LABELS: Record<EvolveReport['actions'][number]['action'], HippomemoLocaleKey> = {
  archive: 'evolveActionArchive',
  probation: 'evolveActionProbation',
  'cancel-probation': 'evolveActionCancelProbation',
  supersede: 'evolveActionSupersede',
  link: 'evolveActionLink',
  'downgrade-scope': 'evolveActionDowngradeScope',
}
function EvolvePanel({ api, t }: { api: HippomemoApi; t: Translate }): ReactNode {
  const [report, setReport] = useState<EvolveReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [kindMap, setKindMap] = useState<Map<string, MemoryKind>>(new Map());
  useEffect(() => {
    let current = true;
    void api.evolveLast().then(found => { if (current) setReport(found); })
      .catch((cause: unknown) => {
        if (current === false) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { current = false; };
  }, [api]);
  useEffect(() => {
    if (report === null) { setKindMap(new Map()); return; }
    const ids = new Set<string>();
    for (const action of report.actions) ids.add(action.id);
    if (report.review !== undefined) for (const verdict of report.review) ids.add(verdict.id);
    if (ids.size === 0) return;
    let current = true;
    void Promise.all([...ids].map(async id => {
      try {
        const record = await api.get(id);
        return record === null ? null : [id, record.kind] as const;
      } catch { return null; }
    })).then(entries => {
      if (current === false) return;
      const next = new Map<string, MemoryKind>();
      for (const entry of entries) if (entry !== null) next.set(entry[0], entry[1]);
      setKindMap(next);
    });
    return () => { current = false; };
  }, [api, report]);
  const run = async (dryRun: boolean): Promise<void> => {
    setRunning(true); setError('');
    try { setReport(await api.evolveRun(dryRun)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRunning(false); }
  };
  return (
    <div className='hippomemo-panel'>
      <p className='hippomemo-intro'>{t('evolveIntro')}</p>
      <div className='hippomemo-toolbar'>
        <Button variant='outline' size='md' disabled={running} onClick={() => { void run(true); }}>
          {running ? t('evolveRunning') : t('evolveRunDry')}
        </Button>
        <Button variant='primary' size='md' disabled={running} onClick={() => { void run(false); }}>
          {running ? t('evolveRunning') : t('evolveRunApply')}
        </Button>
      </div>
      {error.length > 0 ? <p className='hippomemo-error'>{t('loadFailed')}: {error}</p> : null}
      {report === null && error.length === 0
        ? <p className='hippomemo-empty'>{t('evolveNoReport')}</p> : null}
      {report !== null ? (
        <div className='hippomemo-evolve-report'>
          <div className='hippomemo-meta'>
            <span>{t('evolveRunAt')} {formatDate(report.runAt)}</span>
            <span>{report.dryRun ? t('evolveDryRun') : t('evolveApplied')}</span>
            <span>{t('evolveActionsLabel')} {report.actions.length}</span>
            {report.review !== undefined
              ? <span>{t('evolveReviewedLabel')} {report.review.length}</span> : null}
          </div>
          {report.review !== undefined && report.review.length > 0 ? (
            <div className='hippomemo-evolve-review'>
              <div className='hippomemo-evolve-block-title'>{t('evolveReviewedLabel')}</div>
              {report.review.map(verdict => {
                const kind = kindMap.get(verdict.id);
                return (
                  <div className='hippomemo-evolve-verdict' key={verdict.id}>
                    <Pill className={'hippomemo-verdict-' + verdict.verdict}>
                      {verdict.verdict === 'keep' ? t('evolveKeep') : t('evolveNoise')}
                    </Pill>
                    <Pill className={'hippomemo-evolve-kind hippomemo-kind-' + (kind ?? 'unknown')}>
                      {kind === undefined ? '—' : t(kind)}
                    </Pill>
                    <span className='hippomemo-evolve-verdict-id'>{verdict.id.slice(0, 8)}</span>
                    {verdict.reason !== undefined
                      ? <span className='hippomemo-evolve-verdict-reason'>{verdict.reason}</span> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {report.actions.length > 0 ? (
            <div className='hippomemo-evolve-actions'>
              <div className='hippomemo-evolve-block-title'>{t('evolveActionsLabel')}</div>
              {report.actions.map(action => {
                const kind = kindMap.get(action.id);
                return (
                  <div className='hippomemo-evolve-action' key={action.id + action.action}>
                    <Pill className={'hippomemo-action-' + action.action}>{t(ACTION_LABELS[action.action])}</Pill>
                    <Pill className={'hippomemo-evolve-kind hippomemo-kind-' + (kind ?? 'unknown')}>
                      {kind === undefined ? '—' : t(kind)}
                    </Pill>
                    <span className='hippomemo-evolve-action-id'>{action.id.slice(0, 8)}</span>
                    <span className='hippomemo-evolve-action-reason'>{action.reason}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className='hippomemo-empty'>—</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ========== Main Entry ==========
type SectionTab = 'overview' | 'memories' | 'preferences' | 'evolution';

function OverviewTab({ t, stats, usage, preferences, candidates, narrative, citations, now }: {
  t: Translate; stats: MemoryStats | null; usage: MemoryUsageStats | null;
  preferences: PreferenceListResult | null; candidates: PendingCandidateListResult | null;
  narrative: RecallNarrative | null; citations: CitationRecord[]; now: number;
}): ReactNode {
  return (
    <div className='hippomemo-tab'>
      <BrainStrip t={t} stats={stats} usage={usage}
        preferences={preferences} candidates={candidates}
        narrative={narrative} reloadKey={0} />
      <section className='hippomemo-section-card'>
        <div className='hippomemo-section-head'>
          <h3 className='hippomemo-section-title'>{t('overviewLiveActivity')}</h3>
          <Pill className='hippomemo-pill'>{t('recallTitle')}</Pill>
        </div>
        <RecallQuadrant t={t} citations={citations} narrative={narrative} now={now} />
      </section>
    </div>
  )
}

function PreferencesTab({ t, preferences, usage, onAction }: {
  t: Translate; preferences: PreferenceListResult | null;
  usage: MemoryUsageStats | null;
  onAction: (action: 'confirm' | 'revise' | 'forget', id: string) => void;
}): ReactNode {
  return (
    <div className='hippomemo-tab'>
      <PreferenceQuadrant t={t} items={preferences?.items ?? []}
        totalRecall={usage?.recalled ?? 0} onAction={onAction} />
    </div>
  )
}

function EvolutionTab({ t, stats, usage, candidates, now, onResolve, api, reloadKey }: {
  t: Translate; stats: MemoryStats | null; usage: MemoryUsageStats | null;
  candidates: PendingCandidateListResult | null; now: number;
  onResolve: (item: PendingCandidate) => void;
  api: HippomemoApi; reloadKey: number;
}): ReactNode {
  return (
    <div className='hippomemo-tab'>
      <section className='hippomemo-section-card'>
        <div className='hippomemo-section-head'>
          <h3 className='hippomemo-section-title'>{t('evolutionCandidatesTitle')}</h3>
          <Pill className='hippomemo-pill'>{t('todoTitle')}</Pill>
          <span className='hippomemo-panel-count'>{candidates?.total ?? 0} 项</span>
        </div>
        <TodoQuadrantImpl t={t} items={candidates?.items ?? []} now={now} onResolve={onResolve} />
      </section>
      <section className='hippomemo-section-card'>
        <div className='hippomemo-section-head'>
          <h3 className='hippomemo-section-title'>{t('evolutionStatsTitle')}</h3>
          <Pill className='hippomemo-pill'>{t('usage')}</Pill>
        </div>
        {stats !== null ? (
          <div className='hippomemo-meta'>
            <span>{t('total')} {stats.total} {t('results')}</span>
            <span>{t('activeCount')} {stats.active}</span>
            <span>{t('archivedCount')} {stats.archived}</span>
          </div>
        ) : null}
        {usage !== null ? (
          <div className='hippomemo-usage'>
            <span className='hippomemo-usage-label'>{t('usage')}</span>
            <span title={t('usageRecalled')}>{t('usageRecalled')} {usage.recalled}/{usage.total}</span>
            <span>{t('usageCited')} {usage.cited}</span>
            <span>{t('usageNeverRecalled')} {usage.neverRecalled}</span>
            <span>{t('usageStale')} {usage.staleCount}</span>
            <span>{t('usageRecallRate')} {(usage.recallRate * 100).toFixed(0)}%</span>
            <span>{t('usageCitationRate')} {(usage.citationRate * 100).toFixed(0)}%</span>
            <span>{t('usageConversion')} {(usage.conversionRate * 100).toFixed(0)}%</span>
            {usage.staleCount > 0 ? <span className='hippomemo-usage-hint'>{t('usageStaleHint')}</span> : null}
          </div>
        ) : null}
      </section>
      <section className='hippomemo-section-card'>
        <div className='hippomemo-section-head'>
          <h3 className='hippomemo-section-title'>{t('evolutionChartsTitle')}</h3>
        </div>
        <MemoryCharts api={api} t={t} stats={stats} reloadKey={reloadKey} />
      </section>
      <EvolvePanel api={api} t={t} />
    </div>
  )
}

export function MemorySection({ api, t }: MemorySectionProps): ReactNode {
  const [tab, setTab] = useState<SectionTab>('overview');
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [usage, setUsage] = useState<MemoryUsageStats | null>(null);
  const [preferences, setPreferences] = useState<PreferenceListResult | null>(null);
  const [candidates, setCandidates] = useState<PendingCandidateListResult | null>(null);
  const [narrative, setNarrative] = useState<RecallNarrative | null>(null);
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<string | 'new' | null>(null);
  const reload = (): void => { setReloadKey(prev => prev + 1); };
  useEffect(() => {
    let current = true;
    void Promise.all([
      api.stats(), api.usage(), api.preferences(), api.candidates(),
      api.narrative(), api.citations({ limit: 8 }),
    ]).then(([nextStats, nextUsage, nextPrefs, nextCandidates, nextNarrative, nextCitations]) => {
      if (current === false) return;
      setStats(nextStats); setUsage(nextUsage);
      setPreferences(nextPrefs); setCandidates(nextCandidates);
      setNarrative(nextNarrative); setCitations(nextCitations.items);
    }).catch(() => { /* auxiliary */ });
    return () => { current = false; };
  }, [api, reloadKey]);
  useEffect(() => {
    const close = api.events(() => { reload(); });
    return close;
  }, [api]);
  const resolveCandidate = async (item: PendingCandidate): Promise<void> => {
    try {
      if (item.suggestedAction === 'archive') await api.update(item.id, { status: 'archived' });
      else if (item.suggestedAction === 'downgrade-scope') await api.update(item.id, { scope: 'workspace', globalProven: false });
      else if (item.suggestedAction === 'supersede' && item.targetId !== undefined) await api.update(item.id, { supersededBy: item.targetId, status: 'superseded' });
      else if (item.suggestedAction === 'link' && item.targetId !== undefined) await api.update(item.id, { relatedIds: [item.targetId] });
      else if (item.suggestedAction === 'probation') await api.update(item.id, { expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
      reload();
    } catch { /* independent */ }
  };
  const prefAction = async (action: 'confirm' | 'revise' | 'forget', id: string): Promise<void> => {
    try {
      if (action === 'forget') await api.remove(id);
      else if (action === 'confirm') await api.update(id, { globalProven: true, scope: 'global' });
      else setDetailId(id);
      reload();
    } catch { /* ignore */ }
  };
  const now = Date.now();
  return (
    <div className='hippomemo-section' data-plugin='dsh-hippomemo'>
      <h2 className='hippomemo-title'>{t('title')}</h2>
      <p className='hippomemo-intro'>{t('intro')}</p>
      <SegmentedControl<SectionTab>
        className='hippomemo-tabs'
        ariaLabel='hippomemo section'
        value={tab} onChange={setTab}
        options={[
          { value: 'overview', label: t('tabOverview') },
          { value: 'memories', label: t('tabMemories') },
          { value: 'preferences', label: t('tabPreferences') },
          { value: 'evolution', label: t('tabEvolution') },
        ]}
      />
      {tab === 'overview' ? (
        <OverviewTab t={t} stats={stats} usage={usage}
          preferences={preferences} candidates={candidates}
          narrative={narrative} citations={citations} now={now} />
      ) : tab === 'memories' ? (
        <div className='hippomemo-tab'>
          <MemoryListPanel t={t} api={api} detailId={detailId}
            onDetail={(id) => { if (id === 'new') setEditorTarget('new'); else setDetailId(id); }} />
        </div>
      ) : tab === 'preferences' ? (
        <PreferencesTab t={t} preferences={preferences} usage={usage}
          onAction={(action, id) => { void prefAction(action, id); }} />
      ) : (
        <EvolutionTab t={t} stats={stats} usage={usage} candidates={candidates}
          now={now} api={api} reloadKey={reloadKey}
          onResolve={(item) => { void resolveCandidate(item); }} />
      )}
      {detailId !== null ? (
        <MemoryDetailModal api={api} t={t} id={detailId} refreshKey={reloadKey}
          onBack={() => { setDetailId(null); }}
          onEdit={(id) => { setDetailId(null); setEditorTarget(id); }}
          onDeleted={(id) => { if (detailId === id) setDetailId(null); reload(); }} />
      ) : null}
      {editorTarget !== null ? (
        <MemoryEditorFetched api={api} t={t} editorTarget={editorTarget}
          onCancel={() => { setEditorTarget(null); }}
          onSaved={() => { setEditorTarget(null); reload(); }} />
      ) : null}
    </div>
  );
}
