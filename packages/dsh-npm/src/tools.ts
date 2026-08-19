/**
 * Model-facing npm tools. Publishing is delegated to the generated GitHub
 * Actions workflow (OIDC); these tools cover package check, scaffold, trusted
 * publisher setup and the one-shot launch orchestration.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GitHubService } from 'dsh-connector-github'
import type { NpmService } from './npm-service.ts'
import { launchPackage } from './launch.ts'
import { writeScaffold } from './scaffold.ts'
import { renderScaffold } from './scaffold.ts'
import { shellQuote } from './github-shell.ts'

export function registerNpmTools(ctx: Context, npm: NpmService, getGithub: () => GitHubService | undefined): void {
  ctx.tools.register(defineTool({
    name: 'npm_package_check',
    description:
      'Check availability and current metadata of an npm package name '
      + '(registry query, no credentials).',
    parameters: {
      name: { type: 'string', required: true, description: 'Package name, e.g. my-awesome-lib.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exists: { type: 'boolean', required: true },
          name: { type: 'string', required: true },
          latest: { type: 'string' },
          description: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.exists
          ? value.name + ' is taken (latest: ' + (value.latest ?? '?') + ')'
          : value.name + ' is available',
      }],
    },
    async execute(args) {
      const info = await npm.checkPackage(args.name)
      return {
        exists: info.exists,
        name: info.name,
        ...(info.latest === undefined ? {} : { latest: info.latest }),
        ...(info.description === undefined ? {} : { description: info.description }),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Check npm package', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_scaffold',
    description:
      'Generate a minimal publishable TypeScript npm package: package.json, '
      + 'tsconfig, esbuild build, README/LICENSE, .github/workflows (OIDC npm '
      + 'release + Pages) and a landing/docs Pages site. Does not touch GitHub '
      + 'or npm; use npm_launch for the full pipeline.',
    parameters: {
      name: { type: 'string', required: true, description: 'Package/repo name.' },
      description: { type: 'string', description: 'One-line package description.' },
      repoOwner: { type: 'string', description: 'GitHub owner for links (defaults to current identity).' },
      author: { type: 'string', description: 'Author name (LICENSE/README).' },
      dir: { type: 'string', description: 'Output directory (defaults to ./<name>).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          files: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'Scaffolded ' + value.files + ' files -> ' + value.dir }],
    },
    async execute(args, exec) {
      const github = getGithub()
      const owner = args.repoOwner ?? (github === undefined ? '' : (await github.getIdentity()).login)
      const author = args.author ?? github?.config.gitName ?? owner
      const files = await renderScaffold({
        packageName: args.name,
        description: args.description ?? '',
        repoOwner: owner,
        repoName: args.name,
        authorName: author,
        licenseYear: String(new Date().getFullYear()),
      })
      const dir = args.dir ?? args.name
      const count = await writeScaffold(dir, files)
      return { dir, files: count }
    },
    presentCall: args => ({ card: 'generic', title: 'Scaffold npm package', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_trust_add',
    description:
      'Configure npm OIDC trusted publishing for a package (npm >= 11.10): '
      + 'the GitHub Actions workflow release.yml becomes an allowed publisher. '
      + 'With a 2FA-writes npm account the command pauses for an OTP, so the '
      + 'exact command is returned for you to run in a terminal.',
    parameters: {
      pkg: { type: 'string', required: true, description: 'npm package name.' },
      repository: { type: 'string', required: true, description: 'owner/repo on GitHub.' },
      workflowFile: { type: 'string', description: 'Workflow file name (default release.yml).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['configured', 'needs-otp', 'failed'], required: true },
          command: { type: 'string' },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'configured'
          ? 'Trusted publisher configured for ' + _args.pkg
          : value.status === 'needs-otp'
            ? 'Run in a terminal (OTP required): ' + (value.command ?? '')
            : 'npm trust failed: ' + (value.detail ?? ''),
      }],
    },
    async execute(args, exec) {
      const command = npm.trustCommand(args.pkg, args.workflowFile ?? 'release.yml', args.repository)
      const sandboxPolicy = exec.agent?.session === undefined
        ? undefined
        : (ctx.get('sandboxPolicy') as { resolve(o: { session: unknown }): unknown } | undefined)?.resolve({ session: exec.agent.session })
      const shell = ctx.shell as { run(r: { command: string; workdir: string; timeoutMs?: number; sandboxPolicy?: unknown }): Promise<{ exitCode: number; aborted?: boolean; timedOut?: boolean; stdout: { text: string }; stderr: { text: string } }> }
      const run = await shell.run({ command, workdir: process.cwd(), timeoutMs: 25000, ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }) })
      const combined = (run.stdout.text + '\n' + run.stderr.text).toLowerCase()
      const paused = run.aborted === true || run.timedOut === true
      if (run.exitCode === 0 && !paused) return { status: 'configured' as const, command, detail: 'trusted publisher configured' }
      if (paused || /otp|one-time|two-factor|two factor|2fa|passcode|authentication required|eneedauth/i.test(combined)) {
        return { status: 'needs-otp' as const, command, detail: 'npm trust requires an OTP (2FA writes mode); run it in a terminal' }
      }
      return { status: 'failed' as const, command, detail: (run.stderr.text || run.stdout.text).slice(0, 400) }
    },
    presentCall: args => ({ card: 'generic', title: 'Configure npm trusted publisher', rawInput: args.pkg }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_launch',
    description:
      'Launch an open-source npm package in two stages (SOP): stage "launch" '
      + '(default) validates the npm name, scaffolds a publishable TS package (OIDC '
      + 'release workflow + Pages site), creates the GitHub repo, pushes the initial '
      + 'commit and enables Pages — then returns a humanScript with the first npm '
      + 'publish + npm trust (browser 2FA; the agent cannot do this). After the human '
      + 'runs it, call again with stage "tag" to create the v<next> annotated tag, and '
      + 'CI publishes future versions via OIDC with no 2FA. Requires the '
      + 'dsh-connector-github plugin (GitHub credentials).',
    parameters: {
      name: { type: 'string', required: true, description: 'npm package name (also the GitHub repo name).' },
      description: { type: 'string', description: 'One-line package description.' },
      owner: { type: 'string', description: 'GitHub owner; defaults to the authenticated identity.' },
      visibility: { type: 'string', enum: ['private', 'public'], description: 'Repo visibility (default public).' },
      author: { type: 'string', description: 'Author name (LICENSE/README).' },
      dir: { type: 'string', description: 'Local output directory (defaults to ./<name>).' },
      initialVersion: { type: 'string', description: 'First release version (default 0.1.0).' },
      stage: { type: 'string', enum: ['launch', 'tag'], description: "'launch' (default): scaffold + repo + push + pages, returns the human 2FA script (first npm publish + npm trust). 'tag': after the human ran that script, create the v<next> tag to trigger the CI OIDC release." },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          stage: { type: 'string', enum: ['awaiting-human-2fa', 'tag-created'], required: true },
          humanScript: { type: 'string' },
          repo: { type: 'object', additionalProperties: false, properties: { fullName: { type: 'string', required: true }, htmlUrl: { type: 'string', required: true } }, required: true },
          pushed: { type: 'boolean', required: true },
          pages: { type: 'object', additionalProperties: false, properties: { configured: { type: 'boolean', required: true }, url: { type: 'string' }, detail: { type: 'string' } }, required: true },
          trust: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', required: true }, command: { type: 'string' }, detail: { type: 'string' } }, required: true },
          tag: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, sha: { type: 'string' } } },
          next: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.stage === 'tag-created'
          ? 'Tag ' + (value.tag?.name ?? '') + ' created on ' + value.repo.fullName + ' — CI is publishing via OIDC (no 2FA).'
          : 'Launched ' + value.repo.fullName + ' (' + value.repo.htmlUrl + '). Next: run the humanScript (npm publish + npm trust, browser 2FA), then call npm_launch with stage: "tag".\n' + (value.humanScript ?? ''),
      }],
    },
    async execute(args, exec) {
      const github = getGithub()
      if (github === undefined) {
        throw new Error('dsh-connector-github is not loaded: add it to the profile bundles before using npm_launch')
      }
      return launchPackage(ctx, github, npm, {
        name: args.name,
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.owner === undefined ? {} : { owner: args.owner }),
        ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
        ...(args.author === undefined ? {} : { author: args.author }),
        ...(args.dir === undefined ? {} : { dir: args.dir }),
        ...(args.initialVersion === undefined ? {} : { initialVersion: args.initialVersion }),
        ...(args.stage === undefined ? {} : { stage: args.stage }),
        ...(exec.agent?.session === undefined ? {} : { session: exec.agent.session }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Launch npm package', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_first_publish',
    description:
      'Generate the human 2FA script for the first npm release of a scaffolded '
      + 'package: npm publish + npm trust (OIDC publisher). npm 2FA is browser-'
      + 'session based and npm trust has no --otp, so the agent cannot run this — '
      + 'the script is returned for the human to execute in a terminal. After it '
      + 'succeeds, call npm_launch with stage: "tag".',
    parameters: {
      pkg: { type: 'string', required: true, description: 'npm package name.' },
      repository: { type: 'string', required: true, description: 'owner/repo on GitHub.' },
      dir: { type: 'string', description: 'Local package directory (defaults to ./<pkg>).' },
      workflowFile: { type: 'string', description: 'Workflow file name (default release.yml).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['generated'], required: true },
          script: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'Run in a terminal (browser 2FA):\n' + value.script }],
    },
    async execute(args) {
      const script = [
        '# 首次发布 + OIDC trust(浏览器 2FA,每条确认一次)',
        'cd ' + shellQuote(args.dir ?? args.pkg),
        'npm publish',
        'npm trust github ' + args.pkg + ' --file ' + (args.workflowFile ?? 'release.yml') + ' --repository ' + args.repository + ' --allow-publish -y',
      ].join('\n')
      return { status: 'generated' as const, script }
    },
    presentCall: args => ({ card: 'generic', title: 'First npm publish script', rawInput: args.pkg }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_deprecate',
    description:
      'Generate the npm deprecate command for an old package name (rename SOP): '
      + 'marks it deprecated pointing to the new name. Requires browser 2FA, so '
      + 'the command is returned for the human to run.',
    parameters: {
      pkg: { type: 'string', required: true, description: 'Old package name to deprecate.' },
      message: { type: 'string', description: 'Deprecation message (default: renamed to <newPkg>).' },
      newPkg: { type: 'string', description: 'New package name (used in the default message).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['generated'], required: true },
          command: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'Run in a terminal (browser 2FA):\n' + value.command }],
    },
    async execute(args) {
      const message = args.message ?? (args.newPkg === undefined ? 'deprecated' : 'renamed to ' + args.newPkg)
      return { status: 'generated' as const, command: 'npm deprecate ' + args.pkg + ' ' + JSON.stringify(message) }
    },
    presentCall: args => ({ card: 'generic', title: 'Deprecate npm package', rawInput: args.pkg }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_trust_status',
    description:
      'Report whether an npm package exists and whether its OIDC trusted-publisher '
      + 'state can be verified. Trust state is account-private (not exposed by the '
      + 'public registry), so when it cannot be verified the tool returns the '
      + 'exact npmjs.com URL to check.',
    parameters: {
      pkg: { type: 'string', required: true, description: 'npm package name.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exists: { type: 'boolean', required: true },
          verified: { type: 'boolean', required: true },
          checkUrl: { type: 'string', required: true },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: _args.pkg + ':' + (value.exists ? ' published' : ' NOT published')
          + (value.verified ? ' — trust verified' : ' — trust state not publicly checkable; see ' + value.checkUrl),
      }],
    },
    async execute(args) {
      const info = await npm.checkPackage(args.pkg)
      const checkUrl = 'https://www.npmjs.com/package/' + args.pkg + '?tab=settings'
      return {
        exists: info.exists,
        verified: false,
        checkUrl,
        detail: info.exists
          ? 'trusted-publisher state is account-private; verify at ' + checkUrl
          : 'package is not published yet — publish it (npm_first_publish) before configuring trust',
      }
    },
    presentCall: args => ({ card: 'generic', title: 'npm trust status', rawInput: args.pkg }),
  }))
}
