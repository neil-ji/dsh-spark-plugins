import { describe, expect, it } from 'vitest'
import { billingModesToRows, rowsToBillingModes } from '../src/client/billing-modes.ts'

describe('billingModesToRows', () => {
  it('parses a stored JSON object into ordered rows', () => {
    expect(billingModesToRows('{"zai":"plan","volcengine":"metered"}')).toEqual([
      { route: 'zai', mode: 'plan' },
      { route: 'volcengine', mode: 'metered' },
    ])
  })

  it('returns empty rows for blank, invalid, or non-object text', () => {
    expect(billingModesToRows('')).toEqual([])
    expect(billingModesToRows('   ')).toEqual([])
    expect(billingModesToRows('{bad')).toEqual([])
    expect(billingModesToRows('[1,2]')).toEqual([])
    expect(billingModesToRows('"hi"')).toEqual([])
  })

  it('ignores unknown mode values instead of blowing up', () => {
    expect(billingModesToRows('{"x":"prepaid","y":"plan"}')).toEqual([{ route: 'y', mode: 'plan' }])
  })
})

describe('rowsToBillingModes', () => {
  it('serializes rows back to pretty JSON', () => {
    expect(rowsToBillingModes([{ route: 'zai', mode: 'plan' }])).toBe('{\n  "zai": "plan"\n}')
  })

  it('drops blank routes, keeps last duplicate, and serializes empty as clear', () => {
    expect(rowsToBillingModes([
      { route: '', mode: 'plan' },
      { route: 'a', mode: 'metered' },
      { route: 'a', mode: 'plan' }, // duplicate: last wins
    ])).toBe('{\n  "a": "plan"\n}')
    expect(rowsToBillingModes([])).toBe('')
    expect(rowsToBillingModes([{ route: '  ', mode: 'plan' }])).toBe('')
  })
})