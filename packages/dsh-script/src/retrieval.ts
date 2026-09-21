/**
 * 检索口径（Spec §5.4）—— 纯函数叶子模块。
 *
 * `script_list`（工具）/ `GET /scripts?q=`（人面 HTTP）/ 人面检索框三处**共用**这一个函数：
 * 口径只写一次，谁也别自己 `includes` 一遍。这与 INV-7（成功率只用 `metrics.ts` 那一处除法）
 * 是同一个理由 —— 同一个问题在两处各答一遍，迟早给出两个答案。
 *
 * 权重表是规范的一部分（Spec §5.4），改权重 = 先改 Spec 再改这里。
 */
import type { ScriptView } from 'dsh-script-wire'

/** 可检索字段与权重（Spec §5.4 表）。 */
export const SEARCH_FIELD_WEIGHTS = {
  name: 4,
  tags: 2,
  triggers: 2,
  searchTerms: 2,
  description: 1,
} as const

export type SearchField = keyof typeof SEARCH_FIELD_WEIGHTS

/** 一条命中的字段与命中值（单测与诊断用）。 */
export interface SearchHit {
  readonly field: SearchField
  readonly value: string
}

/** 检索面所需的最小记录形状。 */
export type SearchableRecord = Pick<ScriptView, 'name' | 'description' | 'tags' | 'triggers'> & {
  readonly searchTerms?: readonly string[] | undefined
}

/** 查询归一化（大小写不敏感 + 去掉首尾空白）。 */
export function normalizeNeedle(q: string): string {
  return q.trim().toLowerCase()
}

/** 记录上所有可检索的 `(字段, 文本)` 对。 */
export function searchableFields(record: SearchableRecord): SearchHit[] {
  const hits: SearchHit[] = [
    { field: 'name', value: record.name },
    { field: 'description', value: record.description },
  ]
  for (const tag of record.tags) hits.push({ field: 'tags', value: tag })
  for (const trigger of record.triggers) hits.push({ field: 'triggers', value: trigger })
  for (const term of record.searchTerms ?? []) hits.push({ field: 'searchTerms', value: term })
  return hits
}

/**
 * 命中的字段列表（子串匹配，大小写不敏感）。
 * @param record - 待检索记录。
 * @param needle - 已归一化的查询串（空串返回空数组）。
 */
export function searchHits(record: SearchableRecord, needle: string): SearchHit[] {
  if (needle.length === 0) return []
  return searchableFields(record).filter(hit => hit.value.toLowerCase().includes(needle))
}

/**
 * 匹配得分（Spec §5.4）：按字段权重累加。`0` = 未命中 —— 过滤与排序都由它一个口径决定。
 * @param record - 待检索记录。
 * @param needle - 已归一化的查询串。
 */
export function matchScore(record: SearchableRecord, needle: string): number {
  let score = 0
  for (const hit of searchHits(record, needle)) score += SEARCH_FIELD_WEIGHTS[hit.field]
  return score
}
