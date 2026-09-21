/**
 * 重要度档位映射的单测：阈值边界（含"归上不归下"）、越界与非法值、
 * 档位↔代表值互逆，以及**展示映射不改存储**这条纪律的可执行证据
 * （任意 0..1 值都能读回同一个档位，不会被悄悄改写成代表值）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  IMPORTANCE_TIERS,
  importanceTier,
  isTierRepresentative,
  tierValue,
} from '../src/importance.ts'

test('阈值边界归上：0.85→关键、0.60→重要、0.35→一般，刚好差一点就降档', () => {
  assert.equal(importanceTier(0.85), 'critical')
  assert.equal(importanceTier(0.849), 'high')
  assert.equal(importanceTier(0.6), 'high')
  assert.equal(importanceTier(0.599), 'normal')
  assert.equal(importanceTier(0.35), 'normal')
  assert.equal(importanceTier(0.349), 'low')
})

test('覆盖 0..1 全域：任何值都落在一个档位里（不抛错、不返回 undefined）', () => {
  for (let i = 0; i <= 100; i += 1) {
    const tier = importanceTier(i / 100)
    assert.ok(IMPORTANCE_TIERS.includes(tier), String(i / 100) + ' → ' + String(tier))
  }
  assert.equal(importanceTier(0), 'low')
  assert.equal(importanceTier(1), 'critical')
})

test('越界与非法值按 clamp/中性处理，不抛错', () => {
  assert.equal(importanceTier(-1), 'low')
  assert.equal(importanceTier(2), 'critical')
  assert.equal(importanceTier(Number.NaN), 'normal', 'NaN 落到中性档而不是低档')
})

test('档位 → 代表值 → 档位 是自反的（编辑器写进去的值读回来还是那一档）', () => {
  for (const tier of IMPORTANCE_TIERS) {
    const value = tierValue(tier)
    assert.equal(importanceTier(value), tier, tier + ' 的代表值 ' + String(value))
    assert.equal(isTierRepresentative(value), true)
  }
})

test('展示映射不改存储：非代表值不会被"归一"成档位值', () => {
  // 0.62 落在"重要"档，但它自己不是代表值 —— 只读展示时绝不能回写成 0.7。
  assert.equal(importanceTier(0.62), 'high')
  assert.equal(isTierRepresentative(0.62), false)
  // 库里既有的 0.5 / 0.7 / 0.9 恰好都是代表值（历史数据多为此类）。
  assert.equal(isTierRepresentative(0.5), true)
  assert.equal(isTierRepresentative(0.1), false)
})
