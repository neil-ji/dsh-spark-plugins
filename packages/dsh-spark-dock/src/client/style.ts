/**
 * CSS for the Spark Dock ball + panel. Injected once at mount (style[data-plugin-css]).
 * Scoped under [data-plugin="dsh-spark-dock"] mirrors the demo preview (docs/spark-dock-preview).
 * Note: shell.overlay is click-through — every interactive surface here opts back in
 * with pointer-events: auto.
 */
export const DOCK_CSS = [
  '[data-plugin="dsh-spark-dock"] { pointer-events: auto; font-family: var(--dsw-font-family, -apple-system, "PingFang SC", sans-serif); }',

  /* 悬浮球 —— 2026-09 静默形态（角色层移除后的静态品牌标识）：
   * 形态 = 浮层面玻璃球（--spk-surface-float 92% + backdrop blur）+ 顶部冷光 + 内壁亮线；
   * 身份 = --ball-accent（默认 --spk-brand）只驱动「极淡染光 + hover 描边 + 外发光」三处，
   *        换一个变量即可整体改色（mood-alert/mood-sad 档位保留，供角色层恢复时复用）；
   * 动效 = 全量移除：无 keyframes、无 hover 缩放、无 transition。状态只靠
   *        描边色 / 投影 / 表面亮度区分（hover 收紧描边、按下压成内阴影、展开描边实色化）。
   * 标识色一律 --spk-brand-fg（亮 7.3:1 / 暗 6.5:1 on 球面），实色档 --spk-brand 只在暗色
   * 下压到 4.5:1 边缘，故不用于标识。 */
  '[data-plugin="dsh-spark-dock"] .dock-ball { --ball-accent: var(--spk-brand); --ball-ring: color-mix(in srgb, var(--ball-accent) 46%, var(--spk-border-2)); position: fixed; width: var(--dock-ball, 48px); height: var(--dock-ball, 48px); border-radius: 50%; display: grid; place-items: center; z-index: 9000; background: linear-gradient(180deg, color-mix(in srgb, var(--spk-n-0) 13%, transparent) 0%, color-mix(in srgb, var(--spk-n-0) 3%, transparent) 46%, transparent 100%), radial-gradient(124% 124% at 50% 2%, color-mix(in srgb, var(--ball-accent) 12%, transparent) 0%, transparent 64%), color-mix(in srgb, var(--spk-surface-float) 92%, transparent); border: 1px solid var(--spk-border-2); backdrop-filter: blur(var(--spk-blur)) saturate(1.3); -webkit-backdrop-filter: blur(var(--spk-blur)) saturate(1.3); box-shadow: var(--spk-shadow-2), 0 0 24px color-mix(in srgb, var(--ball-accent) 15%, transparent), inset 0 1px 0 color-mix(in srgb, var(--spk-n-0) 18%, transparent); color: var(--spk-brand-fg); cursor: pointer; touch-action: none; }',
  /* hover：描边收紧 + 染光加深，几何与尺寸不动 */
  '[data-plugin="dsh-spark-dock"] .dock-ball:hover { border-color: var(--ball-ring); box-shadow: var(--spk-shadow-2), 0 0 28px color-mix(in srgb, var(--ball-accent) 26%, transparent), inset 0 1px 0 color-mix(in srgb, var(--spk-n-0) 22%, transparent); }',
  /* active：读作「按下去」——抬升收回，落成内阴影 */
  '[data-plugin="dsh-spark-dock"] .dock-ball:active { box-shadow: var(--spk-shadow-1), inset 0 2px 6px color-mix(in srgb, var(--spk-n-950) 26%, transparent); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball.dragging { cursor: grabbing; border-color: var(--ball-ring); }',
  /* 展开：描边实色化 + 外发光加强，读作「已激活」，不靠呼吸吸引注意 */
  '[data-plugin="dsh-spark-dock"] .dock-ball[aria-expanded="true"] { border-color: var(--ball-accent); box-shadow: var(--spk-shadow-2), 0 0 30px color-mix(in srgb, var(--ball-accent) 24%, transparent), inset 0 1px 0 color-mix(in srgb, var(--spk-n-0) 18%, transparent); }',
  /* 情绪档（当前 dormant：Fairy 层未启用。恢复角色层时无需再动球身样式） */
  '[data-plugin="dsh-spark-dock"] .dock-ball.mood-alert { --ball-accent: var(--spk-warn); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball.mood-sad { --ball-accent: var(--spk-label-3); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball svg { width: 22px; height: 22px; overflow: visible; }',
  /* MASTER §5.3：focus ring 一律 --spk-focus-ring（≥3:1 非文本），禁移除 */
  '[data-plugin="dsh-spark-dock"] .dock-ball:focus-visible { outline: 2px solid var(--spk-focus-ring); outline-offset: 3px; }',
  '@media (prefers-reduced-motion: reduce) { [data-plugin="dsh-spark-dock"] .fairy-face, [data-plugin="dsh-spark-dock"] .fairy-face .ahoge { animation: none; } }',
  /* badge 环色 = 球面（v4.1 起球身是 surface-float 玻璃球，不再是平台底色） */
  /* 模块栏 tab 徽章（2026-09-16）：同色系但更小，适配 40×40 tab。
     a11y：DockModuleTab 已把数字并入 button 的 aria-label，徽章只做视觉提示，pointer-events: none 不挡焦点。 */

  /* 面板 —— 结构：flex row = 左 rail(56px) + 右主列 */
  '[data-plugin="dsh-spark-dock"] .dock-panel { position: fixed; z-index: 9100; width: var(--dock-panel-w, 616px); max-width: calc(100vw - 32px); height: var(--dock-panel-h, 680px); max-height: calc(100vh - 32px); display: flex; flex-direction: row; background: var(--spk-platform); border: 1px solid var(--spk-border); border-radius: var(--spk-radius-xl); box-shadow: var(--dsw-shadow-lv3, 0 16px 48px rgba(10,18,38,.28)); overflow: hidden; color: var(--spk-label, #fff); opacity: 0; transform: scale(.94); pointer-events: none; transition: transform 220ms cubic-bezier(.34,1.56,.64,1), opacity 220ms ease; }',
  /* 关闭态只用 opacity/pointer-events（动画）+ 组件侧的 inert（可访问性与焦点序）。
     曾经还加过一层「延迟 transition 的 visibility:hidden」：它依赖过渡时钟，
     停帧环境（无头/后台）下永远翻不到 hidden，反而让验收口径不可复现（acc-20260917-2210 的 R-04）——
     inert 已足以让 .focus() 被拒绝、Tab 全部落在 shell，机制保持单一。 */
  '[data-plugin="dsh-spark-dock"] .dock-panel.open { opacity: 1; transform: scale(1); pointer-events: auto; }',

  /* 左侧图标模块栏（activity rail）——用抬起面而非 layer-2：
     layer-2 是「凹陷/轨道」色，亮色下与面板 platform 几乎同色，且模块 accent 文字压上去只有 1.9-3.7:1。 */
  '[data-plugin="dsh-spark-dock"] .dock-rail { width: 56px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0; background: var(--spk-surface-card); border-right: 1px solid var(--spk-border); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab { width: 44px; height: 44px; border-radius: var(--spk-radius-card); display: grid; place-items: center; position: relative; border: none; background: transparent; color: var(--spk-label-3); cursor: pointer; transition: background 160ms ease, color 160ms ease; }',
  '[data-plugin="dsh-spark-dock"] .dock-tab svg { width: 19px; height: 19px; }',
  '[data-plugin="dsh-spark-dock"] .dock-tab:hover { background: var(--spk-hover); color: var(--spk-label); }',
  /* 激活项：文字/图标走 accent 的文字态档，指示条走实色档 */
  '[data-plugin="dsh-spark-dock"] .dock-tab.active { color: var(--accent-fg, var(--spk-brand-fg)); background: color-mix(in srgb, var(--accent-fg, var(--spk-brand-fg)) 12%, transparent); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab.active::before { content: ""; position: absolute; left: -8px; top: 50%; transform: translateY(-50%); width: 3px; height: var(--spk-radius-xl); border-radius: 0 3px 3px 0; background: var(--accent); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab:focus-visible { outline: 2px solid var(--spk-brand); outline-offset: 2px; }',

  /* 右侧主列：模块头 / 子页 / 内容 */
  '[data-plugin="dsh-spark-dock"] .dock-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }',
  '[data-plugin="dsh-spark-dock"] .dock-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-head .titles { min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-head .name { font-size: var(--spk-text-lg); font-weight: 700; line-height: 1.3; color: var(--spk-label); }',
  '[data-plugin="dsh-spark-dock"] .dock-head .sub { font-size: var(--spk-text-sm); color: var(--spk-label-3); }',
  '[data-plugin="dsh-spark-dock"] .dock-head .spacer { flex: 1; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn { position: relative; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: transparent; border: none; color: var(--spk-label-2); cursor: pointer; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn::before { content: ""; position: absolute; inset: -5px; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn:hover { background: var(--spk-hover); color: var(--spk-label); }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn svg { width: 15px; height: 15px; }',

  /* 模块内子页 tab 已统一为 ui-kit SegmentedControl（fullWidth），原 .subtabbar 样式移除 */
  '[data-plugin="dsh-spark-dock"] .subtabbar { margin-bottom: var(--spk-gap-page, 12px); }',

  /* 通用内容件（卡片/行/pill/按钮/表单）。
     间距只引用 --spk-space-* / --spk-gap-page / --spk-gap-card 语义档，
     与四个插件面板同一套标度（统一边距的唯一真相来源在 ui-kit 的 token 层）。 */
  /* ── 面板内卡片的唯一形制：直接用 ui-kit 的 Card 组件 ──
   * 卡片 = 一个逻辑组：容器 + 头部（标题 / 右侧状态槽），组内字段不再重复写组名。
   * 形态与 hippomemo「记忆-进化」页同源（那页的 .hippomemo-section-card 与 ui-kit Card
   * 本是同一套边界/圆角/内距），所以这里不再自绘一套 dock-card，避免两套卡长得像但不一样。 */
  '[data-plugin="dsh-spark-dock"] .dock-stack { display: flex; flex-direction: column; gap: var(--spk-gap-page, 12px); }',
  /* Card 里的列表：行自带内距，所以卡身收紧到 4px、把 card gap 归零（行间距由行内距给） */
  '[data-plugin="dsh-spark-dock"] .dock-body .dock-list { display: flex; flex-direction: column; gap: 0; margin: calc(var(--spk-space-2, 8px) * -1) calc(var(--spk-space-1, 4px) * -1) calc(var(--spk-space-1, 4px) * -1); }',
  /* Card 头里的胶囊按钮：与字段同一档视觉（Card 头的 actions 槽位默认是图标/胶囊尺度） */
  '[data-plugin="dsh-spark-dock"] .dock-body button.dock-pill { font-size: var(--spk-text-sm); padding: 4px 8px; min-height: var(--spk-control-h-sm); }',
  '[data-plugin="dsh-spark-dock"] .dock-row { display: flex; align-items: center; gap: var(--spk-gap-card, 8px); padding: var(--spk-radius-md) var(--spk-radius-card); border-radius: var(--spk-radius-md); }',
  '[data-plugin="dsh-spark-dock"] .dock-row:hover { background: var(--spk-hover); }',
  '[data-plugin="dsh-spark-dock"] .dock-row .grow { flex: 1; min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-row .ttl { font-size: var(--spk-text-md); font-weight: 600; color: var(--spk-label); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-plugin="dsh-spark-dock"] .dock-row .meta { font-size: var(--spk-text-xs); color: var(--spk-label-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-plugin="dsh-spark-dock"] .dock-row.off .ttl { text-decoration: line-through; color: var(--spk-label-3); }',
  '[data-plugin="dsh-spark-dock"] .cryst { color: var(--spk-success); font-weight: 600; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill { position: relative; display: inline-flex; align-items: center; gap: var(--spk-space-1, 4px); font-size: var(--spk-text-xs); padding: 4px 8px; border-radius: var(--spk-radius-full); background: var(--spk-layer-2); border: 1px solid var(--spk-border); color: var(--spk-label-2); min-height: var(--spk-control-h-sm); cursor: pointer; }',
  /* PCQA-015：破坏性操作必须有可辨识的危险态。
     此前 `dock-pill danger` 类名挂在「丢弃」上却没有对应规则 —— 与「结晶/归档」逐项同款。 */
  '[data-plugin="dsh-spark-dock"] .dock-pill.danger { color: var(--spk-error); border-color: color-mix(in srgb, var(--spk-error) 45%, var(--spk-border)); }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.danger:hover:not(:disabled) { background: var(--spk-error-soft); }',
  /* 热区扩容：pill 视觉小，命中区向外扩 4px（≥ 触控下限的兜底） */
  '[data-plugin="dsh-spark-dock"] .dock-pill::before { content: ""; position: absolute; inset: -4px; border-radius: var(--spk-radius-full); }',
  '[data-plugin="dsh-spark-dock"] .dock-pill:disabled { opacity: .55; cursor: default; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.on { background: var(--accent-fg, var(--spk-brand-fg)); border-color: transparent; color: var(--spk-on-accent); }',
  '[data-plugin="dsh-spark-dock"] .dock-modbar { display: flex; align-items: center; gap: var(--spk-space-1, 4px); flex-wrap: wrap; }',
  '[data-plugin="dsh-spark-dock"] .dock-btn { display: inline-flex; align-items: center; gap: 8px; height: var(--spk-control-h, 32px); padding: 0 var(--spk-radius-lg); border-radius: var(--spk-radius-md); border: none; background: var(--spk-brand); color: var(--spk-on-brand); font: 600 var(--spk-text-md)/1 var(--dsw-font-family, inherit); cursor: pointer; }',
  '[data-plugin="dsh-spark-dock"] .dock-btn:hover { filter: brightness(1.08); }',
  '[data-plugin="dsh-spark-dock"] .dock-btn:disabled { opacity: .55; cursor: default; }',
  /* SPEC §4.2：破坏性操作走 danger 形制（错误实底 + 反白字），与主按钮区分 */
  '[data-plugin="dsh-spark-dock"] .dock-btn[data-variant="danger"] { background: var(--spk-error); color: var(--spk-on-error); }',
  /* 2026-09：边框对齐 ui-kit Input（border-2 可辨轮廓，SPEC §2.5），padding 收编语义 token */
  '[data-plugin="dsh-spark-dock"] .dock-field { width: 100%; box-sizing: border-box; background: var(--spk-layer-2); border: 1px solid var(--spk-border-2, var(--spk-border)); border-radius: var(--spk-radius-md); color: var(--spk-label); font: 400 var(--spk-text-md)/1.4 var(--dsw-font-family, inherit); padding: var(--spk-space-2) var(--spk-space-3); margin-bottom: var(--spk-gap-card, 8px); }',
  '[data-plugin="dsh-spark-dock"] .dock-field:hover { border-color: var(--spk-label-3, var(--spk-border-2)); }',
  '[data-plugin="dsh-spark-dock"] .dock-field:focus-visible { outline: 2px solid var(--accent, var(--spk-brand)); outline-offset: 1px; }',
  '[data-plugin="dsh-spark-dock"] .dock-field::placeholder { color: var(--spk-label-3); }',
  '[data-plugin="dsh-spark-dock"] textarea.dock-field { resize: vertical; }',
  '[data-plugin="dsh-spark-dock"] .dock-fieldrow { display: flex; align-items: center; gap: var(--spk-gap-card, 8px); min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-fieldrow .grow { flex: 1; min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-fieldrow .dock-field { margin-bottom: 0; }',
  '[data-plugin="dsh-spark-dock"] select.dock-field.sel { width: auto; }',
  '[data-plugin="dsh-spark-dock"] .dock-error { padding: 8px var(--spk-radius-md); border: 1px solid var(--spk-error); border-radius: 8px; color: var(--spk-error); font-size: var(--spk-text-sm); }',
  '[data-plugin="dsh-spark-dock"] .dock-ok { padding: 8px var(--spk-radius-md); border: 1px solid var(--spk-success); border-radius: 8px; color: var(--spk-success); font-size: var(--spk-text-sm); }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot { width: 9px; height: 9px; border-radius: 50%; background: var(--spk-label-3); display: inline-block; flex: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot.done { background: var(--spk-success); }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot.warn { background: var(--spk-warn); }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot.error { background: var(--spk-error); }',
  '[data-plugin="dsh-spark-dock"] .dock-row .amount { font-size: var(--spk-text-md); color: var(--spk-label); font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-spark-dock"] .dock-hint { font-size: var(--spk-text-xs); color: var(--spk-label-3); }',
  /* 屏下状态区：读屏可感知、视觉零占位（配 role=status 使用）。 */
  '[data-plugin="dsh-spark-dock"] .dock-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-btn.ghost { background: transparent; border: 1px solid var(--spk-border-2); color: var(--spk-label-2); }',
  '[data-plugin="dsh-spark-dock"] .dock-btn.ghost:hover { color: var(--spk-label); }',
  '[data-plugin="dsh-spark-dock"] .dock-scopes { font-size: var(--spk-text-xs); color: var(--spk-label-3); margin: 8px 0 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-hline { display: flex; align-items: center; justify-content: space-between; gap: var(--spk-gap-card, 8px); margin: 8px 0 2px; }',
  '[data-plugin="dsh-spark-dock"] .dock-hline b { font-size: var(--spk-text-sm); font-weight: 700; color: var(--spk-label); }',

  /* ── Fairy 表情层（docs/spark-dock-preview fairy.css 子集）──
   * 当前 **dormant**：角色层由 DockOverlay 的 FAIRY_LAYER_ENABLED 关闭，球内不再渲染
   * .fairy-face，这些规则不会被应用。保留是为了「一行恢复」：把开关置 true 即整套表情/
   * 动画回来（视觉资产与恢复路径见 design-system/spark-dock/MASTER.md §4.1）。 */
  '[data-plugin="dsh-spark-dock"] .fairy-face { width: 46px; height: 46px; overflow: visible; color: var(--spk-label, #fff); animation: dock-bob 3.4s ease-in-out infinite; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face .ahoge { transform-origin: 24px 9px; animation: dock-ahoge 2.8s ease-in-out infinite; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face .eyes-happy, [data-plugin="dsh-spark-dock"] .fairy-face .mouth-open, [data-plugin="dsh-spark-dock"] .fairy-face .mouth-frown, [data-plugin="dsh-spark-dock"] .fairy-face .acc-think { display: none; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face .blush { opacity: 0; }',
  '@keyframes dock-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.3px); } }',
  '@keyframes dock-ahoge { 0%,100% { transform: rotate(-9deg); } 50% { transform: rotate(9deg); } }',
  /* happy/cheer：弧形笑眼 + 腮红 + 弹跳 */
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-happy .eyes-normal, [data-plugin="dsh-spark-dock"] .fairy-face.mood-cheer .eyes-normal { display: none; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-happy .eyes-happy, [data-plugin="dsh-spark-dock"] .fairy-face.mood-cheer .eyes-happy { display: block; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-happy .blush, [data-plugin="dsh-spark-dock"] .fairy-face.mood-cheer .blush { opacity: .55; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-cheer { animation: dock-bounce .55s ease-in-out infinite; }',
  '@keyframes dock-bounce { 0%,100% { transform: translateY(0); } 45% { transform: translateY(-5px) scale(1.03); } }',
  /* alert：张嘴 + 呆毛闪烁 */
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-alert .mouth-smile { display: none; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-alert .mouth-open { display: block; transform: scale(.72); transform-box: fill-box; transform-origin: center; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-alert .ahoge { animation: dock-flash 1s ease-in-out infinite; }',
  '@keyframes dock-flash { 0%,100% { opacity: 1; } 50% { opacity: .35; } }',
  /* think：思考泡 */
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-think .acc-think { display: block; }',
  /* sad：委屈嘴 */
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-sad .mouth-smile { display: none; }',
  '[data-plugin="dsh-spark-dock"] .fairy-face.mood-sad .mouth-frown { display: block; }',

  /* ── 播报气泡（事件文本，零动画）──
   * 材质对齐 ui-kit Toast：浮层面 + `--spk-border` + `--spk-shadow-2` + 12 圆角 + 3px 品牌脊线，
   * 让「球旁一句话」读作同一浮层家族（原来是平台底色，比面板还暗，压不住背景）。
   * 文字两档：正文 = `--spk-label`（12:1 暗 / 16.9:1 亮），来源 = `--spk-label-2`
   * （5.6 / 6.9）—— `--spk-label-3` 在暗色浮层面上只有 4.39:1，不达 AA，故不用。
   * 出现与消失都是瞬时的（无 transition / keyframes），mood 只在表情层开启时参与。
   * `width: max-content` 是关键：气泡是 shrink-to-fit 的 fixed 元素，若不钉宽度，它的
   * 「静态位置」在浮层容器里可能贴着视口右侧，可用宽度只剩几十像素 —— 文案会被折成五行的
   * 竖条（定位 JS 量到的 offsetWidth 也随之偏小，最终 left 再被错误夹取）。显式 max-content
   * 让宽度只由文案与 max-width 决定，与容器布局彻底解耦。 */
  '[data-plugin="dsh-spark-dock"] .dock-bubble { position: fixed; z-index: 9300; width: max-content; max-width: min(250px, calc(100vw - 24px)); padding: 8px var(--spk-radius-card); border-radius: var(--spk-radius-card); background: var(--spk-surface-float); border: 1px solid var(--spk-border); border-left: 3px solid var(--spk-brand); box-shadow: var(--spk-shadow-2); color: var(--spk-label); font: 500 var(--spk-text-sm)/1.5 var(--spk-font); pointer-events: auto; }',
  '[data-plugin="dsh-spark-dock"] .dock-bubble .src { display: block; margin-top: 2px; font-size: var(--spk-text-xs, 11px); font-weight: 400; color: var(--spk-label-2); }',
  '[data-plugin="dsh-spark-dock"] .dock-bubble.mood-alert { border-left-color: var(--spk-warn); }',
  '[data-plugin="dsh-spark-dock"] .grow-spacer { flex: 1; }',
  '[data-plugin="dsh-spark-dock"] .dock-statrow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-stat .k { font-size: var(--spk-text-xs); color: var(--spk-label-3); }',
  '[data-plugin="dsh-spark-dock"] .dock-stat .v { font-size: var(--spk-text-xl); font-weight: 700; margin-top: 2px; color: var(--spk-label); font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-spark-dock"] .dock-narr { display: flex; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--spk-border); font-size: var(--spk-text-xs); color: var(--spk-label-2); }',
  '[data-plugin="dsh-spark-dock"] .dock-narr .lab { flex: none; color: var(--spk-label-3); }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.mini { padding: 1px 8px; font-size: var(--spk-text-xs); cursor: default; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.mini.accent { background: color-mix(in srgb, var(--accent-fg, var(--spk-brand-fg)) 14%, transparent); border-color: transparent; color: var(--accent-fg, var(--spk-brand-fg)); }',
  '[data-plugin="dsh-spark-dock"] .dock-body { flex: 1; overflow-y: auto; scrollbar-gutter: stable; overscroll-behavior: contain; padding: 14px 16px; font-size: var(--spk-text-title); line-height: 1.5; }',
  '[data-plugin="dsh-spark-dock"] .dock-empty { padding: 28px 12px; text-align: center; color: var(--spk-label-3); }',
  '[data-plugin="dsh-spark-dock"] .dock-empty .empty-ico { width: 26px; height: 26px; opacity: .55; margin-bottom: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-empty .empty-txt { font-size: var(--spk-text-md); color: var(--spk-label-2); }',
  '[data-plugin="dsh-spark-dock"] .dock-empty .empty-hint { font-size: var(--spk-text-xs); margin-top: 4px; color: var(--spk-label-3); }',
  '[data-plugin="dsh-spark-dock"] .dock-empty.loading .empty-ico { animation: dock-empty-pulse 1.4s ease-in-out infinite; }',
  '@keyframes dock-empty-pulse { 0%,100% { opacity: .25; } 50% { opacity: .7; } }',
  /* 连接器模块：加载 spinner 与明确的失败态 */
  '[data-plugin="dsh-spark-dock"] .dock-spin { display: inline-block; width: var(--spk-radius-lg); height: var(--spk-radius-lg); margin-right: 8px; vertical-align: -2px; border-radius: 50%; border: 2px solid var(--spk-border); border-top-color: var(--accent, var(--spk-brand)); animation: dock-spin .8s linear infinite; }',
  '@keyframes dock-spin { to { transform: rotate(360deg); } }',
  '[data-plugin="dsh-spark-dock"] .dock-embed-failed { color: var(--spk-error, #f87171); font-size: var(--spk-text-md); line-height: 1.6; padding: 40px 24px; }',
  /* 面板内滚动条：细圆角深色，替代系统箭头滚动条 */
  '[data-plugin="dsh-spark-dock"] .dock-body::-webkit-scrollbar, [data-plugin="dsh-spark-dock"] .dock-embed ::-webkit-scrollbar { width: 8px; height: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-body::-webkit-scrollbar-thumb, [data-plugin="dsh-spark-dock"] .dock-embed ::-webkit-scrollbar-thumb { background: var(--spk-border, rgba(255,255,255,.14)); border-radius: 4px; }',
  '[data-plugin="dsh-spark-dock"] .dock-body::-webkit-scrollbar-thumb:hover, [data-plugin="dsh-spark-dock"] .dock-embed ::-webkit-scrollbar-thumb:hover { background: var(--spk-border-2, rgba(255,255,255,.24)); }',
  '[data-plugin="dsh-spark-dock"] .dock-body::-webkit-scrollbar-track, [data-plugin="dsh-spark-dock"] .dock-embed ::-webkit-scrollbar-track { background: transparent; }',
  '[data-plugin="dsh-spark-dock"] .dock-body, [data-plugin="dsh-spark-dock"] .dock-embed { scrollbar-width: thin; scrollbar-color: var(--spk-border, rgba(255,255,255,.14)) transparent; }',
  /* 可见表单标签（替代 placeholder-only） */
  '[data-plugin="dsh-spark-dock"] .dock-lab { display: block; font-size: var(--spk-text-xs); font-weight: 600; color: var(--spk-label-2); margin: 0 2px 4px; }',
  '[data-plugin="dsh-spark-dock"] .dock-btn .btn-ico { width: 13px; height: 13px; flex: none; }',

  /* ── 深度重做：spark 模块 ── */
  /* 捕获卡：一条输入流 + 渐进披露 */
  '[data-plugin="dsh-spark-dock"] .dock-capture { display: flex; flex-direction: column; gap: var(--spk-gap-card, 8px); }',

  '[data-plugin="dsh-spark-dock"] .dock-capture-bar { display: flex; align-items: center; gap: var(--spk-gap-card, 8px); margin-top: var(--spk-gap-card, 8px); }',
  '[data-plugin="dsh-spark-dock"] .dock-details { margin-top: var(--spk-gap-card, 8px); }',
  '[data-plugin="dsh-spark-dock"] .dock-details summary { cursor: pointer; font-size: var(--spk-text-sm); color: var(--spk-label-3); user-select: none; width: fit-content; padding: 4px 0; list-style: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-details summary::-webkit-details-marker { display: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-details summary::before { content: "＋ "; }',
  '[data-plugin="dsh-spark-dock"] .dock-details[open] summary::before { content: "－ "; }',
  '[data-plugin="dsh-spark-dock"] .dock-details summary:hover { color: var(--spk-label-2); }',
  '[data-plugin="dsh-spark-dock"] .dock-details-body { display: flex; flex-direction: column; gap: var(--spk-gap-card, 8px); margin-top: var(--spk-gap-card, 8px); }',
  '[data-plugin="dsh-spark-dock"] .dock-details-body .dock-field { margin-bottom: 0; }',
  /* 计量条：宽度即数值，配文本说明 */
  '[data-plugin="dsh-spark-dock"] .dock-meter { display: inline-block; width: 72px; height: 4px; border-radius: 2px; background: var(--spk-layer-2, rgba(255,255,255,.09)); overflow: hidden; flex: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-meter-fill { display: block; height: 100%; border-radius: 2px; background: var(--accent, var(--spk-brand)); transition: width 300ms cubic-bezier(.2,.8,.2,1); }',
  '[data-plugin="dsh-spark-dock"] .dock-meter.tone-good .dock-meter-fill { background: var(--spk-success); }',
  '[data-plugin="dsh-spark-dock"] .dock-meter.tone-warn .dock-meter-fill { background: var(--spk-warn); }',
  '[data-plugin="dsh-spark-dock"] .dock-row-meter, [data-plugin="dsh-spark-dock"] .dock-prop-meter { display: flex; align-items: center; gap: 8px; margin-top: 4px; }',
  /* 结晶行首圆点（除文字外再给一个颜色通道） */
  '[data-plugin="dsh-spark-dock"] .dock-row-dot { width: var(--spk-radius-sm); height: var(--spk-radius-sm); border-radius: 50%; flex: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-row-dot.cryst { background: var(--spk-success); }',
  /* 提案行：Card 内部的**行**（一个提议一行），不是卡片 —— 卡片归组，
   * 组内的条目靠 1px 分隔线分层，免得卡里再套一层卡。 */
  '[data-plugin="dsh-spark-dock"] .dock-prop { display: flex; flex-direction: column; gap: 8px; padding: 8px 0; border-top: 1px solid var(--spk-border); }',
  '[data-plugin="dsh-spark-dock"] .dock-prop:first-child { padding-top: 0; border-top: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-prop + .dock-prop { margin-top: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-prop-head { display: flex; align-items: center; gap: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-prop-type { font-size: var(--spk-text-xs); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 8px; border-radius: 6px; background: color-mix(in srgb, var(--accent-fg, var(--spk-brand-fg)) 14%, transparent); color: var(--accent-fg, var(--spk-brand-fg)); }',
  '[data-plugin="dsh-spark-dock"] .dock-prop-text { font-size: var(--spk-text-md); line-height: 1.5; color: var(--spk-label); }',
  '[data-plugin="dsh-spark-dock"] .dock-prop-actions { display: flex; gap: 8px; margin-top: 2px; }',
  '[data-plugin="dsh-spark-dock"] .dock-prop-actions .dock-btn { height: 28px; padding: 0 14px; font-size: var(--spk-text-sm); }',

  /* ── 内嵌页 compat 层（2026-09 UIUX 收敛 / 2026-09 重构二轮）────────────
   * 原则：**重复的标题在结构上不该存在**，不是渲染完再用 CSS 擦掉。
   * 曾经这里压过 hippomemo 的 `.hippomemo-title/.hippomemo-intro` 与连接器 section 的
   * `h2 + p` —— 那两处已由组件自己的 `embedded` 属性接管（MemorySection /
   * FinanceAuditSection 直接不渲染；github/npm 的 section 早已无页级标题）。
   * 这里只保留**密度**：设置页 16px 基准 → overlay 13px，不碰组件内部业务样式。 */
  /* pane 本体是 flex column：分栏与内容同级时补出 --spk-gap-page 这一档
     （PCQA-007：原来火花/连接器的「分栏→首块」是 0，财务 12、记忆 14 三档并存）。
     模块把分栏包在自己的容器里时（hippomemo/finance）只有一个直接子元素，
     这条 gap 不生效，间距由模块自己的容器 gap 负责。 */
  '.dock-embed { display: flex; flex-direction: column; gap: var(--spk-gap-page); font-size: var(--spk-text-md); line-height: 1.45; }',
  '.dock-embed :is(h1, h2) { font-size: var(--spk-text-lg); line-height: 1.35; margin: 0 0 8px; }',
  '.dock-embed :is(h3) { font-size: var(--spk-text-title); font-weight: 600; margin: 0 0 8px; }',
  '.dock-embed p { font-size: var(--spk-text-md); }',
  /* hippomemo 分段控件通栏（与 dock subtabbar 同宽对齐） */
  '[data-plugin="dsh-spark-dock"] .hippomemo-tabs { align-self: stretch; }',
  /* connector 按钮不被 flex column 拉伸成全宽白胶囊，回落紧凑尺寸。
     用 width 而不是 align-self：align-self: flex-start 在**横排**里会覆盖
     行自身的 align-items: center，把按钮顶到输入框上沿（36px 输入 vs 32px
     按钮 → 4px 错位，看起来像压住）。width: fit-content 在纵排里同样阻止
     拉伸，却不干扰横排的垂直居中。 */
  '.dock-embed-connector button { width: fit-content; }',
].join('\n')
