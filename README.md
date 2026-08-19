# dsh-spark-plugins

本地自用的 DSH 插件 monorepo（pnpm workspace）。**不做 GitHub Pages，不维护 npm 发布**——所有包均为 private，通过 workspace 源码构建 + 安装到本地 dsh profile 运行。

## 包一览

| 包 | 目录 | 说明 |
| --- | --- | --- |
| dsh-hippomemo | packages/dsh-hippomemo | 跨会话/跨工作区共享记忆插件 |
| dsh-ui-kit | packages/dsh-ui-kit | 本地 React 组件库（复刻 DSH 设计系统，零 cordis） |
| dsh-plugin-kit | packages/dsh-plugin-kit | 公共层：client 引导样板 + host 工具（从各插件提取） |
| dsh-finance / -client / -bundle | packages/dsh-finance* | 成本统计插件（host / client / bundle） |
| dsh-connector-* | packages/dsh-connector-* | GitHub / npm 连接器（wire / host / ui 六包） |

## 常用命令

```bash
pnpm build        # 构建全部包（各包产出 lib/）
pnpm typecheck    # 类型检查全部包
pnpm test         # 测试全部包
pnpm dev          # 构建全部 + 安装到 web profile
pnpm dev --run    # 构建 + 安装 + 前台启动 dogfood（dsh --profile web --port 3999）
pnpm install:profile  # 仅重新安装到 profile（依赖 file: 链接）
```

## 本地运行机制

1. `pnpm dev` 先构建所有包（DSH 加载的是 `lib/` 产物）。
2. `scripts/install-profile.mjs` 把 `plugin-registry.json` 中登记的插件以 `file:` 依赖写入
   `~/.dsh/profiles/web/package.json`，并把本 monorepo 的 `packages/*` 挂载进 profile 的
   `pnpm-workspace.yaml`（workspace:` 依赖因此解析到本地源码）。
3. `dsh --profile web --port 3999` 启动 dogfood 验证。

> 注意：`3080` 是常驻工作服务，验证一律走 `3999`，不要动 3080。

## 新增一个插件

1. `packages/<name>` 下建包（host 出 `lib/index.js`，client 出 `lib/client.js`，参考 dsh-hippomemo）。
2. 需要 client UI 时引用 `dsh-plugin-kit` 的引导样板（`registerSettingsSection` 等）。
3. 在 `plugin-registry.json` 登记，`pnpm dev` 后即可在 3999 验证。
