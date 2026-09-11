/**
 * npm release page store: joins the credential state (credentials.describe),
 * the npm Remote namespace (status.get, token.status, token.test) into one
 * page snapshot. Token writes go through the standard credentials API
 * (set/unset) — the value is stored host-side in the credential seam, never in
 * the plugin UI. The draft token used for the connection test travels over the
 * Remote one way and is never persisted by the connector.
 *
 * 凭据门面与加载骨架来自 `dsh-spark-plugin-kit/client`（评审 F13：两家连接器
 * 设置页曾各抄一份逐字相同的实现）。
 */
import { CredentialToken, PageLoader, type ClientContext, type CredentialView } from 'dsh-spark-plugin-kit/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type {
  NpmStatusView, NpmTokenStatusView, NpmTokenTestView,
} from 'dsh-connector-npm-wire'

/** The mounted npm Remote namespace (created by ctx.remote.$mount). */
export type NpmNamespace = TypertRemoteNamespaceMap['npm']

export type { CredentialView } from 'dsh-spark-plugin-kit/client'

/** Conventional credential reference for the npm granular token. */
export const NPM_TOKEN_REF = 'NPM_TOKEN'

/** Page snapshot. */
export interface NpmUiState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  statusView: NpmStatusView | undefined
  /** Credential-seam facts for NPM_TOKEN (config/source/writable). */
  credential: CredentialView | undefined
  /** Granular access token status (credential ref). */
  token: NpmTokenStatusView | undefined
  /** Last connection-test result (draft token or stored token). */
  test: NpmTokenTestView | undefined
}

/** Page controller (one per settings surface). */
export class NpmUiStore {
  readonly store: SnapshotStore<NpmUiState> = createSnapshotStore<NpmUiState>({
    status: 'idle', error: null, statusView: undefined,
    credential: undefined, token: undefined, test: undefined,
  })

  private readonly loader: PageLoader<NpmUiState>
  private readonly token: CredentialToken

  constructor(
    ctx: ClientContext,
    private readonly npm: NpmNamespace,
  ) {
    this.loader = new PageLoader<NpmUiState>(this.store)
    this.token = new CredentialToken(ctx, NPM_TOKEN_REF)
  }

  /** Refetch only after the page has loaded once. */
  refreshIfLoaded(): void {
    this.loader.refreshIfLoaded(() => this.load())
  }

  /** Load the registry + kit package status panel and the credential state. */
  async load(): Promise<void> {
    await this.loader.run(async () => {
      const [result, credential] = await Promise.all([
        this.npm['status.get'](),
        this.token.read(),
      ])
      if (!result.ok) throw new Error(result.error.message)
      // token.status 是次要信息：失败时保持 undefined，不把整页拖进错误态。
      let token: NpmTokenStatusView | undefined
      try {
        const tokenResult = await this.npm['token.status']()
        if (tokenResult.ok) token = tokenResult.value
      } catch {
        token = undefined
      }
      return { statusView: result.value, credential, token }
    })
  }

  /**
   * Run the connection test; an optional draft token wins over the stored
   * one. Returns the failure text, or undefined on success.
   */
  async testConnection(draftToken?: string): Promise<string | undefined> {
    try {
      const result = await this.npm['token.test'](draftToken === undefined ? {} : { draftToken })
      if (!result.ok) return result.error.message
      this.store.update((s) => { s.test = result.value })
      return result.value.ok ? undefined : (result.value.detail ?? 'connection test failed')
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  /** Persist the token value into the credential seam (write-only). */
  async saveToken(value: string): Promise<string | undefined> {
    const failure = await this.token.save(value)
    if (failure !== undefined) return failure
    await this.load()
    return undefined
  }

  /** Remove the stored token. */
  async removeToken(): Promise<string | undefined> {
    const failure = await this.token.remove()
    if (failure !== undefined) return failure
    await this.load()
    return undefined
  }
}
