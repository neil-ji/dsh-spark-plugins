# dsh-ui-kit

> 🚀 [落地页](https://neil-ji.github.io/dsh-ui-kit/) · 📖 [官方文档](https://neil-ji.github.io/dsh-ui-kit/docs/) · [npm](https://www.npmjs.com/package/dsh-ui-kit) · [GitHub](https://github.com/neil-ji/dsh-ui-kit)

独立发布的 React 组件库，忠实复刻 DeepSeek Harness Web UI 的设计系统与 UI 原子组件：
**tokens、明暗主题、组件样式与官方 `@deepseek-ai/dsh-client-ui-primitives` / `dsh-client-ui-theme` 严格一致**（MIT，零 cordis 依赖）。

- 🎨 **设计系统**：完整 `--dsw-*` token 体系（静态色板 / 语义别名 / 产品专属 / 阴影 / 字体 / shiki 语法高亮）
- 🌗 **明暗主题**：`body[data-ds-dark-theme]` 属性切换，与 DSH 宿主完全同机制
- 🧩 **零 cordis**：纯 props 原子组件，可在任何 React 18/19 应用中使用
- 📦 **自包含样式**：组件样式在构建时编译为 hash 类名并在运行时自动注入，无需任何 CSS Modules 配置
- 🔤 **Math/代码**：KaTeX 字体内联（woff2 data-URI），Shiki 语法高亮
- 📐 **类型完整**：全套 TypeScript 声明

## 安装

```sh
npm i dsh-ui-kit
```

peer 依赖：`react ^18.2.0 || ^19.0.0`、`react-dom ^18.2.0 || ^19.0.0`。

## 快速开始

```tsx
import { Button, Pill, Input, StateDot, MarkdownText, setThemePreference } from 'dsh-ui-kit'
import 'dsh-ui-kit/tokens.css' // 一次性引入设计 token（含明暗两套）

function MyPluginUI() {
  return (
    <div style={{ fontFamily: 'var(--dsw-font-family)' }}>
      <Button variant="primary" onClick={() => setThemePreference('dark')}>切换深色</Button>
      <Pill active>激活</Pill>
      <Input placeholder="搜索" />
      <StateDot state="done" />
      <MarkdownText text={'# 你好\\n\\n这是 **Markdown**：$\\\\frac{a}{b}$'} />
    </div>
  )
}
```

要点：

1. **token 只需引入一次**（`dsh-ui-kit/tokens.css`），组件样式随组件自动注入。
2. **主题**：`setThemePreference('light' | 'dark' | 'system')` 与 React hooks
   `useThemePreference()` / `useIsDark()`。暗色切换写 `body[data-ds-dark-theme]` 属性，
   与 DeepSeek Harness 宿主一致——第三方插件跑在 DSH 里时 token 与宿主天然同源。
3. 数学渲染（`MarkdownText` 含 KaTeX）字体已内联，开箱即用；不需要额外的 css 导入。

## 组件清单

| 分类 | 组件 |
| --- | --- |
| 基础 | `Button`（primary/ghost/outline/toolbar, md/sm）· `Pill` · `Input` · `StateDot` · `DisclosureRow` |
| 浮层 | `Menu` · `Modal` · `Tooltip` · `HoverCard` · `Toast` · `OnboardingSurface` · `RiskConfirmation` · `ConnectionBanner` |
| 内容块 | `TerminalBlock` · `DiffBlock` · `ReadBlock` · `SearchBlock` · `WebBlock` · `JsonTree` · `JsonBlock` |
| Markdown | `MarkdownText`（GFM + KaTeX + 流式增量解析）· `MessageText` · `CodeBlock`（Shiki）· `extractMarkdownPlainText` |
| 品牌/图标 | `BrandWordmark` · `FishLogo` · 65+ 个 `Icon*`（ic_ds_* 图标集） |
| 主题 | `setThemePreference` · `useThemePreference` · `useIsDark` · `resolveDark` |

## 设计 Token 体系

Token 分四层（与 DSH 官方一致，见 `src/styles/`）：

1. **`--dsw-static-*`**：原始色板（amber / blue / deepseek 品牌 / green / neutral / neutral-bluish / red），明暗一致；
2. **`--dsw-alias-*`**：语义别名（`bg-*`、`border-*`、`label-*`、`button-*`、`interactive-*`、`state-*`、`markdown-*`、`scrollbar-*`、`toast-bg`、`tooltip-bg`…），明暗各一套；
3. **`--dsw-specific-*`**：产品专属（sidebar、bubble、menu、selector…）；
4. **基础层**：`--dsw-font-family` / `--ds-font-family-code` / 动效曲线 `--ds-ease-in-out`，另有 `--dsw-shadow-lv1~3`、`--dsw-font-markdown-*` 排版 token、`--shiki-*` 语法高亮调色板、滚动条皮肤 `--dsh-scrollbar-*`。

明暗切换由 `body[data-ds-dark-theme]` 属性驱动——组件 CSS 全部消费别名 token，
**无任何字面量颜色**，因此两套主题自动成立。

## 给 DSH 第三方插件作者

- 插件的 client bundle 直接 `import { Button, ... } from 'dsh-ui-kit'`；样式自动注入，无需处理 CSS。
- 插件跑在 DSH 宿主内时，宿主已加载同源 token——本库的 `--dsw-*` 变量名与官方一致，
  界面与官方插件无缝融合；`data-ds-dark-theme` 主题属性也与宿主共享。
- 示例见 `demo/`（vite）。

## 构建 / 发布

```sh
npm run build        # dist/：自包含 ESM bundle + tokens.css + katex + 类型声明
npm run demo         # 启动 vite demo（明暗切换 + 全组件展示）
npm run build:site   # 生成 GitHub Pages 静态站点到 site/
npm run site:serve   # 本地预览生成的站点（默认 http://localhost:4173）
npm pack             # 产出可发布的 tarball
npm publish          # 发布到 npm（publishConfig.access: public）
```

产物结构：

```
dist/
  index.js              # 自包含 ESM bundle（组件 + 自动样式注入 + 内联 KaTeX 字体）
  types/                # 全套 .d.ts
  styles/tokens.css     # 设计 token（含明暗两套）
  katex/                # KaTeX 样式与字体（供 dsh-ui-kit/katex.css 子路径）
  css/                  # 编译后的 CSS 注入模块
```

## CI/CD 发布

仓库内置 .github/workflows/release.yml，实现：

1. **基于 git tag 发布**：推送 `vX.Y.Z` 标签触发；Workflow 校验 tag 与 `package.json.version` 一致后执行 typecheck 与 build。
2. **自动发布 npm**：使用 `npm publish --provenance --access public` 发布，需要仓库 secret `NPM_TOKEN`（npm 的 Automation access token）。
3. **自动更新 GitHub Pages**：npm 发布成功后运行 `npm run build:site`，生成落地页与文档，并通过 `actions/deploy-pages` 部署到 https://neil-ji.github.io/dsh-ui-kit/。

首次启用前需要在仓库中配置：

- 添加 secret：`Settings → Secrets and variables → Actions → New repository secret`，名称为 `NPM_TOKEN`。
- 启用 Pages：`Settings → Pages → Source` 选择 **GitHub Actions**。
- 可先本地执行一次 `npm publish` 创建 npm 包记录，或直接推送首个 tag 由 Workflow 创建。
- 如需只更新 Pages 不发布 npm：在 Actions 页签手动运行 `Release & Pages`，取消勾选 `publish_to_npm`。

## License

MIT。本项目是 DeepSeek Harness Web UI 组件与设计 token 的独立再封装（设计来源：
`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-theme`，均 MIT 许可）。
版权与归属声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
