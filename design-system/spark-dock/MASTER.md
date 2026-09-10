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

## 6. 验收（自动化，非目测）

```bash
pnpm check:contrast   # ① 142 项对比度配对（AA 正文 4.5 / 非文本 3.0）
                      # ② token 完整性（插件 CSS 不得引用未桥接的 --dsw-* / 未定义的 --spk-*）
                      # ③ 本文不许自造颜色（色值必须来自 token 层）
                      # ④ 静态设计稿 docs/spark-dock-preview 的语义值必须与产品逐值一致
pnpm test             # 含 scripts/tests/contrast.spec.ts 153 项断言
```

## 7. 变更记录

- **v4（2026-09-07）定调「冷灰 + DSH 品牌蓝」**；废弃「暖炭 + 琥珀」方案。
  同时：品牌/accent 拆角色档、面层次分 `platform < card < float`、终端块与主题解耦、
  语义色按 AA 重定、移除文字 `opacity` 弱化、SVG 颜色改走内联 style。
  完整问题清单与实测对比度见 [docs/ui-theme-contrast-review-2026-09-07.md](../../docs/ui-theme-contrast-review-2026-09-07.md)。
- **v3**：`--spk-*` 成为源 token，bridge 段把历史 `--dsw-*` 全量重定向。
- **v2（已废弃）**：暖炭 + 火花琥珀 `#f59e0b` 主品牌。仅留档于
  `docs/ui-kit-backup-20260907/`（冻结快照，不再维护）。
