import { describe, expect, it } from 'vitest'
import {
  isOwnedDependency,
  parseWorkspaceOverrides,
  planUninstall,
  removeWorkspaceOverrides,
} from '../lib/profile-uninstall.mjs'

/**
 * 卸载的核心风险不是「删不干净」，是**删错东西**。
 *
 * 实测真 home 的 web profile 里就躺着 `dsh-plugin-deepeye`（非本仓库插件），
 * 有自己的 dependency 行、bundle 行，还写了 profile/cordis.patch.yml。
 * 所以这组用例全部围绕「只摘我们的、别碰别人的」来锁。
 */
const OURS = 'dsh-spark-dock'
const THEIRS = 'dsh-plugin-deepeye'
const CACHE = '/home/u/.dsh/spark-plugins/cache/v0.2.0/dsh-spark-dock-0.3.7.tgz'

describe('isOwnedDependency', () => {
  it('安装记录里的包 + file: spec → 是我们的', () => {
    expect(isOwnedDependency({ name: OURS, spec: `file:${CACHE}`, ownedNames: new Set([OURS]) })).toBe(true)
  })

  it('同名但用户改用 npm 版本装的 → 不是我们的（不许动用户的东西）', () => {
    expect(isOwnedDependency({ name: OURS, spec: '^0.3.0', ownedNames: new Set([OURS]) })).toBe(false)
  })

  it('没有安装记录时按 tarball 路径特征识别（老版本装的也能摘）', () => {
    expect(isOwnedDependency({ name: OURS, spec: `file:${CACHE}` })).toBe(true)
    expect(isOwnedDependency({ name: 'x', spec: 'file:/repo/.pack-profile/x-1.0.0.tgz' })).toBe(true)
  })

  it('第三方插件的 spec 从不命中（它不是我们装的）', () => {
    expect(isOwnedDependency({ name: THEIRS, spec: '^0.1.1' })).toBe(false)
    expect(isOwnedDependency({ name: THEIRS, spec: 'file:/somewhere/else/deepeye.tgz' })).toBe(false)
  })
})

describe('planUninstall', () => {
  it('摘我们的依赖/bundle/override，保留第三方的（真 home 场景）', () => {
    const plan = planUninstall({
      dependencies: [
        [THEIRS, '^0.1.1'],
        ['dsh-spark-dock', `file:${CACHE}`],
        ['dsh-hippomemo', 'file:/home/u/.dsh/spark-plugins/cache/v0.2.0/dsh-hippomemo-0.3.6.tgz'],
      ],
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', THEIRS, 'dsh-spark-dock', 'dsh-hippomemo'],
      overrides: ['dsh-spark-dock', 'dsh-hippomemo', 'user-own-pin'],
    })

    expect(plan.dependencies.sort()).toEqual(['dsh-hippomemo', 'dsh-spark-dock'])
    // 官方两行 + deepeye 都必须留下
    expect(plan.bundles).toEqual(['dsh-spark-dock', 'dsh-hippomemo'])
    expect(plan.overrides.sort()).toEqual(['dsh-hippomemo', 'dsh-spark-dock'])
  })

  it('从不清空 bundle 列表（官方行与第三方行都不在移除集里）', () => {
    const plan = planUninstall({ dependencies: [], bundles: ['@deepseek-ai/dsh-base', THEIRS], overrides: [] })
    expect(plan.bundles).toEqual([])
  })

  it('用户手写的 override（非我们的包）不动', () => {
    const plan = planUninstall({
      dependencies: [[OURS, `file:${CACHE}`]],
      bundles: [OURS],
      overrides: ['user-own-pin', OURS],
    })
    expect(plan.overrides).toEqual([OURS])
  })
})

describe('parseWorkspaceOverrides / removeWorkspaceOverrides', () => {
  const YAML = [
    'packages:',
    '  - .',
    '',
    'nodeLinker: hoisted',
    'autoInstallPeers: false',
    'overrides:',
    '  "dsh-spark-dock": "file:/cache/dock.tgz"',
    '  "dsh-hippomemo": "file:/cache/hippo.tgz"',
    '  "user-own-pin": "^1.0.0"',
    '',
  ].join('\n')

  it('解析出 override 键（带引号与不带引号都认）', () => {
    expect(parseWorkspaceOverrides(YAML).names).toEqual(['dsh-spark-dock', 'dsh-hippomemo', 'user-own-pin'])
  })

  it('只删指定键，别的行与缩进保持原样', () => {
    const out = removeWorkspaceOverrides(YAML, ['dsh-spark-dock'])
    expect(out).toContain('"dsh-hippomemo": "file:/cache/hippo.tgz"')
    expect(out).toContain('"user-own-pin": "^1.0.0"')
    expect(out).not.toContain('dsh-spark-dock')
    expect(out).toContain('packages:')
    expect(out).toContain('nodeLinker: hoisted')
  })

  it('删空 overrides 后不留悬空的 `overrides:` 行', () => {
    const out = removeWorkspaceOverrides(YAML, ['dsh-spark-dock', 'dsh-hippomemo', 'user-own-pin'])
    expect(out).not.toContain('overrides:')
    expect(out).toContain('nodeLinker: hoisted')
  })

  it('没有要删的键时原样返回', () => {
    expect(removeWorkspaceOverrides(YAML, [])).toBe(YAML)
  })
})