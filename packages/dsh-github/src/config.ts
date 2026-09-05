/**
 * GitHub connector settings schema. The token field is a credential REFERENCE:
 * the value lives in the credentials seam (\`ctx.credentials\`), never in the
 * settings document. The namespace is registered host-side for local
 * persistence + hot reload; it is deliberately NOT exposed through the
 * apiproxy settings.describe allowlist — the Web UI reads/writes it through the
 * package's own Typert Remote methods instead.
 */
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { GithubConfigView } from 'dsh-connector-wire'

/** Settings namespace owned by this connector. */
export const GITHUB_SETTINGS_NAMESPACE = 'github' as SettingsNamespace

/** User-editable configuration. Dangerous operations default to off / are absent. */
export interface GithubConfig {
  /** Credential reference (env-style name) resolved per operation. */
  tokenEnv?: string
  /** GitHub API base URL (github.com or a GHES instance). */
  apiBase?: string
  /** git config user.name for authored commits. */
  gitName?: string
  /** git config user.email for authored commits. */
  gitEmail?: string
  /** Optional proxy URL for git network operations (http/s or socks), e.g. http://127.0.0.1:7897. */
  gitProxy?: string
  /** Default visibility for created repositories. */
  defaultVisibility?: 'private' | 'public'
  allowCreateRepo?: boolean
  allowPush?: boolean
  allowPull?: boolean
  allowPullRequest?: boolean
  allowReview?: boolean
  allowPages?: boolean
  allowActions?: boolean
  allowIssues?: boolean
  allowRelease?: boolean
}

/** Schemastery schema; defaults are the deployment-safe values. */
export const Config: Schema<GithubConfig> = Schema.object({
  tokenEnv: Schema.string().role('credential-ref').default('GITHUB_TOKEN'),
  apiBase: Schema.string().default('https://api.github.com'),
  gitName: Schema.string(),
  gitEmail: Schema.string(),
  gitProxy: Schema.string(),
  defaultVisibility: Schema.union(['private', 'public']).default('private'),
  allowCreateRepo: Schema.boolean().default(true),
  allowPush: Schema.boolean().default(true),
  allowPull: Schema.boolean().default(true),
  allowPullRequest: Schema.boolean().default(true),
  allowReview: Schema.boolean().default(true),
  allowPages: Schema.boolean().default(true),
  allowActions: Schema.boolean().default(true),
  allowIssues: Schema.boolean().default(true),
  allowRelease: Schema.boolean().default(true),
})

export type { GithubConfigView } from 'dsh-connector-wire'

/** Resolve the currently authoritative config into the wire view. */
export function toConfigView(config: GithubConfig): GithubConfigView {
  return {
    apiBase: config.apiBase ?? 'https://api.github.com',
    gitName: config.gitName ?? '',
    gitEmail: config.gitEmail ?? '',
    gitProxy: config.gitProxy ?? '',
    defaultVisibility: config.defaultVisibility ?? 'private',
    allowCreateRepo: config.allowCreateRepo ?? true,
    allowPush: config.allowPush ?? true,
    allowPull: config.allowPull ?? true,
    allowPullRequest: config.allowPullRequest ?? true,
    allowReview: config.allowReview ?? true,
    allowPages: config.allowPages ?? true,
    allowActions: config.allowActions ?? true,
    allowIssues: config.allowIssues ?? true,
    allowRelease: config.allowRelease ?? true,
  }
}
