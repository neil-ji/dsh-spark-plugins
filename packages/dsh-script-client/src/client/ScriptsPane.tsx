/**
 * 脚本目录 pane（从 dock 的 SparkModule 迁出，Spec §7）。
 *
 * 只读目录 + 「调用」一个动作（治理动作在 F3 的审计面里加）。变更经
 * `script/events` 流实时刷新：`ready` 基线帧也要重取（世代之间的窗口不回放）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card } from 'dsh-ui-kit'
import { useFrames, type StreamRemote } from 'dsh-spark-plugin-kit/client'
import type { ScriptStreamFrame, ScriptView } from 'dsh-script-wire'
import { scriptApi } from './api.ts'
import { useApiResource } from './useApiResource.ts'
import type { ScriptTranslate } from './ScriptDockModule.tsx'

export interface ScriptsPaneProps {
  t: ScriptTranslate
  remote: ScriptRemote | null
}

/** `ctx.remote.script.events()` 的最小面（wire 的 namespace map 增强提供类型）。 */
export interface ScriptRemote extends StreamRemote {
  script: { events: (signal?: AbortSignal) => AsyncIterable<ScriptStreamFrame> }
}

export function ScriptsPane({ t, remote }: ScriptsPaneProps): JSX.Element {
  const { data: scripts, error, reload } = useApiResource<ScriptView[]>(() => scriptApi.list(), [])
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const messageTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(messageTimer.current), [])

  // 宿主变更 → 重取。基线帧（新世代）同样要重取一次。
  const onFrame = useCallback(() => { reload() }, [reload])
  useFrames<ScriptStreamFrame>({
    remote,
    name: 'script/events',
    open: (signal) => remote!.script.events(signal),
    onFrame,
    onReady: onFrame,
  })

  const invoke = async (script: ScriptView) => {
    if (busyId !== null) return
    setBusyId(script.id)
    try {
      await scriptApi.invoke(script.id)
      setFailed(false)
      setMessage(`${t('invokedScript')} "${script.name}"`)
    } catch (e) {
      setFailed(true)
      setMessage(`${t('invokeFailed')}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusyId(null)
      reload()
      window.clearTimeout(messageTimer.current)
      messageTimer.current = window.setTimeout(() => setMessage(null), 4000)
    }
  }

  return (
    <div className="dock-stack">
      {error !== null && <div className="dock-error">{error}</div>}
      {message !== null && <div className={failed ? 'dock-error' : 'dock-ok'} role="status">{message}</div>}
      <Card
        title={t('scriptsTitle')}
        actions={scripts !== null ? <span className="dock-hint">{String(scripts.length)} {t('unitScripts')}</span> : null}
      >
        {scripts === null
          ? <div className="dock-empty loading"><div className="empty-txt">{t('loading')}</div></div>
          : scripts.length === 0
            ? <div className="dock-empty"><div className="empty-txt">{t('scriptsEmpty')}</div><div className="empty-hint">{t('scriptsEmptyHint')}</div></div>
            : (
              <div className="dock-list">
                {scripts.map((script) => {
                  // 成功率口径由宿主计算（Spec INV-7）：UI 只显示，不重算业务结论。
                  const rate = script.invocationCount > 0 ? script.successCount / script.invocationCount : null
                  return (
                    <div key={script.id} className="dock-row">
                      <div className="grow">
                        <div className="ttl">{script.name}</div>
                        <div className="meta">
                          {String(script.steps.length)} {t('stepUnit')} · {t('invokeCountUnit')} {String(script.invocationCount)} {t('invokeCountSuffix')}
                        </div>
                        {rate !== null && (
                          <div className="dock-row-meter">
                            <span className={'dock-meter' + (rate >= 0.9 ? ' tone-good' : rate >= 0.6 ? ' tone-warn' : '')} aria-hidden="true">
                              <span className="dock-meter-fill" style={{ width: String(Math.round(rate * 100)) + '%' }} />
                            </span>
                            <span className="dock-hint">{t('successRate')} {String(Math.round(rate * 100))}%</span>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyId === script.id}
                        aria-busy={busyId === script.id}
                        onClick={() => { void invoke(script) }}
                      >
                        {busyId === script.id ? t('invoking') : t('invoke')}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
      </Card>
    </div>
  )
}
