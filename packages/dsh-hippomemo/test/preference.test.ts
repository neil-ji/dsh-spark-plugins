/**
 * 偏好派生纯函数的回归线（`src/preference.ts`）。
 *
 * 这些数值同时被三处消费：宿主 `/hippomemo/preferences` 的 decayPercent、
 * 待办队列的进件判定、以及 UI 的「衰减中 N%」文案。阈值一旦漂移，
 * 面板说「衰减 71%」而队列却不进件，用户看到的就是自相矛盾的两套数。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PREFERENCE_DECAY_FLOOR,
  PREFERENCE_HALF_LIFE_DAYS,
  PREFERENCE_REVIEW_DECAY,
  computePreferenceDecay,
  detectPreferenceSource,
  preferenceNeedsReview,
} from '../src/preference.ts'
import type { MemoryRecord } from '../src/types.ts'

const DAY = 86_400_000

function makeRecord(over: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: over.id ?? 'r-1',
    kind: over.kind ?? 'preference',
    title: over.title ?? 'untitled',
    content: over.content ?? 'body',
    tags: [],
    scope: over.scope ?? 'workspace',
    workspacePath: null,
    globalProven: over.globalProven ?? false,
    seenWorkspaces: [],
    importance: 0.5,
    status: 'active',
    sourceSessionId: 'sess-1',
    revision: 1,
    updatedBy: over.updatedBy ?? 'system',
    supersedes: null,
    supersededBy: null,
    createdAt: over.createdAt ?? 1_000,
    updatedAt: over.updatedAt ?? 1_000,
    expiresAt: null,
    relatedIds: [],
    searchTerms: [],
    recallCount: over.recallCount ?? 0,
    lastRecalledAt: over.lastRecalledAt ?? null,
    citationCount: 0,
    lastCitedAt: null,
    ...over,
  }
}

test('detectPreferenceSource: human 恒为手敲，agent 恒为自动挖', () => {
  assert.equal(detectPreferenceSource(makeRecord({ updatedBy: 'human' })), 'manual')
  assert.equal(detectPreferenceSource(makeRecord({ updatedBy: 'agent' })), 'auto')
})

test('detectPreferenceSource: system 默认按「有没有 spark 出身」判，不确定时偏向 manual', () => {
  assert.equal(detectPreferenceSource(makeRecord({ updatedBy: 'system', sourceSparkId: 'spark-1' })), 'auto')
  assert.equal(detectPreferenceSource(makeRecord({ updatedBy: 'system' })), 'manual')
})

test('computePreferenceDecay: global+proven（已确认）永不衰减', () => {
  const record = makeRecord({ scope: 'global', globalProven: true, lastRecalledAt: 0, updatedAt: 0 })
  assert.equal(computePreferenceDecay(record, 400 * DAY), null)
})

test('computePreferenceDecay: 半衰期到点时损失 50%，地板封顶后不再增长', () => {
  const anchor = 1_000 * DAY
  const record = makeRecord({ lastRecalledAt: anchor, updatedAt: anchor })
  assert.equal(computePreferenceDecay(record, anchor), null, '同一时刻 = 未衰减')
  const half = computePreferenceDecay(record, anchor + PREFERENCE_HALF_LIFE_DAYS * DAY)
  assert.equal(half, 50)
  // 天数再翻一倍：剩余 25% 已被地板 40% 夹住 → 损失恒为 100-40=60。
  const late = computePreferenceDecay(record, anchor + 4 * PREFERENCE_HALF_LIFE_DAYS * DAY)
  assert.equal(late, 100 - PREFERENCE_DECAY_FLOOR)
})

test('preferenceNeedsReview: 只有「未确认 + 衰减压到地板」才进待办', () => {
  assert.equal(PREFERENCE_REVIEW_DECAY, 100 - PREFERENCE_DECAY_FLOOR)
  assert.equal(preferenceNeedsReview({ confirmed: false, decayPercent: PREFERENCE_REVIEW_DECAY }), true, '刚好压到地板 → 进件')
  assert.equal(preferenceNeedsReview({ confirmed: false, decayPercent: PREFERENCE_REVIEW_DECAY - 1 }), false, '差一点 → 不进件')
  assert.equal(preferenceNeedsReview({ confirmed: false, decayPercent: 71 }), true)
  assert.equal(preferenceNeedsReview({ confirmed: false, decayPercent: null }), false, '未衰减 → 不进件')
  assert.equal(preferenceNeedsReview({ confirmed: true, decayPercent: 92 }), false, '已确认 → 不进件（衰减值不参与判定）')
})

test('preferenceNeedsReview: 与 computePreferenceDecay 串起来 —— 40 天未命中的未确认偏好会进件', () => {
  const anchor = 1_000 * DAY
  const record = makeRecord({ lastRecalledAt: anchor, updatedAt: anchor })
  const decayPercent = computePreferenceDecay(record, anchor + 45 * DAY)
  assert.ok(decayPercent !== null)
  assert.equal(preferenceNeedsReview({ confirmed: false, decayPercent }), true)
})
