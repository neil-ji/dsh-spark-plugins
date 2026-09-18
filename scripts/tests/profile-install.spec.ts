import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectBundleRow, reconcileBundleRows } from '../lib/profile-install.mjs'

/**
 * dsh 的 loadProfileDirectory 对 dsh.profile.bundles 是**严格解析**：任何一行指向解析不到
 * 的包（或没声明 / 没带补丁文件的包），宿主下次启动就 `cannot resolve profile bundle` 直接
 * 起不来。历史事故：一次 `install-profile.mjs --only <子集>` 把依赖正确收敛到子集，却因为
 * 回收逻辑挂在 registerBundles 门控下而把 bundle 行原样留着 —— 真 home 的 `dsh web` 起不来。
 *
 * 这组用例把「bundle 行必须与实际依赖对账」和「bundle 行必须真能当补丁层加载」两件事锁住。
 */
describe('reconcileBundleRows', () => {
  it('摘掉指向未安装包的旧行（历史事故的复现）', () => {
    // 场景：上次全量装过 8 个 bundle，这次只装了 finance 闭包。
    const result = reconcileBundleRows({
      previous: ['@deepseek-ai/dsh-base', 'dsh-plugin-deepeye', 'dsh-spark-finance-bundle', 'dsh-spark-dock', 'dsh-spark'],
      dependencies: ['dsh-plugin-deepeye', 'dsh-spark-finance', 'dsh-spark-finance-client'],
      added: [],
    })
    expect(result.bundles).toEqual(['@deepseek-ai/dsh-base', 'dsh-plugin-deepeye'])
    expect(result.removed).toEqual(['dsh-spark-finance-bundle', 'dsh-spark-dock', 'dsh-spark'])
  })

  it('官方 @deepseek-ai/* 行一律保留（解析锚是 dsh 安装目录，不归本工具链管）', () => {
    const result = reconcileBundleRows({
      previous: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      dependencies: [],
      added: [],
    })
    expect(result.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    expect(result.removed).toEqual([])
  })

  it('registerBundles 新增的行追加在末尾，且报成 added', () => {
    const result = reconcileBundleRows({
      previous: ['@deepseek-ai/dsh-base', 'dsh-plugin-deepeye'],
      dependencies: ['dsh-plugin-deepeye', 'dsh-spark-dock'],
      added: ['dsh-spark-dock'],
    })
    expect(result.bundles).toEqual(['@deepseek-ai/dsh-base', 'dsh-plugin-deepeye', 'dsh-spark-dock'])
    expect(result.added).toEqual(['dsh-spark-dock'])
    expect(result.removed).toEqual([])
  })

  it('原本就在列表里的行不算新增（不重复追加、不挪位置）', () => {
    const result = reconcileBundleRows({
      previous: ['@deepseek-ai/dsh-base', 'dsh-spark-dock'],
      dependencies: ['dsh-spark-dock'],
      added: ['dsh-spark-dock'],
    })
    expect(result.bundles).toEqual(['@deepseek-ai/dsh-base', 'dsh-spark-dock'])
    expect(result.added).toEqual([])
  })

  it('空历史列表 + 不登记 → 结果为空（不凭空造行）', () => {
    expect(reconcileBundleRows({ previous: [], dependencies: ['dsh-spark-dock'], added: [] }).bundles).toEqual([])
  })
})

describe('inspectBundleRow', () => {
  let root: string

  /** 造一个最小 profile 目录：node_modules/<name>/package.json（+ 可选补丁文件）。 */
  const install = (name: string, manifest: object, patchFile?: string) => {
    const dir = join(root, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0', ...manifest }))
    if (patchFile !== undefined) writeFileSync(join(dir, patchFile), '[]\n')
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dsh-profile-install-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', private: true }))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('官方包直接放行（不做解析）', () => {
    expect(inspectBundleRow(root, '@deepseek-ai/dsh-base')).toEqual({ ok: true, official: true })
  })

  it('解析不到的包 → 不是合法的 bundle 行', () => {
    // 名字必须挑一个任何地方都不存在的：vitest 的 module runner 会把仓库自己的
    // node_modules 掺进 createRequire().resolve.paths()，用真包名（如
    // dsh-spark-finance-bundle）在这个沙箱里反而能解析到。生产环境跑在原生 Node 下，
    // 搜索路径就是 profile 目录逐级向上的 node_modules（与 dsh-app-boot 同口径）。
    const verdict = inspectBundleRow(root, 'dsh-not-installed-anywhere-9f3a')
    expect(verdict.ok).toBe(false)
    expect((verdict as { reason: string }).reason).toContain('解析不到')
  })

  it('装了但没声明 dsh.bundle.patch → 不是合法的 bundle 行', () => {
    install('dsh-no-bundle', {})
    const verdict = inspectBundleRow(root, 'dsh-no-bundle')
    expect(verdict.ok).toBe(false)
    expect((verdict as { reason: string }).reason).toContain('未声明 dsh.bundle.patch')
  })

  it('声明了但补丁文件没打进包 → 不是合法的 bundle 行', () => {
    install('dsh-missing-patch', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
    const verdict = inspectBundleRow(root, 'dsh-missing-patch')
    expect(verdict.ok).toBe(false)
    expect((verdict as { reason: string }).reason).toContain('补丁文件不存在')
  })

  it('装了 + 声明了 + 补丁文件在 → 合法，并回带解析路径', () => {
    install('dsh-good-bundle', { dsh: { bundle: { patch: './cordis.patch.yml' } } }, 'cordis.patch.yml')
    const verdict = inspectBundleRow(root, 'dsh-good-bundle')
    expect(verdict.ok).toBe(true)
    expect((verdict as { dir: string }).dir).toBe(join(root, 'node_modules', 'dsh-good-bundle'))
    expect((verdict as { patch: string }).patch).toBe('./cordis.patch.yml')
  })
})
