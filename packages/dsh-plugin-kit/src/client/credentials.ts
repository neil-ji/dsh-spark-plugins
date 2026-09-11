/**
 * 凭据 seam（`credentials` Remote）的共享门面 —— 连接器设置页的公共层。
 *
 * 为什么在 kit：`dsh-connector-github-ui` 与 `dsh-connector-npm-ui` 各自手抄了一份
 * **完全逐字相同**的 `CredentialView`、`TypertRemoteNamespaceMap['credentials']`
 * 声明合并、`set/unset` 包装与错误文案提取（评审 F13）。类型声明合并抄两份尤其危险
 * ——两边漂移时 TypeScript 会静默取交集，运行时才炸。
 *
 * 产品契约不变：token 值只走 credential seam（写-only），插件 UI 从不持有明文。
 */
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { ClientContext } from './context.ts'

/** Credential-seam facts for one reference（0.1.2 远端 wire 视图，不含值本身）。 */
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

/** The credential Remote face as the two connector pages consume it. */
export interface CredentialsSeam {
  describe(refs: readonly string[]): Promise<RemoteResult<Record<string, CredentialView>>>
  set(ref: string, value: string): Promise<RemoteResult<unknown>>
  unset(ref: string): Promise<RemoteResult<unknown>>
}

/** Human text for a rejected wire/remote call. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 一个凭据 ref 的读写门面（连接器设置页共用）。
 *
 * 失败语义刻意分两档，与两家页面的既有行为一致：
 *  - `read()` 失败**抛错** —— 由页面加载骨架统一转成 `status: 'error'`；
 *  - `save()` / `remove()` 失败**返回文案** —— 表单直接把这句话显示在操作行上。
 */
export class CredentialToken {
  constructor(
    private readonly ctx: ClientContext,
    /** Credential reference（如 `GITHUB_TOKEN` / `NPM_TOKEN`）。 */
    readonly ref: string,
  ) {}

  /** kit 的 `remote` 面只声明了 `$mount/$on/$stream`；子服务按需取。 */
  private get seam(): CredentialsSeam {
    return (this.ctx.remote as unknown as { credentials: CredentialsSeam }).credentials
  }

  /** 读凭据状态；失败抛错（调用方的加载骨架负责转错误态）。 */
  async read(): Promise<CredentialView | undefined> {
    const result = await this.seam.describe([this.ref])
    if (!result.ok) throw new Error(result.error.message)
    return result.value[this.ref]
  }

  /** 写入凭据值（写-only）。返回失败文案，`undefined` 表示成功。 */
  async save(value: string): Promise<string | undefined> {
    try {
      const response = await this.seam.set(this.ref, value)
      return response.ok ? undefined : response.error.message
    } catch (error) {
      return messageOf(error)
    }
  }

  /** 删除已存凭据。返回失败文案，`undefined` 表示成功。 */
  async remove(): Promise<string | undefined> {
    try {
      const response = await this.seam.unset(this.ref)
      return response.ok ? undefined : response.error.message
    } catch (error) {
      return messageOf(error)
    }
  }
}
