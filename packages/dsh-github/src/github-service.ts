/**
 * GitHubService: host-plane capability service. It extends TypertRemoteService
 * so the same Service owns both the business methods (REST + git) and the
 * @Remote methods the Web UI calls through the Typert Gateway (SRC fallback
 * dispatch — no generated strict host artifact required).
 */
import { type Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import {
  Config, GITHUB_SETTINGS_NAMESPACE, toConfigView,
  type GithubConfig, type GithubConfigView,
} from './config.ts'
import { GithubError, buildGithubQuery, decodeBase64Content, encodeGithubPath, fetchWhoami, githubRequest, githubRequestBuffer } from './github-rest.ts'
import { gitHostFromApiBase, gitProxyArgs, gitProxyProbeCommand, parseRemoteOwnerRepo, shellQuote } from './git-utils.ts'
import type {
  CloneRequest, CloneResult, CommentIssueRequest, CreateIssueRequest, CreateReleaseRequest,
  CreatePullRequest, CreateRepoRequest, CreateRepoResult, CreateReviewRequest,
  DownloadArtifactRequest, DownloadArtifactResult, EditRepoRequest, GetContentRequest,
  GetPullRequest, GetWorkflowRunRequest, GithubArtifact, GithubBranch, GithubBranchDetail,
  GithubCommit, GithubCommitDetail, GithubContent, GithubFileWriteResult, GithubIssue,
  GithubIssueComment, GithubJob, GithubPagesBuild, GithubPagesStatus, GithubPullComment,
  GithubPullFile, GithubPullRequest, GithubProxyTestValue, GithubReadme, GithubRelease, GithubRepo,
  GithubRepoDetail, GithubSecretName, GithubTag, GithubTreeEntry, GithubUser,
  GithubWhoamiValue, GithubWorkflow, GithubWorkflowRun, ListIssuesRequest, ListPullsRequest,
  ListRunArtifactsRequest, ListWorkflowRunsRequest, WriteFileRequest, WorkflowDispatchRequest,
} from './types.ts'
import { writeFile as fsWriteFile } from 'node:fs/promises'
import path from 'node:path'


/**
 * Inline git credential helper. Git executes the body after the exclamation
 * mark with sh and reads username/password lines from stdout. The token stays
 * literal in the command string (single-quoted there) and is expanded by git's
 * helper shell from the per-run environment, so it never enters argv or the
 * remote URL.
 */
const CREDENTIAL_HELPER = '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f'

/**
 * Structural shape of the sandbox execution policy (@deepseek-ai/dsh-sandbox
 * SandboxExecutionPolicy) as consumed by the shell executor. Kept local so
 * the connector needs no direct dependency on dsh-sandbox types.
 */
interface SessionShellPolicy {
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  workspaceRoot: string
}

/** The current resolved configuration source. */
type ConfigSource = () => GithubConfig

/** Reject a config section this service cannot act on (fail loud at write). */
function assertServiceableGithubConfig(config: GithubConfig): void {
  const apiBase = config.apiBase ?? 'https://api.github.com'
  if (!/^https:\/\//.test(apiBase)) {
    throw new Error(`github: apiBase must be an https URL, got ${JSON.stringify(apiBase)}`)
  }
  const proxy = config.gitProxy
  if (proxy !== undefined && proxy !== '' && !/^(https?|socks[45]h?):\/\//i.test(proxy)) {
    throw new Error(`github: gitProxy must be an http(s)/socks proxy URL, got ${JSON.stringify(proxy)}`)
  }
}


export class GitHubService extends TypertRemoteService {
  static inject = ['credentials', 'shell', 'sandboxPolicy']

  private source: ConfigSource

  constructor(ctx: Context, entry: GithubConfig) {
    super(ctx, 'github')
    this.source = () => entry
    // Register the settings namespace for local persistence + hot reload.
    // This is NOT the apiproxy settings.describe allowlist — the Web UI uses the
    // @Remote config methods below instead.
    installSettingsSection(ctx, GITHUB_SETTINGS_NAMESPACE, Config, entry, {
      setSource: (current) => { this.source = current },
      onChange: () => {},
      validate: assertServiceableGithubConfig,
    })
  }

  /** Currently authoritative resolved config. */
  get config(): GithubConfig {
    return this.source()
  }

  /** Resolve the token fresh on every operation (hot-reload). */
  async resolveToken(): Promise<string | undefined> {
    const ref = credentialRef(this.config.tokenEnv ?? 'GITHUB_TOKEN')
    return (await this.ctx.get('credentials')?.resolve(ref))?.value
  }

  /** Resolve the token or fail loud. A draft wins (connection test). */
  private async token(draft?: string): Promise<string> {
    if (draft !== undefined) return draft
    const hit = await this.resolveToken()
    if (hit === undefined) {
      throw new GithubError('MISSING_CREDENTIAL', 'github: GITHUB_TOKEN is not configured')
    }
    return hit
  }

  /** Assert one operation permission from the resolved config. */
  private assertAllowed(key: keyof GithubConfig): void {
    if (this.config[key] !== true) {
      throw new GithubError('OPERATION_FORBIDDEN', `github: ${key} is disabled`)
    }
  }

  /** The apiBase the service will use. */
  private get apiBase(): string {
    return this.config.apiBase ?? 'https://api.github.com'
  }

  // ── business: REST ────────────────────────────────────────────────────────

  /** Authenticated /user identity (also used by the @Remote connection test). */
  async whoami(draftToken?: string): Promise<GithubUser> {
    return fetchWhoami(this.apiBase, await this.token(draftToken))
  }

  /** Create a repository for the authenticated user. */
  async createRepo(req: CreateRepoRequest): Promise<CreateRepoResult> {
    this.assertAllowed('allowCreateRepo')
    const visibility = req.visibility ?? this.config.defaultVisibility ?? 'private'
    const repo = await githubRequest<GithubRepo>({
      method: 'POST',
      path: '/user/repos',
      token: await this.token(),
      apiBase: this.apiBase,
      body: {
        name: req.name,
        private: visibility === 'private',
        ...(req.description === undefined ? {} : { description: req.description }),
      },
    })
    return {
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
    }
  }

  /** Create a pull request. */
  async createPull(req: CreatePullRequest): Promise<GithubPullRequest> {
    this.assertAllowed('allowPullRequest')
    return githubRequest<GithubPullRequest>({
      method: 'POST',
      path: `/repos/${req.owner}/${req.repo}/pulls`,
      token: await this.token(),
      apiBase: this.apiBase,
      body: {
        title: req.title,
        head: req.head,
        base: req.base,
        ...(req.body === undefined ? {} : { body: req.body }),
      },
    })
  }

  /** Submit a PR review. */
  async createReview(req: CreateReviewRequest): Promise<{ state: string }> {
    this.assertAllowed('allowReview')
    const review = await githubRequest<{ state: string }>({
      method: 'POST',
      path: `/repos/${req.owner}/${req.repo}/pulls/${req.pullNumber}/reviews`,
      token: await this.token(),
      apiBase: this.apiBase,
      body: {
        event: req.event,
        ...(req.body === undefined ? {} : { body: req.body }),
      },
    })
    return { state: review.state }
  }


  /** List pull requests for a repository. */
  async listPulls(req: ListPullsRequest): Promise<GithubPullRequest[]> {
    this.assertAllowed('allowPullRequest')
    const q = req.state === undefined ? '' : `?state=${req.state}`
    return githubRequest<GithubPullRequest[]>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/pulls${q}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  /** Read one pull request. */
  async getPull(req: GetPullRequest): Promise<GithubPullRequest> {
    this.assertAllowed('allowPullRequest')
    return githubRequest<GithubPullRequest>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/pulls/${req.number}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  /** List review comments on a pull request. */
  async listPullComments(req: GetPullRequest): Promise<GithubPullComment[]> {
    this.assertAllowed('allowReview')
    return githubRequest<GithubPullComment[]>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/pulls/${req.number}/comments`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  /** List the files changed by a pull request (includes per-file patch). */
  async getPullFiles(req: GetPullRequest): Promise<GithubPullFile[]> {
    this.assertAllowed('allowReview')
    return githubRequest<GithubPullFile[]>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/pulls/${req.number}/files`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  // ── business: git via ctx.shell ───────────────────────────────────────────

  /** Build a clean HTTPS remote URL (no credentials embedded). */
  remoteUrl(owner: string, repo: string): string {
    return `https://${this.gitHost()}/${owner}/${repo}.git`
  }

  /** Derive the git host from apiBase (github.com, or a GHES host). */
  private gitHost(): string {
    return gitHostFromApiBase(this.apiBase)
  }

  /** Run git add/commit/remote/push (never --force). */
  async push(req: {
    cwd: string
    owner?: string
    repo?: string
    message: string
    branch: string
    add?: boolean
    session?: unknown
  }): Promise<{ pushed: boolean; branch: string }> {
    this.assertAllowed('allowPush')
    // Force-push is architecturally forbidden: no config gate unlocks it here.
    const token = await this.token()
    const shell = this.ctx.shell as ShellExecutor
    const resolved = await this.resolveOwnerRepo(req.cwd, req.owner, req.repo)
    const url = this.remoteUrl(resolved.owner, resolved.repo)
    const steps = [
      req.add === false ? undefined : 'git add -A',
      `git ${this.commitIdentityArgs()}commit -m ${shellQuote(req.message)}`,
      `git ${gitProxyArgs(this.config.gitProxy)}remote set-url origin ${shellQuote(url)}`,
      `git ${gitProxyArgs(this.config.gitProxy)}-c credential.helper='${CREDENTIAL_HELPER}' push -u origin ${req.branch}`,
    ].filter((s): s is string => s !== undefined)
    const sandboxPolicy = req.session === undefined ? undefined : this.sessionShellPolicy(req.session)
    const run = await shell.run(shell.resolve({
      command: steps.join(' && '),
      workdir: req.cwd,
      env: { GITHUB_TOKEN: token },
      ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
    }))
    if (run.exitCode !== 0) {
      throw new Error(`github_push failed: ${run.stderr.text || run.stdout.text}`)
    }
    return { pushed: true, branch: req.branch }
  }


  /**
   * Resolve the calling session's sandbox policy so git can write inside the
   * session workspace. The DSH host confines ctx.shell by default; stamping
   * the policy resolved from the tool's owning session (same as the built-in
   * bash tool) lets the connector's git steps run under that session's mode
   * instead of the deployment default. Returns undefined for agentless calls
   * or when the sandbox-policy service is absent.
   */
  private sessionShellPolicy(session: unknown): SessionShellPolicy | undefined {
    // ctx.get() (not direct property access) — the DSH host enforces Cordis's
    // inject list on this context, and 'sandboxPolicy' is not injected here;
    // get() returns undefined instead of throwing 'cannot get property ...'.
    // Same pattern as the built-in bash tool.
    const policy = this.ctx.get('sandboxPolicy') as
      | { resolve(opts: { session: unknown }): unknown }
      | undefined
    return policy?.resolve({ session }) as SessionShellPolicy | undefined
  }

  /**
   * -c user.name/-c user.email flags for the commit step, derived from the
   * configured git identity (gitName/gitEmail). Empty string when unset, so
   * git falls back to its own identity resolution (global config / env).
   */
  private commitIdentityArgs(): string {
    const args: string[] = []
    if (this.config.gitName !== undefined && this.config.gitName !== '') {
      args.push(`-c ${shellQuote(`user.name=${this.config.gitName}`)}`)
    }
    if (this.config.gitEmail !== undefined && this.config.gitEmail !== '') {
      args.push(`-c ${shellQuote(`user.email=${this.config.gitEmail}`)}`)
    }
    return args.length === 0 ? '' : args.join(' ') + ' '
  }

  /**
   * Resolve owner/repo from explicit arguments, falling back to parsing the
   * cwd's origin remote URL. Fails loud when neither is available.
   */
  private async resolveOwnerRepo(
    cwd: string,
    owner?: string,
    repo?: string,
  ): Promise<{ owner: string; repo: string }> {
    if (owner !== undefined && repo !== undefined) return { owner, repo }
    const shell = this.ctx.shell as ShellExecutor
    const read = await shell.run(shell.resolve({ command: 'git remote get-url origin', workdir: cwd }))
    if (read.exitCode === 0) {
      const parsed = parseRemoteOwnerRepo(read.stdout.text)
      if (parsed !== undefined) {
        return { owner: owner ?? parsed.owner, repo: repo ?? parsed.repo }
      }
    }
    throw new GithubError(
      'OPERATION_FORBIDDEN',
      'github_push: owner/repo are required when the origin remote cannot be resolved',
    )
  }
  /** Run git pull for a branch. */
  async pull(req: { cwd: string; branch?: string; session?: unknown }): Promise<{ pulled: boolean }> {
    this.assertAllowed('allowPull')
    const token = await this.token()
    const shell = this.ctx.shell as ShellExecutor
    const branch = req.branch === undefined ? '' : ` origin ${req.branch}`
    const sandboxPolicy = req.session === undefined ? undefined : this.sessionShellPolicy(req.session)
    const run = await shell.run(shell.resolve({
      command: `git ${gitProxyArgs(this.config.gitProxy)}-c credential.helper='${CREDENTIAL_HELPER}' pull${branch}`,
      workdir: req.cwd,
      env: { GITHUB_TOKEN: token },
      ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
    }))
    if (run.exitCode !== 0) {
      throw new Error(`github_pull failed: ${run.stderr.text || run.stdout.text}`)
    }
    return { pulled: true }
  }


  // ── business: Pages ────────────────────────────────────────────────────────

  /** Read the Pages site configuration and the latest build status. */
  async getPagesStatus(req: { owner: string; repo: string }): Promise<GithubPagesStatus> {
    this.assertAllowed('allowPages')
    const pages = await githubRequest<Record<string, unknown>>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/pages`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return this.projectPages(pages)
  }

  /** Request a new Pages build (e.g. after pushing fresh static content). */
  async requestPagesBuild(req: { owner: string; repo: string }): Promise<GithubPagesBuild> {
    this.assertAllowed('allowPages')
    return githubRequest<GithubPagesBuild>({
      method: 'POST',
      path: `/repos/${req.owner}/${req.repo}/pages/builds`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  // ── business: Actions ───────────────────────────────────────────────────────

  /**
   * Dispatch a workflow_dispatch run. GitHub answers 204 No Content on
   * success; the ref defaults to the repository default branch when omitted.
   */
  async dispatchWorkflow(req: WorkflowDispatchRequest): Promise<{ dispatched: true; workflowId: string; ref: string }> {
    this.assertAllowed('allowActions')
    const body: Record<string, unknown> = {}
    if (req.ref !== undefined && req.ref !== '') body.ref = req.ref
    if (req.inputs !== undefined && Object.keys(req.inputs).length > 0) body.inputs = req.inputs
    await githubRequest<undefined>({
      method: 'POST',
      path: `/repos/${req.owner}/${req.repo}/actions/workflows/${req.workflowId}/dispatches`,
      token: await this.token(),
      apiBase: this.apiBase,
      body,
    })
    return { dispatched: true, workflowId: req.workflowId, ref: req.ref ?? '(default branch)' }
  }

  /** List workflow runs, optionally filtered by workflow/branch/status. */
  async listWorkflowRuns(req: ListWorkflowRunsRequest): Promise<GithubWorkflowRun[]> {
    this.assertAllowed('allowActions')
    const prefix = req.workflowId === undefined || req.workflowId === ''
      ? '/actions/runs'
      : `/actions/workflows/${req.workflowId}/runs`
    const query = buildGithubQuery({
      branch: req.branch,
      status: req.status,
      per_page: req.limit ?? 10,
    })
    const payload = await githubRequest<{ workflow_runs: GithubWorkflowRun[] }>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}${prefix}${query}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return payload.workflow_runs ?? []
  }

  /** Read one workflow run (status/conclusion/head commit). */
  async getWorkflowRun(req: GetWorkflowRunRequest): Promise<GithubWorkflowRun> {
    this.assertAllowed('allowActions')
    return githubRequest<GithubWorkflowRun>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/actions/runs/${req.runId}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  /** List artifacts produced by a workflow run. */
  async listRunArtifacts(req: ListRunArtifactsRequest): Promise<GithubArtifact[]> {
    this.assertAllowed('allowActions')
    const payload = await githubRequest<{ artifacts: Array<Record<string, unknown>> }>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/actions/runs/${req.runId}/artifacts`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return (payload.artifacts ?? []).map(artifact => this.projectArtifact(artifact))
  }

  /**
   * Download one artifact zip to disk. The artifact name is fetched first so
   * the default file name is meaningful; dest is resolved against the host cwd.
   */
  async downloadArtifact(req: DownloadArtifactRequest): Promise<DownloadArtifactResult> {
    this.assertAllowed('allowActions')
    const meta = await githubRequest<{ id: number; name: string; size_in_bytes: number }>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/actions/artifacts/${req.artifactId}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    const buffer = await githubRequestBuffer({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/actions/artifacts/${req.artifactId}/zip`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    const dest = req.dest === undefined || req.dest === ''
      ? path.join(process.cwd(), meta.name + '.zip')
      : path.resolve(process.cwd(), req.dest)
    await fsWriteFile(dest, Buffer.from(buffer))
    return { artifactId: meta.id, name: meta.name, sizeBytes: meta.size_in_bytes, savedTo: dest }
  }


  // ── business: identity & repo reads ─────────────────────────────────────────

  /** Authenticated /user identity for the agent (scopes of classic PATs). */
  async getIdentity(): Promise<GithubUser> {
    this.assertAllowed('allowPull')
    const user = await this.whoami()
    return {
      login: user.login,
      name: user.name,
      html_url: user.html_url,
      ...(user.scopes === undefined ? {} : { scopes: user.scopes }),
    }
  }

  /** Full repository metadata (GET /repos/{owner}/{repo}). */
  async getRepo(req: { owner: string; repo: string }): Promise<GithubRepoDetail> {
    this.assertAllowed('allowPull')
    const repo = await githubRequest<Record<string, unknown>>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return this.projectRepoDetail(repo)
  }

  /** Repositories the authenticated user can see, most recently updated first. */
  async listUserRepos(req: { limit?: number }): Promise<GithubRepo[]> {
    this.assertAllowed('allowPull')
    const query = buildGithubQuery({ sort: 'updated', per_page: req.limit ?? 30 })
    const repos = await githubRequest<Array<Record<string, unknown>>>({
      method: 'GET',
      path: '/user/repos' + query,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return repos.map(repo => this.projectRepoSummary(repo))
  }

  /** Search public/accessible repositories by query. */
  async searchRepos(req: { q: string; limit?: number }): Promise<GithubRepo[]> {
    this.assertAllowed('allowPull')
    const query = buildGithubQuery({ q: req.q, per_page: req.limit ?? 10 })
    const payload = await githubRequest<{ total_count: number; items: Array<Record<string, unknown>> }>({
      method: 'GET',
      path: '/search/repositories' + query,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return (payload.items ?? []).map(repo => this.projectRepoSummary(repo))
  }

  // ── business: content ───────────────────────────────────────────────────────

  /** Read a file (base64) or list a directory via the contents API. */
  async getContent(req: GetContentRequest): Promise<GithubContent> {
    this.assertAllowed('allowPull')
    const pathPart = encodeGithubPath(req.path)
    const query = buildGithubQuery({ ref: req.ref })
    return githubRequest<GithubContent>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/contents/${pathPart}${query}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  /** Recursive git tree of a ref (whole repo structure). */
  async getTree(req: { owner: string; repo: string; ref?: string }): Promise<GithubTreeEntry[]> {
    this.assertAllowed('allowPull')
    const ref = req.ref === undefined || req.ref === '' ? 'HEAD' : req.ref
    const payload = await githubRequest<{ tree: Array<Record<string, unknown>>; truncated: boolean }>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return (payload.tree ?? []).map(entry => this.projectTreeEntry(entry))
  }

  /** Readme of the repository (decoded). */
  async getReadme(req: { owner: string; repo: string; dir?: string; ref?: string }): Promise<GithubReadme> {
    this.assertAllowed('allowPull')
    const dirPart = req.dir === undefined || req.dir === '' ? '' : '/' + encodeGithubPath(req.dir)
    const query = buildGithubQuery({ ref: req.ref })
    return githubRequest<GithubReadme>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/readme${dirPart}${query}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  /** Recent commits, optionally filtered by path or branch. */
  async listCommits(req: { owner: string; repo: string; path?: string; sha?: string; limit?: number }): Promise<GithubCommit[]> {
    this.assertAllowed('allowPull')
    const query = buildGithubQuery({ path: req.path, sha: req.sha, per_page: req.limit ?? 10 })
    const payload = await githubRequest<Array<{
      sha: string
      commit: { message: string; author: { name: string | null; date: string | null } }
      author: { login: string } | null
      html_url: string
    }>>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/commits${query}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return payload.map(entry => ({
      sha: entry.sha,
      message: entry.commit.message.split('\n')[0],
      author_name: entry.commit.author.name,
      author_login: entry.author?.login ?? null,
      author_date: entry.commit.author.date,
      html_url: entry.html_url,
    }))
  }

  /** One commit with its changed files and patches. */
  async getCommit(req: { owner: string; repo: string; sha: string }): Promise<GithubCommitDetail> {
    this.assertAllowed('allowPull')
    const payload = await githubRequest<{
      sha: string
      commit: { message: string; author: { name: string | null; date: string | null } }
      html_url: string
      files?: Array<{ filename: string; status: string; additions: number; deletions: number; changes: number; patch?: string }>
    }>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/commits/${req.sha}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return {
      sha: payload.sha,
      message: payload.commit.message.split('\n')[0],
      author_name: payload.commit.author.name,
      author_date: payload.commit.author.date,
      html_url: payload.html_url,
      files: (payload.files ?? []).map(file => ({
        filename: file.filename, status: file.status, additions: file.additions,
        deletions: file.deletions, changes: file.changes,
        ...(file.patch === undefined ? {} : { patch: file.patch }),
      })),
    }
  }

  /** List branches. */
  async listBranches(req: { owner: string; repo: string; limit?: number }): Promise<GithubBranch[]> {
    this.assertAllowed('allowPull')
    const query = buildGithubQuery({ per_page: req.limit ?? 30 })
    const payload = await githubRequest<Array<{ name: string; protected: boolean; commit: { sha: string } }>>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/branches${query}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return payload.map(branch => ({ name: branch.name, protected: branch.protected, commit_sha: branch.commit.sha }))
  }

  /** One branch with protection settings. */
  async getBranch(req: { owner: string; repo: string; branch: string }): Promise<GithubBranchDetail> {
    this.assertAllowed('allowPull')
    const payload = await githubRequest<{
      name: string
      protected: boolean
      commit: { sha: string }
      protection?: {
        enabled?: boolean
        required_status_checks?: { contexts: string[] } | null
        required_pull_request_reviews?: { required_approving_review_count: number } | null
      }
    }>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/branches/${encodeURIComponent(req.branch)}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return {
      name: payload.name,
      protected: payload.protected,
      commit_sha: payload.commit.sha,
      protection_enabled: payload.protection?.enabled ?? payload.protected,
      required_status_checks: payload.protection?.required_status_checks?.contexts ?? [],
      required_reviews: payload.protection?.required_pull_request_reviews?.required_approving_review_count ?? null,
    }
  }

  /** List tags. */
  async listTags(req: { owner: string; repo: string; limit?: number }): Promise<GithubTag[]> {
    this.assertAllowed('allowPull')
    const query = buildGithubQuery({ per_page: req.limit ?? 30 })
    const payload = await githubRequest<Array<{ name: string; commit: { sha: string }; zipball_url: string; tarball_url: string }>>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/tags${query}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return payload.map(tag => ({
      name: tag.name, commit_sha: tag.commit.sha, zipball_url: tag.zipball_url, tarball_url: tag.tarball_url,
    }))
  }

  // ── business: repo safe writes ──────────────────────────────────────────────

  /** Edit safe repository metadata (description/homepage/topics/features; never visibility). */
  async editRepo(req: EditRepoRequest): Promise<GithubRepo> {
    this.assertAllowed('allowCreateRepo')
    const body: Record<string, unknown> = {}
    if (req.description !== undefined) body.description = req.description
    if (req.homepage !== undefined) body.homepage = req.homepage
    if (req.topics !== undefined) body.topics = req.topics
    if (req.has_issues !== undefined) body.has_issues = req.has_issues
    if (req.has_wiki !== undefined) body.has_wiki = req.has_wiki
    if (req.has_projects !== undefined) body.has_projects = req.has_projects
    const repo = await githubRequest<Record<string, unknown>>({
      method: 'PATCH',
      path: `/repos/${req.owner}/${req.repo}`,
      token: await this.token(),
      apiBase: this.apiBase,
      body,
    })
    return this.projectRepoSummary(repo)
  }

  /** Fork a repository into the authenticated user's account. */
  async forkRepo(req: { owner: string; repo: string }): Promise<GithubRepo> {
    this.assertAllowed('allowCreateRepo')
    const repo = await githubRequest<Record<string, unknown>>({
      method: 'POST',
      path: `/repos/${req.owner}/${req.repo}/forks`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return this.projectRepoSummary(repo)
  }

  /** Create or update a single file via the contents API (creates a commit). */
  async writeFile(req: WriteFileRequest): Promise<GithubFileWriteResult> {
    this.assertAllowed('allowPush')
    const body: Record<string, unknown> = {
      message: req.message,
      content: Buffer.from(req.content, 'utf8').toString('base64'),
    }
    if (req.sha !== undefined && req.sha !== '') body.sha = req.sha
    if (req.branch !== undefined && req.branch !== '') body.branch = req.branch
    const payload = await githubRequest<{ commit: { sha: string; message: string; html_url: string }; content: { path: string } }>({
      method: 'PUT',
      path: `/repos/${req.owner}/${req.repo}/contents/${encodeGithubPath(req.path)}`,
      token: await this.token(),
      apiBase: this.apiBase,
      body,
    })
    return {
      commitSha: payload.commit.sha,
      commitMessage: payload.commit.message,
      commitUrl: payload.commit.html_url,
      path: payload.content.path,
    }
  }

  // ── business: issues ────────────────────────────────────────────────────────

  /** Project one REST repo payload into the agent-facing summary (user repos / search / edit / fork). */
  private projectRepoSummary(repo: Record<string, unknown>): GithubRepo {
    return {
      id: repo.id as number,
      name: repo.name as string,
      full_name: repo.full_name as string,
      private: repo.private as boolean,
      html_url: repo.html_url as string,
      clone_url: repo.clone_url as string,
      ssh_url: repo.ssh_url as string,
    }
  }

  /** Project one REST repo payload into the full metadata view (github_repo_get). */
  private projectRepoDetail(repo: Record<string, unknown>): GithubRepoDetail {
    return {
      ...this.projectRepoSummary(repo),
      description: (repo.description as string | null) ?? null,
      homepage: (repo.homepage as string | null) ?? null,
      default_branch: repo.default_branch as string,
      visibility: repo.visibility as string,
      language: (repo.language as string | null) ?? null,
      topics: (repo.topics as string[] | undefined) ?? [],
      fork: repo.fork as boolean,
      archived: repo.archived as boolean,
      open_issues_count: repo.open_issues_count as number,
      stargazers_count: repo.stargazers_count as number,
      forks_count: repo.forks_count as number,
      pushed_at: repo.pushed_at as string,
      updated_at: repo.updated_at as string,
    }
  }

  /** Project one REST git-tree entry (drops url; size keeps its number|null shape). */
  private projectTreeEntry(entry: Record<string, unknown>): GithubTreeEntry {
    return {
      path: entry.path as string,
      type: entry.type as string,
      mode: entry.mode as string,
      sha: entry.sha as string,
      size: entry.size === undefined ? null : (entry.size as number | null),
    }
  }

  /** Project one REST release payload. */
  private projectRelease(release: Record<string, unknown>): GithubRelease {
    return {
      id: release.id as number,
      tag_name: release.tag_name as string,
      name: (release.name as string | null) ?? null,
      draft: release.draft as boolean,
      prerelease: release.prerelease as boolean,
      html_url: release.html_url as string,
      body: (release.body as string | null) ?? null,
      published_at: (release.published_at as string | null) ?? null,
      target_commitish: (release.target_commitish as string | null) ?? null,
    }
  }

  /** Project one REST workflow payload (ids for github_workflow_dispatch). */
  private projectWorkflow(workflow: Record<string, unknown>): GithubWorkflow {
    return {
      id: workflow.id as number,
      name: workflow.name as string,
      path: workflow.path as string,
      state: workflow.state as string,
      html_url: workflow.html_url as string,
    }
  }

  /** Project one REST workflow-run job payload (failure diagnosis). */
  private projectJob(job: Record<string, unknown>): GithubJob {
    const steps = (job.steps as Array<Record<string, unknown>> | undefined) ?? []
    return {
      id: job.id as number,
      name: job.name as string,
      status: job.status as string,
      conclusion: (job.conclusion as string | null) ?? null,
      html_url: job.html_url as string,
      started_at: (job.started_at as string | null) ?? null,
      completed_at: (job.completed_at as string | null) ?? null,
      steps: steps.map(step => ({
        number: step.number as number,
        name: step.name as string,
        status: step.status as string,
        conclusion: (step.conclusion as string | null) ?? null,
      })),
    }
  }

  /** Project one REST artifact payload. */
  private projectArtifact(artifact: Record<string, unknown>): GithubArtifact {
    return {
      id: artifact.id as number,
      name: artifact.name as string,
      size_in_bytes: artifact.size_in_bytes as number,
      expired: artifact.expired as boolean,
      created_at: artifact.created_at as string,
    }
  }

  /** Project the Pages site payload (status/cname may be null; source is optional). */
  private projectPages(pages: Record<string, unknown>): GithubPagesStatus {
    const source = pages.source as { branch?: string; path?: string } | undefined
    return {
      html_url: pages.html_url as string,
      status: (pages.status as string | null) ?? null,
      cname: (pages.cname as string | null) ?? null,
      ...(source === undefined ? {} : {
        source: { branch: source.branch ?? '', path: source.path ?? '' },
      }),
      ...(pages.build_type === undefined ? {} : { build_type: pages.build_type as string }),
    }
  }

  /** Project one REST issue payload into the wire-safe shape. */
  private projectIssue(issue: {
    number: number; title: string; state: string; html_url: string
    user: { login: string } | null; labels: Array<{ name: string }>; body: string | null
    created_at: string; updated_at: string
  }): GithubIssue {
    return {
      number: issue.number, title: issue.title, state: issue.state, html_url: issue.html_url,
      user_login: issue.user?.login ?? null, labels: issue.labels.map(label => label.name),
      body: issue.body, created_at: issue.created_at, updated_at: issue.updated_at,
    }
  }

  /** List issues (note: pull requests also appear; GitHub treats PRs as issues). */
  async listIssues(req: ListIssuesRequest): Promise<GithubIssue[]> {
    this.assertAllowed('allowIssues')
    const query = buildGithubQuery({
      state: req.state, labels: req.labels, assignee: req.assignee, creator: req.creator,
      sort: req.sort, per_page: req.limit ?? 30,
    })
    const payload = await githubRequest<Array<Parameters<GitHubService['projectIssue']>[0]>>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/issues${query}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return payload.map(issue => this.projectIssue(issue))
  }

  /** Read one issue. */
  async getIssue(req: { owner: string; repo: string; number: number }): Promise<GithubIssue> {
    this.assertAllowed('allowIssues')
    const issue = await githubRequest<Parameters<GitHubService['projectIssue']>[0]>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/issues/${req.number}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return this.projectIssue(issue)
  }

  /** Create an issue. */
  async createIssue(req: CreateIssueRequest): Promise<GithubIssue> {
    this.assertAllowed('allowIssues')
    const body: Record<string, unknown> = { title: req.title }
    if (req.body !== undefined) body.body = req.body
    if (req.labels !== undefined && req.labels.length > 0) body.labels = req.labels
    if (req.assignees !== undefined && req.assignees.length > 0) body.assignees = req.assignees
    const issue = await githubRequest<Parameters<GitHubService['projectIssue']>[0]>({
      method: 'POST',
      path: `/repos/${req.owner}/${req.repo}/issues`,
      token: await this.token(),
      apiBase: this.apiBase,
      body,
    })
    return this.projectIssue(issue)
  }

  /** Comment on an issue or a pull request (PRs are issues on GitHub). */
  async commentOnIssue(req: CommentIssueRequest): Promise<GithubIssueComment> {
    this.assertAllowed('allowIssues')
    const comment = await githubRequest<{ id: number; body: string; user: { login: string } | null; created_at: string; html_url: string }>({
      method: 'POST',
      path: `/repos/${req.owner}/${req.repo}/issues/${req.number}/comments`,
      token: await this.token(),
      apiBase: this.apiBase,
      body: { body: req.body },
    })
    return {
      id: comment.id, body: comment.body, user_login: comment.user?.login ?? null,
      created_at: comment.created_at, html_url: comment.html_url,
    }
  }

  // ── business: releases ──────────────────────────────────────────────────────

  /** List releases. */
  async listReleases(req: { owner: string; repo: string; limit?: number }): Promise<GithubRelease[]> {
    this.assertAllowed('allowRelease')
    const query = buildGithubQuery({ per_page: req.limit ?? 30 })
    const releases = await githubRequest<Array<Record<string, unknown>>>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/releases${query}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return releases.map(release => this.projectRelease(release))
  }

  /** Create a release (draft supported; the tag is created when missing). */
  async createRelease(req: CreateReleaseRequest): Promise<GithubRelease> {
    this.assertAllowed('allowRelease')
    const body: Record<string, unknown> = { tag_name: req.tag_name }
    if (req.target_commitish !== undefined && req.target_commitish !== '') body.target_commitish = req.target_commitish
    if (req.name !== undefined) body.name = req.name
    if (req.body !== undefined) body.body = req.body
    if (req.draft !== undefined) body.draft = req.draft
    if (req.prerelease !== undefined) body.prerelease = req.prerelease
    const release = await githubRequest<Record<string, unknown>>({
      method: 'POST',
      path: `/repos/${req.owner}/${req.repo}/releases`,
      token: await this.token(),
      apiBase: this.apiBase,
      body,
    })
    return this.projectRelease(release)
  }

  // ── business: actions extended ──────────────────────────────────────────────

  /** List workflows of a repository (ids for github_workflow_dispatch). */
  async listWorkflows(req: { owner: string; repo: string }): Promise<GithubWorkflow[]> {
    this.assertAllowed('allowActions')
    const payload = await githubRequest<{ total_count: number; workflows: Array<Record<string, unknown>> }>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/actions/workflows`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return (payload.workflows ?? []).map(workflow => this.projectWorkflow(workflow))
  }

  /** Jobs (with steps) of one workflow run — failure diagnosis. */
  async listWorkflowJobs(req: { owner: string; repo: string; runId: number }): Promise<GithubJob[]> {
    this.assertAllowed('allowActions')
    const payload = await githubRequest<{ total_count: number; jobs: Array<Record<string, unknown>> }>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/actions/runs/${req.runId}/jobs`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return (payload.jobs ?? []).map(job => this.projectJob(job))
  }

  /** List Actions secret NAMES (values are never exposed by GitHub or here). */
  async listSecrets(req: { owner: string; repo: string }): Promise<GithubSecretName[]> {
    this.assertAllowed('allowActions')
    const payload = await githubRequest<{ total_count: number; secrets: GithubSecretName[] }>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/actions/secrets`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
    return payload.secrets ?? []
  }

  // ── business: clone ─────────────────────────────────────────────────────────

  /** Clone a repository into a directory (token via env + inline credential helper). */
  async clone(req: CloneRequest): Promise<CloneResult> {
    this.assertAllowed('allowPull')
    const token = await this.token()
    const shell = this.ctx.shell as ShellExecutor
    const url = this.remoteUrl(req.owner, req.repo)
    const dir = req.dir === undefined || req.dir === '' ? req.repo : req.dir
    const branchArgs = req.branch === undefined || req.branch === '' ? '' : ' --branch ' + shellQuote(req.branch)
    const sandboxPolicy = req.session === undefined ? undefined : this.sessionShellPolicy(req.session)
    const run = await shell.run(shell.resolve({
      command: `git ${gitProxyArgs(this.config.gitProxy)}-c credential.helper='${CREDENTIAL_HELPER}' clone${branchArgs} ${shellQuote(url)} ${shellQuote(dir)}`,
      workdir: process.cwd(),
      env: { GITHUB_TOKEN: token },
      ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
    }))
    if (run.exitCode !== 0) {
      throw new Error('github_clone failed: ' + (run.stderr.text || run.stdout.text))
    }
    return { cloned: true, dir, branch: req.branch ?? 'default' }
  }

  // ── Typert Remote methods (Web UI) ────────────────────────────────────────

  /**
   * Proxy health probe: git ls-remote through the configured (or draft)
   * proxy against a public repo. Validates both proxy connectivity and the
   * exact HTTPS path git push would use. No auth and no file writes, so it
   * also works under the deployment's default sandbox.
   */
  @Remote('proxy.test')
  async proxyTestRemote(request: { proxy?: string }): Promise<GithubProxyTestValue> {
    const proxy = request.proxy ?? this.config.gitProxy
    if (proxy === undefined || proxy === '') {
      return { ok: false, latencyMs: 0, host: 'github.com', error: 'github: no git proxy configured' }
    }
    if (!/^(https?|socks[45]h?):\/\//i.test(proxy)) {
      return { ok: false, latencyMs: 0, host: 'github.com', error: `github: invalid proxy URL ${JSON.stringify(proxy)}` }
    }
    const shell = this.ctx.shell as ShellExecutor
    const started = Date.now()
    const run = await shell.run(shell.resolve({
      command: gitProxyProbeCommand(proxy),
      workdir: process.cwd(),
      timeoutMs: 20000,
    }))
    const latencyMs = Date.now() - started
    if (run.exitCode !== 0) {
      const detail = (run.stderr.text || run.stdout.text || 'unknown error').trim().slice(0, 300)
      return { ok: false, latencyMs, host: 'github.com', error: detail }
    }
    return { ok: true, latencyMs, host: 'github.com', error: null }
  }

  /** Connection test; an optional draft token wins over the stored one. */
  @Remote('whoami')
  async whoamiRemote(request: { draftToken?: string }): Promise<GithubWhoamiValue> {
    const user = await this.whoami(request.draftToken)
    return {
      login: user.login,
      name: user.name,
      htmlUrl: user.html_url,
      scopes: user.scopes ?? [],
      apiBase: this.apiBase,
    }
  }

  /** Read the current resolved config (JSON-safe). */
  @Remote('config.get')
  configGet(): GithubConfigView {
    return toConfigView(this.config)
  }

  /** Merge a patch into the user config layer and return the new view. */
  @Remote('config.set')
  async configSet(request: { patch: Record<string, unknown> }): Promise<GithubConfigView> {
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      throw new Error('github: settings service is absent')
    }
    await settings.update(GITHUB_SETTINGS_NAMESPACE, request.patch)
    return toConfigView(this.config)
  }
}

export default GitHubService
