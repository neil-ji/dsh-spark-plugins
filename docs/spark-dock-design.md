# Spark Dock — 悬浮球统一接入设计

> 目标：让 5 个自研插件（Spark 火花 / HippoMemo 记忆 / Finance 成本 / GitHub 连接器 / npm 发布管线）
> 脱离 DSH Web 设置弹层的插槽，用一个自绘悬浮球做为统一入口，全部融入一个「指挥舱」面板。
> DSH 官方 `dsh-client-ui-slots` 的 `SlotMap` 是给 shell 自己用的（第三方只有 `settings.section` 一个入口，
> 且渲染在设置弹层里），没有「页面级悬浮入口」插槽 —— 所以悬浮球由我们自己建设、自己挂到 `document.body`。

---

## 1. 概念

- **悬浮球（Ball）**：常驻页面右下角的 48px 圆钮，是唯一的入口。点击展开「指挥舱」。
- **指挥舱面板（Panel）**：从球的位置向上弹出的玻璃卡片，顶部是一条 5 模块 Dock，
  下面是当前模块的 UI。它是插件 UI 的**新宿主**，与设置弹层解耦。
- **Dock 模块（Module）**：一个自研插件在面板里注册的一格（图标 + 徽标 + 内容渲染函数）。

设计隐喻参照 macOS Dock / 游戏浮动工具条：**球 = 折叠态，Dock = 展开态**，
面板从球弹出（空间连续：自下而上 = 更深一层），语义与 `--dsw-*` 设计系统逐像素对齐。

## 2. 信息架构

| order | id | 插件 | 图标 | accent | 徽标 |
|---|---|---|---|---|---|
| 10 | `spark` | Spark 火花 | sparkle（4 芒星） | amber `#F59E0B` | 待决议提议数 |
| 20 | `hippomemo` | HippoMemo 记忆 | 记忆/脑叶 | blue `#3B82F6` | 待处理候选数 |
| 30 | `finance` | Finance 成本 | 数据/币 | green `#22C55E` | —（无数字接线，用状态点/同步徽标） |
| 40 | `github` | GitHub 连接器 | branch | violet `#8B5CF6` | — |
| 50 | `npm` | npm 发布 | 立方体/包 | npm red `#CB3837` | — |

- **顺序**：按插件心流重要性排（Spark 是旗舰认知层放最前），Dock 横向条恒定 5 格，命中「底部/条式导航 ≤5 项」规则。
- **强调色纪律**：每个模块默认单色（灰阶），仅「激活态」时图标染自己的 accent + 下方指示点；
  accent 只出现在指示语义上，不做大面积铺色，延续各插件内部既有的「单一强调色」风格。
- 徽标是 `badge: () => number | undefined` 回调，渲染成图标右上角计数 pill，用**单一** `aria-live="polite"` 区域整句播报，不抢焦点。
  - 真实徽标来源（对齐存量）：spark → `proposals(status=pending).length`；hippomemo → `candidates.total`（「需要我处理 N」）。
    finance/github/npm 无数字接线，不贡献徽标（finance 用余额状态点「已过期 N 天」与同步徽标做状态表达）。
- **存量 Feature 已对齐**：预览稿 `docs/spark-dock-preview/index.html` 的 5 个模块内容已按各插件真实 UI 重做——spark 4 子页（火花流/涌现提议/脚本目录/Graph）、
  hippomemo 4 子页（总览/记忆/偏好/进化，四脑区=前额叶·杏仁核·海马体·新皮层）、finance 仪表盘（余额总览→KPI→订阅双卡→峰谷拆分→近24h→按供应商/按模型）、
  github（连接+令牌+9 项权限+Git 身份/代理）、npm（令牌+注册表+套件包状态）。文字一律取各插件 locale 中文原文。

## 3. 交互与状态机

### 悬浮球 Ball

| 状态 | 表现 |
|---|---|
| 静止 idle | 48px 圆，浮层表面 + 品牌描边 + 4 芒火花字形，2s 一次极轻呼吸辉光（`prefers-reduced-motion` 关掉） |
| hover | scale 1.04 + 辉光增强 + Tooltip「Spark」 |
| active（面板开） | 字形切换为 ×（或面板自带关闭钮），球保持可点切回 |
| 拖拽 | 指针按下 4px 阈值才进入拖拽（`drag-threshold`，防误触）；松手吸附到**最近角**，留 16px 安全距；拖拽后吞掉当次 click（避免误开面板），双击球复位默认右下角 |
| 键盘 | 球可聚焦，`Enter`/`Space` 开合；方向键微调位置（拖拽必须有键盘替代，WCAG 2.2 AA `dragging-alternative`） |

- 位置持久化 `localStorage['dsh.spark-dock:pos']`；球/面板各自 `position:fixed` 独立定位（不用 right/bottom 混搭、不塞同一容器），拖拽坐标用 `getBoundingClientRect` 差值，杜绝「坐标错乱→悬停躲避/点不到」。

### 面板 Panel

- **打开**：从球为原点 scale 0.94 → 1 + fade，220ms 弹簧曲线（enter）。
- **关闭**：140ms（exit 约为 enter 60–70%，`exit-faster-than-enter`）。全部只动 `transform/opacity`。
- 默认尺寸 **560×680**（插件内容密度大，放大留白）；**≤520px 视口**退化为贴底 sheet（`width: 100vw-16; height: 74vh`）。
- **随球反向弹 + 视口夹取**：球在右半屏→面板向左弹、左半屏→向右弹，上半屏→向下弹、下半屏→向上弹，且整块夹回视口内（永不越出左右/上下边缘）；`transform-origin` 跟随弹向，缩放动画从球侧长出。
- 结构：`Header(48px, Dock 条 + 模块标题 + 操作簇) → Content(可滚动, overscroll-behavior:contain)`。
- **操作簇**：固定/浮窗切换（pin）、折叠。`Esc` 关闭并把焦点还给球。面板内 Tab 自然顺序、命中路由时焦点入 content。
- 布局 = 面板容器 `--dsw-shadow-lv3` + `--dsw-alias-border-l1` + `--dsw-alias-bg-module-platform`（与 shell 侧栏同源，融入感）。

## 4. 视觉系统（全部复用 DSH token，不新建色板）

- 表面：球/面板 `background: var(--dsw-alias-bg-module-platform)`；边框 `var(--dsw-alias-border-l1)`；
  投影 `var(--dsw-shadow-lv3)`（面板）/ `var(--dsw-shadow-lv2)`（球）。
- 文字：标题 `var(--dsw-font-s-strong-14)` / `var(--dsw-font-l-20)`；正文 `var(--dsw-font-s-14)`；
  说明 `var(--dsw-font-xxs-12)`、次级色 `var(--dsw-alias-label-tertiary)`。
- 指示色：`--dsw-alias-brand-primary`（球字形/激活描边）、`--dsw-alias-state-success/warn/error-primary`（状态）、
  静态 ramp（`--dsw-static-blue/amber/green/violet/red-*`）只用于 5 个模块 accent。
- 图标：16px、1.5px 描边、与 `dsh-ui-kit` 图标族同一光学网格；除 Spark(Branch 已有) 外新增
  记忆脑子 / 成本币 / npm 立方体 3 枚（**SVG，禁 emoji**，`pro-rules`）。

## 5. 架构

> **落地现状（2026-09-11 核对）**：悬浮球 + 指挥舱面板、拖拽吸附、Fairy 心情状态机均已实现
> （`packages/dsh-spark-dock`，注册到 `shell.overlay`）。本节 §5.2/§5.3 的 `registerDockModule()`
> **已按 ADR-003 全量落地**：dock 声明 `spark.dock.module` 子槽（`children`）并用平台下发的
> `renderSlot` 渲染 rail / header / pane 三个位；五个模块（火花 / 记忆 / 财务 / GitHub / npm）
> 全部由**各自的 client 入口自注册**，dock 不再静态 import 任何插件 UI —— `modules.tsx`
> 与三处 dock 侧 embed pane 已删除。`docs/spark-dock-design.md` 原稿里「dock 硬编码模块表」
> 的描述属于历史（评审 F4 已关闭）。设置页插槽 `settings.section` 与 `settings.plugin.item`
> 同日移除。

### 5.1 新包 `packages/dsh-spark-dock`（client overlay + 自 patch）

镜像 host/client 双产物包形 + 自带 `cordis.patch.yml`：

- `package.json` → `dsh.bundle.patch = ./cordis.patch.yml` + `dsh.client`（platform web，
  inject: `dsh-client-modules` / `dsh-client-locale` / `dsh-client-ui-slots` / `dsh-client-ui-settings`）。
- `lib/index.js` 空 host loader（与 spark-ui 同）；`lib/client.js` 浏览器端（球 + 面板 + 订阅 registry）。
- `cordis.patch.yml` → `insert: [{ id: spark-dock, name: dsh-spark-dock }]`。

### 5.2 共享 registry（解耦 + 加载序无关）

关键约束：5 个 UI 插件是**独立 esbuild 产物**，互相不能 import，共享态必须落 `window`。

- 注册表单例：`window.__SPARK_DOCK__ ??= { modules: Map, version: 0, listeners: Set }`。
- `dsh-spark-plugin-kit/client` 新增 `registerDockModule(module): disposer`（所有 5 个插件已依赖该包，零新依赖）。
  写入 `window.__SPARK_DOCK__.modules.set(id, module)` + 版本自增 + notify。
- Dock 的 `apply(ctx)` 读同一全局，订阅变更、按 `order` 渲染。插件先于 Dock 加载也能累积，Dock 后到即见。

### 5.3 插件侧接入（每个 apply 加一处注册，设置页保留为兜底）

```ts
// 例：某插件 client 入口的 apply()（此路径当时未落地，现由 dock 的 modules.tsx 承担）
registerDockModule({
  id: 'spark', order: 10, icon: 'sparkle', accent: 'amber',
  label: () => t('nav'),
  badge: () => controller.pendingProposalCount(),
  content: () => <SparkSection api={api} controller={controller} useSnapshot={useSnapshot} t={t} />,
})
```

- `content` 闭包复用 apply 里**已经构造好的**注入面（api/controller/useSnapshot/t），零重复。
- **彻底移除 `settings.section` 注册**（用户拍板）：功能 UI 只走 Dock，设置导航里不再出现插件的功能页。
  - ⚠️ 待确认边界：`settings.plugin.item`（「设置 → 插件」列表里的**配置卡**，如 finance 定价覆盖、hippomemo 阈值开关）与
    `settings.section`（功能主页）是**两个不同插槽**。建议保留配置卡在系统设置里，只把功能页搬进 Dock；若你也要搬配置卡进 Dock，实现再用一个模块子 Tab。

### 5.4 迁移清单

1. `dsh-spark-plugin-kit/client`：`DockModule` 类型 + `registerDockModule` + `window.__SPARK_DOCK__` 单例。
2. `dsh-spark-dock` 新包：球 + 面板 + Header/Content + 拖拽/吸附 + 持久化 + reduced-motion + a11y。
3. 5 个 client 插件 `apply()`：加 `registerDockModule(...)`，**移除** `registerSettingsSection(...)`（功能 UI 只走 Dock）。
4. `plugin-registry.json` 登记 `dsh-spark-dock`；`pnpm build` → `3999` dogfood → 提交。

## 6. 规则核对（skill §1–§7 / pro-rules 集）

- 无障碍：焦点环保留、图标钮有 `aria-label`、`aria-expanded`（球/面板态）、`aria-live` 播报徽标、
  拖拽有键盘替代、色彩不单独表意、对比度 ≥4.5:1 双主题各自验证。
- 触控/交互：命中区 ≥44×44（球 48px）、8px 间距、`touch-action: manipulation`、按压 0.95 缩放反馈（80–150ms）。
- 动效：transform/opacity 专用、motion token（220/140ms）、enter 自下而上、`prefers-reduced-motion` 全灭。
- 层级：`z-index` 令牌化（球 9000、面板 9100、panel 内 tooltip 更高），不写魔法值。
- 布局：≤520px 退底 sheet、`min-h-dvh`、无横向滚动、8px 栅格节奏。

## 7. 风险与回退

- 球覆盖聊天输入/滚动条风险 → 默认 16px 边距 + 可拖 + 可折叠；必要时在面板开时加 body 右 padding（v2 评估）。
- 已彻底移除 `settings.section`，无兜底入口：若 Dock 客户端加载失败，插件功能页将不可达。缓解：Dock 的 `apply` 内包 try/catch +
  错误态（球仍可点、面板显示坏点提示）；紧急回滚 = 从 git 取回退役前的设置页注册代码（该能力与退役包 `dsh-spark-ui` 已于
  2026-09-11 一并删除，不再是「每插件几行」的现场改动）。
- 3080 常驻服务的旧 module 缓存 → 改码必须 bump 版本 + 重跑安装（本仓库既有纪律）。
- `window.__SPARK_DOCK__` 若未来官方也用了同名 → 加 `data-dsh-spark-dock` 版本探测，冲突时改名。
## 8. Fairy 人格动效（v2 · 有生命的悬浮球，纯 UI 模拟）

> 参考《绝区零》Fairy：球从「入口按钮」升级为**角色**——呆毛火花 + 会眨的眼 + 嘴型 + 配件层，
> 全部 SVG + CSS + 状态机实现，不接 AI。实现在 `docs/spark-dock-preview/index.html`（`data-mood` 表情层）。

### 8.1 心情状态机（`setMood(name, holdMs?)` → 球 `data-mood`，到时自动回落 idle）

| mood | 触发 | 表情/动效 |
|---|---|---|
| idle（默认） | — | 呼吸浮沉 + 呆毛摆动 + 随机眨眼（2.6–6.4s）+ **瞳孔视线跟随光标**（rAF 节流，±2px） |
| greet | 页面加载 / 手动 | 弧形笑眼 ^^ + 腿红 + 歪头 tilt ×1 + 气泡「嗨，我是 Spark ✦」 |
| happy | 软成功（同步完成） | 笑眼 + 腿红 |
| cheer | 硬成功（结晶/发布） | **掏出双应援棒挥舞**（星头，±25° 交替）+ 弹跳 + 笑眼 + 腿红 |
| think | 涌现提议 / 处理中 | 思考泡三点脉冲 + 瞳孔上扬 |
| alert | 新事件播报 | 瞪眼 + 小 o 嘴 + 呆毛闪烁 |
| sad | 失败（401/同步失败） | 汗滴滑落 + 皱嘴 + 垂头 |
| sleepy | 45s 无操作且面板关 | 眯眼 + Zzz 漂浮（呼吸动画停）；任意交互 → poke 惊醒 + 「呜…我睡着了」 |
| poke | 惊醒 / 按压 | 挤压弹回 squish（弹簧） |
| （拖拽中） | dragging 类 | 瞪圆 + 抱紧小 o 嘴，bob 动画暂停 |

优先级：拖拽 > 事件心情（cheer/alert/sad/think）> idle 循环；后到心情覆盖前一个。

### 8.2 实时事件播报（气泡）

- 气泡 `role=status aria-live=polite`（不抢焦点），弹入 spring 220ms，停 4s 自动收；说话期间嘴型 talk 动画。
- 定位：默认球上方（球近顶→下方，尾针随之翻转）；**面板开→侧向避让**（球在右半屏→气泡弹左侧，反之亦然），视口夹取。
- 真实接线点（**F7 起由模块自己发布到 kit 的播报总线 `publishAnnouncement()`**，壳只订阅呈现；预览为模拟器，正式实现换成这些源）：
  - HippoMemo `/hippomemo/events` SSE（put/patch/remove）→ 「新增记忆「x」」；citations → 「引用了 n 条记忆」；`candidates` 变化 → 徽标 +N。
  - Sparks `/proposals/events` → 「涌现提议 +n 待决议」（think）；crystallize 成功 → cheer。
  - Finance 同步状态（getSyncStatus）→ 「价格表已 N 小时未同步」/「同步完成」（happy）；余额行「已过期 n 天」→ sad 轻提示。
  - npm test/publish 工具回执 → 发布成功 cheer / 401 sad（事件经 host 侧推到 client）。
  - 徽标语义不变：全局待处理数 = hippomemo candidates.total + spark pending proposals。

### 8.3 约束

- `prefers-reduced-motion`（预览用「动效：减」开关等价）：眨眼循环停、bob/弹跳/挥棒全灭，表情切换保留为瞬时换脸 + 气泡直显。
- 气泡永不抢焦点、不阻塞输入；事件自动播报仅在前台且近 2 分钟有互动时触发，避免打扰。
- 演示工具条（随机事件/应援/思考/打盹/打招呼）仅存在于预览稿，正式包不携带。
