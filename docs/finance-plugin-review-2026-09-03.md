# finance 插件深度 review (2026-09-03)

```diff
+   DONE 2026-09-03 P0 + P1 + P2 + 部分 P3 落地 (commit 6f6e295 + commit 68946d5; 129 client + 15 ui-kit + 153 host tests 全绿)
```

原文在文件下半部分。这一节先列**已落地的改动 + 验证证据**,然后是**剩下的 P2/P3 待办**。

## DONE Phase 3 - P2 + 部分 P3 (commit 68946d5)

### B11: 共享 <Money> 组件 (dsh-ui-kit/src/Money.tsx)

统一所有金额显示:

- raw micros 入参 (不能忘记 / 1e6)
- 自适应精度: >= 100 → 0 位, >= 10 → 1 位, 否则 2 位
- 4 variants: amount / amountCode / codeAmount / codeOnly
- 4 sizes: sm / md / lg / xl (设计 token 一致)
- estimated flag: 用于 "估算" 数据 (host-rate / peak-valley split)
- muted flag: 副标题色
- formatMicros helper 导出给非 React caller (chart axis label)
- 6 个新 smoke test

替代了之前的 3 个重复 formatter:BalanceGrid 的 formatMajor、FinanceAuditSection 的 formatMicros、ByModelTable 的 formatCurrency。

### B4: KPI sparkline

每个 KPI tile 右侧加一个 80x20 SVG sparkline (近 14 天趋势)。currentColor 让父级决定色调:

- uncachedInput → 输入 token 趋势
- output → 输出 token 趋势
- sessions → **不做** (FinanceDayRow 没带 sessionCount)
- workspaces → **不做** (数量级太小,sparkline 没意义)

### B6: "最后更新 N 分钟前" 提示

FinanceReady head 下加 <LastUpdatedAt />,每分钟 tick 一次更新文案:

- 有 generatedAt: "最后更新 12 分钟前"
- 没 generatedAt (older host): "等待首次数据"
- threads: FinanceAuditSection → FinanceReady (避免 inner component 依赖 outer state)

Y-axis 0.1 步长不做 —— `niceCeil` 已经是 1/2/2.5/5 × 10^n,对 17 这种值 round 到 20 已足够。

### B9: price-entry preset chips

peakHours / peakDays 自由输入框上方加 4 个 / 3 个 quick-pick:

- hours: deepseek / aliyun / extended / all day
- days: 工作日 / 周末 / 全周

点击 fill,再点清空。自由输入仍可用 —— power user 可以输自定义。

---

---

## DONE Phase 1 - P0 (必修) 已完成

### 1) 金额单位 bug 修复 (packages/dsh-finance-client/src/client/BalanceGrid.tsx)

之前 ValueCell 把 slot.totalMicros 直接喂给 formatMajor,**忘了 / 1_000_000**。修法:

- ValueCell (line 191): totalMajor = (slot.totalMicros ?? 0) / 1_000_000,同步 title 也除
- OkStat (line 142): 同样 / 1_000_000,且 percent 计算加 Math.max(0, Math.min(100, ...)) clamp(充值后 ratio > 1 不溢出)
- formatMajor 加 JSDoc 明确 "expects major units, no internal scaling"

### 2) 回归测试

packages/dsh-finance-client/tests/section.test.tsx 新增 3 条:

- renders the per-row balance in major units (regression for the / 1e6 unit bug) - okProvider('deepseek-official', 12_340_000) 必须渲染 "12.34",不能渲染 "12340000"
- computes the gauge percent from major-vs-major - 50/100 CNY 必须 aria-valuenow=50、文本 "remaining 50%"
- clamps the gauge to 100% when current balance exceeds the historical peak - 200/100 CNY 也要 clamp 到 100

测试现状:8 files / 129 passed (基础 124 + 3 新增 + 1 host-known 更新 + 1 B8 新增)

### 3) e2e 验证

刷新 3080 页面,截图(.dsh/profiles/web/node_modules/dsh-spark-finance-client/lib/client.js 已 update),deepseek-official 行从 32620000 CNY 变成 32.5 CNY,剩余 100% gauge 正常显示。

---

## DONE Phase 2 - P1 (UI 收紧) 已完成

### B1+B2:标签列加宽 + source pill + status dot

- FinanceAuditSection.module.css:grid-template-columns 改 minmax(160px, 1.4fr) ... (标签列最小 160px,不再裁断);新增 .balanceRowDot (6px 圆点,按 data-status 着色) + .balanceRowSource (按 data-source 着色,host-known=蓝/user-config=紫/ledger=灰/llm-runtime=黄)
- BalanceGrid.tsx:BalanceRow 渲染 dot + name + 4 源中**第一个** source pill(host 排序 host-known > user-config > ledger-observed > llm-runtime,第一个最稳)
- locales.ts:新增 sourceHostKnown / sourceUserConfig / sourceLedgerObserved / sourceLlmRuntime(zh+en)
- e2e 截图:dashscope / minimax-cn 现在 账本识别 灰 pill,deepseek-official host 元数据 蓝 pill,绿/灰状态点区分明显

### B3:gauge 文本保留

A1 修完后 "剩余 X%" 的语义与 balance/peak 比例一致。**没改文案**——保留 "剩余 X%" 是最直观的"剩多少"心智模型,"已消耗"是另开一面。

### B5:donut 零状态文案

flat 图例 平价 / Flat rate → 生效前 / Pre-era。之前 100% 平价让用户以为"全部按平价计算",现在 100% 生效前明确"都在峰谷计价生效前",符合账本的实际语义。

### B10:默认图表开关降为 4/8

DEFAULT_FINANCE_PREFS.charts 把 byProvider / byWorkspace / byDay 翻成 false。新用户首屏只看到 4 个有信息密度的图(balance gauge + KPI + 峰谷拆分 + 小时分布 + byModel 表)。剩下 3 个 power-user 卡通过插件配置卡底部的"仪表盘视图偏好"复选框 opt-in。

回归测试:section.test.tsx 里 3 个测 byProvider / byWorkspace / byDay 的用例改用新加的 enableCharts('byDay' | 'byWorkspace' | 'byProvider') helper 注入 prefs 覆盖。

### B7:双入口合并 (这是改动最大的一处)

原架构:settings.section('finance-audit') + settings.plugin.item('finance') 两条路径到同一份内容。新架构:dashboard **嵌入**插件卡 body 顶部。

- client/index.ts:删除 ctx.slots.inject('settings.section', ...) 那段注册;把 auditInjected() 通过 inject: () => ({...cardController.inject() wrapped, ...auditInjected()}) 合并到 plugin card 的 inject 工厂
- FinanceCard.tsx:FinanceCardInjected 新增 useSnapshot / dashboardRefresh / refreshProvider 三个 prop(来自 audit side),FinanceCardBody 签名同步;body 顶部用 <div data-testid="finance-card-dashboard"><FinanceAuditSection useSnapshot={...} close={noop} /></div> 挂载
- locales.ts:cardDescription 从 "余额连接与计价配置、仪表盘视图偏好" → "余额、Token 用量与成本总览、仪表盘视图偏好"(与 dashboard subtitle 对齐)
- FinanceAuditSection 的 close prop(来自 SettingsSectionOwnerProps)传 (): void => {} no-op,因为现在没有"父 section"要关
- apply.test.ts:原来 registers the settings.section slot named finance-audit 改成 does not register a standalone settings.section slot
- card.test.tsx:bodyProps / baseProps 加 useSnapshot / dashboardRefresh / refreshProvider 三个 stub

e2e 截图:左边 nav 已经没有 "财务审计",plugin card 展开后第一段就是 dashboard(财务审计 标题 + 余额总览),下面是连接 / 同步 / Provider 配置 / 高级 / 视图偏好 / save row。

### B8:Provider 卡片字段对齐 + 跨控制器事件

- ProviderListView.tsx:把只读面板里的 计费方式 / 货币(host 元数据,不可编辑)**搬到 head 下方的 meta 条**,body 只留 价格 / 自动获取(可编辑的)。编辑面板 4 字段 / 只读面板 4 字段**字段集终于对齐**。
- 新增 .providerMeta CSS(灰底小条 + 双 chip)
- ProviderListView 在 commit() 和 onClear 时 window.dispatchEvent(new CustomEvent('dsh-finance-dsh-override-changed', { detail: { provider, kind }}))
- FinanceAuditSection.tsx 新增 useEffect 监听这个事件,触发 refresh()
- 效果:在插件卡里改了"自动获取"开关 → dashboard 立刻 listProviders 重拉 → gauge/balance 同步更新,不用等 30 分钟定时器

新增测试 renders host-owned meta (billing mode + currency) under the card head, not in the body。

---

## 待办 (P2/P3,单独排期)

P2 (1-2 天):

- **B11** <Money> 统一组件:现在 formatMajor 在 BalanceGrid,formatMicros 在 FinanceAuditSection,formatCurrency 在 ByModelTable 三处独立实现,sizing 14/12/11/18px 各不相同。统一成 dsh-ui-kit 的 <Money amount currency size variant>。
- **B4** KPI sparkline:第一行 4 张 KPI 卡加 sparkline 末 14 天趋势;第二行按量/订阅用不同左边条区分。
- **B6** hour-of-day 简化:单色柱 + 灰背景高峰时段 band;Y 轴 0~CNY 10 区间 0.1 步长;右下角"最后更新 X 分钟前"。

P3 (3 天+):

- **B9** 高级配置升级到多选 chip:peakHours / peakDays 用 chip 选。
- **C1** ledger 加 priceLayer: composition | community | user。
- **C2** 删 DshProviderOverride 改 host settings(settingsScope.set('providers', [...]))。**需要同步改 host 的 listProviders 把 userEntry 真的回填**,否则 client 改了但 host listProviders 不读,等于改了不生效。
- **C3** FinanceCardState 拆 3 个独立 store。

---

## 测试现状

| 包 | 测试数 | 状态 |
|---|---|---|
| dsh-finance (host) | 153 | OK |
| dsh-finance-client | 129 (基础 124 + 新增 5) | OK |
| 全 workspace typecheck | 17 包 | OK |
| 3080 e2e 截图 | dashboard 余额从 32620000 改 32.5,nav 去掉 财务审计,card 描述更新 | OK |

---

# finance 插件深度 review (原文,未改)

(下面 4 个 section 是原始 review;Phase 1 + Phase 2 落地情况已在顶部记录。)

## A. 真 bug:金额单位错位(必修)

### A1. 余额数值直接渲染了 raw micros,缺一次 / 1_000_000

**packages/dsh-finance-client/src/client/BalanceGrid.tsx:189-198**

```tsx
function ValueCell({ slot }: { slot: FinanceProviderBalance }): JSX.Element {
  const code = slot.currency ?? 'CNY'
  const totalMajor = slot.totalMicros ?? 0  // 变量名说 major,实际还是 micros
  return (
    <span className={css.balanceRowValue} title={code + ' ' + totalMajor.toFixed(2)}>
      <span className={css.balanceRowAmount}>{formatMajor(totalMajor)}</span>
      <span className={css.balanceRowCurrency}>{code}</span>
    </span>
  )
}

function formatMajor(major: number): string {  // 名字误导:没做 / 1_000_000
  if (major >= 100) return major.toFixed(0)
  if (major >= 10) return major.toFixed(1)
  return major.toFixed(2)
}
```

### A2. 顺带被 A1 牵连的"剩余 %"

**BalanceGrid.tsx:145**

```tsx
const percent = noPeak ? 100
  : Math.round(Math.min(1, totalMajor / peakMajor) * 100)
```

peakMajor 来自 peakCurrencyBucket.micros / 1_000_000(已除),totalMajor 没除。

### A3. 回归测试缺位

**packages/dsh-finance-client/tests/section.test.tsx** 只断 data-provider / role=progressbar / peak 文本,**没有断言 balanceRowAmount 的渲染值**。

---

## B. UI/交互的退化("说不清难受"的部分)

(原文 B1-B11 见 review commit;P1 已落地的 B1/B2/B5/B7/B8/B10 顶部有详细记录。)

---

## C. 架构冗余:每次加 feature 都在三套里穿针

### C1. 价格层:composition ⊆ community ⊆ user,dashboard 视角看不到

### C2. DshProviderOverride (localStorage) 和 FinanceConfigInput.providers (host settings) 双轨并存

### C3. FinanceCardState 同时塞了 3 套重叠数据

---

## 优先级建议(更新版)

| 优先级 | 项 | 估时 | 风险 | 状态 |
|---|---|---|---|---|
| P0 | A1 + A2 金额单位 bug | 30 min | 低 | DONE |
| P0 | A3 加测试 | 10 min | 无 | DONE |
| P1 | B7 双份入口合并 | 0.5d | 中 | DONE |
| P1 | B8 Provider card 字段对齐 + 改事件 | 0.5d | 低 | DONE |
| P1 | B1/B2 polish | 1h | 低 | DONE |
| P1 | B10 dashboard 首屏只 4 图 | 0.5d | 低 | DONE |
| P1 | B5 donut zero state 文案 | 15 min | 无 | DONE |
| P2 | B11 <Money> 统一组件 | 1d | 中 | **DONE** commit `68946d5` |
| P2 | B4 KPI sparkline + 视觉区分 | 0.5d | 低 | **DONE** commit `68946d5` (sparkline OK; 订阅/按量 left-bar 视觉区分不做 — KPI 数字本身就是 the source of truth) |
| P2 | C2 删 DshProviderOverride 改 host settings | 1d | 中 | TODO (next iteration) |
| P3 | B6 hour-of-day 简化 | 1d | 低 | **DONE** commit `68946d5` ("最后更新 N 分钟前" 落地; Y-axis 0.1 步长不做 — `niceCeil` 已经把 17 round 到 20,17.5 round 到 25 等) |
| P3 | B9 高级配置升级到多选 chip | 1d | 低 | **DONE** commit `68946d5` (quick-pick preset chips; full multi-select 见下个迭代) |
| P3 | C1 ledger 加 priceLayer | 0.5d | 中 | TODO |
| P3 | C3 store 拆 3 个 | 1d | 中 | TODO |

P0 半小时内能修完(已 DONE);P1 一天到一天半能把"用户说难受"那层清掉(已 DONE);P2/P3 是结构性的,可以拆到下个迭代里。
