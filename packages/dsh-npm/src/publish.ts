/**
 * Token-driven npm publish: builds and publishes one local package directory
 * with a transient per-directory .npmrc (registry + auth token, 0600, removed
 * on every path). Requires only the npm CLI (ships with Node) and the
 * connector's granular access token — no user-side npm login, no browser 2FA.
 */
import { type Context } from '@deepseek-ai/cordis'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NpmService } from './npm-service.ts'
import { NpmNeedsTokenError, NpmOtpError } from './npm-service.ts'
import { shellQuote } from './github-shell.ts'

export interface PublishRequest {
  /** The package directory (must contain package.json). */
  dir: string
  /** Optional version to set before publishing (npm version --no-git-tag-version). */
  version?: string
  /** Run 'npm run build --if-present' before publishing. Default true. */
  build?: boolean
  /** Dist-tag to attach the publish to. Default 'latest'. */
  tag?: string
  /** Registry access level for scoped packages. Default 'public'. */
  access?: 'public' | 'restricted'
  /** One-time password for 2FA-guarded accounts (passed as --otp). */
  otp?: string | undefined
  /** Dry run: pack + validate without publishing. */
  dryRun?: boolean
  session?: unknown
}

export interface PublishResult {
  name: string
  version: string
  tag: string
  published: boolean
  detail: string
}

interface ShellPolicy {
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  workspaceRoot: string
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
    const combined = (run.stderr.text + '\n' + run.stdout.text).toLowerCase()
    if (/one-time pass|one time pass|otp|two-factor|two factor|2fa|eneedauth/i.test(combined)) {
      throw new NpmOtpError('npm: 2FA one-time password required: ' + (run.stderr.text || run.stdout.text).slice(0, 200))
    }
    throw new Error('command failed (' + command.slice(0, 60) + '): ' + (run.stderr.text || run.stdout.text).slice(0, 500))
  }
  return { exitCode: run.exitCode, stdout: run.stdout.text, stderr: run.stderr.text }
}

/**
 * Build + publish one package directory with the connector token.
 * @throws NpmNeedsTokenError when no token is configured.
 * @throws NpmOtpError when the registry (or npm CLI) demands a one-time password.
 */
export async function publishPackage(ctx: Context, npm: NpmService, req: PublishRequest): Promise<PublishResult> {
  const token = await npm.resolveToken()
  if (token === undefined || token === '') throw new NpmNeedsTokenError()

  const registry = npm.registry
  const registryHost = new URL(registry).host
  const npmrcPath = join(req.dir, '.npmrc')
  writeFileSync(npmrcPath, [
    'registry = ' + registry,
    '//' + registryHost + '/:_authToken=' + token,
  ].join('\n') + '\n', { mode: 0o600 })
  try {
    if (req.version !== undefined && req.version !== '') {
      await runShell(ctx, 'npm version ' + shellQuote(req.version) + ' --no-git-tag-version', req.dir, req.session)
    }
    if (req.build !== false) {
      await runShell(ctx, 'npm run build --if-present', req.dir, req.session)
    }
    const tag = req.tag ?? 'latest'
    const flags = [
      '--registry ' + shellQuote(registry),
      '--access ' + (req.access ?? 'public'),
      '--tag ' + shellQuote(tag),
      ...(req.otp !== undefined && req.otp !== '' ? ['--otp=' + shellQuote(req.otp)] : []),
      ...(req.dryRun === true ? ['--dry-run'] : []),
    ]
    await runShell(ctx, 'npm publish ' + flags.join(' '), req.dir, req.session)
    const manifest = JSON.parse(readFileSync(join(req.dir, 'package.json'), 'utf8')) as { name?: string; version?: string }
    const name = manifest.name ?? '(unknown)'
    const version = manifest.version ?? '(unknown)'
    return {
      name,
      version,
      tag,
      published: req.dryRun !== true,
      detail: (req.dryRun === true ? '[dry-run] ' : '') + 'published ' + name + '@' + version + ' (tag ' + tag + ')',
    }
  } finally {
    rmSync(npmrcPath, { force: true })
  }
}