/**
 * 脚本沉淀库的**治理面** pane（Spec §6.2 / §6.5）。
 *
 * 三块：概览统计（状态 / 成功率分档 / 验收占比）→ 待裁决治理项（建议式，点按钮才落库）
 * → 脚本目录（状态徽章 + 动作 + 按需展开步骤）。
 *
 * 两条硬约束写在这里的实现里：
 *   - **不重算口径**（Spec INV-7 / D10）：成功率、分档、验收占比全部读宿主下发的字段，
 *     本文件里没有一次除法（闸门 `ratemetric` 守着）；
 *   - **人面不计量**（Spec D9）：看步骤走 `GET /scripts/:id`（无副作用），不调 `/invoke`。
 *
 * 变更经 `script/events` 流实时刷新：`ready` 基线帧也要重取（世代之间的窗口不回放）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, Pill, Stat, StatGrid } from 'dsh-ui-kit'
import { useFrames, type StreamRemote } from 'dsh-spark-plugin-kit/client'
import type { ScriptAdvice, ScriptAudit, ScriptStreamFrame, ScriptSummary, ScriptView } from 'dsh-script-wire'
import { scriptApi } from './api.ts'
import { useApiResource } from './useApiResource.ts'
import type { ScriptTranslate } from './ScriptDockModule.tsx'

export interface ScriptsPaneProps {
  t: ScriptTranslate
  /** `ctx.remote`（`$stream` 载体）。 */
  remote: StreamRemote | null
  /** `ctx.reflect.get('remote.script')`（命名空间服务，不能走 inject 取，见 ScriptDockModule 头注）。 */
  events: ScriptEventsFace | null
}

/** `remote.script` 命名空间的最小面（wire 的 namespace map 增强提供类型）。 */
export interface ScriptEventsFace {
  events: (signal?: AbortSignal) => AsyncIterable<ScriptStreamFrame>
}

interface PaneData {
  scripts: ScriptSummary[]
  audit: ScriptAudit
}

/** 0..1 → 百分比文本（只是排版，不是口径计算）。 */
const pct = (value: number): string => String(Math.round(value * 100)) + '%'

/** 状态 / 作用域 → 字典键（显式表，避免拼字符串拼错还编译通过）。 */
const STATUS_LABEL = {
  active: 'statusActive',
  archived: 'statusArchived',
  superseded: 'statusSuperseded',
  candidate: 'statusCandidate',
} as const

const SCOPE_LABEL = {
  global: 'scopeGlobal',
  workspace: 'scopeWorkspace',
  project: 'scopeProject',
} as const

const STATUS_TONE = {
  active: 'success',
  archived: 'neutral',
  superseded: 'warn',
  candidate: 'brand',
} as const

export function ScriptsPane({ t, remote, events }: ScriptsPaneProps): JSX.Element {
  const { data, error, reload } = useApiResource<PaneData>(async () => ({
    // 打开治理面即结算过期（Spec D7：唯一自动动作，不用定时器）。
    audit: await scriptApi.audit(),
    scripts: await scriptApi.list(200),
  }), [])
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ id: string; script: ScriptView } | null>(null)
  const messageTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(messageTimer.current), [])

  const onFrame = useCallback(() => { reload() }, [reload])
  // 命名空间不可用时传 `remote: null` 让 kit 跳过订阅（hook 不能条件调用）。
  useFrames<ScriptStreamFrame>({
    remote: events === null ? null : remote,
    name: 'script/events',
    open: (signal) => events!.events(signal),
    onFrame,
    onReady: onFrame,
  })

  const notify = (text: string, isFailure = false): void => {
    setFailed(isFailure)
    setMessage(text)
    window.clearTimeout(messageTimer.current)
    messageTimer.current = window.setTimeout(() => setMessage(null), 4000)
  }

  /** 所有治理动作的唯一出口：显式点击 → HTTP → 落库（INV-14）。 */
  const run = async (id: string, work: () => Promise<unknown>, done: string): Promise<void> => {
    if (busyId !== null) return
    setBusyId(id)
    try {
      await work()
      notify(done)
    } catch (e) {
      notify(`${t('actionFailed')}: ${e instanceof Error ? e.message : String(e)}`, true)
    } finally {
      setBusyId(null)
      reload()
    }
  }

  const toggleDetail = async (id: string): Promise<void> => {
    if (detail?.id === id) { setDetail(null); return }
    const script = await scriptApi.get(id)
    setDetail({ id, script })
  }

  const applyAdvice = (advice: ScriptAdvice): Promise<void> => {
    if (advice.action === 'archive') return run(advice.scriptId, () => scriptApi.setStatus(advice.scriptId, 'archived'), t('archivedScript'))
    if (advice.action === 'set-scope-workspace') return run(advice.scriptId, () => scriptApi.setScope(advice.scriptId, 'workspace'), t('downgradedScript'))
    if (advice.targetId === null) return Promise.resolve()
    return run(advice.scriptId, () => scriptApi.setStatus(advice.scriptId, 'superseded', advice.targetId), t('mergedScript'))
  }

  const nameOf = (id: string | null): string =>
    id === null ? '' : data?.scripts.find(script => script.id === id)?.name ?? id

  /** 病据 → 一句人话（宿主只给数字，措辞在这里）。 */
  const evidenceText = (advice: ScriptAdvice): string => {
    const parts: string[] = []
    if (advice.kind === 'retire') {
      parts.push(`${t('adviceEvidenceInvocations')} ${String(advice.evidence.invocationCount)}`)
      if (advice.evidence.successRate !== null) parts.push(`${t('adviceEvidenceRate')} ${pct(advice.evidence.successRate)}`)
    }
    if (advice.kind === 'zombie' && advice.evidence.idleDays !== null) {
      parts.push(`${t('adviceEvidenceIdle')} ${String(advice.evidence.idleDays)} ${t('dayUnit')}`)
    }
    if (advice.kind === 'downgrade-scope') {
      parts.push(`${t('adviceEvidenceWorkspaces')} ${String(advice.evidence.workspaces)}`)
    }
    if (advice.kind === 'merge-duplicate') parts.push(`${t('mergeInto')} 「${nameOf(advice.targetId)}」`)
    return parts.join(' · ')
  }

  const kindLabel = (kind: ScriptAdvice['kind']): string => ({
    retire: t('adviceRetire'),
    zombie: t('adviceZombie'),
    'downgrade-scope': t('adviceDowngrade'),
    'merge-duplicate': t('adviceMerge'),
  })[kind]

  const actionLabel = (action: ScriptAdvice['action']): string => ({
    archive: t('actionArchive'),
    'set-scope-workspace': t('actionDowngrade'),
    merge: t('actionMerge'),
  })[action]

  const audit = data?.audit ?? null
  const scripts = data?.scripts ?? null

  return (
    <div className="dock-stack">
      {error !== null && <div className="dock-error">{error}</div>}
      {message !== null && <div className={failed ? 'dock-error' : 'dock-ok'} role="status">{message}</div>}

      {audit !== null && (
        <Card
          title={t('auditTitle')}
          actions={<span className="dock-hint">{audit.archived > 0 ? String(audit.archived) + ' ' + t('statusArchived') : ''}</span>}
        >
          <div data-testid="script-audit">
            <StatGrid>
              <Stat label={t('statTotal')} value={String(audit.stats.total)} />
              <Stat label={t('statActive')} value={String(audit.stats.byStatus.active)} />
              <Stat label={t('statAdvices')} value={String(audit.advices.length)} />
              <Stat label={t('statZombies')} value={String(audit.stats.zombies)} />
              <Stat label={t('statAcceptance')} value={pct(audit.stats.acceptance.ratio)} description={`${String(audit.stats.acceptance.withAcceptanceStep)}/${String(audit.stats.acceptance.total)}`} />
            </StatGrid>
            <div className="dock-row-meter" data-testid="script-rate-buckets">
              <span className="dock-hint">{t('rateBucketsLabel')}</span>
              {(['untested', 'low', 'mid', 'high'] as const).map(bucket => (
                <Pill key={bucket} data-testid={'script-bucket-' + bucket}>
                  {bucket === 'untested' ? t('bucketUntested') : bucket === 'low' ? t('bucketLow') : bucket === 'mid' ? t('bucketMid') : t('bucketHigh')}
                  {' '}{String(audit.stats.rateBuckets[bucket])}
                </Pill>
              ))}
            </div>
            <div className="dock-row-meter" data-testid="script-status-spread">
              <span className="dock-hint">{t('statusLabel')}</span>
              {(['active', 'candidate', 'archived', 'superseded'] as const).map(status => (
                <Pill key={status} tone={STATUS_TONE[status]} data-testid={'script-status-count-' + status}>
                  {t(STATUS_LABEL[status])}
                  {' '}{String(audit.stats.byStatus[status])}
                </Pill>
              ))}
            </div>
          </div>
        </Card>
      )}

      {audit !== null && (
        <Card title={t('adviceTitle')} actions={<span className="dock-hint">{t('adviceHint')}</span>}>
          {audit.advices.length === 0
            ? <div className="dock-empty"><div className="empty-txt">{t('adviceEmpty')}</div></div>
            : (
              <div className="dock-list" data-testid="script-advice-list">
                {audit.advices.map(advice => (
                  <div key={advice.id} className="dock-row" data-testid="script-advice" data-kind={advice.kind}>
                    <div className="grow">
                      <div className="ttl">{advice.name}</div>
                      <div className="meta">
                        <Pill tone={advice.kind === 'retire' || advice.kind === 'zombie' ? 'warn' : 'brand'}>
                          {kindLabel(advice.kind)}
                        </Pill>
                        {' '}{evidenceText(advice)}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busyId === advice.scriptId}
                      aria-busy={busyId === advice.scriptId}
                      aria-label={`${actionLabel(advice.action)}: ${advice.name}`}
                      data-testid="script-advice-action"
                      onClick={() => { void applyAdvice(advice) }}
                    >
                      {busyId === advice.scriptId ? t('busy') : actionLabel(advice.action)}
                    </Button>
                  </div>
                ))}
              </div>
            )}
        </Card>
      )}

      <Card
        title={t('scriptsTitle')}
        actions={scripts !== null ? <span className="dock-hint">{String(scripts.length)} {t('unitScripts')}</span> : null}
      >
        {scripts === null
          ? <div className="dock-empty loading"><div className="empty-txt">{t('loading')}</div></div>
          : scripts.length === 0
            ? <div className="dock-empty"><div className="empty-txt">{t('scriptsEmpty')}</div><div className="empty-hint">{t('scriptsEmptyHint')}</div></div>
            : (
              <div className="dock-list" data-testid="script-rows">
                {scripts.map((script) => (
                  <div key={script.id} className={'dock-row' + (script.status === 'active' ? '' : ' off')} data-testid="script-row" data-status={script.status}>
                    <div className="grow">
                      <div className="ttl">{script.name}</div>
                      <div className="meta">
                        <Pill tone={STATUS_TONE[script.status]} data-testid="script-row-status">
                          {t(STATUS_LABEL[script.status])}
                        </Pill>
                        {' '}
                        <Pill data-testid="script-row-scope">
                          {t(SCOPE_LABEL[script.scope])}
                        </Pill>
                        {' '}{String(script.stepCount)} {t('stepUnit')} · {String(script.invocationCount)} {t('adviceEvidenceInvocations')}
                        {script.supersededBy !== null ? ` · → ${nameOf(script.supersededBy)}` : ''}
                      </div>
                      {script.invocationCount > 0 && (
                        <div className="dock-row-meter">
                          {/* 成功率是宿主算好下发的（Spec INV-7）：这里只画，不除。 */}
                          <span
                            className={'dock-meter' + (script.successRate >= 0.9 ? ' tone-good' : script.successRate >= 0.6 ? ' tone-warn' : '')}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(script.successRate * 100)}
                            aria-label={`${t('successRate')} ${script.name}`}
                          >
                            <span className="dock-meter-fill" style={{ width: pct(script.successRate) }} />
                          </span>
                          <span className="dock-hint">{t('successRate')} {pct(script.successRate)}</span>
                        </div>
                      )}
                      {detail?.id === script.id && (
                        <ol className="dock-list" data-testid="script-steps">
                          {detail.script.steps.map((step, index) => (
                            <li key={String(index)} className="dock-hint">
                              {String(index + 1)}. [{step.kind}] {step.payload}
                              {step.note !== undefined ? ` (${step.note})` : ''}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${detail?.id === script.id ? t('hideDetail') : t('detail')}: ${script.name}`}
                      data-testid="script-row-detail"
                      onClick={() => { void toggleDetail(script.id) }}
                    >
                      {detail?.id === script.id ? t('hideDetail') : t('detail')}
                    </Button>
                    {script.status === 'active' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyId === script.id}
                        aria-label={`${t('actionArchive')}: ${script.name}`}
                        data-testid="script-row-archive"
                        onClick={() => { void run(script.id, () => scriptApi.setStatus(script.id, 'archived'), t('archivedScript')) }}
                      >
                        {t('actionArchive')}
                      </Button>
                    )}
                    {script.status === 'archived' && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busyId === script.id}
                          aria-label={`${t('actionRestore')}: ${script.name}`}
                          data-testid="script-row-restore"
                          onClick={() => { void run(script.id, () => scriptApi.setStatus(script.id, 'active'), t('restoredScript')) }}
                        >
                          {t('actionRestore')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyId === script.id}
                          title={t('purgeHint')}
                          aria-label={`${t('actionPurge')}: ${script.name}`}
                          data-testid="script-row-purge"
                          onClick={() => { void run(script.id, () => scriptApi.remove(script.id), t('purgedScript')) }}
                        >
                          {t('actionPurge')}
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
      </Card>
    </div>
  )
}
