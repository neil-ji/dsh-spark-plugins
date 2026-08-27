import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { healBoundedStringList, hippomemoDomainSpec } from '../src/spec.ts'

describe('healBoundedStringList', () => {
  it('splits whitespace-joined mega-terms into bounded terms', () => {
    const healed = healBoundedStringList(['spark-vpn 卡死 冻结 freeze deadlock'])
    assert.deepEqual(healed, ['spark-vpn', '卡死', '冻结', 'freeze', 'deadlock'])
  })

  it('truncates rare over-long words to the 50-char cap', () => {
    const healed = healBoundedStringList(['x'.repeat(80)])
    assert.equal(healed[0].length, 50)
  })

  it('dedupes and caps the list at 32 items', () => {
    const terms = Array.from({ length: 40 }, (_, i) => `t${i % 35}`)
    const healed = healBoundedStringList(terms)
    assert.ok(healed.length <= 32)
    assert.equal(new Set(healed).size, healed.length)
  })

  it('passes through non-array shapes untouched (zod reports those)', () => {
    const notArray = 'oops'
    assert.equal(healBoundedStringList(notArray), notArray)
    assert.equal(healBoundedStringList(undefined), undefined)
  })
})

describe('memoryRecord schema self-healing (end-to-end)', () => {
  // Pull the registered memories-table record schema out of the domain spec.
  const memoriesSchema = hippomemoDomainSpec.tables['memories']?.valueSchema

  it('the memories table exists and validates a legacy dirty record', () => {
    assert.ok(memoriesSchema, 'memories table missing from domain spec')
    const base = {
      id: 'e2c9a1d0-0000-4000-8000-000000000001',
      kind: 'fact',
      title: 'Legacy dirty record',
      content: 'written before the searchTerms caps existed',
      scope: 'workspace',
      sourceSessionId: 'test-session',
      createdAt: 1, updatedAt: 1,
    }
    // The exact shape that bricked boot: one whitespace-joined 153-char term.
    const parsed = memoriesSchema.parse({
      ...base,
      searchTerms: ['spark-vpn 卡死 冻结 freeze deadlock 死锁 @Published Combine SwiftUI postAudit auditLog refreshTraffic uploadRate 锁序反转 GraphHost _MovableLockSyncMain diag queue'],
    })
    assert.ok(parsed.searchTerms.length > 1 && parsed.searchTerms.length <= 32)
    for (const term of parsed.searchTerms) assert.ok(term.length >= 1 && term.length <= 50)
  })
})