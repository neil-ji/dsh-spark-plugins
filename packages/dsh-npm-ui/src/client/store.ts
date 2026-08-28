/**
 * npm release page store: joins the credential state (credentials.describe),
 * the npm Remote namespace (status.get, token.status, token.test) into one
 * page snapshot. Token
 * writes go through the standard credentials API (set/unset) — the value is
 * stored host-side in the credential seam, never in the plugin UI. The draft
 * token used for the connection test travels over the Remote one way and is
 * never persisted by the connector.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { CredentialView, IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type {
  NpmStatusView, NpmTokenStatusView, NpmTokenTestView,
} from 'dsh-connector-npm-wire'

/** The mounted npm Remote namespace (created by ctx.remote.$mount). */
type NpmNamespace = TypertRemoteNamespaceMap['npm']

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

/** Human text for a rejected wire/remote call. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Page controller (one per settings surface). */
export class NpmUiStore {
  readonly store: SnapshotStore<NpmUiState> = createSnapshotStore<NpmUiState>({
    status: 'idle', error: null, statusView: undefined,
    credential: undefined, token: undefined, test: undefined,
  })

  private generation = 0

  constructor(
    private readonly api: Pick<IApiClient, 'credentials'>,
    private readonly npm: NpmNamespace,
  ) {}

  /** Refetch only after the page has loaded once. */
  refreshIfLoaded(): void {
    if (this.store.getSnapshot().status === 'idle') return
    void this.load()
  }

  /** Load the registry + kit package status panel and the credential state. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const [result, credentialResponse] = await Promise.all([
        this.npm['status.get'](),
        this.api.credentials.describe({ refs: [NPM_TOKEN_REF] }),
      ])
      if (!result.ok) throw new Error(result.error.message)
      const credentialResult = credentialResponse.result
      if (!credentialResult.ok) throw new Error(credentialResult.error.message)
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.statusView = result.value
        s.credential = credentialResult.value.credentials[NPM_TOKEN_REF]
      })
      let token: NpmTokenStatusView | undefined
      try {
        const tokenResult = await this.npm['token.status']()
        if (tokenResult.ok) token = tokenResult.value
      } catch {
        token = undefined
      }
      if (generation === this.generation) this.store.update((s) => { s.token = token })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
    }
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
      return messageOf(error)
    }
  }

  /** Persist the token value into the credential seam (write-only). */
  async saveToken(value: string): Promise<string | undefined> {
    try {
      const response = await this.api.credentials.set({ ref: NPM_TOKEN_REF, value })
      if (!response.result.ok) return response.result.error.message
      await this.load()
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }

  /** Remove the stored token. */
  async removeToken(): Promise<string | undefined> {
    try {
      const response = await this.api.credentials.unset({ ref: NPM_TOKEN_REF })
      if (!response.result.ok) return response.result.error.message
      await this.load()
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }
}