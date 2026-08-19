import { describe, expect, it } from 'vitest'
import { bumpPatch } from '../src/launch.ts'

describe('bumpPatch', () => {
  it('bumps the patch of a three-part version', () => {
    expect(bumpPatch('0.1.0')).toBe('0.1.1')
    expect(bumpPatch('1.2.9')).toBe('1.2.10')
  })

  it('bumps the last part of a shorter version', () => {
    expect(bumpPatch('0.1')).toBe('0.2')
    expect(bumpPatch('2')).toBe('3')
  })

  it('appends .1 when the last part is not numeric', () => {
    expect(bumpPatch('1.x')).toBe('1.x.1')
  })
})
