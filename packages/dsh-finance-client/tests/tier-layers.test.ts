import { describe, expect, it } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createPlanSeam, layerTierMaps, normalizeTierMap } from '../src/client/plans.ts'

/**
 * S4：`tiers` 迁入 releaseBase 后的**分层语义**（SPEC INV-1 / §2.3）。
 *
 * 核心断言只有一条：releaseBase 是唯一结构源，settings 里的手填只能在官方表
 * 没覆盖的 key 上生效；且"被取代"必须能被报出来（不能静默忽略用户输入）。
 */

const legacy = (input: number) => [{ maxPromptTokens: 128_000, inputMicrosPerMtok: input, outputMicrosPerMtok: input * 4 }]
const spec = (input: number) => ({
  currency: 'CNY',
  tiers: [{ maxPromptTokens: 128_000, inputMicrosPerMtok: input, outputMicrosPerMtok: input * 4 }],
})

describe('layerTierMaps', () => {
  it('releaseBase 优先：同名 key 的用户手填被取代，并报为 shadowed', () => {
    const layered = layerTierMaps({ 'a/llm': spec(1_000_000) }, { 'a/llm': legacy(9_999_999) })
    expect(layered.tiers['a/llm'][0].tiers[0].inputMicrosPerMtok).toBe(1_000_000)
    expect(layered.shadowedKeys).toEqual(['a/llm'])
  })

  it('用户手填只补官方表没有的 key（legacy 兼容）', () => {
    const layered = layerTierMaps({ 'a/llm': spec(1_000_000) }, { 'b/llm': legacy(2_000_000) })
    expect(Object.keys(layered.tiers).sort()).toEqual(['a/llm', 'b/llm'])
    expect(layered.tiers['b/llm'][0].tiers[0].inputMicrosPerMtok).toBe(2_000_000)
    expect(layered.shadowedKeys).toEqual([])
  })

  it('releaseBase 为空时用户手填全部生效（未迁版宿主仍然可用）', () => {
    const layered = layerTierMaps(undefined, { 'a/llm': legacy(3_000_000) })
    expect(layered.tiers['a/llm'][0].tiers[0].inputMicrosPerMtok).toBe(3_000_000)
    expect(layered.shadowedKeys).toEqual([])
  })

  it('坏层不炸：非对象 / 垃圾形状一律当空表', () => {
    expect(layerTierMaps('nonsense', null).tiers).toEqual({})
    expect(layerTierMaps([1, 2], { 'a/llm': 'nope' }).shadowedKeys).toEqual([])
  })
})

describe('normalizeTierMap（双形状）', () => {
  it('旧裸数组 = 隐式 CNY / 无折扣；新 spec 保留字段', () => {
    const map = normalizeTierMap({
      'a/llm': legacy(1_000_000),
      'b/llm': { currency: 'USD', tiers: legacy(2_000_000), offPeakDiscount: 0.5 },
    })
    expect(map['a/llm'][0].currency).toBe('CNY')
    expect(map['a/llm'][0].offPeakDiscount).toBe(1)
    expect(map['b/llm'][0].currency).toBe('USD')
    expect(map['b/llm'][0].offPeakDiscount).toBe(0.5)
  })

  it('`#suffix` 归到剥净的 modelKey，同一 key 可挂多组', () => {
    const map = normalizeTierMap({ 'q/b#intl': spec(1), 'q/b': spec(2) })
    expect(Object.keys(map)).toEqual(['q/b'])
    expect(map['q/b'].map(g => g.key)).toEqual(['q/b#intl', 'q/b'])
  })
})

/** 最小 settings scope 桩：只实现 seam 用到的 getSnapshot / subscribe / set。 */
function scopeOf(layers: { base?: unknown; user?: unknown }): SettingsScope<{ plans?: unknown; tiers?: unknown; providers?: unknown }> {
  const snapshot = {
    status: 'ready' as const,
    value: {},
    base: layers.base,
    user: layers.user,
    revision: 1,
    writable: true,
    mode: 'memory' as const,
  }
  return {
    getSnapshot: () => snapshot as never,
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  } as unknown as SettingsScope<{ plans?: unknown; tiers?: unknown; providers?: unknown }>
}

describe('createPlanSeam 的阶梯价分层', () => {
  it('从 base / user 两层取 tiers，releaseBase 优先', () => {
    const seam = createPlanSeam(scopeOf({ base: { tiers: { 'a/llm': spec(1_000_000) } }, user: { tiers: { 'a/llm': legacy(9_999_999), 'c/llm': legacy(5) } } }))
    const snapshot = seam.getSnapshot()
    expect(snapshot.tiers['a/llm'][0].tiers[0].inputMicrosPerMtok).toBe(1_000_000)
    expect(snapshot.tiers['c/llm'][0].tiers[0].inputMicrosPerMtok).toBe(5)
    expect(snapshot.shadowedTierKeys).toEqual(['a/llm'])
  })

  it('用**原始的 user 层**判定覆盖：拿 resolved value 会把 base 的每个 key 误报为被覆盖', () => {
    // value 折了 base（真宿主的行为）。seam 必须读 user，而不是 value。
    const scope = scopeOf({ base: { tiers: { 'a/llm': spec(1_000_000) } }, user: { tiers: {} } })
    const seam = createPlanSeam(scope)
    expect(seam.getSnapshot().shadowedTierKeys).toEqual([])
  })

  it('没有 user 层时不报 shadowed（未登录/空 settings）', () => {
    const seam = createPlanSeam(scopeOf({ base: { tiers: { 'a/llm': spec(1) } }, user: undefined }))
    expect(seam.getSnapshot().shadowedTierKeys).toEqual([])
    expect(seam.getSnapshot().tiers['a/llm']).toBeDefined()
  })
})