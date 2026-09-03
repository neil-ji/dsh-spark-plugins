import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_FINANCE_PREFS,
  readFinancePrefs,
  writeFinancePrefs,
} from '../src/client/persist.ts'

const PREFS_KEY = 'dsh-spark-finance.prefs'

class FakeStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string): void { this.store.set(key, String(value)) }
  removeItem(key: string): void { this.store.delete(key) }
  clear(): void { this.store.clear() }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null }
  get length(): number { return this.store.size }
}

describe('FinancePrefs persistence', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new FakeStorage() })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
  })

  it('returns defaults when storage is empty', () => {
    expect(readFinancePrefs()).toEqual(DEFAULT_FINANCE_PREFS)
  })

  it('default autoSync is false (opt-in: first network call needs an explicit flip)', () => {
    expect(DEFAULT_FINANCE_PREFS.autoSync).toBe(false)
  })

  it('persists autoSync off across reads', () => {
    writeFinancePrefs({ ...DEFAULT_FINANCE_PREFS, autoSync: false })
    expect(readFinancePrefs().autoSync).toBe(false)
  })

  it('persists a sync snapshot round-trip', () => {
    const snapshot = {
      appliedAt: 1_700_000_000_000,
      source: 'https://models.dev/api.json',
      kept: 23,
      providers: ['openai', 'zai'],
      fx: 7.2,
    }
    writeFinancePrefs({ ...DEFAULT_FINANCE_PREFS, lastSync: snapshot })
    expect(readFinancePrefs().lastSync).toEqual(snapshot)
  })

  it('falls back to null when an older browser stored lastSync as null', () => {
    writeFinancePrefs({ ...DEFAULT_FINANCE_PREFS, lastSync: null })
    expect(readFinancePrefs().lastSync).toBeNull()
  })

  it('rejects malformed lastSync shapes silently', () => {
    writeFinancePrefs({
      ...DEFAULT_FINANCE_PREFS,
      // appliedAt missing
      lastSync: { appliedAt: undefined as unknown as number, source: 'x', kept: 1, providers: [], fx: 1 },
    })
    expect(readFinancePrefs().lastSync).toBeNull()
  })

  it('merges partially-stored prefs without losing newer keys', () => {
    const storage = new FakeStorage()
    storage.setItem(PREFS_KEY, JSON.stringify({
      layout: 'standard',
      charts: { byModel: false },
    }))
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    const prefs = readFinancePrefs()
    expect(prefs.layout).toBe('standard')
    expect(prefs.charts.byModel).toBe(false)
    // Other chart keys kept on default
    expect(prefs.charts.gauge).toBe(true)
    // Newer fields fall back to default
    expect(prefs.autoSync).toBe(false)
    expect(prefs.lastSync).toBeNull()
  })
})
