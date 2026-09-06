# Spark Dock — Master Design System

> 唯一视觉源（Source of Truth）。2026-09 起 dsh-ui-kit 不再镜像 DSH（--dsw-*），
> 独立悬浮球入口使用本设计语言。`--spk-*` 为源 token，`spark-tokens.css` 末尾
> bridge 段把历史 `--dsw-*` 全量重定向（DeepSeek 蓝一律切断 → 火花琥珀）。

## 1. 调性

暖炭 · 火光 · 玻璃。一个有温度的认知伴侣，不是开发工具面板。
克制动画（呼吸/浮动/微交互），mood 驱动的状态染色，尊重 prefers-reduced-motion。

## 2. 色彩

### Primitives（--spk-n-*，暖中性阶，黄相）
`#faf9f6 → #14120f`（冷蓝中性阶废除）。火花琥珀阶 `--spk-spark-50…900`（主 500 `#f59e0b`）。

### 语义（Light = 暖纸 / Dark = 暖炭）
| Token | Dark | Light |
|---|---|---|
| `--spk-bg` | `#14120f` | `#faf9f6` |
| `--spk-surface` | `#1d1a16` | `#ffffff` |
| `--spk-surface-2 / 3` | `#28241e / #343028` | `#f4f1ea / #ebe6db` |
| `--spk-label / 2 / 3` | `#f5f1e8 / #c8c0ae / #8a8172` | `#1d1a16 / #5d564a / #8a8172` |
| `--spk-border / 2 / 3` | 白 9% / 16% / 26% | `#e8e2d4 / #dbd3c1 / #c8c0ae` |
| `--spk-brand / hover / on-brand` | `#f59e0b / #fbbf24 / #201a0c` | `#f59e0b / #d97706 / #201a0c` |
| `--spk-glass-bg / border` | 暖炭 72% / 白 12% | 纸白 78% / 黑 10% |

状态：success `#22c55e` · warn `#f59e0b` · error dark `#ef4444` / light `#dc2626`，各配 `-soft`（color-mix 11-18%）。

### 模块 accent（--spk-acc-*）
spark `#f59e0b` · hippomemo `#3b82f6` · finance `#22c55e` · github `#8b5cf6` · npm `#e0533f`（暖化 npm 红）。

## 3. 字体

- 正文：`--spk-font`（PingFang SC / SF Pro Text / Noto Sans SC 栈）
- 代码：`--spk-font-mono`（SF Mono / JetBrains Mono）
- 字号阶：`--spk-text-2xs 10 · xs 11 · sm 12 · md 13 · lg 15 · xl 17 · 2xl 22`

## 4. 形状 / 阴影 / 动效

- 圆角：`--spk-radius-sm 7 · md 10 · lg 14 · xl 20 · full`
- 阴影：暖褐底色（`rgba(43,36,22,…)`），dark 下 1/2/3 级
- 玻璃：`--spk-glass-bg` + `backdrop-filter: blur(var(--spk-blur, 16px))`（悬浮球/浮层/Modal 专用）
- 动效：`--spk-ease-out`（进出场）/ `--spk-ease-spring`（开合弹跳）；dur fast 120 / med 220 / slow 320；全部动画须有 reduced-motion 降级

## 5. 组件规则（既有 chrome 一律经由 bridge 重指向，不逐文件改写）

1. 品牌填充钮 = `--spk-brand` + `--spk-on-brand` 文字；对比钮 = `--spk-contrast-fill`
2. focus ring 一律 `--spk-focus`，禁移除
3. 错误信息 `role=alert`，惰性状态 `role=status`
4. 触控热区 ≥ 44px（视觉可小于，命中区 `::before` 扩容）
5. SVG 图标，禁止字符/emoji 图标
6. mood 染色模式：单一 `--ball-glow`/accent 变量驱动渐变/边框/halo/投影

## 6. 迁移路径

- **阶段 1（已完成）**：spark-tokens.css bridge 全量覆盖，产品即刻换肤
- **阶段 2（渐进）**：各组件 module.css 逐个把 `var(--dsw-*)` 改写为 `var(--spk-*)` 直连；bridge 保留至全部迁完
- **阶段 3**：删除 design-platform.css（DSH Figma 镜像），bridge 段收编进 spark-tokens.css
