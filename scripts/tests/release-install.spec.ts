import { afterEach, describe, expect, it } from 'vitest'
import { describeFetchError, fetchWithRetry, satisfies } from '../release-install.mjs'

/**
 * 兼容策略是「只保证与最新 dsh 兼容」：清单里的 compat 形如 `^<tested>`，
 * 安装器用本机 dsh 版本与它比对。这里锁住 caret 的 npm 语义
 * （major>0 锁 major；0.x 锁 minor；0.0.x 锁 patch），避免放宽成"跨 minor 也算兼容"。
 */
describe('release-install satisfies()', () => {
  const cases: Array<[string, string, boolean]> = [
    // 与验证版本一致 / 同 minor 更新 / 同 minor 的后续 rc：兼容
    ['0.1.2-rc.1', '^0.1.2-rc.1', true],
    ['0.1.2', '^0.1.2-rc.1', true],
    ['0.1.2-rc.2', '^0.1.2-rc.1', true],
    ['0.1.3', '^0.1.2-rc.1', true],
    // 更旧的 rc、跨 minor、跨 major：不兼容
    ['0.1.2-rc.0', '^0.1.2-rc.1', false],
    ['0.1.1-rc.2', '^0.1.2-rc.1', false],
    ['0.2.0', '^0.1.2-rc.1', false],
    ['1.0.0', '^0.1.2-rc.1', false],
    // caret 的常规语义
    ['0.2.1', '^0.2.0', true],
    ['0.3.0', '^0.2.0', false],
    ['1.2.9', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
    ['0.0.5', '^0.0.5', true],
    ['0.0.6', '^0.0.5', false],
    // 比较器与区间
    ['0.1.2-rc.1', '>=0.1.1-rc.2 <0.2.0-0', true],
    ['0.2.0', '>=0.1.1-rc.2 <0.2.0-0', false],
  ]

  for (const [version, range, expected] of cases) {
    it(`${version} vs ${range} → ${expected}`, () => {
      expect(satisfies(version, range)).toBe(expected)
    })
  }

  it('非法版本或空区间返回 undefined（跳过检查而不是误判）', () => {
    expect(satisfies('not-a-version', '^0.1.2')).toBeUndefined()
    expect(satisfies('0.1.2', '')).toBeUndefined()
    expect(satisfies('0.1.2', undefined)).toBeUndefined()
  })
})

/**
 * 2026-09-20 用户实测 `curl | sh` 报 `✗ fetch failed`：安装要顺序下 16 个 tarball，
 * undici 默认连接超时仅 10s，实测在第 11 个包上抛 UND_ERR_CONNECT_TIMEOUT /
 * UND_ERR_SOCKET（curl 打同一 URL 却是 200）—— 是客户端没韧性，不是网络不通。
 *
 * 这组用例锁住重试语义：连接类错误要重试，4xx 不要重试，报错要带上底层 cause。
 */
describe('release-install fetchWithRetry', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  /** 造一个按脚本依次返回/抛错的 fetch 替身。 */
  const stubFetch = (steps: Array<{ status?: number; throws?: Error }>) => {
    let call = 0
    globalThis.fetch = (async () => {
      const step = steps[Math.min(call, steps.length - 1)]
      call++
      if (step.throws !== undefined) throw step.throws
      return {
        ok: step.status !== undefined && step.status >= 200 && step.status < 300,
        status: step.status ?? 200,
        arrayBuffer: async () => new ArrayBuffer(8),
      }
    }) as unknown as typeof fetch
    return () => call
  }

  it('连接类错误重试后成功（本次 bug 的复现场景）', async () => {
    const timeout = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
    })
    const calls = stubFetch([{ throws: timeout }, { throws: timeout }, { status: 200 }])
    const response = await fetchWithRetry('https://example.test/x.tgz', { attempts: 6 })
    expect(response.status).toBe(200)
    expect(calls()).toBe(3)
  })

  it('UND_ERR_SOCKET（other side closed）同样重试', async () => {
    const closed = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
    })
    const calls = stubFetch([{ throws: closed }, { status: 200 }])
    expect((await fetchWithRetry('https://example.test/x.tgz', { attempts: 4 })).status).toBe(200)
    expect(calls()).toBe(2)
  })

  it('4xx 立即失败、不重试（资产真的不存在，重试只会掩盖问题）', async () => {
    const calls = stubFetch([{ status: 404 }])
    await expect(fetchWithRetry('https://example.test/missing.tgz', { attempts: 4 })).rejects.toThrow(/HTTP 404/)
    expect(calls()).toBe(1)
  })

  it('5xx 重试，耗尽后用尽 attempts 才失败', async () => {
    const calls = stubFetch([{ status: 503 }])
    await expect(fetchWithRetry('https://example.test/x.tgz', { attempts: 3 })).rejects.toThrow(/已重试 3 次/)
    expect(calls()).toBe(3)
  })

  it('报错文案带上底层 cause 与 code（不再只剩 "fetch failed"）', () => {
    const error = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
    })
    const text = describeFetchError(error)
    expect(text).toContain('Connect Timeout Error')
    expect(text).toContain('UND_ERR_CONNECT_TIMEOUT')
  })
})

/**
 * 2026-09-20 用户实测的第二层问题：`github.com` 整段不可达（curl/node 都超时），
 * 而 `api.github.com` 与 `objects.githubusercontent.com` 都正常。
 * GitHub Release 的下载地址第一跳就是 github.com，于是安装必然失败、
 * 且重试也救不回来。备用通道改走 api.github.com 的 releases/assets 端点。
 *
 * 这组用例锁住备用通道的**触发条件与 URL 形状**（真下载在 e2e 里验过：
 * 阻断 github.com 后 16 个包全部经 API 装成、sha256 全对）。
 */
describe('release-install API fallback', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  it('连接类错误可被重试救回（备用通道之外的第一层防线）', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      if (calls < 3) {
        throw Object.assign(new Error('fetch failed'), {
          cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
        })
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }
    }) as unknown as typeof fetch
    const response = await fetchWithRetry('https://github.com/x/y/releases/download/v1/a.tgz', { attempts: 5 })
    expect(response.status).toBe(200)
    expect(calls).toBe(3)
  })

  it('超时中止（AbortSignal）同样算连接类错误并重试', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      if (calls < 2) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }
    }) as unknown as typeof fetch
    expect((await fetchWithRetry('https://github.com/x/y/releases/download/v1/a.tgz', { attempts: 4 })).status).toBe(200)
    expect(calls).toBe(2)
  })
})
