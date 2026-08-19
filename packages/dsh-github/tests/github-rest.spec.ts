import { afterEach, describe, expect, it, vi } from 'vitest'
import { GithubError, buildGithubQuery, decodeBase64Content, encodeGithubPath, githubRequest, githubRequestBuffer } from '../src/github-rest.ts'

describe('githubRequest', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends an authorized request and returns parsed json', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ login: 'octocat' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const value = await githubRequest<{ login: string }>({
      method: 'GET', path: '/user', token: 't', apiBase: 'https://api.github.com',
    })

    expect(value).toEqual({ login: 'octocat' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/user', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer t' }),
    }))
  })

  it('throws AUTH_FAILED on a 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad credentials', { status: 401 })))
    await expect(githubRequest({ method: 'GET', path: '/user', token: 't', apiBase: 'https://api.github.com' }))
      .rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('throws a GithubError on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(githubRequest({ method: 'GET', path: '/x', token: 't', apiBase: 'https://api.github.com' }))
      .rejects.toBeInstanceOf(GithubError)
  })

  it('never echoes the token into the failure message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    const failure = await githubRequest({ method: 'GET', path: '/x', token: 'super-secret', apiBase: 'https://api.github.com' })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GithubError)
    expect((failure as Error).message).not.toContain('super-secret')
  })
})


describe('buildGithubQuery', () => {
  it('returns an empty string when nothing is defined', () => {
    expect(buildGithubQuery({ branch: undefined, status: null, per_page: '' })).toBe('')
  })

  it('encodes defined values and skips empty ones', () => {
    expect(buildGithubQuery({ branch: 'feat/x y', status: 'completed', per_page: 10, extra: undefined }))
      .toBe('?branch=feat%2Fx%20y&status=completed&per_page=10')
  })
})

describe('githubRequest 204 handling', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('resolves to undefined for a 204 No Content response (workflow dispatch)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    const value = await githubRequest<undefined>({
      method: 'POST', path: '/repos/o/r/actions/workflows/ci.yml/dispatches', token: 't', apiBase: 'https://api.github.com',
    })
    expect(value).toBeUndefined()
  })
})

describe('githubRequestBuffer', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('downloads raw bytes with the Authorization header and no token echo on failure', async () => {
    const bytes = new TextEncoder().encode('PK\x03\x04fake-zip')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/zip' } })))
    const buffer = await githubRequestBuffer({
      method: 'GET', path: '/repos/o/r/actions/artifacts/42/zip', token: 'super-secret', apiBase: 'https://api.github.com',
    })
    expect(Buffer.from(buffer).toString('utf8')).toBe('PK\x03\x04fake-zip')
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/repos/o/r/actions/artifacts/42/zip', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer super-secret' }),
    }))
  })

  it('throws AUTH_FAILED on a 401 without echoing the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    const failure = await githubRequestBuffer({ method: 'GET', path: '/x', token: 'super-secret', apiBase: 'https://api.github.com' })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GithubError)
    expect((failure as GithubError).code).toBe('AUTH_FAILED')
    expect((failure as Error).message).not.toContain('super-secret')
  })
})


describe('encodeGithubPath', () => {
  it('preserves slashes and encodes each segment', () => {
    expect(encodeGithubPath('src/index.ts')).toBe('src/index.ts')
    expect(encodeGithubPath('a b/c.md')).toBe('a%20b/c.md')
    expect(encodeGithubPath('x/y#1')).toBe('x/y%231')
  })
})

describe('decodeBase64Content', () => {
  it('decodes base64 to utf-8', () => {
    expect(decodeBase64Content(Buffer.from('# Hello').toString('base64'), 'base64')).toBe('# Hello')
  })

  it('passes through non-base64 payloads untouched', () => {
    expect(decodeBase64Content('raw text', 'utf-8')).toBe('raw text')
  })

  it('falls back to the raw payload on invalid base64', () => {
    expect(decodeBase64Content('@@@not-base64@@@', 'base64')).toBe('@@@not-base64@@@')
  })
})
