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
  try {
    await ctx.remote.$mount(HIPPOMEMO_REMOTE_CONTRIBUTION)
    const channel = hippomemoChannelOf(ctx.remote, ctx.reflect)
    setHippomemoEventChannel(channel)
    if (channel === null) console.warn('[dsh-hippomemo] 未取到 remote.hippomemo 命名空间，实时刷新将不可用')
  } catch (error) {
    console.warn('[dsh-hippomemo] 事件流描述符 mount 失败，实时刷新将不可用：', error)
  }
}
