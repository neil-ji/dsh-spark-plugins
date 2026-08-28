/**
 * Unit tests for the shared plugin settings-card state model
 * (dsh-spark-plugin-kit client): staged edits, override badges, invalid blocking,
 * save write-back, reset (clear), and discard — over a mock settings scope.
 *
 * createSnapshotStore is mocked like the finance-client card tests, because
 * the dsh-client-runtime browser bundle boots through window.__ModuleLoader__.
 * The inject actions are fire-and-forget (same as finance), so write
 * assertions flush the microtask queue first.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: object) => {
    let state = init
    return {
      getSnapshot: () => state,
      subscribe: () => () => {},
      set: (next: object) => { state = next },
    }
  },
}))

import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  booleanCardField, choiceCardField, numberCardField, StagedSettingsCard, textCardField,
} from '../src/client/settings-card.ts'

type Section = {
  tokenEnv?: string
  maxMemories?: number
  defaultVisibility?: 'private' | 'public'
  allowPush?: boolean
}

function mockScope(initial: Partial<SettingsScopeSnapshot<Section>> = {}): SettingsScope<Section> & { written: Array<{ op: 'set' | 'unset'; field: string; value?: unknown }> } {
  let snapshot: SettingsScopeSnapshot<Section> = {
    status: 'ready',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
    ...initial,
  }
  const listeners = new Set<() => void>()
  const written: Array<{ op: 'set' | 'unset'; field: string; value?: unknown }> = []
  const publish = (): void => { for (const listener of listeners) listener() }
  return {
    written,
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: async (field, value) => {
      snapshot = {
        ...snapshot,
        value: { ...(snapshot.value ?? {}), [field]: value } as Section,
        user: { ...((snapshot.user as object) ?? {}), [field]: value },
      }
      written.push({ op: 'set', field, value })
      publish()
    },
    unset: async (field) => {
      const value = { ...(snapshot.value ?? {}) } as Record<string, unknown>
      const user = { ...((snapshot.user as object) ?? {}) } as Record<string, unknown>
      delete value[field]
      delete user[field]
      snapshot = { ...snapshot, value: value as Section, user }
      written.push({ op: 'unset', field })
      publish()
    },
  }
}

const specs = [
  textCardField('tokenEnv'),
  numberCardField('maxMemories'),
  choiceCardField('defaultVisibility', ['private', 'public']),
  booleanCardField('allowPush'),
]

/** Let the fire-and-forget inject actions settle (same as finance card tests). */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('StagedSettingsCard', () => {
  it('formats stored values and reports user-layer overrides', () => {
    const scope = mockScope({
      value: { tokenEnv: 'GH_TOKEN', maxMemories: 5000, defaultVisibility: 'public', allowPush: false },
      user: { tokenEnv: 'GH_TOKEN', allowPush: false },
    })
    const card = new StagedSettingsCard(scope, specs)
    const state = card.store.getSnapshot()
    expect(state.shell.available).toBe(true)
    expect(state.shell.writable).toBe(true)
    expect(state.shell.dirty).toBe(false)
    expect(state.fields.tokenEnv).toEqual({ text: 'GH_TOKEN', overridden: true, invalid: false })
    expect(state.fields.maxMemories).toEqual({ text: '5000', overridden: false, invalid: false })
    expect(state.fields.defaultVisibility).toEqual({ text: 'public', overridden: false, invalid: false })
    expect(state.fields.allowPush).toEqual({ text: 'false', overridden: true, invalid: false })
  })

  it('stages edits and marks the shell dirty', () => {
    const scope = mockScope({ value: { maxMemories: 10 } })
    const card = new StagedSettingsCard(scope, specs)
    const actions = card.actions()
    actions.edit('maxMemories', '25')
    const state = card.store.getSnapshot()
    expect(state.shell.dirty).toBe(true)
    expect(state.shell.invalid).toBe(false)
    expect(state.fields.maxMemories.text).toBe('25')
  })

  it('flags invalid drafts and refuses to save them', async () => {
    const scope = mockScope({ value: { maxMemories: 10 } })
    const card = new StagedSettingsCard(scope, specs)
    card.actions().edit('maxMemories', 'abc')
    const state = card.store.getSnapshot()
    expect(state.shell.invalid).toBe(true)
    card.actions().save()
    await flush()
    expect(scope.written).toEqual([])
  })

  it('writes staged edits on save and clears them on success', async () => {
    const scope = mockScope({ value: { tokenEnv: 'A', maxMemories: 10 } })
    const card = new StagedSettingsCard(scope, specs)
    const actions = card.actions()
    actions.edit('tokenEnv', 'B')
    actions.edit('maxMemories', '42')
    actions.save()
    await flush()
    expect(scope.written).toEqual([
      { op: 'set', field: 'tokenEnv', value: 'B' },
      { op: 'set', field: 'maxMemories', value: 42 },
    ])
    const state = card.store.getSnapshot()
    expect(state.shell.dirty).toBe(false)
    expect(state.fields.maxMemories.text).toBe('42')
  })

  it('skips writes whose staged value equals the current value', async () => {
    const scope = mockScope({ value: { maxMemories: 10 } })
    const card = new StagedSettingsCard(scope, specs)
    const actions = card.actions()
    actions.edit('maxMemories', '10')
    actions.save()
    await flush()
    expect(scope.written).toEqual([])
  })

  it('reset stages a clear and save unsets the field', async () => {
    const scope = mockScope({ value: { maxMemories: 10 }, user: { maxMemories: 10 } })
    const card = new StagedSettingsCard(scope, specs)
    const actions = card.actions()
    actions.resetField('maxMemories')
    const state = card.store.getSnapshot()
    expect(state.fields.maxMemories.overridden).toBe(false)
    actions.save()
    await flush()
    expect(scope.written).toEqual([{ op: 'unset', field: 'maxMemories' }])
  })

  it('discard drops staged edits without writing', async () => {
    const scope = mockScope({ value: { maxMemories: 10 } })
    const card = new StagedSettingsCard(scope, specs)
    const actions = card.actions()
    actions.edit('maxMemories', '99')
    actions.discard()
    const state = card.store.getSnapshot()
    expect(state.shell.dirty).toBe(false)
    expect(state.fields.maxMemories.text).toBe('10')
    expect(scope.written).toEqual([])
  })

  it('reports unavailable when the namespace is not served', () => {
    const scope = mockScope({ status: 'unavailable' })
    const card = new StagedSettingsCard(scope, specs)
    expect(card.store.getSnapshot().shell.available).toBe(false)
  })

  it('boolean and choice parsers only accept their domains', () => {
    const scope = mockScope({})
    const card = new StagedSettingsCard(scope, specs)
    const actions = card.actions()
    actions.edit('allowPush', 'true')
    actions.edit('defaultVisibility', 'private')
    expect(card.store.getSnapshot().shell.invalid).toBe(false)
    actions.edit('allowPush', 'maybe')
    expect(card.store.getSnapshot().shell.invalid).toBe(true)
    actions.edit('allowPush', 'false')
    actions.edit('defaultVisibility', 'internal')
    expect(card.store.getSnapshot().shell.invalid).toBe(true)
  })
})
