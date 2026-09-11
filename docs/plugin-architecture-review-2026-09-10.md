# 插件架构评审：事件底层与插件组合（2026-09-10）

> **状态（2026-09-10 晚）**：**P0 + P1 已落地并验证**（见 §7 实施记录）；P2（hippomemo）
> 已落地；P3–P5 待做。
>
> **状态（2026-09-11）**：**P4 部分落地** —— 退役世代 `dsh-spark-ui` 已从 workspace 删除，
> 随之删掉 plugin-kit 里唯一为它服务的 `registerSettingsSection`，以及无消费者的
> `settings-card.ts`（`StagedSettingsCard` 状态模型）；`embed.cjs` 双产物与文案映射归属
> 仍未动（见 ADR-005 的 ①③）。F8 因此关闭。
>
> **状态（2026-09-11 晚）**：**P3（ADR-003）已全量落地并在真宿主验收** —— dock 声明
> `spark.dock.module` 子槽并用 `renderSlot` 渲染三个位，五个模块全部自注册，
> `modules.tsx` 与 dock 侧三处 embed pane 删除，dock 的 client bundle 从 3.3MB 降到
> 664KB（不再内联任何插件 UI），新增插件零改 dock。真宿主（沙箱 3997）22/22 通过。
> F4 关闭；F6（双产物）只剩 dev-harness 的组件级预览仍吃 `embed.cjs`。
> 新增闸门：`pnpm check:architecture` 的 **inject 面覆盖**（client 用到 `ctx.slots` /
> `ctx.remote.credentials` 却没写进 `inject` → 真宿主会让整条 loader entry 失败）。
>
> **状态（2026-09-11 深夜）**：**W4（F14 预览保真）已落地** —— 假宿主加
> **inject 门**（未声明服务访问抛 `cannot get property "X" without inject`；
> `remote.<ns>` 动态命名空间必须走 reflect，直接读同样抛错）、预览侧写入路径改为
> **按 wire schema 单源校验**（`fixtures/sparks.mjs` 直接用 `dsh-spark-wire` 的
> `sparkCaptureSchema` / `sparkPatchSchema`，缺 `sourceSessionId` 返回 400
> BAD_REQUEST，与真宿主同形），mock ctx 增加 **teardown** 生命周期替身。
> `preview:verify` 从 61 项扩到 **74 项**，其中 11 项专测这三类保真：契约必填、
> inject 门、以及「五个插件真 `apply()`（带 inject 门）→ 自注册顺序 → teardown 注销」。
>
> **评审范围**：`packages/*` 全 17 包的 host/client 数据面与事件面，重点是「事件如何从宿主到浏览器」
> 与「dock 如何组合五个插件」。结论基于**逐文件核对**，每条发现都带 `文件:行` 证据；
> 未能证实的一律标注 **UNVERIFIED**。
>
> **一句话结论**：宿主侧的事件总线（cordis）没问题，**浏览器侧根本没有总线** —— 每个插件各自
> 手写一条 SSE、各自手写一个客户端订阅实现，dock 再把它们硬编码聚合起来。而平台**本来就有**
> 一条类型安全、多路复用、逐项 schema 校验的推送通道（typert `mode: 'stream'` + remote mux），
> 仓库只在 connector 的 settings/credentials 上用了它，自己的领域事件却全部绕开。

---

## 1. 结论摘要

| # | 发现 | 严重度 | 证据 |
| --- | --- | --- | --- |
| F1 | **浏览器侧没有统一事件层**：4 条手写 SSE 端点 + 3 套客户端订阅实现 + 1 条 RPC mux 并存 | P0 | `dsh-spark/src/http.ts:258-295`、`dsh-hippomemo/src/http.ts:124-135`、`dock/src/client/streams.ts`、`dsh-hippomemo/src/client/api.ts:117-123` |
| F2 | **事件契约不跨线**：host 的事件 union 明写「never cross the wire」，却正是 SSE 的载荷；客户端把契约手抄一遍且是无类型 `string` | P0 | `dsh-spark/src/types.ts:16-22` vs `http.ts:266`；`dsh-hippomemo/src/client/api.ts:89` |
| F3 | **平台已有的统一通道没被采用**：第三方插件可用 `mode:'stream'`（自有命名空间 + 逐项 codec + 单一 mux 载波 + 可取消），而 `ctx.remote.$on` 的转发白名单是 first-party 常量，第三方加不进去。**全仓 `mode:'stream'` 实例数 = 0**（grep 零命中），即这条通道从未被验证过 | P0 | `dsh-typert-protocol/lib/types/types.d.ts:181-221`；`dsh-api-remotes/lib/types/remote-events.d.ts:12-69` |
| F4 | **dock 是编译期聚合器，不是外壳**（**已关闭**：2026-09-11 P3/ADR-003 落地，五个模块全部自注册，`modules.tsx` 已删）：5 个模块的元数据硬编码在 dock，加一个插件要改 dock 源码并重新发版 | P1 | `dock/src/client/modules.tsx:61-94`、`dock/src/client/index.ts:9-17,39-83` |
| F5 | **共享基础设施长在 app 包里**：唯一正确的连接复用实现（refcount 注册表）在 dock 内部，插件无法复用；hippomemo 因此自己开 EventSource，且有**两处**订阅点无引用计数 | P1 | `dock/src/client/streams.ts:35-52`；`dsh-hippomemo/src/client/api.ts:117-123`、`MemorySection.tsx:446,1234` |
| F6 | **一个插件两份客户端产物、两次挂载**：`client.js`（平台 loader）与 `embed.cjs`（给 dock 用）并存；同一 remote 命名空间被两个 bundle 各 `$mount` 一次，「容忍」而非归属 | P1 | `dock/src/client/index.ts:9-17`、`GithubEmbed.tsx:39` vs `dsh-github-ui/src/client/index.ts:48` |
| F7 | **播报/文案策略写在壳里**：`fairyEvents.ts` 用字符串匹配把 spark 的业务事件翻成文案与情绪，且有 4s 文案级去重 | P1 | `dock/src/client/fairy/fairyEvents.ts:32-51` |
| F8 | **退役世代仍参与构建**（**已关闭**：2026-09-11 包连同 kit 死代码一并删除）：`dsh-spark-ui@0.1.4` 还在 workspace（自带 3 条 EventSource + 完整 spark 面板），已从 `plugin-registry.json` 摘除但仍是 `packages/*` 成员 | P2 | `pnpm-workspace.yaml:1-2`、`plugin-registry.json`（无此项） |
| F9 | **连接预算被当成局部问题**：6 条 HTTP/1.1 长连接上限是全局约束，却由一个 app 包内的注册表局部缓解；harness 还复制了客户端逻辑（`bindSnapshotSelector` 8 行副本） | P2 | `docs/LOCAL-DEV-HARNESS.md:286-289`、`streams.ts` 注释 |
| F10 | **同一件事三套宿主注册风格**：spark/hippomemo 手写 HTTP 路由；github/npm 用声明式 `ctx.typert.register(HOST_CONTRIBUTION)`；**finance 完全没有 register**，改为手抄 `typert.host.ts` / `typert.remote-client.ts` 两份「像生成器产物」的 manifest —— 且 `sourceLocation` 行号**已经漂移**（写成 `index.ts:96`，实际 `:333`；`listProviders`/`refreshBalance` 都写 `:999`） | P1 | `dsh-github/src/index.ts:39`、`dsh-npm/src/index.ts:40`、`dsh-finance/src/index.ts`（无 `typert.register`，grep 零命中）、`dsh-finance/src/typert.host.ts:95` |
| F11 | **刷新策略四套并存**：SSE 推送（spark/hippomemo）、平台转发事件（`credentials/reference-updated`、`settings/document-updated`）、**600ms 轮询**（finance backfill）+ 30min 定时器、以及**页内 `window` 自定义事件**当变更总线（`dsh-finance-dsh-override-changed`） | P1 | `dsh-finance-client/src/client/controller.ts:117`、`FinanceAuditSection.tsx:468,478-481` |
| F12 | **错误语义三套**：github 把失败抛成 `status:'error'`；npm 在成功值里再嵌一层 `ok:false`，且 `token.status` 失败被静默吞掉（UI 显示「未配置」而非错误）；finance 同时用 envelope、slot `status`、结果 `ok:false` 三种表达 | P2 | `github-ui/src/client/store.ts:77-92`、`npm-ui/src/client/store.ts:99-103,120-123`、`dsh-finance/src/typert.host.ts:51,72` |
| F13 | **connector 三家约 60% 同构，契约靠手抄**：两份 ~150 行凭据/加载 store 有 ~90 行逐字相同；三个 wire 各自手写 ~80 行 descriptor/contribution 样板；finance 把同一份 8 方法 manifest 维护两份（各 ~145 行）；plugin-kit 在 connector 半边**只被当作类型**使用 | P2 | `github-ui/src/client/store.ts:16-30,45-47,63-93,110-131` vs `npm-ui/src/client/store.ts:22-36,55-57,74-112,130-151`；`dsh-finance/src/typert.host.ts:81-225` vs `typert.remote-client.ts:68-212` |
| F14 | **zero-dsh 预览比真宿主更宽松**（**已关闭**：2026-09-11 W4 落地 —— 假宿主加 inject 门 + 动态命名空间必须走 reflect，预览侧写入路径按 wire schema 单源校验并返回 400，mock ctx 增加 teardown 生命周期，Node 冒烟跑五个插件真 `apply()` 断言自注册顺序与注销）：mock ctx 没有 cordis 的 inject 门（直接给 `remote.spark`），fixture 又给 `sourceSessionId` 兜默认值（真宿主 schema 必填 → 400）。于是「访问规则 / schema 必填 / 服务生命周期」三类回归预览测不出来 | P1 | `dev-harness/preview/src/mock/ctx.ts:168-176`、`fixtures/sparks.mjs:112-129` vs `dsh-spark/src/http.ts` 的 zod 校验；实测记录见 §7 |

**判断**：不是「没实现」，而是**实现方向选错了层**。宿主侧做对了（领域服务 → cordis 事件），
从「服务」到「浏览器」这一段各自为政，于是所有跨插件能力（统一下发、连接预算、播报、
事件契约、新增插件）都得在每个插件里重做一遍。

---

## 2. 现状：三个面

### 2.1 数据面 —— 浏览器里同时存在 5 种传输

| 传输 | 端点 | 使用者 | 契约 |
| --- | --- | --- | --- |
| SSE ×3 | `/sparks/events` `/proposals/events` `/scripts/events` | dock（`streams.ts` 注册表）、退役的 `dsh-spark-ui`（各开各的 `EventSource`） | 无 schema，payload = host 内部 cordis 事件对象 |
| SSE ×1 | `/hippomemo/events` | hippomemo 自己的 `client/api.ts`（独立实现，无 refcount） | 无 schema，payload = `{operation,id}` |
| RPC（POST） | `/api/<ns>/<method>` | connectors（github/npm/finance）、credentials、settings | zod 严格 codec，descriptor 在 wire 包 |
| Mux WS | `/api/remote.mux` | 上面这条 RPC 的流式载波；`$on` 事件转发也走它 | typert 协议 |
| SSE（平台） | `/plugins/events` | 平台 client-modules HMR | 平台自有 |
| 轮询 | `getBackfillProgress` 600ms、ledger 30min | finance-client | 无（靠定时器猜状态） |
| 页内自定义事件 | `window` 上的 `dsh-finance-dsh-override-changed` | finance 自己的 UI ↔ 自己的 UI | 无（同页广播当变更总线） |

一条已实测的约束链（`streams.ts:1-7` 的注释就是这个）：

```
HTTP/1.1 同源 6 连接上限
  ← 3 条常驻 SSE 会把普通 fetch 饿死（列表卡在「加载中」）
    ← 所以 dock 自己写了 refcount 注册表
      ← 但注册表在 dock 包里，hippomemo 用不上，于是它继续 new EventSource
```

### 2.2 事件面 —— host 有总线，浏览器没有

```
host（有总线，好）
  SparkService        --emit--> sparks/changed     {operation,id,record,at}
  EmergeService       --emit--> proposals/changed  {at,newProposals,resolvedProposal}
  ScriptService       --emit--> scripts/changed    {at,operation}
  MemoryService       --emit--> hippomemo/changed  {operation,id}
  ↓  四个服务各自被手写 SSE 端点「序列化」一次（http.ts ×2 文件、×2 写法）
浏览器（没有总线，坏）
  dock/streams.ts      → .operation（string，无类型）→ ① panes 无视载荷、整表重取 ② fairy 映射文案
  hippomemo/api.ts     → JSON.parse → 调用方自己再解析（契约手抄）
  connectors           → ctx.remote.$on('credentials/reference-updated' | 'settings/document-updated')
                          ← 这两条能走平台转发，只因它们恰好在一份 first-party 白名单里
```

平台的转发白名单是**宿主自己的常量**：

```ts
// dsh-api-remotes/lib/types/remote-events.d.ts:12
export declare const API_REMOTE_FORWARDED_EVENTS: readonly [{ event: "agent-preset/selected", mode: "emit" }, …]
```

→ 第三方插件的 `sparks/changed` **不可能**被加进去（要改 first-party 包）。这就是本仓库
「自己写 SSE」的历史合理性：**转发通道对第三方关闭**。

但同一个 typert 还提供了另一条对第三方**开放**的路：

```ts
// dsh-typert-protocol/lib/types/types.d.ts:181-221（节选）
export interface InvocationDescriptor {
  readonly namespace: string          // 插件自己的命名空间
  readonly method: string
  /** Absent for unary calls; stream calls validate and deliver every yielded item. */
  readonly mode?: 'stream'
  readonly cancellation?: { parameter: 'signal' }   // 长连接可取消
  readonly result: TypertCodec                      // 每个产出项单独校验
}
```

配合 `dsh-api-remotes` 的注释「the Gateway owns the physical Remote stream mux」——
即：**插件可以把自己的事件做成一条 stream 方法，挂在插件自己的命名空间上，跑在共享的 mux
载波里，逐项过自己的 zod schema**。路径完全第三方可用，且仓库已经会用这套（connector 的 wire）。

### 2.3 组合面 —— dock 是聚合器，不是外壳

```ts
// dock/src/client/modules.tsx:61-94   五个模块的名字/描述/accent/图标/子页全部硬编码
// dock/src/client/index.ts:9-17       静态 import 4 个插件的 embed 产物
// dock/src/client/index.ts:47-71      逐个注册 locale 字典 → 逐个调 bespoke starter
// dock/src/client/index.ts:55,71      两个模块级 setter 当服务定位器（setHippoT / setReflectGetter）
```

后果：新增第 6 个插件 = 改 dock 源码 + bump dock 版本 + 重装 + 重启。平台的
`slots` 本来支持「注册者声明子槽位」（`dsh-client-ui-slots`：*Declaring is claiming*），
`settings.section` 就是这么做的 —— dock 没走这条路。

---

## 3. 目标架构（ADR）

### ADR-001：领域事件一律走「插件自有 typert stream」，删除自建 SSE

- **决策**：每个插件的 host 半边把自己的 cordis 事件桥成一条 stream 方法
  （`spark.events()` / `hippomemo.events()` / …），descriptor 与 zod schema 放在各自的 wire 包；
  客户端通过 kit 提供的订阅 API 消费。删除 `/sparks/events`、`/proposals/events`、
  `/scripts/events`、`/hippomemo/events`。
- **理由**：① 一条物理载波（mux WS）承载所有插件的事件与 RPC，HTTP/1.1 6 连接上限从
  「每个插件都要小心」变成「结构上不可能撞到」；② 事件契约与 view 契约同处 wire 包，
  两个半边 import 同一份声明，**不可能漂移**（这正是 `dsh-github-wire` 注释里已经写下的理由）；
  ③ 逐项 codec 校验，客户端拿到的就是校验过的对象；④ 对第三方开放，无需求人把事件加进
  first-party 白名单。
- **否决的备选**：
  - *多路 SSE 单端点*（`GET /events?topics=…`）：改动最小、保留 curl 可调试性，但仍要自己管
    重连/心跳/引用计数，且与 connectors 的传输继续分裂 → 列为**降级方案**（见 ADR-001-Fallback）。
  - *上游白名单*：把 `sparks/changed` 加进 `API_REMOTE_FORWARDED_EVENTS` —— 依赖 first-party 发版，不可控。
- **代价 / 风险**：SSE 的 `curl` 直读便利性下降；**dev-harness 的假 transport 必须支持 stream 帧**
  （现在是 `createMockCtx` 假 `$mount` + 假 RPC，见 `dev-harness/preview/src/mock/ctx.ts`），
  这是本方案最大的一次性成本，约 0.5–1 天。
- **待验证（UNVERIFIED）**：本仓库目前没有任何第三方 `mode:'stream'` 实例 → 迁移前先做一次
  spike（一个方法 + 一个客户端订阅 + harness 假帧），确认 0.1.2-rc.1 运行时支持。

### ADR-001-Fallback：单条多路 SSE + kit 侧统一订阅

若 spike 发现 stream 在 rc 版不可用：保留 SSE，但收敛成**一个**端点、**一份**契约、
**一个** kit 订阅器（topic 多路复用 + 心跳 + refcount + Last-Event-ID）。收益降一档
（连接数从 N+ 降到 2），契约与代码复用收益不变。

### ADR-002：事件契约进 wire 包，host 内部类型不得上网

- **决策**：`SparkChangedEvent` / `HippomemoChanged` 之类的 payload 从 host 内部类型
  提升为 wire 导出（zod schema + 类型），host 的 `emit` 与客户端订阅都引用它；
  客户端禁止手写 `(operation: string)` 之类的影子契约。
- **理由**：现状是「host 注释写着 never cross the wire，实际它就是上网的格式」
  （`dsh-spark/src/types.ts:16` vs `src/http.ts:266`），而客户端把同一件事抄成无类型字符串
  （`dsh-hippomemo/src/client/api.ts:89`）。ADR-001 之后这件事变成**强制**的：
  没有 schema 就没有 codec，方法根本发不出去。
- **附带收益**：事件名与 payload 的注册表可以做成可枚举的（`event: 'spark/capture'` 之类），
  播报层与调试面板都能据此自动化，而不是靠字符串匹配。

### ADR-003：dock 用「声明子槽位」做贡献点，插件自注册

- **决策**：dock 在自己的 `slots.register` 里声明子槽位（如 `dock.module`，契约与
  `registerDockModule()` helper 放 `dsh-spark-plugin-kit`，避免类型环）；每个插件 UI 包像
  注册 `settings.section` 一样注册自己的模块（id / order / label / icon / panes / 自己的事件文案映射）。
  dock 不再静态 import 任何插件 UI，不再持有 `modules.tsx` 元数据。
- **理由**：这是平台原生机制（`settings.section` 的现成范式），一次改动换来：
  新增插件零改 dock、按需加载（现在 4 个插件的 UI 全在 dock 的 bundle 依赖里）、
  模块归属清晰（谁的业务谁声明）。
- **代价**：dock 的加载顺序语义要重定（现在靠 import 顺序 + `startXEmbed` 单飞）；
  `inject` 依赖声明要按模块拆分。

### ADR-004：订阅运行时上收到 kit，app 包不得拥有共享基础设施

- **决策**：把 `streams.ts`（refcount + 诊断）从 dock 移到 `dsh-spark-plugin-kit/client`，
  变成 `subscribe(topic, handler)`；插件（含 hippomemo）只能通过它订阅。
- **理由**：现状是「唯一正确的实现长在 app 包里」（`dock/src/client/streams.ts`），
  插件复不到 → hippomemo 自建 `EventSource`（`api.ts:117-123`）且在
  `MemorySection.tsx:446,1234` 有两处订阅点，无引用计数；kit 里目前**完全没有**传输层代码
  （`dsh-plugin-kit/src/client/index.ts` 只有 settings/CSS 样板）。
- **附带**：去重/节流/播报队列策略（现在是 `fairyEvents.ts` 里的 4s 文案级去重）一并上收 kit，
  保证所有插件同一套策略；文案映射留给模块自己（见 F7）。

### ADR-005（治理）：一个插件一个客户端产物、一个世代、一份契约

- **决策**：① 取消 `embed.cjs` 这种「给 dock 专用的第二产物」——ADR-003 之后 dock 通过槽位消费
  插件自己注册的组件，不再需要第二份 bundle；② 退役世代（`dsh-spark-ui`）从 workspace 移除或
  归档到 `docs/ui-kit-backup-*` 那种冻结目录；③ 客户端半边的职责收敛为
  「注册槽位 + 注册 locale + 提供 remote/订阅」，避免出现「standalone 入口 + embed 入口 + dock 内联」
  三种装配方式；④ **契约只许声明一次**：descriptor / manifest / 事件 payload 一律由单处声明导出
  （或由生成器产出），禁止手抄 —— finance 手抄 manifest 的 `sourceLocation` 已经漂移，
  这就是「两份声明必然漂移」的现场证据；⑤ 错误语义统一到 transport envelope 一层
  （要么抛 envelope error，要么用 `ok:false`，不许两者混用，也不许静默吞）。
- **理由**：现在同一份设置页存在两套客户端产物（页面里两份代码）、同一命名空间被 `$mount` 两次
  （注释写着 duplicate tolerated）、`dsh-spark-ui` 带着自己的 3 条 EventSource 继续留在 workspace、
  connector 三家各抄一遍 ~90 行凭据/加载 state machine。

---

## 4. 迁移计划（每步可独立验收、可回滚）

| 阶段 | 内容 | 验收 | 风险 |
| --- | --- | --- | --- |
| **P0** | spike：给 `dsh-spark-wire` 加一条 `mode:'stream'` 方法 + host 桥 + kit 订阅器 + harness 假 stream 帧，只迁 `sparks/changed` | 悬浮球气泡与火花流实时刷新改走 stream；`pnpm preview:verify` 与既有 265 项测试全绿；`ball-shots.mjs` 气泡断言改走新链路仍通过 | 中（rc 版 stream 可行性未知） |
| **P1** | 迁完 spark 三条流，删除 3 个 SSE 端点与 `dock/streams.ts` | `/sparks\|/proposals\|/scripts/events` 404（或彻底移除路由）；panes 只依赖 kit 订阅 | 低 |
| **P2** | hippomemo 迁到同一条通道（含它的两处订阅点收敛为一处） | 记忆面板实时刷新正常；连接数从 N+ 降到 1 WS(+1 平台 SSE) | 低 |
| **P3** | ~~dock 贡献点化（ADR-003）：先让**一个**插件（github）自注册，其余照旧；再加第二个；最后删 `modules.tsx` 与 4 个静态 import~~ **已完成（2026-09-11）**：五个模块全部自注册，`modules.tsx` + 三处 dock 侧 embed pane 删除，真宿主 22/22 | 新增第 6 个插件不改 dock 源码即可出现模块栏；dock bundle 不再依赖 4 个 UI 包（3.3MB → 664KB） | 中（加载顺序/懒加载语义） |
| **P4** | 治理：~~退役 `dsh-spark-ui`~~ **已做（2026-09-11，连同 kit 的 `registerSettingsSection` 与 `settings-card.ts` 死代码）**；取消 `embed.cjs` 双产物、文案映射归模块待做 | `pnpm -r build` 包数下降；页面里不再有两份同名插件代码 | 低 |
| **P5** | connector 收敛：凭据/加载 store 上收 kit（一份 ~90 行样板替三家）、descriptor 单处声明、finance 改回 `ctx.typert.register`、错误语义统一 | 三个 UI 包净减代码；finance manifest 不再手抄（`sourceLocation` 漂移消失） | 低（纯内部重构，契约不变） |

**为什么不一次性大重写**：P0 是全案的唯一技术赌注（stream 可用性），必须先用最小切片证伪；
P1–P4 都是机械收敛，且每步都能保持产品可用（旧 SSE 与新通道可短暂并存，
`subscribe(topic)` 在 kit 内部可先做「SSE 后端 → stream 后端」的适配器，切换只改一个文件）。

---

## 5. 明确不做（避免过度设计）

1. **不重写宿主领域服务**：cordis 事件总线这一层是对的，`SparkService`/`MemoryService` 的
   `emit` 契约就是全系统最好的那一层，保留。
2. **不引入通用消息中间件/消息队列**：单进程宿主 + 单页客户端，mux 已经够用；
   引入 broker 只会增加运维面。
3. **不做事件回放/持久化订阅**：面板的语义是「事件 = 失效信号，然后重新拉取」，
   重连后重取即可；气泡类瞬时播报允许在断线窗口内丢失（现状也如此），
   若将来要保证不丢，应改成「从服务端拉未读」而不是给 stream 加持久化。
4. **不为了统一而统一 connectors**：它们的 RPC 面（zod codec + descriptor）已经是标杆，
   迁移方向是「事件向 connectors 看齐」，不是反过来。

---

## 6. 开放问题（需要平台/上游确认）

1. `mode:'stream'` 在 dsh `0.1.2-rc.1` 的**第三方**插件上是否已完整可用（含取消、错误项、重连）？→ P0 spike。
2. stream 断线后的语义（自动重连？产出项是否重放？）未在类型里说明 → 需要实测，
   并据此决定 kit 订阅器是否要自己补重连。
3. 未来若平台把「第三方事件转发」纳入 `$on`（白名单可扩展），ADR-001 可以进一步简化
   （连 stream 都不用写，直接 `$on('sparks/changed')`）。当前不可用，属**已知平台缺口**。
4. github/npm 的 `@Remote` 标记与 descriptor 里的 `implementation:` 名字，运行时由网关解析还是
   回落到 SRC 标记？仓库里只有注释声明（`github-service.ts:3-4`「SRC fallback」）→ **UNVERIFIED**，
   迁移前应实测（它决定 descriptor 是唯一真源还是仅诊断用）。
5. `model.events` 字段（`TypertPackageModel.events`）是**反射/文档元数据**，不是订阅通道；
   若平台计划用它做事件暴露，ADR-001 的实现方式需重新评估。

---

## 7. 实施记录

> **状态**：P0 + P1 + P2 全部落地并**在真宿主验收通过**（见下）；四个手写 SSE 端点
> （`/sparks|/proposals|/scripts|/hippomemo /events`）已从产品移除；P4 的退役包清理已做
> （2026-09-11）；P3、P5 与 P4 剩余两项（embed 双产物、文案映射）未做。

### P0+P1 已完成（2026-09-10）

**Spike 结论（决定 ADR-001 成立）**：平台的 stream 通道对第三方插件**可用**，且第一方已有
端到端范例可照抄 —— `dsh-api-workspace-files` 的 `workspaceFiles/changes`：

| 环节 | 第一方范例 | 本仓落地 |
| --- | --- | --- |
| 宿主标记 | `@Remote({ mode: 'stream' })` 标在返回 `AsyncIterable<T>` 的方法上（`dsh-api-workspace-files/lib/index.js:265`） | `SparkEventsService.events()`（`dsh-spark/src/events-service.ts`） |
| 描述符 | `{ mode:'stream', cancellation:{parameter:'signal'}, result:{mode:'strict',typeSymbol,schema} }`（`dsh-api-remotes/lib/client.js:8493-8512`） | `SPARK_INVOCATIONS`（`dsh-spark-wire/src/index.ts`） |
| 客户端类型 | `changes(scope, signal?): AsyncIterable<Frame>`（`dsh-api-workspace-files/lib/typert.remote-client.d.ts:11`） | `TypertRemoteNamespaceMap['spark'].events(signal?)` |
| 客户端订阅 | `ctx.remote.$stream({ name, open, ended })` → `RemoteStreamItem{value,accept}`（`change-feed` 的 pump） | `dsh-spark-plugin-kit/client` 的 `subscribeFrames`/`useFrames` |
| 基线语义 | 每代首帧 `ready` + `accept()`（ChangeFeed `pump()`：`case "ready": item.accept()`） | 同形（`sparkStreamFrames` 首帧 `ready`） |
| 物理载波 | 单一 `/api/remote.mux` WebSocket（`REMOTE_STREAM_MUX_PATH`） | 同 |

**同时确认（决定了「为什么以前只能手写 SSE」）**：`ctx.remote.$on` 的转发白名单
`API_REMOTE_FORWARDED_EVENTS` 是 **first-party 常量**（`dsh-api-remotes/lib/types/remote-events.d.ts:12`），
第三方插件的 `sparks/changed` 加不进去 —— 所以事件只能走「插件自有命名空间下的 stream 方法」。

**落地清单**：

| 项 | 文件 |
| --- | --- |
| 事件契约单处声明（帧 schema + 描述符 + 两侧 contribution） | `packages/dsh-spark-wire/src/index.ts` |
| 纯桥接层（cordis → 帧序列，含 `ready` 基线与取消）×  | `packages/dsh-spark/src/events.ts` |
| 宿主服务（`@Remote({mode:'stream'})`，服务键 `sparkEvents`/命名空间 `spark`） | `packages/dsh-spark/src/events-service.ts` |
| 宿主注册 contribution + `inject: [..., 'typert']` | `packages/dsh-spark/src/index.ts` |
| **删除三条 SSE 端点**（含三个 handler，-59 行） | `packages/dsh-spark/src/http.ts` |
| 订阅运行时上收 kit（扇出 / 引用计数 / 主题路由 / 基线重同步） | `packages/dsh-plugin-kit/src/client/events.ts` |
| dock：删 `streams.ts`、改 `fairyEvents.ts` 与三个子页、`remote` 走插槽 inject 面 | `dock/src/client/{index.ts,DockOverlay.tsx,modules.tsx,spark/*,fairy/*}` |
| 宿主事件类型去重（`SparkChangedEvent` 只存在于 wire） | `packages/dsh-spark/src/types.ts` |
| harness：假 `$stream`（含重连语义）+ `spark.events()` 代 opener | `dev-harness/preview/src/mock/streams.ts`、`src/mock/ctx.ts`、`src/panes/dock.tsx` |
| 回归测试（描述符形状 / 帧契约 / 取消语义 / schema 拒绝） | `packages/dsh-spark/test/events.test.ts`（5 项，随 60 项全绿） |

**验收（实测）**：

- `pnpm --filter dsh-spark test`：60/60（含 5 项事件契约测试）；
- 预览走查（`ball-shots.mjs`，零 dsh）：气泡经新链路出现 → 几何 100×57 / 球上方 13px / 在视口内
  → 4.2s 自动消失 → 亮暗两色一致；`role=status`/`aria-live=polite`/零动画不变；
  **扇出断言**：面板与气泡共用一条逻辑流，捕获后列表出现新条目（`pane-fanout: {listed:true}`）；
- 悬浮球 7 状态不变量、对比度审计、`preview:verify`、全量测试见本轮验收输出。

**真宿主验收（沙箱 3997，`DSH_HOME=.dev/home`，tarball 安装 = 用户安装形态）**：
`node dev-harness/real-host-check.mjs` **7/7 通过、控制台 0 告警**：

```
ok 真宿主首屏渲染 / dock 悬浮球挂载（client bundle 由 profile 加载）
ok POST /sparks 被真宿主接受
ok 气泡经 mux stream 到达（产品已无 SSE）      ← 关键：产品里没有任何 spark SSE 端点
ok 气泡文案与 a11y（role=status / aria-live=polite / 100×57）
ok 旧 SSE 端点已移除（/sparks/events → 404）
ok 面板打开且列出火花行（扇出：同一条流喂第二个消费者）
```

**真宿主暴露的两条平台规则（预览的 mock 抓不到，值得刻在墙上）**：
1. **第三方 remote 命名空间不能写进 `inject`** —— `remote.spark` 是本插件自己
   `$mount(...)` 之后才提供的 cordis 服务，写进 `export const inject` 会让 fiber 永远
   等不到（实测：`web boot: 1 entry did not activate … pending (waiting for service: remote.spark)`，
   悬浮球整个不挂载）。平台里唯一可用取法是 **`ctx.reflect.get('remote.spark')`** ——
   这正是本仓 `reflect.ts` 存在的原因，也是 github/npm/finance 三个 embed 的既有做法；
   直接访问 `ctx.remote.spark` 会抛 `RemoteError: cannot get property "remote.spark" without inject`。
2. **顺序**：`await $mount(contribution)` 必须在注册/渲染订阅方之前完成。

**这条也顺带形成一条新的架构发现（F14）**：zero-dsh 预览与真宿主存在**保真缺口**，
且缺口方向是「预览更宽松」—— `mock/ctx.ts` 直接给 `remote.spark`（没有 inject 门），
fixture 的 capture 会给 `sourceSessionId` 默认值（真宿主 schema 必填，
实测 400 `invalid_type`）。结论：**访问规则、schema 必填、平台服务生命周期这三类回归，
预览测不出来，必须由真宿主验收兜底** —— 这正是本仓「线 1 预览 / 线 2 沙箱」两条线并存的理由，
本次迁移把它从"约定"变成了实测证据。

（运维脚注：沙箱曾因 `.dev/home/storages/sparks.jsonl` 被一个空**目录**占用而
`EISDIR: illegal operation on a directory, write`；清掉该目录后 capture 正常。
与产品无关，但会伪装成"事件通道不工作"。）

**再验（修掉一个懒闩锁之后）**：预览走查抓到「悬浮球气泡不再弹出」——
`fairyEvents` 里 `resident`（只订阅一次）+ effect 重跑（channel 身份变化）会形成
「先退订、再拒绝重订」的悬空态。修法：**去掉闩锁**，订阅生命周期交给 kit 的引用计数
（同名一条流、最后一人离开才关），并让注入面/预览返回**稳定引用**的 channel 对象。
复验：预览气泡（亮/暗）+ 面板扇出全绿；沙箱真宿主再次 **7/7**（5 条火花、气泡正常）。

**已知观察（下一轮跟进）**：真宿主控制台会先出现
`[dsh-spark-plugin-kit] 事件流 spark/events 载波断开，正在重连` +
平台 `connection lost, retry #N` / `generation is still not ready after 3000ms`，
随后由 `RemoteStream` 自动重开并收敛（最终功能正常）。疑似「首个世代在载波就绪前打开」
的竞态 —— 值得确认平台是否有「连接就绪」信号可供订阅侧等待，避免每次都先失败一次。

### P2 已完成（2026-09-10 深夜）：hippomemo 并入同一通道

| 项 | 文件 |
| --- | --- |
| 事件契约（帧 schema + 描述符 + 两侧 contribution，包内私有） | `packages/dsh-hippomemo/src/wire.ts` |
| 宿主桥（复用 kit `bridgeEvents`） | `packages/dsh-hippomemo/src/events.ts` + `events-service.ts` |
| 宿主注册（`MemoryService[Service.init]` 内 `ctx.typert.register` + 构造服务） | `packages/dsh-hippomemo/src/memory-service.ts` |
| **删除 `/hippomemo/events`**（路由分支 + `handleEvents`） | `packages/dsh-hippomemo/src/http.ts` |
| 客户端订阅改走 kit（`MemorySection` 两处订阅点自动收敛为同一条流） | `packages/dsh-hippomemo/src/client/api.ts` |
| 客户端装配（`$mount` → reflect → 注入通道），standalone + dock 内嵌两处共用 | `src/client/start.ts`、`embed.ts`、`dock/src/client/index.ts` |
| **宿主侧桥上收 kit**：`bridgeEvents()` 供 spark / hippomemo 共用 | `packages/dsh-plugin-kit/src/host/stream.ts` + `src/index.ts` |
| harness：mock `hippomemo.events()` 代 opener + fixture 广播 | `dev-harness/preview/src/mock/{streams,ctx}.ts`、`server.mjs` |

**真宿主验收（3997）10/10、控制台 0 条**：悬浮球挂载 / POST /sparks → 气泡走 mux stream /
气泡 a11y / 旧 SSE 端点 404 / 火花面板列出 / 模块栏含「记忆」/ POST /hippomemo/records 被接受 /
**记忆面板出现新条目（hippomemo stream 送达）**。

**P2 途中撞到的三个真问题（都已修，且都属于「只有真宿主/真构建能暴露」的类型）**：

1. **描述符是 strict 真源，装饰器只是 SRC 回退**。读网关实现确认：
   `resolveDescriptor()` 先查 `ctx.typert.local`（= `ctx.typert.register(contribution)` 的产物），
   命中即用；`prepareInvocation()` 用 `descriptor.implementation ?? descriptor.method` 取方法、
   用 `descriptor.cancellation` 注入 signal、用 `descriptor.mode` 判定流派 —— **全程不看装饰器**；
   装饰器标记只服务「未注册端点」的 SRC 发现（`resolveSrcDescriptor` 里 `marker === undefined → continue`）。
   → 两个插件因此统一为「契约 = wire 描述符」，不再用 `@Remote`。
   这也回答了 P0 时留下的开放问题。
2. **tsdown/oxc 不降级装饰器**：hippomemo 的 host 半边由 tsdown 打包，`@Remote({mode:'stream'})`
   被原样写进 `lib/index.js` → 宿主 `SyntaxError: Invalid or unexpected token`（整棵插件树加载失败）。
   spark 用的是 esbuild，会降级，所以 P0 没暴露这一点。第 1 条顺带把它变成非问题。
3. **运行时依赖的 externals 漂移**：客户端 `$mount` 需要**运行时**描述符，而描述符带 zod schema
   → hippomemo 的 client bundle 里出现 `require("zod")`，而 tsdown 配置只内联了
   `dsh-spark-plugin-kit / dsh-ui-kit / lucide-react` → 浏览器报
   `client-modules: require("zod") missed the module table`。修法：把 `/^zod/` 加进
   `deps.alwaysBundle`（spark 侧由 esbuild 全量内联，无此问题）。

**另外一条方法论提醒**：真宿主检查曾两次出现"幽灵报错"（旧的 `client.js` zod 报错、旧 active 模块），
根因都是 **CDP 复用了持久化的浏览器 profile**。`real-host-check.mjs` 现在会清 profile、
显式切换模块、并对「会被 UI 截断的文案」用前缀断言 —— 验收脚本本身也要防脏状态。

---

## 附录 A：证据索引（本次逐文件核对）

| 主题 | 文件:行 |
| --- | --- |
| spark SSE 三端点 | `packages/dsh-spark/src/http.ts:43-61,258-295` |
| spark 事件 union（host-only） | `packages/dsh-spark/src/types.ts:16-22` |
| spark emit 点 | `packages/dsh-spark/src/spark-service.ts:127,151,163,200`；`script-service.ts:95,130,142,150`；`emerge-service.ts:99,161` |
| hippomemo SSE | `packages/dsh-hippomemo/src/http.ts:124-135` |
| hippomemo 事件类型 | `packages/dsh-hippomemo/src/types.ts:238` |
| hippomemo 客户端订阅（自建 EventSource，无 refcount） | `packages/dsh-hippomemo/src/client/api.ts:89,117-123` |
| hippomemo 两处订阅点 | `packages/dsh-hippomemo/src/client/MemorySection.tsx:446,1234` |
| dock 共享注册表 | `packages/dsh-spark-dock/src/client/streams.ts:9-52` |
| dock 消费 spark 三条流 | `packages/dsh-spark-dock/src/client/spark/SparkModule.tsx:93,208,275` |
| 播报文案/去重策略 | `packages/dsh-spark-dock/src/client/fairy/fairyEvents.ts:32-51,53-57` |
| dock 编译期聚合 | `packages/dsh-spark-dock/src/client/index.ts:9-17,39-83`；`modules.tsx:61-94` |
| connector wire（第三方标杆） | `packages/dsh-github-wire/src/index.ts:95-197` |
| connector 客户端 `$on` | `packages/dsh-spark-dock/src/client/{github/GithubEmbed.tsx:53-54,npm/NpmEmbed.tsx:46-47}` |
| 平台转发白名单（first-party） | `node_modules/@deepseek-ai/dsh-api-remotes/lib/types/remote-events.d.ts:12-69` |
| typert stream 描述符 | `node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts:181-221` |
| mux 载波归属 | `node_modules/@deepseek-ai/dsh-api-remotes/lib/types/index.d.ts:6` |
| 槽位可声明子槽位 | `node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:2-4,124-131,550-556` |
| 退役世代仍在 workspace | `pnpm-workspace.yaml:1-2`；`plugin-registry.json`（无 `dsh-spark-ui`） |
| harness 复制客户端逻辑 | `docs/LOCAL-DEV-HARNESS.md:286-289` |
| connector 三套注册风格 | `dsh-github/src/index.ts:39`、`dsh-npm/src/index.ts:40`（declarative）vs `dsh-finance/src/index.ts`（无 `typert.register`）+ `typert.host.ts:26,95`（手抄 manifest 且行号漂移） |
| connector 无 push / 全 direct | `dsh-github-wire/src/index.ts:189`、`dsh-npm-wire/src/index.ts:187`、`dsh-finance/src/typert.host.ts:78` |
| finance 轮询与页内事件 | `dsh-finance-client/src/client/controller.ts:117`、`FinanceAuditSection.tsx:468,478-481` |
| connector 重复代码量化 | `github-ui/src/client/store.ts:16-30,45-47,63-93,110-131` vs `npm-ui/src/client/store.ts:22-36,55-57,74-112,130-151`；`dsh-finance/src/typert.host.ts:81-225` vs `typert.remote-client.ts:68-212` |
| 错误语义三套 | `github-ui/src/client/store.ts:77-92`；`npm-ui/src/client/store.ts:99-103`；`dsh-finance/src/typert.host.ts:51,72` |
| dock 用字符串服务定位器取 remote | `dock/src/client/github/GithubEmbed.tsx:43`（`ctx.reflect.get('remote.github')`）、`reflect.ts` |
