# AGENTS.md — AI Agent 研发规范（唯一真源）

本文件是本仓库一切 AI Agent（Claude / DeepSeek / GLM / Codex / 任何 Harness）的**统一开发规范**。
任何会话开始编码前必须先读完本文件；与本文件冲突的旧习惯一律以本文件为准。
修改规范本身 = 修改本文件，并在 commit message 里用 `docs(agents):` 标注。

CLAUDE.md 是指向本文件的指针，不要在两处维护内容。

---

## 0. 铁律（违反 = 直接返工）

1. **改插件 `src` 的 commit 必须 bump 该包 version**。闸门 `check:version-bump` 逐 commit
   比对（剥离注释后逐字节比较）；纯注释/测试改动可免 bump。发版面见 `pnpm check:all`。
2. **验收链必须全绿才能收尾**：`pnpm -r build`、`pnpm -r typecheck`、`pnpm -r test`
   顺序执行（不要并行，见 §4）；外加 `pnpm check:all`（架构+对比度+版本三闸门）、
   `pnpm preview:verify`（预览保真）；改了 host/产品链路时加跑
   `node dev-harness/real-host-check.mjs`（退出码必须为 0）。
3. **禁止 window 当页内事件总线**：`packages/*/src` 出现 `new CustomEvent('dsh-*')` /
   `addEventListener('dsh-*')` 会被架构闸门硬失败。跨端事件一律走宿主 cordis
   `emit/on` + typert stream（见 2.4）。
4. **「面板能渲染」证明不了任何架构承诺**。网关在端点未注册时会静默退回 SRC 兜底，
   UI 照样能跑。任何注册类改动必须以 `/__dev/probe` 的 typert 注册面断言
   （endpoints / descriptors / resultMode === 'strict'）为准，
   模板见 `dev-harness/real-host-check.mjs`。
5. **契约不允许手抄两份**。remote 方法、schema、类型只在 wire 包声明一次（见 2.2）。
6. commit 走 Conventional Commits（`feat/fix/refactor/docs/chore(scope)!`），scope 用包短名
   （finance / dock / kit / wire…）；破坏性改动加 `!` 并在 body 写清迁移路径。

---

## 1. 项目级规范

### 1.1 仓库形态

pnpm monorepo。`packages/*` 里每个包必须落在 `plugin-registry.json` 的插件 + workspace
依赖闭包内（架构闸门第 1 查 orphans 清退孤包）。发布产物是 tarball（`pnpm release:pack`），
插件以 tarball 拷贝形态装入真宿主沙箱——与用户安装完全一致。

### 1.2 本地验证工作流（install 通道无 HMR）

```
pnpm sandbox:install   # 重装沙箱插件（改码后必须重跑）；末尾自动跑启动冒烟
pnpm sandbox:smoke     # 单独跑启动冒烟（临时端口起真实例：不抛异常 / 页面能开 / 模块不崩）
pnpm sandbox:up        # 启动真宿主（默认 127.0.0.1:3997，前台阻塞，放后台跑）
node dev-harness/real-host-check.mjs   # 真宿主验收（CDP 无头 Edge）
pnpm preview           # 组件级预览（mock 通道）
pnpm preview:verify    # 预览保真断言
```

**改了 src 必须重跑 `sandbox:install` 并重启宿主**，否则验证的是旧产物。
`install-profile` 只**打印**过「启动验证」命令、从不真启动，所以装成功 ≠ 起得来：
`pnpm sandbox:install` 末尾会真的起一个临时实例，断言「启动不抛异常（日志 + 探针条目/服务面）+
页面能开（无头浏览器）+ 每个模块点开不崩 + 声明 `dsh.client` 的包都进了 clientGraph」，
失败即非零退出（`--no-smoke` 只用于临时迭代）。
`.dev/state.json` 存宿主 url；真宿主脚本默认读它。

### 1.3 文档与评审

- 架构决策以评审项编号（F* / P* / W* / ADR-*）追踪，验收报告落 `docs/architecture-acceptance-*.md`。
- **领域规范源**：财务价格体系以 `docs/FINANCE-PRICING-SPEC.md` 为唯一规范源（不变量 INV-1..8、
  三层合并 / 生成器契约 / 验收 A1..A8）。改价格相关代码前先读它；实现与 Spec 冲突时**先改 Spec**
  （commit 用 `docs(finance):`）。
- 关闭评审项必须写清**关闭口径**（解决了哪条腿），禁止一条 commit 宣称关掉两条腿。
- 定时器分两类：**轮询模拟事件**（反模式，必须事件化/stream 化）与**真·时间驱动**
  （如滚动窗口过期，允许保留，但必须写豁免注释说明理由，模板见
  `FinanceAuditSection.tsx` 的 30min 定时器注释）。

---

## 2. 架构层规范

### 2.1 包角色与依赖边界（闸门第 2 查，scripts/check-architecture.mjs 的 ALLOWED_EDGES）

| 角色 | 包 | 允许依赖 |
|---|---|---|
| app | dsh-spark-dock | 不限（唯一允许静态 import 插件 UI 产物的包——但 ADR-003 后实际零 import） |
| client | `*-client` 等出 web 产物的包 | plugin-kit, ui-kit, wire, host |
| host | 其余宿主包 | wire, plugin-kit |
| plugin-kit | dsh-spark-plugin-kit | **禁止依赖任何 workspace 包** |
| ui-kit | dsh-ui-kit | **禁止依赖任何 workspace 包** |
| wire | `*-wire` | **禁止依赖任何 workspace 包** |

宿主编译期硬禁（会打进 lib/index.js）：`react` / `react-dom`、`dsh-ui-kit`、
`@deepseek-ai/dsh-client-*`、任何 `*/client` 或 `*/embed` 入口。
wire 包必须协议纯净：只允许 zod + typert 协议类型，禁 cordis / react / platform client。

### 2.2 契约单源（P5）

Remote 契约（InvocationDescriptor + Zod schema + 反射模型）**只在 `*-wire` 包声明一次**。
host 用 `ctx.inject(['typert'], c => c.typert.register(CONTRIBUTION))` 注册（可选注入，
保住 headless 可用性）；client 用 `ctx.remote.$mount(CONTRIBUTION)`。
领域类型 face 留在 host 包 types 并 re-export；wire 不带 `sourceLocation`
（生成器产物必漂移）。wire 描述符与反射成员必须自洽（闸门第 3 查 contracts）。

### 2.3 注册三条路径与验收陷阱

1. 显式 `ctx.typert.register()`（finance 用这条）；
2. 平台 typert-loader 读 `exports['./typert']`（要求 manifest.package === 包名）；
3. 网关 SRC 标记兜底（未注册时静默走这条，UI 照常渲染）。

所以注册类改动必须按铁律 4 用注册面断言证明。注意 `registry.local` 是宿主侧调用定义；
`registry.remotes` 在宿主进程恒为空。

### 2.4 typert stream（事件推送）模式

客户端需要宿主主动推数据时不许轮询，走 stream（范本：dsh-finance 的 `finance/events`、
dsh-hippomemo、dsh-spark）：

- wire：帧 schema 用 discriminatedUnion（`ready` 基线帧 + 数据帧），帧形状镜像既有帧契约；
  descriptor 声明 `service: '<x>Events'`、`namespace` 归主命名空间、method 返回
  AsyncIterable、`resultMode: 'strict'`。
- host：独立 Cordis service（`XxxEventsService extends TypertRemoteService`，
  `super(ctx, 'xxxEvents', { namespace: 'xxx' })`）；桥接逻辑抽成纯函数 `events.ts`，
  队列/取消/基线复用 kit 的 `bridgeEvents`。**不挂 `@Remote` 装饰器**：tsdown/oxc
  不降级装饰器语法，会让宿主 lib SyntaxError（实测）；描述符是唯一真源。
- 事件源：宿主侧只走 cordis 一条总线（`ctx.emit('xxx/yyy', ...)`）；变更源就地改写
  可变对象后用 `onProgress` 类钩子触发（不要包 Proxy）。
- client：kit `subscribeFrames`（reference-counted dispatcher），订阅生命周期归 UI
  挂载层（dock module）所有。
- 兼容策略：被替换的 strict 端点保留一个 minor 给旧客户端。

### 2.5 cordis inject 规则

- 服务内跨服务**属性访问**（`ctx.otherService.field`）必须声明 `static inject`，
  否则运行时抛 `cannot get property ... without inject`；`ctx.on` / `ctx.emit`
  事件总线不受此限。
- 需要兄弟服务的数据时优先由**组合根传闭包**
  （如 `new EventsService(ctx, () => this.snapshot)`），而不是加宽 inject 面。
- 可选平台能力（typert / settings / sessionProjections / llm ...）一律
  `ctx.inject([...], cb)` 可选注入，保住 headless 组合可用。
- 读可能不存在的服务属性时 try/catch 降级（先例：`readDescriptorPrices`）。

### 2.6 UI 上屏与自注册（ADR-003，唯一形态）

插件功能 UI 只有一种形态：dock 悬浮球 + 指挥舱，注册到 `shell.overlay`。设置页插槽
（`settings.section` / `settings.plugin.item`）已退役删除。模块全部由各自 client 入口
`apply()` 调 kit 的 `registerDockModule()` 自注册——**新增插件不改 dock 任何代码**。
dock 声明子槽并用平台 `renderSlot(key, { variant, activeId, onSelect }, { only, fallback })`
渲染 rail/header/pane 三位。插件 inject 需自带原由 dock 代持的服务
（locale / remote / remote.credentials / settingsScope / slots），由架构闸门 inject 面守护。
**纯 UI 插件（只有 `dsh.client`、没有 `dsh.bundle`）必须在某个 bundle patch 里有 loader 行**
（`- id: x-client, name: 'pkg-client'`），否则 `dsh-client-modules` 不会扫到它 —— 不报错，
只是 dock 里永远没有这个模块（2026-09-21 dsh-script-client 实测）。改注册面按铁律 4
用 `/__dev/probe` 的 `clientGraph.entries` 断言。

**客户端取 remote 命名空间只有一条路：`ctx.reflect.get('remote.<ns>')`**。
`remote.<ns>` 是本包 `$mount` 之后才提供的服务：写进 `inject` 会死锁，而直接在
`ctx.remote.<ns>` 上点出来会被平台的 inject 门拦下（`cannot get property "remote.<ns>"
without inject`）；`$stream` 载体仍是 `ctx.remote`。**这道门只在真宿主存在** —— 预览的
mock remote 是普通对象，于是「预览全绿、真宿主事件流整条死掉且只有 console 警告」
（2026-09-22 dsh-script-client 实测，范本见 hippomemo 的 `hippomemoChannelOf`）。

---

## 3. UI 层规范

1. **组件唯一来源是 `dsh-ui-kit`**（角色 ui-kit，零反向依赖）。客户端可依赖 ui-kit；
   宿主永远不碰 react / ui-kit（见 2.1）。
2. **颜色只允许来自设计 token**，禁止自造色与静态回退——`pnpm check:contrast` 逐项审计：
   对比度硬性不达标、token 硬失效、token 静态回退、文档自造色、设计稿漂移、
   **插件源码直连宿主 token**，任一非零即失败。UI 改动必须重跑该闸门。
   **插件 UI 直连 `--spk-*`，禁直连 `--dsw-alias-*` / `--dsw-static-*`**：真宿主里这些名字由宿主
   自己定义，取值与 ui-kit 桥接段不同 —— 闸门与预览按桥接值算、真宿主按宿主值渲染，
   于是出现「对比度全绿而真宿主 3.42:1」（PCQA-007）；例外只有字体栈与阴影。细则见
   `docs/UI-UX-SPEC.md` §2.1。
3. React 18 函数组件 + hooks；客户端产物经各包 `lib/client.js` 出 embed 形态供 dock 内嵌。
   SSR 安全：不要引入依赖 window 的模块级副作用（useLayoutEffect 的 SSR 告警可忽略）。
4. **文案必须走 locale 字典**（各 client 注册 `locale`，`t(key)` 取词），文案归模块所有，
   壳（dock）只呈现——禁止壳里写死模块文案（F7 先例）。
5. a11y 是验收项：状态区 `role="status" aria-live="polite"`、进度条 `role="progressbar"`
   + aria-valuenow、可交互元素有可断言的 aria-label / testid（preview:verify 与
   real-host-check 都按这些选择器断言）。
6. 视觉规范以 `docs/spark-dock-design.md` 与 ui-kit demo 为准；改 UI 先开 `pnpm preview`
   对照，不凭空发明样式。
7. **组件/页面/形制的完整规范见 `docs/UI-UX-SPEC.md`**（token 语义、间距/圆角/字号标度、
   组件状态矩阵、四种页面模板、四态反馈、aria 模式表、密度变体模式）。UI 改动前必读。
8. **业务口径不在 UI 重算**：成功率 / 占比 / 分档这类**结论**由宿主算好、随读模型下发
   （UI 拿不到原文，也就没有算错的机会）；宿主只下发病据**数字**，用户可见措辞一律走
   locale 字典（宿主写死中文句子会泄漏到 `en` 面）。全仓口径除法**只允许出现在它的
   定义文件里**，闸门 `ratemetric` 逐文件拦截（先例：`dsh-script` 的 `src/metrics.ts`，
   规范源 `docs/SCRIPT-LIBRARY-SPEC.md` INV-7 / D10）。

---

## 4. 语言与工程细节（踩过的坑）

- **TypeScript erasable 风格**：host 测试跑在 Node type-stripping（`node --test test/*.ts`）
  下——源码禁止 enum / namespace；纯函数可测，装饰器只做包装（且 host 产物连装饰器
  都不能有，见 2.4）。
- host 对 typert 协议的 .d.ts 增强（`declare module '@deepseek-ai/dsh-typert-protocol'`）
  集中在 host 的 types.ts；加 remote 方法时同步补 namespace / map 两处。
- Zod 是唯一校验层：跨 wire 的每个值都有 strict schema。值内领域结论（如业务 `ok`）
  与传输信封 `ok` 正交（F12 约定第 5 条）。错误语义统一用 kit `remote-result.ts`
  （messageOf / remoteFailureOf / unwrapRemote），客户端不许自己发明解析。
- **build 与 typecheck 不并行**：typecheck 会读到半写的 `lib/` 产物，产生假
  TS2307 / TS2339。顺序执行。
- **ESM 源码禁裸 `require()`**：产物一律 ESM（`build.mjs` / tsdown 的 `format: 'esm'`），
  esbuild 只把裸 `require('node:os')` 降级成 `__require(...)` —— ESM 里没有 `require`，
  运行时抛 `Dynamic require of "node:os" is not supported`。它最毒的地方是常落在
  try/catch 兜底路径上：dsh-spark 的 `defaultScriptsFilePath()` 因此**静默**失败，
  脚本目录的种子从未跑过、`scripts.jsonl` 从未创建（2026-09-21，真宿主探针实测）。
  路径/内置模块一律顶层 `import`；`check:architecture` 的 `esmrequire` 逐文件拦截。
- **同一 HTTP 前缀只能有一个注册者**：`ctx.webServer.register({ kind: 'prefix' })` 对
  重复路径是硬失败（`webserver: duplicate prefix route "/x"`）。两个服务各注册一遍
  「三条前缀」会让后注册者抛错——若它抛在某个 `init()` 的 try 里，init 会**在后续步骤
  之前**中断（SparkService 就是这么把种子脚本跳过的）。按服务归属拆注册函数。
- Windows 本机：CDP / undici 收尾不要 `process.exit()`（libuv 断言 0xC0000409 会把全绿
  变非零退出），显式 `ws.close()` + `process.exitCode` 自然排空。
- 平台版本 pin 由 `bump-dsh-pins.mjs` / `check-dsh-upgrade.mjs` 管理，不要手改。

---

## 5. 收尾 Checklist（每个任务结束前过一遍）

- [ ] `pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test` 全绿（顺序执行）
- [ ] `pnpm check:all` 全 PASS；动了发布输入的 commit 都带 bump
- [ ] `pnpm preview:verify` 全过；UI 改动另跑 `pnpm check:contrast`
- [ ] 动了 host / 注册面 / stream：`pnpm sandbox:install`（自带启动冒烟必须过）+ 重启宿主
      + real-host-check 退出码 0，且断言了注册面（不止看渲染）
- [ ] commit 符合 Conventional Commits；评审项关闭口径写清
- [ ] 新增反模式防线 → 加进对应闸门脚本，而不是只写文档