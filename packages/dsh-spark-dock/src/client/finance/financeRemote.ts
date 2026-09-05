/**
 * Holder for the host `remote.finance` namespace, captured once in apply()
 * (same access pattern as dsh-finance-client: ctx.reflect.get('remote.finance')).
 * Undefined when the finance bundle is not loaded — the pane renders a hint.
 */
export interface FinanceBalanceView {
  status: 'ok' | 'missing-credential' | 'unsupported' | 'error'
  provider: string
  totalMicros?: number
  currency?: string
  message?: string
}

export interface FinanceProviderEntry {
  provider: string
  balance: FinanceBalanceView
}

interface FinanceRemoteShape {
  listProviders?: (input?: Record<string, never>) => Promise<{ ok: boolean; value?: { providers?: FinanceProviderEntry[] }; error?: { message: string } }>
  refreshBalance?: (input: { provider: string }) => Promise<unknown>
}

let getRemote: (() => unknown) | undefined

/** Install a lazy accessor — remote.finance mounts asynchronously (finance-client
 *  $mount), so it must be read at pane load time, not at apply time. */
export function setFinanceRemoteGetter(get: () => unknown): void {
  getRemote = get
}

export function getFinanceRemote(): FinanceRemoteShape | undefined {
  if (getRemote === undefined) return undefined
  try {
    return getRemote() as FinanceRemoteShape | undefined
  } catch {
    return undefined
  }
}
