# dsh 升级协议（UPGRADE PROTOCOL）

> 目的：dsh 开源更新时，**先体检、再升级**，避免插件与新版 dsh 不兼容导致 3080/3999 环境崩溃。
> 适用：本 monorepo（dsh-spark-plugins）内的所有插件包。

> **当前状态（2026-08-22）**：monorepo / 全局 dsh / profile 均已升至 **0.1.1-rc.2**，两处已知破坏已修复（finance projection、credentials 事件），typecheck/test/build 全绿，3999 狗粮通过，3080 仍跑旧进程（下次重启自动吃新状态）。

## 一、机制总览（两道闸）

| 闸 | 脚本 | 干什么 | 耗时 | 失败含义 |
|---|---|---|---|---|
| 第一道（快检） | `pnpm check:dsh-upgrade` | 对比「当前钉版 vs npm latest」的**发布产物**，按插件实际 import 的符号/事件做存活检查 | ~1 分钟 | 退出码 1 = 有破坏候选 |
| 第二道（真验） | `pnpm dryrun:dsh-upgrade` | 临时目录里复制仓库 → overrides 钉到新版本 → 干净 `pnpm install` → `pnpm -r typecheck` | 数分钟 | 退出码 1 = 有包编译失败 |

- 两道闸都只读、不碰：本仓库原样、`~/.dsh/profiles/web`（3080/3999）、全局 dsh 安装。
- 第一道闸的报告自动归档到 `docs/dsh-upgrade-reports/`（`--write-report`，`check:dsh-upgrade` 已默认开启）。

## 二、检查项（第一道闸做什么）

1. **插件 import 的命名符号存活**：插件源码 import 的每个 `@deepseek-ai/*` 符号，必须在新版 .d.ts 里仍存在（删符号 = 编译级破坏）。
2. **被插件使用的接口成员级 diff**：接口字段改名/删除也是编译级破坏（例：`ProjectionDefinition.schema/view` → `stateSchema/wire`）。
3. **Cordis Events 事件名**：插件 `$on/$emit` 用的事件字符串必须在新版产物中仍出现（改名 = 静默失效，例：`credentials/updated` → `credentials/reference-updated`）。
4. **导出面变化**（新增/删除导出、文件增删）按级别提示。
5. **传递依赖漂移**：`cordis` / `schemastery` / `cordis-plugin-loader` 的声明区间变化。
6. watch 范围 = 插件实际 import 的包 ∪ 宿主关键包（host-apiproxy / host-plugin-inventory / cordis-host-runner / client-ui-settings-plugins / session-projection 系 / settings / credentials / typert 系 / api-remotes / client-runtime）。

**已知盲区**（第一道闸报不出、必须靠第二道闸兜底）：
- 语义层面的运行期破坏（如事件改名后类型不报错但永不触发、注册函数不校验新字段、存储格式不兼容）。
- 因此：**只要第一道闸有 🟡/ℹ️ 信号涉及插件用到的包，就该跑第二道闸**；升级前必跑第二道闸。

## 三、标准升级流程

```bash
# 0) 先体检
pnpm check:dsh-upgrade            # 看新版本有没有破坏候选，报告在 docs/dsh-upgrade-reports/

# 1) 真实验证（临时目录，不动本仓库）
pnpm dryrun:dsh-upgrade           # typecheck 全绿才继续；红了就先把插件修到绿

# 2) 正式升级（确认兼容后）
#   a. pnpm-workspace.yaml：@deepseek-ai/dsh-* overrides 逐包改到新版本
#      （注意：pnpm 11.11 通配 override 不生效，必须逐包精确钉版；
#        minimumReleaseAgeExclude 列表同步更新）
#   b. 根 package.json 与 packages/*/package.json 里的 @deepseek-ai/dsh-* 钉版同步更新
#      （^0.1.0-rc.x 的 caret 只匹配同 tuple 的 rc.x，不会自动吃到 0.1.1-rc.x，必须显式钉）
#   c. pnpm install && pnpm typecheck && pnpm test
#   d. pnpm install:profile（重写 ~/.dsh/profiles/web 的 bundle 依赖）

# 3) 3999 狗粮验证（先验证，再让 3080 吃新状态）
dsh --profile web --port 3999     # 访问 http://127.0.0.1:3999 逐项验证插件功能
# 确认无误后，3080 的 dsh web 会因 profile watch 自动重启吃到新状态（无需手动重启）。
# ⚠️ 除非用户明确同意，不要 kill/restart 3080。
```

## 四、调度（常态化追踪）

已安装 **launchd 用户代理**（crontab 在 macOS 上被 TCC 拦 `Operation not permitted`，launchd 成功）：
```bash
# plist：~/Library/LaunchAgents/com.dsh-spark-plugins.upgrade-check.plist（每天 09:30 跑 --write-report）
# ⚠️ plist 里 node 必须是绝对路径（launchd 环境没有 nvm 的 PATH）
launchctl kickstart gui/$(id -u)/com.dsh-spark-plugins.upgrade-check   # 手动触发一次
launchctl bootout gui/$(id -u)/com.dsh-spark-plugins.upgrade-check && rm ~/Library/LaunchAgents/com.dsh-spark-plugins.upgrade-check.plist   # 卸载
```

查看结果：
```bash
tail /tmp/dsh-upgrade-check.log          # 最近一次运行摘要
ls docs/dsh-upgrade-reports/             # 历史报告归档
```

> 注：`check-dsh-upgrade.mjs` 只依赖 npm registry（本机可访问）；GitHub 直连在本机不可用，脚本不走 GitHub。
> 临时产物缓存在 `/tmp/dsh-upgrade-check/`，可 `rm -rf` 重建。

## 五、已知破坏面档案（watchlist 背景知识）

| dsh 版本区间 | 破坏点 | 波及插件 | 处置 |
|---|---|---|---|
| 0.1.0-rc.8 → 0.1.1-rc.2 | `ProjectionDefinition`：`schema/view` → `stateSchema/wire`，新增 `SessionProjectionStateMap` | dsh-spark-finance | projection.ts 两个定义改字段；types.ts 补 StateMap 声明合并 |
| 0.1.0-rc.8 → 0.1.1-rc.2 | Cordis 事件 `credentials/updated` → `credentials/reference-updated` | dsh-github-ui / dsh-npm-ui | client `ctx.remote.$on` 改事件名 |
| 0.1.0-rc.7 → rc.8 | SQLite 存储格式不兼容 | 全体（宿主） | 升级即自动迁移，无插件侧动作 |
| 0.1.0-rc.6 → rc.8 | apiproxy settings 命名空间改为动态 `settings.describe()` | 插件设置页 | 已随 rc.8 生效，无需动作 |

新发现请追加到本表（含版本区间、破坏点、波及插件、处置）。