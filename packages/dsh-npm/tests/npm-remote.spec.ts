import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { NpmService, firstReleaseScript } from '../src/npm-service.ts'

function createService(): NpmService {
  return new NpmService(new Context())
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

  it('packageCheckRemote reports availability', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })))
    const svc = createService()
    await expect(svc.packageCheckRemote({ name: 'free-name' })).resolves.toEqual({
      name: 'free-name', exists: false, latest: null, description: null,
    })
  })

  it('trustStatusRemote returns checkUrl for unpublished package', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })))
    const svc = createService()
    const result = await svc.trustStatusRemote({ pkg: 'free-name' })
    expect(result.exists).toBe(false)
    expect(result.verified).toBe(false)
    expect(result.checkUrl).toBe('https://www.npmjs.com/package/free-name?tab=settings')
  })

  it('launchScriptRemote generates script without side effects', () => {
    const svc = createService()
    const result = svc.launchScriptRemote({ pkg: 'my-lib', repository: 'octo/my-lib' })
    expect(result.status).toBe('generated')
    expect(result.script).toContain('npm trust github my-lib')
  })
})