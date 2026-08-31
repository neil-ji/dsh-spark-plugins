# Finance 价格同步：从手填表格到一键同步

财务审计插件的"价格表"从来不应该让普通用户去手填。
这页解释 2026-08 之后这次重构：把那张 200+ 行的 JSON 表从卡片主面板搬走，
换来"一键同步"按钮 + 默认勾选的自动同步 checkbox + 一个指向第三方数据源的链接。

## 三个层级 + 一个开关

价格表的解析顺序（高优先级赢）：

```
user.prices          (settings 文档)        ← 用户在 advanced 折叠区手填
communityPrices     (in-memory)           ← 由 syncCommunityPrices 从 models.dev 拉来
composition.prices  (cordis.patch.yml)   ← bundle 的 hand-maintained 兜底（deepseek 峰谷表 + 61 个模型）
defaultPrice                                ← 都没有时的 fallback
```

`syncCommunityPrices` 把第二层换成最新数据。失败时**不动**这一层；
下次 `getLedger` 还是按上一次的快照算（账本不报错，用户能看到"上次失败"的橙色徽标再点 Retry）。

图示：

```
┌─ FinanceCard 主面板 ────────────────────────────────────────┐
│   连接（currency / balance.*）                              │
│   价格同步（autoSync ✓ · Sync now · last-sync 徽标 · ↗源） │
│   计费方式（plan/metered 路线打标）                          │
│   仪表盘偏好（layout / chart toggles）                       │
│   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│   ▼ 高级配置（JSON）[默认收起]                              │
│     · 默认单价 / · 供应商默认值 / · 价格表                  │
└────────────────────────────────────────────────────────────┘
```

## host 端

- `@Remote syncCommunityPrices(options?, signal?)`
  - 默认 `providers = DEFAULT_PROVIDERS = ['openai', 'anthropic', 'google', 'zai', 'volcengine']`
  - 默认 `fx = DEFAULT_FX = 7.2`（CNY micros per USD，可在 options 里覆盖）
  - 走 `fetchCommunityPrices` → `rowsToPrices` → `setCommunityPrices` 单一链路
  - 返回 `FinanceCommunitySyncResult`（见 types.ts）：`ok / appliedAt / kept / droppedDated / droppedNonToken / droppedNoCost / providers`
  - **失败不算同步**：HTTP 非 2xx / JSON 解析失败 / 用户取消 signal → 返回 `ok:false`，不污染 in-memory 层
- `@Remote getSyncStatus()`：返回最近一次成功同步的快照，**null 表示从没同步过**
- `mergePriceLayers(composition, community, user)` 是纯函数，住 `pricing.ts`，也是公开 API
- `FinanceService.setCommunityPrices(prices)`：纯内存 settter，给 sync remote 替换层用
- 包内 `scripts/sync-finance-prices.mjs` 同步脚本跟 host 共享 `src/sync/community-prices.ts` 里的转换逻辑；mirror test 跟 `scripts/sync-finance-prices.test.ts` 一致

## 客户端

- `FinanceSyncState`：`{ syncing, lastSync, lastError }`，镜像 host 的"上一次同步"状态
- `FinancePrefs.autoSync` 默认 `true`，`lastSync` 默认 `null`，两条都进 localStorage
- `FinanceCardController.syncNow()` 单飞（按钮狂按不会重复打 host），`setAutoSync(b)` 写 prefs
- `ensureAutoSync()` 在 `apply()` mount 时调一次：
  - `prefs.autoSync === true` && (没有 lastSync 或 距离 appliedAt > 24h) → 自动 syncNow
- `PriceSyncSection` 渲染三态徽标：never / last / failed
  - 失败时附 lastError 文本 +"点击 Sync now 重试" 提示
- 右上角 `View source ↗` 链接到 `https://models.dev`（用户看价格详单的唯一受支持路径）

## 数据源 = `models.dev/api.json`

源是社区维护的 AI 模型价格数据集（MIT 协议，每天更新）。
finance 把它转成 integer CNY micros/Mtok，按 `provider/model` 键 cache 到 in-memory 层。
文件里多带 `dated` snapshot（`*-20250901` 这种）只在没有对应无日期兄弟时保留，否则丢掉；
非 token 变体（TTS / realtime / transcription）一律丢弃。

CLI 端的 `pnpm finance:sync-prices [--providers=...] [--fx=...] [--dated]` 跟运行时 sync
走的是**同一份共享逻辑**（`src/sync/community-prices.ts`），区别只在：

| 维度 | 运行时（@Remote） | CLI（脚本） |
|---|---|---|
| 数据落点 | FinanceService.communityPrices（in-memory） | `cordis.patch.yml` markers 之间 |
| 触发 | UI 按钮 / 自动同步 | 仓库维护者手动跑 |
| 重启后是否还在 | ❌ | ✅ |

也就是说 runtime 是"日常自维护"，CLI 是"框架下一次升级前固化一份"。

## 失败兜底

| 失败场景 | 现象 |
|---|---|
| `fetch` 失败（DNS / 网络） | `ok:false`，lastSync 保持，UI 展示橙色失败徽标 |
| HTTP 5xx | 同上 |
| JSON 解析失败 | 同上 |
| 命中 schema 校验失败 | 同上（host 内部 catch 转 ok:false） |
| 用户 AbortSignal | 同上 |
| 上游 provider 不在 `models.dev` | `requestedMissing` 报告，sync 仍 `ok:true`，其它 provider 正常落 |
| 完全没有任何 user/community/composition 覆盖 | `defaultPrice` 兜底；账本不算"找不到价格" |
| `communityPrices` 非空但 `mergePriceLayers` 报错 | 不会发生：merge 是无副作用的对象展开 |

要点：**账本从不报错**。价格表哪天没同步，账本依然用上一次的最优可用层继续算，
用户在 UI 的 Sync now 按钮上看到底色变橙一点一下重试就行。

## 升级指引

从老 host（无 sync Remote）升级之后：

1. 装好新包 → restart dsh web
2. 老用户的 settings 里仍有 user-layer 的 `prices` / `providerDefaults` / `defaultPrice`，**继续生效**
3. 第一次 mount 客户端 autoSync=true → 距离 lastSync=null > 24h → 自动 syncNow 一次
4. 之后每次 mount 都顺着 24h 窗口自动刷新
5. 装老插件的客户端（host 还是 pre-commit-4）：UI 走 `syncAvailable=false` 分支，整段同步区块不显示，老的三个手填表单也仍然可填（前向兼容）

如果需要立刻全量换价格表而不是等 24h：

```ts
import { FinanceService } from 'dsh-spark-finance'
// 通过自定义 cli / admin remote 调用 syncCommunityPrices({ providers: ['openai', 'anthropic'] })
```

## 相关文件

```
packages/dsh-finance/
  src/sync/community-prices.ts        ← host 共享同步核心（costToRate / collectRows / fetchCommunityPrices）
  src/pricing.ts                      ← mergePriceLayers（原 pricing.ts 末尾，纯函数）
  src/types.ts                        ← FinanceCommunitySyncResult / FinanceSyncStatus / sync-community-prices 模块导出
  src/typert.schemas.ts               ← financeCommunitySyncResultSchema / financeSyncStatusSchema
  src/index.ts                        ← FinanceService.syncCommunityPrices / getSyncStatus / setCommunityPrices
  src/typert.host.ts                  ← 同步方法的 invocation descriptor（wire=options / source=json / codec=src-json）
  src/typert.remote-client.ts         ← 客户端 Remote 描述
  tests/sync-service.test.ts          ← service-level 集成（5 个 test）
  tests/community-prices.test.ts      ← 共享层测试

packages/dsh-finance-client/
  src/client/persist.ts               ← FinancePrefs.autoSync / lastSync / 持久化
  src/client/FinanceCardController.ts ← syncNow / setAutoSync / ensureAutoSync / refreshSyncStatus
  src/client/FinanceCard.tsx          ← PriceSyncSection + advancedDetails 折叠
  src/client/locales.ts               ← zh/en 文案
  src/client/FinanceCard.module.css   ← syncBlock / advancedDetails 样式

scripts/
  sync-finance-prices.mjs             ← CLI 落 cordis.patch.yml（与 host 共享 src/sync/*.ts 的转换）
```
