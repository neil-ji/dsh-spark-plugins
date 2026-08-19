/**
 * Pure git/shell helpers for the GitHub connector (kept side-effect free
 * so unit tests can exercise them without a Cordis context).
 */

/** Quote a value for safe embedding inside a POSIX shell command string. */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

/**
 * Derive the git host from an apiBase URL: github.com for api.github.com,
 * or the bare host for a GHES instance (stripping any /api or /api/v3 suffix).
 * @param apiBase - the configured GitHub API base URL.
 * @returns the git host used in remote/clone URLs.
 */
export function gitHostFromApiBase(apiBase: string): string {
  const base = apiBase.replace(/^https:\/\//, '').replace(/\/$/, '')
  if (base === 'api.github.com') return 'github.com'
  return base.replace(/\/api\/v3$/, '').replace(/\/api$/, '')
}

/**
 * Build `-c http.proxy=... -c https.proxy=...` flags for git network commands.
 * Command-scope config overrides any http.proxy in the user's git config.
 * Empty string when no proxy is configured.
 * @param proxy - proxy URL (http(s) or socks), or undefined/empty for none.
 */
export function gitProxyArgs(proxy: string | undefined): string {
  if (proxy === undefined || proxy === '') return ''
  return `-c http.proxy=${shellQuote(proxy)} -c https.proxy=${shellQuote(proxy)} `
}
/** Public repo used by the proxy health probe (no auth required). */
export const PROXY_PROBE_REPO = 'https://github.com/git/git.git'

/**
 * Build the git ls-remote command that probes a proxy: disables the
 * credential helper (the target is public), bounds connect/transfer timeouts
 * so a dead proxy fails fast, and asks for a single HEAD ref.
 * @param proxy - proxy URL (http(s) or socks).
 */
export function gitProxyProbeCommand(proxy: string): string {
  return [
    'git',
    gitProxyArgs(proxy).trimEnd(),
    '-c credential.helper=',
    '-c http.connectTimeout=10',
    '-c http.lowSpeedLimit=1000',
    '-c http.lowSpeedTime=10',
    'ls-remote',
    shellQuote(PROXY_PROBE_REPO),
    'HEAD',
  ].filter(Boolean).join(' ')
}
/**
 * Parse owner/repo out of a git remote URL (https, https+token, or ssh form).
 * @param url - the remote URL reported by git.
 * @returns owner and repo, or undefined when the URL cannot be parsed.
 */
export function parseRemoteOwnerRepo(url: string): { owner: string; repo: string } | undefined {
  const trimmed = url.trim()
  if (trimmed === '') return undefined
  // ssh form: git@host:owner/repo.git
  if (!/^https?:\/\//.test(trimmed) && trimmed.includes(':')) {
    return splitOwnerRepo(trimmed.slice(trimmed.indexOf(':') + 1))
  }
  // https form: https://[token@]host/owner/repo[.git]
  const noProtocol = trimmed.replace(/^https?:\/\//, '')
  const noAuth = noProtocol.replace(/^[^@/]+@/, '')
  return splitOwnerRepo(noAuth.replace(/^[^/]+\//, ''))
}

function splitOwnerRepo(path: string): { owner: string; repo: string } | undefined {
  const normalized = path.replace(/\.git$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length < 2) return undefined
  return { owner: parts[0], repo: parts[parts.length - 1] }
}
