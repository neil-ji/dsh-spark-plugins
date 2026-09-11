/**
 * dsh-npm-ui client half: registers the npm dictionaries, mounts the npm Remote
 * namespace and contributes its dock module.
 *
 * ADR-003（2026-09-11）：功能 UI 不再由 dock 静态 import 本包的 embed 产物，
 * 而是本入口自己装配好注入面后注册进 dock 声明的 `spark.dock.module` 子槽。
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
// Type-only: pulls ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ctx.remote (api-remotes re-declares it for consumers).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { NPM_REMOTE_CONTRIBUTION } from 'dsh-connector-npm-wire'
import { en, zh, type NpmKey } from './locales.ts'
import { startNpmDockModule, type NpmDockInject } from './NpmDockModule.tsx'

export type { NpmSectionInjected, NpmSectionProps } from './NpmSection.tsx'
export type {
  NpmStatusView, NpmTokenStatusView, NpmTokenTestView,
} from 'dsh-connector-npm-wire'
export type { NpmDockInject } from './NpmDockModule.tsx'
export type { NpmKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.npm': NpmKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.npm'

/**
 * Required client services. ADR-003 之后插件要自带原先由 dock 代持的服务：
 *  - `slots`：把模块注册进 dock 声明的 `spark.dock.module` 子槽（缺了宿主会以
 *    `cannot get property "slots" without inject` 让整条 loader entry 失败）；
 *  - `remote.credentials`：npm store 直接读写 `NPM_TOKEN_REF` 凭据（缺了面板会
 *    渲染成「注册表加载失败: cannot get property "remote.credentials" without inject」）。
 */
export const inject = ['locale', 'remote', 'remote.credentials', 'slots']

/**
 * Mount the npm Remote namespace, register dictionaries, contribute the dock module.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  // 0.1.2 locale.register 按语言逐条注册。
  ctx.effect(() => {
    const offZh = ctx.locale.register(NS, 'zh', zh)
    const offEn = ctx.locale.register(NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'npm-ui: copy')

  // Keep the npm Remote namespace mounted in the shell, then contribute the module.
  await ctx.remote.$mount(NPM_REMOTE_CONTRIBUTION)
  const injected: NpmDockInject = await startNpmDockModule(ctx)
  if ('failed' in injected) console.warn('[dsh-connector-npm-ui] dock 模块以失败态注册（remote.npm 不可用）')
}
