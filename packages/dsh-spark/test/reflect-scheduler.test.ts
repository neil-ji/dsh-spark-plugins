/** B 档：惰性涌现的脏标记判定（纯函数）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldReflect } from '../src/reflect-scheduler.ts'

const NOW = 1_700_000_000_000

test('threshold <= 0 disables the scheduler entirely', () => {
  assert.deepEqual(shouldReflect({ changedCount: 99, threshold: 0, lastReflectAt: null, now: NOW, minIntervalMs: 0 }), { run: false, reason: 'disabled' })
})

test('runs when the dirty count reaches the threshold and nothing has run yet', () => {
  assert.deepEqual(shouldReflect({ changedCount: 3, threshold: 3, lastReflectAt: null, now: NOW, minIntervalMs: 300_000 }), { run: true, reason: 'dirty' })
})

test('below threshold stays quiet (this is what keeps it from running every step)', () => {
  assert.deepEqual(shouldReflect({ changedCount: 2, threshold: 3, lastReflectAt: null, now: NOW, minIntervalMs: 0 }), { run: false, reason: 'below-threshold' })
})

test('a recent run suppresses another trigger inside the min interval', () => {
  assert.deepEqual(shouldReflect({ changedCount: 50, threshold: 3, lastReflectAt: NOW - 1000, now: NOW, minIntervalMs: 300_000 }), { run: false, reason: 'too-soon' })
})

test('after the min interval elapses it runs again', () => {
  assert.deepEqual(shouldReflect({ changedCount: 50, threshold: 3, lastReflectAt: NOW - 600_000, now: NOW, minIntervalMs: 300_000 }), { run: true, reason: 'dirty' })
})
