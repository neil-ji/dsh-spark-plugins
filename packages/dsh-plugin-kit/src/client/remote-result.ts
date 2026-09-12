/**
 * Remote 结果语义的**唯一定义处**（评审 F12：三家连接器曾各写一套错误表达）。
 *
 * ## 统一约定（ADR-005 ⑤）
 *
 * 1. **传输层只有一个信封**：每次 Remote 调用返回 `RemoteResult<T>`
 *    （`{ok:true, value}` / `{ok:false, error:{code, message}}`）。失败文案**只**
 *    从 `error.message` 取，任何一层都不得另造一套错误字段，也不得在成功值里
 *    再嵌一层表示传输失败的 `ok`。
 * 2. **页面加载路径**（主数据）失败 → `unwrapRemote` **抛错**，交给
 *    `PageLoader` 统一转成 `status:'error'` + 重试按钮。
 * 3. **操作路径**（保存 / 删除 / 测试连接）失败 → 返回 `string | undefined`
 *    文案，由表单就地显示；**不**把整页拖进错误态。
 * 4. **次要数据**失败 → **不得静默丢弃**（F12 的 npm `token.status` 现场）：
 *    记进状态里的独立字段并在页面上降级提示，主数据照常可用。
 * 5. **值内领域结论**（`GithubProxyTestValue.ok`、`NpmTokenTestView.ok`、
 *    `FinanceCommunitySyncResult.ok`）是「探测/业务跑完了，结论是失败」，**不是**
 *    传输错误 —— 它们与信封的 `ok` 语义正交，页面上必须显示成业务提示而不是
 *    「未配置」。
 *
 * @module dsh-spark-plugin-kit/client
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** 任意抛出物的可读文案（约定的第 1 条：文案只此一处生成）。 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 读取一次 Remote 调用的失败文案。
 * @returns 失败时是 `error.message`；成功时 `undefined`。
 */
export function remoteFailureOf<T>(result: RemoteResult<T>): string | undefined {
  return result.ok ? undefined : result.error.message
}

/**
 * 拆开信封：成功取值，失败抛 `Error(error.message)`。
 * 抛出的错误由页面加载骨架（`PageLoader`）统一转成错误态。
 */
export function unwrapRemote<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
