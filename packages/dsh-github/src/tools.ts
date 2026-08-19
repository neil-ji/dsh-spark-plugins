/**
 * Model-facing GitHub tools. Every tool delegates to GitHubService; dangerous
 * operations are absent from the parameter schemas (no force, no delete).
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { decodeBase64Content } from './github-rest.ts'
import type { GitHubService } from './github-service.ts'

/** Register all GitHub tools on the host tool registry. */
export function registerGithubTools(ctx: Context, github: GitHubService): void {
  ctx.tools.register(defineTool({
    name: 'github_repo_create',
    description:
      'Create a remote GitHub repository for the authenticated user. '
      + 'Use this as the first step of the publish flow: create a local project, '
      + 'write the code, then call this to create the remote and github_push to publish.',
    parameters: {
      name: { type: 'string', required: true, description: 'Repository name (owner/repo-style names are rejected).' },
      description: { type: 'string', description: 'Optional repository description.' },
      visibility: { type: 'string', enum: ['private', 'public'], description: 'Defaults to the configured visibility.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          htmlUrl: { type: 'string', required: true },
          cloneUrl: { type: 'string', required: true },
          sshUrl: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Created ${value.fullName} (${value.htmlUrl})` }],
    },
    async execute(args) {
      return github.createRepo({
        name: args.name,
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Create GitHub repo', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_push',
    description:
      'Commit and push the working tree to GitHub. Never force-pushes and never '
      + 'deletes branches or repositories.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory (defaults to the host cwd).' },
      owner: { type: 'string', description: 'Repository owner; defaults to the origin remote.' },
      repo: { type: 'string', description: 'Repository name; defaults to the origin remote.' },
      message: { type: 'string', required: true, description: 'Commit message.' },
      branch: { type: 'string', description: 'Branch to push (default main).' },
      add: { type: 'boolean', description: 'Run git add -A first (default true).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pushed: { type: 'boolean', required: true },
          branch: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Pushed branch ${value.branch}` }],
    },
    async execute(args, exec) {
      return github.push({
        cwd: args.cwd ?? process.cwd(),
        ...(args.owner === undefined ? {} : { owner: args.owner }),
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        message: args.message,
        branch: args.branch ?? 'main',
        ...(args.add === undefined ? {} : { add: args.add }),
        ...(exec.agent?.session === undefined ? {} : { session: exec.agent.session }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Push to GitHub', rawInput: { owner: args.owner ?? 'origin', repo: args.repo ?? 'origin', branch: args.branch ?? 'main' } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_pull',
    description: 'Pull the latest changes for a GitHub repository branch.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory (defaults to the host cwd).' },
      branch: { type: 'string', description: 'Branch to pull (defaults to the current branch).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { pulled: { type: 'boolean', required: true } },
      },
      render: () => [{ type: 'text', text: 'Pulled' }],
    },
    async execute(args, exec) {
      return github.pull({
        cwd: args.cwd ?? process.cwd(),
        ...(args.branch === undefined ? {} : { branch: args.branch }),
        ...(exec.agent?.session === undefined ? {} : { session: exec.agent.session }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Pull from GitHub', rawInput: args.branch }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_pr',
    description: 'Create a GitHub pull request between two branches.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      title: { type: 'string', required: true },
      head: { type: 'string', required: true, description: 'Source branch.' },
      base: { type: 'string', required: true, description: 'Target branch.' },
      body: { type: 'string', description: 'PR body.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          number: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          state: { type: 'string', required: true },
          htmlUrl: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `PR #${value.number}: ${value.title} (${value.htmlUrl})` }],
    },
    async execute(args) {
      const pr = await github.createPull({
        owner: args.owner,
        repo: args.repo,
        title: args.title,
        head: args.head,
        base: args.base,
        ...(args.body === undefined ? {} : { body: args.body }),
      })
      return { number: pr.number, title: pr.title, state: pr.state, htmlUrl: pr.html_url }
    },
    presentCall: args => ({ card: 'generic', title: 'Create GitHub PR', rawInput: { owner: args.owner, repo: args.repo, head: args.head, base: args.base } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_review',
    description: 'Submit a GitHub pull-request review (approve, request changes, or comment).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      pullNumber: { type: 'integer', required: true },
      event: { type: 'string', required: true, enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] },
      body: { type: 'string', description: 'Review body.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { state: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Review submitted: ${value.state}` }],
    },
    async execute(args) {
      return github.createReview({
        owner: args.owner,
        repo: args.repo,
        pullNumber: args.pullNumber,
        event: args.event,
        ...(args.body === undefined ? {} : { body: args.body }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Review GitHub PR', rawInput: { owner: args.owner, repo: args.repo, pullNumber: args.pullNumber, event: args.event } }),
  }))
  ctx.tools.register(defineTool({
    name: 'github_pr_list',
    description: 'List pull requests for a GitHub repository.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Defaults to open.' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            number: { type: 'integer', required: true },
            title: { type: 'string', required: true },
            state: { type: 'string', required: true },
            htmlUrl: { type: 'string', required: true },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} pull request(s)` }],
    },
    async execute(args) {
      const pulls = await github.listPulls({
        owner: args.owner,
        repo: args.repo,
        ...(args.state === undefined ? {} : { state: args.state }),
      })
      return pulls.map(pr => ({ number: pr.number, title: pr.title, state: pr.state, htmlUrl: pr.html_url }))
    },
    presentCall: args => ({ card: 'generic', title: 'List GitHub PRs', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_pr_get',
    description: 'Read one GitHub pull request by number.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      number: { type: 'integer', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          number: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          state: { type: 'string', required: true },
          htmlUrl: { type: 'string', required: true },
          head: { type: 'object', additionalProperties: false, properties: { ref: { type: 'string' } } },
          base: { type: 'object', additionalProperties: false, properties: { ref: { type: 'string' } } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `PR #${value.number}: ${value.title}` }],
    },
    async execute(args) {
      const pr = await github.getPull({ owner: args.owner, repo: args.repo, number: args.number })
      return { number: pr.number, title: pr.title, state: pr.state, htmlUrl: pr.html_url, head: { ref: pr.head.ref }, base: { ref: pr.base.ref } }
    },
    presentCall: args => ({ card: 'generic', title: 'Get GitHub PR', rawInput: { owner: args.owner, repo: args.repo, number: args.number } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_review_list',
    description: 'List the files changed and existing review comments on a pull request (read before reviewing).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      pullNumber: { type: 'integer', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                filename: { type: 'string', required: true },
                status: { type: 'string', required: true },
                additions: { type: 'integer', required: true },
                deletions: { type: 'integer', required: true },
                changes: { type: 'integer', required: true },
                patch: { type: 'string' },
              },
            },
          },
          comments: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'integer', required: true },
                path: { type: 'string', required: true },
                body: { type: 'string', required: true },
                user: { type: 'object', additionalProperties: false, properties: { login: { type: 'string' } } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.files.length} file(s), ${value.comments.length} comment(s)` }],
    },
    async execute(args) {
      const [files, comments] = await Promise.all([
        github.getPullFiles({ owner: args.owner, repo: args.repo, number: args.pullNumber }),
        github.listPullComments({ owner: args.owner, repo: args.repo, number: args.pullNumber }),
      ])
      return {
        files: files.map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, changes: f.changes, ...(f.patch === undefined ? {} : { patch: f.patch }) })),
        comments: comments.map(c => ({ id: c.id, path: c.path, body: c.body, user: { login: c.user.login } })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'List GitHub review details', rawInput: { owner: args.owner, repo: args.repo, pullNumber: args.pullNumber } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_pages_status',
    description:
      'Read the GitHub Pages site configuration and latest build status for a repository. '
      + 'Use after github_push to a pages branch to confirm the build settled.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          html_url: { type: 'string', required: true },
          status: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          cname: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          source: { type: 'object', additionalProperties: false, properties: { branch: { type: 'string' }, path: { type: 'string' } } },
          build_type: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Pages ${value.html_url} status: ${value.status ?? 'unknown'}` }],
    },
    async execute(args) {
      return github.getPagesStatus({ owner: args.owner, repo: args.repo })
    },
    presentCall: args => ({ card: 'generic', title: 'GitHub Pages status', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_pages_build',
    description:
      'Request a new GitHub Pages build for a repository. '
      + 'Use after pushing fresh static content so the site is regenerated.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          status: { type: 'string', required: true },
          error: { oneOf: [{ type: 'object', additionalProperties: false, properties: { message: { type: 'string' } } }, { type: 'null' }] },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Pages build ${value.url} -> ${value.status}` }],
    },
    async execute(args) {
      return github.requestPagesBuild({ owner: args.owner, repo: args.repo })
    },
    presentCall: args => ({ card: 'generic', title: 'Build GitHub Pages', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_workflow_dispatch',
    description:
      'Trigger a GitHub Actions workflow via workflow_dispatch (inputs supported). '
      + 'The workflow must declare on: workflow_dispatch. The token needs Actions '
      + 'write permission (classic PATs: the workflow scope).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      workflowId: { type: 'string', required: true, description: 'Workflow id or file name (e.g. ci.yml).' },
      ref: { type: 'string', description: 'Branch/tag/SHA to run on; defaults to the repository default branch.' },
      inputs: { type: 'object', additionalProperties: true, description: 'workflow_dispatch inputs as a JSON object of string values.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dispatched: { type: 'boolean', required: true },
          workflowId: { type: 'string', required: true },
          ref: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Dispatched ${value.workflowId} on ${value.ref}` }],
    },
    async execute(args) {
      return github.dispatchWorkflow({
        owner: args.owner,
        repo: args.repo,
        workflowId: args.workflowId,
        ...(args.ref === undefined ? {} : { ref: args.ref }),
        ...(args.inputs === undefined ? {} : { inputs: args.inputs as Record<string, string> }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Dispatch GitHub workflow', rawInput: { owner: args.owner, repo: args.repo, workflowId: args.workflowId } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_workflow_runs',
    description:
      'List GitHub Actions workflow runs, optionally filtered by workflow, branch and status. '
      + 'Use the run id with github_workflow_run / github_workflow_artifacts.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      workflowId: { type: 'string', description: 'Workflow id or file name; omit to list all workflows.' },
      branch: { type: 'string', description: 'Filter by head branch.' },
      status: { type: 'string', enum: ['queued', 'in_progress', 'completed', 'success', 'failure', 'cancelled', 'skipped'], description: 'Filter by run status.' },
      limit: { type: 'integer', description: 'Max entries (default 10).' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'integer', required: true },
            name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            display_title: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            status: { type: 'string', required: true },
            conclusion: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            html_url: { type: 'string', required: true },
            head_branch: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            head_sha: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            run_number: { type: 'integer' },
            event: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} workflow run(s)` }],
    },
    async execute(args) {
      const runs = await github.listWorkflowRuns({
        owner: args.owner,
        repo: args.repo,
        ...(args.workflowId === undefined ? {} : { workflowId: args.workflowId }),
        ...(args.branch === undefined ? {} : { branch: args.branch }),
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      })
      return runs.map(run => ({
        id: run.id, name: run.name, display_title: run.display_title,
        status: run.status, conclusion: run.conclusion, html_url: run.html_url,
        head_branch: run.head_branch, head_sha: run.head_sha,
        run_number: run.run_number, event: run.event,
      }))
    },
    presentCall: args => ({ card: 'generic', title: 'List GitHub workflow runs', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_workflow_run',
    description: 'Read one GitHub Actions workflow run by id (status, conclusion, head commit).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      runId: { type: 'integer', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'integer', required: true },
          name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          display_title: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          status: { type: 'string', required: true },
          conclusion: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          html_url: { type: 'string', required: true },
          head_branch: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          head_sha: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          run_number: { type: 'integer' },
          event: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Run #${value.id} (${value.name ?? 'workflow'}): ${value.status}${value.conclusion === null ? '' : ' -> ' + value.conclusion}` }],
    },
    async execute(args) {
      const run = await github.getWorkflowRun({ owner: args.owner, repo: args.repo, runId: args.runId })
      return {
        id: run.id, name: run.name, display_title: run.display_title,
        status: run.status, conclusion: run.conclusion, html_url: run.html_url,
        head_branch: run.head_branch, head_sha: run.head_sha,
        run_number: run.run_number, event: run.event,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Get GitHub workflow run', rawInput: { owner: args.owner, repo: args.repo, runId: args.runId } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_workflow_artifacts',
    description: 'List artifacts produced by a GitHub Actions workflow run (ids for github_artifact_download).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      runId: { type: 'integer', required: true },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'integer', required: true },
            name: { type: 'string', required: true },
            size_in_bytes: { type: 'integer' },
            expired: { type: 'boolean' },
            created_at: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} artifact(s)` }],
    },
    async execute(args) {
      const artifacts = await github.listRunArtifacts({ owner: args.owner, repo: args.repo, runId: args.runId })
      return artifacts.map(artifact => ({
        id: artifact.id, name: artifact.name,
        size_in_bytes: artifact.size_in_bytes, expired: artifact.expired, created_at: artifact.created_at,
      }))
    },
    presentCall: args => ({ card: 'generic', title: 'List workflow artifacts', rawInput: { owner: args.owner, repo: args.repo, runId: args.runId } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_artifact_download',
    description:
      'Download a GitHub Actions artifact zip to disk. '
      + 'Writes to dest (absolute, or relative to the host cwd); defaults to <cwd>/<artifact-name>.zip.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      artifactId: { type: 'integer', required: true },
      dest: { type: 'string', description: 'Output file path; defaults to <cwd>/<artifact-name>.zip.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactId: { type: 'integer', required: true },
          name: { type: 'string', required: true },
          sizeBytes: { type: 'integer', required: true },
          savedTo: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Saved ${value.name} (${value.sizeBytes} bytes) -> ${value.savedTo}` }],
    },
    async execute(args) {
      return github.downloadArtifact({
        owner: args.owner,
        repo: args.repo,
        artifactId: args.artifactId,
        ...(args.dest === undefined ? {} : { dest: args.dest }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Download workflow artifact', rawInput: { owner: args.owner, repo: args.repo, artifactId: args.artifactId } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_whoami',
    description: 'Authenticated GitHub identity and token scopes (classic PATs only).',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          login: { type: 'string', required: true },
          name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          html_url: { type: 'string', required: true },
          scopes: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Authenticated as ${value.login} (${value.scopes?.length ?? 0} scopes)` }],
    },
    async execute() {
      return github.getIdentity()
    },
    presentCall: () => ({ card: 'generic', title: 'GitHub whoami', rawInput: undefined }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_repo_get',
    description: 'Read full metadata of a repository (description, default branch, topics, stars, activity).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'integer', required: true },
          name: { type: 'string', required: true },
          full_name: { type: 'string', required: true },
          private: { type: 'boolean', required: true },
          html_url: { type: 'string', required: true },
          clone_url: { type: 'string' },
          ssh_url: { type: 'string' },
          description: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          homepage: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          default_branch: { type: 'string', required: true },
          visibility: { type: 'string' },
          language: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          topics: { type: 'array', items: { type: 'string' } },
          fork: { type: 'boolean' },
          archived: { type: 'boolean' },
          open_issues_count: { type: 'integer' },
          stargazers_count: { type: 'integer' },
          forks_count: { type: 'integer' },
          pushed_at: { type: 'string' },
          updated_at: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.full_name} (${value.private ? 'private' : 'public'}, default ${value.default_branch})` }],
    },
    async execute(args) {
      return github.getRepo({ owner: args.owner, repo: args.repo })
    },
    presentCall: args => ({ card: 'generic', title: 'Get GitHub repo', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_user_repos',
    description: 'List repositories of the authenticated user (and accessible org repos), most recently updated first.',
    parameters: {
      limit: { type: 'integer', description: 'Max entries (default 30).' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'integer', required: true },
            name: { type: 'string', required: true },
            full_name: { type: 'string', required: true },
            private: { type: 'boolean', required: true },
            html_url: { type: 'string', required: true },
            clone_url: { type: 'string' },
            ssh_url: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} repo(s)` }],
    },
    async execute(args) {
      return github.listUserRepos({ ...(args.limit === undefined ? {} : { limit: args.limit }) })
    },
    presentCall: () => ({ card: 'generic', title: 'List my GitHub repos', rawInput: undefined }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_search_repos',
    description: 'Search GitHub repositories by query (e.g. language:typescript stars:>100).',
    parameters: {
      q: { type: 'string', required: true, description: 'Search query.' },
      limit: { type: 'integer', description: 'Max entries (default 10).' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'integer', required: true },
            name: { type: 'string', required: true },
            full_name: { type: 'string', required: true },
            private: { type: 'boolean', required: true },
            html_url: { type: 'string', required: true },
            clone_url: { type: 'string' },
            ssh_url: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} repo(s)` }],
    },
    async execute(args) {
      return github.searchRepos({ q: args.q, ...(args.limit === undefined ? {} : { limit: args.limit }) })
    },
    presentCall: args => ({ card: 'generic', title: 'Search GitHub repos', rawInput: args.q }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_content',
    description:
      'Read a file (decoded UTF-8) or list a directory inside a repository '
      + 'via the GitHub contents API. Use github_repo_tree for the whole structure.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      path: { type: 'string', required: true, description: 'File or directory path (e.g. src/index.ts).' },
      ref: { type: 'string', description: 'Branch/ref; defaults to the default branch.' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'file', required: true },
              name: { type: 'string', required: true },
              path: { type: 'string', required: true },
              size: { type: 'integer', required: true },
              content: { type: 'string', required: true },
              truncated: { type: 'boolean', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'dir', required: true },
              count: { type: 'integer', required: true },
              entries: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, path: { type: 'string', required: true }, type: { type: 'string', required: true }, size: { type: 'integer' } } } },
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'file'
          ? `File ${value.path} (${value.size} bytes)${value.truncated ? ' [truncated]' : ''}`
          : `Directory: ${value.count} entr(ies)`,
      }],
    },
    async execute(args) {
      const content = await github.getContent({
        owner: args.owner,
        repo: args.repo,
        path: args.path,
        ...(args.ref === undefined ? {} : { ref: args.ref }),
      })
      if (Array.isArray(content)) {
        return {
          kind: 'dir' as const,
          count: content.length,
          entries: content.map(entry => ({
            name: entry.name,
            path: entry.path,
            type: entry.type,
            ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
          })),
        }
      }
      return {
        kind: 'file' as const,
        name: content.name,
        path: content.path,
        size: content.size,
        content: decodeBase64Content(content.content, content.encoding),
        truncated: content.truncated ?? false,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Read GitHub content', rawInput: { owner: args.owner, repo: args.repo, path: args.path } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_repo_tree',
    description: 'Recursive git tree of a repository ref — the whole file structure with shas.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      ref: { type: 'string', description: 'Branch/tag/SHA; defaults to HEAD.' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            type: { type: 'string', required: true },
            mode: { type: 'string' },
            size: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            sha: { type: 'string', required: true },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Tree with ${value.length} entr(ies)` }],
    },
    async execute(args) {
      return github.getTree({ owner: args.owner, repo: args.repo, ...(args.ref === undefined ? {} : { ref: args.ref }) })
    },
    presentCall: args => ({ card: 'generic', title: 'Get repo tree', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_readme',
    description: 'Read the README of a repository (decoded).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      dir: { type: 'string', description: 'Optional subdirectory containing the readme.' },
      ref: { type: 'string', description: 'Branch/ref; defaults to the default branch.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          path: { type: 'string', required: true },
          content: { type: 'string', required: true },
          html_url: { type: 'string', required: true },
          download_url: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `README ${value.path} (${value.content.length} chars)` }],
    },
    async execute(args) {
      const readme = await github.getReadme({
        owner: args.owner,
        repo: args.repo,
        ...(args.dir === undefined ? {} : { dir: args.dir }),
        ...(args.ref === undefined ? {} : { ref: args.ref }),
      })
      return {
        name: readme.name,
        path: readme.path,
        content: decodeBase64Content(readme.content, readme.encoding),
        html_url: readme.html_url,
        download_url: readme.download_url,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Read GitHub README', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_commits',
    description: 'List recent commits, optionally filtered by file path or branch.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      path: { type: 'string', description: 'Only commits touching this path.' },
      sha: { type: 'string', description: 'Branch or commit sha to list from.' },
      limit: { type: 'integer', description: 'Max entries (default 10).' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sha: { type: 'string', required: true },
            message: { type: 'string', required: true },
            author_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            author_login: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            author_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            html_url: { type: 'string', required: true },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} commit(s)` }],
    },
    async execute(args) {
      return github.listCommits({
        owner: args.owner,
        repo: args.repo,
        ...(args.path === undefined ? {} : { path: args.path }),
        ...(args.sha === undefined ? {} : { sha: args.sha }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'List commits', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_commit_get',
    description: 'Read one commit with its changed files and per-file patches.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      sha: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sha: { type: 'string', required: true },
          message: { type: 'string', required: true },
          author_name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          author_date: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          html_url: { type: 'string', required: true },
          files: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { filename: { type: 'string', required: true }, status: { type: 'string', required: true }, additions: { type: 'integer' }, deletions: { type: 'integer' }, changes: { type: 'integer' }, patch: { type: 'string' } } } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Commit ${value.sha.slice(0, 7)}: ${value.message}` }],
    },
    async execute(args) {
      return github.getCommit({ owner: args.owner, repo: args.repo, sha: args.sha })
    },
    presentCall: args => ({ card: 'generic', title: 'Get commit', rawInput: { owner: args.owner, repo: args.repo, sha: args.sha } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_branches',
    description: 'List branches of a repository.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      limit: { type: 'integer', description: 'Max entries (default 30).' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            protected: { type: 'boolean', required: true },
            commit_sha: { type: 'string', required: true },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} branch(es)` }],
    },
    async execute(args) {
      return github.listBranches({ owner: args.owner, repo: args.repo, ...(args.limit === undefined ? {} : { limit: args.limit }) })
    },
    presentCall: args => ({ card: 'generic', title: 'List branches', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_branch_get',
    description: 'Read one branch with its protection settings (status checks, required reviews).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      branch: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          protected: { type: 'boolean', required: true },
          commit_sha: { type: 'string', required: true },
          protection_enabled: { type: 'boolean', required: true },
          required_status_checks: { type: 'array', required: true, items: { type: 'string' } },
          required_reviews: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Branch ${value.name} at ${value.commit_sha.slice(0, 7)}` }],
    },
    async execute(args) {
      return github.getBranch({ owner: args.owner, repo: args.repo, branch: args.branch })
    },
    presentCall: args => ({ card: 'generic', title: 'Get branch', rawInput: { owner: args.owner, repo: args.repo, branch: args.branch } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_tags',
    description: 'List git tags of a repository.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      limit: { type: 'integer', description: 'Max entries (default 30).' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            commit_sha: { type: 'string', required: true },
            zipball_url: { type: 'string' },
            tarball_url: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} tag(s)` }],
    },
    async execute(args) {
      return github.listTags({ owner: args.owner, repo: args.repo, ...(args.limit === undefined ? {} : { limit: args.limit }) })
    },
    presentCall: args => ({ card: 'generic', title: 'List tags', rawInput: { owner: args.owner, repo: args.repo } }),
  }))


  ctx.tools.register(defineTool({
    name: 'github_repo_edit',
    description:
      'Edit safe repository metadata (description, homepage, topics, feature toggles). '
      + 'Visibility changes are intentionally not supported.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      description: { type: 'string' },
      homepage: { type: 'string' },
      topics: { type: 'array', items: { type: 'string' } },
      has_issues: { type: 'boolean' },
      has_wiki: { type: 'boolean' },
      has_projects: { type: 'boolean' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'integer', required: true },
          name: { type: 'string', required: true },
          full_name: { type: 'string', required: true },
          private: { type: 'boolean', required: true },
          html_url: { type: 'string', required: true },
          clone_url: { type: 'string' },
          ssh_url: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Updated ${value.full_name}` }],
    },
    async execute(args) {
      return github.editRepo({
        owner: args.owner,
        repo: args.repo,
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.homepage === undefined ? {} : { homepage: args.homepage }),
        ...(args.topics === undefined ? {} : { topics: args.topics }),
        ...(args.has_issues === undefined ? {} : { has_issues: args.has_issues }),
        ...(args.has_wiki === undefined ? {} : { has_wiki: args.has_wiki }),
        ...(args.has_projects === undefined ? {} : { has_projects: args.has_projects }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Edit GitHub repo', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_fork',
    description: 'Fork a repository into the authenticated user\'s account (useful before contributing).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'integer', required: true },
          name: { type: 'string', required: true },
          full_name: { type: 'string', required: true },
          private: { type: 'boolean', required: true },
          html_url: { type: 'string', required: true },
          clone_url: { type: 'string' },
          ssh_url: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Forked to ${value.full_name}` }],
    },
    async execute(args) {
      return github.forkRepo({ owner: args.owner, repo: args.repo })
    },
    presentCall: args => ({ card: 'generic', title: 'Fork GitHub repo', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_file_write',
    description:
      'Create or update a single file via the GitHub contents API (creates a commit). '
      + 'Provide sha (from github_content / github_repo_tree) when updating an existing file.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      path: { type: 'string', required: true, description: 'File path to write (e.g. docs/api.md).' },
      content: { type: 'string', required: true, description: 'New file content (UTF-8).' },
      message: { type: 'string', required: true, description: 'Commit message.' },
      sha: { type: 'string', description: 'Current blob sha; required to update an existing file.' },
      branch: { type: 'string', description: 'Branch to commit to; defaults to the default branch.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          commitSha: { type: 'string', required: true },
          commitMessage: { type: 'string', required: true },
          commitUrl: { type: 'string', required: true },
          path: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Committed ${value.path} -> ${value.commitSha.slice(0, 7)}` }],
    },
    async execute(args) {
      return github.writeFile({
        owner: args.owner,
        repo: args.repo,
        path: args.path,
        content: args.content,
        message: args.message,
        ...(args.sha === undefined ? {} : { sha: args.sha }),
        ...(args.branch === undefined ? {} : { branch: args.branch }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Write GitHub file', rawInput: { owner: args.owner, repo: args.repo, path: args.path } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_issue_create',
    description: 'Create an issue in a repository.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      title: { type: 'string', required: true },
      body: { type: 'string', description: 'Issue body (markdown).' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Label names.' },
      assignees: { type: 'array', items: { type: 'string' }, description: 'Usernames to assign.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          number: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          state: { type: 'string', required: true },
          html_url: { type: 'string', required: true },
          user_login: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          labels: { type: 'array', items: { type: 'string' } },
          body: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Issue #${value.number}: ${value.title}` }],
    },
    async execute(args) {
      return github.createIssue({
        owner: args.owner,
        repo: args.repo,
        title: args.title,
        ...(args.body === undefined ? {} : { body: args.body }),
        ...(args.labels === undefined ? {} : { labels: args.labels }),
        ...(args.assignees === undefined ? {} : { assignees: args.assignees }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Create GitHub issue', rawInput: { owner: args.owner, repo: args.repo, title: args.title } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_issues',
    description:
      'List issues of a repository (note: pull requests also appear; GitHub treats PRs as issues).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Defaults to open.' },
      labels: { type: 'string', description: 'Comma-separated label names.' },
      assignee: { type: 'string', description: 'Username; use "none" for unassigned.' },
      creator: { type: 'string', description: 'Username.' },
      sort: { type: 'string', enum: ['created', 'updated', 'comments'], description: 'Defaults to created.' },
      limit: { type: 'integer', description: 'Max entries (default 30).' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            number: { type: 'integer', required: true },
            title: { type: 'string', required: true },
            state: { type: 'string', required: true },
            html_url: { type: 'string', required: true },
            user_login: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            labels: { type: 'array', items: { type: 'string' } },
            body: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            created_at: { type: 'string' },
            updated_at: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} issue(s)` }],
    },
    async execute(args) {
      return github.listIssues({
        owner: args.owner,
        repo: args.repo,
        ...(args.state === undefined ? {} : { state: args.state }),
        ...(args.labels === undefined ? {} : { labels: args.labels }),
        ...(args.assignee === undefined ? {} : { assignee: args.assignee }),
        ...(args.creator === undefined ? {} : { creator: args.creator }),
        ...(args.sort === undefined ? {} : { sort: args.sort }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'List GitHub issues', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_issue_get',
    description: 'Read one issue by number.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      number: { type: 'integer', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          number: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          state: { type: 'string', required: true },
          html_url: { type: 'string', required: true },
          user_login: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          labels: { type: 'array', items: { type: 'string' } },
          body: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Issue #${value.number}: ${value.title}` }],
    },
    async execute(args) {
      return github.getIssue({ owner: args.owner, repo: args.repo, number: args.number })
    },
    presentCall: args => ({ card: 'generic', title: 'Get GitHub issue', rawInput: { owner: args.owner, repo: args.repo, number: args.number } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_issue_comment',
    description:
      'Comment on an issue or a pull request (PRs are issues on GitHub). '
      + 'Use github_review for formal review events.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      number: { type: 'integer', required: true, description: 'Issue or PR number.' },
      body: { type: 'string', required: true, description: 'Comment body (markdown).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'integer', required: true },
          body: { type: 'string', required: true },
          user_login: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          created_at: { type: 'string' },
          html_url: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Commented on #${value.id}` }],
    },
    async execute(args) {
      return github.commentOnIssue({ owner: args.owner, repo: args.repo, number: args.number, body: args.body })
    },
    presentCall: args => ({ card: 'generic', title: 'Comment on GitHub issue/PR', rawInput: { owner: args.owner, repo: args.repo, number: args.number } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_releases',
    description: 'List releases of a repository.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      limit: { type: 'integer', description: 'Max entries (default 30).' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'integer', required: true },
            tag_name: { type: 'string', required: true },
            name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            draft: { type: 'boolean', required: true },
            prerelease: { type: 'boolean', required: true },
            html_url: { type: 'string', required: true },
            body: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            published_at: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            target_commitish: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} release(s)` }],
    },
    async execute(args) {
      return github.listReleases({ owner: args.owner, repo: args.repo, ...(args.limit === undefined ? {} : { limit: args.limit }) })
    },
    presentCall: args => ({ card: 'generic', title: 'List GitHub releases', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_release_create',
    description:
      'Create a release (draft supported; the tag is created when it does not exist).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      tag_name: { type: 'string', required: true, description: 'Tag name, e.g. v1.0.0.' },
      target_commitish: { type: 'string', description: 'Commit/branch the tag points to; defaults to the default branch.' },
      name: { type: 'string', description: 'Release title; defaults to the tag name.' },
      body: { type: 'string', description: 'Release notes (markdown).' },
      draft: { type: 'boolean', description: 'Create as a draft (not public).' },
      prerelease: { type: 'boolean', description: 'Mark as a prerelease.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'integer', required: true },
          tag_name: { type: 'string', required: true },
          name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          draft: { type: 'boolean', required: true },
          prerelease: { type: 'boolean', required: true },
          html_url: { type: 'string', required: true },
          body: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          published_at: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          target_commitish: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Release ${value.tag_name}${value.draft ? ' (draft)' : ''}: ${value.html_url}` }],
    },
    async execute(args) {
      return github.createRelease({
        owner: args.owner,
        repo: args.repo,
        tag_name: args.tag_name,
        ...(args.target_commitish === undefined ? {} : { target_commitish: args.target_commitish }),
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.body === undefined ? {} : { body: args.body }),
        ...(args.draft === undefined ? {} : { draft: args.draft }),
        ...(args.prerelease === undefined ? {} : { prerelease: args.prerelease }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Create GitHub release', rawInput: { owner: args.owner, repo: args.repo, tag_name: args.tag_name } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_workflows',
    description: 'List workflows of a repository (ids/paths for github_workflow_dispatch).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'integer', required: true },
            name: { type: 'string', required: true },
            path: { type: 'string', required: true },
            state: { type: 'string', required: true },
            html_url: { type: 'string', required: true },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} workflow(s)` }],
    },
    async execute(args) {
      return github.listWorkflows({ owner: args.owner, repo: args.repo })
    },
    presentCall: args => ({ card: 'generic', title: 'List GitHub workflows', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_workflow_jobs',
    description: 'Jobs (with steps and conclusions) of one workflow run — failure diagnosis.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      runId: { type: 'integer', required: true },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'integer', required: true },
            name: { type: 'string', required: true },
            status: { type: 'string', required: true },
            conclusion: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            html_url: { type: 'string', required: true },
            started_at: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            completed_at: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            steps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { number: { type: 'integer' }, name: { type: 'string' }, status: { type: 'string' }, conclusion: { oneOf: [{ type: 'string' }, { type: 'null' }] } } } },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.length} job(s)` }],
    },
    async execute(args) {
      return github.listWorkflowJobs({ owner: args.owner, repo: args.repo, runId: args.runId })
    },
    presentCall: args => ({ card: 'generic', title: 'List workflow jobs', rawInput: { owner: args.owner, repo: args.repo, runId: args.runId } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_secrets',
    description:
      'List Actions secret NAMES of a repository (values are never exposed by GitHub or this tool).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            created_at: { type: 'string' },
            updated_at: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.length} secret name(s)` }],
    },
    async execute(args) {
      return github.listSecrets({ owner: args.owner, repo: args.repo })
    },
    presentCall: args => ({ card: 'generic', title: 'List Actions secrets', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_clone',
    description:
      'Clone a repository into a directory (defaults to ./<repo-name> under the host cwd). '
      + 'Completes the fork -> clone -> edit -> push -> PR contribution loop.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      dir: { type: 'string', description: 'Target directory; defaults to the repo name.' },
      branch: { type: 'string', description: 'Branch to check out; defaults to the default branch.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cloned: { type: 'boolean', required: true },
          dir: { type: 'string', required: true },
          branch: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Cloned -> ${value.dir} (branch ${value.branch})` }],
    },
    async execute(args, exec) {
      return github.clone({
        owner: args.owner,
        repo: args.repo,
        ...(args.dir === undefined ? {} : { dir: args.dir }),
        ...(args.branch === undefined ? {} : { branch: args.branch }),
        ...(exec.agent?.session === undefined ? {} : { session: exec.agent.session }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Clone GitHub repo', rawInput: { owner: args.owner, repo: args.repo } }),
  }))


}
