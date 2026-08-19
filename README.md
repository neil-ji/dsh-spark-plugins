# dsh-spark-plugins

本地自用的 DSH 插件 monorepo（pnpm workspace）。**不做 GitHub Pages，不维护 npm 发布**——所有包均为 private，通过 workspace 源码构建 + 安装到本地 dsh profile 运行。

## 包一览（12 个包）

| 包 | 目录 | 说明 |
| --- | --- | --- |
| dsh-hippomemo | packages/dsh-hippomemo | 跨会话/跨工作区共享记忆插件 |
| dsh-plugin-kit | packages/dsh-plugin-kit | 公共层：client 设置页样板（settings.section / locale / CSS 注入） |
| dsh-ui-kit | packages/dsh-ui-kit | 本地 React 组件库（复刻 DSH 设计系统，零 cordis） |
| dsh-finance | packages/dsh-finance | 成本统计插件 host（remote/typert + 计算核心） |
| dsh-finance-client | packages/dsh-finance-client | 成本统计插件 client（设置页 UI） |
| dsh-finance-bundle | packages/dsh-finance-bundle | 成本统计插件安装入口（cordis.patch） |
| dsh-connector-github | packages/dsh-github | GitHub 连接器 host（40+ 工具） |
| dsh-connector-github-ui | packages/dsh-github-ui | GitHub 连接器 client（连接配置页） |
| dsh-connector-wire | packages/dsh-github-wire | GitHub 连接器 wire（remote 协议定义） |
| dsh-connector-npm | packages/dsh-npm | npm 发布管线 host（7 工具） |
| dsh-connector-npm-ui | packages/dsh-npm-ui | npm 发布管线 client（发布状态页） |
| dsh-connector-npm-wire | packages/dsh-npm-wire | npm 管线 wire（remote 协议定义） |

> 目录名沿用各自源码仓库的目录名（dsh-github / dsh-npm），npm 包名保持 dsh-connector-* 不变。

## 常用命令

```bash
pnpm build        # 构建全部包（各包产出 lib/ 或 dist/）
pnpm typecheck    # 类型检查全部包
pnpm test         # 测试全部包（含根 vitest，共 227+ 用例）
pnpm dev          # 构建全部 + 安装到 web profile
pnpm dev --run    # 构建 + 安装 + 前台启动 dogfood（dsh --profile web --port 3999）
pnpm install:profile  # 仅重新安装到 profile（依赖 file: 链接）
```

## 本地运行机制

1. `pnpm dev` 先构建所有包（DSH 加载的是 `lib/` 产物）。
2. `scripts/install-profile.mjs` 按 `plugin-registry.json` 的映射，把各插件以 `file:` 依赖写入
   `~/.dsh/profiles/web/package.json`，并把本 monorepo 的 `packages/*` 挂载进 profile 的
   `pnpm-workspace.yaml`（workspace:` 依赖因此解析到本地源码），最后在 profile 目录 `pnpm install`。
3. `dsh --profile web --port 3999` 启动 dogfood 验证。

> 注意：`3080` 是常驻工作服务，验证一律走 `3999`，不要动 3080。

## 依赖版本策略

- 所有 `@deepseek-ai/*` 通过 `pnpm-workspace.yaml` 的 `overrides` 强制为 `0.1.0-rc.6`
  （与全局 dsh 版本一致，避免 npm latest 指向残缺的 rc.1 系列 / 多实例类型分裂）。
- 插件包之间用 `workspace:*` 依赖，构建时内联或按需解析。

## 新增一个插件

1. `packages/<name>` 下建包（host 出 `lib/index.js`，client 出 `lib/client.js`，参考 dsh-hippomemo）。
2. 需要 client UI 时引用 `dsh-plugin-kit` 的 `registerSettingsSection`。
3. 在 `plugin-registry.json` 登记，`pnpm dev` 后即可在 3999 验证。
