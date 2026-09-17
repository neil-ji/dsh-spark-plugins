/**
 * 失败反馈的**界面文案归一**（PCQA-003）与**反馈状态机**（PCQA-013）。
 *
 * 宿主抛出的原始串是给开发者看的英文技术串（例如
 * `github: GITHUB_TOKEN is not configured`，见 dsh-github/src/github-service.ts），
 * 不许裸奔到面板上。这里把**已知**的宿主失败形态映射到本包 locale key；
 * 未命中的未知错误保留原始 message 但挂上本地化前缀，原始串另存 title
 * 保持可追查（验收口径：可读 + 可操作 + 原始串不丢）。
 *
 * 反馈用**一个**可辨识联合表示：成功 / 失败二选一，同屏不可能出现两条互相
 * 矛盾的播报（旧实现用 notice + testError 两个 state，失败时也会播「已保存」）。
 *
 * 纯函数（不 import React / 不碰 ctx），便于单测。
 */
import type { GithubKey, GithubTranslate } from './locales.ts'

/** 界面就地显示的一条反馈：成功或失败，**二选一**（PCQA-013 的结构性保证）。 */
export type Feedback =
  | { ok: true; text: string }
  | { ok: false; text: string; detail?: string }

/** 失败反馈（{@link Feedback} 的失败支）。 */
export type FailureFeedback = Extract<Feedback, { ok: false }>

/**「已保存」类成功反馈。 */
export function succeeded(text: string): Feedback {
  return { ok: true, text }
}

/**
 * 宿主 `GithubService.token()` 在缺令牌时抛出的原文
 * （dsh-github/src/github-service.ts 的 `MISSING_CREDENTIAL`）。
 *
 * 客户端前置判空时直接拿它走**同一条映射**：本地判空与宿主报错共用一份文案，
 * 不会因为省掉一次请求而出现两种说法。
 */
export const HOST_MISSING_TOKEN_ERROR = 'github: GITHUB_TOKEN is not configured'

/** 已知宿主失败形态 → locale key（先匹配先赢，顺序即优先级）。 */
const KNOWN_FAILURES: ReadonlyArray<readonly [RegExp, GithubKey]> = [
  [/GITHUB_TOKEN is not configured|MISSING_CREDENTIAL/i, 'errTokenMissing'],
  [/Bad credentials|Unauthorized|\b401\b/i, 'errInvalidToken'],
]

function localize(raw: string, prefixKey: GithubKey, t: GithubTranslate): FailureFeedback {
  const message = raw.trim()
  if (message === '') return { ok: false, text: t(prefixKey) }
  for (const [pattern, key] of KNOWN_FAILURES) {
    if (pattern.test(message)) return { ok: false, text: t(prefixKey) + ': ' + t(key) }
  }
  // 未知失败：本地化前缀 + 原始 message，原始串另存 title（可追查）。
  return { ok: false, text: t(prefixKey) + ': ' + message, detail: message }
}

/**
 * 连接测试失败（前缀「连接失败」）。
 * @param raw - 宿主信封 error.message 或抛出物的 message。
 * @param t - 本命名空间取词函数。
 */
export function describeConnectionFailure(raw: string, t: GithubTranslate): FailureFeedback {
  return localize(raw, 'testFail', t)
}

/**
 * 页面动作失败（保存令牌 / 移除令牌 / 保存配置，前缀「操作失败」）。
 * @param raw - 宿主信封 error.message 或抛出物的 message。
 * @param t - 本命名空间取词函数。
 */
export function describeActionFailure(raw: string, t: GithubTranslate): FailureFeedback {
  return localize(raw, 'actionFail', t)
}
