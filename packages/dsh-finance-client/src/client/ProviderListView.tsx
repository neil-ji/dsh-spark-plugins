/**
 * Provider 配置 —— dsh Provider 快照 + 本地业务字段覆盖层。
 *
 * 数据模型分两层，互不写穿：
 *   1. **dsh 层（只读）**：provider id、来源标签、host 元数据（计费模式 /
 *      货币 / 是否支持余额查询）。来自 host 的 `finance.listProviders`，
 *      而 host 又从 dsh-llm runtime registry 读取。**我们永远不写回**。
 *   2. **业务层（可编辑）**：价格、是否自动获取余额、有效期。存在浏览器
 *      localStorage 里（见 persist.ts 的 DshProviderOverride），由用户
 *      自行维护，不进 host settings，也不会影响 dsh 真实 Provider 配置。
 *
 * dsh 增删 Provider 时列表自动同步；用户的业务字段按 provider id 保留。
 * 每行提供「编辑」按钮，点开后就地变成表单（保存 / 取消）。
 */

import { useState } from 'react'
import { Button, Input } from 'dsh-ui-kit'
import type { FinanceDshProviderRow } from './FinanceCardController.ts'
import type { DshProviderOverride } from './persist.ts'
import type { FinanceKey } from './locales.ts'
import css from './FinanceCard.module.css'

export interface ProviderListViewProps {
  /** 合并后的行：dsh 快照 + 本地覆盖层。undefined = 首次拉取尚未返回。 */
  rows: readonly FinanceDshProviderRow[] | undefined
  /**
   * First-fetch error from `finance.listProviders`. Surfaces as an inline
   * retry inside the section so a transient host blip doesn't strand the
   * card on a permanent loading slot.
   */
  loadError: string | undefined
  /** Host 文档只读时禁用所有编辑入口。 */
  disabled: boolean
  t: (key: FinanceKey) => string
  /** 保存一行的业务字段（写 localStorage，不碰 dsh）。 */
  onSave: (provider: string, override: DshProviderOverride) => void
  /** 清除一行的业务字段，回落到 dsh 默认。 */
  onClear: (provider: string) => void
  /** Retry `listProviders` after a loadError. */
  onRetry: () => void
}

/** 空覆盖层的安全默认：价格 0、不自动取余额、无有效期。 */
function defaultOverride(row: FinanceDshProviderRow): DshProviderOverride {
  return {
    totalPriceMicros: row.override?.totalPriceMicros ?? 0,
    autoFetchBalance: row.override?.autoFetchBalance ?? false,
    ...row.override?.validityStartMs !== undefined ? { validityStartMs: row.override.validityStartMs } : {},
    ...row.override?.validityEndMs !== undefined ? { validityEndMs: row.override.validityEndMs } : {},
  }
}

export function ProviderListView({ rows, loadError, disabled, t, onSave, onClear, onRetry }: ProviderListViewProps): JSX.Element {
  // Error wins over the loading slot: a previous-good snapshot may still be
  // visible while a retry is in flight, but a fresh failure must not sit on
  // "正在加载…" forever.
  if (loadError !== undefined && rows === undefined) {
    return (
      <div className={css.providerList} data-testid="finance-provider-list-error">
        <p className={css.providerLocked}>{t('cardProvidersLoadError')}</p>
        <p className={css.providerLocked} title={loadError}>{loadError}</p>
        <Button variant="outline" disabled={disabled} onClick={onRetry}>{t('retry')}</Button>
      </div>
    )
  }
  if (rows === undefined) {
    return (
      <div className={css.providerList} data-testid="finance-provider-list-empty">
        <p className={css.providerLocked}>{t('cardProvidersLoading')}</p>
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className={css.providerList} data-testid="finance-provider-list-empty">
        <p className={css.providerLocked}>{t('cardProvidersNone')}</p>
      </div>
    )
  }
  return (
    <div className={css.providerList} data-testid="finance-provider-list">
      {loadError !== undefined
        ? <p className={css.providerLocked}>{t('cardProvidersRefreshError')}</p>
        : null}
      {rows.map((row) => (
        <ProviderRowView
          key={row.provider}
          row={row}
          disabled={disabled}
          t={t}
          onSave={onSave}
          onClear={onClear}
        />
      ))}
    </div>
  )
}

interface ProviderRowViewProps {
  row: FinanceDshProviderRow
  disabled: boolean
  t: (key: FinanceKey) => string
  onSave: (provider: string, override: DshProviderOverride) => void
  onClear: (provider: string) => void
}

/** epoch ms -> `YYYY-MM-DD`（date input 需要的格式）；空值返回空串。 */
function toDateInput(ms: number | undefined): string {
  if (ms === undefined) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` -> epoch ms；空串或非法值返回 undefined。 */
function fromDateInput(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const ms = Date.parse(`${trimmed}T00:00:00Z`)
  return Number.isNaN(ms) ? undefined : ms
}

function ProviderRowView({ row, disabled, t, onSave, onClear }: ProviderRowViewProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const seed = defaultOverride(row)
  // 草稿只在编辑态存在；取消即丢弃，保存后由 controller 重新投影。
  const [priceText, setPriceText] = useState(String(seed.totalPriceMicros / 1_000_000))
  const [autoFetch, setAutoFetch] = useState(seed.autoFetchBalance)
  const [startText, setStartText] = useState(toDateInput(seed.validityStartMs))
  const [endText, setEndText] = useState(toDateInput(seed.validityEndMs))

  const meta = row.hostMeta
  const billingMode = meta?.defaultBillingMode
  const currency = meta?.defaultCurrency ?? 'CNY'
  const currencySymbol = currency === 'USD' ? '$' : '¥'
  const hasAutoFetch = meta?.supportsBalanceFetch === true
  const major = row.override?.totalPriceMicros !== undefined
    ? row.override.totalPriceMicros / 1_000_000
    : null
  // The host schema caps `totalPriceMicros` at 100,000 (in major units);
  // pre-validate here so the user gets an inline error instead of a
  // silent "Save failed" banner after the host rejects the write.
  const MAX_PRICE_MAJOR = 100_000
  const priceOverCap = (() => {
    if (!editing) return false
    const trimmed = priceText.trim()
    if (trimmed === '') return false
    if (!/^\d*\.?\d*$/.test(trimmed)) return false
    const value = Number(trimmed)
    return Number.isFinite(value) && value > MAX_PRICE_MAJOR
  })()
  const priceInvalid = editing && (!/^\d*\.?\d*$/.test(priceText.trim()) || priceOverCap)

  const beginEdit = (): void => {
    const fresh = defaultOverride(row)
    setPriceText(String(fresh.totalPriceMicros / 1_000_000))
    setAutoFetch(fresh.autoFetchBalance)
    setStartText(toDateInput(fresh.validityStartMs))
    setEndText(toDateInput(fresh.validityEndMs))
    setEditing(true)
  }

  const commit = (): void => {
    if (priceInvalid) return
    const major = Number(priceText.trim() === '' ? '0' : priceText.trim())
    if (!Number.isFinite(major) || major < 0) return
    const start = fromDateInput(startText)
    const end = fromDateInput(endText)
    onSave(row.provider, {
      totalPriceMicros: Math.round(major * 1_000_000),
      autoFetchBalance: autoFetch,
      ...start !== undefined ? { validityStartMs: start } : {},
      ...end !== undefined ? { validityEndMs: end } : {},
    })
    setEditing(false)
    // Cross-controller signal: the dashboard is mounted independently and
    // would otherwise wait for its next load() (auto-refresh, manual 刷新)
    // to pick up the new autoFetch flag. Emitting a window event lets it
    // pull a fresh `listProviders` immediately when the user just enabled
    // auto-fetch on a previously unsupported provider.
    window.dispatchEvent(new CustomEvent('dsh-finance-dsh-override-changed', {
      detail: { provider: row.provider, kind: 'save' },
    }))
  }

  return (
    <article
      className={css.providerCard}
      data-provider={row.provider}
      aria-label={`${t('cardProviderId')}: ${row.provider}`}
    >
      <div className={css.providerCardHead}>
        <span className={css.providerName}>
          {row.name}
          {meta !== undefined ? <span className={css.providerHostTag}>· {t('cardProviderHostKnown')}</span> : null}
          {billingMode === 'free' ? <span className={css.providerHostTag}>· {t('cardProviderFreeBadge')}</span> : null}
          {row.override !== undefined ? <span className={css.providerHostTag}>· {t('overridden')}</span> : null}
        </span>
        {editing ? null : (
          <span className={css.providerValidity}>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={beginEdit}
              data-testid={`finance-provider-edit-${row.provider}`}
            >
              {t('cardProviderEdit')}
            </Button>
            {row.override !== undefined ? (
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  onClear(row.provider)
                  // Mirror the commit() side: dashboard refreshes so the
                  // gauge/balance updates after a reset.
                  window.dispatchEvent(new CustomEvent('dsh-finance-dsh-override-changed', {
                    detail: { provider: row.provider, kind: 'clear' },
                  }))
                }}
                data-testid={`finance-provider-reset-${row.provider}`}
              >
                {t('reset')}
              </Button>
            ) : null}
          </span>
        )}
      </div>

      {/* Host-owned meta line: shows fields the user CANNOT edit
          (billing mode + currency). Lives directly under the head so the
          read-only body below only carries fields the 编辑 button can
          actually change — fixing the field-set mismatch where the body
          promised 计费方式/货币 were editable but the edit form had no input
          for them. */}
      {editing ? null : (
        <div className={css.providerMeta} data-testid={`finance-provider-meta-${row.provider}`}>
          <span className={css.providerMetaItem}>
            <span className={css.providerLabel}>{t('cardProviderBillingMode')}</span>
            <span className={css.providerLocked}>
              {billingMode === 'metered'
                ? t('modeMetered')
                : billingMode === 'plan'
                  ? t('modePlan')
                  : billingMode === 'free'
                    ? t('modeFree')
                    : '—'}
            </span>
          </span>
          <span className={css.providerMetaItem}>
            <span className={css.providerLabel}>{t('cardProviderCurrency')}</span>
            <span className={css.providerLocked}>{meta?.defaultCurrency ?? '—'}</span>
          </span>
        </div>
      )}

      {editing ? (
        <div className={css.providerGrid} data-testid={`finance-provider-form-${row.provider}`}>
          <div className={css.providerField}>
            <span className={css.providerLabel}>{t('cardProviderTotalPrice')}</span>
            <div className={css.providerPriceWrap}>
              <span className={css.providerCurrencyPrefix}>{currencySymbol}</span>
              <Input
                className={css.providerPriceInput}
                type="text"
                value={priceText}
                // When autoFetch is on, the host fills the price on each
                // refresh — disable the input so the user knows the value
                // is auto-managed. The CSS line-through reinforces it.
                disabled={disabled || autoFetch}
                onChange={(event) => setPriceText(event.currentTarget.value)}
              />
            </div>
            {priceInvalid
              ? <span className={css.providerLabel}>{priceOverCap ? t('cardProviderPriceOverCap') : t('invalidNumber')}</span>
              : null}
          </div>
          {hasAutoFetch ? (
            <div className={css.providerField}>
              <span className={css.providerLabel}>{t('cardProviderAutoFetch')}</span>
              <label className={css.providerAutoFetch}>
                <input
                  type="checkbox"
                  checked={autoFetch}
                  disabled={disabled}
                  aria-label={t('cardProviderAutoFetch')}
                  onChange={(event) => setAutoFetch(event.currentTarget.checked)}
                />
                <span>{autoFetch ? t('cardProviderAutoFetchOn') : t('cardProviderAutoFetchOff')}</span>
              </label>
            </div>
          ) : null}
          <div className={css.providerField}>
            <span className={css.providerLabel}>{t('cardProviderValidityStart')}</span>
            <Input
              className={css.providerDateInput}
              type="date"
              value={startText}
              disabled={disabled}
              onChange={(event) => setStartText(event.currentTarget.value)}
            />
          </div>
          <div className={css.providerField}>
            <span className={css.providerLabel}>{t('cardProviderValidityEnd')}</span>
            <Input
              className={css.providerDateInput}
              type="date"
              value={endText}
              disabled={disabled}
              onChange={(event) => setEndText(event.currentTarget.value)}
            />
          </div>
          <div className={css.providerField}>
            <span className={css.providerValidity}>
              <Button
                variant="primary"
                disabled={disabled || priceInvalid}
                onClick={commit}
                data-testid={`finance-provider-save-${row.provider}`}
              >
                {t('save')}
              </Button>
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => setEditing(false)}
                data-testid={`finance-provider-cancel-${row.provider}`}
              >
                {t('discard')}
              </Button>
            </span>
          </div>
        </div>
      ) : (
        <div className={css.providerGrid}>
          <div className={css.providerField}>
            <span className={css.providerLabel}>{t('cardProviderTotalPrice')}</span>
            <span className={css.providerLocked}>
              {major === null ? '—' : `${currencySymbol}${major.toFixed(2)}`}
            </span>
          </div>
          {hasAutoFetch ? (
            <div className={css.providerField}>
              <span className={css.providerLabel}>{t('cardProviderAutoFetch')}</span>
              <span className={css.providerLocked}>
                {row.override?.autoFetchBalance === true ? t('cardProviderAutoFetchOn') : t('cardProviderAutoFetchOff')}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </article>
  )
}
