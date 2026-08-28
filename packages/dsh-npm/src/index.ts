/**
 * dsh-connector-npm bundle entry: mounts the npm capability service (with
 * Typert Remote methods for the Web UI), registers the strict host-side
 * Remote contract, and registers the model-facing tools. GitHub steps reuse
 * the dsh-connector-github plugin via ctx.github (loaded as a separate bundle).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GitHubService } from 'dsh-connector-github'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { NPM_HOST_CONTRIBUTION } from 'dsh-connector-npm-wire'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { NpmService } from './npm-service.ts'
import type { NpmConnectorConfig } from './npm-service.ts'
import { registerNpmTools } from './tools.ts'

export { NpmService, NpmOtpError, NpmNeedsTokenError, firstReleaseScript, type NpmPackageInfo, type NpmConnectorConfig, type NpmTrustProvider } from './npm-service.ts'
export { renderScaffold, writeScaffold, type ScaffoldOptions } from './scaffold.ts'
export { launchPackage, type LaunchRequest, type LaunchResult } from './launch.ts'
export { publishPackage, type PublishRequest, type PublishResult } from './publish.ts'

export const name = 'dsh-connector-npm'
export const inject = ['credentials', 'shell', 'tools', 'typert']

/** 本插件拥有的设置命名空间（设置 → 插件 → 插件配置页可编辑）。 */
export const NPM_SETTINGS_NAMESPACE = settingsNamespace('npm')

/** 连接器配置 schema：registry 根地址 + npm 凭据引用（granular token）。 */
const NpmConfigSchema = Schema.object({
  registry: Schema.string().default('https://registry.npmjs.org'),
  tokenEnv: Schema.string().role('credential-ref').default('NPM_TOKEN'),
  kitPackages: Schema.array(String),
})

/**
 * @param ctx - host context; ctx.github is provided by dsh-connector-github.
 */
export function apply(ctx: Context, config: Record<string, never> = {}): void {
  // Strict host-side Remote definitions: gateway resolves npm/status.get etc.
  ctx.typert.register(NPM_HOST_CONTRIBUTION)

  // 注册 npm 设置命名空间：registry / kitPackages 可在插件配置页编辑，热更新即时生效。
  // 注意：configSource 必须经过「读外层变量」的间接层传入——setSource 会重新绑定
  // 外层变量，若按值传入初始 thunk，后续配置修改永远不会被 NpmService 看到。
  const entry: NpmConnectorConfig = {}
  let configSource: () => NpmConnectorConfig = () => entry
  installSettingsSection(ctx, NPM_SETTINGS_NAMESPACE, NpmConfigSchema, entry, {
    setSource: source => { configSource = source },
    onChange: () => {},
  })

  const npm = new NpmService(ctx, () => configSource())
  registerNpmTools(ctx, npm, () => ctx.get('github') as GitHubService | undefined)
}