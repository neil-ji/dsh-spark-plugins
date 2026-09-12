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
import {
  CredentialToken, PageLoader, messageOf, remoteFailureOf, unwrapRemote,
  type ClientContext, type CredentialView,
} from 'dsh-spark-plugin-kit/client'
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
  /**
   * 次要信息 `token.status` 的失败文案（F12）。
   *
   * 它是**次要数据**：拿不到时页面照常可用，但**不许静默**——以前失败被吞成
   * `token === undefined`，界面读起来像「未配置」，用户会照着提示去配一个其实
   * 已经配好的令牌。现在单独记在这里，页面显示降级提示。
   */
  tokenError: string | null
  /** Last connection-test result (draft token or stored token). */
  test: NpmTokenTestView | undefined
}

/** Page controller (one per settings surface). */
export class NpmUiStore {
  readonly store: SnapshotStore<NpmUiState> = createSnapshotStore<NpmUiState>({
    status: 'idle', error: null, statusView: undefined,
    credential: undefined, token: undefined, tokenError: null, test: undefined,
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
      // 主数据：失败抛错，由 PageLoader 统一转 status:'error' + 重试（F12 约定 2）。
      const statusView = unwrapRemote(result)
      // 次要数据 token.status：失败**不静默吞**（F12 约定 4）—— 记文案、不失能整页。
      let token: NpmTokenStatusView | undefined
      let tokenError: string | null = null
      try {
        const tokenResult = await this.npm['token.status']()
        const failure = remoteFailureOf(tokenResult)
        if (failure !== undefined) tokenError = failure
        else if (tokenResult.ok) token = tokenResult.value
      } catch (error) {
        tokenError = messageOf(error)
      }
      return { statusView, credential, token, tokenError }
    })
  }

  /**
   * Run the connection test; an optional draft token wins over the stored
   * one. Returns the failure text, or undefined on success.
   */
  async testConnection(draftToken?: string): Promise<string | undefined> {
    try {
      const result = await this.npm['token.test'](draftToken === undefined ? {} : { draftToken })
      // 传输失败：返回文案就地显示（F12 约定 3）。
      const failure = remoteFailureOf(result)
      if (failure !== undefined) return failure
      if (!result.ok) return 'connection test failed'
      this.store.update((s) => { s.test = result.value })
      // 传输成功但令牌无效：`value.ok` 是**领域结论**（F12 约定 5），与信封的 ok
      // 正交，必须显示成业务失败而不是「未配置」。
      return result.value.ok ? undefined : (result.value.detail ?? 'connection test failed')
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
}
