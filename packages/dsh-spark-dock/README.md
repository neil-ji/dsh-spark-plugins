# dsh-spark-dock

DSH Web 宿主的全局悬浮球 + 插件统一面板（Spark Dock）。设计预览见
[`docs/spark-dock-preview/`](../../docs/spark-dock-preview/)，交互逻辑
（拖拽四角吸附、面板反向弹出、视口夹取、遮球提升）均来自该预览的已验证实现。

## 架构

- **挂载点**：宿主 `dsh-client-ui-layout` 声明的 `shell.overlay` slot
  （list / root / click-through 层，additive），注册方式与
  `dsh-client-ui-commands` 的命令弹层一致（`ctx.slots.inject` + `ctx.slots.register`）。
- **形态**：client-only 包 —— node 半边为空 loader 入口，浏览器半边由
  `window.__ModuleLoader__.load` 包裹；宿主经 `cordis.patch.yml` 行装载。
- **CSS**：幂等注入 `style[data-plugin-css="dsh-spark-dock"]`，作用域
  `[data-plugin="dsh-spark-dock"]`；shell.overlay 默认 click-through，
  组件根节点带 `pointer-events: auto`。

## 开发

```bash
pnpm --filter dsh-spark-dock typecheck
pnpm --filter dsh-spark-dock build
node scripts/install-profile.mjs web   # pack 全部插件并装入 ~/.dsh/profiles/web
```

装载要求（手工维护，`install-profile` 不动它）：

1. `plugin-registry.json` 登记 `dsh-spark-dock`（已登记）。
2. `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 数组加入
   `"dsh-spark-dock"`。
3. 版本纪律：改码后 bump `package.json` 版本再 install-profile，否则
   client-modules 按版本缓存会拿到旧字节。重启宿主后以
   `/plugins/??...&rev=` 变化为准。

## 状态

- Phase 1 完成：球 + 面板浮层壳（真实宿主截图验证）。
- Phase 2（进行中）：面板 tab + 模块注册框架。
- 后续：spark / finance / hippomemo / github / npm 五模块接真实数据、Fairy 事件层。
