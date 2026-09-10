# 零 dsh 预览（`pnpm preview`）

> 目的：**机器上不需要任何 dsh 安装、不写任何 profile、不起 dsh 进程**，就能在浏览器里
> 看到**仿真 dsh web 外壳 + 真 spark-dock 悬浮球**，点开面板做本地开发自测。
> 定位是 `docs/LOCAL-DEV-HARNESS.md` 的「线 1」。
> 需要真宿主、真槽位、真 RPC 的联调请走线 2 沙箱（`pnpm sandbox:up`，3997）。

## 30 秒上手

```bash
pnpm preview          # http://127.0.0.1:5180/   默认画布 = Dock 悬浮球，改码自动重建 + 页面自动刷新
pnpm preview:source   # 同一端口，插件改吃 packages/*/src/client/embed.ts（免构建，改源码最快）
pnpm preview:verify   # 自检 52 项：Node 冒烟 + 服务器/fixture 断言；退出码即结论
pnpm preview:layout   # 真渲染盒模型走查：重叠 / 横向溢出 / 折行必须为 0
pnpm preview:titles   # 子页标题层级走查：重复的 Title/Label（V1/V2/V3）必须为 0
```

前置：仓库已 `pnpm install`，且各包**已构建**（`pnpm build`，或至少 `packages/*/lib/embed.cjs`、
`packages/dsh-plugin-kit/lib/client/`、`packages/dsh-ui-kit/dist/` 存在）。不需要 dsh。

## 默认画布：Dock 悬浮球（模拟真实 dsh web）

左栏第一项 **Dock 悬浮球**：画布是仿真的 dsh web 会话界面（侧栏 + 会话流 + 输入框），
右下角是**真的** `dsh-spark-dock` 悬浮球。

- 点一下 → 展开真面板：左侧模块栏（火花 / 记忆 / 成本 / GitHub / npm）+ 模块头 + 子页 + 各插件的**完整设置 UI**。
- 拖动悬浮球 → 4px 阈值起拖、松手吸附最近角；位置与开合状态记在 `localStorage`。
- 「复位悬浮球」清掉 `dsh.spark-dock:*` 并重载；Esc 或再点球可收起面板。
- 面板按球的位置反向弹出并夹在视口内，压住球时自动把球提到面板之上。

装配方式**镜像 `packages/dsh-spark-dock/src/client/index.ts` 的 `apply()`**（见 `src/panes/dock.tsx`）：
注册四个插件的 locale 字典 → 注入 `DOCK_CSS` 与 `HIPPOMEMO_CSS` → `setHippoT` →
`startGithubEmbed / startNpmEmbed / startFinanceEmbed` → `setReflectGetter` → 渲染 `<DockOverlay />`。
唯一差别是 ctx 是假宿主，且不注册 `shell.overlay` 槽位（预览直接把 `DockOverlay` 挂在页面里）。

> dock 的 embed starter 是**模块级单飞**，所以切语言/场景会**整页重载**（等价于宿主重载插件）；
> 只切主题不用重载。

## 其余画布：组件级单渲染

| 画布 | 真产物入口 | 假后端 |
| --- | --- | --- |
| GitHub 连接器 | `dsh-connector-github-ui/embed` | `remote.github` + `remote.credentials`（`ghp_bad…` → 401） |
| npm 发布管线 | `dsh-connector-npm-ui/embed` | `remote.npm`（`npm_bad…` → 403） |
| 财务审计 | `dsh-spark-finance-client/embed` | `remote.finance` + 内存版 `settingsScope`（能改能还原） |
| 记忆（HippoMemo） | `dsh-hippomemo/embed` | 预览服务器 `/hippomemo/*` fixture |
| UI Kit 组件 | `dsh-ui-kit` | 无（纯组件） |

顶栏通用能力：**中文 / English**、**暗色 / 亮色**、**`ok | empty | error` 三档场景**、**重载**；
产物变更后 SSE 自动整页刷新；探针 `/__preview/probe` 给机器读。

可交互的假后端细节：

- **GitHub**：粘贴 `ghp_bad…` 测试连接 → 401 失败态；保存 token → 凭据状态刷新；代理测试返回固定延迟。
- **npm**：粘贴 `npm_bad…` → 403 缺权限提示；正常 token → 状态面板显示 login。
- **财务审计**：改字段出现 override 徽标、保存/还原都真的生效（刷新即复原）；
  `listProviders` / `getLedger` / `refreshBalance` / `syncCommunityPrices` 全部有假实现。
- **HippoMemo / spark**：真 `fetch` → 预览服务器 fixture（8 条记忆 + 引用 + 偏好 + 候选；
  4 条火花 + 3 条提议 + 2 个脚本，捕获/归档/决议/调用都写进内存态）。

## 为什么"不装 dsh"能成立

1. 四个插件包都导出 **`./embed` 库形态入口**（`lib/embed.cjs`），产物里唯一的 `require` 只有
   react / react-dom——`dsh-ui-kit`、`dsh-spark-plugin-kit`、`dsh-*-wire`、`dsh-client-store`
   在构建时已内联，**没有 `@deepseek-ai/*` 运行时依赖**。
2. 预览只需要补上宿主那一半：`ctx.effect / locale.register|bind / remote.$mount|$on|credentials /
   reflect.get / settingsScope.bind`（见 `src/mock/ctx.ts`，形状来自 `docs/LOCAL-DEV-HARNESS.md` §1.6 实测）。
3. 根 `node_modules` 不 link 工作区包，所以用 esbuild 的 resolve 插件把包名指到真实文件。

## 与真宿主的一致性边界

| 一致 | 不一致（需线 2 才能覆盖） |
| --- | --- |
| 悬浮球/面板组件、四个插件设置页、controller、字典、CSS Modules、`dsh-ui-kit` 组件与令牌 | 槽位注册（`shell.overlay` / `settings.section`）与真 shell 布局 |
| dock 的装配顺序（字典 → CSS → embed starter → reflect） | cordis 生命周期、`clientModules` 的 boot 图与 `rev` 缓存 |
| remote 调用形状（`RemoteResult` 信封、参数、错误分支） | 真 RPC / SSE 传输、`__DSH_TRANSPORT__`、并发与重连 |
| `settingsScope` 的 set/unset/user 层语义 | 真 settings 文档持久化与 revision 竞争 |
| spark / hippomemo 的真 fetch 路径与 SSE | 真宿主下的会话数据、凭据落盘 |

## 自检覆盖（`pnpm preview:verify`）

- Node 冒烟（`tests/smoke.tsx`，真产物 + 假宿主，无 DOM）：
  **dock** `DockOverlay` 渲染出球/面板/五个模块 tab + `DOCK_CSS` 非空；
  github `load`/`testConnection`/`saveToken` + 渲染；npm `load`/`testConnection` + 渲染；
  finance `load`（ledger + providerList）、scope set/unset、渲染；error / empty 两档场景。
- 服务器断言：`/`、`/preview.js`（含 CSS 内联证据、无裸 require 外链）、`/tokens.css`
  （`--spk-*` 与 `--dsw-*` 桥接）、`/__preview/probe`、场景切换接口。
- fixture 断言：`/hippomemo/*` 与 `/sparks|/proposals|/scripts` 的信封形状、条目数、
  四类候选计数、捕获写入、empty/error 两档。

## 已知限制

- 预览渲染的是 **dock 的源码组件**（`src/client/DockOverlay.tsx` + 复刻 `apply()` 的装配），
  插件侧则是 `lib/embed.cjs`（或源码口径的 `src/client/embed.ts`）；**都不是**
  `window.__ModuleLoader__` 包装的 `lib/client.js`。因此它验证不了 dsh 的 boot 图、
  `dsh.client.external` 外部化与 `rev` 缓存——那部分口径由线 2 沙箱（`pnpm sandbox:verify`）承担。
- 假 remote 是**页面内对象**，不走 HTTP；只有 hippomemo 与 spark 是真 fetch（它们本来就是 fetch）。
- dock 的 embed starter 是模块级单飞：切语言/场景靠整页重载，不能只重挂画布。
- 没有 React Fast Refresh：改码后 esbuild 重建 → 整页刷新（会话状态会丢）。
- `dev-harness/preview/**` 不参与 `tsc`（esbuild 直接吃 TSX），它的门是 `preview:verify`。

## 走查「重复的 Title/Label」（`pnpm preview:titles`）

用于「以 hippomemo 进化页为标准重构插件 UI」这类工作的机器判据：CDP 驱动 headless Edge，
把 dock 每个模块子页**真实渲染**出来的标题/标签/卡片铺平，按真实 DOM 位置判语义位
（卡头 / 卡内小标题 / 字段标签 / 行内元信息），再报三类违规：

| 规则 | 判据 |
| --- | --- |
| V1 | 子页内有卡头文本 == dock 模块头标题（模块头已说了这一页是什么） |
| V2 | 同一文本既是某张卡的卡头、又是卡内小标题或字段标签 |
| V2b | 同一张卡里，卡头的元信息（计数/时间）与该卡内的小标题同名 |
| V3 | 同一子页里两张不同的卡，卡头文本完全相同 |

退出码即结论。默认逐页走 **5 个模块 / 16 个目标**（`--tabs` 声明内层页签：
`火花:火花流,涌现提议,脚本目录;记忆:总览,记忆,偏好,进化;财务:总览,连接,供应商,高级`），
`--module 记忆` 定点，`--json` 出机器可读报告（`.dev/title-audit/report.json`），
`--html` 直接 dump 目标页的真实 DOM 逐层结构（核对语义位判定用）。
输出还含「卡片分割」清单（每张卡的 y/高/首行）与 `display:none` 的标题 —— 后者是
「渲染了再用 CSS 擦掉」的遗留证据。标准形制与规则见 `design-system/spark-dock/MASTER.md` §5。

## 排障

| 现象 | 原因 / 处理 |
| `/preview.js` 返回 503 | 构建失败。看 `/__preview/probe` 的 `errors`，或跑 `pnpm preview:verify` 看首条错误 |
| 页面空白、控制台报 `Could not resolve …/embed` | 该包没构建：`pnpm build`（或 `pnpm --filter <pkg> build`） |
| 悬浮球/面板没样式 | `packages/dsh-spark-dock` 的 `DOCK_CSS` 没进来：看 `pnpm preview:verify` 的 dock 组断言 |
| 样式全丢 | `packages/dsh-ui-kit/dist/styles/tokens.css` 不存在：`pnpm --filter dsh-ui-kit build` |
| 球跑到屏幕外了 | 顶栏「复位悬浮球」（清 `dsh.spark-dock:*` 后重载） |
| 端口被占 | `node dev-harness/preview/server.mjs --port 5181`（`pnpm preview -- --port 5181`） |
| 想确认"没碰 dsh" | 预览进程不读 `DSH_HOME`、不写 `~/.dsh`；`/__preview/probe` 里也没有任何 home 字段 |
