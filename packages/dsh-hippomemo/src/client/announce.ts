/**
 * HippoMemo 自己的播报（评审 F7：**文案归模块**）。
 *
 * 壳（dsh-spark-dock 的 fairy 层）只订阅 kit 的播报总线并画气泡，不含任何本模块的
 * 字符串 —— 所以新增/修改这里的气泡文案**不需要动 dock 一行代码**。
 *
 * 订阅走 `api.events()`（kit 引用计数：与记忆面板同一条逻辑流，不会多开连接）；
 * `baseline` 帧（首次订阅 / 重连后的世代基线）不是真实写入，不播报，否则每次重连
 * 都会误报「新增记忆」。
 */
import { publishAnnouncement } from 'dsh-spark-plugin-kit/client'
import { createHippomemoApi, type MemoryChangeEvent } from './api.ts'

const api = createHippomemoApi()

/**
 * 启动 hippomemo 的播报订阅。
 * @returns disposer。
 */
export function startHippomemoAnnouncements(): () => void {
  return api.events((event: MemoryChangeEvent) => {
    if (event.baseline === true) return
    if (event.operation === 'put') {
      publishAnnouncement({ mood: 'happy', text: '写入了一条记忆', src: '记忆 HippoMemo · put' })
    } else if (event.operation === 'remove') {
      publishAnnouncement({ mood: 'alert', text: '删除了一条记忆', src: '记忆 HippoMemo · remove' })
    } else if (event.operation === 'crystallize') {
      publishAnnouncement({ mood: 'cheer', text: '结晶写入记忆库', src: '记忆 HippoMemo · crystallize' })
    }
  })
}
