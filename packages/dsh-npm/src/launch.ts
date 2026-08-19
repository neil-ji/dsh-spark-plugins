/**
 * npm_launch orchestration, three stages (SOP 2026-08):
 *
 *  stage 'launch' (default): agent does check -> scaffold -> GitHub repo ->
 *    initial push -> Pages; then RETURNS a humanScript (first npm publish +
 *    OIDC trust) because npm 2FA is browser-session based and trust requires
 *    the package to already exist (E404 otherwise). The agent never holds an
 *    npm credential and cannot complete the 2FA steps.
 *
 *  stage 'tag': after the human ran humanScript (published the first version
 *    and configured the trusted publisher), create the annotated tag for the
 *    NEXT version -> the CI release workflow publishes via OIDC, no 2FA.
 *
 * Publishing itself always runs in CI via OIDC, so after the one-time manual
 * first publish + trust, every later release is fully automatic.
 */
import { type Context } from '@deepseek-ai/cordis'
import { mkdir } from 'node:fs/promises'
import type { GitHubService } from 'dsh-connector-github'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { NpmService } from './npm-service.ts'
import { renderScaffold, writeScaffold } from './scaffold.ts'
import { shellQuote } from './github-shell.ts'

export interface LaunchRequest {
  name: string
  description?: string
  owner?: string
  visibility?: 'private' | 'public'
  author?: string
  dir?: string
  initialVersion?: string
  /** @deprecated legacy no-op — the launch flow never runs npm trust itself. */
  skipTrust?: boolean
  /** 'launch' (default): scaffold + repo + push + pages, then return the human 2FA script. 'tag': create the CI-release tag after the human published + trusted. */
  stage?: 'launch' | 'tag'
  session?: unknown
}

export interface LaunchResult {
  dir: string
  repo: { fullName: string; htmlUrl: string }
  pushed: boolean
  pages: { configured: boolean; url?: string; detail?: string }
  stage: 'awaiting-human-2fa' | 'tag-created'
  /** One combined script (first publish + OIDC trust) for the human to run with browser 2FA. Present on 'awaiting-human-2fa'. */
  humanScript?: string
  trust: {
    status: 'pending-human' | 'configured' | 'failed'
    command?: string
    detail?: string
  }
  tag?: { name: string; sha?: string }
  next: string[]
}

interface ShellPolicy {
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  workspaceRoot: string
}

/** Bump the patch of a semver-ish string: "0.1.0" -> "0.1.1". */
export function bumpPatch(version: string): string {
  const parts = version.split('.')
  const last = parseInt(parts[parts.length - 1] ?? '0', 10)
  if (Number.isNaN(last)) return version + '.1'
  parts[parts.length - 1] = String(last + 1)
  return parts.join('.')
}

export async function launchPackage(
  ctx: Context,
  github: GitHubService,
  npm: NpmService,
  req: LaunchRequest,
): Promise<LaunchResult> {
  const owner = req.owner ?? (await github.getIdentity()).login
  const repoName = req.name
  const version = req.initialVersion ?? '0.1.0'
  const dir = req.dir ?? repoName

  // ---- stage 'tag': Phase C (human already published + trusted) ----
  if (req.stage === 'tag') {
    const info = await npm.checkPackage(req.name)
    if (!info.exists) {
      throw new Error(
        'npm package ' + req.name + ' is not published yet — run npm_launch (stage: launch) and execute its humanScript (npm publish + npm trust) first',
      )
    }
    const nextVersion = bumpPatch(version)
    const tagName = 'v' + nextVersion
    const tag = await createAnnotatedTag(ctx, github, owner, repoName, nextVersion, tagName)
    return {
      dir,
      repo: { fullName: owner + '/' + repoName, htmlUrl: 'https://github.com/' + owner + '/' + repoName },
      pushed: true,
      pages: { configured: true, url: 'https://' + owner + '.github.io/' + repoName + '/' },
      stage: 'tag-created',
      trust: { status: 'configured', command: npm.trustCommand(req.name, 'release.yml', owner + '/' + repoName) },
      tag: { name: tagName, sha: tag.sha },
      next: [],
    }
  }

  // ---- stage 'launch': Phase A (agent) ----
  const next: string[] = []

  // 1. npm package name must be available
  const info = await npm.checkPackage(req.name)
  if (info.exists) {
    throw new Error('npm package ' + req.name + ' is already taken (latest: ' + (info.latest ?? '?') + ')')
  }

  // 2. scaffold into dir
  const author = req.author ?? github.config.gitName ?? owner
  const year = String(new Date().getFullYear())
  const files = await renderScaffold({
    packageName: req.name,
    description: req.description ?? '',
    repoOwner: owner,
    repoName: repoName,
    authorName: author,
    licenseYear: year,
  })
  await mkdir(dir, { recursive: true })
  await writeScaffold(dir, files)

  // 3. create the GitHub repository (open-source launch defaults to public; Pages needs it)
  const repo = await github.createRepo({
    name: repoName,
    ...(req.description === undefined ? {} : { description: req.description }),
    visibility: req.visibility ?? 'public',
  })

  // 4. git init + origin + initial push (github.push handles add/commit/set-url/push)
  await runShell(ctx, 'git init -b main', dir, req.session)
  await runShell(ctx, 'git remote add origin ' + shellQuote('https://github.com/' + owner + '/' + repoName + '.git'), dir, req.session)
  const pushed = await github.push({
    cwd: dir,
    owner,
    repo: repoName,
    message: 'feat: initial scaffold for ' + repoName,
    branch: 'main',
    ...(req.session === undefined ? {} : { session: req.session }),
  })

  // 5. enable Pages with GitHub Actions build (workflow) — no branch source needed
  const pagesResult = await createPages(ctx, github, owner, repoName)

  // ---- Phase B: return the human 2FA script (first publish + OIDC trust) ----
  // npm 2FA is browser-session based; npm trust has no --otp and requires the
  // package to already exist. The agent cannot do this, so surface one script.
  const trustCommand = npm.trustCommand(req.name, 'release.yml', owner + '/' + repoName)
  const nextVersion = bumpPatch(version)
  const humanScript = [
    '# 首次发布 + OIDC trust(浏览器 2FA,每条确认一次;完成后回来调 npm_launch stage: tag)',
    'cd ' + shellQuote(dir),
    'npm publish',
    'npm trust github ' + req.name + ' --file release.yml --repository ' + owner + '/' + repoName + ' --allow-publish -y',
  ].join('\n')
  next.push('在终端执行上面 humanScript 里的命令(首次 npm publish + npm trust,浏览器 2FA)')
  next.push('完成后再次调用 npm_launch(stage: "tag")→ 创建 v' + nextVersion + ' tag,CI 自动发布后续版本(免 2FA)')

  return {
    dir,
    repo: { fullName: repo.fullName, htmlUrl: repo.htmlUrl },
    pushed: pushed.pushed,
    pages: pagesResult,
    stage: 'awaiting-human-2fa',
    humanScript,
    trust: { status: 'pending-human', command: trustCommand, detail: '首次发布 + OIDC trust 需浏览器 2FA,请执行 humanScript' },
    next,
  }
}

/** Resolve the calling session's sandbox policy (same as the built-in bash tool). */
function sessionShellPolicy(ctx: Context, session: unknown): ShellPolicy | undefined {
  const policy = (ctx.get('sandboxPolicy') as
    | { resolve(opts: { session: unknown }): unknown }
    | undefined)
  return policy?.resolve({ session }) as ShellPolicy | undefined
}

async function runShell(ctx: Context, command: string, workdir: string, session: unknown): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const shell = ctx.shell as ShellExecutor
  const sandboxPolicy = session === undefined ? undefined : sessionShellPolicy(ctx, session)
  const run = await shell.run(shell.resolve({
    command,
    workdir,
    ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
  }))
  if (run.exitCode !== 0) {
    throw new Error('command failed (' + command.slice(0, 60) + '): ' + (run.stderr.text || run.stdout.text).slice(0, 500))
  }
  return { exitCode: run.exitCode, stdout: run.stdout.text, stderr: run.stderr.text }
}

async function githubApi(
  github: GitHubService,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const token = await github.resolveToken()
  if (token === undefined) throw new Error('github: token is not configured')
  const response = await fetch(github.config.apiBase + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'dsh-connector-npm',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  return { status: response.status, data }
}

/** POST /repos/{owner}/{repo}/pages with build_type workflow (GitHub Actions deploys). */
async function createPages(ctx: Context, github: GitHubService, owner: string, repo: string): Promise<LaunchResult['pages']> {
  const { status, data } = await githubApi(github, 'POST', '/repos/' + owner + '/' + repo + '/pages', { build_type: 'workflow' })
  if (status === 201 || status === 200) {
    const htmlUrl = (data as { html_url?: string } | undefined)?.html_url
    return { configured: true, url: htmlUrl ?? 'https://' + owner + '.github.io/' + repo + '/', detail: 'Pages enabled with GitHub Actions build' }
  }
  const detail = (data as { message?: string } | undefined)?.message ?? String(data).slice(0, 200)
  return { configured: false, detail: 'GitHub /pages responded ' + status + ': ' + detail }
}

/** Create an annotated tag via the git data API (triggers the tag release workflow). */
async function createAnnotatedTag(
  ctx: Context,
  github: GitHubService,
  owner: string,
  repo: string,
  version: string,
  tagName: string,
): Promise<{ sha: string }> {
  const head = await githubApi(github, 'GET', '/repos/' + owner + '/' + repo + '/git/ref/heads/main')
  if (head.status !== 200) throw new Error('github: cannot resolve main head for tag (HTTP ' + head.status + ')')
  const headSha = (head.data as { object?: { sha?: string } }).object?.sha
  if (headSha === undefined) throw new Error('github: main head sha missing')

  const taggerName = github.config.gitName ?? 'dsh-npm-bot'
  const taggerEmail = github.config.gitEmail ?? 'npm@localhost'
  const tag = await githubApi(github, 'POST', '/repos/' + owner + '/' + repo + '/git/tags', {
    tag: tagName,
    message: 'Release ' + tagName,
    object: headSha,
    type: 'commit',
    tagger: { name: taggerName, email: taggerEmail, date: new Date().toISOString() },
  })
  if (tag.status !== 201) {
    const detail = (tag.data as { message?: string } | undefined)?.message ?? ''
    throw new Error('github: annotated tag creation failed (HTTP ' + tag.status + '): ' + detail)
  }
  const tagSha = (tag.data as { sha?: string }).sha
  if (tagSha === undefined) throw new Error('github: tag sha missing')

  const ref = await githubApi(github, 'POST', '/repos/' + owner + '/' + repo + '/git/refs', {
    ref: 'refs/tags/' + tagName,
    sha: tagSha,
  })
  if (ref.status !== 201) {
    const detail = (ref.data as { message?: string } | undefined)?.message ?? ''
    throw new Error('github: tag ref creation failed (HTTP ' + ref.status + '): ' + detail)
  }
  return { sha: tagSha }
}
