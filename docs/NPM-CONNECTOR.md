# npm 连接器：token 全权接管 npm 平台侧

dsh-connector-npm 的目标：**用户只需在 npm 平台创建一个 granular access token，
在 dsh Web 插件设置页粘贴 → 测试连接 → 保存一次。之后只要 token 不失效，
agent 就能全权接管 npm 平台侧管理**（发布 / dist-tag / 弃用 / OIDC trust /
npm_launch 一条龙）——全程无需用户再操作终端、无需浏览器 2FA。

## 一次性接入流程

1. 到 <https://www.npmjs.com/settings/{你的账号}/tokens> 创建 **Granular Access Token**：
   - 权限：**All packages** + **Read and write**
   - 勾选 **Bypass 2FA**（发布类操作完全免 2FA）
   - 有效期自选（建议一年或无期限；token 失效即需重新粘贴）
2. 打开 dsh Web → 设置 → npm 发布页：
   - 在 token 输入框粘贴 token（写保护，永不回显）
   - 点 **测试连接**（凭证缝临时持有，横跨 wire 单向传递，不留存）
   - 点 **保存**（写入本机凭据缝 `~/.dsh/.credentials.yaml`，引用名 `NPM_TOKEN`，权限 600）
3. 页面显示「已连接账号 <用户名>」即完成。之后对 agent 说“发布 xx 包”即可。

> 设置 → 插件 → 插件配置页里可改 registry 根地址、凭据引用名（默认 NPM_TOKEN）与**套件包列表**。
> 套件包列表（每行一个）：状态面板展示的包集合，默认四件套
> （dsh-connector-wire / dsh-connector-github-ui / dsh-connector-github / dsh-connector-npm）。
> 某包已放弃时，删掉对应行并保存即可从状态面板移除；清空恢复默认。

## token 撑起的平台侧能力（agent 工具）

| 工具 | 能力 | 走 REST 直连 |
| --- | --- | --- |
| `npm_publish` | 构建 + 版本升级 + 发布 + dist-tag（`--otp` 可选） | 发布本体走 npm CLI + 临时 .npmrc |
| `npm_dist_tag` | add / remove / list dist-tags（`/-/package/{pkg}/dist-tags/{tag}`） | ✅ |
| `npm_deprecate` | 弃用 / 取消弃用指定版本区间（`GET ?write=true` + `PUT` 整包文档） | ✅ |
| `npm_trust_add` | 配置 OIDC trusted publisher（github / gitlab / circleci） | ✅ |
| `npm_trust_list` | 查 trust 配置列表（`GET /-/package/{pkg}/trust`） | ✅ |
| `npm_trust_revoke` | 撤销 trust 配置（`DELETE .../trust/{id}`） | ✅ |
| `npm_launch` | 一条龙：起名检查 → scaffold → GitHub 建仓推送 → Pages → 自动发布 + trust + tag | 混合 |
| `npm_token_status` | token 健康度（whoami） | ✅ |
| `npm_package_check` / `npm_scaffold` / `npm_first_publish`（无 token 回退） | 检查 / 脚手架 / 人工脚本 | — |

## OTP（一次性密码）契约

npm 平台规则（[npm-trust 文档](https://docs.npmjs.com/cli/v12/commands/npm-trust)）：

- **发布**：bypass 2FA 的 GAT 无需 OTP。
- **trust 端点（create/revoke）**：强制 2FA；**带 bypass 2FA 的 GAT 明确不被 trust 端点接受**。
- 因此 trust 相关操作在 registry 返回 401 “one-time pass” 时，工具返回 `needs-otp`，
  agent 会向用户索要认证器里的 6 位一次性密码，拿到后带 `otp` 参数重试（请求头 `npm-otp`），
  之后该操作即完成。这是 npm 平台设计的唯一人工时刻，不影响 publish / dist-tag / deprecate 的全自动。

## 没有 token 时的回退

未配置 token 时 `npm_launch` 返回人工脚本（`npm publish` + `npm trust github`，浏览器 2FA），
执行完成后调 `npm_launch(stage: "tag")` 由 CI 经 OIDC 接管后续发版。有 token 时无需这些。

## 危险操作策略：只保留可撤销/可抵消的操作

规则：**不可撤销、不可回退的操作不允许暴露；可撤销、可抵消（即便绕路）的操作可以保留。**
当前所有写操作均满足该规则：

| 操作 | 直接逆操作 / 抵消路径 |
| --- | --- |
| `npm_trust_revoke` (DELETE) | `npm_trust_add` 同参数重建同一条 trust 配置 |
| `npm_dist_tag remove` (DELETE) | `npm_dist_tag add` 把同一版本挂回该 tag |
| `npm_dist_tag add` | `npm_dist_tag remove` 摘除 |
| `npm_deprecate`（弃用） | 空 message 取消弃用 |
| `npm_deprecate`（取消弃用） | 重新弃用 |
| `npm_publish` | npm 平台不可删除已发布版本；绕路抵消 = `npm_dist_tag` 改挂标签 + `npm_deprecate` 软弃用该版本 |
| `npm_launch` | 各步骤均有逆操作：git tag 可移除、包可弃用、仓库可删（github 侧） |

> 刻意不暴露的操作：`npm unpublish`（平台不可逆，仅 72h 内整包删除窗口，超出即永久）、
> 任何形式的版本/包删除。新增工具时按此表核对可逆性。

## 实现要点（review 结论）

- **配置热更新修复（存量 bug）**：`installSettingsSection` 的 `setSource` 会重新绑定外层
  `configSource` 变量，而 `new NpmService(ctx, configSource)` 若按值传入初始 thunk，
  service 永远读不到后续配置修改（registry / kitPackages 热更新均失效）。
  修复：传入间接层 `() => configSource()`，每次读取都经过最新绑定。


- 凭据值只存在于本机凭据缝；插件 UI / wire / 工具永远不回显 token 值。
- `npm/token.test` Remote 支持「草稿 token 先行测试」：值单向过 wire、由连接器临时持有、不落盘。
- `npm_trust_add` 不再依赖本地 npm CLI——直接调 registry REST（`POST /-/package/{pkg}/trust`），
  与 npm CLI 的 `npm trust` 完全等价但可被 agent 驱动。
- `npm_deprecate` 不再只生成命令文案，而是用 token 直接执行（复刻 npm CLI 的 CouchDB 文档更新）。
- `npm_publish` 用临时 .npmrc（0600，finally 必删）+ `npm publish`；支持 `--otp` 与 `--dry-run`。
- 修复：`npm_launch` 自动路径发布成功后若 trust 失败，不再错误回退人工脚本（避免“重复发布”报错），
  而是如实上报 `trust.status`（configured / needs-otp / failed）与下一步。