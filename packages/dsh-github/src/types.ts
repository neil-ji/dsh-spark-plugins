/** Wire-safe business types for the GitHub connector. */

/** GitHub REST /user projection. */
export interface GithubUser {
  login: string
  name: string | null
  html_url: string
  scopes?: string[]
}

/** GitHub REST repository projection. */
export interface GithubRepo {
  id: number
  name: string
  full_name: string
  private: boolean
  html_url: string
  clone_url: string
  ssh_url: string
}

/** GitHub REST pull-request projection (subset). */
export interface GithubPullRequest {
  number: number
  title: string
  state: string
  html_url: string
  head: { ref: string }
  base: { ref: string }
}

/** Agent-facing create-repository request. */
export interface CreateRepoRequest {
  name: string
  description?: string
  visibility?: 'private' | 'public'
}

/** Agent-facing create-repository result. */
export interface CreateRepoResult {
  fullName: string
  htmlUrl: string
  cloneUrl: string
  sshUrl: string
}

/** Agent-facing create-PR request. */
export interface CreatePullRequest {
  owner: string
  repo: string
  title: string
  head: string
  base: string
  body?: string
}

/** Agent-facing review request. */
export interface CreateReviewRequest {
  owner: string
  repo: string
  pullNumber: number
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  body?: string
}

/** One pull-request review comment (GitHub REST projection). */
export interface GithubPullComment {
  id: number
  path: string
  body: string
  user: { login: string }
  created_at: string
}

/** One file changed in a pull request (GitHub REST projection). */
export interface GithubPullFile {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
}

/** List pull requests for a repository. */
export interface ListPullsRequest {
  owner: string
  repo: string
  state?: 'open' | 'closed' | 'all'
}

/** Read one pull request. */
export interface GetPullRequest {
  owner: string
  repo: string
  number: number
}

/** Wire value returned by the github/proxy.test Remote method. */
export interface GithubProxyTestValue {
  ok: boolean
  latencyMs: number
  host: string
  error: string | null
}

/** Wire value returned by the github/whoami Remote method. */
export interface GithubWhoamiValue {
  login: string
  name: string | null
  htmlUrl: string
  scopes: string[]
  apiBase: string
}

/** GitHub Pages site configuration/status projection. */
export interface GithubPagesStatus {
  html_url: string
  status: string | null
  cname: string | null
  source?: { branch: string; path: string }
  build_type?: string
}

/** One GitHub Pages build (as returned by POST /pages/builds). */
export interface GithubPagesBuild {
  url: string
  status: string
  error: { message: string } | null
}

/** Agent-facing workflow dispatch request (POST /actions/workflows/{id}/dispatches). */
export interface WorkflowDispatchRequest {
  owner: string
  repo: string
  /** Workflow id or workflow file name (e.g. 'ci.yml' or '12345'). */
  workflowId: string
  /** Branch/tag/SHA to run the workflow on (default: repository default branch). */
  ref?: string
  /** workflow_dispatch inputs, JSON-serializable values. */
  inputs?: Record<string, string>
}

/** GitHub Actions workflow-run projection (subset). */
export interface GithubWorkflowRun {
  id: number
  name: string | null
  display_title: string | null
  status: string
  conclusion: string | null
  html_url: string
  head_branch: string | null
  head_sha: string
  run_number: number
  event: string
  created_at: string
  updated_at: string
}

/** Agent-facing list-workflow-runs request. */
export interface ListWorkflowRunsRequest {
  owner: string
  repo: string
  /** Workflow id or file name; omit to list all workflows. */
  workflowId?: string
  branch?: string
  status?: 'queued' | 'in_progress' | 'completed' | 'success' | 'failure' | 'cancelled' | 'skipped'
  /** Max entries (default 10). */
  limit?: number
}

/** Read one workflow run. */
export interface GetWorkflowRunRequest {
  owner: string
  repo: string
  runId: number
}

/** GitHub Actions artifact projection. */
export interface GithubArtifact {
  id: number
  name: string
  size_in_bytes: number
  archive_download_url?: string
  expired: boolean
  created_at: string
}

/** List artifacts produced by a run. */
export interface ListRunArtifactsRequest {
  owner: string
  repo: string
  runId: number
}

/** Agent-facing artifact download request. */
export interface DownloadArtifactRequest {
  owner: string
  repo: string
  artifactId: number
  /** Output file path (absolute, or relative to the host cwd); defaults to <cwd>/<artifact-name>.zip. */
  dest?: string
}

/** Result of a successful artifact download. */
export interface DownloadArtifactResult {
  artifactId: number
  name: string
  sizeBytes: number
  savedTo: string
}


// ── repo / content (read + safe write) ───────────────────────────────────────

/** Rich repository detail (GET /repos/{owner}/{repo}). */
export interface GithubRepoDetail {
  id: number
  name: string
  full_name: string
  private: boolean
  html_url: string
  clone_url: string
  ssh_url: string
  description: string | null
  homepage: string | null
  default_branch: string
  visibility: string
  language: string | null
  topics: string[]
  fork: boolean
  archived: boolean
  open_issues_count: number
  stargazers_count: number
  forks_count: number
  pushed_at: string
  updated_at: string
}

/** One directory entry returned by the contents API. */
export interface GithubContentEntry {
  type: string
  name: string
  path: string
  sha: string
  size: number
  url: string
}

/** One file returned by the contents API (content is base64). */
export interface GithubContentFile {
  type: string
  name: string
  path: string
  sha: string
  size: number
  download_url: string | null
  content: string
  encoding: string
  truncated: boolean
}

/** Read a repo path: a file, or the entry list of a directory. */
export type GithubContent = GithubContentFile | GithubContentEntry[]

/** Agent-facing content read. */
export interface GetContentRequest {
  owner: string
  repo: string
  /** File or directory path inside the repository (e.g. src/index.ts). */
  path: string
  /** Branch/ref to read from; defaults to the default branch. */
  ref?: string
}

/** One entry of a recursive git tree. */
export interface GithubTreeEntry {
  path: string
  type: string
  mode: string
  size: number | null
  sha: string
}

/** Repo readme (content is base64). */
export interface GithubReadme {
  name: string
  path: string
  content: string
  encoding: string
  html_url: string
  download_url: string | null
}

/** One commit in a list (no diff). */
export interface GithubCommit {
  sha: string
  message: string
  author_name: string | null
  author_login: string | null
  author_date: string | null
  html_url: string
}

/** One file changed by a commit (patch omitted by default). */
export interface GithubCommitFile {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
}

/** One commit with its changed files. */
export interface GithubCommitDetail {
  sha: string
  message: string
  author_name: string | null
  author_date: string | null
  html_url: string
  files: GithubCommitFile[]
}

/** One branch (list projection). */
export interface GithubBranch {
  name: string
  protected: boolean
  commit_sha: string
}

/** One branch (detail projection with protection). */
export interface GithubBranchDetail extends GithubBranch {
  protection_enabled: boolean
  required_status_checks: string[]
  required_reviews: number | null
}

/** One git tag. */
export interface GithubTag {
  name: string
  commit_sha: string
  zipball_url: string
  tarball_url: string
}

/** Agent-facing repo metadata edit (safe fields only; no visibility change). */
export interface EditRepoRequest {
  owner: string
  repo: string
  description?: string
  homepage?: string
  topics?: string[]
  has_issues?: boolean
  has_wiki?: boolean
  has_projects?: boolean
}

/** Agent-facing single-file write (creates a commit via the API). */
export interface WriteFileRequest {
  owner: string
  repo: string
  path: string
  content: string
  message: string
  /** Blob sha of the existing file; required to update, omit to create. */
  sha?: string
  /** Branch to commit to; defaults to the default branch. */
  branch?: string
}

/** Result of a successful contents write. */
export interface GithubFileWriteResult {
  commitSha: string
  commitMessage: string
  commitUrl: string
  path: string
}

// ── issues ───────────────────────────────────────────────────────────────────

/** One issue (PRs are issues too on GitHub). */
export interface GithubIssue {
  number: number
  title: string
  state: string
  html_url: string
  user_login: string | null
  labels: string[]
  body: string | null
  created_at: string
  updated_at: string
}

/** One issue/PR comment. */
export interface GithubIssueComment {
  id: number
  body: string
  user_login: string | null
  created_at: string
  html_url: string
}

/** Agent-facing list-issues request. */
export interface ListIssuesRequest {
  owner: string
  repo: string
  state?: 'open' | 'closed' | 'all'
  labels?: string
  assignee?: string
  creator?: string
  sort?: 'created' | 'updated' | 'comments'
  limit?: number
}

/** Agent-facing create-issue request. */
export interface CreateIssueRequest {
  owner: string
  repo: string
  title: string
  body?: string
  labels?: string[]
  assignees?: string[]
}

/** Agent-facing issue/PR comment request. */
export interface CommentIssueRequest {
  owner: string
  repo: string
  number: number
  body: string
}

// ── releases ─────────────────────────────────────────────────────────────────

/** One release. */
export interface GithubRelease {
  id: number
  tag_name: string
  name: string | null
  draft: boolean
  prerelease: boolean
  html_url: string
  body: string | null
  published_at: string | null
  target_commitish: string | null
}

/** Agent-facing create-release request. */
export interface CreateReleaseRequest {
  owner: string
  repo: string
  tag_name: string
  target_commitish?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
}

// ── actions (extended) ───────────────────────────────────────────────────────

/** One workflow (list projection). */
export interface GithubWorkflow {
  id: number
  name: string
  path: string
  state: string
  html_url: string
}

/** One job within a run. */
export interface GithubJobStep {
  number: number
  name: string
  status: string
  conclusion: string | null
}

/** One job of a workflow run. */
export interface GithubJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  html_url: string
  started_at: string | null
  completed_at: string | null
  steps: GithubJobStep[]
}

/** One Actions secret (name only; values are never exposed). */
export interface GithubSecretName {
  name: string
  created_at: string
  updated_at: string
}

// ── git: clone ───────────────────────────────────────────────────────────────

/** Agent-facing clone request. */
export interface CloneRequest {
  owner: string
  repo: string
  /** Target directory (relative to the host cwd); defaults to the repo name. */
  dir?: string
  /** Branch to check out; defaults to the default branch. */
  branch?: string
  session?: unknown
}

/** Result of a successful clone. */
export interface CloneResult {
  cloned: true
  dir: string
  branch: string
}