/**
 * dsh-spark-plugin-kit host 侧工具。
 *
 * 已提取：
 *  - `bridgeEvents()`：cordis 事件 → typert stream 的 pull 型帧序列（队列 / 取消 / 基线帧），
 *    dsh-spark 与 dsh-hippomemo 共用（ADR-001/004）。
 *
 * 待提取（随 finance / connector 迁入）：
 *  - remote 命名空间的取用（`$mount` + `reflect.get('remote.<ns>')` 的固定套路）
 *  - http 路由注册样板、storage domain 模式
 */
export { bridgeEvents } from './host/stream.ts'
export type { BridgeEventsOptions, FramedEvent } from './host/stream.ts'

export const pluginKitVersion = '0.1.0'
