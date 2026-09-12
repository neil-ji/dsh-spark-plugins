# 架构重构验收报告（2026-09-13）

> 范围：`docs/plugin-architecture-review-2026-09-10.md` 的最后两项未完成项 —— **P5 契约单源**
> 与 **F12 错误语义统一**；外加上一轮报告 `docs/architecture-acceptance-2026-09-12.md` §6 的
> 阻塞解除。
> 本报告只记录**本次新鲜执行**的验收证据（命令 + 实测输出），不引用对话里的历史结论。
> **状态：已结项（2026-09-13，HEAD `8dbb277`）** —— 九项验收面全绿，见 §6.1；
> 唯一未收敛项（F11 两条定时器）已明确划为后续任务。
> 验收环境：Windows + Node 24 + pnpm 11.11；沙箱宿主 `DSH_HOME=.dev/home`、profile
> `devweb`、端口 3997。

## 0. 结论

| 目标项 | 状态 |
| --- | --- |
| ⑤ 解除 P5 阻塞（在途 finance 批次落盘） | **达成**（commit `2cfe036`） |
| ⑥ P5 契约单源（`dsh-finance-wire` + `ctx.typert.register`） | **达成**（两份手抄 manifest 删除，8 条 `sourceLocation` 告警归零） |
| ⑦ F12 错误语义统一 | **达成**（`remote-result.ts` 单处约定；npm `token.status` 静默吞修掉） |
| ⑧ 评审发现关闭清点 | **F1–F10 / F12–F14 关闭；F11 部分关闭**（见 §5 —— 两条定时器仍未收敛，列在 §5.1） |
| ⑨ 评审 §6 开放问题 #4（descriptor vs SRC） | **结案**（实测：描述符是唯一真源，见 §3.1） |

## 1. 验收命令与实测结果

| # | 命令 | 实测结果 |
| --- | --- | --- |
| 1 | `pnpm -r build` | exit 0；`packages/dsh-finance/lib` 下**已无** `typert.host.js` / `typert.remote-client.js`；新增 `packages/dsh-finance-wire/lib/index.js` |
| 2 | `pnpm typecheck` | exit 0（16 个包中 15 个有 typecheck 脚本，全过；`dsh-spark-finance-bundle` 无脚本） |
| 3 | `pnpm test` | exit 0；合计 **776** 项：根 vitest 14 文件 / **310**，finance 10 文件 / **162**，finance-client 8 文件 / **133**，hippomemo **108**，spark **63** |
| 4 | `pnpm check:all` | 三闸全 **PASS**（明细见 §2） |
| 5 | `pnpm preview:verify` | **74/74 项通过** |
| 6 | `node dev-harness/real-host-check.mjs` | **24/24 项通过**（沙箱 3997，tarball 安装 = 用户安装形态，控制台 0 告警，退出码 0） |

真宿主新增的两条关键断言（**这是本轮最重要的证据**）：

```
ok  finance 的 8 条 Remote 定义由 ctx.typert.register 落地（非 SRC 兜底）
    ["finance/getBackfillProgress","finance/getBalance","finance/getLedger","finance/getOverview",
     "finance/getSyncStatus","finance/listProviders","finance/refreshBalance","finance/syncCommunityPrices"]
ok  typert 注册面含 dsh-spark-finance:host（契约单源 P5）
    [...,"dsh-github:host","dsh-hippomemo:host","dsh-npm:host","dsh-spark-finance:host","dsh-spark:host"]
```

为什么必须单列这两条：网关在「契约没注册」时会**退回 SRC 标记兜底**，三条注册路径
（显式 `ctx.typert.register` / 平台 loader 读 `./typert` / SRC 兜底）**都让面板正常渲染**。
所以 P5 之前那种「22/22 全绿」证明不了注册真的发生 —— 漏写 inject、注册写错包名都会静默
退化到兜底。本轮因此给沙箱探针加了 `typert` 段（`/__dev/probe.typert`：
`packages` / `endpoints` / `schemaKeys`），并让验收脚本直接断言 registry 的实际内容。
`dsh-spark-finance` 的 `package.json` 已不再导出 `./typert`，平台 loader 不可能替它注册 ——
所以 `dsh-spark-finance:host` 出现在列表里只能是显式注册的结果。

## 2. 结构不变量（闸门守住的规则）

`pnpm check:architecture`（六查）：

| 查 | 规则 | 实测 |
| --- | --- | --- |
| ① 孤包 | `packages/*` 必须在 registry 闭包内 | 16 个包全在闭包内（新增的 `dsh-spark-finance-wire` 经 `dsh-spark-finance` 的 `workspace:*` 依赖进闭包），0 孤包 |
| ② 依赖边界 | 按角色限边；宿主半边禁 react/ui-kit/客户端入口；**wire 不得反向依赖任何插件**；fairy 呈现层不得 import 领域契约 / 插件 UI | 148 文件 / 701 条 import，**0 违规** |
| ③ 契约漂移 | 描述符声明的方法必须在宿主实现里存在；**同一份 wire 文件内部自洽**（descriptors ↔ 反射 `members`） | 17 条声明全部有实现，0 硬漂移，**0 告警** |
| ④ inject 面覆盖 | client 用到 `ctx.slots` / `remote.credentials` / `settingsScope` / `remote` 必须写进该包 `inject` | 5 个 client 插件全绿 |
| ⑤ 单产物 | 任何包不得再导出 / 构建 `./embed` 第二产物 | 16 个包全绿 |
| ⑥ 对比度 | 亮/暗 AA 154 项配对 + token 完整性 + 文档/设计稿漂移 | 0 不达标 / 0 硬失效 / 0 漂移 |
| ⑦ 版本纪律 | 改发布输入必须同 commit bump 版本（剥注释后比较） | 0 个 commit 漏 bump |

## 3. P5：契约单源（ADR-005 ④）

**新增包** `packages/dsh-finance-wire`（`dsh-spark-finance-wire@0.1.0`，角色 `wire`，
依赖只有 `zod` + typert 协议类型）：

- 8 条 `InvocationDescriptor`（`FINANCE_INVOCATIONS`）
- 16 份边界 Zod schema（从 `dsh-finance/src/typert.schemas.ts` 整体迁入）
- 反射模型（`FINANCE_REFLECTION`：services/members/types，从 `typert.host.ts` 整体迁入）
- 两份贡献对象：`FINANCE_HOST_CONTRIBUTION`（face `host`）与
  `FINANCE_REMOTE_CONTRIBUTION`（客户端 `$mount`）

**两侧都改吃这份单源**：

```ts
// packages/dsh-finance/src/index.ts —— host
ctx.inject(['typert'], typertCtx => {
  typertCtx.typert.register(FINANCE_HOST_CONTRIBUTION)
})

// packages/dsh-finance-client/src/client/index.ts —— client
const disposeRemote = await ctx.remote.$mount(FINANCE_REMOTE_CONTRIBUTION)
```

**删除的三份手抄文件**（`git rm`）：

| 文件 | 原职责 | 现状 |
| --- | --- | --- |
| `dsh-finance/src/typert.host.ts` | 手抄 host manifest（含 8 条 `sourceLocation`） | 删除；`package.json` 的 `./typert` 导出移除 |
| `dsh-finance/src/typert.remote-client.ts` | 手抄 client contribution | 删除；`./remote` 导出移除 |
| `dsh-finance/src/typert.schemas.ts` | Zod 边界 schema | 迁入 wire |

**顺带修掉的两件事**：

1. **8 条 `sourceLocation` 行号告警归零**。这些行号是生成器产物，手抄必然漂移（评审里
   实测写成 `index.ts:96` 而实际在 `:333`）。单源描述符**不含 `sourceLocation`**
   （github/npm/spark 的 wire 同样不含），所以 `pnpm check:architecture` 的
   `--strict-locations` 现在**是默认值**（脚本里直接带参数），0 告警。
2. **网关的 `Remote` 类型面归位**。`declare module '@deepseek-ai/dsh-typert-protocol'`
   从被删的 `typert.remote-client.ts` 搬进 `dsh-finance/src/types.ts`（它必须引用宿主类型，
   不能住进零依赖的 wire 包），客户端继续做 type-only 引用即自动生效。

**闸门的 `twin` 概念删除**：`CONTRACTS` 里 finance 的第二份手抄产物比对（`manifest-twin-drift`）
随两份手抄文件一起消失；取而代之的是**单源内部自洽**检查 —— 同一份 wire 文件里
`model.services[].members` 必须与 descriptors 的方法集完全一致（`manifest-member-drift`），
这条对 github/npm/spark/hippomemo 同样生效。

**边界纪律**：wire 不允许依赖任何插件（`ALLOWED_EDGES.wire = []`），所以契约类型
（`FinanceLedger` 等）仍在 `dsh-spark-finance/types` 里单处声明 —— 它们**本来就只有一份**
（host 与 client 都 import 它），P5 要收的是**被抄了两遍的 manifest**。

### 3.1 同批顺带：评审 §6 开放问题 #4 已实测结案

网关 `resolveDescriptor()`（`dsh-api-gateway/lib/index.js:758`）是三段式，**描述符是唯一真源**：

1. `typert.local.get(endpoint)` 命中 → 用该描述符；实现名取
   `descriptor.implementation ?? descriptor.method` 再 `Reflect.get`（`:747`），
   **完全不看 `@Remote` 原型标记**；取不到函数即 `gateway/method-unavailable`。
2. 没命中但 `local.hasSeen(endpoint)` → **硬失败** `gateway/definition-unavailable`
   （`:761`，注释原文「its strict definition was withdrawn and SRC fallback is forbidden」）。
3. 从未注册 → `resolveSrcDescriptor()` 从 `@Remote` 标记现场合成，codec 为
   `{ mode: 'src-json' }`（`:799,805,820`）→ **没有 zod 校验**。

**实测**（`/__dev/probe.typert.descriptors`）：`finance/*` 8 条全为 `strict`；
`github/whoami`→`whoamiRemote`、`npm/token.test`→`tokenTestRemote` 等 7 条
`implementation` ≠ method，证明该字段被按字面采用。

**两个推论**：① `check:architecture` 的「描述符方法必须在宿主实现里存在」守的是**运行时硬约束**；
② 「注册了又撤下」比「从未注册」安全 —— 后者会把严格校验**静默降级成无校验**，
这正是 P5 那类改动最容易踩的坑。故 `real-host-check.mjs` 现在断言 `strict` 模式，
而不只是断言面板能渲染（`ok` 从「面板未失败」升级为「校验在位」）。

## 4. F12：错误语义统一（ADR-005 ⑤）

**约定与实现单处化**到 kit 新模块 `packages/dsh-plugin-kit/src/client/remote-result.ts`，
文件头写明五条约定：

1. 传输层只有一个信封 `RemoteResult<T>`；失败文案只从 `error.message` 取，不得另造一套字段。
2. **页面加载路径**失败 → `unwrapRemote` 抛错，交给 `PageLoader` 统一转 `status:'error'` + 重试。
3. **操作路径**失败 → 返回 `string | undefined` 文案，表单就地显示，不拖垮整页。
4. **次要数据**失败 → **不得静默丢弃**，记进独立状态字段 + 页面降级提示。
5. **值内领域结论**（`GithubProxyTestValue.ok` / `NpmTokenTestView.ok` /
   `FinanceCommunitySyncResult.ok`）是「探测跑完了，结论是失败」，与信封 `ok` 正交，
   必须显示成业务提示而非「未配置」。

导出三个纯函数并补 2 项单测：`messageOf` / `remoteFailureOf` / `unwrapRemote`。

**三家 store 改吃同一处实现**：

| 文件 | 改动 |
| --- | --- |
| `dsh-github-ui/src/client/store.ts` | `if (!result.ok) throw new Error(result.error.message)` → `unwrapRemote(result)`；操作路径 → `remoteFailureOf`；`testProxy` 明确注释值内 `ok` 属约定 5 |
| `dsh-npm-ui/src/client/store.ts` | 同上；**并且修掉静默吞**（见下） |
| `dsh-spark-finance-client/src/client/controller.ts` | 删掉包内自带的 `messageOf` 副本，改从 kit 取；加载路径改用 `remoteFailureOf` |
| `dsh-plugin-kit/src/client/credentials.ts` / `page.ts` / `announcements.ts` | `messageOf` 的家搬到 `remote-result.ts`（credentials 保留再导出，兼容按路径 import 的调用方） |

**F12 的现场（npm `token.status`）修法**：原实现是

```ts
try { const r = await this.npm['token.status'](); if (r.ok) token = r.value } catch { token = undefined }
```

失败被吞成 `token === undefined`，页面于是**什么都不显示**，而卡片上的 `tokenHintMissing`
又读起来像「未配置」—— 用户会去重新配一个其实已经配好的令牌。现在：

- `NpmUiState` 新增 `tokenError: string | null`；
- 信封失败 → `remoteFailureOf` 的文案、抛出 → `messageOf` 的文案，两者都落到 `tokenError`；
- `NpmSection` 在失败的令牌测试行下方渲染 `tokenStatusFailed: <原因>`，
  并明确「不影响上面的注册表信息」；
- 主数据（`status.get`）仍走 `unwrapRemote` 抛错路径 —— 主数据失败就整页错误态，语义不混。

新增 locale 键 `tokenStatusFailed`（zh/en）。

## 5. 评审发现关闭清点

| # | 发现 | 关闭于 |
| --- | --- | --- |
| # | 发现 | 状态 | 证据 / 关闭于 |
| --- | --- | --- | --- |
| F1 | 浏览器侧没有统一事件层 | **关闭** | P0+P1；`dock/src/client/streams.ts` 已删，`/sparks\|/proposals\|/scripts/events` 真宿主 404 |
| F2 | 事件契约不跨线 | **关闭** | P0+P1；帧 schema 进 `dsh-spark-wire` / `dsh-hippomemo/src/wire.ts` |
| F3 | 平台 `mode:'stream'` 通道未被采用 | **关闭** | P0+P1；`spark/events` + `hippomemo/events` 两条 stream 端点已在真宿主注册 |
| F4 | dock 是编译期聚合器 | **关闭** | 2026-09-11 P3（ADR-003） |
| F5 | 共享基础设施长在 app 包里 | **关闭** | P0/P1 订阅运行时上收 kit（refcount 注册表） |
| F6 | 一个插件两份客户端产物 | **关闭** | 2026-09-11 P4（单产物闸门防回潮） |
| F7 | 播报文案策略写在壳里 | **关闭** | 2026-09-12 F7（播报总线 + `fairy-domain-import` 闸门） |
| F8 | 退役世代 `dsh-spark-ui` 仍参与构建 | **关闭** | 2026-09-11 清理 |
| **F9** | 连接预算被当局部问题（harness 仍在复制客户端逻辑） | **关闭** | 平台侧连接复用上收 kit（P0/P1）+ **2026-09-13 删掉 harness 副本**（`mock/snapshot.ts` 改为从 kit 再导出） |
| **F10** | 三套宿主注册风格（finance 无 register） | **关闭** | **2026-09-13 P5** |
| **F11** | 刷新策略四套并存 | **部分关闭** | SSE 腿随 P0/P1 移除；**页内 `window` 事件总线已消除**（2026-09-13，并加闸门第 ⑦ 查）；**遗留 600ms 轮询 + 30min 定时器**（见 §5.1） |
| F12 | 错误语义三套 + npm 静默吞 | **关闭** | **2026-09-13 F12** |
| F13 | connector 三家 60% 同构、契约靠手抄 | **关闭** | 2026-09-12 F13-1（store 上收）+ **2026-09-13 P5**（manifest 单源） |
| F14 | zero-dsh 预览比真宿主宽松 | **关闭** | 2026-09-11 W4 |

### 5.1 F9 已关闭 · F11 只剩两条定时器

**F9 —— 预览 harness 的客户端逻辑副本已删除**。`dev-harness/preview/src/mock/snapshot.ts`
原先文件头自己写着「bindSnapshotSelector 的预览副本」，理由有两条，现在都已失效：
P4 删掉了 `lib/embed.cjs` 第二产物，预览服务器也早就显式 alias 了
`dsh-spark-plugin-kit/client`（bundle / source 两种口径各一条）。改为从 kit 再导出后，
预览与产品共用同一份实现 —— 这正是 W4 抓到的「预览比真宿主宽松」那类漂移的根因。

**F11 —— `window` 事件总线已消除，剩两条定时器**：

| 现场 | 位置 | 状态 |
| --- | --- | --- |
| SSE 推送 | — | 已由 P0/P1 移除 |
| 页内 `window` 事件当变更总线 | `dsh-finance-dsh-override-changed`、`dsh-finance-open-config` | **已消除**：前者改成 `FinanceCardBody` 在 save/clear 后直呼 `dashboardRefresh()`，后者改成 `onOpenProviderConfig` 一路 props 传下去 |
| 600ms 轮询 backfill 进度 | `controller.ts:115` | **遗留**（计划：`finance/backfillProgress` typert stream；宿主 `FinanceBackfillSink` 加 `onProgress` 通知 → `ctx.emit` → 客户端走 kit `subscribeFrames`） |
| 30min 定时器刷新 | `FinanceAuditSection.tsx:477` | **遗留**（滚动 24h 窗口自己会过期，属真·时间驱动；改完上一条后再定去留） |

并新增**闸门第 ⑦ 查**防回潮：`packages/*/src` 里出现 `new CustomEvent('dsh-*')` 或
`addEventListener('dsh-*')` 即判失败（浏览器原生事件如 `resize`/`keydown` 不在管辖内）。

### 5.2 顺带清掉的文档漂移（已修）

P0–P2 删掉 SSE 端点后，三份 README 仍在把已移除的端点当产品能力描述，本轮一并修正：

| 文件 | 行 | 处理 |
| --- | --- | --- |
| `packages/dsh-spark/README.md` | 11 / 15 / 19 | 三条 SSE 描述改为「已移除」，并新增一节说明统一事件面（`spark/events` typert stream） |
| `packages/dsh-hippomemo/README.md` | 78 / 106 | 冒烟与路由表去掉 `/hippomemo/events`，注明实时刷新走 stream |
| `packages/dsh-spark-dock/README.md` | 20 / 29 | 气泡来源改为「模块经 kit 播报总线发布」（不再写 `/sparks/events`）；验收脚本项数 10 → 24 |

## 6. 交付清单

| commit | 主题 | 规模 |
| --- | --- | --- |
| `2cfe036` | fix(finance)：单条会话日志不可读时降级跳过并在仪表盘告警（**解除 P5 阻塞**） | 12 文件 +188/−3 |
| `6150951` | P5 契约单源 + F12 错误语义统一（含沙箱探针与验收脚本加固） | 45 文件 +1242/−839 |
| `244ea96` | docs：修正 F9/F11 的关闭口径 | 2 文件 |
| 本批（F11 第一阶段 + F9 + 文档漂移 + §6#4） | window 事件总线消除 + 闸门第 ⑦ 查 + harness 去副本 + 三份 README + descriptor 实测结案 | 16 文件 +293/−128 |

包版本（本次重构后）：`dsh-spark-finance@0.3.0` · `dsh-spark-finance-client@0.3.1` ·
**`dsh-spark-finance-wire@0.1.0`（新）** · `dsh-spark-plugin-kit@0.4.0` ·
`dsh-connector-github-ui@0.2.7` · `dsh-connector-npm-ui@0.2.9`；其余包未动。

产物（每包**只有一份**客户端产物）：

| 产物 | 尺寸 |
| --- | --- |
| `dsh-spark-dock/lib/client.js` | 664.3 KB |
| `dsh-spark-finance-client/lib/client.js` | 873.5 KB（内联 `dsh-spark-finance-wire` 的 codec，+7 KB） |
| `dsh-connector-github-ui/lib/client.js` | 659.6 KB |
| `dsh-connector-npm-ui/lib/client.js` | 643.4 KB |
| `dsh-hippomemo/lib/client.js` | 366.1 KB |
| `dsh-spark-finance/lib/index.js` | 83.2 KB（−2 份 manifest 产物） |
| `dsh-spark-finance-wire/lib/index.js` | 19.2 KB（新增单源） |

## 6.1 结项验收（2026-09-13，HEAD `8dbb277`）

在 `8dbb277`（工作区干净）上一次性重跑全部验收面，逐项结果：

| # | 项 | 命令 | 实测 |
| --- | --- | --- | --- |
| 1 | 依赖可复现（CI 同口径） | `pnpm install --frozen-lockfile` | exit 0，锁文件同步（17 个 project，无解析变更） |
| 2 | 构建 | `pnpm -r build` | exit 0，无 error/ERR 行 |
| 3 | 类型 | `pnpm typecheck` | 15 个含脚本的包全 Done，**0 条 `error TS`** |
| 4 | 单测 | `pnpm test` | **778** 项全过（根 312 · finance 162 · finance-client 133 · hippomemo 108 · spark 63），0 fail |
| 5 | 门禁 | `pnpm check:all` | 架构**六查全 ok / 0 硬失败 / 0 告警**、对比度 154 项 PASS、版本纪律 PASS |
| 6 | 预览保真 | `pnpm preview:verify` | **74/74** |
| 7 | 版本纪律（全会话范围） | `node scripts/check-version-bump.mjs --base b9e05a3` | 4 个 commit **0 漏 bump** |
| 8 | 发布打包（CI `pack-release-dry` 同口径） | `node scripts/pack-release.mjs --version 0.0.0-acceptance` | **16 个 tarball** + manifest.json + SHA256SUMS + 安装器，总体积 0.86 MB；新增的 `dsh-spark-finance-wire-0.1.0.tgz` 在列 |
| 9 | 真宿主（tarball 安装 = 用户安装形态） | `node dev-harness/real-host-check.mjs` | **26/26**，控制台 0 告警，**退出码 0** |

真宿主安装面核对：profile 的 16 个 `file:*.tgz` 依赖与提交版本逐一吻合，
含 `dsh-spark-finance-wire-0.1.0`（本轮新增）与 `dsh-spark-finance-client-0.3.1`。

**结项判定：本轮目标（P5 契约单源 + F12 错误语义统一 + 解除上一轮阻塞）全部达成，
验收链全绿。** 唯一未收敛项是 §5.1 的 F11 两条定时器，**已判定为后续任务**，
不在本轮范围内。

## 7. 复现步骤

```bash
# ① 依赖可复现 + 构建 / 类型 / 单测
pnpm install --frozen-lockfile && pnpm -r build && pnpm typecheck && pnpm test
# ② 门禁：架构(六查，严格行号) + 对比度 + 版本纪律
pnpm check:all
# ③ 零 dsh 预览自检（74 项）
pnpm preview:verify
# ④ 发布打包（CI 同口径，可选）
node scripts/pack-release.mjs --version 0.0.0-acceptance --out .dev/dist-release-acceptance
# ⑤ 真宿主（tarball 安装形态，与用户安装同路径）
pnpm sandbox:install && pnpm sandbox:up --detach && node dev-harness/real-host-check.mjs
#    停止宿主：Get-NetTCPConnection -LocalPort 3997 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }
```

## 8. 本次验收顺带修掉的沙箱缺陷

- **`real-host-check.mjs` 退出码被 libuv 断言污染**：脚本在 CDP WebSocket 与 undici
  socket 还在收尾时调 `process.exit()`，Windows 上触发
  `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) (src/win/async.c:76)`，
  进程以 `0xC0000409`（STATUS_STACK_BUFFER_OVERRUN）结束 —— **全绿也会变成非零退出码**。
  改为显式 `ws.close()` + `process.exitCode`（让事件循环自然排空），实测 `EXIT=0`。
- **`/__dev/probe` 无法观测契约注册面**：新增 `typert` 段（`packages` / `endpoints` /
  `schemaKeys`），`real-host-check.mjs` 据此断言 `finance/*` 8 条端点真的注册了。
  这是「显式 register 静默退化成 SRC 兜底」这类问题的唯一可观测口径。
