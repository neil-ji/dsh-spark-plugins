/**
 * dsh-github bundle entry: mounts the GitHubService (ctx.github) and registers
 * the model-facing tools. The Web UI half lives in the dsh-github-ui package.
 */
import type { Context } from '@deepseek-ai/cordis'
import { GITHUB_HOST_CONTRIBUTION } from 'dsh-connector-wire'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { GitHubService } from './github-service.ts'
import type { GithubConfig } from './config.ts'
import { registerGithubTools } from './tools.ts'

export { Config, GITHUB_SETTINGS_NAMESPACE, type GithubConfig, type GithubConfigView } from './config.ts'
export { GitHubService } from './github-service.ts'
export { GithubError } from './github-rest.ts'
export type {
  CloneRequest, CloneResult, CommentIssueRequest, CreateIssueRequest, CreateReleaseRequest,
  CreatePullRequest, CreateRepoRequest, CreateRepoResult, CreateReviewRequest,
  DownloadArtifactRequest, DownloadArtifactResult, EditRepoRequest, GetContentRequest,
  GetWorkflowRunRequest, GithubArtifact, GithubBranch, GithubBranchDetail, GithubCommit,
  GithubCommitDetail, GithubContent, GithubFileWriteResult, GithubIssue, GithubIssueComment,
  GithubJob, GithubPagesBuild, GithubPagesStatus, GithubPullRequest, GithubReadme,
  GithubRelease, GithubRepo, GithubRepoDetail, GithubSecretName, GithubTag,
  GithubTreeEntry, GithubUser, GithubWhoamiValue, GithubWorkflow, GithubWorkflowRun,
  ListIssuesRequest, ListRunArtifactsRequest, ListWorkflowRunsRequest,
  WriteFileRequest, WorkflowDispatchRequest,
} from './types.ts'

export const name = 'dsh-github'
export const inject = ['credentials', 'shell', 'tools', 'typert']

/**
 * Mount the GitHub connector on the host plane.
 * @param ctx - host context carrying credentials, shell and the tool registry.
 * @param config - entry config (base layer of the github settings namespace).
 */
export function apply(ctx: Context, config: GithubConfig): void {
  // Strict host-side Remote definitions: gateway resolves github/whoami etc.
  // against this registration instead of the source-marker fallback.
  ctx.typert.register(GITHUB_HOST_CONTRIBUTION)
  const github = new GitHubService(ctx, config)
  registerGithubTools(ctx, github)
}
