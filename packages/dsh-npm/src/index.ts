/**
 * dsh-connector-npm bundle entry: mounts the npm capability service (with
 * Typert Remote methods for the Web UI), registers the strict host-side
 * Remote contract, and registers the model-facing tools. GitHub steps reuse
 * the dsh-connector-github plugin via ctx.github (loaded as a separate bundle).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GitHubService } from 'dsh-connector-github'
import { NPM_HOST_CONTRIBUTION } from 'dsh-connector-npm-wire'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { NpmService } from './npm-service.ts'
import { registerNpmTools } from './tools.ts'

export { NpmService, firstReleaseScript, type NpmPackageInfo } from './npm-service.ts'
export { renderScaffold, writeScaffold, type ScaffoldOptions } from './scaffold.ts'
export { launchPackage, type LaunchRequest, type LaunchResult } from './launch.ts'

export const name = 'dsh-connector-npm'
export const inject = ['shell', 'tools', 'typert']

/**
 * @param ctx - host context; ctx.github is provided by dsh-connector-github.
 */
export function apply(ctx: Context, config: Record<string, never> = {}): void {
  // Strict host-side Remote definitions: gateway resolves npm/status.get etc.
  ctx.typert.register(NPM_HOST_CONTRIBUTION)
  const npm = new NpmService(ctx)
  registerNpmTools(ctx, npm, () => ctx.get('github') as GitHubService | undefined)
}
