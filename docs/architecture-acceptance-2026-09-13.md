# 架构重构验收报告（2026-09-13）

> 范围：`docs/plugin-architecture-review-2026-09-10.md` 的最后两项未完成项 —— **P5 契约单源**
> 与 **F12 错误语义统一**；外加上一轮报告 `docs/architecture-acceptance-2026-09-12.md` §6 的
> 阻塞解除。
> 本报告只记录**本次新鲜执行**的验收证据（命令 + 实测输出），不引用对话里的历史结论。
> 验收环境：Windows + Node 24 + pnpm 11.11；沙箱宿主 `DSH_HOME=.dev/home`、profile
> `devweb`、端口 3997。

## 0. 结论

| 目标项 | 状态 |
| --- | --- |
| ⑤ 解除 P5 阻塞（在途 finance 批次落盘） | **达成**（commit `2cfe036`） |
| ⑥ P5 契约单源（`dsh-finance-wire` + `ctx.typert.register`） | **达成**（两份手抄 manifest 删除，8 条 `sourceLocation` 告警归零） |
| ⑦ F12 错误语义统一 | **达成**（`remote-result.ts` 单处约定；npm `token.status` 静默吞修掉） |
| ⑧ 评审发现 F1–F14 全部关闭 | **达成**（见 §5） |

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
| F1–F3 | 无统一事件层 / 契约不跨线 / 平台 stream 通道未用 | 2026-09-10 P0+P1 |
| F4–F6 | dock 是编译期聚合器 / 共享设施长在 app 包 / 一个插件两份产物 | 2026-09-11 P3（ADR-003）+ P4 |
| F7 | 播报文案策略写在壳里 | 2026-09-12 F7 |
| F8 | 退役世代 `dsh-spark-ui` 仍参与构建 | 2026-09-11 清理 |
| F9 | 连接预算被当局部问题 | P0/P1 的连接复用 + P2 收敛到 1 条 WS |
| **F10** | 三套宿主注册风格（finance 无 register） | **2026-09-13 P5** |
| F11 | 刷新策略四套并存 | P0–P2（SSE 移除、统一 stream 通道） |
| **F12** | 错误语义三套 + npm 静默吞 | **2026-09-13 F12** |
| **F13** | connector 三家 60% 同构、契约靠手抄 | 2026-09-12 F13-1（store 上收）+ **2026-09-13 P5**（manifest 单源） |
| F14 | zero-dsh 预览比真宿主宽松 | 2026-09-11 W4 |

## 6. 交付清单

| commit | 主题 | 规模 |
| --- | --- | --- |
| `2cfe036` | fix(finance)：单条会话日志不可读时降级跳过并在仪表盘告警（**解除 P5 阻塞**） | 12 文件 +188/−3 |
| 本次 P5 + F12 提交 | 契约单源 + 错误语义统一（含沙箱探针与验收脚本加固） | 45 文件 +1242/−839 |

包版本（本次重构后）：`dsh-spark-finance@0.3.0` · `dsh-spark-finance-client@0.3.0` ·
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

## 7. 复现步骤

```bash
pnpm install && pnpm -r build && pnpm typecheck && pnpm test   # ① 构建/类型/单测
pnpm check:all                                                # ② 架构(严格行号) + 对比度 + 版本纪律
pnpm preview:verify                                            # ③ 零 dsh 预览自检（74 项）

# ④ 真宿主（tarball 安装形态，与用户安装同路径）
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
