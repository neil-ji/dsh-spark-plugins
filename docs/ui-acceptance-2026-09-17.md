# PC 端插件 UI 验收修复报告（acc-20260917-1906）

- **来源报告**：`acceptance-dsh-spark-plugins-20260917-1906.md`（外部 PC 端验收，P0 0 / P1 1 / P2 8 / P3 9 + 推断 3）
- **基线**：`cf6e228e8a26fa8e024c5d7fc65d54c6ef251a3b`（main）
- **处置**：P1 1/1 关闭 · P2 8/8 关闭 · P3 9/9 关闭 · 推断 3 条全部裁决（2 条判定为口径问题并写进规范、1 条判定为无需改动）
- **验收链**：`pnpm -r build` 0 · `pnpm -r typecheck` 0 · `pnpm -r test` 0 · `npx vitest run` 314/314 ·
  `pnpm check:all` PASS · `pnpm preview:verify` 87/87 · `dev-harness/real-host-check.mjs` **50/50 退出码 0**
- **改了什么**：6 个包（ui-kit / dock / hippomemo / github-ui / npm-ui / finance-client）+ 2 个闸门 + 1 个宿主断言段 + 4 份文档

---

## 1. 处置总表

| ID | 级 | 问题 | 处置 | 关闭口径（这一条解决了什么） |
|---|---|---|---|---|
| PCQA-001 | P1 | 关闭态面板仍在 Tab 序与焦点里 | 修 | 关闭态 = `inert`（**单一机制**；v2 曾加一层「延迟过渡的 visibility:hidden」，因依赖过渡时钟而不可复现，见 §8 已删除）；收起时焦点回球。真宿主断言：关闭态 inert、Tab 不落进面板、Esc 后焦点在球上 |
| PCQA-002 | P2 | 视口变化后球停在旧坐标 | 修 | 位置记忆加 `snapped` 标记：吸附态 resize 时重吸附最近角，方向键微调过的自由位置只夹回视口 |
| PCQA-003 | P2 | GitHub 把宿主英文错误直抛用户 | 修 | 客户端前置判空直出本地化文案 + 已知错误形态映射到 locale key + 未知错误「本地化前缀 + 原始 message（进 title）」，与 npm 模块同风格 |
| PCQA-004 | P2 | 子页签不支持方向键、4 个 Tab 停靠点 | 修 | ui-kit SegmentedControl：ArrowLeft/Right + Home/End 自动激活，roving tabindex（只有选中项 tabindex=0） |
| PCQA-005 | P2 | 菜单开着时 Esc 关掉整个面板 | 修 | Menu/Modal 用 `data-spk-layer` 自我标记；面板级 Esc 检测到内层浮层就让路。Esc 先关菜单、焦点回触发钮、面板保持打开 |
| PCQA-006 | P2 | 可见性控件可访问名不含可见文本、无展开语义 | 修 | `aria-label="默认可见性：私有"`（含可见文本）+ `aria-haspopup="listbox"` + `aria-expanded`；ui-kit Menu 再用 cloneElement 注入同值兜底 |
| PCQA-007 | P2 | 浅色副标题对比度 3.42:1 | 修 | 根因是**直连了宿主别名**（真宿主给 #81858C，桥接层给 #5F6A7D，闸门按桥接算）。`.dock-head .sub` 改直连 `--spk-label-3`；真宿主实测 sub 色 = spk 值 ≠ 宿主别名 |
| PCQA-008 | P3 | 双击复位未实现 | 修 | 双击球复位默认右下角（带过渡 + 重新吸附 + 持久化） |
| PCQA-009 | P3 | 缺方向键微调（WCAG 2.2 AA 拖拽替代） | 修 | 聚焦球后方向键 8px 微调（Shift 24px），夹取视口并持久化 |
| PCQA-010 | P3 | 面板尺寸/操作簇与设计文档漂移 | 改文档 | 以代码为准：616×680、header ~56px、rail 56px「固定/浮窗(pin)」从未实现 → 从文档删除 |
| PCQA-012 | P3 | 字号绑定圆角 token（`.dock-prop-type` 实测 10px） | 修 + 闸门 | 字号收编 `--spk-text-xs`（11px）；气泡/错误/成功条同类误用一并改；`audit-tokens` 新增「字号不得绑定非字号 token」规则 |
| PCQA-013 | P3 | 连接失败时 live 区播报「已保存」 | 修 | 反馈收敛成单一可辨识联合（成功/失败二选一）：失败支根本不渲染成功播报，同屏两条矛盾文案在**类型层不可表示**；错误文案自带 `role="status" aria-live="polite"` |
| PCQA-014 | P3 | 「捕获」禁用不给原因 | 修 | 空输入时提示行给「输入内容后可捕获」，并用 `aria-describedby` 把原因挂到按钮上 |
| PCQA-015 | P2 | 破坏性「丢弃」与安全操作同款 | 修 + 闸门 | `.dock-pill.danger` 补上规则（此前类名挂着没样式）；Modal 里 `data-variant="danger"` 同样补样式；对比度表新增 `error on layer-2`（危险胶囊的实际底面） |
| PCQA-016 | P3 | 两套色彩体系（四种灰/模块间不一致） | 修 + 闸门 | 插件源码全部改直连 `--spk-*`：dock 36 处、hippomemo 106 处；`check:contrast` 新增「插件源码直连宿主 token」段（非零即失败） |
| PCQA-017 | P3 | 卡片题 13px 与规范/组件不一致 | 修 | `.dock-embed h3` → `--spk-text-title`（14px/600，与 ui-kit Card.title 同档） |
| PCQA-018 | P3 | 内容列右边缘随滚动条跳 10px | 修 | `.dock-body` 加 `scrollbar-gutter: stable` |
| PCQA-019 | P2 | 按钮形制不统一 | 修 + 规范 | github 测试连接 primary→secondary、私有按钮 26→32 同卡统一；npm 测试连接 sm→md；finance 7 处隐式 primary 收编（刷新/行内编辑/返回→secondary，移除/还原→danger，行内表单保存→secondary、取消→ghost）。SPEC §3.1 增补「操作域」的可操作定义 |
| PCQA-020 | 推断 | 子页签 24px / 筛选胶囊 23px 低于 26px | 修 + 规范 | SegmentedControl 页签 7px 内距 → 26px；胶囊 `min-height: var(--spk-control-h-sm)`;新增 token `--spk-control-h-sm: 26px`；SPEC §4.5 写清「内联控件 ≥26 / 图标入口 ≥44」两类口径 |
| PCQA-I01 | 推断 | 徽标红=告警嫌疑 | 裁决：不改语义 | 「红点=待处理计数」是通知惯例，保留 error 语义；但改走 `--spk-error`/`--spk-on-error`（`on-error on error fill` 已是闸门内配对），不再是闸门测不到的宿主色 |
| PCQA-I02 | 推断 | rail 命中区 40×40 与文档冲突 | 修 + 规范 | rail 模块钮 40→44（满足更严的那份文档）；两份文档的口径冲突按「内联控件 26 / 图标入口 44」收口，写进 SPEC §4.5 |

---

## 2. 根因：两条结构性问题

### 2.1 插件直连宿主别名 `--dsw-alias-*`，闸门与真宿主看到的是两个值

真宿主里 `--dsw-alias-*` **由宿主自己定义**（dsh-web-frontend 的 boot/主题层），ui-kit 的
`dsw-bridge.css` 只是「预览态兜底」。两者取值不同，实测（真宿主 light）：

| token | 桥接层（= 闸门/预览所见） | 真宿主（= 用户所见） |
|---|---|---|
| `--dsw-alias-label-tertiary` | #5F6A7D（= `--spk-label-3`） | **#81858C** |
| `--dsw-alias-label-secondary` | #525B6B（= `--spk-label-2`） | **#CFD3D6** |
| `--dsw-alias-state-error-primary` | #C62828/#F87171 | #F25A5A 系 |

于是 `check:contrast` 的 154 项全绿，真宿主上 dock 副标题只有 **3.42:1**（PCQA-007），
并且同一角色出现四种灰（PCQA-016）。**修复 = 插件 UI 直连 `--spk-*`**（这次全仓清零），
并把这条写成闸门（例外只有字体栈与阴影：不参与对比度、刻意与 shell 同源）。
本轮真宿主断言直接证明了这一点：`sub = rgb(134,142,160)`（spk）`≠ hostAlias rgb(173,178,184)`。

### 2.2 隐式 primary + 缺失的危险态

`<Button>` 不写 variant 就是实心 primary，于是「刷新/行内编辑/返回」这类次操作也长成主操作，
一屏出现 2–3 个实心按钮；`className="dock-pill danger"` / `data-variant="danger"` 则是
**挂了标记但没写规则**（意图与实现脱节，PCQA-015）。修复：形制逐个显式化 + 补齐 danger 规则 +
SPEC 把「一屏一个 primary」定义到「操作域」粒度。

---

## 3. 新增防线（AGENTS §5：新防线进闸门脚本）

| 防线 | 位置 | 断言 |
|---|---|---|
| 插件源码禁直连宿主 token（`--dsw-alias-*`/`--dsw-static-*`，字体栈与阴影例外） | `scripts/audit-contrast.mjs` 新增段 | 当前 0 处；非零即失败 |
| 字号不得绑定非字号 token（radius/space/gap/pad/control） | `scripts/audit-tokens.mjs` 新增第 4 条规则 | 当前 PASS（负例验证过能抓 `font-size: var(--spk-radius-md)`） |
| 危险胶囊的实际底面也要过对比度 | `scripts/audit-contrast.mjs` 新增配对 `error on layer-2` | 156 项全绿 |
| 本轮 20 条 PCQA 回归断言 | `dev-harness/real-host-check.mjs` 新增第 6 段（6a–6g） | 50/50 通过，退出码 0 |

> 顺带修掉一条**数据依赖的旧断言**：`旧 status 查询参数已失效` 原本断言 `archived === 0`，
> 而验收轮自己会归档火花（acc-20260917 归档了 1 条），该断言当轮即翻红。现在断言改为不变量
> ——`status=` 返回全量、`inboxState=` 返回真子集（`legacy === all && modern < all`）。

---

## 4. 口径修订（先改规范，再改代码）

- **AGENTS.md §3.2**：颜色规则追加「插件 UI 直连 `--spk-*`，禁直连 `--dsw-alias-*`/`--dsw-static-*`」，
  闸门清单同步。
- **docs/UI-UX-SPEC.md**
  - §2.1：直连规则 + 「次要文字三档语义 token」（label / label-2 / label-3 的角色表）;
  - §3.1：「一屏一个 primary」的操作性定义（以 Card / `role=group` / 页脚操作组为「操作域」，每域一个；
    跨域并列须评审说明理由 —— github「连接卡保存」+「页脚保存配置」为既有例外）;
  - §4.5：点击目标两类口径（内联控件 ≥26px，图标入口 ≥44×44）+ ui-kit 内部嵌套圆角/内距豁免;
  - §7：两条新闸门入册。
- **docs/spark-dock-design.md**：§3 尺寸/结构/pin 以代码为准 + 关闭态焦点规则；
  §4 视觉系统改「直连 spark token 层」；§6 命中区引用 SPEC §4.5。

---

## 5. 验收证据（2026-09-17）

| 面 | 命令 | 结果 |
|---|---|---|
| 构建 | `pnpm -r build` | 退出码 0（含 ui-kit 0.6.2 / dock 0.3.3 / hippomemo 0.3.1 / github-ui 0.2.8 / npm-ui 0.2.10 / finance-client 0.5.8） |
| 类型 | `pnpm -r typecheck` | 退出码 0（0 error TS） |
| 测试 | `pnpm -r test` | 退出码 0：hippomemo 108 / spark 111 / finance 231 / finance-client 58 / **github-ui 12（本轮新增）** |
| 根测试 | `npx vitest run` | 314/314 通过（14 文件） |
| 闸门 | `pnpm check:all` | PASS：架构 0 硬失败 0 告警（158 文件 / 741 import，依赖边界 0 违规）· 价格 0 处 · 对比度 156 项（亮暗各 78）0 不达标 · audit-tokens PASS · 版本纪律 0 漏 bump |
| 预览 | `pnpm preview:verify` | **87/87** 通过，退出码 0 |
| 真宿主 | `pnpm sandbox:install` + 重启（tarball 拷贝形态 16 包）+ `node dev-harness/real-host-check.mjs` | **50/50** 通过，退出码 0；控制台 0 条 |

真宿主 PCQA 段实测（节选）：

```
ok  PCQA-001 关闭态面板 inert + visibility:hidden   {"open":false,"inert":true,"visibility":"hidden","focusOnBall":true}
ok  PCQA-001 关闭态面板不参与 Tab 序列              {"inPanel":false,"where":"收起侧边栏"}
ok  PCQA-002 视口缩小后重吸附右下角                 {"got":["1036px","636px"],"want":["1036px","636px"]}
ok  PCQA-009 方向键微调（← -8 / ↑ -8）              {"before":{"x":1376,"y":836},"mid":{"x":1368,"y":836},"up":{"x":1368,"y":828}}
ok  PCQA-008 双击复位右下角                        {"x":1376,"y":836,"wantX":1376,"wantY":836}
ok  PCQA-007/016 副标题直连 --spk-label-3           {"sub":"rgb(134, 142, 160)","spkLabel3":"rgb(134, 142, 160)","hostAlias":"rgb(173, 178, 184)"}
ok  PCQA-012 提案类型标签 11px                      {"font":"11px"}
ok  PCQA-017 卡片题 14px                            {"font":"14px"}
ok  PCQA-020 胶囊 ≥26px                             {"height":26}
ok  PCQA-015 危险态可辨                             danger rgb(248,113,113) ≠ plain rgb(154,161,175)
ok  PCQA-018 scrollbar-gutter: stable               stable
ok  PCQA-014 空输入给原因文案                       {"disabled":true,"described":"spark-capture-hint","hint":"输入内容后可捕获"}
ok  PCQA-004 子页签方向键 + roving                  {"tabIndexes":[0,-1,-1,-1],"sel":1,"focused":1}
ok  PCQA-006 可见性控件 aria                        {"label":"默认可见性：私有","haspopup":"listbox","expanded":"true"}
ok  PCQA-005 Esc 先关菜单、面板不关                 {"panelOpen":true,"menu":false,"focus":"私有"}
50/50 项通过
```

---

## 6. 提交清单（`cf6e228..HEAD`，10 个 commit，版本纪律闸门 0 漏 bump）

| commit | 内容 | 版本 |
|---|---|---|
| `b14b1fe` | fix(ui-kit)：段控方向键/roving、Menu Esc 焦点归还、`--spk-control-h-sm` | ui-kit 0.6.2 |
| `3d11510` | fix(dock)：焦点序/重吸附/双击/方向键 + 直连 `--spk-*` 与危险态 | dock 0.3.3 |
| `928415b` | fix(hippomemo)：样式直连 `--spk-*`（106 处） | hippomemo 0.3.1 |
| `fcbc401` | fix(github-ui)：错误本地化、可见性 aria、单一反馈通道、按钮形制 | github-ui 0.2.8 |
| `2c79d73` | fix(npm-ui)：令牌卡内次按钮同标度 | npm-ui 0.2.10 |
| `10e4545` | fix(finance-client)：一屏一 primary、刷新/回退形制收编 | finance-client 0.5.8 |
| `9343d32` | test(harness)：real-host-check 增 PCQA 回归断言段 | — |
| `a2b68fe` | chore(gates)：对比度禁直连宿主 token、token 禁跨类字号 | — |
| `2ab47bf` | docs(agents)：直连 `--spk-*`、点击目标、单 primary 口径 | — |
| （本提交） | docs(ui)：本报告 | — |

---

## 7. 遗留 / 待裁决

1. **GitHub 页脚「保存配置」仍是 primary**：草稿被改脏时与卡片内「保存令牌」同时在屏（跨操作域并列）。
   本轮按报告口径保留（「连接页模板：测试连接 secondary + 保存 primary」），SPEC §3.1 记为既有例外；
   若要严格单 primary，把页脚保存降为 secondary 即可（一行）。
2. **「还原到发版快照」只做到 danger 形制**，未做 §4.2 模板 4 的「独立危险区卡片 + 二次确认 Modal」——
   属行为变更（新增 2 个 locale key + Modal 状态），留给排期。
3. **Modal 头部关闭钮 `aria-label="关闭"` 是 ui-kit 里的中文硬编码**（组件无 locale 通道，非本轮报告项）。
   建议 ui-kit 加 `closeAriaLabel` prop，由各模块传 `t()`。
4. **PCQA-013 的点击级证据**由本轮真宿主段补上（菜单/Esc 那套流程走的是真浏览器）；
   github-ui 另有 12 项单测（SSR 渲染 + 纯函数映射）作为组件级防线。
5. **`dev-harness/` 下 4 个未跟踪探针脚本**（`panel-sweep*.mjs` / `probe*.mjs`）是上轮验收留下的，
   基线报告已如实记录；本轮未动、未提交。

---

## 8. 复核轮回修（acc-20260917-2210，2026-09-17 深夜）

外部复核轮在真宿主重放了全部 18 条：**15 条确认已修、1 条未修（R-02 = PCQA-005）、1 条部分修（R-03 = PCQA-017 剩余）、2 条观察（R-01/R-04）**。四条里有三条**同一个根因**：本轮修复中有三处依赖了浏览器的**动画帧/过渡时钟**，而复核环境（无头 + 桌面会话不可交互）里那个时钟是停的。

| 复核项 | 复核现象 | 根因 | 回修 |
|---|---|---|---|
| **R-02**（P2，PCQA-005 未修） | 菜单开着按 Esc 仍关掉整个面板（3/3） | 面板的「内层浮层」判定是 `querySelector` + `getComputedStyle().opacity !== '0'`；菜单入场动画在停帧环境停在 opacity:0 → 判定成「没有浮层」 | ① ui-kit Menu/Modal 改为**捕获阶段**接手 Esc 并 `stopPropagation`（面板那侧根本收不到这次按键，与监听器注册顺序无关）；② dock 的兜底改为**只看节点是否存在**，不再读计算样式 |
| **R-01**（P3，新发现） | 段控方向键切换后焦点不跟随 | 焦点写在 `requestAnimationFrame` 里，停帧环境下 rAF 不跑 | 改为**同步** `focus()`：所有页签节点此刻都在 DOM 里，重渲染随后归位 tabindex |
| **R-04**（观察） | 关闭态面板 `visibility` 始终 visible | `transition: visibility 0s linear 220ms` 同样依赖过渡时钟 | **删掉这层保险**：把面板移出焦点序/无障碍树的机制只剩 `inert`（复核轮自己也实测证实 inert 足够：程序化 `.focus()` 被拒、10 次 Tab 全落 shell），口径里不再有 half-verified 的部分 |
| **R-03**（P3，PCQA-017 剩余） | 记忆模块卡片题仍 13px | `.hippomemo-panel-title` 是 (0,2,0)，压过 dock 的 `.dock-embed :is(h3)` (0,1,1) 兜底 | hippomemo 自己那套样式里改 `--spk-text-title`（14px/600） |

**采纳复核轮的方法学建议**：harness 的键盘断言从「JS 合成 KeyboardEvent」**全部换成 CDP 真按键**（`Input.dispatchKeyEvent`）—— 这正是 R-02 在本轮 harness 里「通过」而复核轮「失败」的原因（合成事件走的是简化路径）。同时补三条断言：真键盘下焦点在菜单项内时 Esc 只关菜单、内层关掉后第二次 Esc 才收面板、记忆模块卡片题 14px。

**回修后的验收**：`pnpm -r build / typecheck / test` 0 · `pnpm check:all` PASS（对比度 156 项）· `pnpm preview:verify` 87/87 · 真宿主 `real-host-check` **52/52 退出码 0**。版本：ui-kit 0.6.3 / dock 0.3.4 / hippomemo 0.3.2。

**顺带修掉 harness 自身两处脆弱读数**（不是产品缺陷，如实记录）：
1. 方向键微调原本「每次按键后紧读」，读到的是上一帧旧值 → 改为每次按键各等 500ms 再读，并在**丢键时重试一次**（CDP 背靠背连发两个 rawKeyDown 时第一个偶发丢失，复核轮与本机都遇到过）；断言仍要求「恰好一次 8px」，多走一步（-16）即失败，不会掩盖真问题。
2. 视口还原后的「重吸附」可能撞上紧跟着的微调按键（x 被吸回角落）→ 微调前先双击归一化并等 900ms。
