/**
 * Tests for the per-provider peak persistence (commit 19).
 *
 * Covers:
 * - readBalancePeak returns the value for a specific provider id
 * - readAllBalancePeaks returns the full map
 * - writeBalancePeak writes one provider and preserves others
 * - legacy single-key shape (`dsh-spark-finance.balance-peak`) is migrated to
 *   the per-provider map under `deepseek-official` on first read and removed
 *   from localStorage so it never leaks across providers later
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { readAllBalancePeaks, readBalancePeak, writeBalancePeak } from '../src/client/persist.ts'

const PEAK_KEY = 'dsh-spark-finance.balance-peak'
const PEAKS_KEY = 'dsh-spark-finance.balance-peaks'

// In-memory localStorage so the persist layer runs under node.
const memory = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
  clear: () => { memory.clear() },
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() { return memory.size },
}

beforeEach(() => { memory.clear() })

describe('persist.ts peak map (commit 19)', () => {
  it('returns undefined for an unknown provider id', () => {
    expect(readBalancePeak('deepseek-official')).toBeUndefined()
  })

  it('writes one provider without disturbing others', () => {
    writeBalancePeak('deepseek-official', { micros: 100_000_000, updatedAt: 1, currency: 'CNY' })
    writeBalancePeak('minimax-cn', { micros: 50_000_000, updatedAt: 2, currency: 'USD' })
    expect(readBalancePeak('deepseek-official')).toEqual({ micros: 100_000_000, updatedAt: 1, currency: 'CNY' })
    expect(readBalancePeak('minimax-cn')).toEqual({ micros: 50_000_000, updatedAt: 2, currency: 'USD' })
    const map = readAllBalancePeaks()
    expect(Object.keys(map).sort()).toEqual(['deepseek-official', 'minimax-cn'])
  })

  it('overwrites the existing value for one provider on a second write', () => {
    writeBalancePeak('deepseek-official', { micros: 100, updatedAt: 1, currency: 'CNY' })
    writeBalancePeak('deepseek-official', { micros: 200, updatedAt: 2, currency: 'CNY' })
    expect(readBalancePeak('deepseek-official')).toEqual({ micros: 200, updatedAt: 2, currency: 'CNY' })
  })

  it('migrates the legacy single-key shape into the per-provider map under deepseek-official on first read', () => {
    memory.set(PEAK_KEY, JSON.stringify({ micros: 250_000_000, updatedAt: 42, currency: 'CNY' }))
    expect(readBalancePeak('deepseek-official')).toEqual({ micros: 250_000_000, updatedAt: 42, currency: 'CNY' })
    // Migration is also written to the per-provider key + the legacy key is removed.
    expect(memory.has(PEAK_KEY)).toBe(false)
    expect(memory.has(PEAKS_KEY)).toBe(true)
  })

  it('does not overwrite an existing per-provider map with a stale legacy key', () => {
    memory.set(PEAKS_KEY, JSON.stringify({
      'minimax-cn': { micros: 9, updatedAt: 1, currency: 'USD' },
    }))
    memory.set(PEAK_KEY, JSON.stringify({ micros: 1, updatedAt: 1, currency: 'CNY' }))
    expect(readBalancePeak('deepseek-official')).toBeUndefined()
    expect(readBalancePeak('minimax-cn')).toEqual({ micros: 9, updatedAt: 1, currency: 'USD' })
    // Legacy key stays around until a write happens (best-effort migration).
    expect(memory.has(PEAK_KEY)).toBe(true)
  })

  it('clears the legacy key when a new write lands under the per-provider map', () => {
    memory.set(PEAK_KEY, JSON.stringify({ micros: 1, updatedAt: 1, currency: 'CNY' }))
    writeBalancePeak('deepseek-official', { micros: 2, updatedAt: 2, currency: 'CNY' })
    expect(memory.has(PEAK_KEY)).toBe(false)
  })

  it('ignores a malformed legacy value', () => {
    memory.set(PEAK_KEY, JSON.stringify({ micros: 'oops' }))
    expect(readBalancePeak('deepseek-official')).toBeUndefined()
  })
})
