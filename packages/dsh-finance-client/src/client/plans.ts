/**
 * 套餐设置面适配：把 settings 命名空间 `finance` 的 scope 收敛成控制器要的 seam。
 *
 * 只有"读 + 整体写回 plans"两条能力，不提供任何独立配置页；候选 provider 由账本
 * 里真正用过的厂商决定（面板侧过滤），所以不会出现你没接入的厂商。
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  FinancePlanEntry,
  FinancePlanPeriod,
  FinanceTierCacheWriteTtl,
  FinanceTierEntry,
  FinanceTierGroup,
} from 'dsh-spark-finance/types'
import type { FinancePlanSeam } from './controller.ts'

/** settings 里 `finance` 命名空间的形状（面板只用 plans 与 tiers 两个字段）。 */
export interface FinanceSettingsSection {
  plans?: unknown
  tiers?: unknown
  /** provider 条目（含用户打的计费方式标记与手动余额）。 */
  providers?: unknown
}

/** 待定池打标补丁（SPEC §5.4）：mode 必填，手动余额 / autoFetch 可选。 */
export interface FinanceProviderEntryPatch {
  mode: 'metered' | 'plan' | 'free'
  manualBalanceMicros?: number
  autoFetchBalance?: boolean
}

/**
 * 容错归一化阶梯价：与宿主 `normalizeFinanceTiers` 同一口径（SPEC §2.3）——
 * 两种形状都吃、坏组整组丢弃、档位升序、兜底档 0 排最后。
 *
 * 设置里没写、或写了坏档，都退化成"没有阶梯价"，面板据此显示
 * "该模型没有阶梯价，拆分不改变单价"。key 的 `#suffix` 在这里只记录，
 * 匹配留给消费者按「精确 key → 剥后缀回退」解析。
 */
export function normalizeTierMap(value: unknown): Record<string, readonly FinanceTierGroup[]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, readonly FinanceTierGroup[]> = {}
  for (const [key, rawGroup] of Object.entries(value as Record<string, unknown>)) {
    const group = normalizeTierGroup(key, rawGroup)
    if (group === undefined) continue
    const list = out[group.modelKey] ?? []
    out[group.modelKey] = [...list, group]
  }
  return out
}

/** 一个 key 的原始值 → 归一化分组；不可信时 undefined（整组丢弃，不猜）。 */
function normalizeTierGroup(key: string, value: unknown): FinanceTierGroup | undefined {
  // 旧形状：裸档位数组（隐式 CNY、无折扣、无生效窗口）。
  if (Array.isArray(value)) {
    const tiers = normalizeTierEntries(value)
    if (tiers === undefined) return undefined
    return { ...splitTierKey(key), key, currency: 'CNY', tiers, offPeakDiscount: 1 }
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const tiers = normalizeTierEntries(record.tiers)
  if (tiers === undefined) return undefined
  const effectiveFrom = normalizeTierBound(record.effectiveFrom)
  const effectiveTo = normalizeTierBound(record.effectiveTo)
  return {
    ...splitTierKey(key),
    key,
    currency: normalizeTierLabel(record.currency) ?? 'CNY',
    tiers,
    offPeakDiscount: normalizeOffPeakDiscount(record.offPeakDiscount),
    ...effectiveFrom !== undefined ? { effectiveFrom } : {},
    ...effectiveTo !== undefined ? { effectiveTo } : {},
  }
}

/** 拆分 `modelKey#suffix`：只按最后一个 `#` 切分（modelKey 本身不含 `#`）。 */
function splitTierKey(key: string): { modelKey: string; suffix?: string } {
  const index = key.lastIndexOf('#')
  if (index <= 0) return { modelKey: key }
  const suffix = key.slice(index + 1).trim()
  if (suffix === '') return { modelKey: key }
  return { modelKey: key.slice(0, index), suffix }
}

/**
 * 分层后的生效阶梯价（INV-1 单一结构源）。
 *
 * `tiers` 现在是 releaseBase 的**结构维度**（生成物写进 `cordis.patch.yml` 的
 * `config.tiers`，由 settings 的 composition `base` 层下发）。settings 里的 `tiers`
 * 降级为 **legacy overlay**：只有在 releaseBase **没有**该 key 时才生效。
 */
export interface FinanceTierLayers {
  /** 生效的阶梯价（releaseBase 优先，legacy 只补空缺键）。 */
  tiers: Record<string, readonly FinanceTierGroup[]>
  /**
   * 被 releaseBase 取代的手填键（用户仍填着、但官方表已有该 key）。
   * 不是错误，但必须能说清 —— 否则"我填的价没生效"会变成静默失败（INV-3 的精神）。
   */
  shadowedKeys: readonly string[]
}

/**
 * 按 INV-1 分层：`base`（releaseBase，唯一结构源）优先；`user`（legacy 手填）
 * 只补 `base` 没有的 modelKey。
 *
 * 依据：宿主 `installSection(ctx, ns, Config, config)` 把 `cordis.patch.yml` 的
 * composition entry 注册成 settings 的 `base` 层，客户端 scope 快照因此同时给出
 * `base` / `user` / `value` 三层 —— releaseBase 的阶梯价无需新增 Remote 端点即可到达面板。
 */
export function layerTierMaps(base: unknown, user: unknown): FinanceTierLayers {
  const baseMap = normalizeTierMap(base)
  const userMap = normalizeTierMap(user)
  const tiers: Record<string, readonly FinanceTierGroup[]> = { ...baseMap }
  const shadowedKeys: string[] = []
  for (const [modelKey, groups] of Object.entries(userMap)) {
    if (baseMap[modelKey] !== undefined) {
      shadowedKeys.push(modelKey)
      continue
    }
    tiers[modelKey] = groups
  }
  return { tiers, shadowedKeys: shadowedKeys.sort() }
}

/** settings 里 `tiers` 的原始层（形状不可信，一律当对象过滤）。 */
function tierLayerOf(layer: unknown): unknown {
  if (layer === null || typeof layer !== 'object') return undefined
  return (layer as { tiers?: unknown }).tiers
}

/** 一组档位：坏档跳过、升序、兜底档 0 恒排最后；无可信档位时 undefined。 */
function normalizeTierEntries(list: unknown): readonly FinanceTierEntry[] | undefined {
  if (!Array.isArray(list)) return undefined
  const entries: FinanceTierEntry[] = []
  for (const raw of list) {
    if (raw === null || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const maxPromptTokens = Number(record.maxPromptTokens)
    const input = Number(record.inputMicrosPerMtok)
    const output = Number(record.outputMicrosPerMtok)
    if (!Number.isFinite(maxPromptTokens) || maxPromptTokens < 0) continue
    if (!Number.isFinite(input) || input < 0) continue
    if (!Number.isFinite(output) || output < 0) continue
    const absoluteRead = Number(record.cacheReadMicrosPerMtok)
    const absoluteWrite = Number(record.cacheWriteMicrosPerMtok)
    const readMultiplier = Number(record.cacheReadMultiplier)
    const writeMultiplier = Number(record.cacheWriteMultiplier)
    const ttl = normalizeTierWriteTtl(record.cacheWriteTtl)
    entries.push({
      maxPromptTokens: Math.round(maxPromptTokens),
      inputMicrosPerMtok: Math.round(input),
      outputMicrosPerMtok: Math.round(output),
      ...Number.isFinite(absoluteRead) && absoluteRead >= 0 ? { cacheReadMicrosPerMtok: Math.round(absoluteRead) } : {},
      ...Number.isFinite(absoluteWrite) && absoluteWrite >= 0 ? { cacheWriteMicrosPerMtok: Math.round(absoluteWrite) } : {},
      ...Number.isFinite(readMultiplier) && readMultiplier >= 0 ? { cacheReadMultiplier: readMultiplier } : {},
      ...Number.isFinite(writeMultiplier) && writeMultiplier >= 0 ? { cacheWriteMultiplier: writeMultiplier } : {},
      ...ttl !== undefined ? { cacheWriteTtl: ttl } : {},
    })
  }
  if (entries.length === 0) return undefined
  const bounded = entries.filter((entry) => entry.maxPromptTokens > 0).sort((a, b) => a.maxPromptTokens - b.maxPromptTokens)
  const catchAll = entries.filter((entry) => entry.maxPromptTokens === 0)
  return [...bounded, ...catchAll]
}

/** 缓存写 TTL 绝对价：只留可信档位；一个都没有时 undefined（不留空壳）。 */
function normalizeTierWriteTtl(value: unknown): FinanceTierCacheWriteTtl | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const out: FinanceTierCacheWriteTtl = {}
  const m5 = Number(record.m5)
  if (Number.isFinite(m5) && m5 >= 0) out.m5 = Math.round(m5)
  const h1 = Number(record.h1)
  if (Number.isFinite(h1) && h1 >= 0) out.h1 = Math.round(h1)
  return out.m5 === undefined && out.h1 === undefined ? undefined : out
}

/** 生效窗口折算：数字 = epoch ms；日期串 = Date.parse；无法解析 / 缺省 = 无界。 */
function normalizeTierBound(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** 时段折扣：0 < r <= 1 才可信（0 = 免费不是折扣，当噪声丢掉）。 */
function normalizeOffPeakDiscount(value: unknown): number {
  const ratio = Number(value)
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) return 1
  return ratio
}

/** 非空字符串标签，否则 undefined。 */
function normalizeTierLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const PERIODS: readonly FinancePlanPeriod[] = ['month', 'month-week', 'month-week-5h']

function isPeriod(value: unknown): value is FinancePlanPeriod {
  return typeof value === 'string' && (PERIODS as readonly string[]).includes(value)
}

/**
 * 容错归一化：settings 的解析结果可能来自旧版本或手工编辑，字段缺失/类型不对一律
 * 跳过该条（不猜），坏数据不会让整张卡崩掉。
 */
export function normalizePlanList(value: unknown): FinancePlanEntry[] {
  if (!Array.isArray(value)) return []
  const out: FinancePlanEntry[] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
    const monthlyMicros = Number(record.monthlyMicros)
    if (provider === '' || !Number.isFinite(monthlyMicros) || monthlyMicros < 0) continue
    const quotaTokens = Number(record.quotaTokens)
    const effectiveFrom = Number(record.effectiveFrom)
    out.push({
      provider,
      monthlyMicros: Math.round(monthlyMicros),
      currency: typeof record.currency === 'string' && record.currency !== '' ? record.currency : 'CNY',
      ...(Number.isFinite(quotaTokens) && quotaTokens > 0 ? { quotaTokens: Math.round(quotaTokens) } : {}),
      ...(isPeriod(record.periodLabel) ? { periodLabel: record.periodLabel } : {}),
      effectiveFrom: Number.isFinite(effectiveFrom) ? effectiveFrom : 0,
    })
  }
  return out
}

/** settings 侧的写入形状（与宿主 Config schema 对齐）。 */
function toPlanInput(plan: FinancePlanEntry): Record<string, unknown> {
  return {
    provider: plan.provider,
    monthlyMicros: plan.monthlyMicros,
    currency: plan.currency,
    ...(plan.quotaTokens !== undefined ? { quotaTokens: plan.quotaTokens } : {}),
    ...(plan.periodLabel !== undefined ? { periodLabel: plan.periodLabel } : {}),
    effectiveFrom: plan.effectiveFrom,
  }
}

/** provider id 归一（大小写与分隔符不敏感），与宿主 `providerKey` 同口径。 */
function sameProvider(entry: Record<string, unknown>, provider: string): boolean {
  const left = String(entry.provider ?? '').toLowerCase().replace(/[-_.]/g, '')
  return left !== '' && left === provider.toLowerCase().replace(/[-_.]/g, '')
}

/** 读 settings 里的 provider 条目列表（形状不可信，一律当数组过滤）。 */
function snapshotProviders(scope: SettingsScope<FinanceSettingsSection>): Array<Record<string, unknown>> {
  const value = scope.getSnapshot().value?.providers
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object') : []
}

/** 把平台 settings scope 包成控制器要的 seam。 */
export function createPlanSeam(scope: SettingsScope<FinanceSettingsSection>): FinancePlanSeam {
  return {
    getSnapshot: () => {
      const snapshot = scope.getSnapshot()
      // INV-1：releaseBase（composition `base` 层）是唯一结构源，settings 的 `tiers`
      // 只作为 legacy overlay 补空缺键。**必须读原始的 `user` 层**（而不是已解析的
      // `value`）—— `value` 已经把 base 折进去了，拿它当用户层会把 releaseBase 的每个
      // key 都误判成"被用户覆盖"。两层都由 scope 快照直接给出，无需额外端点。
      const layered = layerTierMaps(tierLayerOf(snapshot.base), tierLayerOf(snapshot.user))
      return {
        plans: normalizePlanList(snapshot.value?.plans),
        tiers: layered.tiers,
        shadowedTierKeys: layered.shadowedKeys,
        writable: snapshot.writable,
      }
    },
    subscribe: (listener) => scope.subscribe(listener),
    write: async (next) => {
      await scope.set('plans', next.map(toPlanInput))
    },
    writeBillingMode: async (provider, mode) => {
      const list: Array<Record<string, unknown>> = snapshotProviders(scope)
      const index = list.findIndex((entry) => sameProvider(entry, provider))
      const next: Record<string, unknown> = index >= 0 ? { ...list[index] } : { provider, currency: 'CNY' }
      next.billingMode = mode
      const merged = [...list]
      if (index >= 0) merged[index] = next
      else merged.push(next)
      await scope.set('providers', merged)
    },
    // 待定池打标（SPEC §5.4）：计费方式 + 可选手动余额 / autoFetch 一次原子写。
    writeProviderEntry: async (provider, patch) => {
      const list: Array<Record<string, unknown>> = snapshotProviders(scope)
      const index = list.findIndex((entry) => sameProvider(entry, provider))
      const next: Record<string, unknown> = index >= 0 ? { ...list[index] } : { provider, currency: 'CNY', totalPriceMicros: 0 }
      next.billingMode = patch.mode
      if (patch.manualBalanceMicros !== undefined) {
        next.manualBalanceMicros = patch.manualBalanceMicros
        if (next.autoFetchBalance === undefined) next.autoFetchBalance = false
      }
      if (patch.autoFetchBalance !== undefined) next.autoFetchBalance = patch.autoFetchBalance
      const merged = [...list]
      if (index >= 0) merged[index] = next
      else merged.push(next)
      await scope.set('providers', merged)
    },
  }
}

/** 主单位（元 / $）→ micros，供面板输入框使用。 */
export function majorToMicros(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 1_000_000)
}

/** micros → 主单位文本（输入框回填）。 */
export function microsToMajor(micros: number): string {
  return String(micros / 1_000_000)
}

export { PERIODS as FINANCE_PLAN_PERIODS }
