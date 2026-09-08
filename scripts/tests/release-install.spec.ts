import { describe, expect, it } from 'vitest'
import { satisfies } from '../release-install.mjs'

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
