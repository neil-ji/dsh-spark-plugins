# 架构重构验收报告（2026-09-12）

> 范围：`docs/plugin-architecture-review-2026-09-10.md` 的 P3–P5 与配套工程门禁。
> 本报告只记录**本次新鲜执行**的验收证据（命令 + 实测输出），不引用对话里的历史结论。
> 验收环境：Windows + Node 24 + pnpm 11.11；沙箱宿主 `DSH_HOME=.dev/home`、profile `devweb`、端口 3997。

## 0. 结论

| 目标项 | 状态 |
| --- | --- |
| ① 补齐工程门禁 | **达成**（五道闸门 + CI 接线） |
| ② dock 贡献点化（P3 / ADR-003） | **达成**（五模块自注册，dock 不再 import 插件 UI） |
| ③ 消除预览保真缺口（F14） | **达成**（inject 门 / wire schema 单源 / 生命周期） |
| ④ 收敛双产物与契约重复 | **部分达成 3/5**：embed 单产物 ✅ · connector store 单源 ✅ · 播报文案归模块 ✅ · **错误语义统一（F12）未做** · **P5 契约单源未做**（阻塞，见 §6） |

## 1. 验收命令与实测结果

| # | 命令 | 实测结果 |
| --- | --- | --- |
| 1 | `pnpm -r build` | exit 0；`packages/*/lib` 下**已无任何 `embed*` 产物** |
| 2 | `pnpm typecheck` | exit 0（15 个包全部通过） |
| 3 | `pnpm test` | exit 0；合计 **772** 项：根 vitest 14 文件 / **306**，finance 10 文件 / **162**，finance-client 8 文件 / **133**，hippomemo **108**，spark **63** |
| 4 | `pnpm check:all` | 三闸全 **PASS**（明细见 §2） |
| 5 | `pnpm preview:verify` | **74/74 项通过**（Node 冒烟 + 服务器/fixture 断言） |
| 6 | `node dev-harness/real-host-check.mjs` | **22/22 项通过**（沙箱 3997，tarball 安装 = 用户安装形态，控制台 0 告警） |

真宿主关键输出（节选）：

```
ok  dock 悬浮球挂载（client bundle 由 profile 加载）              ball=1
ok  气泡经 mux stream 到达（产品已无 SSE）  {"text":"捕获了新火花— 火花 Spark · capture","role":"status","live":"polite"}
ok  旧 SSE 端点已移除（/sparks/events）                          {"status":404}
ok  模块栏含全部自注册模块（ADR-003）      ["火花","记忆","财务","GitHub","npm"]
ok  模块「火花/记忆/财务/GitHub/npm」标题行走子槽 header 位 + 内容走 pane 位且未失败
```

## 2. 结构不变量（闸门守住的规则）

`pnpm check:architecture`（六查）：

| 查 | 规则 | 实测 |
| --- | --- | --- |
| ① 孤包 | `packages/*` 必须在 registry 闭包内 | 15 个包全在闭包内，0 孤包 |
| ② 依赖边界 | 按角色限边；宿主半边禁 react/ui-kit/客户端入口；`<pkg>/embed` 只允许 app；ui-kit 零平台依赖；wire 协议纯净；**fairy 呈现层不得 import 领域契约 / 插件 UI**（F7） | 149 文件 / 698 条 import，**0 违规** |
| ③ 契约漂移 | 描述符声明的方法必须在宿主实现里存在；两份手抄 manifest 必须一致 | 17 条声明全部有实现，0 硬漂移；**8 条 `sourceLocation` 行号告警**（P5 待清理） |
| ④ inject 面覆盖 | client 用到 `ctx.slots` / `remote.credentials` / `settingsScope` / `remote` 必须写进该包 `inject` | 5 个 client 插件全绿 |
| ⑤ 单产物 | 任何包不得再导出 / 构建 `./embed` 第二产物 | 15 个包全绿 |
| ⑥ 对比度 | 亮/暗 AA 154 项配对 + token 完整性 + 文档/设计稿漂移 | 0 不达标 / 0 硬失效 / 0 漂移 |
| ⑦ 版本纪律 | 改发布输入必须同 commit bump 版本（剥注释后比较） | 0 个 commit 漏 bump |

`pnpm check:dsh-upgrade` / `dryrun:dsh-upgrade`（上游 API 面体检）**未进 CI**：它们要联网拉 npm 产物并与本机安装版本比对，属「dsh 升级时手动跑」的闸门（见 `docs/UPGRADE-PROTOCOL.md`），仍在常用命令里保留。

## 3. 逐项交付与证据

### ① 工程门禁（commit `17d1783`）
- 新增 `scripts/check-architecture.mjs`（六查）与 `scripts/check-version-bump.mjs`（逐 commit 版本纪律），回归测试 `scripts/tests/architecture.spec.ts`（22 项）、`version-bump.spec.ts`（10 项）。
- CI（`.github/workflows/ci.yml` 的 `build-test`）：安装 → 构建 → 类型 → 单测 → **架构闸门 → 对比度闸门 → 预览自检 → 版本纪律**；`fetch-depth: 0`（版本纪律要逐 commit 比）；PR 以 `origin/<base>`、push 以 `github.event.before` 为基线。

### ② dock 贡献点化（`15b238f` spike → `1ecfb7d` 全量）
- 契约：`dsh-spark-plugin-kit/client` 的 `spark.dock.module`（list/root，owner props = `{variant, activeId, onSelect}`）+ `registerDockModule()` + `DockModuleTab`/`DockModuleHeader`。
- dock：注册 `shell.overlay` 时声明子槽，用平台 `renderSlot` 渲染 rail / header / pane 三位；**删除** `modules.tsx`、github/finance/hippo 三处 embed pane、写-only 的 `reflect.ts`。
- 五个模块全部由各自 client 入口 `apply()` 自注册（含 spark 自己）。
- 量化：dock client bundle **3.3 MB → 680 KB**；dock 的 `inject` 收敛为 `['slots','locale','remote']`。

### ③ 预览保真（`a2e6f9a`）
- inject 门（`withInjectGate`）：未声明服务抛 `cannot get property "X" without inject`；`remote.<ns>` 动态命名空间直接读抛错（必须走 reflect）。
- 写入路径按 **wire schema 单源**校验：`fixtures/sparks.mjs` 直接用 `dsh-spark-wire` 的 `sparkCaptureSchema`/`sparkPatchSchema`，缺 `sourceSessionId` → **400 BAD_REQUEST**（与真宿主同形）。
- `ctx.__preview.teardown()` 生命周期替身；Node 冒烟跑五个插件真 `apply()`（带 inject 门）并断言 `spark,hippomemo,finance,github,npm` 注册顺序与注销。
- 自检 61 → **74** 项。

### ④ 收敛（`f577ab4` P4 / `732ddde` F13 / `5298d9a` F7）
- **embed 单产物**：四包删 embed 构建步骤 / `./embed` 导出 / files 条目 / `embed.d.ts`；`src/client/embed.ts` 降级为组件级预览的**源码 barrel**；预览两种口径统一吃源码 barrel（CSS Modules 插件抽到 `dev-harness/preview/bundler.mjs` 共用）；闸门第 ⑤ 查防回潮。
- **connector store 单源**：`CredentialToken`（凭据 seam 门面 + 声明合并单处）+ `PageLoader`（generation 竞态守卫 + status/error 迁移）住 kit；两家 store 158/152 行 → 106/100 行；新增 11 项单测（含两条竞态断言）。
- **播报文案归模块**：`announcements.ts` 播报总线（4s 同文案去重集中在总线）；spark 的映射移进 `spark/SparkDockModule.tsx`，hippomemo 新增 `announce.ts`（并给世代基线帧加 `baseline: true`，避免重连误报）；dock 的 fairy 层退化为纯消费者；新增 7 项单测 + `fairy-domain-import` 闸门。

## 4. 交付清单

| commit | 主题 | 规模 |
| --- | --- | --- |
| `7b54c6b` | 删除退役世代 `dsh-spark-ui` 与 kit 死代码 | 38 文件 +80/−1900 |
| `eae1fbd` | 预览 fixture 包名列表去掉已删除的包 | 1 文件 |
| `17d1783` | 补三道具名工程门禁并接进 CI | 7 文件 +1096/−4 |
| `15b238f` | ADR-003 spike（npm 自注册子槽） | 18 文件 +579/−136 |
| `1ecfb7d` | ADR-003 全量落地（五模块自注册） | 31 文件 +640/−610 |
| `a2e6f9a` | W4 预览保真（F14） | 9 文件 +262/−25 |
| `f577ab4` | P4 单产物 | 26 文件 +219/−196 |
| `732ddde` | F13 连接器公共层上收 | 12 文件 +384/−148 |
| `5298d9a` | F7 播报总线上收、文案归模块 | 20 文件 +342/−105 |

包版本（本次重构后）：`dsh-spark-plugin-kit 0.3.3` · `dsh-spark-dock 0.1.13` ·
`dsh-connector-github-ui 0.2.6` · `dsh-connector-npm-ui 0.2.8` ·
`dsh-spark-finance-client 0.2.8` · `dsh-hippomemo 0.2.12` · 其余包未动。

产物：dock 680 KB · finance-client 887 KB · github-ui 675 KB · npm-ui 658 KB ·
hippomemo 375 KB（每包**只有一份**客户端产物）。

## 5. 复现步骤

```bash
pnpm install && pnpm -r build && pnpm typecheck && pnpm test   # ① 构建/类型/单测
pnpm check:all                                                # ② 架构 + 对比度 + 版本纪律
pnpm preview:verify                                            # ③ 零 dsh 预览自检（74 项）

# ④ 真宿主（tarball 安装形态，与用户安装同路径）
pnpm sandbox:install && pnpm sandbox:up --detach && node dev-harness/real-host-check.mjs
#    停止宿主：Get-NetTCPConnection -LocalPort 3997 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }
```

## 6. 未完成项与阻塞

1. **F12 错误语义统一（未做）**：现状三套 —— npm 在成功值里再嵌一层 `ok:false` 且
   `token.status` 失败被静默吞掉；github 用 `status:'error'`；finance 同时用 envelope /
   slot `status` / 结果 `ok:false`。可行的第一步是定统一约定并修 github/npm 两处（不碰
   finance 在途文件），finance 半边随后。
2. **P5 契约单源（阻塞）**：要删 `packages/dsh-finance/src/typert.host.ts` 与
   `typert.remote-client.ts` 两份手抄 manifest，改为新建 `dsh-finance-wire` 单源 +
   `ctx.typert.register`，顺带消掉 §2 的 8 条 `sourceLocation` 告警并让
   `check:architecture --strict-locations` 进 CI。
   **阻塞条件**：`packages/dsh-finance/src/{typert.host,typert.schemas,types}.ts` 三份
   文件当前都在工作区在途改动中（属于另一批 finance 工作），改它们会把两批改动混在一起。
   解除方式：那批改动落盘后接手，或明确允许「暂存在途改动 → 重构 → 对方 rebase」。
3. **已知过渡态**（非缺陷，记录在案）：组件级预览画布仍通过 `*/embed` 这个 specifier
   吃**源码 barrel**（不再是构建产物）；Dock 画布走真 `lib/client.js`（预览服务器剥
   ModuleLoader 壳）。

## 7. 本次验收顺带清理

- 删除退役包目录残留 `packages/dsh-spark-ui/`（`git rm` 只删了跟踪文件，`lib/` 与
  `node_modules/` 属 gitignore，仍留在磁盘上；其中还有一份 141 KB 的旧 `client.js`）。
  清理后 `packages/` 恰好 15 个包，与闸门的包数一致。
- 修掉一个 W4 遗留：`dev-harness/preview/ball-shots.mjs` 的三处 capture 探针缺少必填
  `sourceSessionId`（W4 之前被预览的宽容默认值掩盖，W4 之后会拿到 400）。
