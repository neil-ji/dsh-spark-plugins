# UI 验收：异步按钮的 loading 形制（2026-09-21）

**起因（用户实测报告）**：点「更新价格表」后**没有任何 loading 动效**；会话一多，重算要持续较久，
只置 `disabled` 让人以为按钮失灵。用户裁定：**loading 很重要**。

**定案口径**（写进 `docs/UI-UX-SPEC.md` §3.1 v4.4）：任何会发起写请求 / 重算 / 远程调用的按钮，
在飞期间必须由 ui-kit `Button loading` 同时给出 **spinner + `aria-busy="true"` + 锁点击**；
只置 `disabled` 不算数。

---

## 1. 根因

ui-kit `Button` 早就支持 `loading`（内置 spinner + `aria-busy` + 自动 disabled，`Button.tsx:26-31`），
但**没有任何插件在用它** —— 全仓库 `loading={` 命中数为 0。各插件一律自己写
`const [busy, setBusy] = useState(false)` + `disabled={busy}`。

财务价格表这条路径尤其明显：`updatePrices()` 串了「同步社区目录价 → 原子替换覆盖层 →
刷新价格表状态 → 重算整个账本」四步，会话多时是秒级到十秒级。

**附带发现（同类缺陷）**：`FinancePanelController.load()` **完全没有 busy 标记**，
`ThisMonthView` 拿 `state.status === 'loading'` 当 `refreshing` 用 —— 而 `load()`
在非首开时把 status 设成 `'ready'`，于是**刷新按钮在刷新期间既不转、也不禁用**。

## 2. 修法

### 2.1 busy 状态记「是哪个动作」，不是 boolean

同屏多枚异步按钮时，boolean 会让每一枚都看起来在忙。四包统一改成动作 id：

| 包 | 状态 | 取值 |
|---|---|---|
| dsh-spark-finance-client | `priceAction` | `'update' \| 'restore' \| undefined` |
| dsh-spark-finance-client | `refreshing` | `boolean`（刷新只有一枚按钮） |
| dsh-connector-github-ui | `busyAction` | `'saveToken' \| 'removeToken' \| 'testConnection' \| 'testProxy' \| 'saveConfig' \| 'reload'` |
| dsh-connector-npm-ui | `busyAction` | `'saveToken' \| 'removeToken' \| 'testConnection' \| 'reload'` |
| dsh-hippomemo | `detailAction` | `'archive' \| 'remove' \| undefined` |
| dsh-hippomemo | `running` | `false \| 'dry' \| 'apply'` |

按钮侧一律 `loading={busyAction === '<自己>'}` + `disabled={busy}`（同源）。

### 2.2 复位纪律：`finally` 里**原地**复位

`runPriceAction` 与 `load()` 都用 `finally` 原地复位，**不用**动作开始时的 generation 做守卫 ——
本方法自己会 `++generation`，守卫恒为假，标记就永远停在"忙"（2026-09-18 已为此踩过一次
`priceBusy` 永久 disabled ≥29s；本次把同一条纪律推广到 `refreshAction`/`load`）。
github/npm/hippomemo 的写动作同样从「裸 await + setBusy(false)」改成 `try/finally`，
抛错也不会把按钮永久卡在 loading。

### 2.3 一并恢复「还原」的禁用原因

上一轮（`4d6402a`）把 `restoreDisabledHint` 当"脚注文案"一起退役了，但 UI-UX-SPEC §3.1
与 real-host-check 的既有断言都要求**禁用必须给原因**——两边当时是自相矛盾的。
本次恢复**一行**可见原因 + `aria-describedby="finance-restore-hint"`（不铺段落，符合
「提示文案克制」口径）。**关闭口径：只关"禁用给原因"这一条腿**，脚注那四条段落文案
（价格来源 / 估算口径 / 不可读会话 / 未同步）保持退役，未回潮（有单测钉住）。

### 2.4 顺带修掉的上屏缺陷

- 「刷新」按钮原先用 `{refreshing ? t('refreshing') : t('refresh')}` 换文案；改 `loading` 后
  spinner 表意，文案保持恒定（避免按钮宽度跳动）。
- github「测试代理」的原先 `{busy ? t('proxyTesting') : t('testProxy')}` 收窄为只看自己那个动作。

## 3. 验收证据

| 面 | 结果 |
|---|---|
| `pnpm -r build` / `typecheck` / `test` | 退出码 0（顺序执行；finance-client 106 例 +4、github-ui 14 例 +2） |
| `pnpm check:all` | PASS（架构 0 硬失败 · 价格 0 处 · 对比度 156 项 0 不达标 · token 0 失效 · 版本 0 漏 bump） |
| `pnpm preview:verify` | 123/123 |
| `pnpm sandbox:install` + 重启宿主 + `real-host-check` | **66/66，退出码 0** |

**新增/改写的断言**

- `dsh-finance-client/tests/controller.test.ts`：`priceAction` 复位（成功/失败）、
  在飞期间 `priceAction === 'update'`（中途快照）、`load()` 期间 `refreshing` 置位与复位。
- `dsh-finance-client/tests/panel.test.tsx`：空闲态**不得**出现 `aria-busy="true"`；
  `priceAction`/`refreshing` 三个方向各自产出 busy；「还原」禁用的原因文案 + `aria-describedby`。
  同时把"脚注文案不得回潮"的断言里 `restoreDisabledHint` 摘出（它是 §3.1 硬要求）。
- `dsh-github-ui/tests/section-render.test.ts`：空闲态无 `aria-busy`；loading 形制来源；
  源码面逐动作 id 核对 6 个 loading 站点。
- `dev-harness/real-host-check.mjs` 6i：点「更新价格表」后**立即**采样，断言
  `aria-busy="true"` + spinner 在场（动作已结束则断言回到干净空闲态，两个方向都钉）。
  实测命中：`{"ariaBusy":"true","spinner":true,"disabled":true}`。
  **这段刻意放在 `if (restore.disabled)` 之外** —— 上一轮它在分支内，沙箱里已有覆盖层时整段被跳过（假绿）。

## 4. 附带修复：宿主首启引导模态把 `#root` 置 `inert`（阻断验收链）

**现象**：`real-host-check` 稳定在 dock 键盘段卡死（Chrome 空转 ~93% CPU），
PCQA-001 三条 + PCQA-004/005/009 全红。

**误判风险**：这看起来像本次改动引入的回归，但 `git stash` 后在**干净基线**上同样复现
（同样卡死、同样几条 FAIL）——**属于环境/宿主问题**。

**根因**（CDP 实测）：dsh 0.1.5-rc.x 首启会弹引导模态（「内测声明」→「添加一个 API Key」），
模态期间宿主把 **`#root` 整个置为 `inert`**。祖先链上任一 `inert` 会让 `element.focus()`
变成空操作 —— 于是所有"焦点能否落进面板 / Esc 后焦点是否回球 / 方向键微调"的断言连锁失败，
依赖键盘的段落长时间空转。

**修法**：harness 在断言前把宿主前置状态归零 —— 循环点「继续 / 稍后配置 / 跳过」直到
`#root` 不再 inert（**按状态收敛，不猜步数**，因为不同 profile 停在不同的引导页），
并新增一条前置断言行。

**注意**：这条断言是**前置条件**，不是插件断言 —— 它红说明宿主没准备好，不代表插件坏了。

## 5. 供应商总表布局（用户第二轮反馈：「table 布局混乱」）

**实测数字**（预览画布真实盒模型，卡宽 531px → 表宽 501px）：

| 列 | 修前宽 | 内容实际需要 | 诊断 |
|---|---|---|---|
| 供应商 | 140px | 名字 109px；**额度触达 pill 170px** | pill 溢出 30px 被 `overflow:hidden` 裁掉，行高 50→65px |
| 付费类型 | 72px | Tag 40px（表头 52px） | 空 32px |
| 余额 / 月费 | 100px | 「该厂商没有余额查询接口」132px | 截断 |

**截图描述的归列是错的**：额度触达 pill 实际在**供应商名列**（`ThisMonthView.tsx:316-333`），
不在付费类型列；「手填」在余额/月费列。真因是 pill 塞进供应商列导致溢出 + 撑高行。

**修法**（用户裁决）：**表内只留「付费类型」一个 tag**。
- 额度触达 → 移进详情弹窗（`QuotaHitList` 摘要行，`data-testid` 随迁）；
- 「超值」→ 降级为悬浮 `planSaved`；
- 「手填」→ 降级为悬浮 `manualBalanceLabel`（INV-9 本就说"悬浮 / 角标"二选一，不违约）；
- 付费类型列 72px → 56px（表头 52px 仍单行），省下的宽度给其余列；
- 余额状态文案（非金额）挂 `title` 保全全文（列窄时不被省略号吃掉）。

SPEC 同步修订：`FINANCE-PRICING-SPEC.md` §5.4 新增「表格 tag 纪律」、§10.5 重写。
**判定原则**：tag 只在它本身是"分类值"时留在表内（付费类型符合），"修饰/附加事实"
一律降级为悬浮或移进详情弹窗。

**代价（明写）**：额度触达从"扫一眼表格可见"降级为"点开详情可见"——
这是用户对该 trade-off 的显式裁决。摘要行文案沿用原 pill 三态，逐字不变。

**验收**：`preview:verify` 127/127；`dom-audit --pane finance` 在 1305px 与 560px 两个宽度下
**重叠 0 · 溢出 0 · 折行 0**；表格行高恢复一致（50px）、表头单行。

## 6. 附带修复：ui-kit `Pill` 静默丢弃调用方属性

**排查过程中实测发现**：`Pill` 原先只解构固定几个 prop、**不透传其余属性**，于是调用方传的
`data-testid` / `aria-label` 被静默丢弃。finance 的额度触达 pill 正是带着 SPEC §10.5
明确要求的 `aria-label` + `data-testid="finance-quota-{provider}"` 传进来的 ——
**实际 DOM 里两个都没有**：断言按这些选择器取值等于在验一个不存在的节点。

**修法**：`PillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'>` + `...rest` 透传
（可点分支渲染 `<button>`，同名属性安全）。**防线**：`panel.test.tsx` 直接对 ui-kit `Pill`
断言 `data-testid` / `aria-label` / `title` 在两种分支下都落到 DOM。

**同类排查**：其余 ui-kit 组件（Card / Money / StateDot / CellText 等）同样不透传 rest，
但调用点均未传会被丢弃的属性（`data-testid` 都挂在包裹 div 上），故本次不动 ——
**不做无消费者的预防式改动**。

## 7. 未做的（口径说明）

- hippomemo 进化页「运行并应用」等长任务仍走按钮 spinner；若将来单次进化超过 2s 且可估进度，
  按 UI-UX-SPEC §4.4 应升级为进度条（spinner 不能替代可估进度的进度条）。
- `packages/*/src` 中仍有若干**非异步**按钮（翻页、切换、筛选）不需要 loading，未动。
- real-host-check 的供应商表布局断言在**空账本沙箱里会显式 skip**（表格走空态）。
  第一版没记 skip，66/66 全绿但断言一次没跑 —— 典型的假绿。现已显式标注，且表内布局的
  真正判据放在有夹具数据的 `preview:verify` 与 `dom-audit --pane finance`。