/**
 * npm_launch orchestration (SOP 2026-08, token-first):
 *
 *  stage 'launch' (default): agent does check -> scaffold -> GitHub repo ->
 *    initial push -> Pages; then, WITH a configured granular access token
 *    (NPM_TOKEN), publishes the first release, configures the OIDC trusted
 *    publisher and tags the next version — fully automatic, one call.
 *
 *    Without a token it returns a humanScript (first npm publish + OIDC
 *    trust, browser 2FA) and the flow finishes via stage 'tag' after the
 *    human ran it.
 *
 *  stage 'tag': create the annotated tag for the NEXT version -> the CI
 *    release workflow publishes via OIDC, no 2FA.
 *
 * Trust caveat (npm platform rule): GAT with bypass 2FA is not accepted by
 * npm's trust endpoints; with a non-bypass token the registry answers 401
 * "one-time pass". The connector surfaces that as trust.status 'needs-otp'
 * and the caller asks the user for the OTP once, then reruns npm_trust_add
 * with the otp parameter. Publishing itself never needs OTP with a bypass
 * 2FA granular token.
 */
import { type Context } from '@deepseek-ai/cordis'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitHubService } from 'dsh-connector-github'
import type { NpmService } from './npm-service.ts'
import { NpmNeedsTokenError, NpmOtpError } from './npm-service.ts'
import { renderScaffold, writeScaffold } from './scaffold.ts'
import { shellQuote } from './github-shell.ts'
import { publishPackage } from './publish.ts'

export interface LaunchRequest {
  name: string
  description?: string
  owner?: string
  visibility?: 'private' | 'public'
  author?: string
  dir?: string
  initialVersion?: string
  /** @deprecated legacy no-op — the launch flow calls npm trust itself (token or script). */
  skipTrust?: boolean
  /** Set false to always return the human script even when a granular npm token is configured. Default: auto. */
  autoPublish?: boolean
  /** One-time password for 2FA-guarded npm accounts (published via --otp; trust via npm-otp header). */
  otp?: string
  /** 'launch' (default): scaffold + repo + push + pages, then publish + trust + tag when a token is configured. 'tag': create the CI-release tag after the human published + trusted. */
  stage?: 'launch' | 'tag'
  session?: unknown
}

export interface LaunchResult {
  dir: string
  repo: { fullName: string; htmlUrl: string }
  pushed: boolean
  pages: { configured: boolean; url?: string; detail?: string }
  stage: 'auto-published' | 'awaiting-human-2fa' | 'tag-created'
  /** npm account the token resolved to (auto path only). */
  account?: string
  /** One combined script (first publish + OIDC trust) for the human to run with browser 2FA. Present on 'awaiting-human-2fa'. */
  humanScript?: string
  trust: {
    status: 'pending-human' | 'configured' | 'needs-otp' | 'failed' | 'needs-token' | 'skipped'
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
      trust: { status: 'configured' as const, command: npm.trustCommand(req.name, 'release.yml', owner + '/' + repoName) },
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

  // ---- Phase B (token): fully automatic first publish + trust + tag ----
  // A granular access token (All packages + read/write + bypass 2FA) lets the
  // agent run the whole first-release SOP itself: publish (npm CLI + transient
  // .npmrc), configure the trusted publisher (registry REST API), then tag the
  // next version so CI owns later releases.
  let token: string | undefined
  try { token = await npm.resolveToken() } catch { token = undefined }
  const trustCommand = npm.trustCommand(req.name, 'release.yml', owner + '/' + repoName)
  const nextVersion = bumpPatch(version)

  if (req.autoPublish !== false && token !== undefined && token !== '') {
    try {
      await publishPackage(ctx, npm, { dir, version, ...(req.otp === undefined ? {} : { otp: req.otp }), session: req.session })
    } catch (error) {
      if (error instanceof NpmNeedsTokenError) {
        // token vanished between resolve and publish — fall through to human path
        token = undefined
      } else if (error instanceof NpmOtpError) {
        // The token does not bypass 2FA: publish itself needs an OTP. Surface the
        // script + detailed instruction instead of a dead end.
        const humanScript = [
          '# 首次发布 + OIDC trust(浏览器 2FA,每条确认一次;完成后回来调 npm_launch stage: tag)',
          'cd ' + shellQuote(dir),
          'npm publish',
          'npm trust github ' + req.name + ' --file release.yml --repository ' + owner + '/' + repoName + ' --allow-publish -y',
        ].join('\n')
        next.push('npm publish 需要 2FA OTP（当前 token 未勾选 bypass 2FA）— 可改用 bypass 2FA 的 granular token，或把上面 humanScript 的 npm publish 换成带 --otp 的重跑')
        return {
          dir,
          repo: { fullName: repo.fullName, htmlUrl: repo.htmlUrl },
          pushed: pushed.pushed,
          pages: pagesResult,
          stage: 'awaiting-human-2fa',
          humanScript,
          trust: { status: 'needs-otp', command: trustCommand, detail: 'npm publish 需要 OTP（token 未 bypass 2FA）；也可换 bypass 2FA token 后重跑 npm_launch' },
          next,
        }
      }
      throw error
    }
    // publish succeeded → never fall back to the human script from here on.
    const account = await npm.whoami(token).catch(() => null)
    try {
      const trustConfig = npm.buildTrustConfig('github', {
        repository: owner + '/' + repoName,
        file: 'release.yml',
        allowPublish: true,
      })
      await npm.createTrust(req.name, token, trustConfig, req.otp)
      const autoNextVersion = bumpPatch(version)
      const autoTagName = 'v' + autoNextVersion
      const autoTag = await createAnnotatedTag(ctx, github, owner, repoName, autoNextVersion, autoTagName)
      return {
        dir,
        repo: { fullName: owner + '/' + repoName, htmlUrl: 'https://github.com/' + owner + '/' + repoName },
        pushed: pushed.pushed,
        pages: pagesResult,
        stage: 'auto-published',
        ...(account === null ? {} : { account }),
        trust: { status: 'configured' as const, command: trustCommand, detail: 'trusted publisher configured with the granular token' },
        tag: { name: autoTagName, sha: autoTag.sha },
        next: [],
      }
    } catch (error) {
      if (error instanceof NpmOtpError) {
        next.push('trust 需要 2FA OTP（npm 平台对 trust 端点强制 2FA；bypass 2FA 的 GAT 不被 trust 端点接受）— 提供 OTP 后调用 npm_trust_add(otp=...) 完成配置，再调 npm_launch(stage: "tag") 创建 v' + nextVersion + ' tag')
        return {
          dir,
          repo: { fullName: owner + '/' + repoName, htmlUrl: 'https://github.com/' + owner + '/' + repoName },
          pushed: pushed.pushed,
          pages: pagesResult,
          stage: 'auto-published',
          ...(account === null ? {} : { account }),
          trust: { status: 'needs-otp', command: trustCommand, detail: 'first publish done; trust needs a one-time OTP (npm trust endpoints are 2FA-only)' },
          next,
        }
      }
      next.push('首发已发布，但 trust 配置失败（' + String(error).slice(0, 160) + '）— 用 npm_trust_add 修复后调 npm_launch(stage: "tag")')
      return {
        dir,
        repo: { fullName: owner + '/' + repoName, htmlUrl: 'https://github.com/' + owner + '/' + repoName },
        pushed: pushed.pushed,
        pages: pagesResult,
        stage: 'auto-published',
        ...(account === null ? {} : { account }),
        trust: { status: 'failed', command: trustCommand, detail: String(error).slice(0, 200) },
        next,
      }
    }
  }

  // ---- Phase B: return the human 2FA script (first publish + OIDC trust) ----
  // npm 2FA is browser-session based; npm trust has no --otp and requires the
  // package to already exist. Without a token the agent cannot do this, so
  // surface one script.
  const humanScript = [
    '# 首次发布 + OIDC trust(浏览器 2FA,每条确认一次;完成后回来调 npm_launch stage: tag)',
    'cd ' + shellQuote(dir),
    'npm publish',
    'npm trust github ' + req.name + ' --file release.yml --repository ' + owner + '/' + repoName + ' --allow-publish -y',
  ].join('\n')
  next.push('在终端执行上面 humanScript 里的命令(首次 npm publish + npm trust,浏览器 2FA)')
  next.push('完成后再次调用 npm_launch(stage: "tag")→ 创建 v' + nextVersion + ' tag,CI 自动发布后续版本(免 2FA)')
  next.push('推荐：到插件页填入 granular token（All packages + Read and write + bypass 2FA）并保存，npm_launch 下次全自动')

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