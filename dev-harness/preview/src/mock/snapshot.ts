/**
 * 预览侧的 bindSnapshotSelector：**直接复用 kit 的实现**，不再复制一份。
 *
 * 这里原先是 8 行逐字副本（评审 F9：「harness 复制了客户端逻辑」），理由是
 * 「根 node_modules 不 link 工作区包，而各插件的 lib/embed.cjs 已经把 plugin-kit
 * 内联进去了，复制比再加一条 alias 更稳」。该理由的两条现在都已失效：
 *
 *  - P4（2026-09-11）删掉了 `lib/embed.cjs` 这个第二产物；
 *  - 预览服务器早就显式 alias 了 `dsh-spark-plugin-kit/client`（bundle 与 source
 *    两种口径各一条，见 `dev-harness/preview/server.mjs` 的 `*_ALIASES`）。
 *
 * 而副本的代价是真的：kit 改了实现它不会跟着改 —— 这正是 W4/F9 点名的
 * 「预览比真宿主宽松」那一类漂移。真实现见 `packages/dsh-plugin-kit/src/client/snapshot.ts`。
 */
export { bindSnapshotSelector } from 'dsh-spark-plugin-kit/client'
export type { SnapshotSelectorHook } from 'dsh-spark-plugin-kit/client'
