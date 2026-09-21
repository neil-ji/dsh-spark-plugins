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
  BarChart, Button, Card, Disclosure, DonutChart,
  Input, ListRow, Menu, Modal, Pill, SearchInput, SegmentedControl,
  Stat, StatGrid, StateDot, Textarea, TrendChart,
} from 'dsh-ui-kit'
import type { ChartDatum } from 'dsh-ui-kit'
import {
  IconBranch, IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp,
  IconEdit, IconPlus, IconTrash, IconWarning,
} from './icons.tsx'
import type { HippomemoApi, MemoryTagCount } from './api.ts'
import { IMPORTANCE_TIERS, importanceTier, tierValue, type ImportanceTier } from '../importance.ts'
import type { HippomemoLocaleKey } from './locales.ts'
import type {
  CitationRecord, EvolveReport, MemoryKind, MemoryListQuery, MemoryPatchInput,
  MemoryPutInput, MemoryRecord, MemoryScope, MemorySortKey, MemorySortOrder, MemoryStats,
  MemoryStatus, MemoryUsageStats, PendingCandidate, PendingCandidateListResult,
  PreferenceListResult, PreferenceRecord, RecallNarrative,
} from '../types.ts'

type Translate = (key: HippomemoLocaleKey, vars?: Record<string, string | number>) => string

/**
 * 宿主进化引擎产出的 reason 是英文机器串（memory-evolve.ts 生成，不归 UI 字典）；
 * 这里按已知模式做客户端本地化，未匹配的原样透出 —— 引擎新增模式不会被吞。
 */
function formatTodoReason(reason: string, t: Translate): string {
  const cited = reason.match(/^near-duplicate of cited memory \(title overlap (\d+)%\), human review$/)
  if (cited) return t('todoReasonNearDupCited').replaceAll('{pct}', cited[1])
  const unused = reason.match(/^near-duplicate of (.+) \(title overlap (\d+)%\), unused$/)
  if (unused) return t('todoReasonNearDupUnused').replaceAll('{title}', unused[1]).replaceAll('{pct}', unused[2])
  return reason
}
export interface MemorySectionProps {
  api: HippomemoApi
  t: Translate
  /**
   * 嵌进别的宿主（dock 面板）时置 true：**不渲染页级 h2 + 简介**。
   *
   * dock 的模块头已经给出插件名与一句说明（`DOCK_MODULES[].name/sub`），设置页侧栏同理。
   * 以前是靠 dock 的 compat CSS `display:none` 压掉这两个节点 —— 那是「渲染了再擦掉」：
   * DOM 里留着两层同名标题（h2「记忆 HippoMemo」+ 脑区面板 h3），读屏与标题导航都会撞车。
   * 现在改成根本不渲染，重复的标题在结构上就不存在。
   */
  embedded?: boolean
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
const BRAIN_REGIONS = ['pfc', 'amy', 'hippo', 'cortex'] as const
type BrainRegion = typeof BRAIN_REGIONS[number]
interface SelectOption { value: string; label: string }

function HippomemoSelect({ value, placeholder, options, onChange, className }: {
  value: string; placeholder: string; options: SelectOption[]; onChange: (value: string) => void
  /** 额外的形态修饰类（如分页器里的紧凑宽度）。 */
  className?: string
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
        <Button ref={triggerRef} variant='secondary' size='sm'
          className={['hippomemo-select', open ? 'hippomemo-select-open' : '', className ?? ''].filter(Boolean).join(' ')}
          onClick={openMenu}>
          <span className='hippomemo-select-label'>{label}</span>
          <span className='hippomemo-select-chevron' aria-hidden='true'>
            <IconChevronDown />
          </span>
        </Button>
      )}
      items={options.map(option => ({ id: option.value, label: option.label }))}
      selectedId={value}
      onSelect={(id) => { onChange(id); setOpen(false) }}
      onClose={() => { setOpen(false) }} />
  )
}

/** 档位的 tag 修饰类：关键/重要给颜色（值得一眼看到），一般/次要沉下去。 */
const IMPORTANCE_TAGS: Record<ImportanceTier, string> = {
  critical: 'hippomemo-tag hippomemo-tag-warn',
  high: 'hippomemo-tag hippomemo-tag-brand',
  normal: 'hippomemo-tag hippomemo-tag-neutral',
  low: 'hippomemo-tag hippomemo-imp-low',
}

const IMPORTANCE_KEYS: Record<ImportanceTier, HippomemoLocaleKey> = {
  critical: 'importanceCritical',
  high: 'importanceHigh',
  normal: 'importanceNormal',
  low: 'importanceLow',
}

/** 重要度的展示文案：裸数字对用户无意义，一律走档位词（2026-09 用户裁决）。 */
function importanceText(t: Translate, importance: number): string {
  return t(IMPORTANCE_KEYS[importanceTier(importance)])
}

function formatDate(value: number): string { return new Date(value).toLocaleString() }
/** 相对时间一律走 locale（中文「3 分钟前」/ 英文 "3 min ago"）——见 UI-UX-SPEC §6。 */
function formatRelative(ms: number, now: number, t: Translate): string {
  const delta = Math.max(0, now - ms)
  const minute = 60_000, hour = 60 * minute, day = 24 * hour
  if (delta < minute) return t('timeJustNow')
  if (delta < hour) return t('timeMinutesAgo', { n: Math.floor(delta / minute) })
  if (delta < day) return t('timeHoursAgo', { n: Math.floor(delta / hour) })
  if (delta < 30 * day) return t('timeDaysAgo', { n: Math.floor(delta / day) })
  if (delta < 365 * day) return t('timeMonthsAgo', { n: Math.floor(delta / (30 * day)) })
  return t('timeYearsAgo', { n: Math.floor(delta / (365 * day)) })
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
// ========== BrainStrip ==========
function BrainStrip({ t, stats, usage, preferences, narrative, reloadKey }: {
  t: Translate; stats: MemoryStats | null; usage: MemoryUsageStats | null;
  preferences: PreferenceListResult | null;
  narrative: RecallNarrative | null; reloadKey: number;
}): ReactNode {
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
  const regions: Array<{ id: BrainRegion; nameKey: HippomemoLocaleKey; val: string }> = [
    { id: 'pfc', nameKey: 'brainRegionPfc', val: t('brainValPfc', { injected: String(injected), suppressed: String(suppressed) }) },
    { id: 'amy', nameKey: 'brainRegionAmy', val: t('brainValAmy', { n: preferenceCount }) },
    { id: 'hippo', nameKey: 'brainRegionHippo', val: t('brainValHippo', { n: crystallised }) },
    { id: 'cortex', nameKey: 'brainRegionCortex', val: t('brainValCortex', { n: total }) },
  ];
  return (
    // 结构统一（2026-09 用户裁决「对齐财务插件」）：卡面容器一律 ui-kit Card，
    // 手搓的 .hippomemo-brain-panel 卡面规则退役（类名保留只承担布局语义）。
    // 展开的脑区说明卡整体移除（2026-09 用户裁决「功能重复，保留一个」）：
    // 数字摘要行是活数据，静态说明卡是死文档 —— 保留前者。
    <Card title={t('brainPanelTitle')} className='hippomemo-brain-panel'>
      <div className='hippomemo-brain-strip' aria-label={t('brainPanelTitle')}>
        <div className='hippomemo-brain-row'>
          {regions.map(region => {
            const pulse = pulseRegion === region.id
            return (
              <Button key={region.id} variant='ghost' size='sm'
                className={'hippomemo-brain-region' + (pulse ? ' hippomemo-brain-region-anim hippomemo-brain-region-anim-' + region.id : '')}
                data-region={region.id}
                onClick={() => { setPulseRegion(region.id); window.setTimeout(() => setPulseRegion(null), 900) }}
                aria-label={t(region.nameKey) + ' · ' + region.val}>
                <StateDot status='live' size={10} className={'hippomemo-brain-dot hippomemo-brain-dot-' + region.id} />
                <span className='hippomemo-brain-name'>{t(region.nameKey)}</span>
                <span className='hippomemo-brain-val'>{region.val}</span>
              </Button>
            )
          })}
        </div>
        <div className='hippomemo-brain-narration'>
          <span className='hippomemo-brain-narration-lbl'>{t('brainNarrationLabel')}</span>
          <span className='hippomemo-brain-narration-txt'>
            {narrative !== null ? narrative.text : t('brainEmptyNarration')}
          </span>
        </div>
      </div>
    </Card>
  )
}

// ========== Todo Quadrant ==========
function TodoQuadrantImpl({ t, items, now, onResolve }: {
  t: Translate; items: PendingCandidate[]; now: number;
  onResolve: (action: PendingCandidate) => void;
}): ReactNode {
  if (items.length === 0) {
    return (
      <Card title={t('todoTitle')} actions={<span className='hippomemo-panel-count'>0 项</span>}>
        <p className='hippomemo-quadrant-empty'>
          <IconWarning size={12} /> {t('todoEmpty')}
        </p>
      </Card>
    );
  }
  return (
    <Card title={t('todoTitle')} actions={<span className='hippomemo-panel-count'>{items.length} 项</span>}>
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
              <StateDot status={kindClass === 'danger' ? 'error' : 'idle'} size={14} className={'hippomemo-todo-icon hippomemo-todo-icon-' + kindClass} />
              <div className='hippomemo-todo-body'>
                {/* hover 看全文：标题列表里截断，全文只能靠悬浮（2026-09 用户反馈）。 */}
                <div className='hippomemo-todo-title' title={item.title}>{item.title}</div>
                <div className='hippomemo-todo-desc'>
                  <Pill className={'hippomemo-tag hippomemo-kind-' + item.memoryKind}>{t(kindKeyMap[item.kind])}</Pill>
                  {/* 观察项的文案客户端自渲染：宿主 reason 是带「观察中/剩 n 天」的
                      机器串，与 kind pill 重复且不可本地化；结构化字段只有
                      expiresAt —— 用户关心的是「几天后归档」，不是创建于几天前，
                      所以「n 天前」meta 一并移除（2026-09 用户裁决）。 */}
                  <span className='hippomemo-todo-reason'>
                    {item.kind === 'observation'
                      ? t('todoObservationArchive').replaceAll('{n}', String(Math.max(1, Math.ceil(((item.expiresAt ?? 0) - now) / 86_400_000))))
                      : formatTodoReason(item.reason, t)}
                  </span>
                </div>
              </div>
              {item.kind === 'observation' ? null : (
                // 引擎自动处理的项（观察期）不再挂「自动」徽标 —— 列表名就是自动处理队列，
                // 整列都是自动的，逐行再标一次是重复（2026-09 用户裁决）。
                // 需要人工决策的项才出操作按钮。
                <Button size='sm' variant='secondary' className='hippomemo-todo-act'
                  onClick={() => { onResolve(item) }}>
                  {t(actionKeyMap[item.suggestedAction])}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ========== Activity feed（「最近活动」卡的内容：召回事件流）==========
/**
 * 只出内容，不出卡头 —— 卡头由 `OverviewTab` 的卡片提供（形制同进化页）。
 * 以前这里自带 `panel-head`，于是同一张卡里出现了「最近活动」与「AI 最近在用」两层，
 * 后者还是前者的子节点，读起来像上下级关系。
 */
function ActivityFeed({ t, citations, narrative, now }: {
  t: Translate; citations: CitationRecord[]; narrative: RecallNarrative | null; now: number;
}): ReactNode {
  if (citations.length === 0 && narrative === null) {
    return <p className='hippomemo-quadrant-empty'>{t('recallEmpty')}</p>;
  }
  const rows: Array<{ key: string; when: string; what: ReactNode; sub: string; kind: 'injected' | 'suppressed' | 'cited' }> = [];
  if (narrative !== null) {
    rows.push({
      key: 'narrative-' + String(narrative.ts),
      when: formatRelative(narrative.ts, now, t),
      what: <span className='hippomemo-recall-m'>{t('recallTitle')}</span>,
      sub: narrative.text,
      kind: narrative.region === 'pfc' ? 'injected' : 'cited',
    });
  }
  for (const citation of citations.slice(0, 4)) {
    rows.push({
      key: citation.id,
      when: formatRelative(citation.ts, now, t),
      what: <span className='hippomemo-recall-m'>{t('recallCited', { n: 1 })}</span>,
      sub: citation.snippet ?? citation.memoryId.slice(0, 8),
      kind: 'cited',
    });
  }
  return (
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
  );
}

// ========== Preference Quadrant ==========
function PreferenceQuadrant({ t, items, totalRecall, onAction }: {
  t: Translate; items: PreferenceRecord[]; totalRecall: number;
  onAction: (action: 'confirm' | 'revise' | 'forget', id: string) => void;
}): ReactNode {
  if (items.length === 0) {
    return (
      <Card title={t('prefTitle')}>
        <p className='hippomemo-quadrant-empty'>{t('prefEmpty')}</p>
      </Card>
    );
  }
  const totalHit = items.reduce((acc, item) => acc + item.hitCount, 0);
  const rate = totalRecall > 0 ? Math.round((totalHit / totalRecall) * 100) : 0;
  return (
    <Card title={t('prefTitle')} actions={(
      <span className='hippomemo-panel-count'>
        {t('prefActive', { n: items.length, rate: String(Math.min(100, rate)) })}
      </span>
    )}>
      <div className='hippomemo-pref-strip'>
        <ul className='hippomemo-pref-list'>
          {items.map(item => {
            const isAuto = item.source === 'auto';
            return (
              <li className={'hippomemo-pref-row' + (item.confirmed ? ' hippomemo-pref-row-confirmed' : '')} key={item.id}>
                <Pill className={'hippomemo-tag ' + (isAuto ? 'hippomemo-tag-error' : 'hippomemo-tag-brand')}>
                  {isAuto ? t('prefSourceAuto') : t('prefSourceManual')}
                </Pill>
                <div className='hippomemo-pref-body'>
                  <div className='hippomemo-pref-text'>{item.title}</div>
                  <div className='hippomemo-pref-stats'>
                    <span className='hippomemo-pref-hit'>{t('prefHitCount', { n: item.hitCount })}</span>
                    <span> · </span>
                    <span>{item.lastSurfacedAt !== null
                      ? t('prefLastSurfaced', { when: formatRelative(item.lastSurfacedAt, Date.now(), t) })
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
    </Card>
  );
}

// ========== Memory List Panel ==========
function MemoryListPanel({ t, api, detailId, onDetail, embedded = false }: {
  t: Translate; api: HippomemoApi; detailId: string | null;
  onDetail: (id: string) => void;
  /** 嵌在宿主（dock）里：不写面板自己的大标题（宿主模块头已写），只留计数。 */
  embedded?: boolean;
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
  // 工具栏重做：筛选收进折叠面板 + 活跃筛选 chips（渐进披露，缓解 6 控件一行的过载）
  const filterChips: { label: string; clear: () => void }[] = [];
  if (q.length > 0) filterChips.push({ label: '“' + q + '”', clear: () => { setQ(''); } });
  if (kind.length > 0) filterChips.push({ label: t(kind as HippomemoLocaleKey), clear: () => { setKind(''); } });
  if (scope.length > 0) filterChips.push({ label: t(scope as HippomemoLocaleKey), clear: () => { setScope(''); } });
  if (status.length > 0) filterChips.push({ label: t(status as HippomemoLocaleKey), clear: () => { setStatus(''); } });
  if (tag.length > 0) filterChips.push({ label: '#' + tag, clear: () => { setTag(''); } });
  const clearAllFilters = (): void => { setQ(''); setKind(''); setScope(''); setStatus(''); setTag(''); setPage(1); };
  return (
    <Card title={embedded ? undefined : t('title')}
      actions={<span className='hippomemo-panel-count'>{total} 条</span>}>
      <div className='hippomemo-toolbar'>
        <SearchInput label={t('searchPlaceholder')} className='hippomemo-search hippomemo-search-grow' value={q}
          onChange={(event) => { setQ(event.currentTarget.value) }}
          placeholder={t('searchPlaceholder')}
          onClear={() => { setQ(''); }} clearLabel={t('clearSearch')} />
        <Button variant='secondary' size='sm'
          title={order === 'desc' ? t('orderDesc') : t('orderAsc')}
          aria-label={order === 'desc' ? t('orderDesc') : t('orderAsc')}
          onClick={toggleOrder}
          icon={order === 'desc' ? <IconChevronDown /> : <IconChevronUp />} />
        <Button variant='primary' size='md' icon={<IconPlus />}
          onClick={() => { onDetail('new'); }}>{t('newMemory')}</Button>
      </div>
      <Disclosure className='hippomemo-filters'
        name={filterChips.length > 0 ? t('filtersActive', { n: String(filterChips.length) }) : t('filters')}
        trailing={filterChips.length > 0 ? <span className='hippomemo-filters-badge'>{String(filterChips.length)}</span> : null}>
        <div className='hippomemo-filters-body'>
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
        </div>
      </Disclosure>
      {filterChips.length > 0 ? (
        <div className='hippomemo-filter-chips' role='group' aria-label={t('filters')}>
          {filterChips.map((chip, index) => (
            <button key={index} type='button' className='hippomemo-chip' aria-label={chip.label}
              onClick={chip.clear}>
              {chip.label}
              <span aria-hidden='true'>×</span>
            </button>
          ))}
          {filterChips.length > 1 ? (
            <button type='button' className='hippomemo-chip hippomemo-chip-clear' onClick={clearAllFilters}>
              {t('filterClearAll')}
            </button>
          ) : null}
        </div>
      ) : null}
      {loading ? <p className='hippomemo-status hippomemo-status-loading' role='status'>{t('loading')}</p> : null}
      {error.length > 0 && loading === false ? (
        <p className='hippomemo-error' role='alert'>{t('loadFailed')}: {error}
          <Button variant='ghost' size='sm' onClick={reload}>{t('retry')}</Button></p>
      ) : null}
      {loading === false && error.length === 0 && records.length === 0
        ? <p className='hippomemo-empty'>{hasFilters ? t('emptySearch') : t('empty')}</p> : null}
      {records.length > 0 ? (
        <div className='hippomemo-list'>
          {records.map(record => {            const archived = record.status === 'archived' || record.status === 'superseded';
            const scoped = (record.modelIds?.length ?? 0) > 0;
            return (
              <ListRow
                key={record.id}
                title={record.title}
                archived={archived}
                onClick={() => { onDetail(record.id); }}
                meta={(
                  <>
                    {/* kind tag 对**所有** kind 一视同仁（2026-09 用户裁决）：
                        preference 以前被单独挪到行尾用品牌色渲染，于是同一列里
                        它的 tag 位置与配色都和别的记忆不一样。图标是 kind 自身的
                        标识（详情弹窗同样带），不是位置差异。 */}
                    <Pill className={'hippomemo-tag hippomemo-kind-' + record.kind}>{t(record.kind)}</Pill>
                    {scoped ? (
                      <Pill className='hippomemo-tag hippomemo-tag-mono' title={(record.modelIds ?? []).join(', ')}>
                        {(record.modelIds ?? [])[0] + ((record.modelIds?.length ?? 0) > 1 ? ' +' + String((record.modelIds?.length ?? 0) - 1) : '')}
                      </Pill>
                    ) : null}
                    {/* scope / 证明态升成 tag：一行里「分类标签一眼可扫」，数值与时间
                        保持安静文本 —— tag 之间及 tag 与文本的间距由 ListRow meta 槽
                        的 gap 统一撑开（2026-09 用户反馈：不要紧贴）。 */}
                    <Pill className='hippomemo-tag hippomemo-tag-neutral'>{t(record.scope)}</Pill>
                    {/* 重要度不带 label，直接出 tag（2026-09 用户裁决）：一排 tag 里
                        多一个「重要度」前缀只是噪声；原始数值留在 title 里可查。 */}
                    <Pill className={IMPORTANCE_TAGS[importanceTier(record.importance)]}
                      title={`${t('importanceLabel')} ${record.importance.toFixed(2)}`}>
                      {importanceText(t, record.importance)}
                    </Pill>
                    {/* 证明态放**最后一个 tag**（2026-09 用户裁决）：每行的 tag 个数不同
                        （kind / 模型范围 / scope / 重要度），把它固定在末尾，右侧那列
                        tag 就跨行对齐，扫一眼就能挑出「已证明」的记忆。 */}
                    {record.scope === 'global' ? (record.globalProven
                      ? <Pill className='hippomemo-tag hippomemo-tag-success'>{t('proven')}</Pill>
                      : <Pill className='hippomemo-tag hippomemo-tag-warn'>
                          {t('unproven')}{(record.seenWorkspaces?.length ?? 0) > 0 ? '·' + String(record.seenWorkspaces?.length) : ''}
                        </Pill>) : null}
                    <span className='hippomemo-row-meta-text' title={formatDate(record.updatedAt)}>
                      {formatRelative(record.updatedAt, Date.now(), t)}
                    </span>
                  </>
                )}
                trailing={(
                  <>
                    {record.sourceSparkId !== undefined && record.sourceSparkId !== null && record.sourceSparkId.length > 0 ? (
                      <span className='hippomemo-row-spark' title={t('sourceSparkHint')}>
                        <IconBranch size={14} />
                      </span>
                    ) : null}
                    <Button size='sm' variant='ghost' title={t('edit')} aria-label={t('edit')}
                      className='hippomemo-icon-btn'
                      onClick={() => { onDetail(record.id); }}
                      icon={<IconEdit size={14} />} />
                    {/* 破坏性入口不铺满列表（复核报告 PCQA-015）：行内只留「编辑」，
                        删除收进详情 modal 页脚（那里有 danger 形制 + 二次确认）。 */}
                  </>
                )}
              />
            );
          })}
        </div>
      ) : null}
      {total > 0 ? (
        <div className='hippomemo-pager'>
          {/* 只留「共 N 条」：页码由翻页按钮自己表达，写一遍是重复（2026-09 用户裁决）。
              内容区与分页器同排（.hippomemo-pager nowrap），紧凑一行。 */}
          <span className='hippomemo-pager-meta'>{t('total')} {total} {t('results')}</span>
          <div className='hippomemo-pager-controls'>
            <HippomemoSelect className='hippomemo-pager-size' value={String(pageSize)} placeholder={t('pageSizeLabel')}
              options={PAGE_SIZES.map(size => ({ value: String(size), label: t('pageSizeLabel') + ' ' + String(size) }))}
              onChange={changePageSize} />
            {/* 前后页收成 icon-only（aria-label 保留语义）：文本「上一页/下一页」
                是换行的主因，一行放下整条分页（2026-09 用户反馈）。 */}
            <Button variant='ghost' size='sm' disabled={page <= 1}
              aria-label={t('prevPage')} title={t('prevPage')}
              onClick={() => { setPage(page - 1); }} icon={<IconChevronLeft />} />
            {pageItems(page, totalPages).map((item, index) => (
              item === 'gap'
                ? <span key={'gap-' + String(index)} className='hippomemo-pager-gap'>…</span>
                : <Button key={item} variant={item === page ? 'secondary' : 'ghost'} size='sm'
                    aria-current={item === page ? 'page' : undefined}
                    onClick={() => { setPage(item); }}>{item}</Button>
            ))}
            <Button variant='ghost' size='sm' disabled={page >= totalPages}
              aria-label={t('nextPage')} title={t('nextPage')}
              onClick={() => { setPage(page + 1); }} icon={<IconChevronRight />} />
          </div>
        </div>
      ) : null}
      <span hidden>{detailId === null ? '0' : '1'}</span>
    </Card>
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
  /**
   * 在飞的写入动作（undefined = 空闲）。
   *
   * 归档 / 删除都是**真写盘**（api.update / api.remove），记录多或磁盘慢时要等一下；
   * 只置 disabled 会让按钮看起来失灵（2026-09-21 与财务面板同批修）。
   */
  const [detailAction, setDetailAction] = useState<'archive' | 'remove' | undefined>(undefined);
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
    // 只读错误弹窗不放「取消」footer：遮罩 / 右上角关闭钮 / Esc 已覆盖关闭
    // （对齐财务插件口径，2026-09 用户裁决冗余取消按钮一律移除）。
    return (
      <Modal open={true} onClose={onBack} title={t('loadFailed')}>
        <div data-plugin='dsh-hippomemo' className='hippomemo-modal-scope'>
          <p className='hippomemo-error'>{error}</p>
        </div>
      </Modal>
    );
  }
  if (record === null) {
    return (
      <Modal open={true} onClose={onBack} title={t('memoryNotFound')}>
        <div data-plugin='dsh-hippomemo' className='hippomemo-modal-scope'>
          <p className='hippomemo-empty'>{t('memoryNotFound')}</p>
        </div>
      </Modal>
    );
  }
  const remove = async (): Promise<void> => {
    if (window.confirm(t('confirmDelete')) === false) return;
    setDetailAction('remove');
    try {
      await api.remove(record.id);
      onDeleted(record.id);
    } finally { setDetailAction(undefined); }
  };
  const archiveToggle = async (): Promise<void> => {
    setDetailAction('archive');
    try {
      await api.update(record.id, { status: record.status === 'archived' ? 'active' : 'archived' });
      onDeleted(record.id);
    } finally { setDetailAction(undefined); }
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
          <Button size='sm' variant='ghost' icon={<IconEdit />} onClick={() => { onEdit(record.id); }}>{t('edit')}</Button>
          <Button size='sm' variant='ghost' loading={detailAction === 'archive'} disabled={detailAction !== undefined}
            onClick={() => { void archiveToggle(); }}>
            {record.status === 'archived' ? t('restore') : t('archive')}
          </Button>
          <Button size='sm' variant='ghost' className='hippomemo-button-danger'
            loading={detailAction === 'remove'} disabled={detailAction !== undefined}
            icon={<IconTrash />} onClick={() => { void remove(); }}>{t('delete')}</Button>
        </div>
      )}
    >
      <div data-plugin='dsh-hippomemo' className='hippomemo-modal-scope'>
      <div className='hippomemo-detail-pills'>
        <Pill className={'hippomemo-tag hippomemo-kind-' + record.kind}>{t(record.kind)}</Pill>
        <Pill className='hippomemo-tag hippomemo-tag-neutral'>{t(record.scope)}</Pill>
        {record.scope === 'global' ? (
          <Pill className={'hippomemo-tag hippomemo-tag-neutral hippomemo-proven-' + (record.globalProven ? 'yes' : 'no')}>
            {record.globalProven ? t('proven') : t('unproven') + '·' + (record.seenWorkspaces?.length ?? 0)}
          </Pill>
        ) : null}
        <Pill className={'hippomemo-tag hippomemo-tag-neutral hippomemo-status-' + record.status}>{t(record.status)}</Pill>
      </div>
      <div className='hippomemo-modal-content hippomemo-detail-content'>{record.content}</div>
      {record.tags.length > 0 ? (
        <div className='hippomemo-tag-list'>
          <span className='hippomemo-tag-label'>{t('tags')}</span>
          {record.tags.map(tagItem => (
            <Pill key={tagItem} className='hippomemo-tag hippomemo-tag-neutral'>#{tagItem}</Pill>
          ))}
        </div>
      ) : null}
      {(record.modelIds?.length ?? 0) > 0 ? (
        <div className='hippomemo-tag-list'>
          <span className='hippomemo-tag-label'>{t('modelIdsLabel')}</span>
          {record.modelIds!.map(modelId => (
            <Pill key={modelId} className='hippomemo-tag hippomemo-tag-mono' title={t('modelIdsHint')}>{modelId}</Pill>
          ))}
        </div>
      ) : null}
      <dl className='hippomemo-facts'>
        <div className='hippomemo-fact'><dt>{t('importanceLabel')}</dt><dd>{importanceText(t, record.importance)}</dd></div>
        <div className='hippomemo-fact'><dt>{t('revisionLabel')}</dt><dd>{record.revision}</dd></div>
        <div className='hippomemo-fact'><dt>{t('sourceSession')}</dt><dd>{record.sourceSessionId}</dd></div>
        {hasSpark ? (
          <div className='hippomemo-fact hippomemo-fact-spark'>
            <dt>{t('sourceSpark')}</dt>
            <dd>
              <Pill className='hippomemo-source-spark-pill' title={t('sourceSparkHint')}>
                <IconBranch size={12} /> {t('sourceSparkBadge')}: 
                <code className='hippomemo-source-spark-id'>{(record.sourceSparkId ?? '').slice(0, 8)}</code>
              </Pill>
            </dd>
          </div>
        ) : null}
        <div className='hippomemo-fact'><dt>{t('createdAt')}</dt><dd>{formatDate(record.createdAt)}</dd></div>
        <div className='hippomemo-fact'><dt>{t('updatedAt')}</dt><dd>{formatDate(record.updatedAt)}</dd></div>
        {/* 计数带单位、没有日期就不写分隔符：原先恒出「0 · —」，用户读到的是
            两个符号而不是一句人话（2026-09 用户反馈）。 */}
        <div className='hippomemo-fact'>
          <dt>{t('usageRecalled')}</dt>
          <dd>{t('usageTimes', { n: String(record.recallCount) })}{record.lastRecalledAt === null ? '' : ' · ' + formatDate(record.lastRecalledAt)}</dd>
        </div>
        <div className='hippomemo-fact'>
          <dt>{t('usageCited')}</dt>
          <dd>{t('usageTimes', { n: String(record.citationCount) })}{record.lastCitedAt === null ? '' : ' · ' + formatDate(record.lastCitedAt)}</dd>
        </div>
      </dl>
      <div className='hippomemo-lineage'>
        <h4 className='hippomemo-lineage-title'><IconBranch size={14} /> {t('modalLineage')}</h4>
        {hasSpark ? (
          <div className='hippomemo-lineage-row'>
            <Pill className='hippomemo-lineage-node hippomemo-lineage-spark'>
              {t('modalLineageSpark', { id: (record.sourceSparkId ?? '').slice(0, 8) })}
            </Pill>
            <span className='hippomemo-lineage-arrow'>──结晶──▶</span>
            <Pill className='hippomemo-lineage-node hippomemo-lineage-crystal'>
              {t('modalLineageCrystallize', { kind: record.kind, importance: importanceText(t, record.importance) })}
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
      </div>
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
  const [modelIds, setModelIds] = useState(initial?.modelIds?.join(', ') ?? '');
  const [kind, setKind] = useState<MemoryKind>(initial?.kind ?? 'insight');
  const [scope, setScope] = useState<MemoryScope>(initial?.scope ?? 'global');
  // 存的是**原始数值**而不是档位：用户没动档位时不得回写（0.62 显示为「重要」，
  // 保存后仍是 0.62）。只有主动选择档位时才写入该档代表值。
  const [importance, setImportance] = useState<number>(initial?.importance ?? tierValue('normal'));
  const [saving, setSaving] = useState(false);
  const submit = async (): Promise<void> => {
    setSaving(true);
    try {
      const patch: MemoryPatchInput = {
        title, content,
        tags: tags.split(',').map(item => item.trim()).filter(item => item.length > 0),
        modelIds: modelIds.split(',').map(item => item.trim()).filter(item => item.length > 0),
        kind, scope, importance,
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
          <Button variant='primary' size='md' loading={saving} disabled={saving} onClick={() => { void submit(); }}>{t('save')}</Button>
        </div>
      )}
    >
      <div data-plugin='dsh-hippomemo' className='hippomemo-modal-scope'>
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
        {/* 四档段控取代 0~1 的数字输入：数字对用户没有判断标准（2026-09 用户裁决）。 */}
        <SegmentedControl
          aria-label={t('importanceLabel')}
          value={importanceTier(importance)}
          onChange={(value) => { setImportance(tierValue(value as ImportanceTier)) }}
          options={IMPORTANCE_TIERS.map(tier => ({ value: tier, label: t(IMPORTANCE_KEYS[tier]) }))}
        />
      </label>
      <label className='hippomemo-form-label'>{t('contentLabel')}
        <Textarea value={content} onChange={event => { setContent(event.currentTarget.value); }} />
      </label>
      <label className='hippomemo-form-label'>{t('tagsLabel')}
        <Input value={tags} onChange={event => { setTags(event.currentTarget.value); }} />
      </label>
      <label className='hippomemo-form-label'>{t('modelIdsLabel')}
        <Input value={modelIds} onChange={event => { setModelIds(event.currentTarget.value); }}
          placeholder='tencent/hy4-preview, deepseek/deepseek-v4-flash' />
        <span className='hippomemo-form-hint'>{t('modelIdsHint')}</span>
      </label>
      </div>
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
        <Card variant='inset' title={t('chartKindTitle')}>
          <DonutChart rows={kindRows} centerValue={String(stats?.total ?? 0)} centerLabel={t('chartTotal')}
            ariaLabel={t('chartKindTitle')} formatValue={value => String(value)} />
        </Card>
      ) : null}
      {statusRows.length > 0 ? (
        <Card variant='inset' title={t('chartStatusTitle')}>
          <DonutChart rows={statusRows} centerValue={String(stats?.total ?? 0)} centerLabel={t('chartTotal')}
            ariaLabel={t('chartStatusTitle')} formatValue={value => String(value)} />
        </Card>
      ) : null}
      <Card variant='inset' title={t('chartTopRecalledTitle')}>
        {topRecalled.length === 0 ? <p className='hippomemo-empty'>{t('chartNoData')}</p> :
          <BarChart rows={topRecalled} ariaLabel={t('chartTopRecalledTitle')}
            formatValue={value => String(value)} axisFormatter={value => String(Math.round(value))} />}
      </Card>
      <Card variant='inset' title={t('chartRecallByKindTitle')}>
        {recallByKind.length === 0 ? <p className='hippomemo-empty'>{t('chartNoData')}</p> :
          <BarChart rows={recallByKind} ariaLabel={t('chartRecallByKindTitle')}
            formatValue={value => String(value)} axisFormatter={value => String(Math.round(value))} />}
      </Card>
      <Card variant='inset' title={t('chartCitationsTrendTitle')} className='hippomemo-chart-card-wide'>
        {trendPoints.length < 2 ? <p className='hippomemo-empty'>{t('chartNoData')}</p> :
          <TrendChart points={trendPoints} ariaLabel={t('chartCitationsTrendTitle')}
            formatValue={value => String(value)} gradientId='dsh-hippomemo-citations-grad' />}
      </Card>
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
/**
 * 进化页的运行状态机：上次报告拉取 / 预演与落盘 / verdict↔memory 的 kind 反查。
 * 2026-09 拆分：状态收进 hook，头部（操作行）与结果（两张卡）分开渲染 ——
 * 操作行要挂在**页顶**（财务形制：页头行在内容卡之上），结果卡留在页尾。
 */
function useEvolve(api: HippomemoApi): {
  report: EvolveReport | null; running: false | 'dry' | 'apply'; error: string;
  kindMap: Map<string, MemoryKind>; run: (dryRun: boolean) => void;
} {
  const [report, setReport] = useState<EvolveReport | null>(null);
  /** 在飞的运行模式（false = 空闲 / 'dry' = 预演 / 'apply' = 落盘）；按钮据此只转自己。 */
  const [running, setRunning] = useState<false | 'dry' | 'apply'>(false);
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
  const run = (dryRun: boolean): void => {
    setRunning(dryRun ? 'dry' : 'apply'); setError('');
    api.evolveRun(dryRun).then(found => { setReport(found); })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setRunning(false); });
  };
  return { report, running, error, kindMap, run };
}

/** 页顶操作行（财务形制）：运行身份在左、动作按钮在右；无运行记录时只在这里说一次。 */
function EvolveHeader({ t, evolve }: { t: Translate; evolve: ReturnType<typeof useEvolve> }): ReactNode {
  const { report, running, run } = evolve;
  return (
    <div className='hippomemo-toolbar hippomemo-evolve-head'>
      <div className='hippomemo-meta'>
        {report !== null ? (
          <>
            <span>{t('evolveRunAt')} {formatDate(report.runAt)}</span>
            <span>{report.dryRun ? t('evolveDryRun') : t('evolveApplied')}</span>
          </>
        ) : (
          <span>{t('evolveNoReport')}</span>
        )}
      </div>
      <div className='hippomemo-toolbar'>
        <Button variant='secondary' size='md' loading={running === 'dry'} disabled={running !== false} onClick={() => { run(true); }}>
          {running !== false ? t('evolveRunning') : t('evolveRunDry')}
        </Button>
        <Button variant='primary' size='md' loading={running === 'apply'} disabled={running !== false} onClick={() => { run(false); }}>
          {running !== false ? t('evolveRunning') : t('evolveRunApply')}
        </Button>
      </div>
    </div>
  );
}

/** 页尾结果区：复核结论与动作各一张卡，组名写在卡头上，数量作为卡头的状态位。 */
function EvolveResults({ t, evolve }: { t: Translate; evolve: ReturnType<typeof useEvolve> }): ReactNode {
  const { report, error, kindMap } = evolve;
  if (error.length > 0) return <p className='hippomemo-error'>{t('loadFailed')}: {error}</p>;
  if (report === null) return null;
  return (
    <>
      {report.review !== undefined && report.review.length > 0 ? (
        <Card title={t('evolveReviewedLabel')} actions={<span className='hippomemo-panel-count'>{report.review.length} 项</span>}>
          <div className='hippomemo-evolve-review'>
            {report.review.map(verdict => {
              const kind = kindMap.get(verdict.id);
              return (
                <div className='hippomemo-evolve-verdict' key={verdict.id}>
                  <Pill className={'hippomemo-tag hippomemo-verdict-' + verdict.verdict}>
                    {verdict.verdict === 'keep' ? t('evolveKeep') : t('evolveNoise')}
                  </Pill>
                  <Pill className={'hippomemo-tag hippomemo-kind-' + (kind ?? 'unknown')}>
                    {kind === undefined ? '—' : t(kind)}
                  </Pill>
                  <span className='hippomemo-evolve-verdict-id'>{verdict.id.slice(0, 8)}</span>
                  {verdict.reason !== undefined
                    ? <span className='hippomemo-evolve-verdict-reason'>{verdict.reason}</span> : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
      <Card title={t('evolveActionsLabel')} actions={<span className='hippomemo-panel-count'>{report.actions.length} 项</span>}>
        {report.actions.length > 0 ? (
          <div className='hippomemo-evolve-actions'>
            {report.actions.map(action => {
              const kind = kindMap.get(action.id);
              return (
                <div className='hippomemo-evolve-action' key={action.id + action.action}>
                  <Pill className={'hippomemo-tag hippomemo-tag-neutral hippomemo-action-' + action.action}>{t(ACTION_LABELS[action.action])}</Pill>
                  <Pill className={'hippomemo-tag hippomemo-kind-' + (kind ?? 'unknown')}>
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
      </Card>
    </>
  );
}

// ========== Main Entry ==========
type SectionTab = 'overview' | 'memories' | 'preferences' | 'evolution';

function OverviewTab({ t, stats, usage, preferences, narrative, citations, now }: {
  t: Translate; stats: MemoryStats | null; usage: MemoryUsageStats | null;
  preferences: PreferenceListResult | null;
  narrative: RecallNarrative | null; citations: CitationRecord[]; now: number;
}): ReactNode {
  return (
    <div className='hippomemo-tab'>
      <BrainStrip t={t} stats={stats} usage={usage}
        preferences={preferences}
        narrative={narrative} reloadKey={0} />
      {/* 两张卡各管一件事，卡头写各自的名字。
          以前是「最近活动」一张无头卡套着两个 panel-head —— 「AI 最近在用」的头在卡内，
          卡头「最近活动」却包着它，读起来像「最近活动」的下级；进化页那一页是三张卡三个头，
          总览页按同一形制对齐。 */}
      <Card title={t('overviewLiveActivity')} actions={(
        <span className='hippomemo-panel-count'>
          {citations.length > 0 || narrative !== null
            ? formatRelative(narrative?.ts ?? citations[0]?.ts ?? now, now, t)
            : '—'}
        </span>
      )}>
        <ActivityFeed t={t} citations={citations} narrative={narrative} now={now} />
      </Card>
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
  const evolve = useEvolve(api);
  return (
    <div className='hippomemo-tab'>
      {/* 页顶操作行（财务形制）：进化引擎的运行身份与动作按钮在所有内容卡之上。 */}
      <EvolveHeader t={t} evolve={evolve} />
      <TodoQuadrantImpl t={t} items={candidates?.items ?? []} now={now} onResolve={onResolve} />
      {/* 存量 + 用量合并成一张数字指标卡（2026-09 用户裁决）：两组数同属
          「记忆层健康度」，一个 StatGrid 全量摆出，不再按叙事拆成两张卡。 */}
      <Card title={t('usage')}>
        {stats !== null || usage !== null ? (
          <StatGrid>
            {stats !== null ? (
              <>
                <Stat label={t('total')} value={String(stats.total)} />
                <Stat label={t('activeCount')} value={String(stats.active)} />
                <Stat label={t('archivedCount')} value={String(stats.archived)} />
              </>
            ) : null}
            {usage !== null ? (
              <>
                <Stat label={t('usageRecalled')} value={`${String(usage.recalled)}/${String(usage.total)}`} />
                <Stat label={t('usageCited')} value={String(usage.cited)} />
                <Stat label={t('usageNeverRecalled')} value={String(usage.neverRecalled)} />
                <Stat label={t('usageStale')} value={String(usage.staleCount)} />
                <Stat label={t('usageRecallRate')} value={`${(usage.recallRate * 100).toFixed(0)}%`} />
                <Stat label={t('usageCitationRate')} value={`${(usage.citationRate * 100).toFixed(0)}%`} />
                <Stat label={t('usageConversion')} value={`${(usage.conversionRate * 100).toFixed(0)}%`} />
              </>
            ) : null}
          </StatGrid>
        ) : null}
      </Card>
      <Card title={t('evolutionChartsTitle')}>
        <MemoryCharts api={api} t={t} stats={stats} reloadKey={reloadKey} />
      </Card>
      <EvolveResults t={t} evolve={evolve} />
    </div>
  )
}

export function MemorySection({ api, t, embedded = false }: MemorySectionProps): ReactNode {
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
      {embedded ? null : (
        <>
          <h2 className='hippomemo-title'>{t('title')}</h2>
          <p className='hippomemo-intro'>{t('intro')}</p>
        </>
      )}
      <SegmentedControl<SectionTab>
        className='hippomemo-tabs'
        fullWidth
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
          preferences={preferences}
          narrative={narrative} citations={citations} now={now} />
      ) : tab === 'memories' ? (
        <div className='hippomemo-tab'>
          <MemoryListPanel t={t} api={api} detailId={detailId} embedded={embedded}
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
