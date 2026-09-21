/**
 * 判重原语（Spec §3.2）—— 纯函数叶子模块。
 *
 * 写入时的判重（`ScriptService.save`）与治理期的**回溯扫描**（`governance.ts` 的
 * 合并建议）必须用同一套规则，否则「save 说重复、治理面说不是」这种自相矛盾迟早出现。
 * 所以规则只在这里定义一次。
 */
import { createHash } from 'node:crypto'
import type { ScriptSaveInput, ScriptStep, ScriptView } from 'dsh-script-wire'

/** 触发词 Jaccard 判重阈值（Spec §3.2 第 2 条）。 */
export const DUPLICATE_JACCARD_THRESHOLD = 0.8

/** 名称归一化（判重用）。 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replaceAll(/\s+/g, ' ').trim()
}

/** 步骤归一化文本的指纹（判重用）。 */
export function stepsFingerprint(steps: readonly ScriptStep[]): string {
  const canonical = steps.map(step => `${step.kind}:${step.payload.trim()}`).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

/** 触发词集合的 Jaccard 相似度（判重用）。 */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a.map(value => value.toLowerCase()))
  const right = new Set(b.map(value => value.toLowerCase()))
  if (left.size === 0 && right.size === 0) return 1
  let shared = 0
  for (const value of left) if (right.has(value)) shared += 1
  const union = left.size + right.size - shared
  return union === 0 ? 0 : shared / union
}

/**
 * 判重（Spec §3.2 第 2 条）：同名，或（triggers Jaccard ≥ 0.8 且步骤指纹相同）。
 * 已归档条目不参与判重（它已经退场，不拦新写入）。
 * @returns 命中的既有条目，未命中为 undefined。
 */
export function findDuplicate(
  candidate: Pick<ScriptSaveInput, 'name' | 'steps' | 'triggers'>,
  existing: readonly ScriptView[],
): ScriptView | undefined {
  const name = normalizeName(candidate.name)
  const fingerprint = stepsFingerprint(candidate.steps)
  return existing.find(record =>
    record.status !== 'archived'
    && (normalizeName(record.name) === name
      || (stepsFingerprint(record.steps) === fingerprint && jaccard(record.triggers, candidate.triggers ?? []) >= DUPLICATE_JACCARD_THRESHOLD)))
}
