# dsh-spark-dock

DSH Web 宿主的全局悬浮球 + 插件统一面板（Spark Dock）。设计预览见
[`docs/spark-dock-preview/`](../../docs/spark-dock-preview/)，交互逻辑
（拖拽四角吸附、面板反向弹出、视口夹取、遮球提升）均移植自
该预览的已验证实现。悬浮球的**视觉规格与硬约束见
[`design-system/spark-dock/MASTER.md` §4.1](../../design-system/spark-dock/MASTER.md)**。

## 悬浮球：静默形态（2026-09-10 起）

球当前是一个**静态玻璃品牌标识**：48px 透镜（92% 浮层面 + backdrop blur + 顶部冷光）
+ ui-kit `IconSparkles`（`--spk-brand-fg`）+ 1px 冷灰描边 + 品牌外发光。
**无表情、无持续动画**：hover / 按下 / 展开 / 聚焦只改描边色、投影与内阴影，几何与尺寸不动。

球的两层能力由 `src/client/DockOverlay.tsx` 的两个开关分别控制（规格见 MASTER §4.1 / §4.2）：

| 开关 | 现值 | 管什么 |
| --- | --- | --- |
| `BALL_FACE_ENABLED` | `false` | Fairy 表情、情绪染光、球体动画（浮动/呆毛/张嘴闪烁/hover 缩放） |
| `BALL_BUBBLE_ENABLED` | `true` | **发言**：模块自己发布的播报气泡（`publishAnnouncement` → kit 播报总线；文案与情绪由 spark 的 `SparkDockModule` 映射，壳只呈现），纯文本、零动画、4.2s 自动消失、`role=status` |

- 两个都置 `true` 即恢复整套角色层；球身样式不用动（`mood-alert` / `mood-sad` 染光档与整套
  fairy CSS 都保留着）。角色层的设计资产留档在 `docs/spark-dock-preview/`（fairy.css / fairy.js）。
- **事件通道（2026-09-10，ADR-001）**：面板实时刷新与「发言」都不再自建 SSE ——
  宿主把 cordis 事件桥成 `spark.events()`（typert stream，跑在平台 remote mux 上，逐项 schema
  校验、可取消），客户端由 `dsh-spark-plugin-kit/client` 的订阅运行时统一消费
  （扇出 / 引用计数 / `ready` 基线重同步）。原先的 `streams.ts` 已删除，三条
  `/sparks|/proposals|/scripts/events` 端点已从产品移除；记忆模块同理走 `hippomemo.events()`。
  验收脚本：`node dev-harness/real-host-check.mjs`（真宿主，24 项，含模块子槽与 typert 注册面断言）。
- 唯一保留的「运动」是**拖拽释放后的四角吸附位移**（JS 设的 left/top 240ms 过渡）——
  它是位置反馈而非装饰，去掉会让球瞬移；面板开合过渡同理（属于面板，不属于球）。
- 发言的事件覆盖目前只有火花流两种 op；proposals / hippomemo / github / npm 的播报尚未实现。

## 功能（全部真实数据）

| 模块 | 子页 | 数据源 |
|------|------|--------|
| 火花 | 火花流 / 涌现提议 / 脚本目录 / Graph | `/sparks` `/proposals` `/scripts` http api（Graph 待后端查询 API） |
| 记忆 | 总览 / 记忆 / 偏好 / 进化 | `/hippomemo` api（stats/搜索/偏好/candidates/预演）+ SSE |
| 成本 | 余额 | `remote.finance.listProviders` |
| GitHub | 连接 | `remote.github.whoami` + 测试连接 |
| npm | 发布 | `remote.npm['status.get']` 注册表 + 套件包状态 |

Fairy 层（**当前 dormant，见上文开关**）：球体表情（呆毛火花/笑眼/嘴型/思考泡）+ 播报气泡，
由三条真实 SSE 流驱动（sparks/proposals/hippomemo events）。克制原则：纯事件驱动
不轮询、成功类事件只在发生那一刻播报、4s 去重窗口。

## 架构

- **挂载点**：宿主 `dsh-client-ui-layout` 声明的 `shell.overlay` slot
  （list / root / click-through 层，additive），注册方式与
  `dsh-client-ui-commands` 的命令弹层一致（`ctx.slots.inject` + `ctx.slots.register`）。
- **形态**：client-only 包 —— node 半边为空 loader 入口，浏览器半边由
  `window.__ModuleLoader__.load` 包裹；宿主经 `cordis.patch.yml` 行装载。
- **CSS**：幂等注入 `style[data-plugin-css="dsh-spark-dock"]`，作用域
  `[data-plugin="dsh-spark-dock"]`；shell.overlay 默认 click-through，
  组件根节点带 `pointer-events: auto`。
- **Remote namespaces**（finance/github/npm）由各自 client bundle 异步
  `$mount`，dock 侧惰性读取（`reflect.ts`），apply 时不缓存。

## 开发

```bash
pnpm --filter dsh-spark-dock typecheck
pnpm --filter dsh-spark-dock build
node scripts/install-profile.mjs web   # pack 全部插件并装入 ~/.dsh/profiles/web
```

装载要求（手工维护，`install-profile` 不动它）：

1. `plugin-registry.json` 登记 `dsh-spark-dock`（已登记）。
2. `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 数组加入
   `"dsh-spark-dock"`；spark 数据面板还需要 `"dsh-spark"`（提供 /sparks
   路由与 hippomemo 依赖）。
3. 版本纪律：改码后 bump `package.json` 版本再 install-profile，否则
   client-modules 按版本缓存会拿到旧字节。重启宿主后以
   `/plugins/??...&rev=` 变化为准。

## 状态

v0.1.9（2026-09-10）：悬浮球转静默形态（玻璃透镜 + 品牌标识，无表情/无动画），
球的对比度与层次纳入 `pnpm check:contrast` §J 组；面板与五模块数据不变。
历史：v0.1.1 Phase 0–8 —— 五模块真实数据 + Fairy 事件层，均已通过
`dsh --profile web :3999` 真实宿主截图与 DOM 断言验证。

视觉走查（本机，零 dsh；需要 pnpm preview 的 5180 在跑）：
`node dev-harness/preview/ball-shots.mjs <label>` 抓球特写（亮/暗 × 静止/hover/展开/聚焦）
并落盘计算样式度量（动画数 / 盒子尺寸 / 描边 / focusVisible / Tab 可达性），
`node dev-harness/preview/png-analyze.mjs <png...>` 出径向剖面（球面主色 / 描边 / 外发光 / 焦点环）。
