# dsh-spark-dock

DSH Web 宿主的全局悬浮球 + 插件统一面板（Spark Dock）。设计预览见
[`docs/spark-dock-preview/`](../../docs/spark-dock-preview/)，交互逻辑
（拖拽四角吸附、面板反向弹出、视口夹取、遮球提升、Fairy 表情）均移植自
该预览的已验证实现。

## 功能（全部真实数据）

| 模块 | 子页 | 数据源 |
|------|------|--------|
| 火花 | 火花流 / 涌现提议 / 脚本目录 / Graph | `/sparks` `/proposals` `/scripts` http api（Graph 待后端查询 API） |
| 记忆 | 总览 / 记忆 / 偏好 / 进化 | `/hippomemo` api（stats/搜索/偏好/candidates/预演）+ SSE |
| 成本 | 余额 | `remote.finance.listProviders` |
| GitHub | 连接 | `remote.github.whoami` + 测试连接 |
| npm | 发布 | `remote.npm['status.get']` 注册表 + 套件包状态 |

Fairy 层：球体表情（呆毛火花/笑眼/嘴型/思考泡）+ 播报气泡，由三条真实
SSE 流驱动（sparks/proposals/hippomemo events）。克制原则：纯事件驱动
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

v0.1.1：Phase 0–8 全部完成 —— 五模块真实数据 + Fairy 事件层，均已通过
`dsh --profile web :3999` 真实宿主截图与 DOM 断言验证。
