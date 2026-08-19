/**
 * Minimal GitHub REST client over Node fetch. All requests are authenticated
 * with the resolved token; error messages never echo the token.
 */
import type { GithubUser } from './types.ts'

/** Stable connector failure with a machine-readable code. */
export class GithubError extends Error {
  constructor(
    readonly code: 'MISSING_CREDENTIAL' | 'OPERATION_FORBIDDEN' | 'AUTH_FAILED' | 'REQUEST_FAILED',
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GithubError'
  }
}

/** GitHub REST response envelope for one request. */
export interface GithubRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  token: string
  apiBase: string
  body?: unknown
}

/**
 * Build a URL query string from defined string/number values.
 * @param params - query parameters; undefined/null/empty values are skipped.
 * @returns the query string including the leading '?', or '' when empty.
 */
export function buildGithubQuery(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params)
    .filter((entry): entry is [string, string | number] =>
      entry[1] !== undefined && entry[1] !== null && entry[1] !== '')
  if (entries.length === 0) return ''
  return '?' + entries.map(([key, value]) => key + '=' + encodeURIComponent(String(value))).join('&')
}

/**
 * Encode a repository-relative path into a URL-safe contents path
 * (each segment is percent-encoded, slashes preserved).
 * @param repoPath - path like src/index.ts or a/b c.md.
 * @returns the encoded path safe to interpolate into a REST URL.
 */
export function encodeGithubPath(repoPath: string): string {
  return repoPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

/**
 * Decode a base64 contents/readme payload into UTF-8 text.
 * @param content - base64 payload from the contents API.
 * @param encoding - reported encoding (base64 expected).
 * @returns the decoded UTF-8 text, or the raw payload when not base64.
 */
export function decodeBase64Content(content: string, encoding: string): string {
  if (encoding !== 'base64') return content
  // Node's base64 decoder is lenient (never throws); reject payloads that are
  // not well-formed base64 so binary/garbage data surfaces as-is.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) return content
  try {
    return Buffer.from(content, 'base64').toString('utf8')
  } catch {
    return content
  }
}

/** Shared request headers; the token only ever lives in this header. */
function authHeaders(token: string, body: unknown): Record<string, string> {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'dsh-connector-github',
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }
}

/**
 * Perform one authenticated GitHub API request.
 * @param options - method, path, token, base url and optional JSON body.
 * @returns the parsed JSON value, or undefined for 204/empty responses.
 */
export async function githubRequest<T>(options: GithubRequestOptions): Promise<T> {
  const { method, path, token, apiBase, body } = options
  let response: Response
  try {
    response = await fetch(apiBase + path, {
      method,
      headers: authHeaders(token, body),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    throw new GithubError('REQUEST_FAILED', 'github request to ' + path + ' failed: ' + String(error))
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new GithubError(
      response.status === 401 ? 'AUTH_FAILED' : 'REQUEST_FAILED',
      'GitHub ' + path + ' responded ' + response.status + ': ' + text.slice(0, 500),
      response.status,
    )
  }
  // 204 No Content (e.g. workflow dispatch) and empty bodies resolve to undefined.
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T
  }
  return response.json() as Promise<T>
}

/**
 * Download one authenticated GitHub API resource as raw bytes (binary-safe,
 * e.g. the Actions artifact zip). The token stays in the Authorization header
 * and is never echoed into errors.
 * @param options - method (GET), path, token and api base.
 * @returns the response body as an ArrayBuffer.
 */
export async function githubRequestBuffer(options: GithubRequestOptions): Promise<ArrayBuffer> {
  const { method, path, token, apiBase, body } = options
  let response: Response
  try {
    response = await fetch(apiBase + path, {
      method,
      headers: authHeaders(token, body),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    throw new GithubError('REQUEST_FAILED', 'github download ' + path + ' failed: ' + String(error))
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new GithubError(
      response.status === 401 ? 'AUTH_FAILED' : 'REQUEST_FAILED',
      'GitHub ' + path + ' responded ' + response.status + ': ' + text.slice(0, 500),
      response.status,
    )
  }
  return response.arrayBuffer()
}

/**
 * Fetch the authenticated /user identity (connection test), including the
 * classic-PAT scopes from the X-OAuth-Scopes response header (not part of the
 * JSON body). githubRequest cannot surface response headers, so this performs
 * its own fetch; the token stays in the Authorization header only.
 */
export async function fetchWhoami(apiBase: string, token: string): Promise<GithubUser> {
  let response: Response
  try {
    response = await fetch(apiBase + '/user', { method: 'GET', headers: authHeaders(token, undefined) })
  } catch (error) {
    throw new GithubError('REQUEST_FAILED', 'github request to /user failed: ' + String(error))
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new GithubError(
      response.status === 401 ? 'AUTH_FAILED' : 'REQUEST_FAILED',
      'GitHub /user responded ' + response.status + ': ' + text.slice(0, 500),
      response.status,
    )
  }
  const user = await response.json() as Omit<GithubUser, 'scopes'>
  const scopesHeader = response.headers.get('x-oauth-scopes')
  const scopes = scopesHeader === null || scopesHeader.trim() === ''
    ? undefined
    : scopesHeader.split(',').map(scope => scope.trim()).filter(scope => scope !== '')
  return { ...user, ...(scopes === undefined ? {} : { scopes }) }
}
