import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { NpmService } from '../src/npm-service.ts'

function createService(): NpmService {
  return new NpmService(new Context())
}

describe('NpmService.checkPackage', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reports available when the registry answers 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })))
    const svc = createService()
    await expect(svc.checkPackage('free-name')).resolves.toEqual({ exists: false, name: 'free-name' })
  })

  it('reports taken with latest, dist-tags, versions and description', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      name: 'taken-name',
      description: 'already here',
      'dist-tags': { latest: '2.0.0' },
      versions: { '1.0.0': {}, '2.0.0': {} },
    }), { status: 200 })))
    const svc = createService()
    await expect(svc.checkPackage('taken-name')).resolves.toEqual({
      exists: true,
      name: 'taken-name',
      description: 'already here',
      distTags: { latest: '2.0.0' },
      versions: ['1.0.0', '2.0.0'],
      latest: '2.0.0',
    })
  })

  it('throws on a 5xx registry response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const svc = createService()
    await expect(svc.checkPackage('x')).rejects.toThrow(/500/)
  })

  it('throws on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const svc = createService()
    await expect(svc.checkPackage('x')).rejects.toThrow(/offline/)
  })
})

describe('NpmService.kitPackages', () => {
  it('falls back to the wire default when unconfigured', () => {
    const svc = createService()
    expect(svc.kitPackages()).toEqual([
      'dsh-connector-wire', 'dsh-connector-github-ui', 'dsh-connector-github', 'dsh-connector-npm',
    ])
  })

  it('returns the configured list when set', () => {
    const svc = new NpmService(new Context(), () => ({
      kitPackages: ['dsh-connector-npm'],
    }))
    expect(svc.kitPackages()).toEqual(['dsh-connector-npm'])
  })

  it('filters empty entries and falls back when the configured list is empty', () => {
    const svc = new NpmService(new Context(), () => ({
      kitPackages: ['', '  ', 'dsh-connector-npm'],
    }))
    expect(svc.kitPackages()).toEqual(['dsh-connector-npm'])
    const empty = new NpmService(new Context(), () => ({ kitPackages: [] }))
    expect(empty.kitPackages()).toHaveLength(4)
  })

  it('statusRemote uses the configured kit list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({
      name: decodeURIComponent(url.split('/').pop() ?? ''),
      'dist-tags': { latest: '0.1.0' }, versions: {},
    }), { status: 200 })))
    const svc = new NpmService(new Context(), () => ({
      kitPackages: ['only-one'],
    }))
    const status = await svc.statusRemote()
    expect(status.packages.map((p) => p.name)).toEqual(['only-one'])
  })
})

describe('NpmService.trustCommand', () => {
  it('builds the npm trust github command with --allow-publish -y', () => {
    const svc = createService()
    expect(svc.trustCommand('foo', 'release.yml', 'octo/foo'))
      .toBe('npm trust github foo --file release.yml --repository octo/foo --allow-publish -y')
  })
})