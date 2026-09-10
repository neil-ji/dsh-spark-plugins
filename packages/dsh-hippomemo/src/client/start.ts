/**
 * hippomemo 事件通道的客户端装配（单一入口，两处调用）。
 *
 * 平台规则（真宿主实测，与 spark 同）：
 *  - `remote.hippomemo` 不能写进 `inject`（本包 `$mount` 之后才提供的服务 → 注入会死锁）；
 *  - 取法是 `ctx.reflect.get('remote.hippomemo')`，且在 `await $mount(...)` 之后。
 *
 * 调用方：本包 client 半边（standalone）与 dsh-spark-dock 的 hippo embed（内嵌路径）。
 * 两侧都调用是安全的 —— `$mount` 对同一 contribution 重复挂载被平台容忍。
 */
import type { ClientContext } from 'dsh-spark-plugin-kit/client'
import { HIPPOMEMO_REMOTE_CONTRIBUTION } from '../wire.ts'
import { hippomemoChannelOf, setHippomemoEventChannel } from './api.ts'

/**
 * 挂载事件流描述符并注入通道。
 * @param ctx - client 根上下文（需 `remote` 与 `reflect`）。
 */
export async function startHippomemoEvents(ctx: ClientContext): Promise<void> {
  let mountError: unknown = null
  try {
    await ctx.remote.$mount(HIPPOMEMO_REMOTE_CONTRIBUTION)
  } catch (error) {
    // 同一个 contribution 可能被两个 bundle 各挂一次（本包 client 半边 + dock 的 embed 各自
    // 调用本函数），平台对「已挂载」是**抛错**而不是幂等：`client api: direct method
    // hippomemo/events is already mounted`（真宿主实测）。那不是失败 —— 命名空间已经在了，
    // 继续走 reflect 取通道即可；此前这里直接进 catch，导致**没有挂上的那一侧的订阅者拿不到
    // 通道**，记忆面板静默失去实时刷新。
    mountError = error
  }
  const channel = hippomemoChannelOf(ctx.remote, ctx.reflect)
  setHippomemoEventChannel(channel)
  if (channel === null) {
    console.warn('[dsh-hippomemo] 未取到 remote.hippomemo 命名空间，实时刷新将不可用', mountError ?? '')
  }
}
