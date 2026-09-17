# 干净复核轮修复报告（acc-20260918-0155-clean → fix round）

- **来源**：`docs/ui-visual-review-2026-09-18-clean.md`（对 PC-QA 轮 `acc-20260918-0155` 的干净真宿主重做）
- **基线**：`aa273c5`；本轮**先重装宿主产物**（沙箱 tarball 保真安装，版本 = 仓库），再按复核结论修代码
- **处置**：**仍在 7/7 全修** · 部分已修 1/1 补齐 · 未判定 6 条中 3 条按源码/口径收口、3 条记为口径 · 口径修订 1 条（PCQA-001）
- **改了什么**：6 个包（ui-kit / dock / hippomemo / github-ui / npm-ui / finance-client）+ 1 个 harness 断言段 + 2 份规范文档

---

## 1. 处置总表

| 复核 ID | 级 | 现象 | 处置 | 关闭口径（这一条解决了什么） |
|---|---|---|---|---|
| 006 | P2 | 页级分栏宽度随模块跳 32px（火花 517 / 记忆 513 / 财务 485） | 修 | 财务 `.panel` 去掉自带的 `padding: var(--spk-pad-panel)`（dock `.dock-body` 已经给过，属**双内边距**）；hippomemo `.hippomemo-section` 去掉 `4px 2px` 的横纵内缩 → 三模块分栏同宽。真宿主断言：三者极差 **≤2px** |
| 007 | P2 | 分栏→首块间距三档（火花/连接器 0、财务 12、记忆 14） | 修 | dock `.dock-embed` 改 flex column + `gap: var(--spk-gap-page)`（分栏与内容同级的模块才吃到这一档）；hippomemo `.hippomemo-section` gap 14 → `--spk-gap-page`。真宿主断言：三者极差 ≤2px 且落在 8–16 |
| 004 | P1 | 时间四种措辞/中英混排（`2 h ago`、`最近 4 d ago`、`just now`、绝对时间、`2 小时前`） | 修 | hippomemo `formatRelative` 改走 locale（新增 `timeJustNow/timeMinutesAgo/timeHoursAgo/timeDaysAgo/timeMonthsAgo/timeYearsAgo` 六个 key，zh/en 同 key 集）；`prefLastSurfaced` 由「最近 {when}」改「上次浮现 {when}」；记忆列表元信息由**绝对时间**改相对时间、绝对时间进 `title`（SPEC §6）。真宿主断言：中文界面不出现 `just now` / `N min ago` |
| 017 | P2 | 进化队列每行都显示 `just now` | 修 | 候选时间字段语义订正：`detectedAt`（= 本轮扫描时间，对所有行同值）→ **`memoryUpdatedAt`（该记忆自己的 `updatedAt`）**；types 注释、memory-evolve 取值、UI 相对时间 + 绝对时间 title 三处同步 |
| 011 | P2 | 禁用按钮是半透明满色实底且不解释原因 | 修 | ui-kit 实心档禁用改**中性底**（`--spk-platform` + `--spk-label-3`、opacity 1，对比度走既有 `label-3 on panel` 配对）；github「保存令牌」/「测试代理」、npm「保存」、finance「还原到发版快照」四处补**原因文案 + aria-describedby**。真宿主断言：bg ≠ 品牌实底、opacity = 1、describedby 指向的元素有文案 |
| 018 | P3 | 金额小数位不统一（`¥261.9` vs `¥72.32`） | 修 | 不是删掉紧凑规则，而是**分两档**：kit `Money` 增 `exact`（固定两位小数，表格数字列用），KPI/Hero 保留原紧凑规则；finance 六处数字列改 `exact`。真宿主断言：面板内 ¥ 叶子文本全部匹配 `^¥[\d,]+\\.\\d{2}$` |
| 019 | P3 | 半角冒号与全角混排 | 修 | 标点进 locale：zh `来源：/凭据来源：`、en `Source: / Credential source: `（github/npm 两处来源行去掉代码里硬拼的冒号） |
| 015 | P3 | 列表每行一个删除入口 | 修 | 记忆列表行内**只留「编辑」**，删除收进详情 modal 页脚（那里已有 danger 形制 + `window.confirm` 二次确认）—— 破坏性入口不再按行铺开 |
| 001 | P1 | GitHub/npm 内容第一件不是子页签栏 | **改规范** | 裁决：面板**页级分栏是「多视图模块」的形制**，视图 ≥2 必须用 fullWidth 分段条；**单视图模块**（连接/设置页模板 §4.2-2）不分栏、内容直接是 SettingsCard 栈 —— 这是模板差异而非违规，并写明触发条件（出现第二个视图就必须改分栏）。SPEC §3.3 已落字 |
| N-02 | — | 分页「当前页」是实心 primary 胶囊 | 修 | hippomemo pager 当前页 primary → secondary（保留 `aria-current="page"`），同一操作域内不再多一个主色实心块 |
| 013 | P2 | 筛选钮无 aria + 次要形态混用 | aria 面**核实无需改** | 28 视图实测「无可访问名的可见按钮」= 0（含筛选 chevron 钮）；形态面记为口径：IconButton / Pill / 段控是三个不同角色，形制本来就不同 |
| 012 | P2 | 两个不同语义的状态用同一个点色 | 口径**已满足** | 源码本就有 `.hippomemo-todo-icon-{warn,info,danger}` 三档语义色；本轮样本只有一类候选，未复现「两类同色」 |
| 014 | P2 | 同一模块内列表行高三种 | 口径，不改 | ListRow（kit）/ todo-item / pref-row 是三个不同组件、三种密度；SPEC §2.7 密度变体与 §3.3 ListRow 各自成立（本轮未取行高口径） |
| 016 | P3 | 捕获区排版松散 | 口径，不改 | 捕获区已有提示行 + 字数计数，行内间距走 `--spk-gap-card`(8)；复核未给出可执行判据 |
| 008 | P1 | 财务表格四列被省略号截断 | 修（源码级） | 数字列给最小宽度（`minmax(88px, 1fr)` 等）、文本列加 `.cellWrap` 折行、`.table` 加 `overflow-x: auto`（SPEC §4.5）。沙箱无模型行，视觉确认留待真数据 |
| 020 | P2 | 列表出现两行完全相同的条目 | 不改 | 重复检测是引擎职责且已有「疑似重复」标签 + 合并动作；列表层去重会掩盖引擎结论 |

---

## 2. 根因（三条结构性）

1. **内边距有两个来源**：dock `.dock-body` 给 `--spk-pad-panel`，财务面板又给自己一份，
   记忆面板再给 2px —— 于是「同一个壳里的内容列」有三个宽度。修法是**内边距归壳**（模块只排版）。
2. **分栏→内容的间距靠各模块的容器 gap 拼**：分栏被包在容器里的模块（记忆/财务）有 gap，
   分栏与内容平级的模块（火花）没有 —— 三档并存。修法是壳给这一档（`.dock-embed` 的 gap）。
3. **时间文案与时间语义都没收口**：`formatRelative` 在组件里拼英文串；候选队列把「本轮扫描时间」
   当条目标签 —— 前者是 i18n 欠账（`ui-acceptance-2026-09-17.md` §9 有意保留项），后者是字段语义写错
   （`types.ts` 注释写的是 "when the candidate was first detected"，实现给的是 `options.now`）。

---

## 3. 新增防线（AGENTS §5：新防线进闸门，不只写文档）

| 防线 | 位置 | 断言 |
|---|---|---|
| 页级分栏宽度跨模块一致 | `dev-harness/real-host-check.mjs` 6j) | 火花/记忆/财务三模块分栏宽度极差 ≤2px |
| 分栏→首块间距跨模块一致 | 同上 | 三者极差 ≤2px 且落在 8–16px |
| 中文界面不得出现英文相对时间 | 同上 | 记忆模块四个子视图文本不含 `just now` / `N min ago` |
| 禁用提交必须给原因 + 中性底 | 同上 | GitHub「保存令牌」/ npm「保存」：disabled ∈ true、describedby 有文案、bg ≠ 品牌实底、opacity = 1 |
| 表格金额固定两位小数 | 同上 | 财务面板 ¥ 叶子文本全部 `^¥[\d,]+\\.\\d{2}$` |
| **宿主加载的是当前产物** | 同上 | 插件注入样式 `--dsw-alias-*` 计数 = 0 · `.dock-embed :is(h3)` 钉 `--spk-text-title` · token = 14px |
| 对比度（禁用中性底） | `scripts/audit-contrast.mjs` | 复用既有配对 `label-3 on panel`（底 = `--spk-platform`），156 项全绿 |

> 最后一条是这一轮最贵的教训：上一轮 PC-QA 走查用的宿主装的是落后产物，
> 21 条里 7 条是假阳性。把「产物新鲜度」变成一条断言，比写一段说明有用得多。

---

## 4. 口径修订

- **docs/UI-UX-SPEC.md**
  - §3.1：新增 disabled 形制（实心档中性底 + 原因文案 + `aria-describedby`）；
  - §3.3：SegmentedControl 补「多视图模块分栏 / 单视图模块不分栏」的判别与触发条件（PCQA-001 裁决）；
    Money 补 `exact` 两档精度；
  - §4.5：表格列最小宽度 + 文本折行 + 横向滚动；
  - §6：相对时间必须走 locale；**扫描类时间戳不得逐行同值**；表格数字列金额固定两位小数；
  - §7：新增 v4.3 治理条目。
- **docs/UI-UX-SPEC.md §7 / AGENTS.md**：`prefers-reduced-motion` 仍在待办（未动）。

---

## 5. 验收证据（2026-09-18）

| 面 | 命令 | 结果 |
|---|---|---|
| 构建 | `pnpm -r build` | 退出码 0 |
| 类型 | `pnpm -r typecheck` | 退出码 0 |
| 测试 | `pnpm -r test` | 退出码 0（finance-client 58 例全绿，其余包同） |
| 闸门 | `pnpm check:all` | PASS：架构 0 硬失败 · 价格 0 处 · 对比度 **156 项**（亮暗各 78）0 不达标 · audit-tokens PASS · 版本纪律 0 漏 bump · 直连宿主 token 0 处 |
| 预览 | `pnpm preview:verify` | **117/117 通过**，退出码 0 |
| 真宿主 | `pnpm sandbox:install`（16 包 tarball 保真）+ 重启 + `node dev-harness/real-host-check.mjs --url <3997>${B} | **62/62 通过**，退出码 0；控制台 0 条告警 |

新增断言段（6j）实测：

```text
ok  复核-006 页级分栏宽度跨模块一致（火花/记忆/财务 极差 ≤2px）
    {"sparkFacts":{"segW":517,"paneW":517,"gap":12,"block":"dock-stack"},
     "memFacts":{"segW":517,"paneW":517,"gap":12,"block":"hippomemo-tab"},
     "finFacts":{"segW":517,"paneW":517,"gap":12,"block":"x6cde8c_view"},"segSpread":0}
ok  复核-007 分栏→首块间距跨模块一致（三档收成一档）   {"gaps":[12,12,12],"gapSpread":0}
ok  复核-004 中文界面时间文案不出现英文串（just now / N min ago）   {"en":false,"sample":""}
ok  复核-011 GitHub「保存令牌」禁用时给原因 + 中性底 + 不透明
    {"disabled":true,"bg":"rgb(22, 27, 38)","brand":"rgb(109, 133, 254)","opacity":"1",
     "desc":"github-save-hint","hint":"粘贴访问令牌后才能保存"}
ok  复核-011 npm「保存」禁用时给原因 + 中性底 + 不透明
    {"disabled":true,"bg":"rgb(22, 27, 38)","brand":"rgb(109, 133, 254)","opacity":"1",
     "desc":"npm-save-hint","hint":"粘贴 granular token 后才能保存"}
ok  复核-018 表格金额固定两位小数（exact 变体）   {"count":2,"bad":[],"sample":["¥0.00","¥8.33"]}
ok  复核-产物 宿主加载的是当前产物（插件样式零宿主别名 · h3 钉 --spk-text-title）
    {"hippoAlias":0,"dockAlias":0,"h3":["... font-size: var(--spk-text-title) ..."],"title":"14px"}
```

> 修好前实测（同一段断言首次运行）：分栏宽度 517/513/485（极差 32）、间距 0/12/14（极差 14）——
> 两条都从 FAIL 转 ok，说明修的是真问题。

**本轮顺带修掉的三处 harness 自身口径**（不是产品缺陷，如实记录）：
1. 模块钮定位：收起态下 pane 不挂载，原写法「先找 tab 再开面板」会静默拿空值 → 改为**先确保展开**再定位（3 次重试 + 失败时打印 rail 诊断）。
2. 首块间距口径：原按「分栏后第一个有底/描边的元素」取数，各模块结构不同会把卡内元素当首块（火花 58.8 / 财务 46）→ 改为取**分栏之后最外层的块**，三模块同为 12。
3. 金额 exact 口径：原扫描整个 pane，把 KPI 的紧凑金额（`¥0`）也算进去 → 改为只看表格（且汇总多张表，避免只看第一张空表）。
   另：PCQA-019 的「一个实心 primary」断言按 v4.3 调整为**只数可用按钮**（禁用的实心档已改中性底）。

> 版本：ui-kit 0.6.5 · dock 0.3.6 · hippomemo 0.3.4 · github-ui 0.2.10 · npm-ui 0.2.12 · finance-client 0.5.10

---

## 6. 提交清单

| commit | 内容 | 版本 |
|---|---|---|
| `d7de9cb` | fix(ui-kit)：Money exact 档 + 实心档禁用中性底 | 0.6.5 |
| `68ed3ae` | fix(dock)：`.dock-embed` 补分栏→首块间距档 | 0.3.6 |
| `a821cfc` | fix(hippomemo)：时间文案走 locale、候选时间取记录 updatedAt、行内删除收敛、间距收口 | 0.3.4 |
| `e14429d` | fix(github-ui)：保存/测试代理禁用原因 + 来源标点进 locale | 0.2.10 |
| `1cadcee` | fix(npm-ui)：保存禁用原因 + 来源标点进 locale | 0.2.12 |
| `617ea17` | fix(finance-client)：去双内边距、表格列不压缩、还原禁用原因、金额 exact | 0.5.10 |
| `4a2aa20` | test(harness)：real-host-check 增形制/间距/禁用/时间/产物新鲜度断言段 | — |
| `ab040f6` | docs(agents)：SPEC v4.3 口径（disabled、单视图不分栏、表格、时间） | — |
| `282e904` | docs(ui)：干净复核报告 + 本报告 | — |

---

## 7. 遗留

1. **PCQA-008 的视觉确认**：沙箱财务没有订阅计划与模型行，表格「四列都不再截断」只在源码层成立；
   等真宿主有数据时按 `PCQA-view-fin-2` 同口径复看一次。
2. **PCQA-014 行高**：本轮按口径关闭（不同组件不同密度），若后续要统一，应先在 SPEC §2.7 定义
   「列表密度 token」再改，而不是逐个改 padding。
3. **常驻宿主 3080 仍是落后产物**：本轮只在沙箱宿主（3997）验证。刷新命令
   `node scripts/install-profile.mjs web --no-build` + 重启 `dsh web`（重启会中断当前会话，需用户决定）。
4. **`prefers-reduced-motion`** 统一 media query 仍待办（SPEC §7）。
5. `dev-harness/` 下 4 个未跟踪探针脚本（`panel-sweep*.mjs` / `probe*.mjs`）仍是上轮遗留，本轮未动。
