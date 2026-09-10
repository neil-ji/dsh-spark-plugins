# Spark Dock — Master Design System (v4)

> **唯一视觉源**：`packages/dsh-ui-kit/src/styles/spark-tokens.css`
> （本文是它的说明与规则；token 值以该文件为准，本文表格与之一一对应）。
>
> **定调（2026-09-07 拍板）**：中性**冷灰骨架 + DSH 品牌蓝 `#4d6bfe`**。克制、原生、无撞色。
> 早前版本的「暖炭 + 火花琥珀 `#f59e0b`」方案**已废弃**（见 §7 变更记录）；
> `#f59e0b` 只作为「火花」模块的 accent 保留，不再承担品牌角色。
>
> **可回归**：本文出现的每个色值都必须存在于 token 层，`pnpm check:contrast` 会校验
> （`auditDesignDoc()`：文档里不许出现 token 层没有的颜色）；对比度由同一脚本按 WCAG 2.1 AA 守住。

## 1. 调性

冷静、骨感、信息密度大 —— 它是开发工具的一部分，不是玩具面板。
暖意只由「火花」模块的琥珀 accent 与悬浮球角色层承担，主体骨架保持冷灰。
玻璃只用于浮层（悬浮球 / 面板 / Modal），不做装饰性渐变。

## 2. 色彩

### 2.1 Primitives（中性冷灰阶 `--spk-n-*`，与 `--dsw-alias` 灰阶对齐）

`#ffffff → #0b0e14`：`n-0 #ffffff · n-50 #f6f7f9 · n-100 #edeff3 · n-150 #e4e7ec ·
n-200 #d4d8df · n-300 #b3b9c4 · n-400 #868ea0 · n-500 #667085 · n-600 #5b6270 ·
n-700 #40485a · n-800 #2d3749 · n-850 #232b3a · n-900 #171c27 · n-950 #0b0e14`

### 2.2 品牌蓝阶（DSH `#4d6bfe` 为 identity primitive）

`--spk-spark-100 #dfe5ff · 300 #93a8ff · 400 #6d85fe · 500 #4d6bfe · 600 #3d5af0 · 700 #2f46c8 · 800 #24379c`

> `#4d6bfe` 相对亮度 0.193，**卡在中间**：配白字 4.33:1、当文字也在 4.33:1，两个角色都不达 AA。
> 因此 primitive 只作身份色，**语义层按角色分档**（§2.3 / §2.4）。

### 2.3 语义面（Light / Dark）

| Token | Light | Dark | 角色 |
| --- | --- | --- | --- |
| `--spk-bg` | `#f6f7f9` | `#0b0e14` | 应用底 |
| `--spk-platform` | `#eef0f4` | `#161b26` | 面板 / 页面骨架 |
| `--spk-surface-card` | `#ffffff` | `#1b212c` | **卡片抬起面**（radius 12 + border） |
| `--spk-surface-float` | `#ffffff` | `#222a37` | 浮层：Menu / Modal / Toast |
| `--spk-layer-1` | `#ffffff` | `#10141d` | 一层填充 |
| `--spk-layer-2` | `#f4f6fa` | `#171c27` | **凹陷 / 轨道**（输入底、进度轨道、图表 track、表格斑马纹） |

层次不变量：`bg < platform < surface-card < surface-float`，且 `layer-2` 是**凹陷**方向、
`surface-*` 是**抬起**方向 —— 二者不可互换（v3 用同一个 `layer-2` 兼两种语义，导致亮暗两态
卡片与面板都只差 1.01:1，视觉上"一坨"）。

### 2.4 文字与描边

| Token | Light | Dark | AA |
| --- | --- | --- | --- |
| `--spk-label` | `#1a1d24` | `#e8eaf0` | 正文（≥15:1） |
| `--spk-label-2` | `#525b6b` | `#9aa1af` | 次要正文 |
| `--spk-label-3` | `#5f6a7d` | `#868ea0` | 元信息 / placeholder |
| `--spk-border` | `#d9dee6` | `#232b3a` | 分隔线 |
| `--spk-border-2` | `#c1c8d4` | `#2d3749` | 控件描边（默认档） |
| `--spk-seg-thumb` | `#ffffff` | `#2b3444` | 分段控件滑块（抬起面） |
| `--spk-focus-ring` | `#3d5af0` | `#93a8ff` | 焦点描边（≥3:1 非文本） |

### 2.5 品牌 / accent / 状态

| 角色 | Token | Light | Dark |
| --- | --- | --- | --- |
| 品牌实底 | `--spk-brand` | `#3d5af0` | `#6d85fe` |
| 品牌 hover | `--spk-brand-hover` | `#2f46c8` | `#93a8ff` |
| 品牌**文字/图标** | `--spk-brand-fg` | `#2f46c8` | `#93a8ff` |
| 实底上的标签 | `--spk-contrast-fill-label`（= `--spk-on-brand` / `--spk-on-accent` / `--spk-on-error`） | `#ffffff` | `#171c27` |
| 成功 | `--spk-success` | `#166534` | `#4ade80` |
| 警告 | `--spk-warn` | `#9a3412` | `#fbbf24` |
| 错误 | `--spk-error` | `#c62828` | `#f87171` |
| 信息 | `--spk-info` | `#1c64b0` | `#7cc4ff` |

**实底上的标签色随主题翻**：亮色实底是深色 → 白字；暗色实底是亮色 → 深字。
写死 `#fff` 会在暗色主题上翻车（`#6d85fe` + 白 = 3.26:1）。

### 2.6 模块 accent（五模块）

每个模块有**两档**：实色档用于图形对象（图表填充 / 指示条 / 圆点，需 ≥3:1），
文字态档用于图标 / 胶囊文字 / 实底芯片底色（需 ≥4.5:1）。**不可互串**。

| 模块 | 实色 Light | 实色 Dark | 文字态 Light | 文字态 Dark |
| --- | --- | --- | --- | --- |
| 火花 spark | `#d97706` | `#f59e0b` | `#92400e` | `#fbbf24` |
| 记忆 hippomemo | `#3b82f6` | `#60a5fa` | `#1d4ed8` | `#8ab8fd` |
| 成本 finance | `#16a34a` | `#4ade80` | `#166534` | `#6ee7a0` |
| GitHub | `#8b5cf6` | `#a78bfa` | `#5b21b6` | `#bda6fb` |
| npm | `#cb3837` | `#f87171` | `#991b1b` | `#f8a1a1` |

图表补充色（第 6-8 系列）：`--spk-chart-alt-1/2/3` = 亮 `#0f766e / #a21caf / #64748b`，
暗 `#5eead4 / #f0abfc / #94a3b8`。

### 2.7 与主题解耦的固定面（深底组件专用）

终端块与 tooltip 板**在两个主题里都是深色**，因此不能消费会翻主题的语义色：

`--spk-terminal-bg` 亮 `#171c27` / 暗 `#0d1117`；`--spk-term-fg #dde3ec` · `--spk-term-dim #949dae` ·
`--spk-term-ok #4ade80` · `--spk-term-warn #fbbf24` · `--spk-term-error #f87171` · `--spk-term-prompt #93a8ff`；
`--spk-tooltip-bg #232b3a` · `--spk-tooltip-fg #f2f5f9` · `--spk-tooltip-fg-dim #aab3c2`。

## 3. 字体

- 正文：`--spk-font`（PingFang SC / SF Pro Text / Segoe UI / Noto Sans SC 栈）
- 代码：`--spk-font-mono`（SF Mono / JetBrains Mono）
- 字号阶：`--spk-text-xs 11 · sm 12 · md 13 · lg 15 · xl 17 · 2xl 22 · 3xl 30`
  （标度口径：10 tag · 11 meta · 12 body-minor · 13 body · 14 卡片题 · 18 页面题）

## 4. 形状 / 阴影 / 动效

- 圆角：`--spk-radius-sm 7 · md 10 · lg 14 · xl 20 · full`；控件内 6 / 输入类 8 / 分段条·行 10 / 卡片 12
- 阴影：亮 `rgba(10,18,38,…)`、暗 `rgba(0,0,0,…)`；`--spk-shadow-1/2/float`
- 玻璃：`--spk-blur 16px` + `backdrop-filter`（悬浮球 / 浮层 / Modal 专用）
- 动效：`--spk-ease-out`（进出场）/ `--spk-ease-spring`（开合弹跳）；dur fast 120 / med 220 / slow 320；
  全部动画须有 reduced-motion 降级（`styles/base.css` 已全局兜底）

### 4.1 悬浮球（v4.1 静默形态）

它是全站唯一的常驻浮层控件，调性必须比面板更冷：**读作「一颗玻璃透镜上的品牌标识」，
不是吉祥物，也不是会呼吸的按钮。**

| 维度 | 规格 |
| --- | --- |
| 尺寸 | 48px 圆（`--dock-ball`），触控 ≥ 44px 不变 |
| 球身 | `--spk-surface-float` @ 92%（半透明玻璃）+ `backdrop-filter: blur(--spk-blur) saturate(1.3)` |
| 受光 | 顶部白光 13% → 46% 处 3% → 透明；顶部径向品牌染光 12%（124% 半径，自 50% 2% 起） |
| 描边 | 1px `--spk-border-2`（冷灰）+ 内壁亮线 `inset 0 1px 0 --spk-n-0 @18%` |
| 投影 | `--spk-shadow-2` + 品牌外发光（rest 24px @15% / hover 28px @26% / 展开 30px @24%） |
| 标识 | ui-kit `IconSparkles`（22px，由 `.dock-ball svg` 接管尺寸），色 = `--spk-brand-fg` |
| 身份变量 | `--ball-accent`（默认 `--spk-brand`）单点驱动染光 / hover 描边 / 外发光 |

状态（**一律不动几何**）：

| 状态 | 表现 |
| --- | --- |
| rest | 描边 `--spk-border-2`，外发光 15% |
| hover | 描边 = 品牌 46% 混 `--spk-border-2`，外发光 26% |
| active | `--spk-shadow-1` + 内阴影（读作「按下去」） |
| dragging | 光标 grabbing + 品牌描边（无缩放） |
| `[aria-expanded=true]` | 描边 = `--ball-accent` 实色，外发光 24%（读作「已激活」） |
| `:focus-visible` | `--spk-focus-ring` 2px + offset 3px（≥3:1，禁移除） |

硬约束（`pnpm check:contrast` §J 组守住）：

1. **球体不得有持续动画**：无 keyframes、无呼吸、无 hover 缩放/弹簧过渡。状态差异只走
   描边色 / 投影 / 表面亮度 —— 静态即可区分，靠动效吸引注意是玩具感的主要来源。
2. 标识色**必须**是 `--spk-brand-fg`（亮 7.34:1 / 暗 6.49:1 on 球面）；实色档 `--spk-brand`
   在暗色下只有 4.50:1，正好压在 AA 线上，不得用于标识。
3. 球身与面板底需可辨（≥1.05，实测亮 1.13 / 暗 1.18）；1px 描边不承担唯一线索
   （另有投影 + 内壁亮线，故描边本身按参考档留档）。

**角色层拆成两个独立开关**（`DockOverlay.tsx`）：

| 开关 | 现值 | 管什么 |
| --- | --- | --- |
| `BALL_FACE_ENABLED` | `false` | Fairy 表情（呆毛/眼/嘴/腮红）、情绪染光、球体动画（浮动、呆毛摆动、张嘴闪烁、hover 缩放） |
| `BALL_BUBBLE_ENABLED` | `true` | **事件播报气泡** —— 真实事件文本，无 emoji、无动画，与表情无关 |

任一开启即订阅 Fairy 事件流（都关则不开 SSE）；表情关闭时 mood 被丢弃、不影响气泡。

### 4.2 播报气泡（「发言」）

球旁一句话的能力：后台出现真实事件时，球旁边弹出一条文本提示，4.2s 后自动消失。

| 维度 | 规格 |
| --- | --- |
| 数据链路 | `/sparks/events`（SSE，共享引用计数注册表 `streams.ts`）→ `operation: capture \| crystallize` → `announce()`（同文本 4s 去重）→ `useFairy` → 气泡 |
| 材质 | 与 ui-kit `Toast` 同款浮层：`--spk-surface-float` + 1px `--spk-border` + `--spk-shadow-2` + 12 圆角 + 左侧 3px `--spk-brand` 脊线（`mood-alert` 时脊线转 `--spk-warn`） |
| 文字 | 正文 `--spk-label` 12px/500；来源行 `--spk-label-2` 11px/400。**来源行禁用 `--spk-label-3`**（暗色浮层面上只有 4.39:1，不达 AA） |
| 宽度 | `width: max-content` + `max-width: min(250px, 100vw - 24px)`。**必须钉 max-content**：气泡是 shrink-to-fit 的 fixed 元素，不钉宽度时其「静态位置」若贴视口右侧，可用宽度只剩 ~60px，文案折成五行竖条，定位 JS 量到的 `offsetWidth` 也随之偏小、`left` 再被错误夹取（实测 72×91 → 修正后 100×57） |
| 定位 | 球上方居中（gap 12px），贴顶翻到球下方，左右夹取视口（`m = 12`） |
| 动效 | 零（无 transition / keyframes），出现与消失瞬时 |
| 语义 | `role="status"` + `aria-live="polite"`（MASTER §5.8 惰性状态），屏幕阅读器能听到播报 |
| 事件覆盖 | 现状只有火花流两种 op。proposals / hippomemo / github / npm 的播报是**未实现**（早前把 reflect/resolve 分支判定为死代码后裁掉），要做属于新增 |

硬约束（`pnpm check:contrast` §J 组守住）：气泡正文 4.5、来源行 4.5、品牌脊线（非文本）3.0。

## 5. 组件规则

1. 品牌实底钮 = `--spk-brand` + `--spk-on-brand`；危险钮 = `--spk-error` + `--spk-on-error`
2. 模块 accent 只经 `--spk-acc-<m>`（图形）/ `--spk-acc-<m>-fg`（文字）两档消费，禁止直接写 hex
3. focus ring 一律 `--spk-focus-ring`（≥3:1），禁移除
4. Tab 一律 ui-kit `SegmentedControl`（面板页签用 `fullWidth`），禁止自绘；折叠一律 ui-kit `Disclosure`
5. 图标一律 `dsh-ui-kit` IconXxx（lucide），禁止字符 / emoji 图标
6. 第三层级靠 **token 档位 + 字号/字重**，**禁止用 `opacity` 冲淡文字**（会把已算好的对比度再打七折）
7. 颜色进 SVG 必须走**内联 style**（`style={{ fill / stroke / stopColor }}`），
   不写 presentation attribute —— 属性里的 `var()` 解析不受保证（W3C SVGWG #987 / #1031）
8. 错误信息 `role=alert`，惰性状态 `role=status`；触控热区 ≥ 44px（视觉可小，`::before` 扩容）
9. **分组一律 ui-kit `Card`**：一个功能分组 = 一张 Card，分组标题写在**该 Card 的 `title`** 上，
   状态/动作走 `actions`。禁止「页级 `<h2>` + 若干无边框分组」的旧形制（三层 chrome）。
10. **间距只引用语义令牌**：卡片之间 / 页头→内容 = `--spk-gap-page`（12），卡片内部行距 =
    `--spk-pad-card`/`--spk-gap-card`（12 14 / 8），基础档 = `--spk-space-1..4`（4/8/12/16）。
    面板 CSS 里不得再写 6/10/14 这类近似字面量 —— 这是「五插件边距一致」的唯一真相来源。
11. **字段一律纵向堆叠**（标签在上、控件在下）。横排「标签 + 控件 + 单位」在 dock 的窄面板
    （616px 面板 → 内容区 ~486px，窄窗口更小）里会把输入压成几十像素。
12. **控件类名必须落到包装壳**：`ui-kit` 的 `Input`/`Textarea` 会把调用方 `className` 同时
    作用在外层 `.field` 包装和控件本身。布局类（`flex`/`min-width`/`width`）只有落在包装上才
    生效 —— 包装才是 flex 行的子项。只落在 `<input>` 上时 `flex: 1` 完全失效（输入被钉在固有
    宽度 ~170px），窄容器里控件的 `min-width` 还会溢出包装、压到相邻按钮。
13. **插件显示名规范**：认知层三件套 = 「中文名 + 英文产品名」（火花 Spark / 记忆 HippoMemo /
    财务 Finance）；连接器 = 产品名的规范拼写本身（GitHub / npm）。`en` 字典只写产品名。
14. **文本不许跨层重复**（2026-09 重构二轮，标准样板 = hippomemo「进化」页）：
    - 模块头（`.dock-head .name/.sub`）已经说了这一页是什么 → **子页里不得再出现同名标题**；
      内嵌页的页级 `h2 + intro` 由组件自己的 `embedded` 属性**不渲染**（`MemorySection` /
      `FinanceAuditSection`），**不许**用 compat CSS `display:none` 擦掉（那只是把重复藏起来，
      DOM 里仍是同名两层，读屏与标题导航照样撞车）；
    - 同一段文本在同页只能占一个语义位：卡头（组的名字）/ 卡内小标题（组内的分段）/ 字段标签 /
      行内元信息。**卡头与卡内小标题同名 = 违规**（如旧进化页的「LLM 复核 / 动作」既在 meta
      计数又在卡内当分组标题）；
    - 计数只在**一个**位置出现（卡头的 `actions` 或元信息，二选一）。
    机器判据：`pnpm preview:titles`（V1 卡头撞模块名 / V2 卡头撞卡内小标题 / V3 两张卡同名，
    退出码即结论）。

## 6. 验收（自动化，非目测）

```bash
pnpm check:contrast   # ① 142 项对比度配对（AA 正文 4.5 / 非文本 3.0）
                      # ② token 完整性（插件 CSS 不得引用未桥接的 --dsw-* / 未定义的 --spk-*）
                      # ③ 本文不许自造颜色（色值必须来自 token 层）
                      # ④ 静态设计稿 docs/spark-dock-preview 的语义值必须与产品逐值一致
pnpm test             # 含 scripts/tests/contrast.spec.ts 153 项断言
node dev-harness/preview/dom-audit.mjs   # ⑤ 真渲染盒模型走查：重叠 / 横向溢出 / 折行必须为 0
                                         #    （先起 pnpm preview；--width / --module / --rects 可定点排查）
pnpm preview:titles                      # ⑥ 子页标题层级走查：V1/V2/V2b/V3 四类重复必须为 0
                                         #    默认逐页走 5 模块 16 个目标（含内层页签）
                                         #    --module 定点；--json 出机器可读报告；--html dump 真实 DOM
```

## 7. 变更记录

- **v4.5（2026-09-10）财务保存行：从「跨页签常驻吸底」改成「各页签内容末尾」**：
  旧形制是 `position: sticky; bottom: 0` 的共享底栏 —— 浮在滚动内容之上，且纯展示的总览页
  也挂着它（读起来像"展示页也要保存"）。现在保存行是各页签内容列的末尾元素、在文档流里
  （实测四页 `position: static`，行底 == 面板内容底）。draft 仍跨页签共享，按钮可用性仍由
  `state.dirty` 驱动（只有配置字段会进 `plan()`；视图偏好是即时落 localStorage）。测试
  `card.test.tsx`「puts the save row at the end of each tab panel…」守住这条不变量。

- **v4.4（2026-09-10）进化页自己也按标准收敛（标准不能是例外）**：① 「使用统计」拆成
  `记忆存量`（多少条）与 `用量`（被用得怎么样）两张卡 —— 原来一张卡头叫「使用统计」、卡内首行
  又叫「用量」；② 进化报告的「LLM 复核 / 动作」从「meta 计数 + 卡内分组标题」改成**各一张卡**，
  组名写卡头、数量进卡头状态位（同一段文本原来在一张卡里出现两次）；③ 记忆列表页与偏好页在
  dock 下不再渲染「记忆 HippoMemo / 我的偏好」第二层标题，列表页与偏好区补上卡片 surface；
  ④ 走查脚本补 V2b（同卡内卡头元信息撞卡内小标题）与内层页签遍历（`--tabs`）；
  ⑤ 两个 CDP 走查脚本收尾加 profile 兜底清扫（`taskkill /T` 会漏子进程，实测一轮能堆上百个
  headless Edge；匹配串经环境变量传入，否则 PowerShell 引号被 spawn 吃掉 → 静默漏杀）。

- **v4.3（2026-09-10）dock 五个模块的子页按「进化页形制」重构**：① 卡片统一走 ui-kit `Card`
  （删掉 dock 自绘的 `.dock-card`，卡片头承载组名，筛选项/计数进 `actions`）；② 重复标题从
  「CSS 压掉」改成「不渲染」（hippomemo / finance 的 `embedded`）；③ 脑区面板不再复用页级
  `title`（改 `brainPanelTitle`）；④ npm 的 registry 状态与套件包清单拆成两张卡；⑤ 新增
  `pnpm preview:titles` 让「重复 Title/Label」有机器判据。详见 §5 规则 9 / 14。

- **v4.2（2026-09-10）悬浮球拆出「发言」能力**：角色层一分为二 —— `BALL_FACE_ENABLED=false`
  （表情/染光/动画保持关闭）、`BALL_BUBBLE_ENABLED=true`（事件播报气泡保留：它是真实事件文本，
  既非 emoji 也非动画，不应随表情一起被移除）。同时修掉气泡的两个既有缺陷：① 宽度被静态位置
  压成 ~60px 竖条（改 `width: max-content`，实测 72×91 → 100×57）；② 无播报语义（补
  `role="status"` + `aria-live="polite"`）。材质对齐 ui-kit Toast，来源行从 label-3 提到 label-2
  （label-3 在暗色浮层面上仅 4.39:1）。详见 §4.2。
- **v4.1（2026-09-10）悬浮球静默形态**：移除球的角色层表现 —— 不再渲染 Fairy 表情、
  不再呼吸/上下浮动/张嘴闪烁、不再随情绪染光，hover 不再缩放；球改为玻璃透镜 + 品牌蓝标识
  （`--spk-brand-fg`），身份色从「火花琥珀」回归品牌蓝（v4 已把暖意的角色限定给火花模块 accent
  与角色层，角色层退场后暖色即失去承载者）。同时把球纳入 `pnpm check:contrast` 的 §J 组
  （标识对比度 / focus ring / 球身与面板底层次）。脸与动画的代码全部保留（`FAIRY_LAYER_ENABLED`），
  静态设计稿 `docs/spark-dock-preview/` 仍按角色层完整留档。详见 §4.1。
- **v4（2026-09-07）定调「冷灰 + DSH 品牌蓝」**；废弃「暖炭 + 琥珀」方案。
  同时：品牌/accent 拆角色档、面层次分 `platform < card < float`、终端块与主题解耦、
  语义色按 AA 重定、移除文字 `opacity` 弱化、SVG 颜色改走内联 style。
  完整问题清单与实测对比度见 [docs/ui-theme-contrast-review-2026-09-07.md](../../docs/ui-theme-contrast-review-2026-09-07.md)。
- **v3**：`--spk-*` 成为源 token，bridge 段把历史 `--dsw-*` 全量重定向。
- **v2（已废弃）**：暖炭 + 火花琥珀 `#f59e0b` 主品牌。仅留档于
  `docs/ui-kit-backup-20260907/`（冻结快照，不再维护）。
