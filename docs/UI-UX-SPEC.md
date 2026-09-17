# Spark UI-UX 组件与页面规范（Design Spec v1）

> 适用范围：本仓库全部客户端 UI（dsh-ui-kit、五个插件 client、dock 壳）。
> 本文档是 AGENTS.md §3 的展开；冲突时以本文档为准，修改用 `docs(agents):` commit。
> 唯一样式真源：`packages/dsh-ui-kit/src/styles/spark-tokens.css`（tokens v4）。
> 所有数值均锚定现有实现实测，非凭空设计；标注 ⚠️ 的是已知漂移及决策。

---

## 1. 设计原则

1. **中性冷灰骨架 + 品牌蓝点睛**：界面 95% 由冷灰阶与语义色构成，品牌蓝（#4d6bfe 系）只用于主操作、选中态、品牌强调，绝不作大面积底色。
2. **层次必须可辨**：面板(platform) < 卡片(card) < 浮层(float) 三层表面，任意主题下相邻层对比可辨（v4 修订，闸门守护）。
3. **密度优先**：这是嵌在指挥舱里的工具面板，不是营销页——信息密度优先于留白，但要"收窄字距不收窄可读性"。
4. **可访问性是验收项不是理想**：WCAG 2.1 AA（正文 4.5:1、大字/非文本 3:1），全部由 `pnpm check:contrast` 机械守护。
5. **壳与模块分离**：文案归模块、呈现归壳（F7）；模块不操作壳的 DOM，壳不含模块字符串。

---

## 2. 设计 Token 规范

### 2.1 色彩

- **唯一合法来源是语义 token**（`--spk-*`）。primitives（`--spk-n-*` 灰阶、`--spk-spark-*` 品牌阶）只在 spark-tokens.css 内部使用，组件与插件面板**不得直接引用 primitives**。
- **填充与文字两态必须分清**（v4 核心修订）：
  - 实底用 `--spk-brand`（配 `--spk-on-brand` 反白）；文字/图标/描边强调用 `--spk-brand-fg`。
  - 模块 accent 同理拆两态：`--spk-acc-*`（图表/指示条/圆点）与 `--spk-acc-*-fg`（图标/胶丸/实底芯片）；亮色实底芯片反白用 `--spk-on-accent`。
- **成功/警告/错误**：文字态与实底态各自成对，禁止"一个色值走天下"（#16a34a 在亮灰底只有 2.8:1 的教训）。
- **固定面**：终端块（`--spk-term-*`）与 tooltip（`--spk-tooltip-*`）永远深底，**禁止借用会随主题翻转的语义色**。
- 允许 `color-mix(in srgb, var(--spk-token) N%, var(--spk-token2))` 做 token 间混合（Card.brand 先例）；禁止 mix 进字面量色值。
- **插件 UI 一律直连 `--spk-*`，禁 `--dsw-alias-*`**（v4.2，2026-09-17 决定）：真宿主里 `--dsw-*`
  由**宿主自己定义**，取值与 ui-kit 的桥接段（dsw-bridge.css）不同 —— 实测 light 主题
  `--dsw-alias-label-tertiary` 宿主给 #81858C、桥接给 #5F6A7D。于是同一个组件变成
  「闸门/预览按桥接值算，真宿主按宿主值渲染」：对比度表 154 项全绿，真宿主上 dock 副标题只有 3.42:1
  （验收 PCQA-007）。例外只有 **字体栈与阴影**（不参与对比度判定，且刻意与 shell 同源）。
  闸门：`pnpm check:contrast` 的「插件源码直连宿主 token」段，非零即失败。
- **次要文字的灰度只用三档语义 token**（跨模块统一，v4.2）：

  | 角色 | token |
  |---|---|
  | 正文 / 标题 / 行主文 | `--spk-label` |
  | 12–13px 次要正文（说明、副题、空态提示） | `--spk-label-2` |
  | ≤11px 元信息（时间、计数、单位、来源） | `--spk-label-3` |

  同屏不得混入宿主灰阶（PCQA-016 的根因），也不得靠 `opacity` 造第四档灰。
- 暗色信号：宿主 `body[data-ds-dark-theme]`、预览 `body[data-theme="dark"]`，两选择器都必须覆盖。

### 2.2 间距与布局

**4px 基距**：`--spk-space-1..4` = 4 / 8 / 12 / 16。一切间距是它的倍数或语义档；**禁止 6/10/14/20 这类近似值裸写**（14 只作为语义档内部的既有值存在）。

**语义档（优先级高于 space-N）**：

| token | 值 | 用途 |
|---|---|---|
| `--spk-gap-page` | 12 | 卡片之间、页头→内容 |
| `--spk-gap-card` | 8 | 卡片内行与行、字段与字段 |
| `--spk-pad-card` | 12px 14px | 卡片内边距（与 ui-kit Card 同值） |
| `--spk-pad-panel` | 14px 16px | 面板内容区（与 dock body 同值） |

**布局规则**：
- 页面 = 一列卡片（`display:flex; flex-direction:column; gap:var(--spk-gap-page)`）。
- 功能分组一律用 ui-kit **Card** 包裹，分组标题写 Card 的 `title`；页面级 `<h2>` + 无边框分组的旧写法已废弃。
- 卡片内主轴间距 `--spk-gap-card`；行内元素组用 `--spk-space-1`。
- 卡片 `min-width: 0` 必须保留（防表格/长词撑破）。

### 2.3 圆角标度

| 语义 | 值 | token / 来源 |
|---|---|---|
| 输入类控件、行、Disclosure | 10 | `--spk-radius-md` |
| 卡片、Menu | 12 | `--spk-radius-card`（v4.1 新增，已全量迁移） |
| Button | 10（md 与 sm 同值） | `--spk-radius-md`（2026-09 修订：胶囊 16/13 与输入类 10 落差过大，按钮收编进控件圆角标度） |
| tag / Pill / 状态点 | 999 或 50% | `--spk-radius-full` |
| 图表微元素 / 嵌套内层推导 | 3–4 / 6–8 / 9 | 允许字面量（非控件语义；内层 = 外层半径 − 内边距） |
| `--spk-radius-sm 7 / lg 14 / xl 20` | — | 保留给浮层与大容器 |

### 2.4 字号排版

| 层级 | token | 值 | 用途 |
|---|---|---|---|
| meta / tag | `--spk-text-xs` | 11px | Pill、辅助说明、字段 label |
| body-minor | `--spk-text-sm` | 12px | 次要正文、表格次列、sm 按钮 |
| body | `--spk-text-md` | 13px | 正文默认、输入框、md 按钮 |
| 卡片题 | `--spk-text-title` | 14px | Card title、区块标题（v4.1 新增并收编硬编码） |
| 强调正文 | `--spk-text-lg` | 15px | KPI 标签行、重要行文 |
| 页面题 | `--spk-text-xl` | 18px | 页内大标题（dock header 已有模块名时省略，见 4.3；v4.1 由 17 修订为 18，与五面板现实对齐） |
| Hero 数字 | `--spk-text-2xl/3xl` | 22/30 | 总成本大数字等 |

行高：密排（Pill/label）1.2–1.6；正文 1.4；大标题 22px 固定。字重仅 400 / 500 / 600 三档；数字列优先 `--spk-font-mono`。

### 2.5 边框

- 默认 1px `--spk-border`（卡片）或 `--spk-border-2`（输入类控件——layer-2 底上控件轮廓靠它可辨，Input 先例）。
- focus / 强调描边 2px，或 `color-mix(brand 30–45%, border)`。
- 禁止无边框阴影替代描边（浮层除外，见 2.7 `--spk-blur`）。

### 2.6 动效

| token | 值 | 用途 |
|---|---|---|
| `--spk-dur-fast` + `--spk-ease-out` | 120ms | hover / focus / 边框色过渡 |
| `--spk-dur-med` + `--spk-ease-out` | 220ms | 展开、分段滑块、图表条 |
| `--spk-dur-slow` + `--spk-ease-spring` | 320ms | 面板弹出、气泡 |

规则：只动 `opacity/transform/border-color/background`，不动布局属性；所有动画尊重 `prefers-reduced-motion`（backlog：ui-kit 统一 media query）。

### 2.7 密度变体（组件级 token，合法模式）

面板可能以 compact（Modal 内）或 standard（页面）两种密度出现。模式（范本 `FinanceAuditSection.module.css` 的 `--fin-*`）：

- 前缀必须是**包名缩写**：`--fin-*`、`--hippo-*`、`--gh-*`；
- **只允许布局/密度/尺寸**，颜色永远走全局语义 token；
- 变体类（如 `.rootCompact`）覆写这组局部 token，不改组件结构；
- 必须在 css 头部注释说明密度语义（"收紧字距但保持可读，不藏密"）。

---

## 3. 组件规范（ui-kit 逐个）

通用状态矩阵（所有交互组件）：`default / hover / active / focus-visible / disabled / loading`，表单类追加 `readonly / error`。
**focus-visible 一律可见**（描边或 2px 环），键盘可达是验收项。

### 3.1 Button — 32px 实心（radius 10）
- variant：`primary`（品牌实底）/ `secondary`（描边）/ `ghost`（无底）/ `danger`（错误实底）。
- size：md = h32、pad 0 14px、radius 10（`--spk-radius-md`）；sm = h26、pad 0 11px、radius 10、字 12。触控目标 ≥26px 高。
- loading：内置 spinner + `aria-busy`，并 disabled 点击；icon 在 children 之前。
- Do：**一屏一个 primary**。操作性定义（v4.2）：以「操作域」为单位 —— 一张 Card、一个
  `role="group"`、页脚操作组各算一个域，**每个域至多一个 primary**；同一域内出现第二个实心
  主操作就是验收违规（PCQA-019 的实测违规：GitHub「连接」卡里 `保存令牌` + `测试连接` 双实心）。
  跨域并列（如 github 设置页的「连接卡保存」+「页脚保存配置」）属既有例外，评审时须写明理由。
  Don't：ghost 用于破坏性操作；disabled 提交不解释（要给原因文案）。
- **disabled 形制**（v4.3，2026-09-18 复核 PCQA-011）：实心档（primary/danger）禁用时**换中性底**
  —— `background: var(--spk-platform)` + `color: var(--spk-label-3)`，不得只压 opacity：
  半透明的品牌实底看上去仍然是「可以点的主操作」。透明底的 ghost/secondary 保留 opacity 淡出。
  **所有** disabled 的提交/写操作按钮必须给原因：可见文案（`role="status"`）+ `aria-describedby`
  挂到按钮上。范本：spark「捕获」→ `spark-capture-hint`；finance「还原到发版快照」→
  `finance-restore-hint`；github/npm 的保存钮同理。

### 3.2 Input / SearchInput
- label 用 `--spk-text-xs` 11px 置于输入框上方；输入文本 `--spk-text-md` 13px，pad `8px 10px`，radius 10，边框 `--spk-border-2`。
- hover 提亮描边（`--spk-label-3`）；error 态描边 `--spk-error` + 字段下方 11px 错误文案；focus 描边透明 + 环。
- 凭据类输入配"测试连接"次按钮（连接页模板，见 4.2）。

### 3.3 Checkbox / SegmentedControl / Disclosure / Menu / Modal / ListRow / Pill / StateDot / Money
- **Checkbox**：2px 描边选中框（`color-mix(currentColor 30%)` 边），label 走 `t()`。
- **SegmentedControl**：面板页签/视图切换**唯一合法形制**（fullWidth 栅栏态用于页面级页签）；滑块 `--spk-seg-thumb`；**禁止自绘 tab**。
  面板**页级分栏**是「多视图模块」的形制：视图 ≥2 时必须用 fullWidth 分段条，且它是内容区的第一件；
  **单视图模块**（连接/设置页模板 §4.2-2，如 GitHub / npm）**不分栏**，内容直接是 SettingsCard 栈
  —— 这是模板差异不是违规（复核 PCQA-001 裁决，2026-09-18）；一旦该模块出现第二个视图，就必须改为分栏。
- **Disclosure**：折叠唯一合法形制；**禁止 `<details>` / 按钮自行切换**的旁路实现。
- **Menu**：radius 12、border-2、浮层阴影；Esc 关闭、方向键导航、aria-haspopup。
- **Modal**：surface-float 层 + `--spk-blur`；Esc + 点遮罩关闭；内部密度走 compact。
- **ListRow**：radius 10；行高受 `--spk-gap-card` 约束；整行可点击时必须是 `<button>` 语义。
- **Pill**：pad `2px 8px`、radius 999、11px/1.6、字重 500；状态语义色用 `acc-*-fg` 态。
- **StateDot**：9–10px 圆点 + `acc-*` 实底态；必须配文字标签，不裸用颜色传义。
- **Money**：数值 + 货币，micros 换算集中在组件内；等宽字体；千分位。
  两档精度（v4.3）：KPI/Hero 用默认**紧凑规则**（≥1000 取整、≥1 去尾零、<1 两位有效数字）；
  **表格数字列用 `exact`**（固定两位小数）—— 列内纵向对齐优先于紧凑（复核 PCQA-018）。
- **TerminalBlock**：永远 `--spk-term-*` 固定深面，任何主题不翻转。
- **EmptyState**：图标（ui-kit IconXxx）+ 一句"这是什么" + 一个主操作 CTA。
- **Charts / Sparkline**：实底用 `acc-*`、文字用 `acc-*-fg`；legend 点 9px r3、bar 高 8px r4；hover 高亮 opacity 1 vs 0.35（FinanceAudit 先例）；tooltip 用 `--spk-tooltip-*` 固定面。

### 3.4 播报（跨组件反馈通道）
- 模块一律调 kit `publishAnnouncement({ mood, text, src })`（mood：happy/alert/think/sad/cheer），**禁止模块自建气泡 / 直接写 aria-live 节点**。
- 壳（fairy 层）统一渲染气泡；kit 4s 去重防事件风暴；baseline 帧不播报（防重连误报）。

---

## 4. 页面与布局规范

### 4.1 信息架构
悬浮球（`.dock-ball`）→ 指挥舱（`.dock-panel`）→ 模块栏（`.dock-tab`）→ 模块 pane。
⚠️ **这些类名 + `.dock-bubble` 是验收公共 API**（real-host-check 依赖），改名必须同步 harness。

### 4.2 页面模板（四种）
1. **仪表盘页**（finance 总览）：Hero 大数字 KPI → 图表卡 → 明细表格卡；每卡右上角 `actions` 放刷新等次操作；"最后更新 N 分钟前"必须有。
2. **连接/设置页**（github/npm/凭据）：SettingsCard 栈；每卡 = 说明文案 + 输入 + `测试连接`(secondary) + `保存`(primary) + 状态行（StateDot + 文案）。测试与保存分离，禁止保存即测试。
   **多卡设置页的页脚草稿结算行（保存配置 / 丢弃更改）取 secondary**：一屏只保留一个实心 primary
   （github 面板 = 连接卡的 `保存令牌`），否则权限/身份草稿一脏就同屏两个实心主按钮
   （复核报告 -2210 的遗留 #1，2026-09-17 收口）。
3. **列表页**（记忆/仓库等）：ListRow 栈 + 顶部计数；空态必须 EmptyState + CTA。
4. **表单/编辑页**：字段组按 Card 分组；危险区（删除/重置）独立卡片置底，danger Button + 二次确认（Modal）。

### 4.3 页头规则
模块名与模块级说明由 **dock header 位**呈现；模块 pane 内**不得再渲染一级大标题**（重复两层实测差 72px 高——FinanceAuditSection 的 embed prop 先例）。页内操作（刷新、更新于）属于 pane，保留。

### 4.4 反馈系统（四态全覆盖）
| 态 | 规范 |
|---|---|
| **Loading（首次/可估进度）** | >2s 的任务（首开回填）：spinner + `loadingTitle/loadingDetail` + `role="progressbar"` 进度条（aria-valuemin/max/now），进度来自 `finance/events` 类 stream |
| **Loading（常规）** | 卡片内骨架或按钮 spinner；禁止整页白屏 |
| **Empty** | EmptyState：图标 + "这是什么" + 主操作 CTA；禁止裸"暂无数据" |
| **Error** | 传输错误走 kit `messageOf/remoteFailureOf`；行内 error 文案 + 重试主按钮；静默失败类（价格同步过期 >24h）降级为页头 stale hint |
| **Stale** | 数据带"最后更新"时间戳；超过阈值（24h）出现可操作 hint |

### 4.5 尺寸与响应
- dock pane 内容宽 320–420px 设计域；卡片满宽、内部网格自适应（KPI `min` 列宽 + `repeat(auto-fit)`）。
- 表格：列数 >4 或宽不足时**横向滚动**（`.table { overflow-x: auto }`），不压缩列；数字列右对齐等宽字体；
  每个 `cols*` 网格必须给数字列**最小宽度**（如 `minmax(88px, 1fr)`），文本列配 `.cellWrap` 折行 ——
  「关键结论数字」与「模型名」都不允许被省略号吃掉（复核 PCQA-008）。
- 触控/点击目标：**内联控件 ≥26px 高**（Button sm 下限；胶囊 Pill / SegmentedControl 页签
  同线，`--spk-control-h-sm`）；**图标类主入口 ≥44×44**（悬浮球 48px、rail 模块钮 44px）。
  WCAG 2.5.8 的硬下限是 24×24，这里是本仓库更严的自定档 —— 两份文档曾各写一个数（26 vs 44），v4.2 起
  按「内联控件 / 图标入口」两类分别取值，不再冲突。
- ui-kit 组件内部的**嵌套圆角 6–8px 与 2–3px 内距**属「内层 = 外层半径 − 内边距」推导，
  豁免字面量审计（§7 落地治理）。

---

## 5. 交互与可访问性

- **键盘**：Tab 序 = 视觉序；Modal/Menu 内焦点圈闭（focus trap）+ Esc 退出；SegmentedControl 方向键切换。
- **对比度**：正文 4.5:1、大字/非文本 3:1——`pnpm check:contrast` 154 项逐条硬闸。
- **aria 模式表**：动态状态区 `role="status" aria-live="polite"`；进度 `role="progressbar"` + 三值；异步按钮 `aria-busy`；图标按钮必须 `aria-label`；可断言节点带 `data-testid`（preview:verify / real-host-check 按此断言）。
- **播报**：见 3.4；同一文案 4s 去重。

---

## 6. 内容与文案规范

- 按钮 ≤4 字动词开头（"保存""测试连接""刷新余额"）；禁"确定/取消"泛词做业务主操作。
- 空态文案 = 是什么 + 下一步（"还没有供应商——添加一个开始追踪成本"）。
- 时间：列表用相对时间（"3 分钟前"），hover/详情给绝对时间；时区语义明确（成本窗按北京午夜切分要写注释）。
  **相对时间必须走 locale 字典**（禁止在组件里拼英文串 —— 复核 PCQA-004 的 "最近 4 d ago" / "just now"）；
  同一语言的界面只用一种时间措辞。
- **扫描类时间戳必须逐条有语义**：由规则每轮重算的队列（进化候选等）不得把「本轮扫描时间」当条目标签
  —— 那会让所有行显示同一个 "just now"（复核 PCQA-017）。队列行的时间应取该条目自身的变动时间。
- 数字：金额千分位 + 货币后缀；token 数用 k/m 缩写；**表格数字列金额固定两位小数**（Money `exact`）。
- locale key：`<模块>.<域>.<名>`（如 `finance.sync.staleHint`）；两个语言字典必须同 key 集。

---

## 7. 落地治理

1. 命名：组件 PascalCase + 同名 `module.css`；client 包目录形制遵 AGENTS.md。
2. 验收：新 UI 必须 `pnpm preview` 对照设计稿 + `check:contrast` + `preview:verify`；进真宿主链路的加 real-host-check 断言。
3. **已落地（ui-kit 0.5.0 + 四包形制迁移，audit-tokens 闸门已入 check:all）**：
   - [x] 新增 `--spk-radius-card: 12px` 与 `--spk-text-title: 14px`；面板层 29 处 radius、
     155 处字号字面量全量迁移；291→0 过闸；
   - [x] `audit-tokens` 闸门（间距/圆角/字号字面量检查；豁免：ui-kit 组件定义源、
     图表微元素 3/4、嵌套推导 6/8/9、密度 token 定义行；胶囊 13/16 已于 2026-09 收编为 `--spk-radius-md`，不再是合法字面量）；
   - [x] `audit-contrast` 增「插件源码直连宿主 token」段（禁 `--dsw-alias-*`/`--dsw-static-*`，
     字体栈与阴影例外）与 `audit-tokens` 增「字号不得绑定非字号 token」规则（v4.2，2026-09-17）；
   - [ ] `prefers-reduced-motion` 统一 media query 进 ui-kit base（待办）。
4. **v4.3（2026-09-18，干净真宿主复核轮的修复）**：
   - disabled 形制（中性底 + 原因文案，§3.1）；单视图模块不分栏的口径（§3.3）；
     Money `exact` 两档精度（§3.3/§6）；表格列最小宽度 + 折行 + 横向滚动（§4.5）；
     相对时间一律走 locale、扫描类时间戳不得逐行同值（§6）。
   - 回归防线：`dev-harness/real-host-check.mjs` 增「形制与间距」断言段（分栏宽度一致、分栏→首块
     间距一致、禁用钮有原因、中文界面无英文时间串）。