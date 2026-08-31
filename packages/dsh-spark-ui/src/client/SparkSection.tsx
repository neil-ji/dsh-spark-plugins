/**
 * dsh-spark-ui settings section: list of sparks with manual capture, archive,
 * delete, and live SSE updates.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Input, Pill, Textarea } from 'dsh-ui-kit'
import { bindSnapshotSelector, type SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SparkView, SparkScope } from 'dsh-spark-wire'
import { createSparksApi, type SparksApi } from './api.ts'
import type { SparkKey } from './locales.ts'

type Translate = (key: SparkKey) => string

type StatusFilter = 'all' | 'active' | 'archived'

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
  live: boolean
}

/** Page controller: joins the /sparks fetch path and the live SSE stream. */
export class SparkController {
  readonly store: SnapshotStore<SparkState> = createSnapshotStore<SparkState>({
    status: 'idle', error: null, sparks: [], live: false,
  })

  private generation = 0
  private unsubscribe: (() => void) | null = null

  constructor(private readonly api: SparksApi) {}

  load(): void {
    void this.loadAsync()
  }

  /** Refresh only after the page has loaded once. */
  refreshIfLoaded(): void {
    if (this.store.getSnapshot().status === 'idle') return
    void this.loadAsync()
  }

  async loadAsync(): Promise<void> {
    const generation = ++this.generation
    this.store.update(s => { s.status = 'loading'; s.error = null })
    try {
      const sparks = await this.api.list()
      if (generation !== this.generation) return
      this.store.update(s => { s.status = 'ready'; s.error = null; s.sparks = sparks })
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
    if (this.unsubscribe !== null) return
    this.store.update(s => { s.live = true })
    this.unsubscribe = this.api.subscribe(() => { void this.loadAsync() })
  }

  capture(input: { title: string; content: string; scope: SparkScope; tags: string[] }): Promise<SparkView> {
    return this.api.capture({
      title: input.title,
      content: input.content,
      scope: input.scope,
      tags: input.tags,
      workspacePath: null,
      sourceSessionId: 'web-ui',
      sourceAgentId: null,
      sourceTurn: null,
    })
  }

  async archive(id: string): Promise<void> {
    await this.api.archive(id)
    await this.loadAsync()
  }

  async delete(id: string): Promise<void> {
    await this.api.delete(id)
    await this.loadAsync()
  }

  dispose(): void {
    this.generation += 1
    if (this.unsubscribe !== null) {
      this.unsubscribe()
      this.unsubscribe = null
      this.store.update(s => { s.live = false })
    }
  }
}

/**
 * Entry component: renders the section once injected by the slot, or null
 * while the shell has not injected yet.
 */
export function SparkSection(props: SparkSectionProps): ReactNode {
  const { controller, useSnapshot, t, api } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined || api === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t, api }} />
}

function Loaded({ injected }: { injected: SparkSectionInjected }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formTags, setFormTags] = useState('')
  const [formScope, setFormScope] = useState<SparkScope>('project')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    controller.load()
    return () => { controller.dispose() }
  }, [controller])

  const filtered = useMemo<SparkView[]>(() => {
    if (filter === 'all') return state.sparks
    return state.sparks.filter(s => s.status === filter)
  }, [state.sparks, filter])

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
      setFormTitle('')
      setFormContent('')
      setFormTags('')
      setFormScope('project')
      setShowForm(false)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [controller, formTitle, formContent, formTags, formScope, t])

  const onArchive = useCallback(async (id: string): Promise<void> => {
    setBusy(true)
    try { await controller.archive(id) }
    finally { setBusy(false) }
  }, [controller])

  const onDelete = useCallback(async (id: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.confirm !== undefined) {
      if (!window.confirm(t('deleteConfirm'))) return
    }
    setBusy(true)
    try { await controller.delete(id) }
    finally { setBusy(false) }
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
          <FilterButton current={filter} value='all' onChange={setFilter}>{t('filterAll')}</FilterButton>
          <FilterButton current={filter} value='active' onChange={setFilter}>{t('filterActive')}</FilterButton>
          <FilterButton current={filter} value='archived' onChange={setFilter}>{t('filterArchived')}</FilterButton>
        </div>
        <div className="spark-toolbar-right">
          <span className={'spark-live' + (state.live ? ' spark-live-on' : '')}>
            {state.live ? t('liveOn') : t('liveOff')}
          </span>
          <Button variant="outline" disabled={busy} onClick={() => controller.load()}>{t('refresh')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => setShowForm(value => !value)}>
            {showForm ? t('captureCancel') : t('capture')}
          </Button>
        </div>
      </div>

      {showForm ? (
        <form
          className="spark-form"
          onSubmit={(event) => { event.preventDefault(); void onSubmit() }}
        >
          <div className="spark-form-row">
            <label htmlFor="spark-title">{t('captureTitle')}</label>
            <Input
              id="spark-title"
              value={formTitle}
              placeholder={t('captureTitlePlaceholder')}
              onChange={(event) => { setFormTitle((event.currentTarget as HTMLInputElement).value) }}
              maxLength={200}
            />
          </div>
          <div className="spark-form-row">
            <label htmlFor="spark-content">{t('captureContent')}</label>
            <Textarea
              id="spark-content"
              value={formContent}
              placeholder={t('captureContentPlaceholder')}
              onChange={(event) => { setFormContent((event.currentTarget as HTMLTextAreaElement).value) }}
              maxLength={20_000}
            />
          </div>
          <div className="spark-form-row">
            <label htmlFor="spark-tags">{t('captureTags')}</label>
            <Input
              id="spark-tags"
              value={formTags}
              onChange={(event) => { setFormTags((event.currentTarget as HTMLInputElement).value) }}
            />
          </div>
          <div className="spark-form-row">
            <label htmlFor="spark-scope">{t('captureScope')}</label>
            <select
              id="spark-scope"
              value={formScope}
              onChange={(event) => { setFormScope((event.currentTarget as HTMLSelectElement).value as SparkScope) }}
            >
              <option value="project">{t('captureScopeProject')}</option>
              <option value="session">{t('captureScopeSession')}</option>
              <option value="global">{t('captureScopeGlobal')}</option>
            </select>
          </div>
          {formError !== null ? <div className="spark-error">{formError}</div> : null}
          <div className="spark-form-actions">
            <Button variant="outline" type="button" disabled={busy} onClick={() => setShowForm(false)}>
              {t('captureCancel')}
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>{t('captureSubmit')}</Button>
          </div>
        </form>
      ) : null}

      {filtered.length === 0 ? (
        <div className="spark-empty">{state.sparks.length === 0 ? t('empty') : t('emptyFiltered')}</div>
      ) : (
        <div className="spark-list">
          {filtered.map(spark => (
            <article
              key={spark.id}
              className={'spark-card' + (spark.status === 'archived' ? ' spark-card-archived' : '')}
            >
              <header className="spark-card-head">
                <h3 className="spark-card-title">{spark.title}</h3>
                <div className="spark-card-actions">
                  {spark.status === 'active' ? (
                    <Button variant="outline" disabled={busy} onClick={() => { void onArchive(spark.id) }}>
                      {t('archive')}
                    </Button>
                  ) : null}
                  <Button variant="outline" disabled={busy} onClick={() => { void onDelete(spark.id) }}>
                    {t('delete')}
                  </Button>
                </div>
              </header>
              <p className="spark-card-content">{spark.content}</p>
              <footer className="spark-card-meta">
                <Pill>{spark.status === 'active' ? t('active') : t('archived')}</Pill>
                <Pill>{spark.scope}</Pill>
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

function FilterButton({ current, value, onChange, children }: {
  current: StatusFilter
  value: StatusFilter
  onChange: (next: StatusFilter) => void
  children: ReactNode
}): ReactNode {
  const active = current === value
  return (
    <Button variant={active ? 'primary' : 'outline'} onClick={() => onChange(value)}>
      {children}
    </Button>
  )
}

/**
 * Convenience: bind a controller to the same lifecycle the slot provides,
 * returning a SnapshotSelectorHook bound to the controller store.
 */
export function bindSparkController(controller: SparkController): {
  api: SparksApi
  useSnapshot: SnapshotSelectorHook<SparkState>
  controller: SparkController
} {
  const api = createSparksApi()
  return {
    api,
    useSnapshot: bindSnapshotSelector(controller.store),
    controller,
  }
}


