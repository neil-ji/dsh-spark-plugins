/**
 * npm-connector capability service: registry queries, granular access token
 * resolution (via the credentials seam — the token value is never rendered
 * back), and npm CLI command building for OIDC trusted publishing.
 *
 * Two publish paths:
 *  - granular token configured (bypass 2FA + read/write): the agent publishes
 *    the first release, configures the trusted publisher and tags the next
 *    version — fully automatic.
 *  - no token: publishing is delegated to the generated GitHub Actions
 *    workflow (OIDC) after a one-time human first publish.
 *
 * Extends TypertRemoteService so the Web UI (dsh-npm-ui) can query package /
 * trust status and generate the first-release human script through the Typert
 * Gateway. All @Remote methods are read-only or produce plain-text scripts —
 * no write side effects on npm or GitHub.
 */
import { type Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  NpmLaunchScriptView, NpmPackageInfoView, NpmStatusView, NpmTokenStatusView,
  NpmTrustStatusView,
} from 'dsh-connector-npm-wire'
import { NPM_KIT_PACKAGES } from 'dsh-connector-npm-wire'

/** 连接器可配置项（设置命名空间 npm 的用户层）。 */
export interface NpmConnectorConfig {
  /** npm registry 根地址（status/package 查询目标）。 */
  registry?: string
  /** npm 凭据引用名（granular access token 存在凭据缝里，配置只存引用名）。 */
  tokenEnv?: string
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
  static inject = ['credentials']

  constructor(
    ctx: Context,
    private readonly configSource: () => NpmConnectorConfig = () => ({}),
  ) {
    super(ctx, 'npm')
  }

  /**
   * 解析凭据引用指向的 npm granular access token（不回显）。
   * 未配置或凭据缝没有该引用时返回 undefined。
   */
  async resolveToken(): Promise<string | undefined> {
    const ref = credentialRef(this.configSource().tokenEnv ?? 'NPM_TOKEN')
    return (await this.ctx.get('credentials')?.resolve(ref))?.value
  }

  /** 用 token 查询 whoami，返回登录名；token 无效返回 null。 */
  async whoami(token: string): Promise<string | null> {
    let response: Response
    try {
      response = await fetch(this.registry + '/-/whoami', {
        headers: { Authorization: 'Bearer ' + token },
      })
    } catch {
      return null
    }
    if (!response.ok) return null
    const meta = await response.json().catch(() => undefined) as { username?: string } | undefined
    return meta?.username ?? null
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
   * OIDC trusted-publisher setup. With a granular access token (bypass 2FA)
   * configured the command runs non-interactively; with a 2FA "writes"
   * account it prompts for an OTP, so it is surfaced to the human instead.
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

  /**
   * Granular access token status (never the token value). Resolves the
   * credential ref and probes whoami so the UI can show whether the
   * full-auto publish path is live.
   */
  @Remote('token.status')
  async tokenStatusRemote(): Promise<NpmTokenStatusView> {
    const source = this.configSource().tokenEnv ?? 'NPM_TOKEN'
    const token = await this.resolveToken()
    if (token === undefined || token === '') {
      return {
        configured: false, source, login: null,
        detail: '未配置 npm granular token：首发走人工脚本（浏览器 2FA）。到 npmjs.com → Access Tokens 生成 granular token（All packages + Read and write + bypass 2FA），以凭据引用 ' + source + ' 存入凭据缝后即可全自动。',
      }
    }
    const login = await this.whoami(token)
    return {
      configured: true, source, login,
      detail: login !== null
        ? 'granular token 就绪：npm_launch 将自动完成首发 + trust + tag'
        : 'token 已配置但 whoami 未通过（过期 / 权限不足 / IP 受限），请重新生成',
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
