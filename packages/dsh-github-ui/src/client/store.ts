/**
 * Github settings page store: joins the credential state (credentials.describe),
 * the connector config (github/config.get Remote), and the connection test
 * (github/whoami Remote). The host stays the single fact source.
 *
 * 凭据门面与加载骨架来自 `dsh-spark-plugin-kit/client`（评审 F13：两家连接器
 * 设置页曾各抄一份逐字相同的实现）。
 */
import {
  CredentialToken, PageLoader, messageOf, remoteFailureOf, unwrapRemote,
  type ClientContext, type CredentialView,
} from 'dsh-spark-plugin-kit/client'
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
      // 加载路径失败一律抛错，由 PageLoader 转成 status:'error' + 重试（F12 约定 2）。
      return { credential, config: unwrapRemote(configResult) }
    })
  }

  /** Run the connection test; returns the failure text, or undefined on success. */
  async testConnection(draftToken?: string): Promise<string | undefined> {
    try {
      const result = await this.github.whoami(
        draftToken === undefined ? {} : { draftToken },
      )
      // 操作路径失败返回文案，就地显示（F12 约定 3）。
      const failure = remoteFailureOf(result)
      if (failure !== undefined) return failure
      this.store.update((s) => { s.whoami = result.ok ? result.value : undefined })
      return undefined
    } catch (error) {
      return messageOf(error)
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
      // 返回值是 GithubProxyTestValue（自带 ok 的**领域结论**，约定 5）：
      // 传输成功但探测失败仍是这一形状，与信封失败区分开。
      const failure = remoteFailureOf(result)
      if (failure !== undefined) return { ok: false, latencyMs: 0, host: 'github.com', error: failure }
      return result.ok ? result.value : { ok: false, latencyMs: 0, host: 'github.com', error: 'unknown' }
    } catch (error) {
      return { ok: false, latencyMs: 0, host: 'github.com', error: messageOf(error) }
    }
  }

  /** Merge a config patch through the github/config.set Remote method. */
  async saveConfig(patch: Record<string, unknown>): Promise<string | undefined> {
    try {
      const result = await this.github['config.set']({ patch })
      const failure = remoteFailureOf(result)
      if (failure !== undefined) return failure
      if (result.ok) this.store.update((s) => { s.config = result.value })
      return undefined
    } catch (error) {
      return messageOf(error)
    }
  }
}
