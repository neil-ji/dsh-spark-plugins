/**
 * npm-connector capability service: registry queries (no credentials needed)
 * and npm CLI command building for OIDC trusted publishing. Publishing itself
 * is delegated to the generated GitHub Actions workflow (OIDC), so the agent
 * never holds an npm credential.
 *
 * Extends TypertRemoteService so the Web UI (dsh-npm-ui) can query package /
 * trust status and generate the first-release human script through the Typert
 * Gateway. All @Remote methods are read-only or produce plain-text scripts —
 * no write side effects on npm or GitHub.
 */
import { type Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  NpmLaunchScriptView, NpmPackageInfoView, NpmStatusView, NpmTrustStatusView,
} from 'dsh-connector-npm-wire'
import { NPM_KIT_PACKAGES } from 'dsh-connector-npm-wire'

/** 连接器可配置项（设置命名空间 npm 的用户层）。 */
export interface NpmConnectorConfig {
  /** npm registry 根地址（status/package 查询目标）。 */
  registry?: string
}

/** Registry metadata projection for one package name. */
export interface NpmPackageInfo {
  /** false when the registry answers 404 (name is available). */
  exists: boolean
  name: string
  latest?: string
  description?: string
  distTags?: Record<string, string>
  versions?: string[]
}

/** First-release human script (npm publish + npm trust, browser 2FA). */
export function firstReleaseScript(args: {
  pkg: string
  repository: string
  dir?: string
  workflowFile?: string
}): string {
  const dir = args.dir ?? args.pkg
  const workflowFile = args.workflowFile ?? 'release.yml'
  return [
    '# 首次发布 + OIDC trust(浏览器 2FA,每条确认一次)',
    'cd ' + JSON.stringify(dir),
    'npm publish',
    'npm trust github ' + args.pkg + ' --file ' + workflowFile + ' --repository ' + args.repository + ' --allow-publish -y',
  ].join('\n')
}

export class NpmService extends TypertRemoteService {
  /**
   * @param configSource - 读取当前连接器配置的 thunk；registry 默认值在此解析，
   *   设置命名空间热更新后立即生效。
   */
  constructor(
    _ctx: Context,
    private readonly configSource: () => NpmConnectorConfig = () => ({}),
  ) {
    super(_ctx, 'npm')
  }

  /** 当前生效的 registry 根地址。 */
  get registry(): string {
    return this.configSource().registry ?? 'https://registry.npmjs.org'
  }

  /** Check availability + current metadata of a package name (public read). */
  async checkPackage(name: string): Promise<NpmPackageInfo> {
    let response: Response
    try {
      response = await fetch(this.registry + '/' + encodeURIComponent(name))
    } catch (error) {
      throw new Error('npm: registry query for ' + name + ' failed: ' + String(error))
    }
    if (response.status === 404) return { exists: false, name }
    if (!response.ok) {
      throw new Error('npm: registry responded ' + response.status + ' for ' + name)
    }
    const meta = await response.json() as {
      name?: string
      description?: string
      'dist-tags'?: Record<string, string>
      versions?: Record<string, unknown>
    }
    return {
      exists: true,
      name: meta.name ?? name,
      ...(meta.description === undefined ? {} : { description: meta.description }),
      ...(meta['dist-tags'] === undefined ? {} : { distTags: meta['dist-tags'] }),
      ...(meta.versions === undefined ? {} : { versions: Object.keys(meta.versions) }),
      ...(meta['dist-tags']?.latest === undefined ? {} : { latest: meta['dist-tags'].latest }),
    }
  }

  /**
   * The npm trust github command for one package. npm >= 11.10 performs the
   * OIDC trusted-publisher setup; with a 2FA "writes" account it prompts for an
   * OTP that an agent cannot supply, so the command is surfaced to the human.
   */
  trustCommand(pkg: string, workflowFile: string, repository: string, allowPublish = true): string {
    const flags = [
      '--file ' + workflowFile,
      '--repository ' + repository,
      ...(allowPublish ? ['--allow-publish'] : []),
      '-y',
    ]
    return 'npm trust github ' + pkg + ' ' + flags.join(' ')
  }

  /** Registry connectivity probe + all four kit packages' publish status. */
  @Remote('status.get')
  async statusRemote(): Promise<NpmStatusView> {
    const packages: NpmPackageInfoView[] = []
    let error: string | null = null
    for (const name of NPM_KIT_PACKAGES) {
      try {
        const info = await this.checkPackage(name)
        packages.push({
          name: info.name,
          exists: info.exists,
          latest: info.latest ?? null,
          description: info.description ?? null,
        })
      } catch (err) {
        error = error === null ? String(err) : error
        packages.push({ name, exists: false, latest: null, description: null })
      }
    }
    return { ok: error === null, registry: this.registry, error, packages }
  }

  /** Single package availability + metadata (used by the launch wizard). */
  @Remote('package.check')
  async packageCheckRemote(request: { name: string }): Promise<NpmPackageInfoView> {
    const info = await this.checkPackage(request.name)
    return {
      name: info.name,
      exists: info.exists,
      latest: info.latest ?? null,
      description: info.description ?? null,
    }
  }

  /**
   * Trust status for one package. Trust state is account-private (not exposed
   * by the public registry), so when it cannot be verified we return the exact
   * npmjs.com URL to check.
   */
  @Remote('trust.status')
  async trustStatusRemote(request: { pkg: string }): Promise<NpmTrustStatusView> {
    const info = await this.checkPackage(request.pkg)
    const checkUrl = 'https://www.npmjs.com/package/' + request.pkg + '?tab=settings'
    return {
      pkg: request.pkg,
      exists: info.exists,
      verified: false,
      checkUrl,
      detail: info.exists
        ? 'trusted-publisher state is account-private; verify at ' + checkUrl
        : 'package is not published yet — publish it (first-release script) before configuring trust',
    }
  }

  /** Generate the first-release human script (plain text, no side effects). */
  @Remote('launch.script')
  launchScriptRemote(request: {
    pkg: string
    repository: string
    dir?: string
    workflowFile?: string
  }): NpmLaunchScriptView {
    return { status: 'generated', script: firstReleaseScript(request) }
  }
}

/** Draft result of running npm trust github (capability check). */
export interface TrustDraft {
  ok: boolean
  needsOtp: boolean
  detail: string
}
