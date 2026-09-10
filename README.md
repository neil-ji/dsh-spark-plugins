# dsh-spark-plugins

DSH 第三方插件 monorepo（pnpm workspace）：UI/UX 与 DSH Web 官方设计系统逐像素对齐，版本兼容经两道闸体检。落地页：<https://neil-ji.github.io/dsh-spark-plugins/>

## 安装

前置：dsh **最新版**（当前 `0.1.2-rc.1`）、Node.js ≥ 18。
**不需要 git、不需要 pnpm、不克隆仓库、不本地构建** —— 脚本从 GitHub Release 下载 CI 预构建的 tarball，
逐个校验 sha256 后装进 dsh profile。

> 兼容策略：**只保证与最新 dsh 兼容**。发布清单里记录打包时刻的 `dsh.tested`（CI 装的是 `@latest`），
> 安装器拿本机 `dsh --version` 与之比对：一致即通过；不一致只告警（`--strict-version` 改成硬失败）。
> dsh 升级后重跑两道闸（`pnpm check:dsh-upgrade` / `pnpm dryrun:dsh-upgrade`）再重发版。

**Linux / macOS / WSL**

```bash
curl -fsSL https://neil-ji.github.io/dsh-spark-plugins/install.sh | sh
```

**Windows（PowerShell 5.1+）**

```powershell
irm https://neil-ji.github.io/dsh-spark-plugins/install.ps1 -OutFile install.ps1; .\install.ps1
```

两个脚本都幂等：重复执行 = 更新到最新。安装器会核对本机 `dsh --version` 是否落在发布包的兼容区间内
（不满足只告警，`--strict-version` 可改成硬失败）。

```bash
# 常用变体
sh install.sh --version v0.2.0       # 装指定 tag（默认 latest）
sh install.sh --profile main         # 指定目标 dsh profile（默认 web）
sh install.sh --only dsh-spark,dsh-connector-npm   # 只装部分插件
sh install.sh --home /tmp/dev-home   # 目标 DSH_HOME（隔离安装/沙箱试用）
sh install.sh --from-source          # 开发路径：clone + pnpm install + build

# Windows 对应参数
.\install.ps1 -Version v0.2.0
.\install.ps1 -DshHome .\.dev\home -Profile devweb
.\install.ps1 -FromSource -LocalDir F:\path\to\checkout
```

装完重启 dsh web，到设置页完成各插件的连接配置即可。
卸载：`dsh plugin --profile web remove <插件名>`，并删除 `$DSH_HOME/spark-plugins`（安装器缓存）。
发布流程见 [.github/workflows/release.yml](.github/workflows/release.yml)：打 tag → 构建/测试 → 打包资产 → 发布 → **用刚发布的资产自验**。

## 安装后 UI 速览

![插件 UI 预览](docs/screenshots/plugins-ui.png)

<p align="center">GitHub 连接器 · 财务 Finance · npm 发布管线 · 记忆 HippoMemo · 火花 Spark ——按 DSH 设计系统 1:1 复刻的静态预览，演示数据见 <a href="docs/demo.html">docs/demo.html</a></p>

## 包一览（12 个包）

| 包 | 目录 | 说明 |
| --- | --- | --- |
| dsh-hippomemo | packages/dsh-hippomemo | 跨会话/跨工作区共享记忆插件 |
| dsh-spark-plugin-kit | packages/dsh-plugin-kit | 公共层：client 设置页样板（settings.section / locale / CSS 注入） |
| dsh-ui-kit | packages/dsh-ui-kit | 本地 React 组件库（复刻 DSH 设计系统，零 cordis） |
| dsh-spark-finance | packages/dsh-finance | 成本统计插件 host（remote/typert + 计算核心） |
| dsh-spark-finance-client | packages/dsh-finance-client | 成本统计插件 client（设置页 UI） |
| dsh-spark-finance-bundle | packages/dsh-finance-bundle | 成本统计插件安装入口（cordis.patch） |
| dsh-connector-github | packages/dsh-github | GitHub 连接器 host（40+ 工具） |
| dsh-connector-github-ui | packages/dsh-github-ui | GitHub 连接器 client（连接配置页） |
| dsh-connector-wire | packages/dsh-github-wire | GitHub 连接器 wire（remote 协议定义） |
| dsh-connector-npm | packages/dsh-npm | npm 发布管线 host（12 工具，granular token 全权接管 npm 平台侧：publish / dist-tag / deprecate / trust） |
| dsh-connector-npm-ui | packages/dsh-npm-ui | npm 发布管线 client（token 测试/保存 + 发布状态页） |
| dsh-connector-npm-wire | packages/dsh-npm-wire | npm 管线 wire（remote 协议定义） |

> 目录名沿用各自源码仓库的目录名（dsh-github / dsh-npm / dsh-finance），npm 包名以各包 package.json 为准；`dsh-plugin-kit` / `dsh-finance` 在 npm 被占用，故发布为 `dsh-spark-plugin-kit` / `dsh-spark-finance`。

npm 连接器 token 优先使用说明（粘贴 token → 测试连接 → 保存 → agent 全权接管）见 [docs/NPM-CONNECTOR.md](docs/NPM-CONNECTOR.md)。

## dsh 升级体检（常态化追踪破坏性改动）

- `pnpm check:dsh-upgrade` — 快检：npm 发布产物 API 面 diff + 插件 import 符号/事件存活检查，报告归档 `docs/dsh-upgrade-reports/`
- `pnpm dryrun:dsh-upgrade` — 真验：临时目录钉新版本 + 干净安装 + `pnpm -r typecheck`
- 完整流程与调度见 [docs/UPGRADE-PROTOCOL.md](docs/UPGRADE-PROTOCOL.md)

## 常用命令

```bash
pnpm build        # 构建全部包（各包产出 lib/ 或 dist/）
pnpm typecheck    # 类型检查全部包
pnpm test         # 测试全部包：根 vitest 250 + finance 153 + finance-client 131（共 534 用例）
pnpm check:contrast  # 设计系统亮/暗对比度 + token 完整性闸门（142 项配对，AA）
pnpm dev          # 构建全部 + 安装到 web profile
pnpm dev --run    # 构建 + 安装 + 前台启动 dogfood（dsh --profile web --port 3999）
pnpm preview      # 零 dsh 组件预览（真 embed 产物 + 假宿主，127.0.0.1:5180）
pnpm preview:verify  # 预览自检：Node 冒烟 + 服务器/fixture 断言（52 项）
pnpm install:profile  # 仅重新安装到 profile（pack→tarball，与普通用户安装同路径）
pnpm escape       # 启动「应急逃生」profile（纯官方 web，端口 3998）
pnpm escape:init  # 仅初始化/刷新逃生 profile（幂等）
pnpm finance:sync-prices  # 从 models.dev 社区价格表同步非 DeepSeek 计价进 bundle（--dry-run 预览、--fx 调汇率）
```

## 本地运行机制

> 分三种用法：**零 dsh 预览**（不装 dsh，仿真 dsh web 外壳 + 真悬浮球，推荐走查）、**沙箱三线开发**
> （不碰 `~/.dsh`，推荐日常联调）与 **dogfood 安装验证**（装进 web profile）。

### 零 dsh 预览（模拟 dsh web + 真 spark-dock 悬浮球）

机器上**不需要任何 dsh 安装、不写任何 profile、不起 dsh 进程**：画布是仿真的 dsh web 会话界面，
右下角是**真的** `dsh-spark-dock` 悬浮球——点开就是真面板（火花 Spark / 记忆 HippoMemo /
财务 Finance / GitHub / npm 五个模块，各插件的完整设置 UI），拖动吸附四角、位置记 localStorage。

```bash
pnpm preview         # http://127.0.0.1:5180/  真产物口径，改码自动重建 + 页面自动刷新
pnpm preview:source  # 源码口径（packages/*/src/client/embed.ts），免构建
pnpm preview:verify  # 自检 52 项（Node 冒烟 + 服务器/fixture 断言）
```

左栏其余画布是组件级单渲染（GitHub / npm / 财务 Finance / HippoMemo / UI Kit），便于逐个走查；
顶栏可切语言、明暗主题与 `ok|empty|error` 三档 fixture。财务卡的配置编辑走内存版
`settingsScope`（真的能改能还原），记忆与火花的假数据来自预览服务器 `/hippomemo/*`、`/sparks/*` fixture。
细节、一致性边界与排障见 [docs/COMPONENT-PREVIEW.md](docs/COMPONENT-PREVIEW.md)。

### 沙箱三线开发（数据隔离 + HMR）

`$DSH_HOME` 指向仓库内 `.dev/home`，插件以 `link:` 依赖 + `dsh.profile.bundles` 形式加载，
改码即热更；`~/.dsh`（3080 常驻服务）完全不受影响。设计与实测细节见
[docs/LOCAL-DEV-HARNESS.md](docs/LOCAL-DEV-HARNESS.md)。

```bash
pnpm sandbox:init     # 幂等创建 .dev/home + dev profile（devweb，端口 3997）
pnpm sandbox:link     # 通道 A（日常）：工作区插件 → link: 依赖 + bundle 行 + hmr 窄根监听
pnpm sandbox:install  # 通道 B（保真）：pack→tarball 装进沙箱 profile，与用户安装同路径
pnpm sandbox:up       # 启动沙箱实例（--detach 后台 / --cwd 换工作目录）
pnpm sandbox:verify   # 自动起停 + 断言：隔离 / 行 ACTIVE / 客户端图 / 客户端+宿主 HMR
```

- 控制面板 <http://127.0.0.1:3997/__dev/>：场景按钮（触发 HMR、清存储、写 fixture…）+ 实时状态
- 诊断探针 <http://127.0.0.1:3997/__dev/probe>：机器可读的条目状态与 HMR 事件
- 通道 A 改 `packages/*/src` 后跑该包 `build`（或 `pnpm -r build`）：客户端自动热替换，宿主按 `hmr` 行热更
- 通道 B 无热更（tarball 是拷贝）：改码需重跑 `pnpm sandbox:install` + 重启，`--strict` 可强制纳入缺产物的包以暴露打包问题
- 其它：`pnpm sandbox:list`（产物就绪画像）、`pnpm sandbox:doctor`（补丁组合校验）、`pnpm sandbox:reset`

### dogfood 安装验证（装进 web profile）

1. `pnpm dev` 先构建所有包（DSH 加载的是 `lib/` 产物）。
2. `scripts/install-profile.mjs` 按 `plugin-registry.json` 的映射走**与普通用户一致的
   pack→tarball 安装路径**：对插件及其 workspace 库依赖闭包逐个 `pnpm pack` 到
   `.pack-profile/`，写入 profile `package.json`（`file:<tgz>`）并用 `overrides` 钉住
   闭包依赖，**不挂载本 monorepo、不产生任何硬链接/活链接**。
3. `dsh --profile web --port 3999` 重启 dogfood 验证（宿主必须重启才重建 client 模块图，
   验证以 `/plugins/??...&rev=` 的 rev 变化为准）。

> 版本纪律：dsh client-modules 按「插件版本」缓存产物字节——改码后必须 bump 该插件
> `package.json` 的版本号，再跑安装脚本 + 重启宿主，否则宿主继续供旧字节。
> （沙箱 link 通道不受此限：它走内容哈希热替换。）

> 注意：`3080` 是常驻工作服务，验证一律走 `3999`/沙箱 `3997`，不要动 3080。

## 应急逃生入口（纯官方 profile）

插件栈或 web profile 出问题（版本漂移、加载失败、误改配置）导致 3080 起不来时，
用逃生 profile 先救回一个可用的 dsh GUI——**只加载官方 bundles**（`@deepseek-ai/dsh-base`
+ `@deepseek-ai/dsh-web-app`），零第三方插件、零 monorepo 依赖，跟随全局 dsh 版本，
不依赖本仓库的任何东西：

```bash
pnpm escape        # = 初始化（幂等）+ 启动 dsh --profile escape --port 3998
pnpm escape:init   # 只初始化/刷新，不启动；之后手动 dsh --profile escape --port <port>
```

- 会话/存储与 web profile 共用 `DSH_HOME`，数据不变，只是不加载第三方插件。
- 逃生 profile 目录：`~/.dsh/profiles/escape`（用官方 `initProfile` + web 模板创建，
  含 `cordis.patch.yml` 空补丁层；已有文件不会被覆盖）。
- 初始化脚本：`scripts/escape-profile.mjs`（从全局 dsh 安装解析 `dsh-app-boot` API）。
- 应急三板斧：先 `pnpm escape` 拿到干净 GUI → 再排查 `pnpm install:profile` 重装 web profile
  插件 → 最后重启/验证 3080。

## 依赖版本策略

- 所有 `@deepseek-ai/*` 通过 `pnpm-workspace.yaml` 的 `overrides` 强制为 `0.1.2-rc.1`
  （与全局 dsh 内部依赖版本一致；必须逐包精确钉版，避免多实例类型分裂与运行时加载失败）。
- 插件包之间用 `workspace:*` 依赖，构建时内联或按需解析。

## 新增一个插件

1. `packages/<name>` 下建包（host 出 `lib/index.js`，client 出 `lib/client.js`，参考 dsh-hippomemo）。
2. 需要 client UI 时引用 `dsh-spark-plugin-kit` 的 `registerSettingsSection`。
3. 在 `plugin-registry.json` 登记，`pnpm dev` 后即可在 3999 验证。
## License

[MIT](./LICENSE)