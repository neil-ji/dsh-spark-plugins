/**
 * DeepSeek first-party balance endpoint client. Host-only, runs with the
 * server-side credential and never returns the key.
 *
 * @module @deepseek-ai/dsh-finance/balance
 */

import type { FinanceBalanceView, FinanceConfig } from './types.ts'

interface DeepSeekBalanceResponse {
  is_available?: boolean
  balance_infos?: Array<{
    currency?: string
    total_balance?: string
    granted_balance?: string
    topped_up_balance?: string
  }>
}

/** Machine-readable balance failure. */
export class FinanceBalanceError extends Error {
  readonly code: string

  /**
   * @param code - stable lower-kebab code for UI handling.
   * @param message - correction-oriented text without the API key.
   */
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'FinanceBalanceError'
    this.code = code
  }
}

/** Parse a non-negative decimal amount into integer micros (1e-6 units). */
export function microsFromDecimal(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return undefined
  const [whole, fraction = ''] = value.trim().split('.')
  const padded = (fraction + '000000').slice(0, 6)
  const micros = Number(whole) * 1_000_000 + Number(padded)
  return Number.isSafeInteger(micros) && micros >= 0 ? micros : undefined
}

/** Fetch and normalize the balance endpoint. */
export async function fetchFinanceBalance(
  config: FinanceConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<FinanceBalanceView> {
  const timeoutMs = Math.max(1, config.balance.timeoutMs)
  const controller = new AbortController()
  const onAbort = (): void => { controller.abort() }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)

  try {
    const url = new URL('/user/balance', config.balance.baseURL)
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    })

    if (response.status === 401 || response.status === 403) {
      throw new FinanceBalanceError('auth', 'DeepSeek balance API rejected the configured credential')
    }
    if (response.status === 429) {
      throw new FinanceBalanceError('rate-limit', 'DeepSeek balance API rate limit exceeded')
    }
    if (!response.ok) {
      throw new FinanceBalanceError('http', `DeepSeek balance API returned HTTP ${String(response.status)}`)
    }

    const body = await response.json() as DeepSeekBalanceResponse
    const info = (body.balance_infos ?? []).find(entry => entry.currency === config.currency)
      ?? body.balance_infos?.[0]
    if (info === undefined) {
      throw new FinanceBalanceError('invalid-response', 'DeepSeek balance API returned no balance_infos')
    }

    const total = microsFromDecimal(info.total_balance)
    const granted = microsFromDecimal(info.granted_balance)
    const toppedUp = microsFromDecimal(info.topped_up_balance)
    if (total === undefined) {
      throw new FinanceBalanceError('invalid-response', 'DeepSeek balance API returned an invalid total_balance')
    }

    return {
      status: 'ok',
      updatedAt: Date.now(),
      isAvailable: body.is_available !== false,
      currency: info.currency ?? config.currency,
      totalMicros: total,
      ...granted === undefined ? {} : { grantedMicros: granted },
      ...toppedUp === undefined ? {} : { toppedUpMicros: toppedUp },
    }
  } catch (error) {
    if (error instanceof FinanceBalanceError) throw error
    if (signal?.aborted === true || controller.signal.aborted) {
      throw new FinanceBalanceError('timeout', 'DeepSeek balance API request timed out')
    }
    throw new FinanceBalanceError('network', 'DeepSeek balance API request failed', { cause: error })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}