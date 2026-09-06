# dsh-ui-kit · Spark UI Kit

从 0 复刻 `docs/spark-ui-kit-demo`（已验收的 Spark 设计语言）的 React 组件库。
**不含任何旧版 dsh-ui-kit 代码**；旧实现备份于 `docs/ui-kit-backup-20260907/` 与 git tag `backup/ui-kit-pre-spark-rewrite-20260907`。

## 主题

消费 `--spk-*` CSS 变量，token 源为 `src/styles/spark-tokens.css`（构建时聚合进 `dsh-ui-kit/tokens.css`）。
主题切换走 `body[data-theme="dark" | "light"]` 属性开关。
五模块 accent：`--spk-acc-spark / --spk-acc-hippomemo / --spk-acc-finance / --spk-acc-github / --spk-acc-npm`。

## 组件

| 导出 | 说明 |
| --- | --- |
| `Button` | 32px 胶囊实心，variant: primary/secondary/ghost/danger，size md/sm，loading |
| `Input` / `Textarea` | label + help + error 行内校验，品牌描边聚焦 |
| `SearchInput` | 前置放大镜搜索框 |
| `Checkbox` | 原生 input + accent-color |
| `Pill` | tone: neutral/brand/success/warn/error，或 `accentColor` 直定模块色 |
| `StateDot` | live/idle/error/neutral 状态点 |
| `SegmentedControl` | layer-2 槽 + platform 滑块 + 弹簧位移 |
| `ListRow` | 整行可点 + 独立 trailing（避免 button-in-button） |
| `Disclosure` | 折叠头，grid-rows 高度动画 + aria-expanded |
| `SettingsCard` / `Stat` / `StatGrid` | 设置卡 + 模块图标方 + badge + 统计小卡 |
| `Modal` | platform 底 / 20px 圆角 / 弹簧缩放 / 焦点陷阱 / Esc |
| `toast` + `Toaster` | 命令式吐司（根部渲染一次 `<Toaster />`） |
| `TerminalBlock` | 深底终端块，tone 着色行 + 光标 |
| `Sparkline` | 渐变填充趋势线，进入视口描线生长，hover 联动 |

## 用法

```tsx
import 'dsh-ui-kit/tokens.css'
import { Button, Pill, toast, Toaster } from 'dsh-ui-kit'

<Button onClick={() => toast.success('已结晶')}>结晶</Button>
<Toaster />
```

peer 依赖：`react ^18.2.0 || ^19.0.0`、`react-dom ^18.2.0 || ^19.0.0`。

## 构建

`pnpm build` — esbuild 单文件 ESM + lightningcss 哈希类名样式自动注入（发布物自带样式）+ `dsh-ui-kit/tokens.css` 聚合 + d.ts。
