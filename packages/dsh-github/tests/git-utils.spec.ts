import { describe, expect, it } from 'vitest'
import { gitHostFromApiBase, gitProxyArgs, gitProxyProbeCommand, parseRemoteOwnerRepo, shellQuote } from '../src/git-utils.ts'

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'")
  })

  it('escapes embedded single quotes for POSIX shell', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })
})

describe('gitHostFromApiBase', () => {
  it('maps api.github.com to github.com', () => {
    expect(gitHostFromApiBase('https://api.github.com')).toBe('github.com')
  })

  it('strips a GHES /api/v3 suffix', () => {
    expect(gitHostFromApiBase('https://github.example.com/api/v3')).toBe('github.example.com')
  })

  it('strips a GHES /api suffix', () => {
    expect(gitHostFromApiBase('https://github.example.com/api')).toBe('github.example.com')
  })
})

describe('parseRemoteOwnerRepo', () => {
  it('parses an https remote', () => {
    expect(parseRemoteOwnerRepo('https://github.com/octocat/hello.git')).toEqual({ owner: 'octocat', repo: 'hello' })
  })

  it('parses an https remote carrying a token', () => {
    expect(parseRemoteOwnerRepo('https://x-access-token:abc@github.com/octocat/hello.git')).toEqual({ owner: 'octocat', repo: 'hello' })
  })

  it('parses an ssh remote', () => {
    expect(parseRemoteOwnerRepo('git@github.com:octocat/hello.git')).toEqual({ owner: 'octocat', repo: 'hello' })
  })

  it('returns undefined for unparseable input', () => {
    expect(parseRemoteOwnerRepo('')).toBeUndefined()
    expect(parseRemoteOwnerRepo('octocat')).toBeUndefined()
  })
})

describe('gitProxyArgs', () => {
  it('returns empty flags without a proxy', () => {
    expect(gitProxyArgs(undefined)).toBe('')
    expect(gitProxyArgs('')).toBe('')
  })

  it('emits http.proxy and https.proxy flags for a proxy URL', () => {
    expect(gitProxyArgs('http://127.0.0.1:7897')).toBe("-c http.proxy='http://127.0.0.1:7897' -c https.proxy='http://127.0.0.1:7897' ")
  })

  it('shell-quotes a proxy URL containing a colon', () => {
    expect(gitProxyArgs('socks5://127.0.0.1:1080')).toContain("socks5://127.0.0.1:1080'")
  })
})

describe('gitProxyProbeCommand', () => {
  it('includes the proxy, disables the credential helper, and probes a public repo', () => {
    const cmd = gitProxyProbeCommand('http://127.0.0.1:7897')
    expect(cmd).toContain("http.proxy='http://127.0.0.1:7897'")
    expect(cmd).toContain('-c credential.helper=')
    expect(cmd).toContain('ls-remote')
    expect(cmd).toContain('https://github.com/git/git.git')
  })
})
