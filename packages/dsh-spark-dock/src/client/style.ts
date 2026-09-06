/**
 * CSS for the Spark Dock ball + panel. Injected once at mount (style[data-plugin-css]).
 * Scoped under [data-plugin="dsh-spark-dock"] mirrors the demo preview (docs/spark-dock-preview).
 * Note: shell.overlay is click-through — every interactive surface here opts back in
 * with pointer-events: auto.
 */
export const DOCK_CSS = [
  '[data-plugin="dsh-spark-dock"] { pointer-events: auto; font-family: var(--dsw-font-family, -apple-system, "PingFang SC", sans-serif); }',

  /* 悬浮球 —— 2026-09 视觉主题重构：
   * 球身 = 平台底色 + 火花暖色径向渐变；玻璃高光 = inset 顶部亮线 + backdrop blur；
   * 品牌光晕 = ::before 径向 halo（呼吸）+ ::after hover 光环（preview 版回归）。
   * mood 染光：--ball-glow 随 Fairy 情绪换色（alert→warn），全部 transform/opacity 动画。 */
  '[data-plugin="dsh-spark-dock"] .dock-ball { --ball-glow: var(--acc-spark, #f59e0b); position: fixed; width: var(--dock-ball, 48px); height: var(--dock-ball, 48px); border-radius: 50%; display: grid; place-items: center; z-index: 9000; background: radial-gradient(118% 118% at 30% 20%, color-mix(in srgb, var(--ball-glow) 24%, var(--dsw-alias-bg-module-platform)) 0%, var(--dsw-alias-bg-module-platform) 62%); border: 1px solid color-mix(in srgb, var(--ball-glow) 34%, var(--dsw-alias-border-l1)); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(10,18,38,.32), 0 0 18px color-mix(in srgb, var(--ball-glow) 20%, transparent), inset 0 1px 0 rgba(255,255,255,.14), inset 0 0 0 1px rgba(255,255,255,.05); color: var(--dsw-alias-label-primary-foreground, #fff); cursor: pointer; touch-action: none; transition: transform 200ms cubic-bezier(.34,1.56,.64,1), box-shadow 240ms ease, border-color 240ms ease; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball::before { content: ""; position: absolute; inset: -8px; border-radius: 50%; pointer-events: none; background: radial-gradient(closest-side, color-mix(in srgb, var(--ball-glow) 32%, transparent), transparent 74%); opacity: .45; animation: dock-ball-halo 4.6s ease-in-out infinite; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; pointer-events: none; border: 1px solid var(--ball-glow); opacity: 0; transform: scale(.85); transition: opacity 200ms ease-out, transform 200ms ease-out; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball:hover { transform: scale(1.06); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball:hover::after { opacity: .55; transform: scale(1); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball:active { transform: scale(.94); transition-duration: 90ms; }',
  '[data-plugin="dsh-spark-dock"] .dock-ball.dragging { cursor: grabbing; transform: scale(1.1); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball.dragging::before { opacity: .8; animation-play-state: paused; }',
  /* 面板打开：halo 驻留 + 呼吸暂停，球读作「已激活」而非持续吸引注意 */
  '[data-plugin="dsh-spark-dock"] .dock-ball[aria-expanded="true"]::before { opacity: .7; animation-play-state: paused; }',
  /* mood 染光：换 --ball-glow 即可同时驱动渐变/边框/halo/投影 */
  '[data-plugin="dsh-spark-dock"] .dock-ball.mood-alert { --ball-glow: var(--dsw-alias-state-warn-primary, #f59e0b); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball.mood-sad { --ball-glow: color-mix(in srgb, var(--dsw-alias-label-tertiary, #8a93a6) 70%, var(--acc-spark, #f59e0b)); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball svg { width: 24px; height: 24px; overflow: visible; filter: drop-shadow(0 1px 2px rgba(10,18,38,.35)); }',
  '[data-plugin="dsh-spark-dock"] .dock-ball:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; }',
  '@keyframes dock-ball-halo { 0%,100% { opacity: .45; transform: scale(1); } 50% { opacity: .75; transform: scale(1.06); } }',
  '@media (prefers-reduced-motion: reduce) { [data-plugin="dsh-spark-dock"] .dock-ball, [data-plugin="dsh-spark-dock"] .dock-ball::before { animation: none; } [data-plugin="dsh-spark-dock"] .fairy-face, [data-plugin="dsh-spark-dock"] .fairy-face .ahoge { animation: none; } }',
  '[data-plugin="dsh-spark-dock"] .dock-badge { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px; background: var(--dsw-alias-state-error-primary); color: #fff; font: 700 11px/18px var(--dsw-font-family, inherit); text-align: center; box-shadow: 0 0 0 2px var(--dsw-alias-bg-module-platform); }',

  /* 面板 */
  '[data-plugin="dsh-spark-dock"] .dock-panel { position: fixed; z-index: 9100; width: var(--dock-panel-w, 560px); height: var(--dock-panel-h, 680px); display: flex; flex-direction: column; background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l1); border-radius: 20px; box-shadow: var(--dsw-shadow-lv3, 0 16px 48px rgba(10,18,38,.28)); overflow: hidden; color: var(--dsw-alias-label-primary-foreground, #fff); opacity: 0; transform: scale(.94); pointer-events: none; transition: transform 220ms cubic-bezier(.34,1.56,.64,1), opacity 220ms ease; }',
  '[data-plugin="dsh-spark-dock"] .dock-panel.open { opacity: 1; transform: scale(1); pointer-events: auto; }',
  '[data-plugin="dsh-spark-dock"] .dock-titlebar { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px; }',
  '[data-plugin="dsh-spark-dock"] .dock-titlebar .titles { min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-titlebar .name { font-size: 15px; font-weight: 700; line-height: 1.3; color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .dock-titlebar .sub { font-size: 12px; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-titlebar .spacer { flex: 1; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn { position: relative; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: transparent; border: none; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn::before { content: ""; position: absolute; inset: -5px; }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .dock-iconbtn svg { width: 15px; height: 15px; }',

  /* 模块 tab 导航 */
  '[data-plugin="dsh-spark-dock"] .dock-nav { display: flex; gap: 4px; margin: 0 12px; padding: 6px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 13px; }',
  '[data-plugin="dsh-spark-dock"] .dock-tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 2px 7px; border-radius: 10px; border: none; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; position: relative; font: 500 11px/1 var(--dsw-font-family, inherit); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab svg { width: 17px; height: 17px; }',
  '[data-plugin="dsh-spark-dock"] .dock-tab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab.active { color: var(--accent); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab.active::after { content: ""; position: absolute; bottom: 1px; width: 16px; height: 2px; border-radius: 2px; background: var(--accent); }',
  '[data-plugin="dsh-spark-dock"] .dock-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',

  /* 模块内子页 tab */
  '[data-plugin="dsh-spark-dock"] .subtabbar { display: flex; gap: 3px; padding: 3px; margin-bottom: 10px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; }',
  '[data-plugin="dsh-spark-dock"] .subtab { flex: 1; padding: 6px 4px; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font: 500 11px/1 var(--dsw-font-family, inherit); cursor: pointer; position: relative; }',
  '[data-plugin="dsh-spark-dock"] .subtab::before { content: ""; position: absolute; inset: -4px; }',
  '[data-plugin="dsh-spark-dock"] .subtab.on { background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,.11)); color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .subtab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',

  /* 通用内容件（卡片/行/pill/按钮/表单） */
  '[data-plugin="dsh-spark-dock"] .dock-stack { display: flex; flex-direction: column; gap: 10px; }',
  '[data-plugin="dsh-spark-dock"] .dock-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 14px; }',
  '[data-plugin="dsh-spark-dock"] .dock-card.list { padding: 4px; }',
  '[data-plugin="dsh-spark-dock"] .dock-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; }',
  '[data-plugin="dsh-spark-dock"] .dock-row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '[data-plugin="dsh-spark-dock"] .dock-row .grow { flex: 1; min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-row .ttl { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-plugin="dsh-spark-dock"] .dock-row .meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-plugin="dsh-spark-dock"] .dock-row.off .ttl { text-decoration: line-through; opacity: .55; }',
  '[data-plugin="dsh-spark-dock"] .cryst { color: var(--dsw-alias-state-success-primary); font-weight: 600; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill { position: relative; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 9px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); cursor: pointer; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.on { background: var(--accent, var(--dsw-alias-brand-primary)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .dock-modbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
  '[data-plugin="dsh-spark-dock"] .dock-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 16px; border: none; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)); color: var(--dsw-alias-label-primary-foreground, #fff); font: 600 13px/1 var(--dsw-font-family, inherit); cursor: pointer; }',
  '[data-plugin="dsh-spark-dock"] .dock-btn:hover { filter: brightness(1.08); }',
  '[data-plugin="dsh-spark-dock"] .dock-btn:disabled { opacity: .55; cursor: default; }',
  '[data-plugin="dsh-spark-dock"] .dock-field { width: 100%; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; color: var(--dsw-alias-label-primary); font: 400 13px/1.4 var(--dsw-font-family, inherit); padding: 8px 10px; margin-bottom: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-field:focus-visible { outline: 2px solid var(--accent, var(--dsw-alias-brand-primary)); outline-offset: 1px; }',
  '[data-plugin="dsh-spark-dock"] .dock-field::placeholder { color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] textarea.dock-field { resize: vertical; }',
  '[data-plugin="dsh-spark-dock"] .dock-fieldrow { display: flex; align-items: center; gap: 6px; }',
  '[data-plugin="dsh-spark-dock"] .dock-fieldrow .grow { flex: 1; min-width: 0; }',
  '[data-plugin="dsh-spark-dock"] .dock-fieldrow .dock-field { margin-bottom: 0; }',
  '[data-plugin="dsh-spark-dock"] select.dock-field.sel { width: auto; }',
  '[data-plugin="dsh-spark-dock"] .dock-error { padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; color: var(--dsw-alias-state-error-primary); font-size: 12px; }',
  '[data-plugin="dsh-spark-dock"] .dock-ok { padding: 8px 10px; border: 1px solid var(--dsw-alias-state-success-primary); border-radius: 8px; color: var(--dsw-alias-state-success-primary); font-size: 12px; }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot { width: 9px; height: 9px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); display: inline-block; flex: none; }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot.done { background: var(--dsw-alias-state-success-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot.warn { background: var(--dsw-alias-state-warn-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-sdot.error { background: var(--dsw-alias-state-error-primary); }',
  '[data-plugin="dsh-spark-dock"] .dock-row .amount { font-size: 13px; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-spark-dock"] .dock-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-btn.ghost { background: transparent; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }',
  '[data-plugin="dsh-spark-dock"] .dock-btn.ghost:hover { color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-plugin="dsh-spark-dock"] .dock-scopes { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin: 6px 0 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-hline { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 6px 0 2px; }',
  '[data-plugin="dsh-spark-dock"] .dock-hline b { font-size: 12px; font-weight: 700; color: var(--dsw-alias-label-primary); }',

  /* ── Fairy 表情层（docs/spark-dock-preview fairy.css 子集） ── */
  '[data-plugin="dsh-spark-dock"] .fairy-face { width: 46px; height: 46px; overflow: visible; color: var(--dsw-alias-label-primary-foreground, #fff); animation: dock-bob 3.4s ease-in-out infinite; }',
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

  /* ── 播报气泡 ── */
  '[data-plugin="dsh-spark-dock"] .dock-bubble { position: fixed; z-index: 9300; max-width: 250px; padding: 9px 12px; border-radius: 14px; background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l1); box-shadow: var(--dsw-shadow-lv2, 0 8px 24px rgba(10,18,38,.16)); color: var(--dsw-alias-label-primary-foreground, #fff); font: 500 12px/1.5 var(--dsw-font-family, inherit); pointer-events: auto; }',
  '[data-plugin="dsh-spark-dock"] .dock-bubble .src { display: block; margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-bubble.mood-alert { border-color: var(--dsw-alias-state-warn-primary); }',
  '[data-plugin="dsh-spark-dock"] .grow-spacer { flex: 1; }',
  '[data-plugin="dsh-spark-dock"] .dock-statrow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }',
  '[data-plugin="dsh-spark-dock"] .dock-stat .k { font-size: 11px; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-stat .v { font-size: 17px; font-weight: 700; margin-top: 2px; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }',
  '[data-plugin="dsh-spark-dock"] .dock-narr { display: flex; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--dsw-alias-border-l1); font-size: 11px; color: var(--dsw-alias-label-secondary); }',
  '[data-plugin="dsh-spark-dock"] .dock-narr .lab { flex: none; color: var(--dsw-alias-label-tertiary); }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.mini { padding: 1px 7px; font-size: 10px; cursor: default; }',
  '[data-plugin="dsh-spark-dock"] .dock-pill.mini.accent { background: color-mix(in srgb, var(--accent) 16%, transparent); border-color: transparent; color: var(--accent); }',
  '[data-plugin="dsh-spark-dock"] .dock-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px; font-size: 14px; line-height: 1.5; }',
  '[data-plugin="dsh-spark-dock"] .dock-empty { padding: 32px 12px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-tertiary); }',

  /* ── 内嵌页 compat 层（2026-09 UIUX 收敛）────────────────────────────
   * 原则：dock 标题栏已给出模块名与描述，内嵌页自己的设置页级标题
   * （H2 大标题 + 一句简介）在 overlay 里是三层 chrome 冗余，压掉；
   * 正文密度向 13px 靠拢；不碰组件内部的业务样式。 */
  /* hippomemo：类名稳定，直接压标题与简介 */
  '[data-plugin="dsh-spark-dock"] .hippomemo-title, [data-plugin="dsh-spark-dock"] .hippomemo-intro { display: none; }',
  /* github / npm：css-modules hash 类不可寻址，用结构选择器
   * （两包的 section 根部均为 h2.title + p.intro 相邻对） */
  '.dock-embed-connector :is(h1, h2):first-of-type, .dock-embed-connector :is(h1, h2):first-of-type + p { display: none; }',
  /* 内嵌正文密度：设置页 16px 基准 → overlay 13px；列表/表单间距收紧 */
  '.dock-embed { font-size: 13px; line-height: 1.45; }',
  '.dock-embed :is(h1, h2) { font-size: 15px; line-height: 1.35; margin: 0 0 8px; }',
  '.dock-embed :is(h3) { font-size: 13px; margin: 0 0 6px; }',
  '.dock-embed p { font-size: 13px; }',
  /* hippomemo 分段控件通栏（与 dock subtabbar 同宽对齐） */
  '[data-plugin="dsh-spark-dock"] .hippomemo-tabs { align-self: stretch; }',
  /* connector 按钮不被 flex column 拉伸成全宽白胶囊，回落紧凑尺寸 */
  '.dock-embed-connector button { align-self: flex-start; }',
].join('\n')
