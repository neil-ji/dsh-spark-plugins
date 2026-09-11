/**
 * Github settings page store: joins the credential state (credentials.describe),
 * the connector config (github/config.get Remote), and the connection test
 * (github/whoami Remote). The host stays the single fact source.
 *
 * 凭据门面与加载骨架来自 `dsh-spark-plugin-kit/client`（评审 F13：两家连接器
 * 设置页曾各抄一份逐字相同的实现）。
 */
import { CredentialToken, PageLoader, type ClientContext, type CredentialView } from 'dsh-spark-plugin-kit/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { GithubConfigView, GithubProxyTestValue, GithubWhoamiValue } from 'dsh-connector-wire'

/** The mounted github Remote namespace (created by ctx.remote.$mount). */
export type GithubNamespace = TypertRemoteNamespaceMap['github']

export type { CredentialView } from 'dsh-spark-plugin-kit/client'

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

/** Page controller (one per settings surface). */
export class GithubSettingsStore {
  readonly store: SnapshotStore<GithubSettingsState> = createSnapshotStore<GithubSettingsState>({
    status: 'idle', error: null, credential: undefined, config: undefined, whoami: undefined,
  })

  private readonly loader: PageLoader<GithubSettingsState>
  private readonly token: CredentialToken

  constructor(
    ctx: ClientContext,
    private readonly github: GithubNamespace,
  ) {
    this.loader = new PageLoader<GithubSettingsState>(this.store)
    this.token = new CredentialToken(ctx, GITHUB_TOKEN_REF)
  }

  /** Refetch only after the page has loaded once. */
  refreshIfLoaded(): void {
    this.loader.refreshIfLoaded(() => this.load())
  }

  /** Refresh credential state and connector config. */
  async load(): Promise<void> {
    await this.loader.run(async () => {
      const [credential, configResult] = await Promise.all([
        this.token.read(),
        this.github['config.get'](),
      ])
      if (!configResult.ok) throw new Error(configResult.error.message)
      return { credential, config: configResult.value }
    })
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
      return { ok: false, latencyMs: 0, host: 'github.com', error: error instanceof Error ? error.message : String(error) }
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
      return error instanceof Error ? error.message : String(error)
    }
  }
}
