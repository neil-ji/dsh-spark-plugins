/**
 * 版本纪律闸门的回归测试。
 *
 * 闸门要解决的坑：dsh client-modules 按「插件版本」缓存产物字节，改码不 bump 版本
 * 宿主就继续供旧字节。这里覆盖三件事：
 *   1. 什么算「发布输入」（测试/文档/产物不算）；
 *   2. 注释/空白改动不算发布改动（否则加一行说明就得发版）；
 *   3. 真实改动 + 版本没动 = 违规；新包 / 删包 / 已 bump 都不算。
 */
import { describe, expect, it } from 'vitest'
import { evaluateCommit, isRealChange, isShippingInput, shippingInputsByPackage } from '../check-version-bump.mjs'

describe('发布输入判定', () => {
  it('src / 构建配置 / 清单算发布输入', () => {
    expect(isShippingInput('src/index.ts')).toBe(true)
    expect(isShippingInput('src/client/embed.ts')).toBe(true)
    expect(isShippingInput('build.mjs')).toBe(true)
    expect(isShippingInput('tsdown.config.mjs')).toBe(true)
    expect(isShippingInput('cordis.patch.yml')).toBe(true)
    expect(isShippingInput('package.json')).toBe(true)
  })

  it('测试 / 文档 / 产物不算', () => {
    expect(isShippingInput('tests/apply.test.ts')).toBe(false)
    expect(isShippingInput('test/memory-core.test.ts')).toBe(false)
    expect(isShippingInput('README.md')).toBe(false)
    expect(isShippingInput('lib/client.js')).toBe(false)
    expect(isShippingInput('dist/esm/index.js')).toBe(false)
  })

  it('按包归组，忽略 packages/ 之外的文件', () => {
    const map = shippingInputsByPackage([
      'packages/dsh-spark-dock/src/client/index.ts',
      'packages/dsh-spark-dock/package.json',
      'packages/dsh-spark-dock/tests/x.test.ts',
      'packages/dsh-spark/src/index.ts',
      'scripts/dev.mjs',
      'README.md',
    ])
    expect([...map.keys()].sort()).toEqual(['packages/dsh-spark', 'packages/dsh-spark-dock'])
    expect(map.get('packages/dsh-spark-dock')).toEqual([
      'packages/dsh-spark-dock/src/client/index.ts',
      'packages/dsh-spark-dock/package.json',
    ])
  })
})

describe('注释改动不算发布改动', () => {
  it('纯注释 / 纯空白变更返回 false', () => {
    expect(isRealChange('const a = 1 // 旧注释\n', 'const a = 1 // 新注释\n')).toBe(false)
    expect(isRealChange('/** 说明 */\nconst a = 1\n', 'const a = 1\n')).toBe(false)
    expect(isRealChange('const a = 1\n', 'const a = 1\n\n')).toBe(false)
  })

  it('真实代码变更返回 true', () => {
    expect(isRealChange('const a = 1\n', 'const a = 2\n')).toBe(true)
    expect(isRealChange('const a = 1\n', 'const a = 1\nconst b = 2\n')).toBe(true)
    expect(isRealChange("const a = 'http://x' // 注释\n", "const a = 'http://y' // 注释\n")).toBe(true)
  })
})

describe('commit 判定', () => {
  const evaluate = (input: {
    files: string[]
    commentOnly?: string[]
    versions: Record<string, [string | undefined, string | undefined]>
  }) => {
    const commentOnly = new Set(input.commentOnly ?? [])
    return evaluateCommit({
      files: input.files,
      realChanges: (file) => !commentOnly.has(file),
      versionBefore: (pkgRel) => input.versions[pkgRel]?.[0],
      versionAfter: (pkgRel) => input.versions[pkgRel]?.[1],
    })
  }

  it('真实改动 + 版本没动 = 违规', () => {
    const { violations } = evaluate({
      files: ['packages/dsh-spark-dock/src/client/index.ts'],
      versions: { 'packages/dsh-spark-dock': ['0.1.9', '0.1.9'] },
    })
    expect(violations).toEqual([
      { pkgRel: 'packages/dsh-spark-dock', files: ['packages/dsh-spark-dock/src/client/index.ts'], from: '0.1.9', to: '0.1.9' },
    ])
  })

  it('同 commit bump 版本 = 通过', () => {
    const { violations, checked } = evaluate({
      files: ['packages/dsh-spark-dock/src/client/index.ts', 'packages/dsh-spark-dock/package.json'],
      versions: { 'packages/dsh-spark-dock': ['0.1.9', '0.1.10'] },
    })
    expect(violations).toEqual([])
    expect(checked).toBe(1)
  })

  it('只有注释改动 = 不要求 bump', () => {
    const { violations, checked } = evaluate({
      files: ['packages/dsh-spark-dock/src/client/index.ts'],
      commentOnly: ['packages/dsh-spark-dock/src/client/index.ts'],
      versions: { 'packages/dsh-spark-dock': ['0.1.9', '0.1.9'] },
    })
    expect(violations).toEqual([])
    expect(checked).toBe(0)
  })

  it('测试 / 文档改动 = 不进入检查', () => {
    const { violations, checked } = evaluate({
      files: ['packages/dsh-spark-dock/tests/x.test.ts', 'packages/dsh-spark-dock/README.md'],
      versions: {},
    })
    expect(violations).toEqual([])
    expect(checked).toBe(0)
  })

  it('新包（before 无版本）与删包（after 无版本）不算违规', () => {
    expect(evaluate({ files: ['packages/dsh-new/src/index.ts'], versions: { 'packages/dsh-new': [undefined, '0.1.0'] } }).violations).toEqual([])
    expect(evaluate({ files: ['packages/dsh-spark-ui/src/index.ts'], versions: { 'packages/dsh-spark-ui': ['0.1.4', undefined] } }).violations).toEqual([])
  })
})
