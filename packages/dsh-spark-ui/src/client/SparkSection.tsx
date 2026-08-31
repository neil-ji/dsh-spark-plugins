/**
 * dsh-spark-ui settings section: list of sparks with manual capture, archive,
 * delete, crystallize; emergence proposals inbox; procedural scripts catalog.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Input, Pill, Textarea } from 'dsh-ui-kit'
import { bindSnapshotSelector, type SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SparkView, SparkScope, SparkCrystallize, ProposalView, ProposalStatus, ProposalType, ScriptView, ScriptScope, ScriptCapture, ScriptStep, ScriptInvokeResult } from 'dsh-spark-wire'
import { createSparksApi, type CrystallizeResult, type ReflectResult, type SparksApi } from './api.ts'
import type { SparkKey } from './locales.ts'

type Translate = (key: SparkKey) => string

type Tab = 'sparks' | 'proposals' | 'scripts'
type SparkStatusFilter = 'all' | 'active' | 'archived'
type ProposalFilter = 'pending' | 'accepted' | 'dismissed'
type ScriptFilter = 'all' | 'project' | 'global'

export interface SparkSectionInjected {
  api: SparksApi
  controller: SparkController
  useSnapshot: SnapshotSelectorHook<SparkState>
  t: Translate
}

export type SparkSectionProps = Partial<SparkSectionInjected>

export interface SparkState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  sparks: SparkView[]
  proposals: ProposalView[]
  scripts: ScriptView[]
  live: boolean
}

/** Page controller: joins the /sparks, /proposals, and /scripts HTTP paths. */
export class SparkController {
  readonly store: SnapshotStore<SparkState> = createSnapshotStore<SparkState>({
    status: 'idle', error: null, sparks: [], proposals: [], scripts: [], live: false,
  })

  private generation = 0
  private sparkUnsub: (() => void) | null = null
  private proposalUnsub: (() => void) | null = null
  private scriptUnsub: (() => void) | null = null

  constructor(private readonly api: SparksApi) {}

  load(): void { void this.loadAsync() }

  refreshIfLoaded(): void {
    if (this.store.getSnapshot().status === 'idle') return
    void this.loadAsync()
  }

  async loadAsync(): Promise<void> {
    const generation = ++this.generation
    this.store.update(s => { s.status = 'loading'; s.error = null })
    try {
      const [sparks, proposals, scripts] = await Promise.all([
        this.api.list().catch(() => []),
        this.api.listProposals().catch(() => []),
        this.api.listScripts().catch(() => []),
      ])
      if (generation !== this.generation) return
      this.store.update(s => { s.status = 'ready'; s.error = null; s.sparks = sparks; s.proposals = proposals; s.scripts = scripts })
      this.ensureLive()
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update(s => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  private ensureLive(): void {
    if (this.sparkUnsub === null) {
      this.store.update(s => { s.live = true })
      this.sparkUnsub = this.api.subscribe(() => { void this.loadAsync() })
    }
    if (this.proposalUnsub === null) {
      this.proposalUnsub = this.api.subscribeProposals(() => { void this.loadAsync() })
    }
    if (this.scriptUnsub === null) {
      this.scriptUnsub = this.api.subscribeScripts(() => { void this.loadAsync() })
    }
  }

  capture(input: { title: string; content: string; scope: SparkScope; tags: string[] }): Promise<SparkView> {
    return this.api.capture({
      title: input.title, content: input.content, scope: input.scope, tags: input.tags,
      workspacePath: null, sourceSessionId: 'web-ui', sourceAgentId: null, sourceTurn: null,
    })
  }
  async archive(id: string): Promise<void> { await this.api.archive(id); await this.loadAsync() }
  async delete(id: string): Promise<void> { await this.api.delete(id); await this.loadAsync() }
  async crystallize(id: string, opts: SparkCrystallize = { kind: 'insight', importance: 0.5, globalProven: false }): Promise<CrystallizeResult> {
    const result = await this.api.crystallize(id, opts); await this.loadAsync(); return result
  }
  async reflect(): Promise<ReflectResult> { const result = await this.api.reflect({}); await this.loadAsync(); return result }
  async resolveProposal(id: string, status: 'accepted' | 'dismissed'): Promise<ProposalView> {
    const result = await this.api.resolveProposal(id, status); await this.loadAsync(); return result
  }
  async invokeScript(id: string): Promise<ScriptInvokeResult> { return await this.api.invokeScript(id) }
  async recordScriptResult(id: string, success: boolean): Promise<ScriptView> {
    const result = await this.api.recordScriptResult(id, success); await this.loadAsync(); return result
  }
  async deleteScript(id: string): Promise<void> { await this.api.deleteScript(id); await this.loadAsync() }

  dispose(): void {
    this.generation += 1
    if (this.sparkUnsub !== null) { this.sparkUnsub(); this.sparkUnsub = null }
    if (this.proposalUnsub !== null) { this.proposalUnsub(); this.proposalUnsub = null }
    if (this.scriptUnsub !== null) { this.scriptUnsub(); this.scriptUnsub = null }
    this.store.update(s => { s.live = false })
  }
}

export function SparkSection(props: SparkSectionProps): ReactNode {
  const { controller, useSnapshot, t, api } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined || api === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t, api }} />
}

function Loaded({ injected }: { injected: SparkSectionInjected }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [tab, setTab] = useState<Tab>('sparks')
  const [sparkFilter, setSparkFilter] = useState<SparkStatusFilter>('all')
  const [proposalFilter, setProposalFilter] = useState<ProposalFilter>('pending')
  const [scriptFilter, setScriptFilter] = useState<ScriptFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formTags, setFormTags] = useState('')
  const [formScope, setFormScope] = useState<SparkScope>('project')
  const [formError, setFormError] = useState<string | null>(null)
  const [crystallizeError, setCrystallizeError] = useState<string | null>(null)
  const [crystallizeInfo, setCrystallizeInfo] = useState<{ id: string; kind: string } | null>(null)
  const [reflectInfo, setReflectInfo] = useState<string | null>(null)
  const [scriptResultInfo, setScriptResultInfo] = useState<string | null>(null)
  const [expandedScriptId, setExpandedScriptId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    controller.load()
    return () => { controller.dispose() }
  }, [controller])

  const filteredSparks = useMemo<SparkView[]>(() => {
    if (sparkFilter === 'all') return state.sparks
    return state.sparks.filter(s => s.status === sparkFilter)
  }, [state.sparks, sparkFilter])

  const filteredProposals = useMemo<ProposalView[]>(() => {
    return state.proposals.filter(p => p.status === proposalFilter)
  }, [state.proposals, proposalFilter])

  const filteredScripts = useMemo<ScriptView[]>(() => {
    if (scriptFilter === 'all') return state.scripts
    return state.scripts.filter(s => s.scope === scriptFilter)
  }, [state.scripts, scriptFilter])

  const onSubmit = useCallback(async (): Promise<void> => {
    if (formTitle.trim().length === 0 || formContent.trim().length === 0) {
      setFormError(t('captureFailed'))
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const tags = formTags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
      await controller.capture({ title: formTitle.trim(), content: formContent.trim(), scope: formScope, tags })
      setFormTitle(''); setFormContent(''); setFormTags(''); setFormScope('project'); setShowForm(false)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }, [controller, formTitle, formContent, formTags, formScope, t])

  const onArchive = useCallback(async (id: string): Promise<void> => {
    setBusy(true)
    try { await controller.archive(id) } finally { setBusy(false) }
  }, [controller])

  const onDelete = useCallback(async (id: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.confirm !== undefined) {
      if (!window.confirm(t('deleteConfirm'))) return
    }
    setBusy(true)
    try { await controller.delete(id) } finally { setBusy(false) }
  }, [controller, t])

  const onCrystallize = useCallback(async (spark: SparkView): Promise<void> => {
    if (typeof window !== 'undefined' && window.confirm !== undefined) {
      if (!window.confirm(t('crystallizeConfirm'))) return
    }
    setBusy(true)
    setCrystallizeError(null)
    try {
      const result = await controller.crystallize(spark.id)
      setCrystallizeInfo({ id: result.record.id, kind: result.record.kind })
      setTimeout(() => setCrystallizeInfo(null), 6000)
    } catch (error) {
      const err = error as Error & { code?: string }
      if (err.code === 'SPARK_HIPPO_UNAVAILABLE') {
        setCrystallizeError(t('crystallizeHippoUnavailable'))
      } else {
        setCrystallizeError(err.message || t('crystallizeFailed'))
      }
    } finally { setBusy(false) }
  }, [controller, t])

  const onReflect = useCallback(async (): Promise<void> => {
    setBusy(true)
    setReflectInfo(null)
    try {
      const result = await controller.reflect()
      setReflectInfo(t('reflectDone')
        .replace('X', String(result.newProposals.length))
        .replace('Y', String(result.skippedDuplicate)))
      setTimeout(() => setReflectInfo(null), 6000)
    } catch (error) {
      setReflectInfo(error instanceof Error ? error.message : t('reflectFailed'))
    } finally { setBusy(false) }
  }, [controller, t])

  const onResolve = useCallback(async (id: string, status: 'accepted' | 'dismissed'): Promise<void> => {
    setBusy(true)
    try { await controller.resolveProposal(id, status) } finally { setBusy(false) }
  }, [controller])

  const onInvokeScript = useCallback(async (id: string): Promise<void> => {
    setBusy(true)
    setScriptResultInfo(null)
    try {
      const result = await controller.invokeScript(id)
      // Show the steps briefly as a result hint. The agent would normally drive execution;
      // here we just confirm the invocation was recorded.
      setScriptResultInfo(t('scriptInvoke') + ' OK (' + result.script.invocationCount + 'x, ' + Math.round(result.successRate * 100) + '%)')
      setTimeout(() => setScriptResultInfo(null), 6000)
    } catch (error) {
      setScriptResultInfo(error instanceof Error ? error.message : 'error')
    } finally { setBusy(false) }
  }, [controller, t])

  const onRecordScriptResult = useCallback(async (id: string, success: boolean): Promise<void> => {
    setBusy(true)
    try {
      await controller.recordScriptResult(id, success)
      setScriptResultInfo(t('scriptRecordResult') + ': ' + (success ? t('scriptResultOk') : t('scriptResultFail')))
      setTimeout(() => setScriptResultInfo(null), 6000)
    } finally { setBusy(false) }
  }, [controller, t])

  const onDeleteScript = useCallback(async (id: string, name: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.confirm !== undefined) {
      if (!window.confirm(t('scriptDeleteConfirm').replace('{name}', name))) return
    }
    setBusy(true)
    try { await controller.deleteScript(id) } finally { setBusy(false) }
  }, [controller, t])

  if (state.status === 'error') {
    return (
      <div className="spark-section" data-plugin="dsh-spark-ui">
        <h2 className="spark-title">{t('title')}</h2>
        <p className="spark-intro">{t('intro')}</p>
        <div className="spark-error">{t('loadFailed') + ': ' + (state.error ?? '')}</div>
        <Button variant="outline" disabled={busy} onClick={() => controller.load()}>{t('retry')}</Button>
      </div>
    )
  }

  return (
    <div className="spark-section" data-plugin="dsh-spark-ui">
      <h2 className="spark-title">{t('title')}</h2>
      <p className="spark-intro">{t('intro')}</p>

      <div className="spark-toolbar">
        <div className="spark-toolbar-left">
          <TabButton current={tab} value='sparks' onChange={setTab}>{t('filterAll').replace('All', 'Sparks').replace('全部', '火花')}</TabButton>
          <TabButton current={tab} value='proposals' onChange={setTab}>{t('proposalsTab')}</TabButton>
          <TabButton current={tab} value='scripts' onChange={setTab}>{t('scriptsTab')}</TabButton>
        </div>
        <div className="spark-toolbar-right">
          <span className={'spark-live' + (state.live ? ' spark-live-on' : '')}>
            {state.live ? t('liveOn') : t('liveOff')}
          </span>
          <Button variant="outline" disabled={busy} onClick={() => controller.load()}>{t('refresh')}</Button>
          {tab === 'sparks' ? (
            <Button variant="primary" disabled={busy} onClick={() => setShowForm(value => !value)}>
              {showForm ? t('captureCancel') : t('capture')}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => { void onReflect() }}>
              {t('reflect')}
            </Button>
          )}
        </div>
      </div>

      {tab === 'sparks' ? (
        <SparksTab
          sparks={filteredSparks}
          totalSparks={state.sparks.length}
          showForm={showForm}
          formTitle={formTitle} setFormTitle={setFormTitle}
          formContent={formContent} setFormContent={setFormContent}
          formTags={formTags} setFormTags={setFormTags}
          formScope={formScope} setFormScope={setFormScope}
          formError={formError}
          crystallizeError={crystallizeError}
          crystallizeInfo={crystallizeInfo}
          sparkFilter={sparkFilter} setSparkFilter={setSparkFilter}
          busy={busy}
          t={t}
          onSubmit={onSubmit}
          onArchive={onArchive}
          onDelete={onDelete}
          onCrystallize={onCrystallize}
        />
      ) : tab === 'proposals' ? (
        <ProposalsTab
          proposals={filteredProposals}
          totalProposals={state.proposals.length}
          reflectInfo={reflectInfo}
          proposalFilter={proposalFilter}
          setProposalFilter={setProposalFilter}
          busy={busy}
          t={t}
          onResolve={onResolve}
        />
      ) : (
        <ScriptsTab
          scripts={filteredScripts}
          totalScripts={state.scripts.length}
          scriptResultInfo={scriptResultInfo}
          scriptFilter={scriptFilter}
          setScriptFilter={setScriptFilter}
          expandedScriptId={expandedScriptId}
          setExpandedScriptId={setExpandedScriptId}
          busy={busy}
          t={t}
          onInvoke={onInvokeScript}
          onRecordResult={onRecordScriptResult}
          onDelete={onDeleteScript}
        />
      )}
    </div>
  )
}

function TabButton<T extends string>({ current, value, onChange, children }: {
  current: T, value: T, onChange: (next: T) => void, children: ReactNode
}): ReactNode {
  const active = current === value
  return (
    <Button variant={active ? 'primary' : 'outline'} onClick={() => onChange(value)}>{children}</Button>
  )
}

function FilterButton<T extends string>({ current, value, onChange, children }: {
  current: T, value: T, onChange: (next: T) => void, children: ReactNode
}): ReactNode {
  const active = current === value
  return (
    <Button variant={active ? 'primary' : 'outline'} onClick={() => onChange(value)}>{children}</Button>
  )
}

interface SparksTabProps {
  sparks: SparkView[]; totalSparks: number
  showForm: boolean
  formTitle: string; setFormTitle: (v: string) => void
  formContent: string; setFormContent: (v: string) => void
  formTags: string; setFormTags: (v: string) => void
  formScope: SparkScope; setFormScope: (v: SparkScope) => void
  formError: string | null
  crystallizeError: string | null
  crystallizeInfo: { id: string; kind: string } | null
  sparkFilter: SparkStatusFilter; setSparkFilter: (v: SparkStatusFilter) => void
  busy: boolean
  t: Translate
  onSubmit: () => Promise<void>
  onArchive: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onCrystallize: (spark: SparkView) => Promise<void>
}

function SparksTab(props: SparksTabProps): ReactNode {
  const { sparks, totalSparks, showForm, formTitle, setFormTitle, formContent, setFormContent, formTags, setFormTags, formScope, setFormScope, formError, crystallizeError, crystallizeInfo, sparkFilter, setSparkFilter, busy, t, onSubmit, onArchive, onDelete, onCrystallize } = props
  return (
    <div>
      <div className="spark-toolbar">
        <div className="spark-toolbar-left">
          <FilterButton current={sparkFilter} value='all' onChange={setSparkFilter}>{t('filterAll')}</FilterButton>
          <FilterButton current={sparkFilter} value='active' onChange={setSparkFilter}>{t('filterActive')}</FilterButton>
          <FilterButton current={sparkFilter} value='archived' onChange={setSparkFilter}>{t('filterArchived')}</FilterButton>
        </div>
      </div>

      {showForm ? (
        <form className="spark-form" onSubmit={(event) => { event.preventDefault(); void onSubmit() }}>
          <div className="spark-form-row">
            <label htmlFor="spark-title">{t('captureTitle')}</label>
            <Input id="spark-title" value={formTitle} placeholder={t('captureTitlePlaceholder')} onChange={(event) => { setFormTitle((event.currentTarget as HTMLInputElement).value) }} maxLength={200} />
          </div>
          <div className="spark-form-row">
            <label htmlFor="spark-content">{t('captureContent')}</label>
            <Textarea id="spark-content" value={formContent} placeholder={t('captureContentPlaceholder')} onChange={(event) => { setFormContent((event.currentTarget as HTMLTextAreaElement).value) }} maxLength={20_000} />
          </div>
          <div className="spark-form-row">
            <label htmlFor="spark-tags">{t('captureTags')}</label>
            <Input id="spark-tags" value={formTags} onChange={(event) => { setFormTags((event.currentTarget as HTMLInputElement).value) }} />
          </div>
          <div className="spark-form-row">
            <label htmlFor="spark-scope">{t('captureScope')}</label>
            <select id="spark-scope" value={formScope} onChange={(event) => { setFormScope((event.currentTarget as HTMLSelectElement).value as SparkScope) }}>
              <option value="project">{t('captureScopeProject')}</option>
              <option value="session">{t('captureScopeSession')}</option>
              <option value="global">{t('captureScopeGlobal')}</option>
            </select>
          </div>
          {formError !== null ? <div className="spark-error">{formError}</div> : null}
          <div className="spark-form-actions">
            <Button variant="outline" type="button" disabled={busy} onClick={() => { setFormTitle(''); setFormContent(''); setFormTags('') }}>{t('captureCancel')}</Button>
            <Button variant="primary" type="submit" disabled={busy}>{t('captureSubmit')}</Button>
          </div>
        </form>
      ) : null}

      {crystallizeError !== null ? <div className="spark-error">{crystallizeError}</div> : null}
      {crystallizeInfo !== null ? (
        <div className="spark-error" style={{ color: 'var(--dsw-alias-state-success-primary, var(--dsw-static-green-500))', borderColor: 'var(--dsw-alias-state-success-primary, var(--dsw-static-green-500))' }}>
          {t('crystallizeSuccess') + ': ' + t('crystallizeHippo') + ' = ' + crystallizeInfo.id + ' (' + t('crystallizeKind') + ' = ' + crystallizeInfo.kind + ')'}
        </div>
      ) : null}

      {sparks.length === 0 ? (
        <div className="spark-empty">{totalSparks === 0 ? t('empty') : t('emptyFiltered')}</div>
      ) : (
        <div className="spark-list">
          {sparks.map(spark => (
            <article key={spark.id} className={'spark-card' + (spark.status === 'archived' ? ' spark-card-archived' : '') + (spark.crystallized !== null ? ' spark-card-crystallized' : '')}>
              <header className="spark-card-head">
                <h3 className="spark-card-title">{spark.title}</h3>
                <div className="spark-card-actions">
                  {spark.crystallized === null && spark.status === 'active' ? (
                    <Button variant="outline" disabled={busy} onClick={() => { void onCrystallize(spark) }}>{t('crystallize')}</Button>
                  ) : null}
                  {spark.status === 'active' ? (
                    <Button variant="outline" disabled={busy} onClick={() => { void onArchive(spark.id) }}>{t('archive')}</Button>
                  ) : null}
                  <Button variant="outline" disabled={busy} onClick={() => { void onDelete(spark.id) }}>{t('delete')}</Button>
                </div>
              </header>
              <p className="spark-card-content">{spark.content}</p>
              <footer className="spark-card-meta">
                <Pill>{spark.status === 'active' ? t('active') : t('archived')}</Pill>
                <Pill>{spark.scope}</Pill>
                {spark.crystallized !== null ? <span className="spark-crystallized-badge">{t('crystallizedBadge')}</span> : null}
                {spark.tags.map(tag => <Pill key={tag}>{tag}</Pill>)}
                <span>{new Date(spark.createdAt).toLocaleString()}</span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

interface ProposalsTabProps {
  proposals: ProposalView[]; totalProposals: number
  reflectInfo: string | null
  proposalFilter: ProposalFilter; setProposalFilter: (v: ProposalFilter) => void
  busy: boolean; t: Translate
  onResolve: (id: string, status: 'accepted' | 'dismissed') => Promise<void>
}

function ProposalsTab(props: ProposalsTabProps): ReactNode {
  const { proposals, totalProposals, reflectInfo, proposalFilter, setProposalFilter, busy, t, onResolve } = props
  return (
    <div>
      <div className="spark-toolbar">
        <div className="spark-toolbar-left">
          <FilterButton current={proposalFilter} value='pending' onChange={setProposalFilter}>{t('proposalFilterPending')}</FilterButton>
          <FilterButton current={proposalFilter} value='accepted' onChange={setProposalFilter}>{t('proposalFilterAccepted')}</FilterButton>
          <FilterButton current={proposalFilter} value='dismissed' onChange={setProposalFilter}>{t('proposalFilterDismissed')}</FilterButton>
        </div>
      </div>

      {reflectInfo !== null ? (
        <div className="spark-error" style={{ color: 'var(--dsw-alias-state-success-primary, var(--dsw-static-green-500))', borderColor: 'var(--dsw-alias-state-success-primary, var(--dsw-static-green-500))' }}>
          {reflectInfo}
        </div>
      ) : null}

      {proposals.length === 0 ? (
        <div className="spark-empty">{totalProposals === 0 ? t('proposalEmptyAll') : t('proposalEmpty')}</div>
      ) : (
        <div className="spark-list">
          {proposals.map(proposal => (
            <article key={proposal.id} className="spark-card">
              <header className="spark-card-head">
                <h3 className="spark-card-title">
                  {proposal.type === 'link' ? t('proposalTypeLink') : proposal.type === 'cluster' ? t('proposalTypeCluster') : t('proposalTypePrune')}
                </h3>
                <div className="spark-card-actions">
                  {proposal.status === 'pending' ? (
                    <Button variant="outline" disabled={busy} onClick={() => { void onResolve(proposal.id, 'accepted') }}>{t('proposalAccept')}</Button>
                  ) : null}
                  {proposal.status === 'pending' ? (
                    <Button variant="outline" disabled={busy} onClick={() => { void onResolve(proposal.id, 'dismissed') }}>{t('proposalDismiss')}</Button>
                  ) : null}
                </div>
              </header>
              <p className="spark-card-content">{proposal.explanation}</p>
              <footer className="spark-card-meta">
                <Pill>{proposal.leverage === 'high' ? t('leverageHigh') : proposal.leverage === 'medium' ? t('leverageMedium') : t('leverageLow')}</Pill>
                <Pill>{Math.round(proposal.confidence * 100) + '%'}</Pill>
                <span>{proposal.sparkIds.length} spark(s)</span>
                <span>{new Date(proposal.createdAt).toLocaleString()}</span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

interface ScriptsTabProps {
  scripts: ScriptView[]; totalScripts: number
  scriptResultInfo: string | null
  scriptFilter: ScriptFilter; setScriptFilter: (v: ScriptFilter) => void
  expandedScriptId: string | null; setExpandedScriptId: (v: string | null) => void
  busy: boolean; t: Translate
  onInvoke: (id: string) => Promise<void>
  onRecordResult: (id: string, success: boolean) => Promise<void>
  onDelete: (id: string, name: string) => Promise<void>
}

function ScriptsTab(props: ScriptsTabProps): ReactNode {
  const { scripts, totalScripts, scriptResultInfo, scriptFilter, setScriptFilter, expandedScriptId, setExpandedScriptId, busy, t, onInvoke, onRecordResult, onDelete } = props
  return (
    <div>
      <div className="spark-toolbar">
        <div className="spark-toolbar-left">
          <FilterButton current={scriptFilter} value='all' onChange={setScriptFilter}>{t('scriptFilterAll')}</FilterButton>
          <FilterButton current={scriptFilter} value='project' onChange={setScriptFilter}>{t('scriptFilterProject')}</FilterButton>
          <FilterButton current={scriptFilter} value='global' onChange={setScriptFilter}>{t('scriptFilterGlobal')}</FilterButton>
        </div>
      </div>

      {scriptResultInfo !== null ? (
        <div className="spark-error" style={{ color: 'var(--dsw-alias-state-success-primary, var(--dsw-static-green-500))', borderColor: 'var(--dsw-alias-state-success-primary, var(--dsw-static-green-500))' }}>
          {scriptResultInfo}
        </div>
      ) : null}

      {scripts.length === 0 ? (
        <div className="spark-empty">{totalScripts === 0 ? t('scriptEmptyAll') : t('scriptEmpty')}</div>
      ) : (
        <div className="spark-list">
          {scripts.map(script => {
            const expanded = expandedScriptId === script.id
            const successRate = script.invocationCount === 0 ? 0 : script.successCount / script.invocationCount
            return (
              <article key={script.id} className="spark-card">
                <header className="spark-card-head">
                  <h3 className="spark-card-title">{script.name}</h3>
                  <div className="spark-card-actions">
                    <Button variant="outline" disabled={busy} onClick={() => { void onInvoke(script.id) }}>{t('scriptInvoke')}</Button>
                    <Button variant="outline" disabled={busy} onClick={() => setExpandedScriptId(expanded ? null : script.id)}>{expanded ? '−' : '+'}</Button>
                    <Button variant="outline" disabled={busy} onClick={() => { void onDelete(script.id, script.name) }}>{t('scriptDelete')}</Button>
                  </div>
                </header>
                <p className="spark-card-content">{script.description}</p>
                <footer className="spark-card-meta">
                  <Pill>{script.scope}</Pill>
                  <Pill>{t('scriptSteps') + ': ' + script.steps.length}</Pill>
                  <Pill>{t('scriptSuccessRate') + ': ' + Math.round(successRate * 100) + '%'}</Pill>
                  <Pill>{t('scriptInvocations') + ': ' + script.invocationCount}</Pill>
                  {script.triggers.length > 0 ? <Pill>{t('scriptTriggers') + ': ' + script.triggers.join(', ')}</Pill> : null}
                  <span>{new Date(script.createdAt).toLocaleString()}</span>
                </footer>
                {expanded ? (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--dsw-alias-border-l1)' }}>
                    <ol style={{ paddingLeft: 20, margin: 0 }}>
                      {script.steps.map((step, i) => (
                        <li key={i} style={{ fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)', marginBottom: 4 }}>
                          <Pill>{step.kind === 'instruction' ? t('scriptStepInstruction') : t('scriptStepToolCall')}</Pill>
                          {' '}{step.payload}
                          {step.note !== undefined ? <span style={{ opacity: 0.6 }}>  ({step.note})</span> : null}
                        </li>
                      ))}
                    </ol>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <Button variant="outline" disabled={busy} onClick={() => { void onRecordResult(script.id, true) }}>{t('scriptResultOk')}</Button>
                      <Button variant="outline" disabled={busy} onClick={() => { void onRecordResult(script.id, false) }}>{t('scriptResultFail')}</Button>
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function bindSparkController(controller: SparkController): {
  api: SparksApi
  useSnapshot: SnapshotSelectorHook<SparkState>
  controller: SparkController
} {
  const api = createSparksApi()
  return { api, useSnapshot: bindSnapshotSelector(controller.store), controller }
}


