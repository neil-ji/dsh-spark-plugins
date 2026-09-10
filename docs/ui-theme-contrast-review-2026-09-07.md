# 插件 UI 亮/暗主题对比度与视觉层次审查（2026-09-07）

审查对象：`packages/*` 五个插件面板（GitHub / npm / 财务审计 / HippoMemo / 火花）+ `dsh-spark-dock`
悬浮球面板 + `dsh-ui-kit` 组件层。
审查口径：**WCAG 2.1 AA**（正文 4.5:1 / 大字·非文本 3:1）+ 视觉层次可辨性 + 主题一致性。
审查方式：把设计系统里**真实存在**的前景/背景组合抽成配对表，静态解析 token 计算实测比值，
并扫描全部插件 CSS 的 token 引用完整性 —— 全部固化为可重复执行的闸门
（`pnpm check:contrast` / `scripts/tests/contrast.spec.ts`），不依赖人工目测。

---

## 1. 结论

把 v4 的目标配对表跑在 v3 token 上做基线：**亮色 7/67 通过、暗色 12/67 通过**
（其中一部分红点是 v4 才引入的 token 尚不存在，属于"缺槽位"而非"配错色"）。
真正**独立可复核**的缺陷如下，修复后 **142 项配对全绿、token 硬失效 0 处、静态回退 0 处**。

| 级别 | 问题 | 实测证据 | 用户可见后果 |
| --- | --- | --- | --- |
| P0 | 亮色主题下分段控件选中项**不可见** | 1.14:1（要求 4.5） | 财务 / 记忆 / dock 的页签看不出选中了哪个 |
| P1 | 语义色系统性低于 AA | 成功 2.86、警告 2.77、元信息 4.32–4.36 | 状态提示、次要文字读不清 |
| P1 | 模块 accent 当文字全军覆没 | 1.87 / 1.98 / 3.19 / 3.68 / 4.38 | dock 模块图标、胶囊文字、提议徽章 |
| P1 | 品牌蓝单值兼两角色 | 白字压实底 4.33、当文字 3.76–4.33 | 主按钮标签、菜单选中项、链接 hover |
| P1 | 卡片面与面板面**同色** | 1.00:1（亮）/ 1.01:1（暗） | 面板里所有卡片只剩一条描边，视觉上是"一坨" |
| P2 | 7 处 `--dsw-*` 未桥接 → 属性失效 | 见 §7 表 | 财务进度条渐变整条消失、provider 卡失去底色、tooltip 文字变黑 |
| P2 | 12 处写死亮色 fallback | 见 §7 | 同一组件在零 dsh 预览与真实宿主里长得不一样 |
| P2 | 终端块借用会翻主题的语义色 | 错误行 3.53:1、dim 3.43:1 | 亮色主题下终端里的报错与弱化行读不清 |

---

## 2. P0：亮色主题里分段控件等于不存在

**现象**：`.seg`（页签/分段条）在亮色主题下，选中项的标签是**白字压近白滑块**。

```
槽底 .seg   = --spk-layer-2 = #edeff3
滑块 .thumb = --spk-platform = #eef0f4   ← 与槽底只差 1.00:1
选中字       = #ffffff（写死）            ← 与滑块 1.14:1
```

暗色主题之所以"看起来没问题"，纯属巧合：`--spk-platform` 在暗色是 `#161b26`，白字压上去才成立。
也就是说这个控件的选中态**只在暗色主题可用**，而它是财务面板四个页签、记忆面板四个分区、
dock 模块子页的唯一导航控件。

**修复**（`SegmentedControl.module.css`）：

- 新增 `--spk-seg-thumb`（亮 `#ffffff` / 暗 `#2b3444`），滑块改为**抬起面 + 描边 + 阴影**；
- 选中字改 `--spk-label`，跟随主题翻；选中态补 `font-weight: 600` 作为第二通道；
- focus 描边从 `--spk-brand` 改为 `--spk-focus-ring`（3:1 非文本对比度）。

修复后：亮色选中标签 16.87:1，暗色 10.41:1；滑块与槽底两个主题都可辨。

---

## 3. P1：品牌蓝 #4d6bfe 一个色值扛不了两个角色

`#4d6bfe` 的相对亮度 0.193，正好卡在"配白字不够、当文字也不够"的中间地带：

| 用法 | 实测 | 要求 |
| --- | --- | --- |
| 白字压品牌实底（主按钮标签） | **4.33:1** | 4.5 |
| 品牌色当文字（菜单选中项 / Modal 强调 / 链接 hover） | **3.94 ~ 4.33:1** | 4.5 |
| 品牌色 hover `#6d85fe` + 白字（暗色） | **3.26:1** | 4.5 |

**修复**：品牌色按角色拆档（这是成熟设计系统的通行做法 —— primitive 保持身份色，semantic 分角色）：

| Token | 亮色 | 暗色 | 角色 |
| --- | --- | --- | --- |
| `--spk-spark-500`（primitive，不变） | `#4d6bfe` | `#4d6bfe` | 品牌身份 / 软底 / 描边 / 焦点 |
| `--spk-brand` | `#3d5af0` | `#6d85fe` | **实底**（配 `--spk-on-brand` = 白字 / 深字 5.36 / 5.23） |
| `--spk-brand-fg` | `#2f46c8` | `#93a8ff` | **文字 / 图标**（7.42 / 7.14） |
| `--spk-focus-ring` | `#3d5af0` | `#93a8ff` | 焦点描边（≥3:1 非文本） |

同一手法复用到模块 accent（见 §5）与状态色。

---

## 4. P1：语义色 / 次要文字在亮色灰底上系统性不达标

亮色主题的卡片面是灰底（`#edeff3`），灰底会**吃掉**语义色的对比度余量：

| 用法 | 原值 | 实测 | 修复 |
| --- | --- | --- | --- |
| 成功文字（github/npm `.notice`、统计正向值） | `#16a34a` | **2.86:1** | `#166534` → 6.59（灰底）/ 7.13（白卡） |
| 警告文字（价格表过期提示、warn 标签） | `#d97706` | **2.77:1** | `#9a3412` → 6.22 |
| 元信息 `label-3`（图表刻度 / 空态提示 / dock 副标题） | `#667085` | **4.32 ~ 4.36:1** | `#5f6a7d` → 4.79 ~ 5.46 |
| 次要文字 `label-2` | `#5b6270` | 5.52（勉强） | `#525b6b` → 6.00 |
| 空态提示（`label-3` + `opacity: .8`） | — | **3.04:1** | 去掉 opacity → 5.46 |
| 归档行标题（`opacity: .55`） | — | ~3:1 | 改 `label-3` + 删除线 |

**根因**：把"浅一档的灰/浅一档的绿"当成层级手段，而浅色 token 在灰底上没有余量。
**原则**：第三层级要么换 token 档位、要么靠字号/字重，**不要用 opacity 冲淡已经算好的 token**。
本次已移除插件层全部"文字 opacity 弱化"（8 处），只保留 `:disabled` 语义的透明度。

---

## 5. P1：模块 accent 未接线 + 单值兼任图形与文字

三个叠加缺陷：

1. **`--acc-*` 从未定义**。`modules.tsx` 写 `var(--acc-spark, #f59e0b)`，但 token 层只有 `--spk-acc-spark`；
   `--acc-*` 只在 `docs/spark-dock-preview/css/tokens.css` 里存在 → 插件运行时**一直走 fallback 字面量**，
   主题切换不生效。财务的 hero 渐变同样引用了不存在的 `--acc-finance`。
2. **一个 accent 值兼任两种角色**：既当 tab 图标的 currentColor（文字态），又当计量条 / 图表填充（图形态）。
   亮色下 `#f59e0b` 当文字只有 **1.87:1**，`#22c55e` **1.98:1**，`#3b82f6` **3.19:1**，
   `#8b5cf6` **3.68:1**，`#cb3837` **4.38:1** —— 全军覆没。
3. **dock 的实底胶囊**把 `--dsw-alias-label-primary-foreground`（亮色 = 白）压在琥珀底上 = 2.15:1。

**修复**：accent 拆「实色档 / 文字态档」，并把 `--acc-*` 全部改成 `--spk-acc-*`：

| 模块 | 亮色实色 | 亮色文字态 | 暗色实色 | 反白标签 |
| --- | --- | --- | --- | --- |
| 火花 spark | `#d97706` | `#92400e` | `#f59e0b` | `--spk-on-accent`（= `--spk-contrast-fill-label`：亮 `#fff` / 暗 `#171c27`） |
| 记忆 hippomemo | `#3b82f6` | `#1d4ed8` | `#60a5fa` | 同上 |
| 成本 finance | `#16a34a` | `#166534` | `#4ade80` | 同上 |
| GitHub | `#8b5cf6` | `#5b21b6` | `#a78bfa` | 同上 |
| npm | `#cb3837` | `#991b1b` | `#f87171` | 同上 |

`--accent`（实色）只留给指示条 / 计量条 / 图表；`--accent-fg`（文字态）用于图标、胶囊文字、实底芯片底色。
dock 的 `DockModule` 因此新增 `accentFg` 字段并在 `DockOverlay` 里落成 `--accent-fg`。

---

## 6. P1：面层次是平的（卡片 = 面板）

| 组合 | 修复前 | 修复后 |
| --- | --- | --- |
| 卡片 `layer-2` vs 面板 `platform`（亮） | `#edeff3` / `#eef0f4` = **1.01:1** | `surface-card #ffffff` / `#eef0f4` = **1.14:1** |
| 卡片 vs 面板（暗） | `#171c27` / `#161b26` = **1.01:1** | `#1b212c` / `#161b26` = 1.07:1 |
| 浮层（Menu/Modal/Toast）vs 面板（暗） | 同色 | `#222a37` / `#161b26` = 1.19:1 |

设计系统文档写的是"卡片 surface = layer-2"，但 `layer-2` 同时被当作**凹陷/轨道色**
（输入框底、进度轨道、图表 track、胶囊底）—— 一个 token 兼两个相反语义，必然二选一坏掉。
**修复**：新增独立面 token，并把"凹陷"和"抬起"分开：

- `--spk-platform` 面板/页面；`--spk-surface-card` 卡片（亮 `#fff` / 暗 `#1b212c`）；
  `--spk-surface-float` 菜单·弹窗·Toast（暗 `#222a37`）；
- `--spk-layer-2` 保留为**凹陷/次级填充**（亮 `#f4f6fa`，同时把亮色从 `#edeff3` 提亮以给文字留余量）；
- 顺带修掉 dock 侧栏：把 `layer-2` 当侧栏底色是同一类误用，改为 `surface-card`。

同步把 `ui-kit Card` / `SettingsCard` / dock `.dock-card` / github / npm / finance / hippomemo 的
卡片底色从 `bg-layer-2` 切到 `bg-surface-l1`。

连带修掉一处同源缺陷：财务「按模型成本」表格的**斑马纹与卡面都取 layer-1**，条纹 1.00:1 完全不可见 ——
现在卡面 `surface-l1`、奇偶行 `layer-2`，条纹可辨（亮 1.08 / 暗 1.06），并已进闸门。

---

## 7. P2：`--dsw-*` 桥接不完整 —— 预览与宿主两套渲染

`dsw-bridge.css` 只映射了当时用到的子集，其余在**真实宿主**里由 DSH `design-platform.css` 提供、
在**零 dsh 预览**里为空。后果分两种：

**A. 无 fallback → 属性直接失效**（7 处）

| 位置 | Token | 实际后果 |
| --- | --- | --- |
| `FinanceAuditSection` `.balanceRowFill` / `.progressFill` | `--dsw-static-deepseek-500/400` | `linear-gradient()` 整条无效 → **进度条 / 余额条完全消失** |
| `FinanceAuditSection` `.trendTipDate` / `.trendTipCost` | `--dsw-static-neutral-bluish-300/00` | `fill` 失效 → tooltip 文字回落黑色，压在深色板上 |
| `FinanceAuditSection` `.hodDayDivider` / `.trendGuide` / `.trendTip` | `--dsw-alias-border-l3` / `--dsw-alias-tooltip-bg` | 分隔线、tooltip 板消失 |
| `FinanceCard` `.providerCard` | `--dsw-alias-surface-l1` | `background` 回落透明 → 供应商卡片没有卡面 |

**B. 有写死 fallback → 暗色不跟随**（12 处）
`--dsw-alias-feedback-info-fg` 的 fallback `#1e3a8a`、`--dsw-alias-feedback-warning-fg` 的 `#b45309`、
`--dsw-static-deepseek-700` 等，都是"亮色写死"值；暗色主题下这些名字一旦缺失就用它们，深字压深底。
财务的四个来源胶囊里，`user-config` / `ledger-observed` 更是直接写死 `#6b21a8` / `#334155` —— **暗色下必然读不清**。

**修复**：桥接段补全为**完备**映射（`--dsw-alias-surface-l1` / `-surface-float` / `-tooltip-bg` /
`-border-l3` / `-border-l4` / `-label-caption` / `-label-error` / `-state-error-content` /
`-feedback-*` / `-interactive-bg-hover-accent` / `-font-mono` / `-bg-layer-0` / `--dsw-static-deepseek-*` /
`-warning-*` / `-neutral-bluish-*` / `-amber-500` …），并把静态色板一律指向 `--spk-*` 语义 token。
财务的来源胶囊 / 状态点 / 弹窗描边改走 `--spk-acc-*-fg`、`--spk-success/warn/error`。

**不变量已加闸**：`auditTokenCoverage()` 扫描 `packages/**` 里每个 `var(--dsw-…)` / `var(--spk-…)`，
未桥接的 `--dsw-*` 直接判失败（`contrast.spec.ts` 里断言为空）。

---

## 8. P2：终端块借用会翻主题的语义色

`TerminalBlock` 的底色在**两个主题里都是深色**（亮 `#171c27` / 暗 `#0d1117`），但字色用的是
`--spk-error` / `--spk-success` / `--spk-n-500` 这些随主题翻转的 token：

| 行类型 | 亮色主题实测（底 `#171c27`） | 修复后 |
| --- | --- | --- |
| `.error` | `#dc2626` = **3.53:1** | `--spk-term-error #f87171` → 6.16（暗色底更低，仍 6.84） |
| `.dim` / `.bar em` | `--spk-n-500` = **3.43:1** | `--spk-term-dim #949dae` → 6.25 / 6.93 |
| `.prompt` / `.cursor` | `#4d6bfe` = 3.94:1 | `--spk-term-prompt #93a8ff` → 7.54 / 8.37 |

**修复**：新增与主题解耦的 `--spk-term-fg / -dim / -ok / -warn / -error / -prompt`（外加 `--spk-tooltip-*`），
终端块与财务 tooltip 一律改用它们。这是"**深底组件不能消费会翻主题的语义色**"这条规则的落地。

---

## 9. P2：图表补充色过浅 + `var()` 写在 SVG 属性上

`CHART_PALETTE[5..7]` 是写死 hex：`#14b8a6`（白底 **2.49:1**）、`#e879f9`（**2.46:1**）、`#64748b`（4.8:1）。
图表是图形对象，AA 要求 3:1。**修复**：改为 `--spk-chart-alt-1/2/3`（亮 `#0f766e` / `#a21caf` / `#64748b`，
暗 `#5eead4` / `#f0abfc` / `#94a3b8`），随主题切换。

同时修掉一类更隐蔽的写法问题：**把 `var()` 写进 SVG presentation attribute**。
`stroke={sliceColor(...)}` / `fill="var(--...)"` / `stopColor={color}` 这类写法在浏览器里的解析
不受保证（W3C SVG WG 至今仍有 open issue 在澄清 `var()` 是否允许出现在 presentation attribute 里：
[#987](https://github.com/w3c/svgwg/issues/987)、[#1031](https://lists.w3.org/Archives/Public/public-svg-issues/2025Nov/0024.html)），
Chromium 侧不解析 —— 一旦不生效，扇区描边 / 图谱连线 / 呆毛腮红会整片掉色（回落到 `fill: black` 或 `none`）。
已全部改为内联 `style={{ fill / stroke / stopColor: ... }}`，这是**一定**会走自定义属性替换的通道。
涉及：`Charts.tsx`（环图扇区、趋势渐变 stop）、`Sparkline.tsx`（渐变 stop、折线、末点）、
`SparkSection.tsx`（图谱连线 / 节点 / 节点字）、`FairyFace.tsx`（呆毛 / 腮红 / 思考泡）。

---

## 10. 其它已修的点

- `ListRow.archived` 与 dock `.dock-row.off`：`opacity: .55` → `label-3` + 删除线。
- `SparkSection` 图谱节点圆圈上的白字改 `--dsw-alias-label-primary-foreground`（暗色亮蓝底需要深字）。
- `SparkSection` 步骤备注 `opacity: .6` → `label-tertiary`。
- hippomemo：`opacity: .7/.8` 弱化（进化条目 id、spark id）→ token；`--ds-font-family-code` → `--dsw-alias-font-mono`；
  选中芯片 `color: bg-layer-2` → `label-primary-foreground`；紫色标签文字改文字态档。
- 删掉 `MemorySection.tsx` 里写死亮色、且**已无引用**的 `BRAIN_REGION_TONE` 常量。
- 全部 focus 描边统一到 `--spk-focus-ring`（`ui-kit` 8 个组件 + hippomemo + finance）。
- 输入框默认描边从 `border` 提到 `border-2`（在"底色几乎等于卡面"的前提下，控件轮廓几乎全靠描边）。
- `--acc-*` 全部迁到 `--spk-acc-*`（dock `modules.tsx`、`FairyFace.tsx`、finance hero 渐变）。

---

## 11. 回归保障

```bash
pnpm check:contrast      # ① 142 项对比度配对 ② token 完整性 ③ 文档色值 ④ 设计稿↔产品逐值一致
npx vitest run scripts/tests/contrast.spec.ts   # 同口径，153 项断言，进 CI 常规测试
pnpm test                # 根 253 用例（含本闸门）+ finance 153 + finance-client 131 …
pnpm preview:verify      # 56 项预览自检
```

`scripts/audit-contrast.mjs` 的四道检查：

1. **对比度**：解析 `spark-tokens.css` 的 `body` / `body[data-theme=light]` / `body[data-ds-dark-theme]` 三层，
   递归解 `var()` 链与 fallback，支持 `color-mix(... p%, transparent)` 与 `opacity` 合成；
   配对表带 `min`（4.5 / 3.0 / 1.05）与 `soft` 标记（`soft` 只打印不判失败，用于留档反例）。
2. **token 完整性**：扫描 `packages/**/*.{css,ts,tsx}`（硬失效 = 失败，静态 fallback = 警告）。
3. **文档色值**：`design-system/<family>/MASTER.md` 里出现的每个 hex 必须在**该家族**的 token 文件里
   （找得到才算，找不到 = 文档自造颜色）。
4. **设计稿一致性**：`docs/spark-dock-preview/css/tokens.css` 的 32 个语义 token 与产品 bridge 解析值
   逐一比对（按 RGBA 数值，容差 0.5/255）。

> 说明：闸门是**静态 token 计算**，不是浏览器取色。它覆盖"设计系统里定义了哪些组合"，
> 不覆盖浏览器默认控件（如原生 checkbox 的 `accent-color`）与 UA 样式。

---

## 12. 决策记录与未修项

### 12.1 定调：冷灰 + DSH 品牌蓝（2026-09-07 已拍板）

原来有**两份互相打架的视觉源**：

| 来源 | 内容 | 处置 |
| --- | --- | --- |
| `packages/dsh-ui-kit/src/styles/spark-tokens.css` + 全部插件代码 | 冷灰骨架 + DSH 品牌蓝 | ✅ **定为唯一视觉源** |
| `docs/spark-dock-preview/*` 静态设计稿 | 冷灰 + `#4d6bfe`（本来就对） | ✅ 保留，补齐语义 token 与产品逐值对齐 |
| `design-system/spark-dock/MASTER.md` | 暖炭 + 火花琥珀 `#f59e0b` 主品牌 | ❌ 废弃，已按代码重写为 v4 口径 |

落地动作：

1. **`design-system/spark-dock/MASTER.md` 重写**（v4）：唯一源指向 `spark-tokens.css`；
   面层次 / 品牌双角色 / accent 两档 / 固定深底 token / 文字与描边全部与代码一一对应；
   变更记录里明确「v2 暖炭方案已废弃」，暖炭色板只留档于 `docs/ui-kit-backup-20260907/`（冻结快照，不再维护）。
2. **静态设计稿补齐并对齐** `docs/spark-dock-preview/css/tokens.css`：原先它只带一小撮语义 token，
   且把「**始终深色**面板」和「随主题翻转的 layer token」混用 —— 亮色主题下 `--dsw-alias-label-primary-foreground`
   = `#ffffff` 撞上 `bg-layer-1` = `#f6f7f9`，出现**白字压白卡**。现在：
   - 面板跟随主题（`bg-module-platform` = 产品的 `--spk-platform`），与产品一致；
   - 补全 `surface-l1` / `surface-float` / `brand-foreground` / `border-l3·l4` / `label-dimmed` / `label-error` /
     `state-*-tint` 等语义槽位；
   - 正文里误用 `label-primary-foreground`（那是"饱和实底上的标签色"）的 17 处改为 `label-primary`，
     只保留 badge / 主按钮 / 品牌实底气泡 / 节点字 4 类正确用法；
   - 卡片改 `surface-l1`（`bg-layer-1` 在暗色比面板更深，是凹陷方向）；
   - accent 拆两档，SVG 颜色从 presentation attribute 改内联 `style`。
3. **加两道防漂移闸门**（这才是"唯一视觉源"能长期成立的原因）：
   - `auditDesignDocs()` —— Source of Truth 文档里出现的每个 hex 都必须存在于该家族的 token 层；
   - `auditPreviewParity()` —— 静态设计稿的 32 个语义 token 必须与产品**逐值相等**（色值按 RGBA 数值比对）。
   两条都在 `pnpm check:contrast` 与 `contrast.spec.ts` 里，漂移即红。

> 至此"文档写一套、代码跑另一套"这类漂移不会再发生：改 token 而忘了改文档/设计稿 → 闸门失败。

### 12.2 其余未修项（需要决策或超出本次范围）

1. **`docs/demo.html`、`README.md` 的 UI 预览截图**：截图是位图，本次无法重新生成；
   `docs/screenshots/plugins-ui.png` 与 `docs/spark-dock-*.png` 反映的是改色前的渲染，
   需要重新截一次（用 `pnpm preview` 走查后替换）。
2. **控件边界 3:1 的取舍**：输入框/次级按钮描边目前 1.68:1（信息项，已列在 `soft` 里）。
   要真正做到 1.4.11 的 3:1，描边需要 `#8a93a0` 量级（白底 3.11:1）—— 视觉会明显变重。
   当前选择是"底色差 + 标签 + 1px 描边"三重线索，**建议保持并记录为已知取舍**。
3. **原生 checkbox 的 `accent-color`**：暗色下 UA 画的是白勾压 `#6d85fe`（3.26:1，非文本刚好达标），
   但与我们"暗色实底配深字"的规则不一致；彻底解决需要自绘 checkbox。
4. **财务面板的图表色常量**：`FinanceAuditSection.tsx` 里 `PEAK_COLOR #f59e0b`、`OFFPEAK_COLOR #4176e6`、
   `FLAT_COLOR #64748b`、`LEGACY_COLOR #94a3b8`、`PLAN_COLOR #a855f7` 仍是写死亮色值。
   白底最浅的 `#94a3b8` 只有 2.56:1（图形对象要求 3:1），暗色下偏暗。
   建议后续迁到 `--spk-chart-*` 系列（本次未动，避免改动被 `finance-client` 渲染断言覆盖的细节）。
5. **未消费 token**：`--spk-contrast-fill` / `--spk-surface` / `--spk-surface-solid` / `--spk-surface-2` /
   `--spk-blur` / `--spk-glow` / `--spk-text-3xl` 在 `packages/**` 里没有任何消费点（只有定义与文档引用）。
   其中 `--spk-contrast-fill` 对应 MASTER.md §5 规则 1 的「对比钮」—— 该组件**一直没有实现**。
   建议下一轮要么补消费点、要么连同文档一起清掉。
6. **sparkie 家族未纳入文档校验**：`design-system/sparkie/MASTER.md` 的角色层色板
   （Claymorphism 皮肤 + 情绪态）只有 `docs/sparkie-preview/css/tokens.css` 一份取值，
   尚未收进可校验的 token 层；已把其中"业务页暖炭"的表述改为冷灰，其余待收敛后再纳入闸门。
