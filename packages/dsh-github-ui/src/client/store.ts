/**
 * Github settings page store: joins the credential state (credentials.describe),
 * the connector config (github/config.get Remote), and the connection test
 * (github/whoami Remote). The host stays the single fact source.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { GithubConfigView, GithubProxyTestValue, GithubWhoamiValue } from 'dsh-connector-wire'

/** The mounted github Remote namespace (created by ctx.remote.$mount). */
type GithubNamespace = TypertRemoteNamespaceMap['github']

/** Credential-seam facts for one reference (0.1.2 远端 wire 视图，不含值本身）。 */
export interface CredentialView {
  configured: boolean
  source?: string
  writable: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    credentials: {
      describe(refs: readonly string[]): Promise<RemoteResult<Record<string, CredentialView>>>
      set(ref: string, value: string): Promise<RemoteResult<unknown>>
      unset(ref: string): Promise<RemoteResult<unknown>>
    }
  }
}

/** Conventional credential reference for the GitHub token. */
export const GITHUB_TOKEN_REF = 'GITHUB_TOKEN'

/** Page snapshot. */
export interface GithubSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  credential: CredentialView | undefined
  config: GithubConfigView | undefined
  whoami: GithubWhoamiValue | undefined
}

/** Human text for a rejected wire/remote call. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Page controller (one per settings surface). */
export class GithubSettingsStore {
  readonly store: SnapshotStore<GithubSettingsState> = createSnapshotStore<GithubSettingsState>({
    status: 'idle', error: null, credential: undefined, config: undefined, whoami: undefined,
  })

  private generation = 0

  constructor(
    private readonly ctx: Context,
    private readonly github: GithubNamespace,
  ) {}

  /** Refetch only after the page has loaded once. */
  refreshIfLoaded(): void {
    if (this.store.getSnapshot().status === 'idle') return
    void this.load()
  }

  /** Refresh credential state and connector config. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const [credentialResult, configResult] = await Promise.all([
        this.ctx.remote.credentials.describe([GITHUB_TOKEN_REF]),
        this.github['config.get'](),
      ])
      if (!credentialResult.ok) throw new Error(credentialResult.error.message)
      if (!configResult.ok) throw new Error(configResult.error.message)
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.credential = credentialResult.value[GITHUB_TOKEN_REF]
        s.config = configResult.value
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
    }
  }

  /** Run the connection test; returns the failure text, or undefined on success. */
  async testConnection(draftToken?: string): Promise<string | undefined> {
    try {
      const result = await this.github.whoami(
        draftToken === undefined ? {} : { draftToken },
      )
      if (!result.ok) return result.error.message
      this.store.update((s) => { s.whoami = result.value })
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }

  /** Persist the token value into the credential seam (write-only). */
  async saveToken(value: string): Promise<string | undefined> {
    try {
      const response = await this.ctx.remote.credentials.set(GITHUB_TOKEN_REF, value)
      if (!response.ok) return response.error.message
      await this.load()
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }

  /** Remove the stored token. */
  async removeToken(): Promise<string | undefined> {
    try {
      const response = await this.ctx.remote.credentials.unset(GITHUB_TOKEN_REF)
      if (!response.ok) return response.error.message
      await this.load()
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }

  /**
   * Probe the git proxy (draft wins over the saved value) through the
   * github/proxy.test Remote method. Always resolves to a value.
   */
  async testProxy(draft?: string): Promise<GithubProxyTestValue> {
    try {
      const result = await this.github['proxy.test'](draft === undefined ? {} : { proxy: draft })
      if (!result.ok) return { ok: false, latencyMs: 0, host: 'github.com', error: result.error.message }
      return result.value
    } catch (error) {
      return { ok: false, latencyMs: 0, host: 'github.com', error: messageOf(error) }
    }
  }

  /** Merge a config patch through the github/config.set Remote method. */
  async saveConfig(patch: Record<string, unknown>): Promise<string | undefined> {
    try {
      const result = await this.github['config.set']({ patch })
      if (!result.ok) return result.error.message
      this.store.update((s) => { s.config = result.value })
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }
}
