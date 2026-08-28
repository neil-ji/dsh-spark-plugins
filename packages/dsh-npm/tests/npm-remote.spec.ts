import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { NpmService, firstReleaseScript } from '../src/npm-service.ts'

function createService(): NpmService {
  return new NpmService(new Context())
}

/** Stub the token resolution so resolveToken returns a value. */
function withStoredToken(svc: NpmService, token: string): void {
  svc.resolveToken = async () => token
}

describe('firstReleaseScript', () => {
  it('builds npm publish + npm trust with 2FA comment', () => {
    const script = firstReleaseScript({ pkg: 'my-lib', repository: 'octo/my-lib' })
    expect(script).toContain('# 首次发布 + OIDC trust(浏览器 2FA,每条确认一次)')
    expect(script).toContain('cd "my-lib"')
    expect(script).toContain('npm publish')
    expect(script).toContain('npm trust github my-lib --file release.yml --repository octo/my-lib --allow-publish -y')
  })

  it('honors dir and workflowFile overrides', () => {
    const script = firstReleaseScript({ pkg: 'my-lib', repository: 'octo/my-lib', dir: './pkg', workflowFile: 'ci.yml' })
    expect(script).toContain('cd "./pkg"')
    expect(script).toContain('--file ci.yml')
  })
})

describe('NpmService Remote methods', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('statusRemote reports all four kit packages with ok=true', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const name = decodeURIComponent(url.split('/').pop() ?? '')
      return new Response(JSON.stringify({
        name, 'dist-tags': { latest: '0.1.0' }, versions: {},
      }), { status: 200 })
    }))
    const svc = createService()
    const status = await svc.statusRemote()
    expect(status.ok).toBe(true)
    expect(status.registry).toBe('https://registry.npmjs.org')
    expect(status.packages.map((p) => p.name)).toEqual([
      'dsh-connector-wire', 'dsh-connector-github-ui', 'dsh-connector-github', 'dsh-connector-npm',
    ])
    expect(status.packages.every((p) => p.exists && p.latest === '0.1.0')).toBe(true)
  })


  it('trustStatusRemote returns checkUrl for unpublished package', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })))
    const svc = createService()
    const result = await svc.trustStatusRemote({ pkg: 'free-name' })
    expect(result.exists).toBe(false)
    expect(result.verified).toBe(false)
    expect(result.trusts).toEqual([])
    expect(result.checkUrl).toBe('https://www.npmjs.com/package/free-name?tab=settings')
  })

  it('trustStatusRemote reads the trust list through the stored token', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/-/whoami')) {
        return new Response(JSON.stringify({ username: 'octo' }), { status: 200 })
      }
      if (String(url).includes('/trust')) {
        return new Response(JSON.stringify([
          { id: 't1', type: 'github', claims: { repository: 'octo/my-lib' }, permissions: ['createPackage'] },
        ]), { status: 200 })
      }
      // packument
      return new Response(JSON.stringify({ name: 'my-lib', versions: { '1.0.0': {} } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const svc = createService()
    withStoredToken(svc, 'npm_abc')
    const result = await svc.trustStatusRemote({ pkg: 'my-lib' })
    expect(result.exists).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.trusts).toHaveLength(1)
    expect(result.trusts[0].id).toBe('t1')
    expect(result.trusts[0].type).toBe('github')
  })

  it('trustStatusRemote reports verified=false when the trust endpoint refuses', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/-/whoami')) {
        return new Response(JSON.stringify({ username: 'octo' }), { status: 200 })
      }
      if (String(url).includes('/trust')) {
        return new Response('refused', { status: 403 })
      }
      return new Response(JSON.stringify({ name: 'my-lib', versions: { '1.0.0': {} } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const svc = createService()
    withStoredToken(svc, 'npm_abc')
    const result = await svc.trustStatusRemote({ pkg: 'my-lib' })
    expect(result.verified).toBe(false)
    expect(result.trusts).toEqual([])
  })

  it('tokenTestRemote succeeds with a draft token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ username: 'octo' }), { status: 200 })))
    const svc = createService()
    const result = await svc.tokenTestRemote({ draftToken: 'npm_draft' })
    expect(result.ok).toBe(true)
    expect(result.login).toBe('octo')
  })

  it('tokenTestRemote fails for an invalid draft token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })))
    const svc = createService()
    const result = await svc.tokenTestRemote({ draftToken: 'bad' })
    expect(result.ok).toBe(false)
    expect(result.login).toBeNull()
  })

  it('tokenTestRemote reports missing config without draft or stored token', async () => {
    const svc = createService()
    const result = await svc.tokenTestRemote({})
    expect(result.ok).toBe(false)
    expect(result.login).toBeNull()
  })

})

describe('NpmService token-driven management', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('setDistTag PUTs the JSON-encoded version to the dist-tags endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const svc = createService()
    await svc.setDistTag('my-lib', 'beta', '1.2.3-beta.1', 'tok')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://registry.npmjs.org/-/package/my-lib/dist-tags/beta')
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
    expect(init.body).toBe('"1.2.3-beta.1"')
  })

  it('setDistTag throws NpmOtpError when the registry demands a one-time pass', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'you must provide a one-time pass' }), { status: 401 },
    )))
    const svc = createService()
    await expect(svc.setDistTag('my-lib', 'beta', '1.2.3', 'tok')).rejects.toThrow('2FA')
  })

  it('removeDistTag DELETEs the tag endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const svc = createService()
    await svc.removeDistTag('my-lib', 'beta', 'tok')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://registry.npmjs.org/-/package/my-lib/dist-tags/beta')
    expect(init.method).toBe('DELETE')
  })

  it('buildTrustConfig builds a github config with claims + permissions', () => {
    const svc = createService()
    const config = svc.buildTrustConfig('github', { repository: 'octo/my-lib', file: 'release.yml' })
    expect(config.type).toBe('github')
    expect(config.claims).toMatchObject({ repository: 'octo/my-lib', workflow_ref: { file: 'release.yml' } })
    expect(config.permissions).toEqual(['createPackage'])
  })

  it('buildTrustConfig builds a circleci config with UUID claims', () => {
    const svc = createService()
    const config = svc.buildTrustConfig('circleci', {
      orgId: 'org-1', projectId: 'proj-1', pipelineDefinitionId: 'pipe-1', vcsOrigin: 'github.com/octo/my-lib',
      allowStagePublish: true,
    })
    expect(config.type).toBe('circleci')
    expect(config.claims['oidc.circleci.com/org-id']).toBe('org-1')
    expect(config.permissions).toEqual(['createPackage', 'createStagedPackage'])
  })

  it('createTrust POSTs an array body to the trust endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 't9' }]), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const svc = createService()
    const config = svc.buildTrustConfig('github', { repository: 'octo/my-lib' })
    const { id } = await svc.createTrust('my-lib', 'tok', config)
    expect(id).toBe('t9')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://registry.npmjs.org/-/package/my-lib/trust')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as unknown[]
    expect(body).toHaveLength(1)
    expect((body[0] as { type: string }).type).toBe('github')
  })

  it('revokeTrust DELETEs the trust id endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const svc = createService()
    await svc.revokeTrust('my-lib', 't9', 'tok')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://registry.npmjs.org/-/package/my-lib/trust/t9')
    expect(init.method).toBe('DELETE')
  })

  it('deprecate fetches the packument with write=true and PUTs it back', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (String(init?.method) === 'PUT') return new Response(null, { status: 200 })
      return new Response(JSON.stringify({
        _rev: '3-abc',
        name: 'my-lib',
        versions: { '1.0.0': {}, '1.0.1': {}, '2.0.0': {} },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const svc = createService()
    const result = await svc.deprecate('my-lib', { token: 'tok', message: 'old', versionRange: '1.x' })
    expect(result.versions).toEqual(['1.0.0', '1.0.1'])
    expect(calls[0].url).toBe('https://registry.npmjs.org/my-lib?write=true')
    expect(calls[1].url).toBe('https://registry.npmjs.org/my-lib')
    const putBody = JSON.parse(calls[1].init!.body as string) as { versions: Record<string, { deprecated?: string }> }
    expect(putBody.versions['1.0.0'].deprecated).toBe('old')
    expect(putBody.versions['2.0.0'].deprecated).toBeUndefined()
  })

  it('undeprecate clears the deprecated message', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(init?.method) === 'PUT') return new Response(null, { status: 200 })
      return new Response(JSON.stringify({
        _rev: '4-def',
        name: 'my-lib',
        versions: { '1.0.0': { deprecated: 'old' } },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const svc = createService()
    const result = await svc.deprecate('my-lib', { token: 'tok', message: '' })
    expect(result.message).toBe('')
  })
})