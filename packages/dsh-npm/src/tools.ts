/**
 * Model-facing npm tools. With a configured granular access token (credential
 * ref NPM_TOKEN, All packages + Read/Write + bypass 2FA) the agent manages the
 * npm platform side directly: publish (npm_publish), dist-tags (npm_dist_tag),
 * deprecate/undeprecate (npm_deprecate), OIDC trusted publishers
 * (npm_trust_add/list/revoke) and the one-shot launch SOP (npm_launch).
 *
 * Without a token, publishing is delegated to the generated GitHub Actions
 * workflow (OIDC) after a one-time human first publish (npm_first_publish /
 * npm_launch human path).
 *
 * npm platform rule: trust endpoints are 2FA-only — a bypass-2FA GAT is not
 * accepted there. When the registry answers 401 "one-time pass", tools return
 * status 'needs-otp'; the agent asks the user for the OTP once and retries
 * with the otp parameter.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { GitHubService } from 'dsh-connector-github'
import type { NpmService } from './npm-service.ts'
import { NpmNeedsTokenError, NpmOtpError, firstReleaseScript } from './npm-service.ts'
import { launchPackage } from './launch.ts'
import { writeScaffold } from './scaffold.ts'
import { renderScaffold } from './scaffold.ts'
import { publishPackage } from './publish.ts'

/** Shared message for the 2FA/OTP retry contract. */
const OTP_HINT = 'npm 平台对该操作为 2FA 强制；请向用户索要认证器中的 6 位一次性密码，并用 otp 参数重试'

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
    name: 'npm_publish',
    description:
      'Publish (release) one local package directory to npm using the configured '
      + 'granular access token (NPM_TOKEN). Builds the package, optionally bumps '
      + 'the version, publishes with a transient auth token (no user-side npm '
      + 'login, no browser 2FA) and attaches a dist-tag. Requires npm CLI (ships '
      + 'with Node). For 2FA-guarded tokens pass otp (agent asks the user).',
    parameters: {
      dir: { type: 'string', required: true, description: 'The package directory (must contain package.json).' },
      version: { type: 'string', description: 'Optional version to set before publishing (semver, e.g. 0.2.0).' },
      build: { type: 'boolean', description: 'Run "npm run build --if-present" first. Default true.' },
      tag: { type: 'string', description: 'Dist-tag to attach the publish to. Default latest.' },
      access: { type: 'string', enum: ['public', 'restricted'], description: 'Registry access for scoped packages. Default public.' },
      otp: { type: 'string', description: 'One-time password for 2FA-guarded accounts (--otp).' },
      dryRun: { type: 'boolean', description: 'Pack + validate without actually publishing.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          version: { type: 'string', required: true },
          tag: { type: 'string', required: true },
          published: { type: 'boolean', required: true },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.published
          ? 'Published ' + value.name + '@' + value.version + ' (tag ' + value.tag + ')'
          : '[dry-run] Would publish ' + value.name + '@' + value.version,
      }],
    },
    async execute(args, exec) {
      try {
        return await publishPackage(ctx, npm, {
          dir: args.dir,
          ...(args.version === undefined ? {} : { version: args.version }),
          ...(args.build === undefined ? {} : { build: args.build }),
          ...(args.tag === undefined ? {} : { tag: args.tag }),
          ...(args.access === undefined ? {} : { access: args.access }),
          ...(args.otp === undefined ? {} : { otp: args.otp }),
          ...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
          ...(exec.agent?.session === undefined ? {} : { session: exec.agent.session }),
        })
      } catch (error) {
        if (error instanceof NpmNeedsTokenError) {
          return { name: args.dir, version: '', tag: args.tag ?? 'latest', published: false, detail: '未配置 granular token（NPM_TOKEN）— 先让用户到 npm 插件页填入并保存 token' }
        }
        if (error instanceof NpmOtpError) {
          return { name: args.dir, version: '', tag: args.tag ?? 'latest', published: false, detail: OTP_HINT }
        }
        throw error
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Publish npm package', rawInput: args.dir }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_dist_tag',
    description:
      'Manage npm dist-tags through the registry REST API with the configured '
      + 'granular token: add (assign a version to a tag), remove, or list. '
      + '2FA-guarded accounts may need otp for add/remove (agent asks the user). '
      + 'Reversible policy: every dist-tag change is undoable — remove can be '
      + 'undone by add-ing the same version back, and vice versa.',
    parameters: {
      action: { type: 'string', enum: ['add', 'remove', 'list'], required: true, description: 'add: assign version to tag (reversible via remove); remove: remove a tag (reversible via add); list: show all tags.' },
      pkg: { type: 'string', required: true, description: 'Package name, e.g. my-awesome-lib.' },
      tag: { type: 'string', description: 'Dist-tag name (required for add/remove), e.g. latest, beta, next.' },
      version: { type: 'string', description: 'Version to assign (required for add), e.g. 1.2.3.' },
      otp: { type: 'string', description: 'One-time password for 2FA-guarded accounts.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          pkg: { type: 'string', required: true },
          tag: { type: 'string' },
          version: { type: 'string' },
          tagsText: { type: 'string' },
          detail: { type: 'string' },
        },
      },
      render: (_a, value) => [{
        type: 'text',
        text: value.action === 'list'
          ? value.pkg + ' dist-tags: ' + (value.tagsText ?? '{}')
          : value.action === 'add'
            ? 'tag ' + value.tag + ' -> ' + value.version + ' on ' + value.pkg
            : 'removed tag ' + value.tag + ' from ' + value.pkg,
      }],
    },
    async execute(args) {
      try {
        if (args.action === 'list') {
          let tags: Record<string, string>
          try {
            const token = await npm.token()
            tags = await npm.listDistTags(args.pkg, token)
          } catch {
            const info = await npm.checkPackage(args.pkg)
            tags = info.distTags ?? {}
          }
          return { action: 'list', pkg: args.pkg, tagsText: JSON.stringify(tags), detail: 'dist-tags listed' }
        }
        const token = await npm.token()
        if (args.action === 'add') {
          if (args.tag === undefined || args.tag === '') throw new Error('npm_dist_tag add requires tag')
          if (args.version === undefined || args.version === '') throw new Error('npm_dist_tag add requires version')
          await npm.setDistTag(args.pkg, args.tag, args.version, token, args.otp)
          return { action: 'add', pkg: args.pkg, tag: args.tag, version: args.version, detail: 'tag assigned' }
        }
        if (args.tag === undefined || args.tag === '') throw new Error('npm_dist_tag remove requires tag')
        await npm.removeDistTag(args.pkg, args.tag, token, args.otp)
        return { action: 'remove', pkg: args.pkg, tag: args.tag, detail: 'tag removed' }
      } catch (error) {
        if (error instanceof NpmNeedsTokenError) {
          return { action: args.action, pkg: args.pkg, detail: '未配置 granular token（NPM_TOKEN）— 先到 npm 插件页填入并保存 token' }
        }
        if (error instanceof NpmOtpError) {
          return { action: args.action, pkg: args.pkg, detail: OTP_HINT }
        }
        throw error
      }
    },
    presentCall: args => ({ card: 'generic', title: 'npm dist-tag ' + args.action, rawInput: args.pkg + (args.tag ?? '') }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_deprecate',
    description:
      'Deprecate (or undeprecate) a version range of an npm package directly '
      + 'through the registry REST API with the configured granular token '
      + '(mirrors npm CLI semantics: GET ?write=true packument, set '
      + 'versions[*].deprecated, PUT back). Pass an empty message to '
      + 'undeprecate. 2FA-guarded accounts may need otp.',
    parameters: {
      pkg: { type: 'string', required: true, description: 'Package name, e.g. my-awesome-lib.' },
      message: { type: 'string', description: 'Deprecation message. Empty string (or omit + undeprecate: true) = undeprecate.' },
      version: { type: 'string', description: 'Semver range to target. Default * (all versions).' },
      undeprecate: { type: 'boolean', description: 'Undeprecate the targeted versions instead of deprecating.' },
      otp: { type: 'string', description: 'One-time password for 2FA-guarded accounts.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['deprecated', 'undeprecated', 'no-op'], required: true },
          pkg: { type: 'string', required: true },
          versions: { type: 'array', items: { type: 'string' }, required: true },
          detail: { type: 'string' },
        },
      },
      render: (_a, value) => [{
        type: 'text',
        text: value.action === 'no-op'
          ? 'no versions matched the range on ' + value.pkg
          : (value.action === 'deprecated' ? 'deprecated ' : 'undeprecated ')
            + value.pkg + '@' + (value.versions.join(', ') || '(none)'),
      }],
    },
    async execute(args) {
      try {
        const token = await npm.token()
        const result = await npm.deprecate(args.pkg, {
          token,
          message: args.undeprecate === true ? '' : (args.message ?? 'deprecated'),
          versionRange: args.version,
          otp: args.otp,
        })
        if (result.versions.length === 0) {
          return { action: 'no-op' as const, pkg: args.pkg, versions: [], detail: 'no versions matched the range' }
        }
        const action = result.message === '' ? 'undeprecated' as const : 'deprecated' as const
        return { action, pkg: args.pkg, versions: result.versions, detail: (action === 'deprecated' ? 'deprecated with message: ' : 'undeprecated') + (result.message === '' ? '' : result.message) }
      } catch (error) {
        if (error instanceof NpmNeedsTokenError) {
          return { action: 'no-op' as const, pkg: args.pkg, versions: [], detail: '未配置 granular token（NPM_TOKEN）— 先到 npm 插件页填入并保存 token' }
        }
        if (error instanceof NpmOtpError) {
          return { action: 'no-op' as const, pkg: args.pkg, versions: [], detail: OTP_HINT }
        }
        throw error
      }
    },
    presentCall: args => ({ card: 'generic', title: (args.undeprecate ? 'Undeprecate' : 'Deprecate') + ' npm package', rawInput: args.pkg }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_trust_add',
    description:
      'Configure an npm OIDC trusted publisher for a package through the '
      + 'registry REST API with the configured granular token — no local npm '
      + 'CLI required. Supports GitHub Actions, GitLab CI/CD and CircleCI. npm '
      + 'enforces 2FA on trust endpoints: with a non-bypass token the first '
      + 'attempt returns needs-otp; ask the user for the one-time password and '
      + 'retry with the otp parameter (bypass-2FA GATs are rejected by npm for '
      + 'trust endpoints regardless).',
    parameters: {
      pkg: { type: 'string', required: true, description: 'npm package name.' },
      provider: { type: 'string', enum: ['github', 'gitlab', 'circleci'], description: 'CI/CD provider. Default github.' },
      repository: { type: 'string', description: 'GitHub owner/repo (github provider).' },
      workflowFile: { type: 'string', description: 'Workflow file name (github: default release.yml; gitlab: default .gitlab-ci.yml).' },
      environment: { type: 'string', description: 'CI environment name (github/gitlab).' },
      project: { type: 'string', description: 'GitLab group/project (gitlab provider).' },
      orgId: { type: 'string', description: 'CircleCI organization UUID.' },
      projectId: { type: 'string', description: 'CircleCI project UUID.' },
      pipelineDefinitionId: { type: 'string', description: 'CircleCI pipeline definition UUID.' },
      vcsOrigin: { type: 'string', description: 'CircleCI VCS origin, e.g. github.com/owner/repo.' },
      contextIds: { type: 'array', items: { type: 'string' }, description: 'CircleCI context UUIDs.' },
      allowPublish: { type: 'boolean', description: 'Allow npm publish. Default true.' },
      allowStagePublish: { type: 'boolean', description: 'Allow npm stage publish. Default false.' },
      otp: { type: 'string', description: 'One-time password (2FA-guarded accounts; npm trust endpoints are 2FA-only).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['configured', 'needs-otp', 'needs-token', 'failed'], required: true },
          id: { type: 'string' },
          detail: { type: 'string' },
          command: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'configured'
          ? 'Trusted publisher configured for ' + _args.pkg + (value.id !== undefined ? ' (id ' + value.id + ')' : '')
          : value.status === 'needs-token'
            ? 'No granular npm token configured — set NPM_TOKEN in the npm plugin settings, then rerun. Manual command: ' + (value.command ?? '')
            : value.status === 'needs-otp'
              ? 'Trust endpoint demands a one-time password: ' + OTP_HINT + '. Manual command: ' + (value.command ?? '')
              : 'npm trust failed: ' + (value.detail ?? ''),
      }],
    },
    async execute(args) {
      try {
        const token = await npm.token()
        const config = npm.buildTrustConfig(args.provider ?? 'github', {
          repository: args.repository,
          file: args.workflowFile,
          environment: args.environment,
          project: args.project,
          orgId: args.orgId,
          projectId: args.projectId,
          pipelineDefinitionId: args.pipelineDefinitionId,
          vcsOrigin: args.vcsOrigin,
          contextIds: args.contextIds,
          allowPublish: args.allowPublish,
          allowStagePublish: args.allowStagePublish,
        })
        const { id } = await npm.createTrust(args.pkg, token, config, args.otp)
        return { status: 'configured' as const, ...(id === null ? {} : { id }), detail: 'trusted publisher configured' }
      } catch (error) {
        const command = npm.trustCommand(args.pkg, args.workflowFile ?? 'release.yml', args.repository ?? '')
        if (error instanceof NpmNeedsTokenError) {
          return { status: 'needs-token' as const, command, detail: '未配置 granular token（NPM_TOKEN）' }
        }
        if (error instanceof NpmOtpError) {
          return { status: 'needs-otp' as const, command, detail: 'npm trust 端点要求一次性密码（2FA 强制）' }
        }
        return { status: 'failed' as const, command, detail: String(error).slice(0, 300) }
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Configure npm trusted publisher', rawInput: args.pkg }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_trust_list',
    description:
      'List the OIDC trusted-publisher configurations of one npm package '
      + 'through the registry REST API with the configured granular token.',
    parameters: {
      pkg: { type: 'string', required: true, description: 'npm package name.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pkg: { type: 'string', required: true },
          verified: { type: 'boolean', required: true },
          trusts: { type: 'array', required: true, items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                type: { type: 'string', required: true },
                claims: { type: 'object', additionalProperties: true },
                permissions: { type: 'array', items: { type: 'string' }, required: true },
              },
            },
          },
          checkUrl: { type: 'string', required: true },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.verified
          ? value.trusts.length === 0
            ? value.pkg + ': no trusted publisher configured'
            : value.pkg + ': ' + value.trusts.map((t) => t.type + ' (' + t.permissions.join(', ') + ')').join('; ')
          : value.pkg + ': trust list not readable — ' + (value.detail ?? '') + ' (' + value.checkUrl + ')',
      }],
    },
    async execute(args) {
      return transferTrustStatus(await npm.trustStatusRemote({ pkg: args.pkg }))
    },
    presentCall: args => ({ card: 'generic', title: 'List npm trusted publishers', rawInput: args.pkg }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_trust_revoke',
    description:
      'Revoke one OIDC trusted-publisher configuration of an npm package '
      + 'through the registry REST API with the configured granular token. '
      + 'Reversible policy: revoking a trust config can always be undone by '
      + 'npm_trust_add with the same provider/repository/file parameters. '
      + 'npm enforces 2FA on trust endpoints: use npm_trust_list to read the '
      + 'id, then retry with otp when the endpoint demands a one-time password.',
    parameters: {
      pkg: { type: 'string', required: true, description: 'npm package name.' },
      id: { type: 'string', required: true, description: 'Trusted-publisher id (from npm_trust_list).' },
      otp: { type: 'string', description: 'One-time password (2FA-guarded accounts).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['revoked', 'needs-otp', 'needs-token', 'failed'], required: true },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'revoked'
          ? 'Revoked trusted publisher ' + _args.id + ' from ' + _args.pkg
          : value.status === 'needs-token'
            ? 'No granular npm token configured — set NPM_TOKEN first. ' + (value.detail ?? '')
            : value.status === 'needs-otp'
              ? OTP_HINT + '. ' + (value.detail ?? '')
              : 'npm trust revoke failed: ' + (value.detail ?? ''),
      }],
    },
    async execute(args) {
      try {
        const token = await npm.token()
        await npm.revokeTrust(args.pkg, args.id, token, args.otp)
        return { status: 'revoked' as const, detail: 'trusted publisher revoked' }
      } catch (error) {
        if (error instanceof NpmNeedsTokenError) {
          return { status: 'needs-token' as const, detail: '未配置 granular token（NPM_TOKEN）' }
        }
        if (error instanceof NpmOtpError) {
          return { status: 'needs-otp' as const, detail: 'npm trust 端点要求一次性密码（2FA 强制）' }
        }
        return { status: 'failed' as const, detail: String(error).slice(0, 300) }
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Revoke npm trusted publisher', rawInput: args.pkg }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_token_status',
    description:
      'Report the npm granular access token status (credential ref NPM_TOKEN, '
      + 'value never echoed): whether it is configured, which npm account it '
      + 'authenticates as, and granular-token setup guidance when missing.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          configured: { type: 'boolean', required: true },
          source: { type: 'string', required: true },
          login: { type: 'string' },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: (value.configured ? 'npm token configured' : 'npm token NOT configured')
          + ' (ref ' + value.source + ')' + (value.login ? ' as ' + value.login : '') + (value.detail ? ' — ' + value.detail : ''),
      }],
    },
    async execute() {
      const view = await npm.tokenStatusRemote()
      return {
        configured: view.configured,
        source: view.source,
        ...(view.login === null ? {} : { login: view.login }),
        ...(view.detail === null ? {} : { detail: view.detail }),
      }
    },
    presentCall: () => ({ card: 'generic', title: 'npm token status' }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_launch',
    description:
      'Launch an open-source npm package (SOP). Validates the npm name, '
      + 'scaffolds a publishable TS package (OIDC release workflow + Pages site), '
      + 'creates the GitHub repo, pushes the initial commit and enables Pages. '
      + 'With a granular access token configured (credential ref NPM_TOKEN: All '
      + 'packages + Read/Write + bypass 2FA) it then publishes the first release, '
      + 'configures the trusted publisher and tags the next version — fully '
      + 'automatic, one call. Without a token it returns a humanScript for the '
      + 'browser-2FA first publish, then stage "tag" finishes the SOP. Requires '
      + 'the dsh-connector-github plugin (GitHub credentials).',
    parameters: {
      name: { type: 'string', required: true, description: 'npm package name (also the GitHub repo name).' },
      description: { type: 'string', description: 'One-line package description.' },
      owner: { type: 'string', description: 'GitHub owner; defaults to the authenticated identity.' },
      visibility: { type: 'string', enum: ['private', 'public'], description: 'Repo visibility (default public).' },
      author: { type: 'string', description: 'Author name (LICENSE/README).' },
      dir: { type: 'string', description: 'Local output directory (defaults to ./<name>).' },
      initialVersion: { type: 'string', description: 'First release version (default 0.1.0).' },
      stage: { type: 'string', enum: ['launch', 'tag'], description: "'launch' (default): scaffold + repo + push + pages, then auto publish + trust + tag when NPM_TOKEN is configured (otherwise returns the human 2FA script). 'tag': legacy manual path — create the v<next> tag after the human ran the script." },
      autoPublish: { type: 'boolean', description: 'Set false to skip token-driven auto publish and always return the human script. Default: auto.' },
      otp: { type: 'string', description: 'One-time password for 2FA-guarded npm accounts (publish + trust).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          stage: { type: 'string', enum: ['auto-published', 'awaiting-human-2fa', 'tag-created'], required: true },
          account: { type: 'string' },
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
          : value.stage === 'auto-published'
            ? 'Launched + auto-published ' + value.repo.fullName + ' (' + value.repo.htmlUrl + '). trust=' + value.trust.status + (value.next.length > 0 ? ' Next: ' + value.next.join('; ') : '')
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
        ...(args.autoPublish === undefined ? {} : { autoPublish: args.autoPublish }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.owner === undefined ? {} : { owner: args.owner }),
        ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
        ...(args.author === undefined ? {} : { author: args.author }),
        ...(args.dir === undefined ? {} : { dir: args.dir }),
        ...(args.initialVersion === undefined ? {} : { initialVersion: args.initialVersion }),
        ...(args.stage === undefined ? {} : { stage: args.stage }),
        ...(args.otp === undefined ? {} : { otp: args.otp }),
        ...(exec.agent?.session === undefined ? {} : { session: exec.agent.session }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Launch npm package', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_first_publish',
    description:
      'Fallback for accounts without a configured granular npm token: generate '
      + 'the human 2FA script for the first release of a scaffolded package '
      + '(npm publish + npm trust). With credential ref NPM_TOKEN set to a '
      + 'granular token (All packages + Read/Write + bypass 2FA), npm_launch '
      + 'publishes automatically and this tool is unnecessary.',
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
      const script = firstReleaseScript({
        pkg: args.pkg,
        repository: args.repository,
        ...(args.dir === undefined ? {} : { dir: args.dir }),
        ...(args.workflowFile === undefined ? {} : { workflowFile: args.workflowFile }),
      })
      return { status: 'generated' as const, script }
    },
    presentCall: args => ({ card: 'generic', title: 'First npm publish script', rawInput: args.pkg }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_trust_status',
    description:
      'Report whether an npm package exists and read its OIDC trusted-publisher '
      + 'configuration through the configured token. Without a token (or when '
      + 'the trust endpoint refuses), returns the exact npmjs.com URL to check.',
    parameters: {
      pkg: { type: 'string', required: true, description: 'npm package name.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pkg: { type: 'string', required: true },
          exists: { type: 'boolean', required: true },
          verified: { type: 'boolean', required: true },
          trusts: { type: 'array', required: true, items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                type: { type: 'string', required: true },
                claims: { type: 'object', additionalProperties: true },
                permissions: { type: 'array', items: { type: 'string' }, required: true },
              },
            },
          },
          checkUrl: { type: 'string', required: true },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: _args.pkg + ':' + (value.exists ? ' published' : ' NOT published')
          + (value.verified
            ? (value.trusts.length === 0 ? ' — no trusted publisher' : ' — trust: ' + value.trusts.map((t) => t.type + '(' + t.permissions.join(',') + ')').join('; '))
            : ' — trust state not readable; see ' + value.checkUrl),
      }],
    },
    async execute(args) {
      return transferTrustStatus(await npm.trustStatusRemote({ pkg: args.pkg }))
    },
    presentCall: args => ({ card: 'generic', title: 'npm trust status', rawInput: args.pkg }),
  }))
}

/** Convert a trust status view into the flat tool output shape. */
function transferTrustStatus(view: {
  pkg: string
  exists: boolean
  verified: boolean
  trusts: { id: string; type: string; claims: Record<string, unknown>; permissions: string[] }[]
  checkUrl: string
  detail: string
}): {
  pkg: string
  exists: boolean
  verified: boolean
  trusts: { id: string; type: string; claims: Record<string, JsonValue>; permissions: string[] }[]
  checkUrl: string
  detail: string
} {
  return {
    pkg: view.pkg,
    exists: view.exists,
    verified: view.verified,
    trusts: view.trusts.map((t) => ({
      id: t.id,
      type: t.type,
      claims: t.claims as Record<string, JsonValue>,
      permissions: t.permissions,
    })),
    checkUrl: view.checkUrl,
    detail: view.detail,
  }
}