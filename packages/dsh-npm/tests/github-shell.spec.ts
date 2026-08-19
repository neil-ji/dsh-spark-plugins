import { describe, expect, it } from 'vitest'
import { shellQuote } from '../src/github-shell.ts'

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'")
  })

  it('escapes embedded single quotes for POSIX shell', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })
})
