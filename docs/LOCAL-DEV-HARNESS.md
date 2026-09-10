# 本地 dev 轻量机制设计（三条线：独立 harness / 本地集成 / 远端集成）

> 目标：把「改插件代码 → 看到效果」的循环从「pack → 装进 web profile → 重启 3080 常驻服务」压缩到秒级，
> 且**完全不碰 `~/.dsh`**（不污染常驻服务的数据、会话、凭据、profile）。
> 本文档记录的是**已在本机实测验证**的机制事实（附复现命令）与在此之上设计的三条通道。

状态：研究 + PoC 已验证（2026-09-08，dsh `0.1.2-rc.1`，Node 24.11.1，Windows）。
**P0/P1/P2 已落地**：线 2 的 link 与 install 两个通道 + 共享控制平面 + 验收矩阵 +
Windows 一键安装脚本（§9），以及 **Release 托管预构建产物 + 下载校验安装 + 发布即自验**（§10）。

---

## 0. 结论速览

| 线 | 做什么 | 装进 dsh？ | 数据隔离手段 | HMR | 适合 |
| --- | --- | --- | --- | --- | --- |
| **1 独立 harness** | 起一个本地服务，浏览器直接看插件 UI + 触发按钮 | 否，零 dsh 进程 | 无 dsh 数据，全部内存/fixture | 产物变更自动整页刷新 / 源码级重建 | UI 走查、功能验证、回归、验收 |
| **2 本地集成** | 本地仓库 → 沙箱 `$DSH_HOME` 的 dev profile | 是（沙箱 profile） | 独立 `DSH_HOME=.dev/home` | 客户端 HMR 自动；宿主端 HMR 可选 | 真实宿主环境联调、跨插件交互 |
| **3 远端集成** | GitHub 仓库 → 沙箱 `$DSH_HOME` 的 dev profile | 是（沙箱 profile） | 同上 | 无（只验证安装路径） | 复现用户安装路径、发布前体检 |

三条线共用一套沙箱 home 与验收探针，互不干扰：3080（常驻）、3999（dogfood web profile）、3998（escape）全部不动。

---

## 1. 机制事实（实测，带复现）

### 1.1 数据隔离的唯一杠杆是 `DSH_HOME`

- 解析优先级：显式配置 > `$DSH_HOME` > `~/.dsh`；空/纯空白视为未设置；相对路径按 cwd 解析
  （`dsh-home-paths/lib/index.js:73-76`）。
- profile 目录恒为 `$DSH_HOME/profiles/<name>`，不可用 flag 覆盖（`dsh-app-boot/lib/index.js:323-326`）。
- 会话、storages、`.credentials.yaml`、`settings.yaml`、`.anonymous-user-id`、profiles 全在 home 下。
  本仓库插件自己也读 `DSH_HOME`（`packages/dsh-spark/src/{spark-service,script-storage,emerge-service}.ts`、
  `packages/dsh-hippomemo/src/spec.ts` 注释），所以**隔离 home = 隔离插件数据**。
- 实测：`DSH_HOME=.dev/home dsh --profile devweb` 起来后，`.dev/home` 下出现
  `profiles/`、`storages/sparks/proposals.jsonl`、`.credentials.yaml`、`.anonymous-user-id`，`~/.dsh` 零改动。

复现：
```powershell
$env:DSH_HOME='F:\AgentStudio\dsh-spark-plugins\.dev\home'
dsh --profile devweb --port 3997 --no-open
```

### 1.2 不安装也能加载插件：`file://` patch 行

patch 层栈（`dsh/lib/profile-boot-BTzzdrGY.js:186-211`）：
`bundle 层（dsh.profile.bundles 顺序）→ profile/cordis.patch.yml → $DSH_HOME/cordis.patch.yml → --patch 覆盖层 → 遥测开关`。
patch 行 schema：`{id, insert, name, ...overrides}`，`name` 只是断言，其余键整键覆盖（`dsh-app-boot/lib/index.js:59-108`）。

实测结论（很重要，踩过坑）：

| 写法 | 结果 |
| --- | --- |
| `name: 'F:/.../packages/dsh-spark'`（裸绝对路径） | ✗ `ERR_UNSUPPORTED_ESM_URL_SCHEME`（`f:` 被当成 URL scheme） |
| `name: 'file:///F:/.../packages/dsh-spark'`（目录 URL） | ✗ `ERR_UNSUPPORTED_DIR_IMPORT` |
| `name: 'file:///F:/.../packages/dsh-spark/lib/index.js'`（**入口文件**） | ✓ 宿主半侧加载成功；客户端半侧被自动发现 |

原因：ESM 不对 `file:` 目录做 package.json main 解析；而 client-modules 的 `nearestPackage()`
会从模块 URL 向上找 `package.json`（`dsh-client-modules/lib/index.js:660-707`），
所以**指到入口文件即可同时覆盖宿主与客户端**。

客户端半侧从此变成 boot 图里的一行，由 `/plugins/??<包名>/client.js&rev=<rev>` 提供：

```
/plugins/??dsh-connector-npm-ui/client.js&rev=7a1d6798de26e9b1-45
```

注意模块身份是 **package.json 的 name**（`dsh-connector-npm-ui`），不是行 id。

### 1.3 客户端 HMR：改 `lib/client.js` 即热替换（已实测）

- 宿主侧 `dsh-client-hmr` 每 500ms `stat` 每个图 bundle（`mtimeMs`+`size`），变了就重新按内容哈希算 rev，
  通过 SSE `/plugins/events` 推 `{"type":"rebuilt","id","rev"}`（`dsh-client-hmr/lib/index.js:22,47-113,131-158`）。
- 浏览器半侧收到帧后 `invalidate(id, rev)` + `prefetch` + 拆旧 fiber + 重挂，**整页不刷新**
  （`dsh-client-hmr/lib/client.js:62-114`）。
- **实测**：往 `packages/dsh-npm-ui/lib/client.js` 末尾追加一行注释，1s 内收到
  `{"type":"rebuilt","id":"dsh-connector-npm-ui","rev":"cfb187e0146e"}`（rev 从 nonce 变为内容哈希）。

复现：
```powershell
curl.exe -N http://127.0.0.1:3997/plugins/events   # 另开一个终端
Add-Content packages\dsh-npm-ui\lib\client.js "// probe"
```

推论：**只要宿主服务的是仓库里的那份 `lib/client.js`，客户端热更新就自动成立，不需要 bump 版本、不需要重装、不需要重启宿主。**
（README 里「必须 bump 版本」的纪律只适用于 tarball 重装路径：包元数据按 specifier 缓存到重启，
且 pnpm 可能因 lockfile 未变而不刷新字节。见 1.5。）

### 1.4 宿主端 HMR：可选，但配置有讲究（已实测）

`dsh-base` 里 `hmr` 行默认 `disabled: true`（`dsh-base/cordis.patch.yml:20-25`），
profile 的 `dsh.profile.patchReload: "live"` 只会拉起一个 `root: []` 的「仅配置热更」实例
（`dsh/lib/profile-boot-BTzzdrGY.js:271-288`）。

要热更**宿主插件模块**，需要显式开启并给窄监听根：

```yaml
# $DSH_HOME/profiles/<dev>/cordis.patch.yml
- id: hmr
  disabled: false
  config:
    base: '../../../../'          # 相对 profile 目录的 URL 片段，不能用绝对路径（ERR_INVALID_URL_SCHEME）
    root: ['packages/dsh-spark/lib']   # 越窄越好
    ignored: ['**/node_modules/**', '**/.git/**']
```

实测：
- `root: ['packages']`（整棵仓库）→ chokidar 初次扫描约 **75s** 才 ready（插件 fiber 停在 LOADING=1），
  且之后改文件**没有**触发 reload（Windows 反斜杠相对路径与 picomatch 正斜杠模式不匹配，`ignored` 失效，扫描面过大）。
- `root: ['packages/dsh-spark/lib']`（窄根）→ 约 18s ready，改文件后 `hmr/reload` 事件到达、插件重挂。

复现（探针插件见 `.dev/probe-plugin.js`）：
```powershell
curl.exe -s http://127.0.0.1:3997/__dev/probe   # 看 services.hmr / entries[].fiberState / hmrEvents
```

### 1.5 保真安装路径（tarball）在隔离 home 下同样成立（已实测）

- `pnpm pack` 闭包 → 写 profile `dependencies: file:<tgz>` + `pnpm-workspace.yaml` `overrides` →
  `pnpm install --prod`（`scripts/install-profile.mjs` 的既有做法）。
- 实测：把 `dsh-spark-0.1.5.tgz` + `dsh-spark-wire-0.1.0.tgz` 装进 `.dev/home/profiles/devweb`，
  在 `dsh.profile.bundles` 加上 `dsh-spark`，重启后探针显示
  `id=spark name=dsh-spark fiberState=2`，路由 `/sparks/*` 正常；
  `node_modules/dsh-spark/lib/index.js` 是 **HardLink**（pnpm store 拷贝，与仓库源码无链接）。
- 依赖 `@deepseek-ai/*` 由 `$DSH_HOME/profiles/node_modules` 的模块 fallback（从全局 dsh 安装投射的软链）
  满足，无需 profile 自己安装，也无需联网。

**现状缺口**：`scripts/install-profile.mjs:35` 与 `docs/install.sh:15` 把 home 写死成 `homedir()/.dsh`，
不认 `DSH_HOME`。线 2/3 必须修（见 §4）。

### 1.6 客户端平台的真实约束（做线 1 必须知道）

- `PLATFORM_MODULES` 种子表只有 8 项：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、
  `@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、
  `@deepseek-ai/dsh-client-ui-primitives`。动态 bundle 的 external 只对这一张表 + `dsh.client.external` 解析。
- `dsh.client` 只有 4 个字段：`platform`（必填，须 `web`）、`inject`（包名数组，只用于到达顺序）、
  `external`（模块 specifier 数组，才形成图边）、`immediately`（首屏预取）。**没有 `entry`/`exports`**；
  bundle 路径来自 `package.json` 的 `exports["./client"]`。
- `ctx` 就是普通 cordis Context；插件客户端半侧只用到 `effect / locale.register|bind / slots.inject|register /
  remote.$mount|$on|<ns> / reflect.get / settingsScope.bind / createSnapshotStore`。
- **`ctx.slots.register` 在没有父级声明该槽时会抛错**（`dsh-client-ui-slots/lib/index.js:72-74`），
  所以 harness 必须先注册一个声明 `settings.section` / `shell.overlay` 的父条目。
- 宿主 RPC 传输：`POST /api/<ns>/<method>`，请求 `{type:'client-request',rpcId,method,payload:{args}}`，
  响应 `{type:'server-response',rpcId,result:{ok,value|error}}`；流式走 `/api/remote.mux` WebSocket。
  harness 可用官方钩子 `globalThis.__DSH_TRANSPORT__ = { fetch, openStream }` 注入假实现。
- `window.__ModuleLoader__` 是可在纯静态页里照抄的队列门面（`dsh-client-modules/lib/index.js:387-432`），
  `window.__DSH_BOOT__` 是 `{rev, entries[], batches[]}`；手工伪造即可让真 bundle 在无 dsh 进程下跑起来。

---

## 2. 线 1：独立 dev harness（不装进 dsh）

> **状态：已落地（2026-09-08）**，实现在 `dev-harness/preview/`，入口 `pnpm preview`。
> 与下面原始设计的差异：不引 vite（用仓库已有的 esbuild 单文件打包 + SSE 整页刷新）；
> 默认画布直接是**仿真 dsh web 外壳 + 真 spark-dock 悬浮球**（点开即真面板），其余画布是
> 各插件 `*/embed` 产物的组件级渲染；仍未做假 RPC/SSE 全链路与真 `lib/client.js` 的
> `__ModuleLoader__` 复刻。
> 落地清单、命令与自检见 §2.6；下面的 §2.1–2.5 保留原始设计意图，尚未实现的部分已标注。

**定位**：纯 UI / 功能 / 回归 / 验收。没有 dsh 进程、没有 `$DSH_HOME` 写入、不调用模型。
**形态**：`dev-harness/`（不入 npm 发布列表）+ 本地服务，默认 `127.0.0.1:5180`。

### 2.1 页面结构

```
┌──────────────────────────────────────────────────────────────┐
│ 顶部：插件选择器 · 渲染模式(source|bundle) · 语言/主题 · 重置 │
├──────────────┬───────────────────────────────────────────────┤
│ 控制面板      │  插件 UI 画布                                  │
│ · 场景触发按钮 │  - 设置页 section（真实 slot 渲染）             │
│ · fixture 切换 │  - dock 悬浮球（shell.overlay）                │
│ · 故障注入     │  - 组件级单渲染（Card/Section）                │
│ · 回归清单     │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

控制面板的每个按钮 = 一个**具名场景**（`.dev/fixtures/<plugin>/<scenario>.json` + 一个动作函数）：

- `ok` / `empty` / `error` / `slow` / `huge`（分页边界）/ `stale-rev`（并发写冲突）
- 传输层故障注入：`reject`、`drop-response`、`500`、SSE 断线重连
- 状态类：语言切换、明暗主题、清空持久化（localStorage / settingsScope）、强制重挂
- 回归清单：每项 `{id, 场景, 期望}`，跑完写 `localStorage`，可导出 `.dev/regression/<date>.json`

### 2.2 两种渲染模式（同页切换）

**mode=source（最快，推荐日常）**
- Vite 直接吃 `packages/*/src/client/*`，`@deepseek-ai/*` 走 alias 指向已安装包（仓库根 `node_modules` 已有
  `dsh-client-ui-slots` / `dsh-client-store`，其余从全局 dsh 安装目录 alias 过去）。
- harness 提供真 `cordis Context` + 真 `SlotRegistry` + 真 locale + mock `remote` / `settingsScope`，
  调 `apply(mockCtx)`，再手动 `renderSlot`。
- HMR = **Vite/React Fast Refresh**，保存源码即生效，无构建步骤。

**mode=bundle（保真，验收前跑）**
- 跑插件自己的 `build.mjs`（esbuild）产出真 `lib/client.js`（带 `window.__ModuleLoader__.load` 包装），
  用真 `dsh-client-modules/lib/client.js` + 手写 `__DSH_BOOT__` + 自备 8 项种子表加载它。
- 这条路径验证的是**真正会被 dsh 服务的产物**与 `dsh.client` 声明，能抓住 source 模式抓不到的
  打包/CSS 内联/外部化问题。
- HMR：esbuild watch 重建 → harness 侧 SSE/轮询重挂（等价于 dsh 的 `rebuilt` 语义）。

### 2.3 宿主 RPC 假实现

- 一个 vite middleware 提供 `POST /api/<ns>/<method>`，从 fixture 表返回
  `{type:'server-response',rpcId:<echo>,result:{ok:true,value}}`；
  `/api/remote.mux` 用 `ws` 升级按协议帧模拟流式；非 typert 插件（spark / hippomemo）直接模拟
  `/sparks|/proposals|/scripts|/hippomemo` 前缀 + `text/event-stream`。
- 或者更省事：`globalThis.__DSH_TRANSPORT__ = { fetch: fakeFetch, openStream: fakeStream }`（官方钩子）。
- 好处：所有「异常路径」都能在 harness 里按按钮复现，不用等真宿主出错。

### 2.4 隔离性

- 无 dsh 进程、无 `$DSH_HOME`；持久化只落 `.dev/fixtures` 与浏览器 localStorage。
- 需要 `settingsScope` 行为时用内存实现（`mode:'memory'`），不写 `settings.yaml`。

### 2.5 落地清单

```
dev-harness/
  package.json            # 私有包，dev 依赖 vite + @vitejs/plugin-react
  vite.config.ts          # alias @deepseek-ai/* → 已安装包；middleware：/api、/fixtures、/hmr
  index.html              # 挂 __ModuleLoader__ 门面 + __DSH_BOOT__（bundle 模式）
  src/
    main.tsx              # 控制面板 + 画布
    ctx/mock-ctx.ts       # 真 cordis + 槽声明父条目 + mock remote/settingsScope/locale
    ctx/slot-host.tsx     # 声明 settings.section / shell.overlay 的父条目
    transport/fake-rpc.ts # POST /api + WS mux + SSE 前缀
    scenarios/registry.ts # 场景按钮注册表（按钮 → fixture + 动作）
    plugins.ts            # 扫 packages/*/package.json 的 dsh.client 生成插件清单
  fixtures/<pkg>/<scenario>.json
```

新增 npm scripts（根）：
```json
"harness": "node scripts/harness.mjs",
"harness:bundle": "node scripts/harness.mjs --mode bundle"
```

### 2.6 已落地实现（组件级预览，2026-09-08）

```
dev-harness/preview/
  server.mjs             # 单文件服务：esbuild 打包 + 静态资源 + /hippomemo|/sparks|/proposals|/scripts fixture + SSE 刷新 + /__preview/probe
  index.html             # 挂载点 + dsh-ui-kit 令牌层（tokens.css）
  verify.mjs             # pnpm preview:verify：Node 冒烟 + 服务器断言（52 项）
  fixtures/hippomemo.mjs # /hippomemo/* 的内存假宿主（8 条记忆 + 引用 + 偏好 + 候选 + 进化报告）
  fixtures/sparks.mjs    # /sparks|/proposals|/scripts 的内存假宿主（4 火花 + 3 提议 + 2 脚本，可捕获/归档/决议）
  tests/smoke.tsx        # 真产物 + 假宿主的无 DOM 渲染与数据流断言（含 DockOverlay）
  src/main.tsx           # 预览壳：画布选择 / 语言 / 主题 / 场景(ok|empty|error) / 重载
  src/preview.css        # 壳 + 仿真 dsh web 外壳的样式
  src/panes/dock.tsx     # 默认画布：仿真 dsh web 外壳 + 真 DockOverlay（镜像 dock client 入口的 apply）
  src/mock/ctx.ts        # 假宿主 ctx（effect / locale / remote.$mount|$on|credentials / reflect / settingsScope）
  src/mock/plugins.ts    # 四个插件的注入面装配（镜像 dock 的 EmbedPane）
  src/mock/fixtures.ts   # github / npm / finance 的 fixture（形状对照各 wire 类型）
  src/mock/snapshot.ts   # bindSnapshotSelector 的 8 行副本
  src/panes/*.tsx        # 六个画布：dock / github / npm / finance / hippomemo / ui-kit
```

命令：

```bash
pnpm preview          # 5180，真产物口径（lib/embed.cjs），esbuild watch + 页面自动刷新
pnpm preview:source   # 5180，源码口径（packages/*/src/client/embed.ts），改码免构建
pnpm preview:verify   # 自检：Node 冒烟 + 服务器/fixture 断言，退出码即结论
```

关键事实（实测）：

- **默认画布是 dock 本身**：仿真 dsh web 外壳（侧栏 + 会话流 + 输入框）+ 真
  `DockOverlay`（悬浮球/面板/模块栏/子页全是真的）。dock 没有 `./embed` 入口（产物是
  ModuleLoader 包装的 `client.js`），所以预览吃它的**源码**组件并复刻 `client/index.ts`
  的 `apply()` 装配；这是与 §2.2 原设计（跑真 `lib/client.js`）的主要偏离。
- **`lib/embed.cjs` 是自包含的**：四个 embed 产物里唯一的 `require` 只有 react/react-dom
  （`dsh-ui-kit`、`dsh-plugin-kit`、`dsh-*-wire`、`dsh-client-store` 全部已内联），所以
  "零 dsh" 真的成立——不需要任何 `@deepseek-ai/*` 运行时。
- 根 `node_modules` **不 link 工作区包**，所以预览侧用 esbuild 的 resolve 插件把
  `dsh-connector-*/embed`、`dsh-spark-finance-client/embed`、`dsh-hippomemo/embed`、
  `dsh-ui-kit`、`dsh-spark-plugin-kit/client` 与 dock 的 `dsh-spark-dock/*` 指到真实文件
  （源码口径额外指 `dsh-spark-finance/remote`）。
- **esbuild 的 context API 忽略 `write: false` 的路径语义**：产物 path 会是 `<stdout>`，
  必须显式给 `outfile` 才能从 `outputFiles` 取回字节（否则 `/preview.js` 永远 503）。
- 插件 CSS 变量 `--dsw-*` / `--spk-*` 由 `dsh-ui-kit` 的令牌层提供：
  `packages/dsh-ui-kit/dist/styles/tokens.css`（= base + spark-tokens + dsw-bridge），
  暗色走 `body[data-theme="dark"]`——预览壳直接切这个属性。
- **hippomemo 与 spark 走真 HTTP**（它们的 client 半侧本来就是 `fetch('/hippomemo/...')`、
  `fetch('/sparks...')`），所以服务端 fixture 能 100% 复用真代码路径；error 场景必须返回顶层
  `{ok:false,error}` 信封（包在 `{ok:true,value}` 里会被 client 当成成功）。
- **dock 的 embed starter 是模块级单飞**：预览里切语言/场景必须整页重载才能重新装配
  （等价于宿主重载插件），只有主题是纯 CSS 切换。
- 本机（无可用浏览器会话时）用 `react-dom/server` 的 `renderToString` + 直接调真 controller 的
  `load()` 做无 DOM 断言：DockOverlay 骨架、首屏渲染、数据流、`settingsScope` 的 set/unset 都能验。

仍未做（保留为后续）：假 RPC/SSE 全链路（`globalThis.__DSH_TRANSPORT__`）、
真 `lib/client.js` 的 `window.__ModuleLoader__` + `__DSH_BOOT__` 复刻、场景按钮矩阵与回归清单导出、
React Fast Refresh。

---

## 3. 线 2：本地集成验证（本地仓库 → 沙箱 dsh）

**定位**：真实宿主、真实 loader、真实槽位、真实 HTTP/RPC，但数据在沙箱。
**入口**：`DSH_HOME=.dev/home` + profile `devweb`（bundles = `dsh-base` + `dsh-web-app`，`patchReload: live`），
端口 `3997`（避开 3080/3998/3999）。

### 3.1 两条子通道

**(a) `link` 通道 —— 日常开发循环（HMR 全开）**

实现方式：把插件包写成 profile 的 **pnpm `link:` 依赖**（junction 指向仓库目录），
并把带 `dsh.bundle.patch` 的包加进 `dsh.profile.bundles`。包自己的 `cordis.patch.yml` 因此**原样生效**：

```jsonc
// .dev/home/profiles/devweb/package.json（由 scripts/dev-profile.mjs 生成）
"dependencies": {
  "dsh-spark": "link:F:/AgentStudio/dsh-spark-plugins/packages/dsh-spark",
  "dsh-spark-finance": "link:F:/AgentStudio/dsh-spark-plugins/packages/dsh-finance",
  "dsh-connector-github-ui": "link:F:/AgentStudio/dsh-spark-plugins/packages/dsh-github-ui"
  // …
},
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
  "dsh-spark", "dsh-spark-finance-bundle", "dsh-connector-github", "dsh-connector-npm"] } }
```

为什么不是 `file://` 行（早期方案，已弃用）：包 patch 里会引用**其它包名**，包括
`dsh-hippomemo/tool` 这类子路径多行插件；`file://` 行必须自己把每个 specifier 翻译成入口文件、
并复制 config，而 `link:` 让这些名字从 profile 的 `node_modules` 直接解析到仓库目录，
patch 与 config 都不用改写，client-modules 解析出的真实路径就是仓库里的 `lib/client.js`。

- 改客户端源码 → 重建 `lib/client.js` → **客户端自动热替换**（1.3，已验证）。
- 改宿主源码 → 重建 `lib/index.js` → `hmr` 行窄根监听 → **宿主插件重挂**（1.4，已验证）。
- 全程不重装、不重启、不 bump 版本。

**(b) `install` 通道 —— 保真安装（与用户同路径）**

`pnpm sandbox:install [pkg...]` = `pack → profile deps(file:tgz) + overrides → pnpm install --prod → 登记 bundle 行`。
它直接复用 `scripts/install-profile.mjs`（已支持 `--home` / `--only` / `--register-bundles`），
只是把目标 home 指向沙箱。用于验证：`files` 字段是否漏了产物、`exports` 是否正确、
`dsh.bundle.patch` 是否被识别、`workspace:*` 是否被 `pnpm pack` 正确改写、peer 是否被 fallback 满足、
`prepack` 是否能跑通。

- 安装后脚本会断言每个包在 profile 里是 **拷贝/hardlink** 而不是 junction（活链接）。
- 这条通道无 HMR：改码必须重跑 `pnpm sandbox:install` + 重启宿主。
- `--strict` 会把缺产物的包也登记进 bundle 行——让沙箱**启动失败**来暴露打包问题（发布前闸门）。
- 两种通道互斥：`link` 会清掉 tarball 依赖与 overrides，`install` 会清掉 link 依赖，且都会先清空
  profile 的 `node_modules`/lockfile（Windows 下混着改会让 pnpm 在 rename 阶段 EPERM）。

### 3.2 沙箱 home 的供给（`scripts/dev-home.mjs`）

幂等创建/更新：

```
.dev/home/
  profiles/devweb/{package.json,cordis.patch.yml,pnpm-workspace.yaml}   # 模板化，bundles=base+web-app
  cordis.patch.yml            # 仅放 dev 探针等「环境级」行，插件行放 profile 层（见风险）
  settings.yaml               # 从 ~/.dsh 复制一份（--seed），或从 .dev/seed/settings.yaml
  .credentials.yaml           # 可选 seed（复制，不软链，避免反向污染）
  .env                        # 提供 DASHSCOPE_API_KEY 等 provider 变量（.env 不能设 DSH_*）
  storages/ sessions/         # 运行期自动生成，隔离
.dev/workspace/               # 建议作为 dev 实例的 cwd（见风险）
```

要点：
- **复制而非软链** settings/credentials，且 `--seed` 显式触发；默认不复制（纯 UI 测试不需要模型）。
- `.env` 由 dsh 读取（`<cwd>/.env` 与 `<$DSH_HOME>/.env`，进程 env 优先级最高）；`DSH_*` 名字被禁止。
- `dev:doctor`：先 `dsh --profile devweb --dump-config` 校验补丁可组合，再启动，避免坏行毁掉整个 home。

### 3.3 验收探针（`dev-probe`，PoC 已验证）

一个 15 行的 dev-only 插件（`.dev/probe-plugin.js`），以 `file://` 行挂载，暴露 `GET /__dev/probe`：

```json
{
  "home": "F:\\...\\.dev\\home",
  "services": { "hmr": true, "webServer": true, "clientModules": true },
  "hmrEvents": { "change": [], "reload": [{"at": 1788859119128}] },
  "entries": [{"id":"spark","name":"dsh-spark","disabled":false,"fiberState":2}, ...]
}
```

自动化断言（`scripts/dev-verify.mjs`）：
1. `home` 等于沙箱路径（隔离证明）；
2. 目标插件条目存在、`disabled=false`、`fiberState=2`（ACTIVE）；
3. 客户端半侧出现在首页 boot 图里（抓 `/` 的 `/plugins/??<pkg>/client.js&rev=`）；
4. 改 `lib/client.js` 后 `/plugins/events` 在 N 秒内出现 `rebuilt` 且 rev 变化（HMR 证明）；
5. 关键 HTTP 路由 / RPC 方法冒烟通过。

---

## 4. 线 3：真实集成验证（远端仓库 → 沙箱 dsh）

**定位**：复现「陌生用户从 GitHub 装」的全过程，仍不碰 `~/.dsh`。

流程（`scripts/remote-verify.mjs`）：

```
1) git clone --depth 1 -b <ref> https://github.com/neil-ji/dsh-spark-plugins.git .dev/remote-src
2) cd .dev/remote-src && pnpm install && pnpm -r build
3) node scripts/install-profile.mjs devremote        # 目标 home = $DSH_HOME（需修，见下）
4) DSH_HOME=.dev/home dsh --profile devremote --port 3996 --no-open
5) 复用 §3.3 的探针 + 断言「解析自 profile node_modules（HardLink 拷贝），不是仓库源码」
6) 可选：直接跑用户脚本形态
   DSH_HOME=.dev/home sh install.sh --dir .dev/remote-src --profile devremote
```

**必须先修的现状缺口（两处 home 硬编码）**：

| 文件 | 现状 | 改法 |
| --- | --- | --- |
| `scripts/install-profile.mjs:35` | `join(homedir(), '.dsh', 'profiles', profile)` | `join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', profile)`；再加 `--home` 显式参数 |
| `docs/install.sh:15` | `DIR="$HOME/.dsh/spark-plugins"` | `DIR="${DSH_HOME:-$HOME/.dsh}/spark-plugins"`（保留 `--dir` 覆盖） |

另需在 `install.sh` 里把 `DSH_HOME` 透传给 `node scripts/install-profile.mjs`（`export DSH_HOME` 即可）。

**差异矩阵（线 2 install vs 线 3）**：

| 维度 | 线 2 install | 线 3 |
| --- | --- | --- |
| 源码来源 | 工作区（含未提交改动） | 远端 tag/branch（干净 clone） |
| 依赖 | 工作区 `pnpm install` 结果 | 独立 `pnpm install`（lockfile 校验） |
| 证明 | 产物/字段正确 | 用户路径端到端可用（含 `files` 白名单、`prepack`、peer 满足） |

---

## 5. 目录与脚本落地

```
scripts/
  dev-home.mjs        # 沙箱 home 供给（init/seed/reset/doctor）
  dev-profile.mjs     # 沙箱 profile 的 link / install 两条通道
  dev-up.mjs          # DSH_HOME + --profile devweb --port 3997 启动（可 --detach）
  dev-verify.mjs      # 探针 + SSE + boot 图断言（三条线共用）
  dev-shared.mjs      # 公共层（路径/包索引/YAML/进程/SSE）
  install-profile.mjs # tarball 安装器（--home / --only / --register-bundles）
  harness.mjs         # 线 1 的旧计划入口（未做；实际落地为 dev-harness/preview/server.mjs）
  remote-verify.mjs   # 线 3：clone → build → install → verify（P2，未做）
docs/
  install.sh          # 类 Unix 一键安装（--home / --repo / --register-bundles）
  install.ps1         # Windows 一键安装（等价；PS 5.1+，UTF-8 BOM）
dev-harness/          # 控制平面插件 + 场景注册表（线 1/线 2 共用）
.dev/                 # 沙箱（gitignore）：home / fixtures / workspace / logs / state.json
```

根 `package.json` scripts（新增，不动现有 `dev` / `install:profile` / `escape`）：

```json
"preview":            "node dev-harness/preview/server.mjs --open",
"preview:source":     "node dev-harness/preview/server.mjs --source",
"preview:verify":     "node dev-harness/preview/verify.mjs",
"sandbox:init":       "node scripts/dev-home.mjs init",
"sandbox:reset":      "node scripts/dev-home.mjs reset --yes",
"sandbox:doctor":     "node scripts/dev-home.mjs doctor",
"sandbox:link":       "node scripts/dev-profile.mjs link",
"sandbox:install":    "node scripts/dev-profile.mjs install",
"sandbox:up":         "node scripts/dev-up.mjs",
"sandbox:verify":     "node scripts/dev-verify.mjs",
"remote:verify":      "node scripts/remote-verify.mjs"
```

端口分配：`3080` 常驻 · `3999` dogfood web · `3998` escape · **`3997` 沙箱 dev** · `3996` 沙箱 remote-verify · `5180` harness。

---

## 6. 隔离与风险

| 项 | 是否隔离 | 说明 |
| --- | --- | --- |
| sessions / storages / 设置 / 凭据 | ✅ | 全在 `$DSH_HOME` 下 |
| 插件自写数据（spark/hippomemo） | ✅ | 插件自身读 `DSH_HOME` |
| dsh profile 依赖 | ✅ | 沙箱 profile 自己的 `node_modules` |
| 全局 dsh 安装 | ⚠️ 只读 | `$DSH_HOME/profiles/node_modules` 会向全局安装投射软链（不修改） |
| **工作区文件（cwd）** | ❌ | 宿主 cwd 仍是仓库；写文件的插件会动仓库。建议 dev 实例 cwd 用 `.dev/workspace` |
| 模型调用/费用 | ⚠️ | 沙箱默认无凭据 → 不会误调；`--seed` 后才可能 |

风险与对策：

1. **坏 patch 行 fail-loud 会毁掉整个 home**（`$DSH_HOME/cordis.patch.yml` 对每个 profile 生效）。
   → 插件行放 **profile 层**，home 层只放探针等环境行；启动前 `sandbox:doctor` 先 `--dump-config`。
2. **宿主 HMR 的监听面**：整棵仓库会让 chokidar 初次扫描 75s 且 `ignored` 在 Windows 上失效。
   → 只监听 `packages/<pkg>/lib`，由脚本按 `plugin-registry.json` 自动生成窄根列表。
3. **`file://` 行与「已安装同名包」冲突**：同一包被两个 loader 源解析时 client-modules 会抛
   `resolves from multiple active Loader sources`。→ link 通道与 install 通道互斥，脚本切换时清干净。
4. **版本纪律**：install 通道改码必须 bump 版本 + 重装 + 重启；link 通道不需要（内容哈希热替换）。
   → 文档与脚本里明确区分，避免「改了没生效」的误判。
5. **凭据**：`--seed` 复制 `.credentials.yaml` 是快照，不反向写；更推荐用 `.env` 提供 provider key。
6. **端口/令牌**：沙箱实例的 index 需要 `?token=`（每次启动新 token），自动化断言用探针路由（无需 token）。

---

## 7. 实施计划

**P0（半天，先跑通线 2 link 通道）**
1. `scripts/dev-home.mjs`（init/reset/doctor）+ `scripts/dev-profile.mjs link`
2. `scripts/dev-up.mjs` + `scripts/dev-verify.mjs`（探针 + boot 图 + rebuilt 断言）
3. 把 PoC 的 `.dev/probe-plugin.js` 收进 `scripts/dev-probe/`（或保留在 `.dev/`）

**P1（1～2 天，线 1 harness）**
4. `dev-harness` 骨架 + mock ctx/槽宿主 + 假 RPC/SSE + 插件自动发现
5. 场景注册表 + 回归清单 + fixture 目录约定
6. bundle 模式（真 `__ModuleLoader__` + 手写 boot 图）

**P2（1 天，线 2 install 通道 + 线 3）**
7. `scripts/install-profile.mjs` / `docs/install.sh` 认 `DSH_HOME`（+ `--home`）
8. `scripts/dev-profile.mjs install` + `scripts/remote-verify.mjs`
9. 在 README 增补「本地三线开发」一节，替换现在的「本地运行机制」

---

## 8. 复现附录（本文档所有实测结论）

```powershell
# 沙箱 home + dev profile（等价于 sandbox:init）
$env:DSH_HOME='F:\AgentStudio\dsh-spark-plugins\.dev\home'
dsh --profile devweb --port 3997 --no-open      # 探针：curl http://127.0.0.1:3997/__dev/probe

# 客户端 HMR（1.3）
curl.exe -N http://127.0.0.1:3997/plugins/events
Add-Content packages\dsh-npm-ui\lib\client.js "// probe"    # → rebuilt 帧

# 宿主 HMR（1.4）：profile 补丁里开 hmr 行（base 相对 URL + 窄 root）
Add-Content packages\dsh-spark\lib\index.js "// probe"      # → hmr/reload

# 保真安装（1.5）
pnpm --filter dsh-spark-wire pack --pack-destination .dev\pack
pnpm --filter dsh-spark      pack --pack-destination .dev\pack
# profile package.json deps=file:<tgz>、pnpm-workspace.yaml overrides、bundles += dsh-spark
pnpm install --prod
```

已存在的 PoC 文件：`.dev/home/profiles/devweb/*`、`.dev/home/cordis.patch.yml`、`.dev/probe-plugin.js`、
`.dev/pack/*.tgz`、`.dev/dsh-spark-index.bak`（实验用备份）。

---

## 9. 已落地

按「两个轴 + 一条共享验收矩阵 + 一个共享控制平面」的重构版落地了线 2 的**两个通道**，
以及线 3 的前置（Windows 安装脚本 + `DSH_HOME` 感知的安装器）。控制平面同时承担了线 1
想要的「触发按钮」（挂在真宿主上，不再需要一个独立的 Vite 应用）。

### 9.1 命令面

```bash
pnpm sandbox:init      # 幂等创建 .dev/home + dev profile（不碰 ~/.dsh）
pnpm sandbox:seed      # 从 ~/.dsh 复制 settings.yaml（--credentials 才带凭据）
pnpm sandbox:doctor    # dsh --dump-config 校验补丁组合 + 链接产物存在
pnpm sandbox:link      # 通道 A：工作区插件 → link: 依赖 + bundle 行 + hmr 窄根
pnpm sandbox:install   # 通道 B：pack→tarball 装进沙箱 profile（--strict 暴露打包问题）
pnpm sandbox:list      # 包画像：bundle 补丁 / 产物就绪 / 是否已链接
pnpm sandbox:status    # 当前 profile 会加载什么
pnpm sandbox:up        # 前台启动（--detach 后台；--cwd 换工作目录；--verify 就绪后跑验收）
pnpm sandbox:verify    # 起实例→断言→收实例（--attach 复用；--with-host-hmr 加宿主 HMR）
pnpm sandbox:reset     # 删除 .dev/home
```

控制面板：`http://127.0.0.1:3997/__dev/`（按钮触发场景 + 实时看条目/客户端图/HMR 事件）；
机器可读探针：`http://127.0.0.1:3997/__dev/probe`。

### 9.2 文件

| 文件 | 作用 |
| --- | --- |
| `scripts/dev-shared.mjs` | 路径/包索引/最小 YAML 生成/dsh 进程/SSE 收集 |
| `scripts/dev-home.mjs` | 沙箱 home 与 dev profile 的 init / seed / doctor / reset |
| `scripts/dev-profile.mjs` | link / install / unlink / list / status |
| `scripts/dev-up.mjs` | 沙箱实例启动（前台/后台、端口占用检测、token 捕获、state.json） |
| `scripts/dev-verify.mjs` | 共享验收矩阵：隔离 / 组合行 ACTIVE / boot 图 / 客户端 HMR / 宿主 HMR |
| `scripts/install-profile.mjs` | tarball 安装器（新增 `--home` / `--only` / `--register-bundles`） |
| `docs/install.sh` | 类 Unix 一键安装（新增 `--home` / `--repo`，透传 `DSH_HOME`） |
| `docs/install.ps1` | **Windows 一键安装**（与 sh 等价；PS 5.1+，UTF-8 BOM） |
| `dev-harness/dev-plugin/index.js` | 控制平面插件（`/__dev/*`），只由沙箱 home 补丁挂载 |
| `dev-harness/dev-plugin/panel.html` | 控制面板页面（零依赖、单文件） |
| `dev-harness/scenarios/index.mjs` | 场景注册表（线 1/线 2 共用）：ping / entries / client-graph / touch-client-bundle / touch-host-bundle / restore-artifacts / clear-storage / write-fixture |

### 9.3 验收矩阵现状

实测（本机，dsh 0.1.2-rc.1，Windows PowerShell 5.1）：

| 通道 | 结果 | 关键断言 |
| --- | --- | --- |
| link（`sandbox:link` + `sandbox:verify --with-host-hmr`） | **31/31 通过** | 15 个第三方行 ACTIVE（含 hippomemo 的 5 个子路径行）、5 个客户端插件进 boot 图、客户端 HMR（nonce→内容哈希）、宿主 `hmr/reload` |
| install（`sandbox:install` + `sandbox:verify`） | **30/30 通过** | 同上 + 每个包是 tarball 拷贝（hardlink，非 junction）；客户端 HMR 断言打的是 **profile 里的拷贝** |
| `docs/install.ps1` | 全流程通过 | `-DryRun` / `-LocalDir` / 从本地 git 远端 clone→install→build→装进沙箱 profile，装完 `sandbox:verify` 30/30 |

### 9.4 顺带修掉的五个真实缺陷（都与机制无关，但会挡路）

1. **`dsh-ui-kit` 构建脚本跨平台 bug（已修）**：`build/build.mjs` 用 `'/'` 切分 `path.relative` 的结果，
   Windows 下返回反斜杠 → 深度算成 0 → `dist/esm/components/*.js` 生成 `../css/X.module.mjs` 而不是
   `../../css/components/X.module.mjs`，导致 `dsh-hippomemo` / `dsh-spark-dock` / `dsh-spark-finance-client`
   全部 `UNRESOLVED_IMPORT` 构建失败，进而让 `pnpm -r build` 与 `install.sh` 整体失败。
2. **`dsh-spark-plugin-kit` 清单指向不存在的入口（已修）**：`main`/`exports["."]` 指向 `./lib/index.js`，
   实际产物是 `./lib/index.mjs`（tsdown 的 esm 输出）。
3. **`dsh-ui-kit` 的 `test` 脚本指向不存在的文件（已修）**：`node --test test/smoke.test.mjs`，
   而该包下没有 `test/` 目录（唯一的 smoke 测试在 `docs/ui-kit-backup-20260907/` 归档里）。
   它让 `pnpm -r test` 第一步就挂，等于整套单测形同虚设。
4. **vitest 不剥 `.mjs` 的 shebang（已修）**：`packages/dsh-finance/tests/sync-prices.spec.ts`
   import `scripts/sync-finance-prices.mjs`（带 `#!/usr/bin/env node`），而根 `vitest.config.ts` 的
   pre 插件只处理 `.ts`，shebang 进不了 JS 解析器 → `SyntaxError: Invalid or unexpected token`。
   已在插件里统一剥 shebang（对非 TS 文件也生效）。
5. **`dsh-spark-finance-client` 的 4 项陈旧断言（已修）**：`apply.test.ts` 两项仍在断言**已移除**的
   `settings.plugin.item` 注册与 `reflect.get('remote.finance')`（源码注释写明"入口退位 2026-09"，
   设置页入口已由 dock 内嵌承担）；`card.test.tsx` 期望旧 `cardExpand` aria-label（现为
   `dsh-ui-kit/Disclosure` 的 `aria-controls`）；`section.test.tsx` 期望内联样式 `stroke:#a855f7`
   （现由 `DonutChart` 渲染成 SVG `stroke="#a855f7"`）。前两条改写成"不再注册"的契约断言，
   后两条对齐当前标记/渲染形态。`pnpm test` 现已全绿（finance 153 + hippomemo 108 + spark 55 +
   finance-client 128 + 根 vitest 83）。

另外两条实操经验：`pnpm pack` 会触发 `prepack` 构建，因此**仓库根必须先 `pnpm install`**
（否则 `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`）；`link`/`install` 切换时必须清空
profile 的 `node_modules`（Windows 上混用 junction 与拷贝会让 pnpm 在 rename 阶段 EPERM）。

还有一个**未修**的既有隐患：`pnpm -r build` 会留下半构建状态——各包 `build.mjs` 先 `rmSync('lib')`，
一个包失败会中断整轮，其它包的 `lib/` 已被删却未重建。`pnpm sandbox:list` 的 `host✗` 能一眼看出来，
用 `pnpm --filter <pkg> build` 逐个补齐；`dev-profile install` 也会在产物不全时提前报错。

### 9.5 下一步

- P3：dsh 版本矩阵（沙箱 + 指定 dsh 版本 + 同一套断言）
- 仅在确需 React Fast Refresh 时才把线 1 升级为 Vite harness；线 1 的**组件级预览已落地**（§2.6），永久排除在验收门之外

---

## 10. 分发模型：Release 托管预构建产物（P2 已落地）

**动机**：原路径让每个用户 `git clone` + `pnpm install`（整个 monorepo 依赖闭包）+ `pnpm -r build`，
既慢又不可复现（构建环境差异会变成"我这能跑"），还要求 git/pnpm。改成 **CI 构建 → Release 托管 → 脚本下载校验安装**：

```
打 tag vX.Y.Z
   └─ GitHub Actions: install → build → typecheck → test
        └─ pack-release.mjs: pnpm pack 闭包 → dist-release/{manifest.json, SHA256SUMS, release-install.mjs, *.tgz}
             └─ softprops/action-gh-release: 上传为 Release 资产
                  └─ verify job: 用**刚发布的资产**装进干净沙箱 → 跑同一套验收矩阵
用户侧
   └─ install.sh / install.ps1: 取 manifest.json → 校验 release-install.mjs 的 sha256
        └─ release-install.mjs: 下载各 tgz → 校验 sha256 → 写 profile（file: 依赖 + overrides + bundles）→ pnpm install
```

### 10.1 资产与清单

`manifest.json`（schema 1）：

| 字段 | 含义 |
| --- | --- |
| `version` / `tag` / `commit` / `builtAt` / `toolchain` | 发布身份与构建环境 |
| `dsh.policy` / `dsh.tested` / `dsh.compat` | 兼容策略（当前：只保证最新版）。`tested` 取打包环境的 `dsh --version`（CI 装 `@latest`），`compat` 由它推导为 `^tested` |
| `installer` | 单文件安装器 `release-install.mjs` 的 `sha256`/`size`（bootstrap 先验它） |
| `defaultBundles` | profile 不存在时用于初始化的 bundle 列表 |
| `bundles` / `plugins` | 需要登记进 `dsh.profile.bundles` 的包 / 可选安装的插件 |
| `packages[]` | 每包 `name`、`version`、`file`、`sha256`、`size`、`bundle`、`plugin`、`deps`（改写后的依赖，用于取闭包） |

### 10.2 脚本

| 脚本 | 角色 |
| --- | --- |
| `scripts/pack-release.mjs` | CI 侧：构建（可 `--no-build`）→ 产物完整性预检 → pack 闭包 → esbuild 打包单文件安装器 → 写 manifest + SHA256SUMS |
| `scripts/release-install.mjs` | 用户侧：读清单 → 校验 dsh 兼容 → 下载+校验每个 tgz（缓存命中跳过）→ 写 profile 并 `pnpm install`。**无仓库依赖**，被 esbuild 打成单文件资产 |
| `scripts/lib/profile-install.mjs` | 「写 profile 依赖/overrides/bundles + pnpm install」的唯一实现，`install-profile.mjs` 与 `release-install.mjs` 共用 |
| `scripts/lib/workspace.mjs` | 包索引 / 闭包 / `pnpm pack` / workspace 依赖改写，源码路径与发版路径共用 |
| `docs/install.sh`、`docs/install.ps1` | bootstrap：下载清单与安装器 → 校验安装器 sha256 → 交给安装器。`--from-source` 保留旧的 clone+构建路径 |
| `scripts/remote-verify.mjs` | 线 3：从发布资产（GitHub / 本地目录 / file://）安装到沙箱 → 跑共享验收矩阵 |

`release-install.mjs` 也支持直接跑（`node scripts/release-install.mjs --base-url dist-release`），
`--base-url` 接受 `https://`、`file://`、本地目录三种形式——因此离线镜像与本地自测走同一条代码路径。

### 10.3 CI

| 工作流 | 触发 | 内容 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR | 构建 + typecheck + 测试 → `pack-release --version 0.0.0-ci` 干跑（保证"能打包"长期成立）→ `install-verify`：用打出的包真实安装 + 跑验收矩阵 |
| `.github/workflows/release.yml` | tag `v*` / 手动 | 构建 + 测试 → 打包 → 发布 Release → **verify job 从 GitHub Release 下载并验收** |

### 10.4 实测（本机，dsh 0.1.2-rc.1）

| 项 | 结果 |
| --- | --- |
| `pack-release --version 0.2.0 --no-build` | 15 个 tarball + manifest + SHA256SUMS + 单文件安装器，总体积 **1.27 MB** |
| `release-install` 到**全新 home**（`.dev/release-home`，profile 自动创建） | 15 包安装成功；boot 后 `/plugins/events` 图里 5 个客户端插件全部就位 |
| `remote-verify --base-url dist-release` | **30/30 通过**（隔离 / 15 行 ACTIVE / boot 图 / 客户端 HMR，且断言打在 profile 内的拷贝上） |
| `docs/install.ps1`（release 路径，`-BaseUrl` 指向本地发布目录） | 清单下载 → 安装器 sha256 校验 → 安装成功 |
| `docs/install.sh` | `bash -n` 通过 + WSL 下 dry-run 流程通过（真实网络路径由 CI 覆盖） |

> 注意：真实 GitHub 下载路径（`releases/latest/download`）只能由 CI 或发布后验证覆盖；
> 本机测试用的是本地发布目录，两者走的是同一份代码（`readAsset` 只区分 http/file/本地）。
> npm registry 发布仍可作为后续通道（`pnpm publish:all` 已存在），但 Release 是当前默认路径。

### 10.5 dsh 兼容策略：只保证最新版

不做多版本矩阵。做法是把「兼容」变成**发布时的一次真实验证**：

1. CI 的打包与验收 job 都装 `@deepseek-ai/dsh@latest`；`pack-release` 记录打包环境实际版本为
   `dsh.tested`（也可用 `--dsh <version>` 显式指定），并推导 `compat = ^<tested>`。
2. `release.yml` 的 verify job 反过来装**清单里记录的 `dsh.tested`**，用发布出去的资产跑验收矩阵——
   验证「兼容声明」本身成立。
3. 安装器拿本机 `dsh --version` 与清单比对：与验证版本一致 → 通过；同一 minor 但不同 rc → 告警；
   更旧或更大版本 → 告警（`--strict-version` 可改成硬失败）。本机没装 `dsh` 时只提示。
4. dsh 升级后：跑 `pnpm check:dsh-upgrade`（快检 API 面）→ `pnpm dryrun:dsh-upgrade`（干净安装 + 全仓
   typecheck）→ 修完再打新 tag。`docs/UPGRADE-PROTOCOL.md` 仍是这套流程的真源。
