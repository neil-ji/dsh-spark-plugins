/**
 * 作用域解析（Spec §2.3）—— 与 HippoMemo 同义的域词汇在这里落地为纯函数。
 *
 * 三值语义：
 *   - `global`    跨工作区可见；
 *   - `workspace` 绑定写入时的 `workspacePath`（= 当时 session cwd），精确匹配；
 *   - `project`   绑定**项目根**（最近的含 `.git` 的祖先目录，无则回退该路径本身）。
 *
 * F1 规则（Spec §2.3 + §5）：`workspacePath === null` 视为**未绑定 → 全工作区可见**
 * （种子与系统写入即这类）；`global` 的"已确认"收敛留到 F3。
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { ScriptScope, ScriptView } from 'dsh-script-wire'

/** 目录里是否有项目标记（默认看 `.git`；注入以便单测）。 */
export type HasProjectMarker = (dir: string) => boolean

export const defaultHasProjectMarker: HasProjectMarker = dir => existsSync(join(dir, '.git'))

/**
 * 项目根：从 `path` 向上找到最近含项目标记的祖先目录；没有则回退路径本身。
 * @param path - 起始目录（通常是一次会话的 cwd）。
 * @param hasMarker - 目录标记判定（可注入）。
 */
export function projectRoot(path: string, hasMarker: HasProjectMarker = defaultHasProjectMarker): string {
  let current = resolve(path)
  while (true) {
    if (hasMarker(current)) return current
    const parent = dirname(current)
    if (parent === current) return resolve(path)
    current = parent
  }
}

/** 一条记录是否与该工作区匹配（`workspace` 精确、`project` 按项目根）。 */
export function workspaceMatches(
  record: Pick<ScriptView, 'scope' | 'workspacePath'>,
  cwd: string | undefined,
  hasMarker: HasProjectMarker = defaultHasProjectMarker,
): boolean {
  if (record.workspacePath === null) return true
  if (cwd === undefined) return false
  if (record.scope === 'project') {
    return projectRoot(record.workspacePath, hasMarker) === projectRoot(cwd, hasMarker)
  }
  return record.workspacePath === cwd
}

/** 可见性：`active` + 未过期 + 作用域匹配。目录注入与检索共用这一条口径。 */
export function isVisible(
  record: Pick<ScriptView, 'scope' | 'workspacePath' | 'status' | 'expiresAt'>,
  cwd: string | undefined,
  now: number,
  hasMarker: HasProjectMarker = defaultHasProjectMarker,
): boolean {
  if (record.status !== 'active') return false
  if (record.expiresAt !== null && record.expiresAt <= now) return false
  if (record.scope === 'global') return true
  return workspaceMatches(record, cwd, hasMarker)
}

/** 显式作用域过滤（`current` = 当前工作区可见集；`undefined` = 不过滤）。 */
export function matchesScopeFilter(
  record: Pick<ScriptView, 'scope' | 'workspacePath' | 'status' | 'expiresAt'>,
  filter: ScriptScope | 'current' | undefined,
  cwd: string | undefined,
  now: number,
  hasMarker: HasProjectMarker = defaultHasProjectMarker,
): boolean {
  if (filter === undefined) return true
  if (filter === 'current') return isVisible(record, cwd, now, hasMarker)
  return record.scope === filter
}
