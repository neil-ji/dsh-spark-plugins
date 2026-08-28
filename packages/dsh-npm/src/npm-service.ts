/**
 * npm-connector capability service: registry queries, granular access token
 * resolution (via the credentials seam — the token value is never rendered
 * back), and token-driven npm platform management.
 *
 * With a granular access token (NPM_TOKEN: All packages + Read and write +
 * bypass 2FA) the agent manages the whole npm-facing lifecycle directly:
 * publish, dist-tags, deprecate/undeprecate, and OIDC trusted-publisher
 * config — no local npm CLI, no browser 2FA. Registry write API calls that
 * npm's platform guards with 2FA (trust create/revoke) may demand a
 * one-time password: the service surfaces NpmOtpError, the caller asks the
 * user for the OTP once and retries with the npm-otp header.
 *
 * Without a token, publishing is delegated to the generated GitHub Actions
 * workflow (OIDC) after a one-time human first publish.
 *
 * Extends TypertRemoteService so the Web UI (dsh-npm-ui) can test the token
 * and read the connection status through the Typert Gateway. All other
 * queries run model-tool side (npm_package_check / npm_trust_status ...) by
 * calling the service methods directly. All @Remote methods are read-only
 * (token.test uses a transient draft token, never persisted).
 */
import { type Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  NpmPackageInfoView, NpmStatusView, NpmTokenStatusView,
  NpmTokenTestView, NpmTrustEntryView, NpmTrustStatusView,
} from 'dsh-connector-npm-wire'
import { NPM_KIT_PACKAGES } from 'dsh-connector-npm-wire'
import semver from 'semver'

/** 连接器可配置项（设置命名空间 npm 的用户层）。 */
export interface NpmConnectorConfig {
  /** npm registry 根地址（status/package 查询目标）。 */
  registry?: string
  /** npm 凭据引用名（granular access token 存在凭据缝里，配置只存引用名）。 */
  tokenEnv?: string
  /** 状态面板展示的套件包列表（覆盖默认 NPM_KIT_PACKAGES；空/未配置 = 默认）。 */
  kitPackages?: string[]
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

/** OIDC trusted-publisher provider identities this connector can configure. */
export type NpmTrustProvider = 'github' | 'gitlab' | 'circleci'

/** Thrown when the registry demands a one-time password (2FA write). */
export class NpmOtpError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'NpmOtpError'
  }
}

/** Thrown when no npm token is configured but the operation needs one. */
export class NpmNeedsTokenError extends Error {
  constructor(detail = 'npm: NPM_TOKEN is not configured — set a granular access token first') {
    super(detail)
    this.name = 'NpmNeedsTokenError'
  }
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

/** Internal shape of one trust entry as the registry returns it. */
interface TrustEntryRaw {
  id?: string
  type?: string
  claims?: Record<string, unknown>
  permissions?: string[]
}

function isOtpResponse(status: number, text: string): boolean {
  return status === 401 && /one-time pass|one time pass|otp|two-factor|two factor|2fa/i.test(text)
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

  /** Require a resolved token or throw NpmNeedsTokenError (draft wins). */
  async token(draftToken?: string): Promise<string> {
    if (draftToken !== undefined && draftToken !== '') return draftToken
    const stored = await this.resolveToken()
    if (stored === undefined || stored === '') throw new NpmNeedsTokenError()
    return stored
  }

  /** 用 token 查询 whoami，返回登录名；token 无效返回 null。 */
  async whoami(token: string): Promise<string | null> {
    let response: Response
    try {
      response = await fetch(new URL('/-/whoami', this.registry).toString(), {
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

  /** 状态面板的套件包列表：配置覆盖默认，过滤空条目；未配置时用 wire 默认。 */
  kitPackages(): string[] {
    const configured = this.configSource().kitPackages
    if (configured !== undefined && configured.length > 0) {
      return configured.filter((name) => name !== undefined && name.trim() !== '')
    }
    return [...NPM_KIT_PACKAGES]
  }

  /** Check availability + current metadata of a package name (public read). */
  async checkPackage(name: string): Promise<NpmPackageInfo> {
    let response: Response
    try {
      response = await fetch(new URL('/' + encodeURIComponent(name), this.registry).toString())
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
   * The npm trust github command for one package (legacy human path).
   * With a configured granular token the agent configures trust directly
   * through the registry REST API instead (createTrust).
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

  // ── registry REST plumbing ────────────────────────────────────────────────

  /** One registry API call with the connector token; otp adds the npm-otp header. */
  private async registryFetch(
    path: string,
    opts: { token?: string | undefined; method?: string | undefined; body?: unknown; query?: Record<string, string> | undefined; otp?: string | undefined } = {},
  ): Promise<{ status: number; text: string; json: unknown }> {
    const url = new URL(path, this.registry)
    if (opts.query !== undefined) {
      for (const [key, value] of Object.entries(opts.query)) url.searchParams.set(key, value)
    }
    const headers: Record<string, string> = {}
    if (opts.token !== undefined && opts.token !== '') headers.Authorization = 'Bearer ' + opts.token
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.otp !== undefined && opts.otp !== '') headers['npm-otp'] = opts.otp
    let response: Response
    try {
      response = await fetch(url.toString(), {
        method: opts.method ?? 'GET',
        headers,
        ...(opts.body === undefined ? {} : { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }),
      })
    } catch (error) {
      throw new Error('npm: registry request failed: ' + String(error))
    }
    const text = await response.text().catch(() => '')
    let json: unknown
    try { json = text === '' ? undefined : JSON.parse(text) } catch { json = undefined }
    if (isOtpResponse(response.status, text)) {
      const message = (json as { error?: string } | undefined)?.error ?? text.slice(0, 200)
      throw new NpmOtpError('npm: 2FA one-time password required: ' + message)
    }
    return { status: response.status, text, json }
  }

  /** Encode a package name for registry URL segments. */
  private static enc(pkg: string): string {
    return encodeURIComponent(pkg)
  }

  // ── dist-tags (token-driven) ──────────────────────────────────────────────

  /** GET the current dist-tags of one package. */
  async listDistTags(pkg: string, token: string): Promise<Record<string, string>> {
    const { status, json } = await this.registryFetch('/-/package/' + NpmService.enc(pkg) + '/dist-tags', { token })
    if (status !== 200) throw new Error('npm: dist-tag list responded ' + status)
    return (json as Record<string, string>) ?? {}
  }

  /** PUT one dist-tag (body is the JSON-encoded version, like npm CLI). */
  async setDistTag(pkg: string, tag: string, version: string, token: string, otp?: string): Promise<void> {
    const { status, text } = await this.registryFetch('/-/package/' + NpmService.enc(pkg) + '/dist-tags/' + encodeURIComponent(tag), {
      token, method: 'PUT', body: JSON.stringify(version), otp,
    })
    if (status !== 200 && status !== 201) {
      throw new Error('npm: dist-tag set responded ' + status + ': ' + text.slice(0, 200))
    }
  }

  /** DELETE one dist-tag. */
  async removeDistTag(pkg: string, tag: string, token: string, otp?: string): Promise<void> {
    const { status, text } = await this.registryFetch('/-/package/' + NpmService.enc(pkg) + '/dist-tags/' + encodeURIComponent(tag), {
      token, method: 'DELETE', otp,
    })
    if (status !== 200 && status !== 204 && status !== 201) {
      throw new Error('npm: dist-tag remove responded ' + status + ': ' + text.slice(0, 200))
    }
  }

  // ── deprecate / undeprecate (token-driven) ─────────────────────────────────

  /**
   * Deprecate (or undeprecate, with an empty message) a version range of one
   * package, replicating npm CLI's CouchDB-style document update: GET the
   * packument with ?write=true (includes _rev) under the token, set
   * versions[*].deprecated, PUT the whole doc back.
   * @returns the affected versions.
   */
  async deprecate(pkg: string, opts: {
    token: string
    message?: string | undefined
    versionRange?: string | undefined
    otp?: string | undefined
  }): Promise<{ versions: string[]; message: string }> {
    const range = opts.versionRange ?? '*'
    const message = opts.message ?? ''
    const { status, json } = await this.registryFetch('/' + NpmService.enc(pkg), {
      token: opts.token, query: { write: 'true' },
    })
    if (status !== 200 || json === undefined || typeof json !== 'object') {
      throw new Error('npm: packument read responded ' + status + ' for ' + pkg)
    }
    const packument = json as {
      versions?: Record<string, { deprecated?: string } | undefined>
    }
    if (packument.versions === undefined) throw new Error('npm: packument for ' + pkg + ' has no versions')
    // semver is bundled into the host plugin; range matching mirrors npm CLI
    const target = Object.keys(packument.versions).filter((v) =>
      semver.satisfies(v, range, { includePrerelease: true }))
    if (target.length === 0) return { versions: [], message }
    for (const version of target) {
      const record = packument.versions[version]
      if (record !== undefined) record.deprecated = message
    }
    const { status: putStatus, text } = await this.registryFetch('/' + NpmService.enc(pkg), {
      token: opts.token,
      method: 'PUT',
      body: packument,
      otp: opts.otp,
    })
    if (putStatus !== 200 && putStatus !== 201 && putStatus !== 204) {
      throw new Error('npm: deprecate PUT responded ' + putStatus + ': ' + text.slice(0, 200))
    }
    return { versions: target, message }
  }

  // ── OIDC trusted publishers (token-driven) ─────────────────────────────────

  /** Build the trust endpoint body entry for one provider (mirrors npm CLI). */
  buildTrustConfig(provider: NpmTrustProvider, params: {
    repository?: string | undefined
    file?: string | undefined
    environment?: string | undefined
    project?: string | undefined
    orgId?: string | undefined
    projectId?: string | undefined
    pipelineDefinitionId?: string | undefined
    vcsOrigin?: string | undefined
    contextIds?: string[] | undefined
    allowPublish?: boolean | undefined
    allowStagePublish?: boolean | undefined
  }): { type: NpmTrustProvider; claims: Record<string, unknown>; permissions: string[] } {
    const permissions: string[] = []
    if (params.allowPublish ?? true) permissions.push('createPackage')
    if (params.allowStagePublish === true) permissions.push('createStagedPackage')
    if (permissions.length === 0) throw new Error('npm: at least one permission (allowPublish / allowStagePublish) is required')
    let claims: Record<string, unknown>
    if (provider === 'github') {
      if (params.repository === undefined) throw new Error('npm: repository (owner/repo) is required for github trust')
      const file = params.file ?? 'release.yml'
      claims = {
        repository: params.repository,
        workflow_ref: { file },
        ...(params.environment === undefined ? {} : { environment: params.environment }),
      }
    } else if (provider === 'gitlab') {
      if (params.project === undefined) throw new Error('npm: project (group/project) is required for gitlab trust')
      const file = params.file ?? '.gitlab-ci.yml'
      claims = {
        project_path: params.project,
        ci_config_ref_uri: { file },
        ...(params.environment === undefined ? {} : { environment: params.environment }),
      }
    } else {
      if (params.orgId === undefined || params.projectId === undefined ||
          params.pipelineDefinitionId === undefined || params.vcsOrigin === undefined) {
        throw new Error('npm: orgId, projectId, pipelineDefinitionId and vcsOrigin are required for circleci trust')
      }
      claims = {
        'oidc.circleci.com/org-id': params.orgId,
        'oidc.circleci.com/project-id': params.projectId,
        'oidc.circleci.com/pipeline-definition-id': params.pipelineDefinitionId,
        'oidc.circleci.com/vcs-origin': params.vcsOrigin,
        ...(params.contextIds !== undefined && params.contextIds.length > 0
          ? { 'oidc.circleci.com/context-ids': params.contextIds }
          : {}),
      }
    }
    return { type: provider, claims, permissions }
  }

  /** GET the trusted-publisher entries for one package (token needed). */
  async listTrusts(pkg: string, token: string): Promise<NpmTrustEntryView[]> {
    const { status, json, text } = await this.registryFetch('/-/package/' + NpmService.enc(pkg) + '/trust', { token })
    if (status !== 200) {
      throw new Error('npm: trust list responded ' + status + ': ' + text.slice(0, 200))
    }
    const raw = Array.isArray(json) ? json as TrustEntryRaw[] : []
    return raw.map((entry) => ({
      id: entry.id ?? '',
      type: entry.type ?? '',
      claims: entry.claims ?? {},
      permissions: entry.permissions ?? [],
    }))
  }

  /** POST one trusted-publisher config; OTP may be demanded (2FA guard). */
  async createTrust(pkg: string, token: string, config: {
    type: NpmTrustProvider
    claims: Record<string, unknown>
    permissions: string[]
  }, otp?: string): Promise<{ id: string | null }> {
    const { status, json, text } = await this.registryFetch('/-/package/' + NpmService.enc(pkg) + '/trust', {
      token, method: 'POST', body: [config], otp,
    })
    if (status !== 200 && status !== 201) {
      throw new Error('npm: trust create responded ' + status + ': ' + text.slice(0, 300))
    }
    const id = (Array.isArray(json) ? (json[0] as TrustEntryRaw | undefined)?.id : (json as TrustEntryRaw | undefined)?.id) ?? null
    return { id }
  }

  /** DELETE one trusted-publisher config by id; OTP may be demanded. */
  async revokeTrust(pkg: string, id: string, token: string, otp?: string): Promise<void> {
    const { status, text } = await this.registryFetch('/-/package/' + NpmService.enc(pkg) + '/trust/' + encodeURIComponent(id), {
      token, method: 'DELETE', otp,
    })
    if (status !== 200 && status !== 204 && status !== 201) {
      throw new Error('npm: trust revoke responded ' + status + ': ' + text.slice(0, 200))
    }
  }

  // ── Remote methods (read-only) ─────────────────────────────────────────────

  /** Registry connectivity probe + all four kit packages' publish status. */
  @Remote('status.get')
  async statusRemote(): Promise<NpmStatusView> {
    const packages: NpmPackageInfoView[] = []
    let error: string | null = null
    for (const name of this.kitPackages()) {
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

  /**
   * Trust status for one package (model-tool facing, not a Remote): when a
   * token is configured the connector reads the trust list directly
   * (token-driven); otherwise the exact npmjs.com URL is returned.
   */
  async trustStatusRemote(request: { pkg: string }): Promise<NpmTrustStatusView> {
    const info = await this.checkPackage(request.pkg)
    const checkUrl = 'https://www.npmjs.com/package/' + request.pkg + '?tab=settings'
    if (!info.exists) {
      return {
        pkg: request.pkg, exists: false, verified: false, trusts: [], checkUrl,
        detail: 'package is not published yet — publish it (npm_publish / npm_launch) before configuring trust',
      }
    }
    const token = await this.resolveToken().catch(() => undefined)
    if (token === undefined || token === '') {
      return {
        pkg: request.pkg, exists: true, verified: false, trusts: [], checkUrl,
        detail: '未配置 npm token：无法读取 trust 配置。先在插件页填入并保存 granular token（trust 端点需要账号鉴权）。',
      }
    }
    try {
      const trusts = await this.listTrusts(request.pkg, token)
      return {
        pkg: request.pkg, exists: true, verified: true, trusts, checkUrl,
        detail: trusts.length === 0
          ? '未配置 trusted publisher'
          : trusts.length + ' 个 trusted publisher 配置',
      }
    } catch (error) {
      return {
        pkg: request.pkg, exists: true, verified: false, trusts: [], checkUrl,
        detail: '无法读取 trust 配置：' + String(error).slice(0, 200),
      }
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
        detail: '未配置 npm granular token：到 npmjs.com → Access Tokens 生成 granular token（All packages + Read and write + bypass 2FA），然后在插件页填入、测试连接并保存，即可让 agent 全权管理 npm 平台侧。',
      }
    }
    const login = await this.whoami(token)
    return {
      configured: true, source, login,
      detail: login !== null
        ? 'granular token 就绪：npm_publish / npm_dist_tag / npm_deprecate / npm_trust 全自动可用'
        : 'token 已配置但 whoami 未通过（过期 / 权限不足 / IP 受限），请重新生成',
    }
  }

  /**
   * Connection test: an optional draft token wins over the stored one.
   * Never persists; the value crosses the wire one way only.
   */
  @Remote('token.test')
  async tokenTestRemote(request: { draftToken?: string }): Promise<NpmTokenTestView> {
    let token: string | undefined
    try {
      token = await this.token(request.draftToken)
    } catch {
      return { ok: false, login: null, detail: '未配置 npm token——请先输入 granular token 测试连接' }
    }
    const login = await this.whoami(token)
    if (login === null) {
      return { ok: false, login: null, detail: 'whoami 未通过：token 无效 / 已过期 / 权限不足或 IP 受限' }
    }
    return { ok: true, login, detail: '连接成功，可保存 token 后交给 agent 全权管理' }
  }
}