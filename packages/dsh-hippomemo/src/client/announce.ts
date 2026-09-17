/**
 * HippoMemo 自己的播报（评审 F7：**文案归模块**）。
 *
 * 壳（dsh-spark-dock 的 fairy 层）只订阅 kit 的播报总线并画气泡，不含任何本模块的
 * 字符串 —— 所以新增/修改这里的气泡文案**不需要动 dock 一行代码**。
 *
 * 订阅走 `api.events()`（kit 引用计数：与记忆面板同一条逻辑流，不会多开连接）；
 * `baseline` 帧（首次订阅 / 重连后的世代基线）不是真实写入，不播报，否则每次重连
 * 都会误报「新增记忆」。
 *
 * 2026-09-17：三条文案此前是硬编码中文（英文语言下气泡仍是中文），改走本包字典。
 * 取词函数由 apply 绑定后传入 —— 本模块不持有 ctx（与 dock embed 两条装配路径都同形）。
 */
import { publishAnnouncement } from 'dsh-spark-plugin-kit/client'
import { createHippomemoApi, type MemoryChangeEvent } from './api.ts'
import type { HippomemoLocaleKey } from './locales.ts'

const api = createHippomemoApi()

/** 本包取词签名（`hippomemo.settings` 命名空间）。 */
export type HippomemoAnnounceTranslate = (key: HippomemoLocaleKey) => string

/**
 * 启动 hippomemo 的播报订阅。
 * @param t - 本包取词函数（apply 从 ctx.locale.bind 绑定后传入）。
 * @returns disposer。
 */
export function startHippomemoAnnouncements(t: HippomemoAnnounceTranslate): () => void {
  return api.events((event: MemoryChangeEvent) => {
    if (event.baseline === true) return
    if (event.operation === 'put') {
      publishAnnouncement({ mood: 'happy', text: t('announcePut'), src: 'HippoMemo · put' })
    } else if (event.operation === 'remove') {
      publishAnnouncement({ mood: 'alert', text: t('announceRemove'), src: 'HippoMemo · remove' })
    } else if (event.operation === 'crystallize') {
      publishAnnouncement({ mood: 'cheer', text: t('announceCrystallize'), src: 'HippoMemo · crystallize' })
    }
  })
}
