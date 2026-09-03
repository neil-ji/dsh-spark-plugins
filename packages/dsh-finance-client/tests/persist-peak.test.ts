/**
 * Tests for the per-provider peak persistence (commit 19, multi-currency in
 * the post-currency migration refactor).
 *
 * Covers:
 * - readBalancePeak returns the value for a specific provider id
 * - readAllBalancePeaks returns the full map
 * - writeBalancePeak writes one provider and preserves others
 * - per-currency peaks coexist (deepseek-official can track CNY + USD)
 * - legacy single-key shape (`dsh-spark-finance.balance-peak`) is migrated
 *   to the per-provider map under `deepseek-official` on first read
 * - legacy per-provider inline-currency shape is folded into byCurrency
 * - the legacy single key is removed after a new write
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

const peak = (micros: number, updatedAt: number): { micros: number; updatedAt: number } => ({ micros, updatedAt })

describe('persist.ts peak map (commit 19, multi-currency)', () => {
  it('returns undefined for an unknown provider id', () => {
    expect(readBalancePeak('deepseek-official')).toBeUndefined()
  })

  it('writes one provider without disturbing others', () => {
    writeBalancePeak('deepseek-official', { byCurrency: { CNY: peak(100_000_000, 1) } })
    writeBalancePeak('minimax-cn', { byCurrency: { USD: peak(50_000_000, 2) } })
    expect(readBalancePeak('deepseek-official')).toEqual({ byCurrency: { CNY: peak(100_000_000, 1) } })
    expect(readBalancePeak('minimax-cn')).toEqual({ byCurrency: { USD: peak(50_000_000, 2) } })
    const map = readAllBalancePeaks()
    expect(Object.keys(map).sort()).toEqual(['deepseek-official', 'minimax-cn'])
  })

  it('overwrites the existing record on a second write for the same provider', () => {
    writeBalancePeak('deepseek-official', { byCurrency: { CNY: peak(100, 1) } })
    writeBalancePeak('deepseek-official', { byCurrency: { CNY: peak(200, 2) } })
    expect(readBalancePeak('deepseek-official')).toEqual({ byCurrency: { CNY: peak(200, 2) } })
  })

  it('keeps both CNY and USD peaks for the same provider (multi-currency)', () => {
    writeBalancePeak('deepseek-official', { byCurrency: { CNY: peak(100_000_000, 1) } })
    writeBalancePeak('deepseek-official', { byCurrency: { ...readBalancePeak('deepseek-official')!.byCurrency, USD: peak(20_000_000, 2) } })
    const all = readBalancePeak('deepseek-official')!
    expect(all.byCurrency.CNY?.micros).toBe(100_000_000)
    expect(all.byCurrency.USD?.micros).toBe(20_000_000)
  })

  it('migrates the legacy single-key shape into the per-provider map under deepseek-official on first read', () => {
    memory.set(PEAK_KEY, JSON.stringify({ micros: 250_000_000, updatedAt: 42, currency: 'CNY' }))
    expect(readBalancePeak('deepseek-official')).toEqual({
      byCurrency: { CNY: { micros: 250_000_000, updatedAt: 42 } },
    })
    expect(memory.has(PEAK_KEY)).toBe(false)
    expect(memory.has(PEAKS_KEY)).toBe(true)
  })

  it('migrates the legacy per-provider inline-currency shape into byCurrency', () => {
    memory.set(PEAKS_KEY, JSON.stringify({
      'deepseek-official': { micros: 100, updatedAt: 1, currency: 'CNY' },
      'minimax-cn': { micros: 50, updatedAt: 2, currency: 'USD' },
    }))
    expect(readBalancePeak('deepseek-official')).toEqual({
      byCurrency: { CNY: { micros: 100, updatedAt: 1 } },
    })
    expect(readBalancePeak('minimax-cn')).toEqual({
      byCurrency: { USD: { micros: 50, updatedAt: 2 } },
    })
  })

  it('does not overwrite an existing per-provider map with a stale legacy key', () => {
    memory.set(PEAKS_KEY, JSON.stringify({
      'minimax-cn': { byCurrency: { USD: { micros: 9, updatedAt: 1 } } },
    }))
    memory.set(PEAK_KEY, JSON.stringify({ micros: 1, updatedAt: 1, currency: 'CNY' }))
    expect(readBalancePeak('deepseek-official')).toBeUndefined()
    expect(readBalancePeak('minimax-cn')).toEqual({ byCurrency: { USD: { micros: 9, updatedAt: 1 } } })
    // Legacy key stays around until a write happens (best-effort migration).
    expect(memory.has(PEAK_KEY)).toBe(true)
  })

  it('clears the legacy key when a new write lands under the per-provider map', () => {
    memory.set(PEAK_KEY, JSON.stringify({ micros: 1, updatedAt: 1, currency: 'CNY' }))
    writeBalancePeak('deepseek-official', { byCurrency: { CNY: peak(2, 2) } })
    expect(memory.has(PEAK_KEY)).toBe(false)
  })

  it('ignores a malformed legacy value', () => {
    memory.set(PEAK_KEY, JSON.stringify({ micros: 'oops' }))
    expect(readBalancePeak('deepseek-official')).toBeUndefined()
  })
})
