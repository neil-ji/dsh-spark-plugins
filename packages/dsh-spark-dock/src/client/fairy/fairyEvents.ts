/**
 * 悬浮球的播报呈现层：**只订阅 kit 的播报总线**，自己不含任何插件文案
 * （评审 F7：文案映射归模块；壳只负责把播报画成气泡 + 情绪）。
 *
 * 去重（同一文案 4s 内不重复）由总线负责，见 `dsh-spark-plugin-kit/client`
 * 的 `announcements.ts`。
 */
export type { AnnounceMood as FairyMood } from 'dsh-spark-plugin-kit/client'
export { onAnnouncement as onFairyAnnouncement } from 'dsh-spark-plugin-kit/client'
